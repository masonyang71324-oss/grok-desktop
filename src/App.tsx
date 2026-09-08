import { useI18n, setLocale } from './i18n';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Code2,
  Command as CommandIcon,
  Download,
  Ellipsis,
  FolderOpen,
  Gauge,
  History,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  TriangleAlert,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import type {
  AcpUpdate,
  Attachment,
  Bootstrap,
  Command,
  DesktopEvent,
  ModelsState,
  PermissionRequest,
  SessionSnapshot,
  SessionSummary,
  Settings,
  TaskSummary,
} from './types';
import {
  appendUpdate,
  createFrameBuffer,
  finalizeTurn,
  fromReplay,
  type TimelineRow,
} from './timeline.mjs';
import { baseName, classifyFailure, errorText, readableDate, request } from './lib';
import { Brand, IconButton, Message, Modal, Spinner } from './components';
const ActionsDialog = lazy(() =>
  import('./Dialogs').then((module) => ({ default: module.ActionsDialog })),
);
const ManagementDialog = lazy(() =>
  import('./Dialogs').then((module) => ({ default: module.ManagementDialog })),
);
const PermissionDialog = lazy(() =>
  import('./Dialogs').then((module) => ({ default: module.PermissionDialog })),
);
const SettingsDialog = lazy(() =>
  import('./Dialogs').then((module) => ({ default: module.SettingsDialog })),
);
const UsageDialog = lazy(() =>
  import('./Dialogs').then((module) => ({ default: module.UsageDialog })),
);
import Inspector from './Inspector';
import PermissionControl from './PermissionControl';
import TaskCenter from './TaskCenter';
import ProjectTools from './ProjectTools';
import AttachmentThumbnail from './AttachmentThumbnail';
import './workflows.css';
import './enhancements.css';
import { createDraftStore, sameDraft, type Draft } from './drafts.mjs';

const defaults: Settings = {
  language: 'zh-CN',
  grokPath: '',
  theme: 'dark',
  modelId: '',
  effort: '',
  permissionMode: 'ask',
  recentProjects: [],
  lastProject: '',
};
type Run = { sessionId: string; turnId: string };
type Permission = {
  requestId: string | number;
  params: PermissionRequest;
  sessionId: string;
};
type Dialog =
  'actions' | 'settings' | 'management' | 'usage' | 'shortcuts' | 'tasks' | 'project-tools' | null;
export default function App() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<Settings>(defaults);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [connection, setConnection] = useState('connecting');
  const [connectionError, setConnectionError] = useState('');
  const [cwd, setCwd] = useState('');
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [models, setModels] = useState<ModelsState>({
    currentModelId: '',
    availableModels: [],
  });
  const [commands, setCommands] = useState<Command[]>([]);
  const [rows, setRows] = useState<TimelineRow[]>([]);
  const [plan, setPlan] = useState<any[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [pending, setPending] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [turnNotice, setTurnNotice] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [loadingSession, setLoadingSession] = useState('');
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentPreview, setAttachmentPreview] = useState<
    | (Attachment & {
        dataUrl?: string;
        notice?: string;
        native?: boolean;
        loading?: boolean;
        error?: string;
      })
    | null
  >(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [projectMenu, setProjectMenu] = useState(false);
  const [sessionMenu, setSessionMenu] = useState<SessionSummary | null>(null);
  const [permissionMenuRequest, setPermissionMenuRequest] = useState(0);
  const [topbarMenu, setTopbarMenu] = useState(false);
  const transitionRef = useRef(false);
  const [sidebar, setSidebar] = useState(true);
  const [inspector, setInspector] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<'files' | 'changes' | 'plan'>('files');
  const [fileToOpen, setFileToOpen] = useState<{
    path: string;
    line?: number;
    requestId: number;
  }>();
  const [dragging, setDragging] = useState(false);
  const uiRestored = useRef(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [notice, setNotice] = useState('');
  const [turnError, setTurnError] = useState('');
  const [revision, setRevision] = useState(0);
  const [background, setBackground] = useState('');
  const [rename, setRename] = useState<SessionSummary | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const modelsRef = useRef(models);
  modelsRef.current = models;
  const draftValueRef = useRef(draft);
  draftValueRef.current = draft;
  const attachmentRef = useRef(attachments);
  attachmentRef.current = attachments;
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const runRef = useRef(run);
  runRef.current = run;
  const busyRef = useRef(false);
  busyRef.current = !!run || pending;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [showScroll, setShowScroll] = useState(false);
  const noticeTimer = useRef<number | undefined>(undefined);
  const started = useRef(false);
  const notify = useCallback((message: string) => {
    setNotice(message);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(''), 6000);
  }, []);
  const draftStoreRef = useRef<ReturnType<typeof createDraftStore> | null>(null);
  const draftStorageError = useRef(false);
  if (!draftStoreRef.current)
    draftStoreRef.current = createDraftStore(window.localStorage, () => {
      if (!draftStorageError.current) {
        draftStorageError.current = true;
        notify(t('草稿暂时无法保存到本机，请保留重要内容后再关闭应用。'));
      }
    });
  const composerRef = useRef({ cwd: '', sessionId: '' });
  const draftRestoredRef = useRef(false);
  const needsRestoreRef = useRef(false);
  const restorePromiseRef = useRef<Promise<boolean> | null>(null);
  function currentDraft(): Draft {
    return { text: draftValueRef.current, attachments: attachmentRef.current };
  }
  function persistDraft(deferred = false) {
    const target = composerRef.current;
    draftStoreRef.current!.save(target.cwd, target.sessionId, currentDraft(), deferred);
  }
  function replaceDraft(value: Draft) {
    draftValueRef.current = value.text;
    attachmentRef.current = value.attachments;
    setDraft(value.text);
    setAttachments(value.attachments);
  }
  function activateDraft(targetCwd: string, sessionId = '', transfer = false) {
    const previous = composerRef.current;
    const value = currentDraft();
    persistDraft();
    const same = previous.cwd === targetCwd && previous.sessionId === sessionId;
    composerRef.current = { cwd: targetCwd, sessionId };
    if (transfer) {
      if (previous.cwd && !previous.sessionId)
        draftStoreRef.current!.save(previous.cwd, '', {
          text: '',
          attachments: [],
        });
      replaceDraft(value);
      persistDraft();
    } else if (!same) replaceDraft(draftStoreRef.current!.read(targetCwd, sessionId));
    draftStoreRef.current!.select(targetCwd, sessionId);
  }
  useEffect(() => {
    if (!draftRestoredRef.current) {
      draftRestoredRef.current = true;
      replaceDraft(draftStoreRef.current!.read(''));
    }
    persistDraft(true);
  }, [draft, attachments]);
  useEffect(() => {
    const flush = () => persistDraft();
    window.addEventListener('beforeunload', flush);
    return () => {
      flush();
      window.removeEventListener('beforeunload', flush);
    };
  }, []);
  useEffect(() => {
    if (!uiRestored.current || initializing) return;
    const ui = { sidebar, inspector, inspectorTab };
    if (JSON.stringify(settingsRef.current.ui) === JSON.stringify(ui)) return;
    void saveSettings({ ui }).catch((e) => notify(errorText(e)));
  }, [sidebar, inspector, inspectorTab, initializing]);
  async function refreshSessions(target = cwdRef.current) {
    if (!target) return;
    try {
      const list = await request<SessionSummary[]>('sessions.list', {
        cwd: target,
      });
      if (cwdRef.current === target) setSessions(draftStoreRef.current!.merge(target, list));
    } catch (e) {
      notify(errorText(e));
    }
  }
  function applySnapshot(snapshot: SessionSnapshot, transferDraft = false) {
    cwdRef.current = snapshot.cwd;
    setCwd(snapshot.cwd);
    const active = snapshot.runtime?.turnId
      ? { sessionId: snapshot.sessionId, turnId: snapshot.runtime.turnId }
      : null;
    runRef.current = active;
    busyRef.current = !!active;
    setRun(active);
    setPending(false);
    setCancelling(false);
    setPermissions((previous) => [
      ...previous.filter((item) => item.sessionId !== snapshot.sessionId),
      ...(snapshot.runtime?.permissions || []),
    ]);
    draftStoreRef.current!.remember(snapshot.cwd, snapshot.sessionId);
    activateDraft(snapshot.cwd, snapshot.sessionId, transferDraft);
    sessionRef.current = snapshot;
    setSession(snapshot);
    modelsRef.current = snapshot.models;
    setModels(snapshot.models);
    setCommands(snapshot.commands || []);
    setRows(fromReplay(snapshot.updates || [], snapshot.sessionId, snapshot.runtime));
    const replayPlan = [...(snapshot.updates || [])]
      .reverse()
      .find((update) => update.sessionUpdate === 'plan');
    setPlan(replayPlan?.entries || []);
    setTurnError(
      snapshot.runtime?.error ||
        (snapshot.runtime?.status === 'interrupted' ? t('任务已中断，请检查记录后手动重试。') : ''),
    );
    setTurnNotice('');
    needsRestoreRef.current = false;
    setConnection(snapshot.runtime?.connection || 'ready');
    setConnectionError('');
    stickToBottom.current = true;
  }
  function restoreSession(): Promise<boolean> {
    if (restorePromiseRef.current) return restorePromiseRef.current;
    const previousSession = sessionRef.current;
    if (!previousSession || busyRef.current || transitionRef.current) return Promise.resolve(false);
    transitionRef.current = true;
    setLoadingSession(previousSession.sessionId);
    setConnection('restoring');
    const operation = (async () => {
      try {
        const restored = await request<SessionSnapshot>('session.load', {
          cwd: previousSession.cwd,
          sessionId: previousSession.sessionId,
        });
        if (
          previousSession.permissionMode &&
          restored.permissionMode !== previousSession.permissionMode
        ) {
          await request('session.permissions', {
            sessionId: restored.sessionId,
            permissionMode: previousSession.permissionMode,
          });
          restored.permissionMode = previousSession.permissionMode;
        }
        applySnapshot(restored);
        return true;
      } catch (error) {
        needsRestoreRef.current = true;
        setConnection('error');
        setConnectionError(t('无法恢复当前会话：{value0}', { value0: errorText(error) }));
        notify(t('请重新连接或选择其他会话：{value0}', { value0: errorText(error) }));
        return false;
      } finally {
        transitionRef.current = false;
        setLoadingSession('');
        restorePromiseRef.current = null;
      }
    })();
    restorePromiseRef.current = operation;
    return operation;
  }
  async function applyProject(project: { cwd: string; sessions: SessionSummary[] }) {
    const lastSessionId = draftStoreRef.current!.selected(project.cwd);
    const incoming = !composerRef.current.cwd ? currentDraft() : null;
    const carryInput = !!incoming && (!!incoming.text || incoming.attachments.length > 0);
    const existing = draftStoreRef.current!.read(project.cwd);
    const history = draftStoreRef.current!.merge(project.cwd, project.sessions);
    activateDraft(project.cwd);
    cwdRef.current = project.cwd;
    setCwd(project.cwd);
    setSessions(history);
    sessionRef.current = null;
    setSession(null);
    runRef.current = null;
    busyRef.current = false;
    setRun(null);
    setPending(false);
    setCancelling(false);
    setRows([]);
    setPlan([]);
    setTurnError('');
    setTurnNotice('');
    setBackground('');
    needsRestoreRef.current = false;
    setConnection('ready');
    setConnectionError('');
    if (carryInput && incoming) {
      const files = [...existing.attachments];
      for (const file of incoming.attachments) {
        if (!files.some((item) => item.path === file.path)) files.push(file);
      }
      replaceDraft({
        text: [existing.text, incoming.text].filter((text) => text.length > 0).join('\n\n'),
        attachments: files,
      });
      persistDraft();
      draftStoreRef.current!.save('', '', { text: '', attachments: [] });
      if (existing.text || existing.attachments.length)
        notify(t('两份未发送草稿已合并，原有会话草稿保持原样。'));
    }
    if (!carryInput && lastSessionId && history.some((item) => item.sessionId === lastSessionId)) {
      setLoadingSession(lastSessionId);
      try {
        applySnapshot(
          await request<SessionSnapshot>('session.load', {
            cwd: project.cwd,
            sessionId: lastSessionId,
          }),
        );
      } catch (error) {
        notify(t('无法恢复上次会话，请从列表重新选择：{value0}', { value0: errorText(error) }));
      } finally {
        setLoadingSession('');
      }
    }
  }
  async function initialize() {
    setInitializing(true);
    setConnection('connecting');
    setConnectionError('');
    try {
      const data = await request<Bootstrap>('bootstrap');
      void request<TaskSummary[]>('tasks.list')
        .then((value) => {
          setTasks(value);
          setPermissions(value.flatMap((task) => task.permissions));
        })
        .catch(() => {});
      setBootstrap(data);
      setSettings(data.settings);
      setLocale(data.settings.language);
      settingsRef.current = data.settings;
      if (!uiRestored.current) {
        setSidebar(data.settings.ui?.sidebar !== false);
        setInspector(data.settings.ui?.inspector !== false);
        setInspectorTab(data.settings.ui?.inspectorTab || 'files');
        uiRestored.current = true;
      }
      if (!sessionRef.current) {
        modelsRef.current = data.models;
        setModels(data.models);
        setCommands(data.commands);
      }
      if (!data.cli.connected) {
        setConnection('error');
        setConnectionError(data.cli.error || '');
        if (!data.cli.path) setDialog('settings');
      } else if (sessionRef.current && needsRestoreRef.current) {
        await restoreSession();
      } else if (!restorePromiseRef.current) setConnection('ready');
      if (
        data.settings.lastProject &&
        !cwdRef.current &&
        !draftValueRef.current &&
        !attachmentRef.current.length
      ) {
        try {
          transitionRef.current = true;
          await applyProject(
            await request<{ cwd: string; sessions: SessionSummary[] }>('project.open', {
              cwd: data.settings.lastProject,
            }),
          );
        } catch (e) {
          notify(errorText(e));
        } finally {
          transitionRef.current = false;
        }
      }
    } catch (e) {
      setConnection('error');
      setConnectionError(errorText(e));
    } finally {
      setInitializing(false);
    }
  }
  useEffect(() => {
    const buffer = createFrameBuffer<{ update: AcpUpdate; turnId: string; sessionId: string }>(
      (buffered) => {
        const items = buffered.filter((item) => item.sessionId === sessionRef.current?.sessionId);
        setRows((previous) =>
          items.reduce((list, item) => appendUpdate(list, item.update, item.turnId), previous),
        );
        for (const item of items) {
          if (item.update.sessionUpdate === 'plan') setPlan(item.update.entries || []);
          if (item.update.sessionUpdate === 'current_mode_update') {
            const current = sessionRef.current;
            const modeId = item.update.currentModeId || item.update.modeId;
            if (current?.modes && modeId) {
              const next = {
                ...current,
                modes: { ...current.modes, currentModeId: modeId },
              };
              sessionRef.current = next;
              setSession(next);
            }
          }
        }
      },
    );
    const unsub = window.desktop?.onEvent((event: DesktopEvent) => {
      if (event.type === 'connection') {
        if (event.sessionId && event.sessionId !== sessionRef.current?.sessionId) return;
        if (event.state === 'error' || event.state === 'disconnected') {
          if (sessionRef.current) needsRestoreRef.current = true;
          setConnection(event.state);
          setConnectionError(event.message || '');
        } else if (event.state === 'ready' && needsRestoreRef.current && sessionRef.current) {
          setConnection('restoring');
          void restoreSession();
        } else {
          setConnection(event.state);
          setConnectionError(event.message || '');
        }
        return;
      }
      if (event.type === 'tasks-changed') {
        setTasks(event.tasks);
        setPermissions(event.tasks.flatMap((task) => task.permissions));
        return;
      }
      if (event.type === 'runner-changed') return;
      if (event.type === 'workspace-changed') {
        if (event.cwd === cwdRef.current) setRevision((value) => value + 1);
        return;
      }
      if (event.type === 'sessions-changed') {
        void refreshSessions();
        return;
      }
      if (event.type === 'permission-resolved') {
        setPermissions((items) =>
          items.filter(
            (item) =>
              item.requestId !== event.requestId ||
              (!!event.sessionId && item.sessionId !== event.sessionId),
          ),
        );
        return;
      }
      if (event.type === 'commands') {
        if (!event.sessionId || event.sessionId === sessionRef.current?.sessionId)
          setCommands(event.commands);
        return;
      }
      if (event.type === 'models') {
        if (!event.sessionId || event.sessionId === sessionRef.current?.sessionId) {
          modelsRef.current = event.models;
          setModels(event.models);
        }
        return;
      }
      if (event.type === 'permission') {
        setPermissions((items) =>
          items.some(
            (item) => item.requestId === event.requestId && item.sessionId === event.sessionId,
          )
            ? items
            : [
                ...items,
                {
                  requestId: event.requestId,
                  params: event.params,
                  sessionId: event.sessionId,
                },
              ],
        );
        return;
      }
      if (event.type === 'notification') {
        if (event.kind === 'settings-reloaded') {
          if (sessionRef.current) {
            needsRestoreRef.current = true;
            void restoreSession();
          }
          return;
        }
        if (!event.sessionId || event.sessionId === sessionRef.current?.sessionId) {
          const payload = event.payload;
          const label = payload?.title || payload?.message || payload?.status;
          if (label) setBackground(String(label));
        }
        return;
      }
      if (event.sessionId !== sessionRef.current?.sessionId) return;
      if (event.type === 'turn-start') {
        if (event.queueId)
          setRows((previous) => [
            ...previous,
            {
              id: `queue:${event.queueId}`,
              kind: 'user',
              text: event.text || '',
              attachments: event.attachments || [],
              turnId: event.turnId,
              streaming: false,
            },
          ]);
        const next = { sessionId: event.sessionId, turnId: event.turnId };
        runRef.current = next;
        busyRef.current = true;
        setRun(next);
        setPending(false);
        setTurnError('');
        setTurnNotice('');
        return;
      }
      if (event.type === 'update') {
        if (event.replay) return;
        if (event.turnId && runRef.current && event.turnId !== runRef.current.turnId) return;
        buffer.push({
          sessionId: event.sessionId,
          update: event.update,
          turnId: event.turnId || runRef.current?.turnId || 'live',
        });
        return;
      }
      if (event.type === 'turn-end' || event.type === 'turn-error') {
        if (runRef.current && event.turnId !== runRef.current.turnId) return;
        buffer.flush();
        const reason = event.type === 'turn-end' ? event.result?.stopReason : '';
        const incomplete = event.type === 'turn-error' || (!!reason && reason !== 'end_turn');
        setRows((previous) => finalizeTurn(previous, event.turnId, incomplete));
        if (event.type === 'turn-end' && incomplete) setTurnNotice(String(reason));
        runRef.current = null;
        busyRef.current = false;
        setRun(null);
        setPending(false);
        setCancelling(false);
        setPermissions((items) => items.filter((item) => item.sessionId !== event.sessionId));
        if (event.type === 'turn-error') setTurnError(event.message);
        setRevision((value) => value + 1);
        void refreshSessions();
      }
    });
    if (!started.current) {
      started.current = true;
      void initialize();
    }
    return () => {
      unsub?.();
      buffer.dispose();
    };
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () =>
      (document.documentElement.dataset.theme =
        settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings.theme]);
  useEffect(() => {
    if (stickToBottom.current && threadRef.current)
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [rows, run, turnError]);
  useEffect(() => {
    const area = draftRef.current;
    if (area) {
      area.style.height = 'auto';
      area.style.height = `${Math.min(190, Math.max(52, area.scrollHeight))}px`;
    }
  }, [draft]);
  async function saveSettings(patch: Partial<Settings>) {
    const previousPath = settingsRef.current.grokPath;
    const saved = await request<Settings>('settings.save', patch);
    setLocale(saved.language);
    setSettings(saved);
    settingsRef.current = saved;
    if (patch.grokPath !== undefined && saved.grokPath !== previousPath) await initialize();
    return saved;
  }
  async function openProject(path?: string) {
    if (transitionRef.current) return;
    if (pending || editorOpen) {
      notify(t('请先完成当前操作并关闭文件编辑器。'));
      return;
    }
    setProjectMenu(false);
    transitionRef.current = true;
    try {
      const target = path || (await request<string | null>('dialog.project'));
      if (!target) return;
      const project = await request<{
        cwd: string;
        sessions: SessionSummary[];
      }>('project.open', { cwd: target });
      await applyProject(project);
      setSettings((previous) => ({
        ...previous,
        lastProject: project.cwd,
        recentProjects: [
          project.cwd,
          ...previous.recentProjects.filter((p) => p !== project.cwd),
        ].slice(0, 12),
      }));
    } catch (e) {
      notify(errorText(e));
    } finally {
      transitionRef.current = false;
    }
  }
  async function newConversation() {
    if (transitionRef.current) return;
    if (pending) return;
    if (!cwdRef.current) {
      await openProject();
      return;
    }
    transitionRef.current = true;
    setLoadingSession('new');
    try {
      const snapshot = await request<SessionSnapshot>('session.new', {
        cwd: cwdRef.current,
        ...preferences(true),
      });
      applySnapshot(snapshot, !sessionRef.current);
      void refreshSessions();
      draftRef.current?.focus();
    } catch (e) {
      notify(errorText(e));
    } finally {
      transitionRef.current = false;
      setLoadingSession('');
    }
  }
  async function loadConversation(summary: SessionSummary) {
    setSessionMenu(null);
    if (transitionRef.current) return;
    if (pending || (editorOpen && summary.cwd !== cwdRef.current)) {
      notify(t('请先完成当前操作并关闭文件编辑器。'));
      return;
    }
    if (summary.sessionId === sessionRef.current?.sessionId) {
      if (needsRestoreRef.current) await restoreSession();
      return;
    }
    transitionRef.current = true;
    setLoadingSession(summary.sessionId);
    try {
      const snapshot = await request<SessionSnapshot>('session.load', {
        cwd: summary.cwd || cwdRef.current,
        sessionId: summary.sessionId,
      });
      applySnapshot(snapshot);
      void refreshSessions(snapshot.cwd);
    } catch (e) {
      notify(t('无法载入会话：{value0}', { value0: errorText(e) }));
    } finally {
      transitionRef.current = false;
      setLoadingSession('');
    }
  }
  const preferences = (forNew = false) => {
    const actual = modelsRef.current;
    const selected = actual.availableModels.find(
      (model) => model.modelId === actual.currentModelId,
    );
    return {
      modelId:
        !forNew && sessionRef.current
          ? actual.currentModelId || undefined
          : settingsRef.current.modelId || undefined,
      effort:
        !forNew && sessionRef.current
          ? selected?._meta?.reasoningEffort || undefined
          : settingsRef.current.effort || undefined,
      permissionMode:
        !forNew && sessionRef.current
          ? sessionRef.current.permissionMode
          : settingsRef.current.permissionMode,
    };
  };
  function openPermissions() {
    setDialog(null);
    setPermissionMenuRequest((value) => value + 1);
  }
  async function changePermissions(
    permissionMode: Settings['permissionMode'],
    sessionId = sessionRef.current?.sessionId,
  ) {
    if (!sessionId) {
      await saveSettings({ permissionMode });
      return;
    }
    const result = await request<{
      sessionId: string;
      permissionMode: Settings['permissionMode'];
    }>('session.permissions', { sessionId, permissionMode });
    if (sessionRef.current?.sessionId === result.sessionId) {
      const next = {
        ...sessionRef.current,
        permissionMode: result.permissionMode,
      };
      sessionRef.current = next;
      setSession(next);
    }
  }
  async function configureSelection(patch: { modelId?: string; effort?: string; modeId?: string }) {
    if (busyRef.current || transitionRef.current) return;
    if (needsRestoreRef.current && !(await restoreSession())) return;
    transitionRef.current = true;
    setConfiguring(true);
    try {
      if (sessionRef.current) {
        const result = await request<{
          models: ModelsState;
          modes?: SessionSnapshot['modes'];
        }>('session.configure', {
          sessionId: sessionRef.current.sessionId,
          ...patch,
        });
        modelsRef.current = result.models;
        setModels(result.models);
        if (result.modes && sessionRef.current) {
          const next = { ...sessionRef.current, modes: result.modes };
          sessionRef.current = next;
          setSession(next);
        }
      }
      if (patch.modelId !== undefined || patch.effort !== undefined)
        await saveSettings(
          patch.modelId
            ? { modelId: patch.modelId, effort: patch.effort || '' }
            : { effort: patch.effort },
        );
    } catch (error) {
      notify(errorText(error));
    } finally {
      transitionRef.current = false;
      setConfiguring(false);
      if (needsRestoreRef.current) void restoreSession();
    }
  }
  async function send() {
    const submitted = currentDraft();
    const text = submitted.text.trim();
    if (/^\/always-approve(?:\s+(?:on|off))?$/i.test(text)) {
      openPermissions();
      setDraft('');
      return;
    }
    if (text === '/context' || text === '/session-info') {
      setDialog('usage');
      setDraft('');
      return;
    }
    if (
      (!text && !submitted.attachments.length) ||
      busyRef.current ||
      transitionRef.current ||
      loadingSession
    )
      return;
    const recovered = needsRestoreRef.current && (await restoreSession());
    if ((connection !== 'ready' && !recovered) || needsRestoreRef.current) {
      notify(t('Grok 尚未连接，请先重新连接或检查设置。'));
      return;
    }
    if (!cwdRef.current) {
      notify(t('请先选择项目目录，再开始任务。'));
      return;
    }
    busyRef.current = true;
    setPending(true);
    setTurnError('');
    setTurnNotice('');
    let target = sessionRef.current;
    let userRowId = '';
    const files = [...submitted.attachments];
    try {
      if (!target) {
        target = await request<SessionSnapshot>('session.new', {
          cwd: cwdRef.current,
          ...preferences(true),
        });
        applySnapshot(target, true);
        busyRef.current = true;
        setPending(true);
      }
      const userRow: TimelineRow = {
        id: crypto.randomUUID(),
        kind: 'user',
        text,
        attachments: files,
        turnId: `user:${Date.now()}`,
        streaming: false,
      };
      userRowId = userRow.id;
      setRows((previous) => [...previous, userRow]);
      stickToBottom.current = true;
      const result = await request<{ turnId?: string; queueId?: string }>('session.send', {
        cwd: cwdRef.current,
        sessionId: target.sessionId,
        text,
        ...preferences(),
        attachments: files,
      });
      if (sameDraft(currentDraft(), submitted)) {
        replaceDraft({ text: '', attachments: [] });
        persistDraft();
      }
      if (result.queueId) {
        setRows((previous) => previous.filter((row) => row.id !== userRowId));
        runRef.current = null;
        busyRef.current = false;
        setRun(null);
        setPending(false);
        notify(t('请求已加入队列'));
      } else if (busyRef.current && result.turnId) {
        const active = { sessionId: target.sessionId, turnId: result.turnId };
        runRef.current = active;
        setRun(active);
        setPending(false);
      }
    } catch (e) {
      busyRef.current = false;
      runRef.current = null;
      setPending(false);
      setRun(null);
      if (userRowId) setRows((previous) => previous.filter((row) => row.id !== userRowId));
      setTurnError(errorText(e));
      notify(errorText(e));
      persistDraft();
      if (needsRestoreRef.current) void restoreSession();
    }
  }
  async function stop() {
    if (!runRef.current) return;
    setCancelling(true);
    try {
      await request('session.cancel', { sessionId: runRef.current.sessionId });
    } catch (e) {
      setCancelling(false);
      notify(errorText(e));
    }
  }
  function recover(error: string) {
    const action = classifyFailure(error).action;
    if (action === 'usage') setDialog('usage');
    else if (action === 'settings') setDialog('settings');
    else if (action === 'login')
      void request('system.open', { target: 'terminal', cwd: cwdRef.current }).catch((e) =>
        notify(errorText(e)),
      );
    else if (action === 'reconnect') void initialize();
    else {
      const last = [...rows].reverse().find((row) => row.kind === 'user');
      if (last && !draftValueRef.current.trim() && !attachmentRef.current.length)
        fillDraft(last.text, last.attachments || []);
      else draftRef.current?.focus();
    }
  }
  function recoveryLabel(error: string) {
    return t(
      {
        login: '打开 Grok 登录',
        usage: '查看额度',
        settings: '连接设置',
        reconnect: '重新连接',
        retry: '重新编辑请求',
      }[classifyFailure(error).action],
    );
  }
  async function attach() {
    try {
      const selected = await request<Attachment[]>('dialog.attach');
      setAttachments((previous) => [
        ...previous,
        ...selected.filter((item) => !previous.some((file) => file.path === item.path)),
      ]);
    } catch (e) {
      notify(errorText(e));
    }
  }
  async function enqueue() {
    const submitted = currentDraft();
    const target = sessionRef.current;
    if (!target || (!submitted.text.trim() && !submitted.attachments.length) || pending) return;
    try {
      await request('session.enqueue', {
        cwd: target.cwd,
        sessionId: target.sessionId,
        text: submitted.text.trim(),
        attachments: submitted.attachments,
        ...preferences(),
      });
      if (
        target.sessionId === sessionRef.current?.sessionId &&
        sameDraft(currentDraft(), submitted)
      ) {
        replaceDraft({ text: '', attachments: [] });
        persistDraft();
      }
      notify(t('请求已加入队列'));
    } catch (e) {
      notify(errorText(e));
    }
  }
  function addContext(file: Attachment) {
    setAttachments((previous) => [...previous, file]);
    notify(t('已加入上下文'));
  }
  async function inspectAttachment(file: Attachment) {
    const preview = { ...file, loading: file.text === undefined && !!file.path };
    setAttachmentPreview(preview);
    if (file.text !== undefined || !file.path) return;
    try {
      const value = await request<{
        text?: string;
        dataUrl?: string;
        notice?: string;
        native?: boolean;
      }>('attachment.preview', {
        path: file.path,
      });
      setAttachmentPreview((current) => (current === preview ? { ...file, ...value } : current));
    } catch (e) {
      setAttachmentPreview((current) =>
        current === preview ? { ...file, error: errorText(e) } : current,
      );
    }
  }
  async function pasteImage(event: React.ClipboardEvent) {
    if (!Array.from(event.clipboardData.items).some((item) => item.type.startsWith('image/')))
      return;
    event.preventDefault();
    try {
      const file = await request<Attachment | null>('clipboard.image');
      if (file) addContext(file);
    } catch (e) {
      notify(errorText(e));
    }
  }
  function dropFiles(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    try {
      const files = window.desktop.pathsForFiles(Array.from(event.dataTransfer.files));
      setAttachments((previous) => [
        ...previous,
        ...files.filter((file) => !previous.some((item) => item.path === file.path)),
      ]);
    } catch (error) {
      notify(errorText(error));
    }
  }
  const openToolFile = useCallback(
    (filename: string, line?: number) => {
      const root = cwdRef.current.replaceAll('\\', '/').replace(/\/$/, '');
      let relative = filename.replaceAll('\\', '/');
      if (/^(?:[a-z]:\/|\/)/i.test(relative)) {
        if (!relative.toLowerCase().startsWith(root.toLowerCase() + '/')) {
          notify(t('此文件不在当前项目中，请先切换到对应项目。'));
          return;
        }
        relative = relative.slice(root.length + 1);
      }
      setInspector(true);
      setInspectorTab('files');
      setFileToOpen((previous) => ({
        path: relative,
        line,
        requestId: (previous?.requestId || 0) + 1,
      }));
    },
    [notify],
  );
  async function openActions() {
    if (transitionRef.current) return;
    if (!sessionRef.current && cwdRef.current && !busyRef.current) {
      transitionRef.current = true;
      setLoadingSession('new');
      try {
        const snapshot = await request<SessionSnapshot>('session.new', {
          cwd: cwdRef.current,
          ...preferences(true),
        });
        applySnapshot(snapshot, true);
      } catch (e) {
        notify(errorText(e));
      } finally {
        transitionRef.current = false;
        setLoadingSession('');
      }
    }
    setDialog('actions');
  }
  const fillDraft = useCallback((text: string, files?: Attachment[]) => {
    setDraft(text);
    if (files) setAttachments(files);
    window.setTimeout(() => draftRef.current?.focus(), 0);
  }, []);
  const keyboard = useRef({ newConversation, openActions });
  keyboard.current = { newConversation, openActions };
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProjectMenu(false);
        setSessionMenu(null);
        setTopbarMenu(false);
      }
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        void keyboard.current.newConversation();
      }
      if (event.key.toLowerCase() === 'k') {
        event.preventDefault();
        void keyboard.current.openActions();
      }
      if (event.key === ',') {
        event.preventDefault();
        setDialog('settings');
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);
  async function renameSession() {
    if (!rename || !renameTitle.trim()) return;
    setRenameBusy(true);
    try {
      await request('session.rename', {
        cwd: rename.cwd || cwd,
        sessionId: rename.sessionId,
        title: renameTitle.trim(),
      });
      draftStoreRef.current!.remember(rename.cwd || cwd, rename.sessionId, renameTitle.trim());
      await refreshSessions();
      setRename(null);
      notify(t('会话名称已更新'));
    } catch (e) {
      notify(errorText(e));
    } finally {
      setRenameBusy(false);
    }
  }
  async function deleteSession() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await request('session.delete', {
        cwd: deleteTarget.cwd || cwd,
        sessionId: deleteTarget.sessionId,
      });
      if (sessionRef.current?.sessionId === deleteTarget.sessionId) {
        activateDraft(cwdRef.current);
        sessionRef.current = null;
        setSession(null);
        setRows([]);
        setPlan([]);
        needsRestoreRef.current = false;
      }
      draftStoreRef.current!.remove(deleteTarget.cwd || cwd, deleteTarget.sessionId);
      await refreshSessions();
      setDeleteTarget(null);
      notify(t('会话已删除'));
    } catch (e) {
      notify(errorText(e));
    } finally {
      setDeleteBusy(false);
    }
  }
  async function exportSession(summary: SessionSummary) {
    setSessionMenu(null);
    try {
      const result = await request<{ path: string } | null>('session.export', {
        cwd: summary.cwd || cwd,
        sessionId: summary.sessionId,
      });
      if (result) notify(t('已导出到 {value0}', { value0: result.path }));
    } catch (e) {
      notify(errorText(e));
    }
  }
  const currentModelId = session
    ? models.currentModelId
    : settings.modelId || models.currentModelId;
  const selectedModel = models.availableModels.find((model) => model.modelId === currentModelId);
  const currentEffort = session
    ? selectedModel?._meta?.reasoningEffort || ''
    : settings.effort || selectedModel?._meta?.reasoningEffort || '';
  const effortOptions = selectedModel?._meta?.reasoningEfforts || [];
  const currentTitle =
    sessions.find((item) => item.sessionId === session?.sessionId)?.title || t('新会话');
  const busy = !!run || pending;
  const filteredSessions = sessions.filter((item) =>
    item.title.toLowerCase().includes(search.toLowerCase()),
  );
  const currentSummary: SessionSummary | null = session
    ? { sessionId: session.sessionId, cwd: session.cwd, title: currentTitle }
    : null;
  const connectionLabel =
    {
      connecting: t('正在连接'),
      restoring: t('正在恢复会话'),
      ready: t('Grok 已连接'),
      error: t('连接异常'),
      disconnected: t('已断开'),
    }[connection] || connection;
  return (
    <div
      className={`app ${sidebar ? '' : 'sidebar-hidden'} ${inspector ? '' : 'inspector-hidden'}`}
    >
      {sidebar && (
        <aside className="sidebar">
          <div className="brand">
            <Brand />
            <div>
              Grok<span>DESKTOP</span>
            </div>
            <IconButton label={t('收起侧边栏')} onClick={() => setSidebar(false)}>
              <PanelLeftClose size={17} />
            </IconButton>
          </div>
          <button
            className="new-conversation"
            onClick={() => void newConversation()}
            disabled={!!loadingSession || initializing}
          >
            <Plus size={18} />
            <span>{t('新建会话')}</span>
            <kbd>Ctrl N</kbd>
          </button>
          <div className="project-switcher">
            <div className="section-label">
              {t('工作空间')}
              <button
                title={t('打开项目文件夹')}
                aria-label={t('打开项目文件夹')}
                onClick={() => void openProject()}
              >
                <Plus size={14} />
              </button>
            </div>
            <button
              className={`project-button ${projectMenu ? 'active' : ''}`}
              onClick={() => setProjectMenu(!projectMenu)}
              title={cwd || t('选择项目')}
            >
              <span className="project-icon">
                <FolderOpen size={18} />
              </span>
              <div>
                <strong>{cwd ? baseName(cwd) : t('选择项目')}</strong>
                <small>{cwd ? t('本地项目') : t('打开一个文件夹开始')}</small>
              </div>
              <ChevronDown size={14} />
            </button>
            {projectMenu && (
              <div className="project-dropdown">
                <button onClick={() => void openProject()}>
                  <FolderOpen size={15} />
                  {t('打开项目文件夹')}
                </button>
                {settings.recentProjects.map((project) => (
                  <button key={project} onClick={() => void openProject(project)} title={project}>
                    <FolderOpen size={14} />
                    <span>{baseName(project)}</span>
                    {project === cwd && <Check size={13} />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="history-heading">
            <span>{t('会话记录')}</span>
            <span className="count">{sessions.length}</span>
          </div>
          <div className="search-input">
            <Search size={15} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('搜索会话')}
              aria-label={t('搜索会话')}
            />
            {search && (
              <button onClick={() => setSearch('')} title={t('清除搜索')}>
                <X size={13} />
              </button>
            )}
          </div>
          <div className="session-list">
            {filteredSessions.length ? (
              filteredSessions.map((summary) => (
                <div
                  key={summary.sessionId}
                  className={`session-item ${session?.sessionId === summary.sessionId ? 'selected' : ''}`}
                >
                  <button
                    className="session-select"
                    onClick={() => void loadConversation(summary)}
                    disabled={!!loadingSession}
                    title={summary.title}
                  >
                    {loadingSession === summary.sessionId ? (
                      <Spinner />
                    ) : (
                      <MessageSquare size={15} />
                    )}
                    <span>{summary.title || t('未命名会话')}</span>
                    <small>{readableDate(summary.updatedAt)}</small>
                  </button>
                  <IconButton
                    label={t('{value0} · 更多操作', { value0: summary.title })}
                    onClick={() =>
                      setSessionMenu(sessionMenu?.sessionId === summary.sessionId ? null : summary)
                    }
                  >
                    <Ellipsis size={16} />
                  </IconButton>
                  {sessionMenu?.sessionId === summary.sessionId && (
                    <div className="session-dropdown">
                      <button
                        onClick={() => {
                          setRename(summary);
                          setRenameTitle(summary.title);
                          setSessionMenu(null);
                        }}
                      >
                        <Pencil size={14} />
                        {t('重命名')}
                      </button>
                      <button onClick={() => void exportSession(summary)}>
                        <Download size={14} />
                        {t('导出会话')}
                      </button>
                      <button
                        className="danger-text"
                        onClick={() => {
                          setDeleteTarget(summary);
                          setSessionMenu(null);
                        }}
                      >
                        <Trash2 size={14} />
                        {t('删除会话')}
                      </button>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="history-empty">
                <History size={21} />
                <span>{search ? t('没有找到相关会话') : t('从一段新的对话开始')}</span>
                <small>{search ? t('试试其他关键词') : t('此项目的会话会保存在这里')}</small>
              </div>
            )}
          </div>
          <div className="sidebar-bottom">
            <button onClick={() => setDialog('usage')}>
              <Gauge size={17} />
              {t('额度与用量')}
              <ChevronRight size={14} />
            </button>
            <button onClick={() => void openActions()}>
              <CommandIcon size={17} />
              {t('动作库')}
              <kbd>Ctrl K</kbd>
            </button>
            <button onClick={() => setDialog('management')}>
              <Workflow size={17} />
              {t('Grok 管理')}
              <ChevronRight size={14} />
            </button>
            <div className="sidebar-bottom-row">
              <button onClick={() => setDialog('settings')}>
                <Settings2 size={17} />
                {t('设置')}
              </button>
              <IconButton label={t('键盘快捷键')} onClick={() => setDialog('shortcuts')}>
                <CircleHelp size={17} />
              </IconButton>
            </div>
            <div className="sidebar-status">
              <span
                className={`status-dot ${connection === 'ready' ? '' : connection === 'connecting' ? 'connecting' : 'offline'}`}
              />
              {connectionLabel}
              <span>{t('本地运行')}</span>
            </div>
          </div>
        </aside>
      )}
      <main className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            {!sidebar && (
              <IconButton label={t('展开侧边栏')} onClick={() => setSidebar(true)}>
                <PanelLeftOpen size={18} />
              </IconButton>
            )}
            <FolderOpen size={15} />
            <button onClick={() => void openProject()} title={cwd}>
              {cwd ? baseName(cwd) : t('工作空间')}
            </button>
            <ChevronRight size={13} />
            <span title={currentTitle}>{currentTitle}</span>
          </div>
          <div className="topbar-actions">
            <IconButton label={t('任务中心')} onClick={() => setDialog('tasks')}>
              <Workflow size={17} />
            </IconButton>
            <IconButton
              label={t('项目工具')}
              disabled={!cwd}
              onClick={() => setDialog('project-tools')}
            >
              <Terminal size={17} />
            </IconButton>
            <span
              className={`connection-pill ${connection === 'ready' ? '' : 'offline'}`}
              title={connectionError || connectionLabel}
            >
              <span className="status-dot" />
              {connection === 'ready'
                ? t('已连接')
                : connection === 'connecting'
                  ? t('连接中')
                  : connection === 'restoring'
                    ? t('恢复会话中')
                    : t('未连接')}
            </span>
            <IconButton
              label={t('在项目终端中打开')}
              onClick={() =>
                void request('system.open', { target: 'terminal', cwd }).catch((e) =>
                  notify(errorText(e)),
                )
              }
              disabled={!cwd}
            >
              <Terminal size={17} />
            </IconButton>
            <IconButton label={t('额度与上下文')} onClick={() => setDialog('usage')}>
              <Gauge size={17} />
            </IconButton>
            {currentSummary && (
              <div className="topbar-more">
                <IconButton label={t('当前会话操作')} onClick={() => setTopbarMenu(!topbarMenu)}>
                  <Ellipsis size={18} />
                </IconButton>
                {topbarMenu && (
                  <div className="session-dropdown">
                    <button
                      onClick={() => {
                        setRename(currentSummary);
                        setRenameTitle(currentSummary.title);
                        setTopbarMenu(false);
                      }}
                    >
                      <Pencil size={14} />
                      {t('重命名')}
                    </button>
                    <button
                      onClick={() => {
                        setTopbarMenu(false);
                        void exportSession(currentSummary);
                      }}
                    >
                      <Download size={14} />
                      {t('导出会话')}
                    </button>
                    <button
                      onClick={() => {
                        setDeleteTarget(currentSummary);
                        setTopbarMenu(false);
                      }}
                      className="danger-text"
                    >
                      <Trash2 size={14} />
                      {t('删除会话')}
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="toolbar-divider" />
            <IconButton
              label={inspector ? t('收起项目上下文') : t('展开项目上下文')}
              onClick={() => setInspector(!inspector)}
              active={inspector}
            >
              {inspector ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
            </IconButton>
          </div>
        </header>
        {(connection === 'error' || connection === 'disconnected') && (
          <div className="connection-banner">
            <TriangleAlert size={16} />
            <div>
              <strong>{classifyFailure(connectionError).title}</strong>
              <span>{connectionError || t('请检查可执行文件和登录状态。')}</span>
              <span>{classifyFailure(connectionError).description}</span>
            </div>
            <button onClick={() => recover(connectionError)} disabled={initializing}>
              {initializing ? <Spinner /> : recoveryLabel(connectionError)}
            </button>
            <button onClick={() => setDialog('settings')}>{t('连接设置')}</button>
          </div>
        )}
        <div
          className="thread"
          ref={threadRef}
          onScroll={() => {
            const node = threadRef.current!;
            stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100;
            setShowScroll(!stickToBottom.current);
          }}
        >
          {!rows.length ? (
            <div className="welcome">
              <div className="welcome-orbit">
                <Brand />
                <span />
              </div>
              <div className="welcome-kicker">{t('你的想法，从这里成为现实')}</div>
              <h1>{t('一起把事情做好。')}</h1>
              <p>
                {t('理解代码、解决问题，或从零开始创造。')}
                <br />
                {t('Grok 就在你的项目里，随时准备动手。')}
              </p>
              <div className="welcome-cards">
                <button
                  onClick={() =>
                    fillDraft(t('请先阅读这个项目，说明它的结构、核心功能和推荐的运行方式。'))
                  }
                >
                  <div className="welcome-card-icon">
                    <Code2 size={20} />
                  </div>
                  <strong>{t('理解项目')}</strong>
                  <span>{t('梳理结构，快速找到入口')}</span>
                  <ArrowRight size={17} />
                </button>
                <button
                  onClick={() =>
                    fillDraft(t('请检查这个项目，找出有实际影响的问题，并说明建议的修复方案。'))
                  }
                >
                  <div className="welcome-card-icon">
                    <ShieldCheck size={20} />
                  </div>
                  <strong>{t('检查与改进')}</strong>
                  <span>{t('定位问题，让代码更可靠')}</span>
                  <ArrowRight size={17} />
                </button>
                <button
                  onClick={() =>
                    fillDraft(
                      t(
                        '我想为这个项目增加一个功能。请先了解现有结构，帮我把想法整理成可执行的方案：',
                      ),
                    )
                  }
                >
                  <div className="welcome-card-icon">
                    <Sparkles size={20} />
                  </div>
                  <strong>{t('实现一个想法')}</strong>
                  <span>{t('从需求出发，做出可用成果')}</span>
                  <ArrowRight size={17} />
                </button>
              </div>
              {!cwd ? (
                <button className="welcome-open" onClick={() => void openProject()}>
                  <FolderOpen size={16} />
                  {t('选择你的项目')}
                  <ArrowRight size={15} />
                </button>
              ) : (
                <div className="welcome-project">
                  <span className="status-dot" />
                  {t('正在 {project} 中工作', { project: baseName(cwd) })}
                  <button onClick={() => void openProject()}>{t('切换项目')}</button>
                </div>
              )}
            </div>
          ) : (
            <div className="conversation">
              {rows.map((row) => (
                <Message
                  row={row}
                  onOpenFile={openToolFile}
                  key={row.id}
                  onRetry={fillDraft}
                  notify={notify}
                />
              ))}
              {busy && (!rows.length || !rows[rows.length - 1].streaming) && (
                <div className="waiting-line">
                  <Brand small />
                  <Spinner />
                  {pending
                    ? t('正在开始任务…')
                    : cancelling
                      ? t('正在停止，请等待当前操作结束…')
                      : t('Grok 正在处理…')}
                </div>
              )}
              {turnError && (
                <div className="turn-error">
                  <TriangleAlert size={18} />
                  <div>
                    <strong>{classifyFailure(turnError).title}</strong>
                    <p>{turnError}</p>
                    <p>{classifyFailure(turnError).description}</p>
                    <button className="text-button" onClick={() => recover(turnError)}>
                      {recoveryLabel(turnError)}
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </div>
              )}
              {turnNotice && (
                <div className="turn-notice">
                  <Square size={14} />
                  <span>
                    {t(
                      {
                        cancelled: '任务已停止。你可以编辑请求后继续。',
                        refusal: 'Grok 未执行这项请求。你可以调整任务内容后重试。',
                        max_tokens: '本轮输出达到长度限制。你可以继续请求 Grok 完成余下部分。',
                        max_turn_requests: '本轮达到工具请求次数限制。你可以继续此任务。',
                      }[turnNotice] || '本轮已结束：{value0}',
                      { value0: turnNotice },
                    )}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
        {showScroll && (
          <button
            className="scroll-bottom"
            onClick={() => {
              stickToBottom.current = true;
              threadRef.current?.scrollTo({
                top: threadRef.current.scrollHeight,
                behavior: 'smooth',
              });
            }}
            title={t('回到最新消息')}
          >
            <ArrowDown size={17} />
          </button>
        )}
        <div className="composer-area">
          {background && (
            <button className="background-status" onClick={() => setDialog('management')}>
              <Workflow size={14} />
              <span>{background}</span>
              <ChevronRight size={13} />
            </button>
          )}
          <div
            className={`composer ${busy ? 'is-running' : ''} ${dragging ? 'is-dragging' : ''}`}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes('Files')) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
                setDragging(true);
              }
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
            }}
            onDrop={dropFiles}
          >
            {dragging && <div className="drop-hint">{t('松开以添加文件或图片')}</div>}
            <div className="attachment-list">
              {attachments.map((file, index) => (
                <span key={`${file.path}:${index}`} title={file.path}>
                  <button className="attachment-name" onClick={() => void inspectAttachment(file)}>
                    <AttachmentThumbnail file={file} />
                    {file.name}
                  </button>
                  <button
                    onClick={() =>
                      setAttachments((items) => items.filter((_, itemIndex) => itemIndex !== index))
                    }
                    title={t('移除 {value0}', { value0: file.name })}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            {attachments.some(
              (file) => file.kind === 'image' || /\.(png|jpe?g|gif|webp)$/i.test(file.path),
            ) && (
              <p className="attachment-hint">
                {(session?.runtime?.capabilities || bootstrap?.cli.capabilities)?.promptCapabilities
                  ?.image === true
                  ? t('图片会随消息发送给 Grok。')
                  : t('发送时会让 Grok 读取所附图片文件。')}
              </p>
            )}
            {attachments.some((file) => file.kind !== 'image') && (
              <p className="attachment-hint">{t('文档会自动选择读取方式，点击附件可预览。')}</p>
            )}
            <textarea
              ref={draftRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onPaste={(event) => void pasteImage(event)}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  event.keyCode !== 229
                ) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder={
                cwd ? t('描述你想完成的事情…') : t('选择一个项目，然后告诉 Grok 你想做什么…')
              }
              aria-label={t('发送给 Grok 的消息')}
              rows={2}
              spellCheck={false}
            />
            <div className="composer-toolbar">
              <div className="composer-tools">
                <IconButton label={t('添加文件或图片')} onClick={() => void attach()}>
                  <Paperclip size={18} />
                </IconButton>
                <IconButton label={t('打开动作库 · Ctrl K')} onClick={() => void openActions()}>
                  <CommandIcon size={17} />
                </IconButton>
                <div className="toolbar-divider" />
                <label className="model-control" title={t('选择模型')}>
                  <Zap size={14} />
                  <select
                    aria-label={t('选择模型')}
                    value={currentModelId || ''}
                    disabled={busy || configuring || !!loadingSession || connection !== 'ready'}
                    onChange={(e) => void configureSelection({ modelId: e.target.value })}
                  >
                    {!models.availableModels.length && <option value="">{t('Grok 默认')}</option>}
                    {models.availableModels.map((model) => (
                      <option key={model.modelId} value={model.modelId}>
                        {model.name || model.modelId}
                      </option>
                    ))}
                  </select>
                </label>
                {effortOptions.length > 0 && (
                  <label className="effort-control" title={t('推理深度')}>
                    <select
                      aria-label={t('推理深度')}
                      value={currentEffort}
                      disabled={busy || configuring || !!loadingSession || connection !== 'ready'}
                      onChange={(e) => void configureSelection({ effort: e.target.value })}
                    >
                      <option value="">{t('默认推理')}</option>
                      {effortOptions.map((e) => (
                        <option key={e.id} value={e.value || e.id}>
                          {{
                            low: t('轻量'),
                            medium: t('标准'),
                            high: t('深入'),
                            xhigh: t('更深入'),
                            max: t('最高'),
                            ultra: t('极致'),
                          }[e.value || e.id] || e.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {!!session?.modes?.availableModes?.length && (
                  <label className="mode-control" title={t('会话模式')}>
                    <select
                      aria-label={t('会话模式')}
                      value={session.modes.currentModeId}
                      disabled={busy || configuring || !!loadingSession || connection !== 'ready'}
                      onChange={(event) => void configureSelection({ modeId: event.target.value })}
                    >
                      {session.modes.availableModes.map((mode) => (
                        <option key={mode.id} value={mode.id}>
                          {{
                            agent: t('执行'),
                            ask: t('问答'),
                            plan: t('规划'),
                            default: t('默认模式'),
                          }[mode.id] || mode.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              {busy ? (
                <>
                  <button
                    className="secondary-button queue-send"
                    disabled={(!draft.trim() && !attachments.length) || pending}
                    onClick={() => void enqueue()}
                  >
                    {t('加入队列')}
                  </button>
                  <button
                    className="send-button stop"
                    onClick={() => void stop()}
                    disabled={pending || cancelling}
                    title={cancelling ? t('正在停止') : t('停止生成')}
                    aria-label={t('停止生成')}
                  >
                    {cancelling || pending ? <Spinner /> : <Square size={15} fill="currentColor" />}
                  </button>
                </>
              ) : (
                <button
                  className="send-button"
                  onClick={() => void send()}
                  disabled={
                    (!draft.trim() && !attachments.length) ||
                    !!loadingSession ||
                    configuring ||
                    initializing ||
                    !cwd ||
                    connection !== 'ready'
                  }
                  title={t('发送 · Enter')}
                  aria-label={t('发送消息')}
                >
                  <ArrowUp size={19} />
                </button>
              )}
            </div>
          </div>
          <div className="composer-bottom">
            <PermissionControl
              value={session?.permissionMode || settings.permissionMode}
              onChange={changePermissions}
              scope={session ? t('当前会话') : t('新会话默认权限')}
              disabled={initializing || !!loadingSession}
              openSignal={permissionMenuRequest}
            />
            <span>
              {busy ? (
                <>
                  <span className="status-dot connecting" />
                  {cancelling ? t('正在停止') : pending ? t('准备中') : t('任务进行中')}
                </>
              ) : (
                t('Enter 发送 · Shift + Enter 换行')
              )}
            </span>
            <button onClick={() => setDialog('usage')} title={t('额度与上下文')}>
              <Gauge size={13} />
              {t('上下文')}
            </button>
          </div>
        </div>
      </main>
      {inspector && (
        <Inspector
          cwd={cwd}
          plan={plan}
          revision={revision}
          tab={inspectorTab}
          onTabChange={setInspectorTab}
          openFile={fileToOpen}
          onClose={() => setInspector(false)}
          notify={notify}
          onAddContext={addContext}
          onEditorOpenChange={setEditorOpen}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <IconButton label={t('关闭提示')} onClick={() => setNotice('')}>
            <X size={15} />
          </IconButton>
        </div>
      )}
      <Suspense
        fallback={
          <div className="dialog-loading" role="status">
            <Spinner />
            {t('正在打开…')}
          </div>
        }
      >
        {dialog === 'tasks' && (
          <TaskCenter
            tasks={tasks}
            onClose={() => setDialog(null)}
            notify={notify}
            onOpen={(task) => {
              setDialog(null);
              void loadConversation(task);
            }}
          />
        )}
        {dialog === 'project-tools' && (
          <ProjectTools
            cwd={cwd}
            sessionId={session?.sessionId}
            editorOpen={editorOpen}
            onRestored={() => setRevision((value) => value + 1)}
            onClose={() => setDialog(null)}
            notify={notify}
          />
        )}
        {attachmentPreview && (
          <Modal
            title={attachmentPreview.name}
            subtitle={attachmentPreview.path || t('文本上下文')}
            onClose={() => setAttachmentPreview(null)}
          >
            {attachmentPreview.dataUrl && (
              <img
                className="attachment-image"
                src={attachmentPreview.dataUrl}
                alt={attachmentPreview.name}
              />
            )}
            {attachmentPreview.loading && (
              <p role="status">
                <Spinner /> {t('正在读取附件…')}
              </p>
            )}
            {attachmentPreview.error && <p role="alert">{attachmentPreview.error}</p>}
            {attachmentPreview.notice && (
              <p className="attachment-notice">{t('以下为发送给 Grok 的文字。')}</p>
            )}
            {attachmentPreview.native && (
              <p className="attachment-notice">
                {t('由 Grok 原生读取；发送时读取本地文件的最新内容。')}
              </p>
            )}
            {attachmentPreview.native && (
              <p className="attachment-native-description">{attachmentPreview.text}</p>
            )}
            {!attachmentPreview.loading &&
              !attachmentPreview.error &&
              !attachmentPreview.native && (
                <pre className="attachment-preview">
                  {attachmentPreview.text || attachmentPreview.path}
                </pre>
              )}
            {attachmentPreview.path && (
              <button
                className="secondary-button"
                onClick={() => {
                  void request('system.open', {
                    target: 'file',
                    path: attachmentPreview.path,
                  }).catch((e) => notify(errorText(e)));
                }}
              >
                {t('用默认程序打开原文件')}
              </button>
            )}
          </Modal>
        )}
        {dialog === 'actions' && (
          <ActionsDialog
            commands={commands}
            connected={connection === 'ready'}
            onClose={() => setDialog(null)}
            onApply={fillDraft}
            onPermissions={openPermissions}
            onContext={() => setDialog('usage')}
          />
        )}
        {dialog === 'settings' && (
          <SettingsDialog
            settings={settings}
            models={models}
            bootstrap={bootstrap}
            busy={busy}
            onClose={() => setDialog(null)}
            onSave={async (patch) => {
              await saveSettings(patch);
              notify(t('设置已保存'));
            }}
          />
        )}
        {dialog === 'management' && (
          <ManagementDialog
            cwd={cwd}
            sessionId={session?.sessionId}
            onClose={() => setDialog(null)}
            notify={notify}
          />
        )}
        {dialog === 'usage' && (
          <UsageDialog
            cwd={cwd || undefined}
            sessionId={session?.sessionId}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === 'shortcuts' && (
          <Modal
            title={t('键盘快捷键')}
            subtitle={t('常用操作，触手可及。')}
            onClose={() => setDialog(null)}
          >
            <div className="shortcut-list">
              {[
                [t('新建会话'), 'Ctrl + N'],
                [t('打开动作库'), 'Ctrl + K'],
                [t('打开设置'), 'Ctrl + ,'],
                [t('发送消息'), 'Enter'],
                [t('输入换行'), 'Shift + Enter'],
                [t('关闭弹窗'), 'Esc'],
              ].map(([label, key]) => (
                <div key={label}>
                  <span>{label}</span>
                  <kbd>{key}</kbd>
                </div>
              ))}
            </div>
          </Modal>
        )}
        {rename && (
          <Modal
            title={t('重命名会话')}
            onClose={() => {
              if (!renameBusy) setRename(null);
            }}
            footer={
              <button
                className="primary-button"
                disabled={renameBusy || !renameTitle.trim()}
                onClick={() => void renameSession()}
              >
                {renameBusy ? <Spinner /> : <Check size={15} />}
                {t('保存名称')}
              </button>
            }
          >
            <label className="field">
              {t('会话名称')}
              <input
                autoFocus
                value={renameTitle}
                onChange={(e) => setRenameTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229)
                    void renameSession();
                }}
              />
            </label>
          </Modal>
        )}
        {deleteTarget && (
          <Modal
            title={t('删除这段会话？')}
            subtitle={t('会话记录将从本地历史中移除，此操作无法撤销。')}
            onClose={() => {
              if (!deleteBusy) setDeleteTarget(null);
            }}
            footer={
              <>
                <button
                  className="secondary-button"
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleteBusy}
                >
                  {t('保留会话')}
                </button>
                <button
                  className="primary-button danger"
                  onClick={() => void deleteSession()}
                  disabled={deleteBusy}
                >
                  {deleteBusy ? <Spinner /> : <Trash2 size={15} />}
                  {t('删除会话')}
                </button>
              </>
            }
          >
            <div className="delete-preview">
              <MessageSquare size={19} />
              {deleteTarget.title}
            </div>
          </Modal>
        )}
        {permissions[0] && (
          <PermissionDialog
            key={`${permissions[0].sessionId}:${permissions[0].requestId}`}
            item={permissions[0]}
            permissionMode={
              permissions[0].sessionId === session?.sessionId ? session.permissionMode : undefined
            }
            onModeChange={
              permissions[0].sessionId === session?.sessionId
                ? (mode) => changePermissions(mode, permissions[0].sessionId)
                : undefined
            }
            onReply={async (optionId, cancelled) => {
              const id = permissions[0].requestId;
              const originSessionId = permissions[0].sessionId;
              await request('session.permission', {
                sessionId: originSessionId,
                requestId: id,
                optionId,
                cancelled,
              });
              setPermissions((items) =>
                items.filter((item) => item.requestId !== id || item.sessionId !== originSessionId),
              );
            }}
          />
        )}
      </Suspense>
    </div>
  );
}
