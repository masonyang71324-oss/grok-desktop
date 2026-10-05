import { useI18n, setLocale } from './i18n';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Globe,
  Mic,
  GitCompareArrows,
  ListChecks,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Star,
  Terminal,
  Trash2,
  TriangleAlert,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import type {
  AcpUpdate,
  AppUpdateState,
  Attachment,
  Bootstrap,
  Command,
  ConfigureResult,
  DesktopEvent,
  ModelsState,
  PermissionRequest,
  SessionSnapshot,
  SessionSummary,
  Settings,
  TaskSummary,
  Checkpoint,
} from './types';
import {
  appendUpdates,
  createFrameBuffer,
  finalizeTurn,
  fromReplay,
  type TimelineRow,
} from './timeline.mjs';
import {
  baseName,
  classifyFailure,
  describeSystemError,
  notificationText,
  errorText,
  request,
} from './lib';
import SystemErrorDetails from './SystemErrorDetails';
import './usability-integration.css';
import { Brand, IconButton, Modal, Spinner } from './components';
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
const PromptTemplates = lazy(() => import('./PromptTemplates'));
const ConversationNavigation = lazy(() => import('./ConversationNavigation'));
const ProjectFilePicker = lazy(() => import('./ProjectFilePicker'));
const OfficePreview = lazy(() => import('./OfficePreview'));
const FirstRunWizard = lazy(() => import('./FirstRunWizard'));
const ProviderSettings = lazy(() => import('./ProviderSettings'));
const TerminalPanel = lazy(() => import('./TerminalPanel'));
const WebPreview = lazy(() => import('./WebPreview'));
import type { CliInstallState } from './FirstRunWizard';
import type { PreviewOwner } from './WebPreview';
import type { ConversationTarget } from './conversation-navigation.mjs';
import { canPreviewOffice } from './office-preview-model';
import ResizeHandle from './ResizeHandle';
import './workspace-upgrades.css';
import './desktop-tools.css';
import UsageStatus from './UsageStatus';
import EffortControl from './EffortControl';
import './navigation-panels.css';
import './desktop-layout.css';
import TaskActivity from './TaskActivity';
import TaskOutcome from './TaskOutcome';
import { effortPresets } from './effort-presets.mjs';
import Inspector from './Inspector';
import PermissionControl from './PermissionControl';
import TaskCenter from './TaskCenter';
import ProjectTools from './ProjectTools';
import AttachmentThumbnail from './AttachmentThumbnail';
import ConversationTimeline, { type ConversationTimelineHandle } from './ConversationTimeline';
import ProjectAccessBar from './ProjectAccessBar';
import SessionList from './SessionList';
import EngineDialog from './EngineDialog';
import { useEngine } from './useEngine';
import './workflows.css';
import './enhancements.css';
import { createDraftStore, sameDraft, type Draft } from './drafts.mjs';
import {
  createReconnectBudget,
  deriveSessionRuntime,
  isWorkflowControl,
} from './session-runtime.mjs';

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
type Run = { sessionId: string; turnId: string; startedAt?: string };
type Permission = {
  requestId: string | number;
  params: PermissionRequest;
  sessionId: string;
};
type Dialog =
  | 'actions'
  | 'settings'
  | 'management'
  | 'usage'
  | 'shortcuts'
  | 'tasks'
  | 'project-tools'
  | 'engine'
  | 'templates'
  | 'onboarding'
  | 'providers'
  | 'terminal'
  | null;
export default function App() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<Settings>(defaults);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [recoveryWarnings, setRecoveryWarnings] = useState<
    NonNullable<Bootstrap['recoveryWarnings']>
  >([]);
  const [checkpointStorageRequested, setCheckpointStorageRequested] = useState(false);
  const [appUpdate, setAppUpdate] = useState<AppUpdateState>({
    mode: 'development',
    status: 'unsupported',
    currentVersion: '',
  });
  const [initializing, setInitializing] = useState(true);
  const [connection, setConnection] = useState('connecting');
  const [connectionError, setConnectionError] = useState('');
  const [cwd, setCwd] = useState('');
  const [projectTrusted, setProjectTrusted] = useState(true);
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
  const preparingSendRef = useRef<{
    sessionId?: string;
    cancelled: boolean;
    submitted: boolean;
  } | null>(null);
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
  const [projectMenu, setProjectMenu] = useState(false);
  const [permissionMenuRequest, setPermissionMenuRequest] = useState(0);
  const [topbarMenu, setTopbarMenu] = useState(false);
  const transitionRef = useRef(false);
  const [sidebar, setSidebar] = useState(true);
  const [navigationTab, setNavigationTab] = useState<'sessions' | 'files' | 'tasks'>('sessions');
  const inspector = navigationTab === 'files';
  function setInspector(open: boolean) {
    setNavigationTab(open ? 'files' : 'sessions');
    if (open) setSidebar(true);
  }
  const [inspectorTab, setInspectorTab] = useState<'files' | 'changes' | 'plan'>('files');
  const [sidebarWidth, setSidebarWidth] = useState(0),
    [inspectorWidth, setInspectorWidth] = useState(0),
    [composerHeight, setComposerHeight] = useState(0);
  const [viewport, setViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [conversationNavigation, setConversationNavigation] = useState(false);
  const [filePickerOwner, setFilePickerOwner] = useState<PreviewOwner | null>(null);
  const [previewOwner, setPreviewOwner] = useState<PreviewOwner | null>(null);
  const [officeLayout, setOfficeLayout] = useState(true);
  const [installState, setInstallState] = useState<CliInstallState>({ status: 'idle', log: '' });
  const [fileToOpen, setFileToOpen] = useState<{
    path: string;
    line?: number;
    requestId: number;
  }>();
  const [dragging, setDragging] = useState(false);
  const uiRestored = useRef(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [notificationTarget, setNotificationTarget] = useState<{
    session: SessionSummary;
    requestId?: string | number;
  } | null>(null);
  const [preferredPermission, setPreferredPermission] = useState<{
    sessionId: string;
    requestId?: string | number;
  } | null>(null);
  const navigationNotice = useRef('');
  const [notice, setNotice] = useState('');
  const [turnError, setTurnError] = useState('');
  const [revision, setRevision] = useState(0);
  const [resultRevision, setResultRevision] = useState(0);
  const [resultCheckpoint, setResultCheckpoint] = useState<Checkpoint | null>(null);
  const [resultLoading, setResultLoading] = useState(false);
  const [projectCheckpointTarget, setProjectCheckpointTarget] = useState<{
    id: string;
    restore: boolean;
  } | null>(null);
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
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const runtimeState = deriveSessionRuntime({ session, tasks, pending });
  const busyRef = useRef(false);
  busyRef.current = runtimeState.busy;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<ConversationTimelineHandle>(null);
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
    draftStoreRef.current = createDraftStore(
      window.localStorage,
      () => {
        if (!draftStorageError.current) {
          draftStorageError.current = true;
          notify(t('草稿暂时无法保存到本机，请保留重要内容后再关闭应用。'));
        }
      },
      () =>
        request('drafts.flush', {
          protectedPaths: draftStoreRef.current?.attachmentPaths() || [],
        }).then(() => undefined),
    );
  const composerRef = useRef({ cwd: '', sessionId: '', draftKey: 'initial' });
  const draftAliases = useRef(new Map<string, PreviewOwner>());
  const draftRestoredRef = useRef(false);
  const needsRestoreRef = useRef(false);
  const restorePromiseRef = useRef<Promise<boolean> | null>(null);
  const reconnectBudget = useRef(createReconnectBudget());
  const reconnectKey = () => sessionRef.current?.sessionId || `catalog:${cwdRef.current}`;
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
    const nextOwner = {
      cwd: targetCwd,
      sessionId,
      draftKey: same ? previous.draftKey : sessionId ? `session:${sessionId}` : crypto.randomUUID(),
    };
    composerRef.current = nextOwner;
    if (transfer && !same) draftAliases.current.set(previous.draftKey, nextOwner);
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
    const ui = {
      sidebar,
      inspector,
      inspectorTab,
      navigationTab,
    };
    // Persist each navigation transition. An earlier save may still be awaiting
    // acknowledgement when the user returns to the previously saved selection.
    void saveSettings({ ui }).catch((error) => notify(errorText(error)));
  }, [sidebar, inspector, inspectorTab, navigationTab, initializing]);
  function savePanelSize(key: 'sidebarWidth' | 'inspectorWidth' | 'composerHeight', value: number) {
    void saveSettings({ ui: { [key]: value || undefined } }).catch((error) =>
      notify(errorText(error)),
    );
  }
  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
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
      ? {
          sessionId: snapshot.sessionId,
          turnId: snapshot.runtime.turnId,
          startedAt: snapshot.runtime.startedAt,
        }
      : null;
    runRef.current = active;
    busyRef.current = deriveSessionRuntime({ session: snapshot, tasks: tasksRef.current }).busy;
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
  async function applyProject(
    project: {
      cwd: string;
      sessions: SessionSummary[];
      trusted?: boolean;
    },
    restoreLastSession = true,
  ) {
    setProjectTrusted(project.trusted !== false);
    setSettings((previous) => ({
      ...previous,
      lastProject: project.cwd,
      recentProjects: [
        project.cwd,
        ...previous.recentProjects.filter((p) => p !== project.cwd),
      ].slice(0, 12),
    }));
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
    if (
      restoreLastSession &&
      project.trusted !== false &&
      !carryInput &&
      lastSessionId &&
      history.some((item) => item.sessionId === lastSessionId)
    ) {
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
  async function initialize(refreshCatalog = false) {
    setInitializing(true);
    setConnection('connecting');
    setConnectionError('');
    try {
      const data = await request<Bootstrap>(refreshCatalog ? 'cli.refresh' : 'bootstrap');
      void request<TaskSummary[]>('tasks.list')
        .then((value) => {
          setTasks(value);
          tasksRef.current = value;
          setPermissions(value.flatMap((task) => task.permissions));
        })
        .catch(() => {});
      setBootstrap(data);
      setRecoveryWarnings(data.recoveryWarnings || []);
      setCliStatus({
        ...data.cli,
        authStatus: data.cli.authStatus || 'unknown',
        models: data.models,
      });
      void readEngineStatus();
      setAppUpdate(
        data.update || {
          mode: 'development',
          status: 'unsupported',
          currentVersion: data.version,
        },
      );
      setSettings(data.settings);
      setLocale(data.settings.language);
      settingsRef.current = data.settings;
      if (!uiRestored.current) {
        setSidebar(data.settings.ui?.sidebar !== false);
        setNavigationTab(
          data.settings.ui?.navigationTab ||
            (data.settings.ui?.inspector === true ? 'files' : 'sessions'),
        );
        setInspectorTab(data.settings.ui?.inspectorTab || 'files');
        setSidebarWidth(data.settings.ui?.sidebarWidth || 0);
        setInspectorWidth(data.settings.ui?.inspectorWidth || 0);
        setComposerHeight(data.settings.ui?.composerHeight || 0);
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
        if (!data.cli.path) setDialog('onboarding');
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
        setRows((previous) => appendUpdates(previous, items));
        for (const item of items) {
          if (item.update.sessionUpdate === 'plan') setPlan(item.update.entries || []);
          updateContextWindow(item.update);
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
      if (event.type === 'preview-captured') {
        appendFilesToDraft([event.attachment], event.owner);
        notify(t('已加入原会话草稿'));
        return;
      }
      if (event.type === 'cli-install-state') {
        setInstallState(event.state);
        return;
      }
      if (event.type === 'terminal-data' || event.type === 'terminal-exit') return;
      if (event.type === 'connection') {
        if (!event.sessionId && sessionRef.current) return;
        if (event.sessionId && event.sessionId !== sessionRef.current?.sessionId) return;
        if (event.message) updateAuthentication(event.message);
        if (event.state === 'error' || event.state === 'disconnected') {
          if (sessionRef.current) needsRestoreRef.current = true;
          reconnectBudget.current.disconnected(reconnectKey(), {
            state: event.state,
            action: classifyFailure(event.message || '').action,
          });
          setConnection(event.state);
          setConnectionError(event.message || '');
        } else if (event.state === 'ready' && needsRestoreRef.current && sessionRef.current) {
          // Transport readiness alone has not loaded the selected session.
          // Keep manual recovery available when auto recovery is off/spent.
          setConnection(restorePromiseRef.current ? 'restoring' : 'error');
        } else {
          setConnection(event.state);
          setConnectionError(event.message || '');
        }
        return;
      }
      if (event.type === 'app-update') {
        setAppUpdate(event.state);
        return;
      }
      if (event.type === 'interface-size') {
        setSettings((value) => ({
          ...value,
          ui: { ...value.ui!, zoomPercent: event.zoomPercent },
        }));
        settingsRef.current = {
          ...settingsRef.current,
          ui: { ...settingsRef.current.ui!, zoomPercent: event.zoomPercent },
        };
        if (event.error) notify(event.error);
        return;
      }
      if (event.type === 'notification-activate') {
        if (event.session)
          setNotificationTarget({ session: event.session, requestId: event.requestId });
        else notify(t('此通知对应的会话已不可用，请从会话历史中查找。'));
        return;
      }
      if (event.type === 'tasks-changed') {
        tasksRef.current = event.tasks;
        busyRef.current = deriveSessionRuntime({
          session: sessionRef.current,
          tasks: event.tasks,
          pending: !!preparingSendRef.current,
        }).busy;
        setTasks(event.tasks);
        setPermissions(event.tasks.flatMap((task) => task.permissions));
        return;
      }
      if (
        event.type === 'runner-changed' ||
        event.type === 'runner-output' ||
        event.type === 'attachment-authorization-changed'
      )
        return;
      if (event.type === 'project-access') {
        if (event.cwd === cwdRef.current) setProjectTrusted(event.trusted);
        return;
      }
      if (event.type === 'checkpoint-storage-request') {
        setCheckpointStorageRequested(true);
        setDialog('project-tools');
        return;
      }
      if (event.type === 'checkpoints-changed') {
        if (
          event.cwd === cwdRef.current &&
          (!event.sessionId || event.sessionId === sessionRef.current?.sessionId)
        )
          setResultRevision((value) => value + 1);
        return;
      }
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
        if (
          (!event.sessionId && !sessionRef.current) ||
          event.sessionId === sessionRef.current?.sessionId
        )
          setCommands(event.commands);
        return;
      }
      if (event.type === 'models') {
        if (
          (!event.sessionId && !sessionRef.current) ||
          event.sessionId === sessionRef.current?.sessionId
        ) {
          modelsRef.current = event.models;
          setModels(event.models);
          const current = sessionRef.current;
          if (current) {
            const model = event.models.availableModels.find(
              (item) => item.modelId === event.models.currentModelId,
            );
            const next = {
              ...current,
              models: event.models,
              ...(typeof model?._meta?.contextWindow === 'number'
                ? { contextWindow: model._meta.contextWindow }
                : {}),
            };
            sessionRef.current = next;
            setSession(next);
          }
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
        if (event.kind === 'model_changed' && event.sessionId === sessionRef.current?.sessionId) {
          updateContextWindow(event.payload);
        }
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
        const next = {
          sessionId: event.sessionId,
          turnId: event.turnId,
          startedAt: event.startedAt,
        };
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
        if (event.type === 'turn-error') {
          setTurnError(event.message);
          updateAuthentication(event.message);
        }
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
      area.style.height = `${composerHeight ? Math.min(composerHeight, Math.max(90, viewport.height * 0.36)) : Math.min(190, Math.max(52, area.scrollHeight))}px`;
    }
  }, [draft, composerHeight, viewport.height]);
  async function saveSettings(
    patch: Partial<Omit<Settings, 'ui'>> & { ui?: Partial<NonNullable<Settings['ui']>> },
  ) {
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
    if (transitionRef.current) return;
    if (pending || (editorOpen && summary.cwd !== cwdRef.current)) {
      notify(t('请先完成当前操作并关闭文件编辑器。'));
      return;
    }
    if (summary.sessionId === sessionRef.current?.sessionId) {
      if (needsRestoreRef.current) {
        reconnectBudget.current.rearm(reconnectKey());
        await restoreSession();
      }
      return;
    }
    transitionRef.current = true;
    setLoadingSession(summary.sessionId);
    try {
      const targetCwd = summary.cwd || cwdRef.current;
      if (targetCwd !== cwdRef.current) {
        const project = await request<{
          cwd: string;
          sessions: SessionSummary[];
          trusted?: boolean;
        }>('project.open', { cwd: targetCwd });
        await applyProject(project, false);
      }
      const snapshot = await request<SessionSnapshot>('session.load', {
        cwd: targetCwd,
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
  useEffect(() => {
    if (
      !notificationTarget ||
      initializing ||
      loadingSession ||
      pending ||
      configuring ||
      transitionRef.current
    )
      return;
    const { session: target, requestId } = notificationTarget;
    if (editorOpen && target.cwd !== cwdRef.current) {
      if (navigationNotice.current !== target.sessionId) {
        navigationNotice.current = target.sessionId;
        notify(t('请先保存并关闭文件编辑器，随后会打开通知对应的会话。'));
      }
      return;
    }
    navigationNotice.current = '';
    setNotificationTarget(null);
    setDialog(null);
    void loadConversation(target).then(() => {
      if (sessionRef.current?.sessionId === target.sessionId)
        setPreferredPermission({ sessionId: target.sessionId, requestId });
    });
  }, [
    notificationTarget,
    initializing,
    loadingSession,
    pending,
    configuring,
    editorOpen,
    cwd,
    session?.sessionId,
    connection,
  ]);
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
  function updateContextWindow(payload: Record<string, any> | undefined) {
    const current = sessionRef.current;
    const value =
      payload?.context_window_selection ?? payload?.contextWindow ?? payload?._meta?.contextWindow;
    if (!current || typeof value !== 'number') return;
    const next = { ...current, contextWindow: value };
    sessionRef.current = next;
    setSession(next);
  }
  async function configureSelection(patch: {
    modelId?: string;
    effort?: string;
    modeId?: string;
    contextWindow?: number;
  }) {
    if (busyRef.current || transitionRef.current) return;
    if (needsRestoreRef.current && !(await restoreSession())) return;
    transitionRef.current = true;
    setConfiguring(true);
    try {
      if (sessionRef.current) {
        const result = await request<ConfigureResult>('session.configure', {
          sessionId: sessionRef.current.sessionId,
          ...patch,
        });
        modelsRef.current = result.models;
        setModels(result.models);
        if (sessionRef.current) {
          const next = { ...sessionRef.current, ...result };
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
    }
  }
  async function send() {
    if (!projectTrusted) {
      notify(t('请先点击项目的“只看文件”，信任后再发送任务。'));
      return;
    }
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
      !!preparingSendRef.current ||
      (busyRef.current &&
        !isWorkflowControl({
          runtime: deriveSessionRuntime({ session: sessionRef.current, tasks: tasksRef.current })
            .runtime,
          text,
          attachments: submitted.attachments,
          commands: sessionRef.current?.commands,
        })) ||
      transitionRef.current ||
      loadingSession
    )
      return;
    reconnectBudget.current.rearm(reconnectKey());
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
    const targetCwd = cwdRef.current;
    const preparation = { sessionId: target?.sessionId, cancelled: false, submitted: false };
    preparingSendRef.current = preparation;
    let userRowId = '';
    const files = [...submitted.attachments];
    try {
      if (!target) {
        target = await request<SessionSnapshot>('session.new', {
          cwd: targetCwd,
          ...preferences(true),
        });
        applySnapshot(target, true);
        busyRef.current = true;
        setPending(true);
      }
      preparation.sessionId = target.sessionId;
      if (preparation.cancelled) throw new Error(t('已取消发送。'));
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
      preparation.submitted = true;
      const result = await request<{ turnId?: string; queueId?: string }>('session.send', {
        cwd: targetCwd,
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
      setCancelling(false);
      if (userRowId) setRows((previous) => previous.filter((row) => row.id !== userRowId));
      setTurnError(errorText(e));
      updateAuthentication(errorText(e));
      notify(errorText(e));
      persistDraft();
    } finally {
      if (preparingSendRef.current === preparation) preparingSendRef.current = null;
    }
  }
  async function stop() {
    const preparation = preparingSendRef.current;
    const state = deriveSessionRuntime({
      session: sessionRef.current,
      tasks: tasksRef.current,
      pending: !!preparation,
    });
    if (!state.canStop || preparation?.cancelled) return;
    if (preparation) preparation.cancelled = true;
    setCancelling(true);
    try {
      const sessionId =
        (['running', 'starting', 'waiting'].includes(state.runtime?.status || '')
          ? sessionRef.current?.sessionId
          : undefined) || (preparation?.submitted ? preparation.sessionId : undefined);
      if (sessionId) await request('session.cancel', { sessionId });
    } catch (e) {
      notify(errorText(e));
    } finally {
      setCancelling(false);
    }
  }
  async function inspectTaskChanges(task: TaskSummary) {
    await loadConversation(task);
    if (sessionRef.current?.sessionId !== task.sessionId || cwdRef.current !== task.cwd) return;
    setDialog(null);
    setInspectorTab('changes');
    setInspector(true);
  }
  function recover(error: string) {
    const action = classifyFailure(error).action;
    if (action === 'usage') setDialog('usage');
    else if (action === 'settings') setDialog('settings');
    else if (action === 'login')
      void request('system.open', { target: 'grok-login', cwd: cwdRef.current }).catch((e) =>
        notify(errorText(e)),
      );
    else if (action === 'reconnect') {
      reconnectBudget.current.rearm(reconnectKey());
      if (sessionRef.current) {
        needsRestoreRef.current = true;
        void restoreSession();
      } else void initialize(false);
    } else {
      const last = [...rows].reverse().find((row) => row.kind === 'user');
      if (last && !draftValueRef.current.trim() && !attachmentRef.current.length)
        fillDraft(last.text, last.attachments || []);
      else draftRef.current?.focus();
    }
  }
  function updateAuthentication(error: string) {
    if (classifyFailure(error).action === 'login')
      setCliStatus((previous) => (previous ? { ...previous, authStatus: 'required' } : previous));
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
    if (initializing || loadingSession) {
      notify(t('正在准备会话，请稍后添加附件。'));
      return;
    }
    const owner = { ...composerRef.current };
    try {
      const selected = await request<Attachment[]>('dialog.attach');
      appendFilesToDraft(selected, owner);
    } catch (e) {
      notify(errorText(e));
    }
  }
  async function enqueue() {
    const submitted = currentDraft();
    const target = sessionRef.current;
    if (
      !target ||
      (!submitted.text.trim() && !submitted.attachments.length) ||
      !runtimeState.canQueue
    )
      return;
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
  function appendFilesToDraft(files: Attachment[], origin: PreviewOwner) {
    const owner = draftAliases.current.get(origin.draftKey) || origin;
    const current = composerRef.current;
    const active = current.cwd === owner.cwd && current.sessionId === (owner.sessionId || '');
    const draft = active
      ? currentDraft()
      : draftStoreRef.current!.read(owner.cwd, owner.sessionId || '');
    const merged = {
      ...draft,
      attachments: [
        ...draft.attachments,
        ...files.filter(
          (file) =>
            !draft.attachments.some(
              (previous) => previous.path === file.path && previous.text === file.text,
            ),
        ),
      ],
    };
    if (active) replaceDraft(merged);
    draftStoreRef.current!.save(owner.cwd, owner.sessionId || '', merged);
  }
  const contextOwner = { ...composerRef.current };
  function addContext(file: Attachment) {
    appendFilesToDraft([file], contextOwner);
    notify(t('已加入上下文'));
  }
  async function inspectAttachment(file: Attachment) {
    setOfficeLayout(true);
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
    if (initializing || loadingSession) {
      notify(t('正在准备会话，请稍后添加附件。'));
      return;
    }
    const owner = { ...composerRef.current };
    try {
      const file = await request<Attachment | null>('clipboard.image');
      if (file) appendFilesToDraft([file], owner);
    } catch (e) {
      notify(errorText(e));
    }
  }
  const navigateConversation = useCallback(async (target: ConversationTarget) => {
    stickToBottom.current = false;
    setShowScroll(true);
    const root = threadRef.current;
    const node =
      target.kind === 'error'
        ? root?.querySelector<HTMLElement>('[data-conversation-error]')
        : await timelineRef.current?.scrollToRow(target.rowId);
    if (!node) return;
    for (const details of node.querySelectorAll('details')) details.open = true;
    let ancestor: HTMLElement | null = node;
    while (ancestor && ancestor !== root) {
      if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
      ancestor = ancestor.parentElement;
    }
    node.scrollIntoView({ block: 'center' });
    node.classList.add('conversation-jump');
    setTimeout(() => node.classList.remove('conversation-jump'), 1800);
  }, []);
  async function openWebPreview() {
    if (!sessionRef.current) await newConversation();
    if (sessionRef.current) setPreviewOwner({ ...composerRef.current });
  }
  async function dictate() {
    draftRef.current?.focus();
    try {
      await request('dictation.start');
      notify(t('语音由 Windows 控制。如未出现听写框，请保持输入框聚焦并按 Win + H。'));
    } catch (error) {
      notify(errorText(error));
    }
  }
  async function dropFiles(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (initializing || loadingSession) {
      notify(t('正在准备会话，请稍后添加附件。'));
      return;
    }
    const owner = { ...composerRef.current };
    try {
      const selected = await window.desktop.resolveDrop(Array.from(event.dataTransfer.files));
      if (selected.projectPath) await openProject(selected.projectPath);
      else appendFilesToDraft(selected.files, owner);
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
  const selectedPermission =
    permissions.find(
      (item) =>
        item.sessionId === preferredPermission?.sessionId &&
        (preferredPermission.requestId === undefined ||
          item.requestId === preferredPermission.requestId),
    ) || permissions[0];
  const draftSessionIds = new Set(
    sessions
      .filter((item) =>
        item.sessionId === session?.sessionId
          ? !!(draft || attachments.length)
          : draftStoreRef.current!.hasDraft(item.cwd || cwd, item.sessionId),
      )
      .map((item) => item.sessionId),
  );
  const currentModelId = session
    ? models.currentModelId
    : models.availableModels.some((model) => model.modelId === settings.modelId)
      ? settings.modelId
      : models.currentModelId;
  const selectedModel = models.availableModels.find((model) => model.modelId === currentModelId);
  const effortOptions = selectedModel?._meta?.reasoningEfforts || [];
  const selectedEffort = session
    ? selectedModel?._meta?.reasoningEffort || ''
    : settings.effort || '';
  const defaultEffort = effortOptions.find((option) => option.default);
  const currentEffort = effortOptions.some(
    (option) => (option.value || option.id) === selectedEffort,
  )
    ? selectedEffort
    : defaultEffort?.value || defaultEffort?.id || '';
  const contextWindows = selectedModel?._meta?.contextWindows || [];
  const selectedContextWindow =
    session?.contextWindow ??
    selectedModel?._meta?.contextWindow ??
    selectedModel?._meta?.totalContextTokens;
  const currentContextWindow = contextWindows.includes(selectedContextWindow || 0)
    ? selectedContextWindow
    : '';
  const currentTitle =
    sessions.find((item) => item.sessionId === session?.sessionId)?.title || t('新会话');
  const busy = runtimeState.busy;
  const currentRuntime = runtimeState.runtime;
  const backgroundTask = currentRuntime?.status === 'background';
  const taskActive = busy;
  const taskCancelling = runtimeState.cancelling || cancelling;
  const workflowControl =
    !pending && isWorkflowControl({ runtime: currentRuntime, text: draft, attachments, commands });
  const latestResult = currentRuntime?.lastTurn;
  const showOutcome =
    !taskActive &&
    latestResult &&
    !(currentRuntime?.status === 'interrupted' && latestResult.status === 'completed');
  const presets = effortPresets(selectedModel);
  const outcomeRows = useMemo(
    () => (latestResult ? rows.filter((row) => row.turnId === latestResult.turnId) : []),
    [rows, latestResult?.turnId],
  );
  const openUsage = useCallback(() => setDialog('usage'), []);
  useEffect(() => {
    if (stickToBottom.current && threadRef.current)
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [latestResult?.turnId, latestResult?.finishedAt, resultLoading]);
  useEffect(() => {
    let active = true;
    setResultCheckpoint(null);
    setResultLoading(false);
    if (!latestResult?.checkpointId) return;
    setResultLoading(true);
    void request<Checkpoint>('checkpoints.detail', { id: latestResult.checkpointId })
      .then((value) => {
        if (active) setResultCheckpoint(value);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setResultLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session?.sessionId, cwd, latestResult?.turnId, latestResult?.checkpointId, resultRevision]);
  function openOutcome(restore = false) {
    if (!latestResult?.checkpointId) return;
    if (restore && editorOpen) {
      notify(t('请先保存并关闭文件编辑器，再恢复文件。'));
      return;
    }
    setProjectCheckpointTarget({ id: latestResult.checkpointId, restore });
    setDialog('project-tools');
  }
  const engineBusy =
    busy ||
    tasks.some(
      (task) =>
        ['running', 'waiting', 'starting', 'cancelling'].includes(task.status) ||
        !!task.turnId ||
        task.queued.length > 0 ||
        task.permissions.length > 0,
    );
  const {
    cliStatus,
    setCliStatus,
    engineAction,
    engineError,
    engineAuthStatus,
    engineAuthLabel,
    readEngineStatus,
    runEngineAction,
  } = useEngine({
    getCwd: () => cwdRef.current,
    isUpdateBlocked: () => engineBusy || transitionRef.current,
    hasSession: () => !!sessionRef.current,
    onUpdated: initialize,
    notify,
    onRefresh: (data) => {
      setBootstrap(data);
      if (!sessionRef.current) {
        modelsRef.current = data.models;
        setModels(data.models);
        setCommands(data.commands);
        setConnection(data.cli.connected ? 'ready' : 'error');
        setConnectionError(data.cli.error || '');
      }
    },
  });
  useEffect(() => {
    if (!['error', 'disconnected', 'restoring'].includes(connection)) return;
    const attempted = reconnectBudget.current.take(reconnectKey(), {
      enabled: settings.autoReconnect !== false,
      trusted: projectTrusted && cliStatus?.authStatus !== 'required',
      blocked:
        initializing ||
        deleteBusy ||
        pending ||
        configuring ||
        !!loadingSession ||
        transitionRef.current ||
        !!restorePromiseRef.current ||
        busyRef.current ||
        runtimeState.busy,
    });
    if (!attempted) return;
    if (sessionRef.current) void restoreSession();
    else void initialize(false);
  }, [
    connection,
    connectionError,
    settings.autoReconnect,
    projectTrusted,
    cliStatus?.authStatus,
    initializing,
    deleteBusy,
    pending,
    configuring,
    loadingSession,
    tasks,
    session?.sessionId,
  ]);
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
  const homeUpdateStatus =
    appUpdate.status === 'checking'
      ? t('检查中')
      : appUpdate.status === 'available'
        ? t('可更新至 {version}', { version: appUpdate.availableVersion || '' })
        : appUpdate.status === 'downloading'
          ? t('下载中 {percent}%', { percent: Math.round(appUpdate.percent || 0) })
          : appUpdate.status === 'downloaded'
            ? t('更新已就绪')
            : appUpdate.status === 'staged'
              ? t('新版本正在分批推送，轮到此设备时即可更新。')
              : appUpdate.status === 'current'
                ? t('已是最新')
                : appUpdate.status === 'error'
                  ? t('检查失败')
                  : appUpdate.status === 'unsupported'
                    ? t('开发模式')
                    : t('检查更新');
  async function runUpdateAction(command: 'update.check' | 'update.download' | 'update.install') {
    const next = await request<AppUpdateState>(command);
    setAppUpdate(next);
  }
  return (
    <div
      className={`app unified-layout ${sidebar ? '' : 'sidebar-hidden'} ${inspector ? '' : 'inspector-hidden'}`}
      style={
        {
          '--navigation-width': `${Math.min(inspector ? inspectorWidth || Math.max(224, Math.min(310, viewport.width * 0.195)) : sidebarWidth || Math.max(224, Math.min(310, viewport.width * 0.195)), Math.max(200, viewport.width - 600))}px`,
        } as React.CSSProperties
      }
    >
      <aside className="sidebar" hidden={!sidebar}>
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
        <div className="navigation-tabs" role="tablist" aria-label={t('工作区导航')}>
          {(
            [
              { id: 'sessions', label: '会话', icon: <MessageSquare size={17} /> },
              { id: 'files', label: '文件', icon: <FolderOpen size={17} /> },
              { id: 'tasks', label: '任务', icon: <ListChecks size={17} /> },
            ] as const
          ).map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`navigation-${item.id}`}
              aria-controls={`panel-${item.id}`}
              aria-selected={navigationTab === item.id}
              tabIndex={navigationTab === item.id ? 0 : -1}
              onClick={() => setNavigationTab(item.id)}
              onKeyDown={(event) => {
                const keys = ['sessions', 'files', 'tasks'] as const;
                const next =
                  event.key === 'ArrowRight'
                    ? (index + 1) % 3
                    : event.key === 'ArrowLeft'
                      ? (index + 2) % 3
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? 2
                          : null;
                if (next !== null) {
                  event.preventDefault();
                  setNavigationTab(keys[next]);
                  document.getElementById(`navigation-${keys[next]}`)?.focus();
                }
              }}
            >
              {item.icon}
              <span>{t(item.label)}</span>
              {item.id === 'tasks' && tasks.some((task) => task.permissions.length > 0) && (
                <span className="navigation-attention" aria-label={t('等待审批')} />
              )}
            </button>
          ))}
        </div>
        <div className="project-switcher">
          <div className="section-label">
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
        <div className="sidebar-panels">
          <section
            id="panel-sessions"
            className="navigation-panel session-panel"
            role="tabpanel"
            aria-labelledby="navigation-sessions"
            hidden={navigationTab !== 'sessions'}
          >
            <SessionList
              key={cwd}
              sessions={sessions}
              tasks={tasks}
              draftSessionIds={draftSessionIds}
              activeSessionId={session?.sessionId}
              loadingSessionId={loadingSession}
              onSelect={(summary) => void loadConversation(summary)}
              onRename={(summary) => {
                setRename(summary);
                setRenameTitle(summary.title);
              }}
              onExport={(summary) => void exportSession(summary)}
              onDelete={setDeleteTarget}
            />
          </section>
          <section
            id="panel-files"
            className="navigation-panel"
            role="tabpanel"
            aria-labelledby="navigation-files"
            hidden={navigationTab !== 'files'}
          >
            <Inspector
              embedded
              visible={sidebar && navigationTab === 'files'}
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
          </section>
          <section
            id="panel-tasks"
            className="navigation-panel"
            role="tabpanel"
            aria-labelledby="navigation-tasks"
            hidden={navigationTab !== 'tasks'}
          >
            <TaskCenter
              embedded
              onInspectChanges={(task) => void inspectTaskChanges(task)}
              tasks={tasks}
              notify={notify}
              onClose={() => setNavigationTab('sessions')}
              onOpen={(task) => {
                setNavigationTab('sessions');
                void loadConversation(task);
              }}
            />
          </section>
        </div>
        <div className="sidebar-bottom">
          <button disabled={!cwd} onClick={() => setDialog('project-tools')}>
            <Terminal size={17} />
            {t('项目工具')}
            <ChevronRight size={14} />
          </button>
          <button onClick={() => void openActions()}>
            <CommandIcon size={17} />
            {t('动作库')}
            <kbd>Ctrl K</kbd>
          </button>
          <button onClick={() => setDialog('templates')}>
            <Star size={17} />
            {t('常用任务')}
            <ChevronRight size={14} />
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
        </div>
        <ResizeHandle
          axis="horizontal"
          label={t('调整侧栏宽度')}
          value={
            inspector
              ? inspectorWidth || Math.min(310, viewport.width * 0.195)
              : sidebarWidth || Math.min(310, viewport.width * 0.195)
          }
          min={200}
          max={Math.min(480, viewport.width - 600)}
          onChange={inspector ? setInspectorWidth : setSidebarWidth}
          onCommit={(value) => savePanelSize(inspector ? 'inspectorWidth' : 'sidebarWidth', value)}
          onReset={() => {
            if (inspector) setInspectorWidth(0);
            else setSidebarWidth(0);
            savePanelSize(inspector ? 'inspectorWidth' : 'sidebarWidth', 0);
          }}
        />
      </aside>
      <main className="workspace">
        {recoveryWarnings.length > 0 && (
          <section className="recovery-banner" role="alert">
            <div>
              <strong>{t('本机数据恢复提醒')}</strong>
              {recoveryWarnings.map((warning, index) => (
                <div key={index}>
                  <p>
                    {t(
                      warning.kind === 'settings'
                        ? '设置文件无法读取，已使用默认设置。'
                        : '任务队列文件无法读取，原任务没有自动重新发送。',
                    )}
                  </p>
                  <p>
                    {t(
                      warning.recoveryFailed
                        ? '原文件无法备份，相关保存已暂停，请先保留原文件。'
                        : '原文件已另存为备份，可以保留后进一步恢复。',
                    )}
                  </p>
                  <button
                    className="text-button"
                    onClick={() =>
                      void request('system.open', {
                        target: 'data',
                      }).catch((error) => notify(errorText(error)))
                    }
                  >
                    {t('打开数据目录')}
                  </button>
                </div>
              ))}
            </div>
            <button className="text-button" onClick={() => setRecoveryWarnings([])}>
              {t('知道了')}
            </button>
          </section>
        )}
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
            {cwd && (
              <ProjectAccessBar
                cwd={cwd}
                trusted={projectTrusted}
                onChange={async () => {
                  const result = await request<{
                    cwd: string;
                    trusted: boolean;
                    cancelled?: boolean;
                  }>('project.trust', { cwd });
                  if (result.cancelled) return;
                  setProjectTrusted(result.trusted);
                  if (result.trusted) await openProject(result.cwd);
                  else {
                    setInspector(true);
                    setInspectorTab('files');
                  }
                }}
                notify={notify}
              />
            )}
            <IconButton
              label={t('搜索与提问目录')}
              active={conversationNavigation}
              onClick={() => setConversationNavigation((value) => !value)}
              disabled={!rows.length}
            >
              <Search size={17} />
            </IconButton>
            <IconButton label={t('任务中心')} onClick={() => setDialog('tasks')}>
              <Workflow size={17} />
            </IconButton>
            <button
              className="header-action"
              onClick={() => {
                setInspector(true);
                setInspectorTab('changes');
              }}
              disabled={!cwd}
            >
              <GitCompareArrows size={17} />
              {t('查看变更')}
            </button>
            <button
              className="header-action"
              onClick={() => {
                setInspector(true);
                setInspectorTab('plan');
              }}
            >
              <ListChecks size={17} />
              {t('计划')}
            </button>
            <IconButton label={t('交互终端')} onClick={() => setDialog('terminal')} disabled={!cwd}>
              <Terminal size={17} />
            </IconButton>
            <IconButton
              label={t('网页预览')}
              onClick={() => void openWebPreview()}
              disabled={!cwd || !!loadingSession}
            >
              <Globe size={17} />
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
              label={inspector && sidebar ? t('收起项目上下文') : t('展开项目上下文')}
              onClick={() => setInspector(!(inspector && sidebar))}
              active={inspector && sidebar}
            >
              {inspector && sidebar ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
            </IconButton>
          </div>
        </header>
        {conversationNavigation && (
          <Suspense fallback={<Spinner />}>
            <ConversationNavigation
              sessionId={session?.sessionId || cwd}
              rows={rows}
              turnError={turnError}
              onNavigate={navigateConversation}
            />
          </Suspense>
        )}
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
        {(['available', 'downloading', 'downloaded'] as string[]).includes(appUpdate.status) && (
          <div className="app-update-banner">
            <Download size={16} />
            <div>
              <strong>
                {appUpdate.status === 'downloaded'
                  ? t('新版本已准备好')
                  : appUpdate.status === 'downloading'
                    ? t('正在下载 Grok Desktop {version}', {
                        version: appUpdate.availableVersion || '',
                      })
                    : t('Grok Desktop {version} 可以更新', {
                        version: appUpdate.availableVersion || '',
                      })}
              </strong>
              <span>
                {appUpdate.status === 'downloaded'
                  ? t('更新已下载，重启后自动完成安装。')
                  : appUpdate.status === 'downloading'
                    ? t('下载进度 {percent}%', { percent: Math.round(appUpdate.percent || 0) })
                    : appUpdate.mode === 'portable'
                      ? t('便携版需要从官方下载页获取新版本。')
                      : t('可以继续使用，下载完成后再选择何时重启。')}
              </span>
              {appUpdate.status === 'downloading' && (
                <span className="app-update-progress" aria-hidden="true">
                  <i style={{ width: `${Math.max(0, Math.min(100, appUpdate.percent || 0))}%` }} />
                </span>
              )}
            </div>
            <button
              className="primary-button"
              disabled={
                appUpdate.status === 'downloading' || (appUpdate.status === 'downloaded' && busy)
              }
              onClick={() =>
                void runUpdateAction(
                  appUpdate.status === 'downloaded' ? 'update.install' : 'update.download',
                ).catch(() => notify(t('更新操作失败，请稍后重试。')))
              }
            >
              {appUpdate.status === 'downloaded'
                ? busy
                  ? t('等待任务结束')
                  : t('重启并安装')
                : appUpdate.status === 'downloading'
                  ? t('正在下载…')
                  : appUpdate.mode === 'portable'
                    ? t('打开下载页')
                    : t('下载更新')}
            </button>
            <button className="text-button" onClick={() => setDialog('settings')}>
              {t('查看详情')}
            </button>
          </div>
        )}
        <div className="thread-viewport">
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
                <ConversationTimeline
                  ref={timelineRef}
                  key={session?.sessionId || cwd}
                  rows={rows}
                  scrollRef={threadRef}
                  activeTurnId={run?.turnId}
                  onOpenFile={openToolFile}
                  onRetry={fillDraft}
                  notify={notify}
                />
                {turnError && (
                  <div className="turn-error" data-conversation-error>
                    <TriangleAlert size={18} />
                    <div>
                      <strong>{classifyFailure(turnError).title}</strong>
                      {!describeSystemError(turnError) && <p>{turnError}</p>}
                      <p>{classifyFailure(turnError).description}</p>
                      {describeSystemError(turnError) && (
                        <SystemErrorDetails error={turnError} showExplanation={false} />
                      )}
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
            {showOutcome && latestResult && (
              <div className="task-result-container">
                <TaskOutcome
                  result={latestResult}
                  rows={outcomeRows}
                  checkpoint={resultCheckpoint}
                  loading={resultLoading}
                  onReview={() => openOutcome()}
                  onRestore={() => openOutcome(true)}
                  onOpenFile={(path) => {
                    setInspector(true);
                    setInspectorTab('files');
                    setFileToOpen({ path, requestId: Date.now() });
                  }}
                />
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
        </div>
        <div className="composer-area">
          {taskActive && (
            <TaskActivity
              rows={rows}
              turnId={currentRuntime?.turnId || run?.turnId}
              startedAt={currentRuntime?.startedAt || run?.startedAt}
              pending={pending}
              cancelling={taskCancelling}
              background={backgroundTask}
              finishing={currentRuntime?.finishing && !backgroundTask}
              waitingApproval={permissions.some((item) => item.sessionId === session?.sessionId)}
            />
          )}
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
            {dragging && <div className="drop-hint">{t('松开以添加附件或打开项目文件夹')}</div>}
            <ResizeHandle
              axis="vertical"
              reverse
              label={t('调整输入区高度')}
              value={composerHeight || draftRef.current?.clientHeight || 90}
              min={90}
              max={Math.min(360, Math.max(90, viewport.height * 0.36))}
              onChange={setComposerHeight}
              onCommit={(value) => savePanelSize('composerHeight', value)}
              onReset={() => {
                setComposerHeight(0);
                savePanelSize('composerHeight', 0);
              }}
            />
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
              disabled={initializing || !!loadingSession}
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
                <IconButton
                  label={t('添加文件或图片')}
                  onClick={() => void attach()}
                  disabled={initializing || !!loadingSession}
                >
                  <Paperclip size={18} />
                </IconButton>
                <IconButton
                  label={t('引用项目文件')}
                  onClick={() => setFilePickerOwner({ ...composerRef.current })}
                  disabled={!cwd}
                >
                  <FolderOpen size={17} />
                </IconButton>
                <IconButton label={t('Windows 语音输入')} onClick={() => void dictate()}>
                  <Mic size={17} />
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
                  <EffortControl
                    options={effortOptions}
                    value={currentEffort}
                    presets={presets}
                    disabled={busy || configuring || !!loadingSession || connection !== 'ready'}
                    onChange={(effort) => void configureSelection({ effort })}
                  />
                )}
                {!!session && contextWindows.length > 1 && (
                  <label className="context-control" title={t('上下文窗口')}>
                    <select
                      aria-label={t('上下文窗口')}
                      value={currentContextWindow}
                      disabled={busy || configuring || !!loadingSession || connection !== 'ready'}
                      onChange={(event) =>
                        void configureSelection({ contextWindow: Number(event.target.value) })
                      }
                    >
                      {!currentContextWindow && <option value="">{t('默认上下文')}</option>}
                      {contextWindows.map((tokens) => (
                        <option key={tokens} value={tokens}>
                          {Math.round(tokens / 1000)}K
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
              {busy && !workflowControl ? (
                <>
                  <button
                    className="secondary-button queue-send"
                    disabled={(!draft.trim() && !attachments.length) || !runtimeState.canQueue}
                    onClick={() => void enqueue()}
                  >
                    {t('加入队列')}
                  </button>
                  <button
                    className="send-button stop"
                    onClick={() => void stop()}
                    disabled={!runtimeState.canStop || taskCancelling}
                    title={taskCancelling ? t('正在停止') : t('停止生成')}
                    aria-label={t('停止生成')}
                  >
                    {taskCancelling || pending ? (
                      <Spinner />
                    ) : (
                      <Square size={15} fill="currentColor" />
                    )}
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
                    !projectTrusted ||
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
                  {taskCancelling ? t('正在停止') : pending ? t('准备中') : t('任务进行中')}
                </>
              ) : (
                t('Enter 发送 · Shift + Enter 换行')
              )}
            </span>
            <button
              className="queue-control"
              onClick={() => setDialog('tasks')}
              title={t('任务中心')}
            >
              <ListChecks size={15} />
              {t('任务队列')}
              <span>({tasks.reduce((count, task) => count + task.queued.length, 0)})</span>
            </button>
          </div>
        </div>
      </main>
      <footer className="desktop-status-bar" aria-label={t('工作区状态')}>
        <div className="sidebar-status">
          <span
            className={`status-dot ${connection === 'ready' ? '' : connection === 'connecting' ? 'connecting' : 'offline'}`}
          />
          {connectionLabel}
          <span>{t('本地运行')}</span>
        </div>
        <div className="home-version-bar">
          {appUpdate.currentVersion && (
            <button
              type="button"
              className={`home-update-status ${appUpdate.status}`}
              title={t('点击检查 Grok Desktop 更新')}
              disabled={appUpdate.status === 'checking'}
              onClick={() => {
                if (
                  ['available', 'downloading', 'downloaded', 'unsupported'].includes(
                    appUpdate.status,
                  )
                ) {
                  setDialog('settings');
                  return;
                }
                void runUpdateAction('update.check').catch(() =>
                  notify(t('更新操作失败，请稍后重试。')),
                );
              }}
            >
              <span className="home-update-product">Grok Desktop</span>
              <strong>v{appUpdate.currentVersion}</strong>
              <span className="home-update-separator" aria-hidden="true">
                ·
              </span>
              <span className="home-update-copy">{homeUpdateStatus}</span>
            </button>
          )}
          <button
            type="button"
            className={`home-engine-status ${engineAuthStatus}`}
            aria-label={t('Grok Build 引擎详情')}
            aria-haspopup="dialog"
            aria-expanded={dialog === 'engine'}
            onClick={() => setDialog('engine')}
          >
            <span>Grok Build</span>
            <strong>{cliStatus?.version ? `v${cliStatus.version}` : t('版本未知')}</strong>
            <span aria-hidden="true">·</span>
            <span>{engineAuthLabel}</span>
            <ChevronDown size={12} />
          </button>
          <IconButton
            label={t('刷新引擎与模型')}
            disabled={!!engineAction || initializing}
            onClick={() => void runEngineAction('refresh')}
          >
            <RefreshCw size={14} />
          </IconButton>
        </div>
        <div className="home-resource-bar">
          <UsageStatus
            compact
            cwd={cwd || undefined}
            sessionId={session?.sessionId}
            revision={revision}
            connected={connection === 'ready' && cliStatus?.authStatus !== 'required'}
            active={taskActive}
            contextWindow={session?.contextWindow}
            onOpen={openUsage}
          />
        </div>
      </footer>
      {notice && (
        <div className="toast" role="status">
          <div className="toast-message">
            <span>{notificationText(notice)}</span>
            {describeSystemError(notice) && (
              <SystemErrorDetails
                key={notice}
                error={notice}
                showExplanation={false}
                onExpandedChange={(open) => {
                  window.clearTimeout(noticeTimer.current);
                  if (!open) noticeTimer.current = window.setTimeout(() => setNotice(''), 6000);
                }}
              />
            )}
          </div>
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
        {dialog === 'terminal' && cwd && (
          <TerminalPanel cwd={cwd} onClose={() => setDialog(null)} />
        )}
        {previewOwner && <WebPreview owner={previewOwner} onClose={() => setPreviewOwner(null)} />}
        {filePickerOwner && (
          <ProjectFilePicker
            cwd={filePickerOwner.cwd}
            sessionId={filePickerOwner.sessionId}
            onClose={() => setFilePickerOwner(null)}
            onSelect={(files) => {
              appendFilesToDraft(files, filePickerOwner);
              setFilePickerOwner(null);
              draftRef.current?.focus();
            }}
          />
        )}
        {dialog === 'onboarding' && (
          <FirstRunWizard
            cliStatus={cliStatus || bootstrap?.cli}
            installState={installState}
            request={request}
            onClose={() => setDialog(null)}
            onComplete={(path) => {
              setDialog(null);
              void initialize(true).then(() => openProject(path));
            }}
          />
        )}
        {dialog === 'providers' && (
          <ProviderSettings
            request={request}
            onClose={() => setDialog(null)}
            onChanged={() => void initialize()}
          />
        )}
        {dialog === 'templates' && (
          <PromptTemplates
            items={settings.promptTemplates || []}
            draft={draft}
            onClose={() => setDialog(null)}
            onSave={async (items) => {
              await saveSettings({ promptTemplates: items });
            }}
            onUse={(text) => {
              setDraft((previous) => (previous ? previous + '\n\n' + text : text));
              window.setTimeout(() => draftRef.current?.focus(), 0);
            }}
          />
        )}
        {dialog === 'engine' && (
          <EngineDialog
            status={cliStatus}
            fallbackPath={bootstrap?.cli.path}
            authLabel={engineAuthLabel}
            action={engineAction}
            error={engineError}
            busy={engineBusy}
            updateBlocked={engineBusy || configuring || !!loadingSession || initializing}
            onAction={runEngineAction}
            onClose={() => setDialog(null)}
            onOnboarding={() => setDialog('onboarding')}
            onProviders={() => setDialog('providers')}
          />
        )}
        {dialog === 'tasks' && (
          <TaskCenter
            tasks={tasks}
            onInspectChanges={(task) => void inspectTaskChanges(task)}
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
            protectedAttachmentPaths={draftStoreRef.current?.attachmentPaths() || []}
            initialStorage={checkpointStorageRequested}
            sessionId={session?.sessionId}
            editorOpen={editorOpen}
            initialCheckpointId={projectCheckpointTarget?.id}
            initialRestore={projectCheckpointTarget?.restore}
            onRestored={() => {
              setRevision((value) => value + 1);
              setResultRevision((value) => value + 1);
            }}
            onRecordsChanged={() => setResultRevision((value) => value + 1)}
            onClose={() => {
              setDialog(null);
              setProjectCheckpointTarget(null);
              setCheckpointStorageRequested(false);
            }}
            notify={notify}
          />
        )}
        {attachmentPreview && (
          <Modal
            title={attachmentPreview.name}
            subtitle={attachmentPreview.path || t('文本上下文')}
            onClose={() => setAttachmentPreview(null)}
            wide={canPreviewOffice(attachmentPreview.path)}
          >
            {canPreviewOffice(attachmentPreview.path) && (
              <>
                <div className="desktop-tool-actions">
                  <button
                    className={officeLayout ? 'primary-button' : 'secondary-button'}
                    onClick={() => setOfficeLayout(true)}
                  >
                    {t('排版预览')}
                  </button>
                  <button
                    className={!officeLayout ? 'primary-button' : 'secondary-button'}
                    onClick={() => setOfficeLayout(false)}
                  >
                    {t('文字内容')}
                  </button>
                </div>
                {officeLayout && (
                  <OfficePreview
                    path={attachmentPreview.path}
                    name={attachmentPreview.name}
                    onExternal={() => {
                      void request('system.open', {
                        target: 'file',
                        path: attachmentPreview.path,
                      }).catch((error) => notify(errorText(error)));
                    }}
                  />
                )}
              </>
            )}
            <div
              hidden={
                officeLayout && canPreviewOffice(attachmentPreview.path) && !attachmentPreview.error
              }
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
              {attachmentPreview.error && (
                <>
                  <p role="alert">{attachmentPreview.error}</p>
                  {attachmentPreview.path && (
                    <button
                      className="secondary-button"
                      disabled={attachmentPreview.loading}
                      onClick={async () => {
                        const previous = attachmentPreview;
                        const loading = { ...previous, loading: true, error: undefined };
                        setAttachmentPreview(loading);
                        try {
                          const result = await request<{ authorized: boolean }>(
                            'attachment.reauthorize',
                            { path: previous.path },
                          );
                          if (!result.authorized) {
                            setAttachmentPreview((current) =>
                              current === loading ? previous : current,
                            );
                            return;
                          }
                          const value = await request<{
                            text?: string;
                            dataUrl?: string;
                            notice?: string;
                            native?: boolean;
                          }>('attachment.preview', { path: previous.path });
                          setAttachmentPreview((current) =>
                            current === loading
                              ? { ...previous, ...value, error: undefined, loading: false }
                              : current,
                          );
                        } catch (error) {
                          setAttachmentPreview((current) =>
                            current === loading
                              ? { ...previous, loading: false, error: errorText(error) }
                              : current,
                          );
                        }
                      }}
                    >
                      {t('重新选择原附件并恢复预览')}
                    </button>
                  )}
                </>
              )}
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
            </div>
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
            update={appUpdate}
            onUpdateAction={runUpdateAction}
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
        {selectedPermission && (
          <PermissionDialog
            key={`${selectedPermission.sessionId}:${selectedPermission.requestId}`}
            item={selectedPermission}
            cwd={
              tasks.find((task) => task.sessionId === selectedPermission.sessionId)?.cwd ||
              (session?.sessionId === selectedPermission.sessionId ? session.cwd : undefined)
            }
            permissionMode={
              selectedPermission.sessionId === session?.sessionId
                ? session.permissionMode
                : undefined
            }
            onModeChange={
              selectedPermission.sessionId === session?.sessionId
                ? (mode) => changePermissions(mode, selectedPermission.sessionId)
                : undefined
            }
            onReply={async (optionId, cancelled) => {
              const id = selectedPermission.requestId;
              const originSessionId = selectedPermission.sessionId;
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
