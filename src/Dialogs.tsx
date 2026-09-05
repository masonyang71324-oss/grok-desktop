import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Command as CommandIcon,
  ExternalLink,
  FolderGit2,
  Gauge,
  Monitor,
  Moon,
  Package,
  Plug,
  RefreshCw,
  Search,
  ShieldCheck,
  Sun,
  Terminal,
  Workflow,
} from 'lucide-react';
import type {
  Bootstrap,
  Command,
  ManagementResult,
  ModelsState,
  PermissionMode,
  PermissionRequest,
  Settings,
} from './types';
import { baseName, errorText, request } from './lib';
import { EmptyBox, Modal, RawResult, Spinner } from './components';
import { buildCommand } from './commands.mjs';
import { permissionChoice, permissionOverview } from './permission-dialog.mjs';
import PermissionControl from './PermissionControl';
import './permission-dialog.css';
import { getLocale, translate as t, useI18n } from './i18n';
export const commandLabels: Record<string, string> = {
  'always-approve': '工具批准方式',
  'session-info': '会话信息',
  design: '设计文档',
  implement: '实施任务',
  'execute-plan': '执行计划',
  'code-review': '代码审查',
  'deep-research': '深度研究',
  'create-skill': '创建技能',
  'create-workflow': '创建工作流',
  'pr-babysit': '跟进 PR',
  'build-with-ai': '接入 AI',
  'bundled:imagine': '图像创作',
  statusline: '状态栏',
  help: '使用帮助',
  skills: '技能',
  skill: '使用技能',
  workflows: '工作流',
  workflow: '运行工作流',
  goal: '设定目标',
  loop: '循环任务',
  plan: '制定计划',
  review: '代码审查',
  init: '初始化项目',
  compact: '整理上下文',
  clear: '清空上下文',
  memory: '项目记忆',
  model: '切换模型',
  cost: '用量与费用',
  context: '上下文',
  status: '当前状态',
  commit: '提交变更',
  test: '运行测试',
  fix: '修复问题',
  build: '构建项目',
  agents: '智能体',
  permissions: '权限',
  mcp: 'MCP 服务',
  plugin: '插件',
  plugins: '插件',
  config: '配置',
  feedback: '反馈',
  fork: '分支对话',
  resume: '继续会话',
  doctor: '诊断',
  update: '检查更新',
};
const commandSummaries: Record<string, string> = {
  compact: '整理当前会话内容，为后续工作腾出上下文空间。',
  context: '查看当前上下文窗口、已用容量与用量明细。',
  'session-info': '查看当前会话的上下文和实际用量。',
  'always-approve': '选择需要时询问或自动批准工具操作。',
  goal: '设定要完成的目标，并管理预算和执行状态。',
  workflow: '运行已有工作流，或查看、暂停和继续工作流。',
  'deep-research': '围绕问题深入研究，整理信息来源与结论。',
  design: '梳理需求与实现方案，形成清晰的设计文档。',
  implement: '根据任务要求修改项目并验证实现。',
  'code-review': '检查代码变更，找出有实际影响的问题。',
  'create-skill': '把可复用的方法整理成一项技能。',
  'create-workflow': '将多步任务组织成可重复使用的工作流。',
  'build-with-ai': '为项目接入 AI 能力，梳理接口与实现步骤。',
};
const commandSummary = (command: Command) =>
  (commandSummaries[command.name.replace(/^\//, '')]
    ? t(commandSummaries[command.name.replace(/^\//, '')])
    : '') ||
  command.description ||
  `/${command.name.replace(/^\//, '')}`;
export function ActionsDialog({
  commands,
  onClose,
  onApply,
  onContext,
  onPermissions,
  connected,
}: {
  commands: Command[];
  onClose: () => void;
  onApply: (text: string) => void;
  onContext: () => void;
  onPermissions: () => void;
  connected: boolean;
}) {
  useI18n();
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Command | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const list = commands.filter((command) =>
    `${command.name} ${command.description || ''} ${t(commandLabels[command.name.replace(/^\//, '')] || '')} ${commandSummary(command)}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const label = (command: Command) =>
    (commandLabels[command.name.replace(/^\//, '')]
      ? t(commandLabels[command.name.replace(/^\//, '')])
      : '') ||
    (command.name.startsWith('resume-')
      ? t('接续外部会话')
      : command.description?.split(/[.。\n]/)[0] || command.name);
  const kind = chosen?.name.replace(/^\//, '');
  const update = (key: string, value: string) =>
    setValues((previous) => ({ ...previous, [key]: value }));
  const field = (
    key: string,
    title: string,
    placeholder: string,
    required = false,
    numeric = false,
  ) => (
    <label className="field">
      {title}
      <input
        required={required}
        type={numeric ? 'number' : 'text'}
        min={numeric ? 1 : undefined}
        step={numeric ? 1 : undefined}
        value={values[key] || ''}
        placeholder={placeholder}
        onChange={(event) => update(key, event.target.value)}
      />
    </label>
  );
  return (
    <Modal
      title={t('动作库')}
      subtitle={t('Grok 当前会话实际提供的能力，点选即可使用。')}
      onClose={onClose}
      wide
    >
      <div className="search-input large">
        <Search size={17} />
        <input
          autoFocus
          placeholder={t('搜索技能、工作流、目标或其他动作…')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <kbd>Ctrl K</kbd>
      </div>
      {chosen ? (
        <form
          className="command-form"
          onSubmit={(event) => {
            event.preventDefault();
            onApply(buildCommand(chosen, values));
            onClose();
          }}
        >
          <button type="button" className="text-button" onClick={() => setChosen(null)}>
            {t('返回动作库')}
          </button>
          <div className="command-detail-heading">
            <div className="feature-icon">
              <CommandIcon size={23} />
            </div>
            <div>
              <h3>{label(chosen)}</h3>
              <code>/{chosen.name.replace(/^\//, '')}</code>
            </div>
          </div>
          <p>{commandSummary(chosen)}</p>
          {kind === 'goal' ? (
            <>
              <label className="field">
                {t('目标操作')}
                <select
                  value={values.operation || 'set'}
                  onChange={(event) => update('operation', event.target.value)}
                >
                  <option value="set">{t('设定新目标')}</option>
                  <option value="status">{t('查看目标状态')}</option>
                  <option value="pause">{t('暂停目标')}</option>
                  <option value="resume">{t('继续目标')}</option>
                  <option value="clear">{t('清除当前目标')}</option>
                </select>
              </label>
              {(!values.operation || values.operation === 'set') && (
                <>
                  {field('objective', t('希望完成的目标'), t('清楚描述完成这项任务的标准'), true)}
                  {field('budget', t('Token 预算（可选）'), t('留空使用默认预算'), false, true)}
                </>
              )}
            </>
          ) : kind === 'workflow' ? (
            <>
              <label className="field">
                {t('工作流操作')}
                <select
                  value={values.operation || 'run'}
                  onChange={(event) => update('operation', event.target.value)}
                >
                  <option value="run">{t('运行工作流')}</option>
                  <option value="runs">{t('查看运行记录')}</option>
                  <option value="pause">{t('暂停工作流')}</option>
                  <option value="resume">{t('继续工作流')}</option>
                  <option value="stop">{t('停止工作流')}</option>
                  <option value="save">{t('保存工作流')}</option>
                </select>
              </label>
              {values.operation !== 'runs' &&
                field('name', t('工作流名称'), t('填写已配置的工作流名称'), true)}
              {(!values.operation || values.operation === 'run') && (
                <>
                  {field(
                    'agentBudget',
                    t('智能体数量预算（可选）'),
                    t('留空使用工作流默认值'),
                    false,
                    true,
                  )}
                  {field('effort', t('工作流强度（可选）'), t('按工作流定义填写，留空使用默认值'))}
                  {field('argument', t('任务内容（可选）'), t('说明此次工作流要完成的任务'))}
                </>
              )}
            </>
          ) : (
            chosen.input && (
              <label className="field">
                {t('任务内容或参数')}
                <textarea
                  value={values.argument || ''}
                  onChange={(event) => update('argument', event.target.value)}
                  placeholder={chosen.input.hint || t('填写这项动作需要的内容…')}
                  rows={4}
                />
                {chosen.input.hint && <small>{chosen.input.hint}</small>}
              </label>
            )
          )}
          <div className="form-actions">
            <button type="submit" className="primary-button">
              {t('放入输入框')}
              <ArrowRight size={16} />
            </button>
          </div>
        </form>
      ) : (
        <div className="command-grid">
          {list.map((command) => (
            <button
              key={command.name}
              className="command-card"
              onClick={() => {
                const commandName = command.name.replace(/^\//, '');
                if (commandName === 'context' || commandName === 'session-info') {
                  onContext();
                  return;
                }
                if (commandName === 'always-approve') {
                  onPermissions();
                  return;
                }
                setChosen(command);
                setValues({});
              }}
            >
              <CommandIcon size={18} />
              <div>
                <strong>{label(command)}</strong>
                <span>{commandSummary(command)}</span>
                <code>/{command.name.replace(/^\//, '')}</code>
              </div>
              <ChevronRight size={16} />
            </button>
          ))}
          {!list.length && (
            <EmptyBox
              icon={<CommandIcon size={25} />}
              heading={
                query
                  ? t('没有匹配的动作')
                  : connected
                    ? t('等待会话能力')
                    : t('连接 Grok 后查看动作')
              }
            >
              {query
                ? t('试试其他名称或关键词。')
                : connected
                  ? t('选择项目并创建会话，Grok 会提供可用动作。')
                  : t('请先在设置中检查 Grok 路径和连接状态。')}
            </EmptyBox>
          )}
        </div>
      )}
    </Modal>
  );
}
export function SettingsDialog({
  settings,
  models,
  bootstrap,
  onClose,
  onSave,
  busy,
}: {
  settings: Settings;
  models: ModelsState;
  bootstrap: Bootstrap | null;
  onClose: () => void;
  onSave: (settings: Partial<Settings>) => Promise<void>;
  busy: boolean;
}) {
  useI18n();
  const [draft, setDraft] = useState(settings);
  const [languageSaving, setLanguageSaving] = useState(false);
  async function changeLanguage(language: Settings['language']) {
    const previous = draft.language;
    setLanguageSaving(true);
    setError('');
    setDraft((value) => ({ ...value, language }));
    try {
      await onSave({ language });
    } catch (e) {
      setDraft((value) => ({ ...value, language: previous }));
      setError(errorText(e));
    } finally {
      setLanguageSaving(false);
    }
  }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setSaving(true);
    setError('');
    try {
      const { grokPath, theme, modelId, effort, permissionMode, notifications, language } = draft;
      await onSave({ grokPath, theme, modelId, effort, permissionMode, notifications, language });
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={t('设置')}
      subtitle={t('让工作台更适合你的工作方式。')}
      onClose={onClose}
      footer={
        <>
          <span className="muted">Grok Desktop {bootstrap?.version || ''}</span>
          <button
            className="primary-button"
            disabled={saving || languageSaving}
            onClick={() => void save()}
          >
            {saving ? <Spinner /> : <Check size={16} />}
            {t('保存设置')}
          </button>
        </>
      }
    >
      <div className="settings-section">
        <h3>{t('外观')}</h3>
        <label className="field">
          {t('界面语言')}
          <select
            aria-label={t('界面语言')}
            value={draft.language}
            disabled={saving || languageSaving}
            onChange={(event) => void changeLanguage(event.target.value as Settings['language'])}
          >
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
          <small>{t('立即生效，并在下次启动时保留。')}</small>
        </label>
        <div className="theme-options">
          {(
            [
              { id: 'dark', name: t('深色'), icon: <Moon size={19} /> },
              { id: 'light', name: t('浅色'), icon: <Sun size={19} /> },
              { id: 'system', name: t('跟随系统'), icon: <Monitor size={19} /> },
            ] as const
          ).map((theme) => (
            <button
              key={theme.id}
              className={draft.theme === theme.id ? 'selected' : ''}
              onClick={() => setDraft({ ...draft, theme: theme.id })}
            >
              {theme.icon}
              {theme.name}
              {draft.theme === theme.id && <Check size={14} />}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-section">
        <h3>{t('Grok 连接')}</h3>
        <label className="field">
          {t('Grok 可执行文件')}
          <input
            value={draft.grokPath}
            onChange={(e) => setDraft({ ...draft, grokPath: e.target.value })}
            placeholder={t('grok.exe 的完整路径')}
            disabled={busy}
          />
          <button
            type="button"
            className="secondary-button"
            disabled={busy || saving}
            onClick={async () => {
              try {
                const selected = await request<string | null>('dialog.grok');
                if (selected) setDraft((previous) => ({ ...previous, grokPath: selected }));
              } catch (e) {
                setError(errorText(e));
              }
            }}
          >
            {t('浏览程序…')}
          </button>
          <small>
            {busy
              ? t('任务执行期间无法更换连接路径。')
              : t('所有会话、诊断和管理操作都会使用此路径。')}
          </small>
        </label>
        {bootstrap && !bootstrap.cli.path && (
          <div className="inline-error">
            {t('未找到 Grok Build。请先安装官方程序，再选择 grok.exe 并保存。')}
          </div>
        )}
        <button
          className="text-button"
          onClick={() =>
            void request('system.open', {
              target: 'url',
              url: 'https://docs.x.ai/build/overview',
            }).catch((e) => setError(errorText(e)))
          }
        >
          {t('查看官方安装说明')}
          <ExternalLink size={13} />
        </button>
        <div className="connection-info">
          <span className={`status-dot ${bootstrap?.cli.connected ? '' : 'offline'}`} />
          <span>{bootstrap?.cli.version || t('版本信息尚不可用')}</span>
        </div>
      </div>
      <div className="settings-section">
        <h3>{t('会话偏好')}</h3>
        <label className="field">
          {t('默认模型')}
          <select
            value={draft.modelId}
            onChange={(e) => setDraft({ ...draft, modelId: e.target.value, effort: '' })}
          >
            <option value="">{t('Grok 默认模型')}</option>
            {models.availableModels.map((model) => (
              <option key={model.modelId} value={model.modelId}>
                {model.name || model.modelId}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {t('新会话默认权限')}
          <select
            value={draft.permissionMode}
            onChange={(e) =>
              setDraft({
                ...draft,
                permissionMode: e.target.value as Settings['permissionMode'],
              })
            }
          >
            <option value="ask">{t('由我确认需要批准的操作')}</option>
            <option value="auto">{t('自动批准 Grok 请求的操作')}</option>
          </select>
          <small>
            {draft.permissionMode === 'auto'
              ? t('自动批准会允许 Grok 直接执行其请求的文件与工具操作。')
              : t('Grok 请求授权时，显示具体操作供你确认。')}
          </small>
        </label>
      </div>
      <div className="settings-section">
        <h3>{t('提醒与诊断')}</h3>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={draft.notifications !== false}
            onChange={(e) => setDraft({ ...draft, notifications: e.target.checked })}
          />
          <span>{t('窗口在后台时，提醒待批准操作与任务结果')}</span>
        </label>
        <p className="muted helper-note">
          {t('通过任务栏闪烁和系统通知提醒；通知不包含任务正文。')}
        </p>
        <button
          className="secondary-button"
          onClick={() =>
            void request('system.open', { target: 'logs' }).catch((e) => setError(errorText(e)))
          }
        >
          {t('打开日志目录')}
        </button>
        <p className="muted helper-note">
          {t(
            '日志仅记录连接和操作状态，不记录对话、附件或命令内容。“Grok 管理”中的更新只更新官方 CLI。',
          )}
        </p>
      </div>
      {error && <div className="inline-error">{error}</div>}
    </Modal>
  );
}

type ManageTab = 'overview' | 'mcp' | 'plugins' | 'memory' | 'worktrees' | 'tasks' | 'diagnostics';
const manageTabs: { id: ManageTab; name: string; icon: any }[] = [
  { id: 'overview', name: '概览', icon: Gauge },
  { id: 'mcp', name: 'MCP 服务', icon: Plug },
  { id: 'plugins', name: '插件', icon: Package },
  { id: 'memory', name: '记忆与流程', icon: BookOpen },
  { id: 'worktrees', name: '工作树', icon: FolderGit2 },
  { id: 'tasks', name: '后台任务', icon: Workflow },
  { id: 'diagnostics', name: '诊断与更新', icon: Activity },
];
const initialActions: Record<ManageTab, string> = {
  overview: 'inspect',
  mcp: 'mcp-list',
  plugins: 'plugin-list',
  memory: 'memory-list',
  worktrees: 'worktree-list',
  tasks: 'task-list',
  diagnostics: 'doctor',
};
type Field = {
  key: string;
  label: string;
  placeholder?: string;
  choices?: string[];
  required?: boolean;
  multiline?: boolean;
};
type ManageAction = {
  id: string;
  title: string;
  description: string;
  fields?: Field[];
  destructive?: boolean;
  sessionRequired?: boolean;
};
const scope: Field = {
  key: 'scope',
  label: '作用范围',
  choices: ['user', 'project'],
};
const mcpName: Field = {
  key: 'name',
  label: '服务名称',
  required: true,
  placeholder: '例如 github',
};
const pluginName: Field = {
  key: 'plugin',
  label: '插件标识',
  required: true,
  placeholder: '插件名称或完整标识',
};
const actions: Record<ManageTab, ManageAction[]> = {
  overview: [
    {
      id: 'inspect',
      title: '查看配置',
      description: '检查当前生效的 Grok 配置。',
    },
    {
      id: 'models',
      title: '可用模型',
      description: '查看账户当前可使用的模型。',
    },
  ],
  mcp: [
    {
      id: 'mcp-list',
      title: '已配置的服务',
      description: '读取当前 MCP 连接配置。',
    },
    {
      id: 'mcp-doctor',
      title: '检查服务连接',
      description: '诊断 MCP 服务是否正常。',
    },
    {
      id: 'mcp-add',
      title: '添加 MCP 服务',
      description: '连接本地工具或远程 MCP 服务。',
      fields: [
        mcpName,
        {
          key: 'transport',
          label: '连接方式',
          choices: ['stdio', 'http', 'sse'],
        },
        {
          key: 'command',
          label: '启动命令',
          placeholder: 'stdio 服务使用，例如 npx',
        },
        {
          key: 'args',
          label: '命令参数',
          placeholder: '例如 -y @example/server',
        },
        { key: 'url', label: '服务地址', placeholder: 'https://…' },
        {
          key: 'env',
          label: '环境变量（可选）',
          placeholder: '每行一个 KEY=value',
          multiline: true,
        },
        {
          key: 'headers',
          label: '请求头（可选）',
          placeholder: '每行一个 Header: value',
          multiline: true,
        },
        scope,
      ],
    },
    {
      id: 'mcp-enable',
      title: '启用服务',
      description: '恢复一个已配置的服务。',
      fields: [mcpName],
    },
    {
      id: 'mcp-disable',
      title: '停用服务',
      description: '保留配置并暂时停用。',
      fields: [mcpName],
    },
    {
      id: 'mcp-remove',
      title: '移除服务',
      description: '删除指定 MCP 服务的配置。',
      fields: [mcpName, scope],
      destructive: true,
    },
  ],
  plugins: [
    {
      id: 'plugin-list',
      title: '已安装插件',
      description: '查看本地插件与启用状态。',
    },
    {
      id: 'plugin-marketplaces',
      title: '插件来源',
      description: '查看已添加的插件市场。',
    },
    {
      id: 'plugin-install',
      title: '信任并安装',
      description: '信任插件来源并安装；插件可能运行本地工具。',
      fields: [pluginName],
      destructive: true,
    },
    {
      id: 'marketplace-add',
      title: '添加插件来源',
      description: '添加一个插件市场仓库。',
      fields: [
        {
          key: 'source',
          label: '市场地址',
          placeholder: '仓库地址或路径',
          required: true,
        },
      ],
    },
    {
      id: 'plugin-enable',
      title: '启用插件',
      description: '启用已安装的插件。',
      fields: [pluginName],
    },
    {
      id: 'plugin-disable',
      title: '停用插件',
      description: '保留插件并暂时停用。',
      fields: [pluginName],
    },
    {
      id: 'plugin-update',
      title: '更新插件',
      description: '更新指定插件，留空更新全部。',
      fields: [{ ...pluginName, required: false }],
    },
    {
      id: 'plugin-uninstall',
      title: '卸载插件',
      description: '可能一并移除同一仓库的其他插件；保留插件持久化数据。',
      fields: [pluginName],
      destructive: true,
    },
  ],
  memory: [
    {
      id: 'memory-list',
      title: '查看记忆',
      description: '读取 Grok 保存的项目和用户记忆。',
    },
    {
      id: 'workflow-list',
      title: '查看工作流',
      description: '读取当前项目可用的工作流。',
    },
  ],
  worktrees: [
    {
      id: 'worktree-list',
      title: '查看工作树',
      description: '读取 Grok 管理的独立工作目录。',
    },
    {
      id: 'worktree-create',
      title: '创建工作树',
      description: '为当前会话创建独立目录，下一步选择目标父文件夹。',
      sessionRequired: true,
      fields: [
        {
          key: 'label',
          label: '工作树名称',
          required: true,
          placeholder: '例如 feature-search',
        },
        { key: 'copyMode', label: '复制方式', choices: ['clean', 'dirty'] },
        {
          key: 'gitRef',
          label: '起始 Git 引用（可选）',
          placeholder: '留空使用默认引用',
        },
      ],
    },
  ],
  tasks: [
    {
      id: 'task-list',
      title: '查看后台任务',
      description: '读取当前会话的运行中任务。',
      sessionRequired: true,
    },
    {
      id: 'subagent-list',
      title: '查看子智能体',
      description: '读取当前会话的子智能体及其进度。',
      sessionRequired: true,
    },
    {
      id: 'task-stop',
      title: '停止后台任务',
      description: '停止指定任务正在进行的工作。',
      fields: [
        {
          key: 'taskId',
          label: '任务 ID',
          required: true,
          placeholder: '从任务列表中复制 ID',
        },
      ],
      destructive: true,
      sessionRequired: true,
    },
    {
      id: 'subagent-stop',
      title: '停止子智能体',
      description: '停止指定子智能体的工作。',
      fields: [
        {
          key: 'subagentId',
          label: '子智能体 ID',
          required: true,
          placeholder: '从子智能体列表中复制 ID',
        },
      ],
      destructive: true,
      sessionRequired: true,
    },
    {
      id: 'schedule-delete',
      title: '删除计划任务',
      description: '取消指定任务今后的自动执行。',
      fields: [
        {
          key: 'taskId',
          label: '任务 ID',
          required: true,
          placeholder: '从任务列表中复制 ID',
        },
      ],
      destructive: true,
      sessionRequired: true,
    },
  ],
  diagnostics: [
    {
      id: 'doctor',
      title: '运行诊断',
      description: '检查 Grok 安装、认证与运行环境。',
    },
    {
      id: 'update-check',
      title: '检查 Grok Build 更新',
      description: '检查官方 CLI 更新，不更新此桌面应用。',
    },
    {
      id: 'update-install',
      title: '安装更新',
      description: '更新本机 Grok 可执行程序。',
      destructive: true,
    },
  ],
};
export function ManagementDialog({
  cwd,
  sessionId,
  onClose,
  notify,
}: {
  cwd: string;
  sessionId?: string;
  onClose: () => void;
  notify: (message: string) => void;
}) {
  useI18n();
  const [tab, setTab] = useState<ManageTab>('overview');
  const [result, setResult] = useState<ManagementResult | null>(null);
  const [running, setRunning] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState<ManageAction | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [resultTitle, setResultTitle] = useState('');
  const [resultAction, setResultAction] = useState('');
  const [confirmation, setConfirmation] = useState<{
    action: ManageAction;
    payload: Record<string, string>;
  } | null>(null);
  async function run(
    action: ManageAction,
    payload: Record<string, string> = {},
    confirmed = false,
  ) {
    if (action.sessionRequired && !sessionId) {
      setError(t('请先创建或载入一个会话，再使用这项功能。'));
      return;
    }
    if (action.destructive && !confirmed) {
      setConfirmation({ action, payload: { ...payload } });
      return;
    }
    setConfirmation(null);
    setRunning(action.id);
    setError('');
    setResult(null);
    setResultTitle(action.title);
    setResultAction(action.id);
    try {
      const data = await request<ManagementResult>('system.run', {
        action: action.id,
        cwd,
        values: { ...payload, ...(sessionId ? { sessionId } : {}) },
      });
      setResult(data);
      if (data.exitCode && data.exitCode !== 0)
        setError(t('操作未完成（退出码 {code}），请展开详细输出。', { code: data.exitCode }));
      else if (action.fields || action.destructive) {
        setForm(null);
        notify(t('{action}已完成', { action: t(action.title) }));
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setRunning('');
    }
  }
  useEffect(() => {
    setForm(null);
    setResult(null);
    setError('');
    const action = actions[tab].find((a) => a.id === initialActions[tab])!;
    void run(action);
  }, [tab]);
  const start = (action: ManageAction) => {
    if (action.fields) {
      setForm(action);
      setValues(Object.fromEntries(action.fields.map((f) => [f.key, f.choices?.[0] || ''])));
    } else void run(action);
  };
  if (confirmation)
    return (
      <Modal
        title={t('确认{action}', { action: t(confirmation.action.title) })}
        subtitle={t(confirmation.action.description)}
        onClose={() => setConfirmation(null)}
        footer={
          <>
            <button className="secondary-button" onClick={() => setConfirmation(null)}>
              {t('取消')}
            </button>
            <button
              className="primary-button"
              onClick={() => void run(confirmation.action, confirmation.payload, true)}
            >
              {t('确认{action}', { action: t(confirmation.action.title) })}
            </button>
          </>
        }
      >
        <p>
          {confirmation.payload.name ||
            confirmation.payload.plugin ||
            confirmation.payload.taskId ||
            t(confirmation.action.title)}
        </p>
      </Modal>
    );
  return (
    <Modal
      title={t('Grok 管理')}
      subtitle={t('管理这台电脑上的工具、插件与运行环境。')}
      wide
      onClose={onClose}
    >
      <div className="management-layout">
        <nav className="management-nav">
          {manageTabs.map((item) => (
            <button
              disabled={!!running}
              key={item.id}
              className={tab === item.id ? 'active' : ''}
              onClick={() => setTab(item.id)}
            >
              <item.icon size={17} />
              {t(item.name)}
            </button>
          ))}
          <div className="management-nav-bottom">
            <small>{t('当前项目')}</small>
            <span title={cwd}>{cwd ? baseName(cwd) : t('尚未选择项目')}</span>
          </div>
        </nav>
        <div className="management-content">
          {form ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(form, values);
              }}
            >
              <button
                type="button"
                className="text-button"
                onClick={() => setForm(null)}
                disabled={!!running}
              >
                {t('返回{section}', {
                  section: t(manageTabs.find((item) => item.id === tab)?.name || ''),
                })}
              </button>
              <h3>{t(form.title)}</h3>
              <p className="muted">{t(form.description)}</p>
              {form.fields
                ?.filter(
                  (field) =>
                    !(
                      form.id === 'mcp-add' &&
                      ((values.transport === 'stdio' && field.key === 'url') ||
                        (values.transport !== 'stdio' && ['command', 'args'].includes(field.key)))
                    ),
                )
                .map((field) => (
                  <label className="field" key={field.key}>
                    {t(field.label)}
                    {field.choices ? (
                      <select
                        value={values[field.key] || ''}
                        onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                      >
                        {field.choices.map((value) => (
                          <option key={value} value={value}>
                            {{
                              user: t('此用户'),
                              project: t('当前项目'),
                              stdio: t('本地进程（stdio）'),
                              http: t('远程 HTTP'),
                              sse: t('远程 SSE'),
                              clean: t('仅已提交内容'),
                              dirty: t('包含未提交修改'),
                            }[value] || value}
                          </option>
                        ))}
                      </select>
                    ) : field.multiline ? (
                      <textarea
                        rows={3}
                        value={values[field.key] || ''}
                        placeholder={field.placeholder ? t(field.placeholder) : undefined}
                        onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                      />
                    ) : (
                      <input
                        required={field.required}
                        value={values[field.key] || ''}
                        placeholder={field.placeholder ? t(field.placeholder) : undefined}
                        onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                      />
                    )}
                  </label>
                ))}
              <div className="form-actions">
                <button
                  className={`primary-button ${form.destructive ? 'danger' : ''}`}
                  disabled={!!running}
                >
                  {running ? <Spinner /> : <Check size={15} />}
                  {t('确认{action}', { action: t(form.title) })}
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="section-heading">
                <h3>{t(manageTabs.find((item) => item.id === tab)?.name || '')}</h3>
                <span className="subtle-label">{t('本机 Grok')}</span>
              </div>
              <div className="management-actions">
                {actions[tab].map((action) => (
                  <button
                    key={action.id}
                    onClick={() => start(action)}
                    disabled={!!running}
                    className={action.destructive ? 'danger-hover' : ''}
                  >
                    <div>
                      <strong>{t(action.title)}</strong>
                      <small>{t(action.description)}</small>
                    </div>
                    {running === action.id ? <Spinner /> : <ChevronRight size={15} />}
                  </button>
                ))}
              </div>
            </>
          )}
          {error && <div className="inline-error">{error}</div>}
          {running && (
            <div className="loading-line">
              <Spinner />
              {t('正在{action}…', { action: t(resultTitle) })}
            </div>
          )}
          {result && (
            <div className="management-result">
              <div className="result-label">
                <Check size={15} />
                {t(resultTitle)}
                {result.exitCode ? t(' · 请查看输出') : t(' · 已返回结果')}
              </div>
              {renderResult(result, {
                action: resultAction,
                onOpen: (path) =>
                  void request('system.open', {
                    target: 'path',
                    path,
                    cwd,
                  }).catch((error) => notify(errorText(error))),
                onStop: (action, values) => {
                  const target = actions.tasks.find((item) => item.id === action);
                  if (target) void run(target, values);
                },
              })}
              <RawResult
                text={
                  result.text ||
                  JSON.stringify(result.data, null, 2) ||
                  t('命令完成，无额外文本输出。')
                }
              />
            </div>
          )}
          {['memory', 'worktrees'].includes(tab) && (
            <div className="muted helper-note">
              {t('需要更详细的交互管理时，可在项目终端中使用官方 Grok。')}
              <button
                className="text-button"
                onClick={() =>
                  void request('system.open', {
                    target: 'terminal',
                    cwd,
                  }).catch((e) => notify(errorText(e)))
                }
              >
                <Terminal size={14} />
                {t('打开项目终端')}
                <ExternalLink size={12} />
              </button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
function renderResult(
  result: ManagementResult,
  options: {
    action: string;
    onOpen: (path: string) => void;
    onStop: (action: string, values: Record<string, string>) => void;
  },
) {
  const data = result.data;
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object'
      ? Object.values(data).find(Array.isArray)
      : null;
  if (Array.isArray(list) && list.length)
    return (
      <div className="result-items">
        {list.slice(0, 30).map((item: any, index: number) => (
          <div className="result-item" key={index}>
            <strong>
              {typeof item === 'string'
                ? item
                : item.name ||
                  item.taskId ||
                  item.subagentId ||
                  item.id ||
                  item.path ||
                  item.title ||
                  t('项目 {number}', { number: index + 1 })}
            </strong>
            {typeof item === 'object' && (
              <span>
                {item.description || item.status || item.version || item.command || item.url || ''}
              </span>
            )}
            {typeof item === 'object' && options.action === 'memory-list' && item.path && (
              <button className="text-button" onClick={() => options.onOpen(item.path)}>
                {t('打开记忆文件')}
                <ExternalLink size={12} />
              </button>
            )}
            {typeof item === 'object' &&
              options.action === 'task-list' &&
              (item.taskId || item.id) && (
                <button
                  className="text-button"
                  onClick={() =>
                    options.onStop('task-stop', {
                      taskId: String(item.taskId || item.id),
                    })
                  }
                >
                  {t('停止任务')}
                </button>
              )}
            {typeof item === 'object' &&
              options.action === 'subagent-list' &&
              (item.subagentId || item.id) && (
                <button
                  className="text-button"
                  onClick={() =>
                    options.onStop('subagent-stop', {
                      subagentId: String(item.subagentId || item.id),
                    })
                  }
                >
                  {t('停止子智能体')}
                </button>
              )}
          </div>
        ))}
      </div>
    );
  if (Array.isArray(list) && !list.length)
    return <p className="muted">{t('当前没有已配置的项目。')}</p>;
  const clean = result.text?.replace(/\x1b\[[0-9;]*m/g, '').trim();
  return clean ? (
    <p className="result-summary">{clean.split('\n').filter(Boolean).slice(0, 5).join('\n')}</p>
  ) : (
    <p className="muted">{t('操作完成。')}</p>
  );
}
interface AccountUsage {
  fetchedAt: string;
  plan: string | null;
  period: { type: string | null; start: string | null; end: string | null };
  usedPercent: number | null;
  remainingPercent: number | null;
  prepaidBalanceUsd: number | null;
  onDemandUsedUsd: number | null;
  onDemandCapUsd: number | null;
  onDemandEnabled: boolean | null;
  unified: boolean | null;
}
const knownNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const usageNumber = (value: unknown) =>
  knownNumber(value) ? value.toLocaleString(getLocale(), { maximumFractionDigits: 0 }) : '—';
const usagePercent = (value: number) =>
  value > 0 && value < 0.1
    ? '<0.1%'
    : value > 99.9 && value < 100
      ? '>99.9%'
      : `${value.toLocaleString(getLocale(), { maximumFractionDigits: 1 })}%`;
function localUsageTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleString(getLocale(), {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
}
export function UsageDialog({
  cwd,
  sessionId,
  onClose,
}: {
  cwd?: string;
  sessionId?: string;
  onClose: () => void;
}) {
  useI18n();
  const [account, setAccount] = useState<AccountUsage | null>(null);
  const [accountError, setAccountError] = useState('');
  const [accountBusy, setAccountBusy] = useState(true);
  const [data, setData] = useState<any>(null);
  const [contextError, setContextError] = useState('');
  const [contextBusy, setContextBusy] = useState(!!sessionId);
  const requestVersion = useRef(0);
  function refresh() {
    const version = ++requestVersion.current;
    setAccountBusy(true);
    setAccountError('');
    void request<AccountUsage>('account.usage')
      .then((value) => {
        if (requestVersion.current === version) setAccount(value);
      })
      .catch((error) => {
        if (requestVersion.current === version) setAccountError(errorText(error));
      })
      .finally(() => {
        if (requestVersion.current === version) setAccountBusy(false);
      });
    if (!sessionId) {
      setData(null);
      setContextError('');
      setContextBusy(false);
      return;
    }
    setContextBusy(true);
    setContextError('');
    void request('session.usage', { cwd, sessionId })
      .then((value) => {
        if (requestVersion.current === version) setData(value);
      })
      .catch((error) => {
        if (requestVersion.current === version) setContextError(errorText(error));
      })
      .finally(() => {
        if (requestVersion.current === version) setContextBusy(false);
      });
  }
  useEffect(() => {
    setData(null);
    refresh();
    return () => {
      requestVersion.current += 1;
    };
  }, [cwd, sessionId]);
  const context = data?.info?.context || data?.context;
  const contextPercent =
    knownNumber(context?.used) &&
    context.used >= 0 &&
    knownNumber(context?.total) &&
    context.total > 0
      ? (context.used / context.total) * 100
      : knownNumber(context?.usagePct)
        ? context.usagePct
        : null;
  const used = account?.usedPercent;
  const remaining = account?.remainingPercent;
  const reset = localUsageTime(account?.period?.end);
  const fetched = localUsageTime(account?.fetchedAt);
  const plan = account?.plan
    ? {
        heavy: 'Heavy',
        supergrok: 'SuperGrok',
        premium: 'Premium',
        premium_plus: 'Premium+',
        free: t('免费套餐'),
      }[account.plan.toLowerCase()] || account.plan
    : t('官方未返回套餐名称');
  const periodType = account?.period?.type?.toUpperCase() || '';
  const cycle =
    periodType.includes('WEEKLY') || periodType === 'WEEK'
      ? t('每周')
      : periodType.includes('MONTHLY') || periodType === 'MONTH'
        ? t('每月')
        : periodType.includes('DAILY') || periodType === 'DAY'
          ? t('每日')
          : t('当前周期');
  const money = (value: number) =>
    `US$ ${value.toLocaleString(getLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <Modal
      title={t('额度与上下文')}
      subtitle={t('账户套餐额度与当前会话上下文，分别查看。')}
      onClose={onClose}
      footer={
        <>
          <span className="muted">
            {fetched ? t('账户数据更新于 {time}', { time: fetched }) : t('从 Grok 读取实际统计')}
          </span>
          <button
            className="secondary-button"
            onClick={refresh}
            disabled={accountBusy || contextBusy}
          >
            {accountBusy || contextBusy ? <Spinner /> : <RefreshCw size={15} />}
            {t('刷新用量')}
          </button>
        </>
      }
    >
      <section className="usage-section" aria-label={t('账户套餐额度')}>
        <div className="usage-section-heading">
          <div>
            <Gauge size={17} />
            <h3>{t('账户套餐额度')}</h3>
          </div>
          <span>{account?.unified ? t('跨产品共享') : t('账户范围')}</span>
        </div>
        {accountError && (
          <div className="inline-error">
            {account
              ? t('刷新失败，以下为上次读取的数据。 {error}', { error: accountError })
              : accountError}
          </div>
        )}
        {accountBusy && !account ? (
          <div className="loading-line">
            <Spinner />
            {t('正在读取套餐额度…')}
          </div>
        ) : account ? (
          <div className="usage-card account-usage-card">
            <div className="account-plan-row">
              <strong>{plan}</strong>
              {cycle && <span className="plan-period">{t('{cycle}额度', { cycle })}</span>}
              {accountBusy && <Spinner />}
            </div>
            {knownNumber(used) ? (
              <>
                <div className="quota-heading">
                  <span>{t('已使用')}</span>
                  <strong>{usagePercent(used)}</strong>
                  {knownNumber(remaining) && (
                    <small>{t('剩余 {percent}', { percent: usagePercent(remaining) })}</small>
                  )}
                </div>
                <div
                  className="usage-track"
                  role="progressbar"
                  aria-label={t('套餐额度已使用')}
                  aria-valuenow={Math.min(100, Math.max(0, used))}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <span style={{ width: `${Math.min(100, Math.max(0, used))}%` }} />
                </div>
              </>
            ) : (
              <div className="quota-unavailable">
                <span>{t('官方暂未返回使用比例')}</span>
                {knownNumber(remaining) && (
                  <small>{t('剩余额度 {percent}', { percent: usagePercent(remaining) })}</small>
                )}
              </div>
            )}
            <div className="quota-reset">
              <span>{t('下次重置')}</span>
              <strong>{reset || t('官方暂未返回重置时间')}</strong>
            </div>
            {(knownNumber(account.prepaidBalanceUsd) ||
              knownNumber(account.onDemandUsedUsd) ||
              knownNumber(account.onDemandCapUsd) ||
              account.onDemandEnabled !== null) && (
              <div className="account-money-stats">
                {knownNumber(account.prepaidBalanceUsd) && (
                  <div>
                    <span>{t('预付余额')}</span>
                    <strong>{money(account.prepaidBalanceUsd)}</strong>
                  </div>
                )}
                {account.onDemandEnabled !== null && (
                  <div>
                    <span>{t('按量付费功能')}</span>
                    <strong>{account.onDemandEnabled ? t('可用') : t('不可用')}</strong>
                  </div>
                )}
                {knownNumber(account.onDemandUsedUsd) && (
                  <div>
                    <span>{t('按量已用')}</span>
                    <strong>{money(account.onDemandUsedUsd)}</strong>
                  </div>
                )}
                {knownNumber(account.onDemandCapUsd) && (
                  <div>
                    <span>{t('按量支出上限')}</span>
                    <strong>{money(account.onDemandCapUsd)}</strong>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </section>
      <section className="usage-section context-usage-section" aria-label={t('当前会话上下文')}>
        <div className="usage-section-heading">
          <div>
            <BookOpen size={17} />
            <h3>{t('当前会话上下文')}</h3>
          </div>
          <span>{sessionId ? t('当前会话') : t('尚未选择会话')}</span>
        </div>
        {!sessionId ? (
          <div className="usage-placeholder">
            <BookOpen size={21} />
            <p>{t('创建或打开会话后显示上下文')}</p>
          </div>
        ) : (
          <>
            {contextError && (
              <div className="inline-error">
                {data
                  ? t('刷新失败，以下为上次读取的数据。 {error}', { error: contextError })
                  : contextError}
              </div>
            )}
            {contextBusy && !data ? (
              <div className="loading-line">
                <Spinner />
                {t('正在读取上下文…')}
              </div>
            ) : data ? (
              <>
                {context ? (
                  <div className="usage-card">
                    <div className="section-heading">
                      <span>{t('上下文窗口')}</span>
                      {contextBusy ? (
                        <Spinner />
                      ) : (
                        <strong>
                          {knownNumber(contextPercent) ? usagePercent(contextPercent) : '—'}
                        </strong>
                      )}
                    </div>
                    {knownNumber(contextPercent) && (
                      <div
                        className="usage-track"
                        role="progressbar"
                        aria-label={t('上下文已使用')}
                        aria-valuenow={Math.min(100, Math.max(0, contextPercent))}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <span
                          style={{
                            width: `${Math.min(100, Math.max(0, contextPercent))}%`,
                          }}
                        />
                      </div>
                    )}
                    <div
                      className={`usage-stats ${knownNumber(context.freeTokens) ? 'three-stats' : ''}`}
                    >
                      <div>
                        <small>{t('已使用')}</small>
                        <strong>
                          {usageNumber(context.used)} <span>tokens</span>
                        </strong>
                      </div>
                      <div>
                        <small>{t('窗口容量')}</small>
                        <strong>
                          {usageNumber(context.total)} <span>tokens</span>
                        </strong>
                      </div>
                      {knownNumber(context.freeTokens) && (
                        <div>
                          <small>{t('剩余空间')}</small>
                          <strong>
                            {usageNumber(context.freeTokens)} <span>tokens</span>
                          </strong>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="muted">{t('此版本未返回当前上下文窗口统计。')}</p>
                )}
                <p className="muted helper-note">
                  {t('上下文窗口表示当前会话可容纳的内容，独立于账户套餐额度。')}
                </p>
                <RawResult text={JSON.stringify(data, null, 2)} label={t('会话用量明细')} />
              </>
            ) : null}
          </>
        )}
      </section>
    </Modal>
  );
}
export function PermissionDialog({
  item,
  onReply,
  permissionMode,
  onModeChange,
}: {
  item: { requestId: string | number; params: PermissionRequest };
  onReply: (optionId?: string, cancelled?: boolean) => Promise<void>;
  permissionMode?: PermissionMode;
  onModeChange?: (mode: PermissionMode) => Promise<void>;
}) {
  useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const overview = permissionOverview(item.params.toolCall);
  const title = overview.title === item.params.toolCall?.title ? overview.title : t(overview.title);
  const options = item.params.options.map((option) => {
    const display = permissionChoice(option);
    const originalLabel =
      !['allow_once', 'allow_always', 'reject_once', 'reject_always'].includes(option.kind) &&
      display.label === display.original;
    return { option, display, label: originalLabel ? display.label : t(display.label) };
  });
  async function reply(optionId?: string, cancelled = false) {
    if (busy) return;
    setBusy(true);
    try {
      await onReply(optionId, cancelled);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t('Grok 需要你的批准')}
      subtitle={t('查看操作内容，再选择如何处理。')}
      closeOnBackdrop={false}
      onClose={() => {
        if (!busy) void reply(undefined, true);
      }}
      footer={
        <div className="permission-footer">
          <div className="permission-action-grid">
            {options.map(({ option, display, label }) => (
              <button
                key={option.optionId}
                className={`permission-choice ${option.kind === 'allow_once' ? 'primary' : ''}`}
                aria-label={label}
                disabled={busy}
                onClick={() => void reply(option.optionId)}
              >
                <strong>{label}</strong>
                <small>{t(display.description)}</small>
              </button>
            ))}
          </div>
          <div className="permission-cancel-row">
            {busy && <Spinner />}
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void reply(undefined, true)}
            >
              {t('取消这项操作')}
            </button>
          </div>
        </div>
      }
    >
      <div className="permission-review-header">
        <div className="permission-review-icon">
          <ShieldCheck size={23} />
        </div>
        <div>
          <h3>{title}</h3>
          <p>{t('这项操作正在等待你的决定。')}</p>
        </div>
      </div>
      {overview.preview && <div className="permission-command-preview">{overview.preview}</div>}
      {overview.sections.length > 0 && (
        <details className="permission-review-details">
          <summary>
            <Terminal size={15} />
            {t('查看完整命令与参数')}
            <ChevronRight size={14} />
          </summary>
          {overview.sections.map((section, index) => (
            <div className="permission-detail-section" key={index}>
              <h4>{t(section.label)}</h4>
              <pre>{section.text}</pre>
            </div>
          ))}
        </details>
      )}
      <details className="permission-source-options">
        <summary>
          {t('查看官方选项说明')}
          <ChevronRight size={14} />
        </summary>
        <dl>
          {options.map(({ option, display, label }) => (
            <div key={option.optionId}>
              <dt>{label}</dt>
              <dd>{display.original || t('服务端未提供补充说明。')}</dd>
            </div>
          ))}
        </dl>
      </details>
      {permissionMode && onModeChange && (
        <div className="permission-following-mode">
          <PermissionControl
            value={permissionMode}
            onChange={onModeChange}
            disabled={busy}
            scope={t('后续操作权限')}
          />
          <p>{t('已弹出的这项操作仍需单独确认。')}</p>
        </div>
      )}
      {error && <div className="inline-error">{error}</div>}
    </Modal>
  );
}
