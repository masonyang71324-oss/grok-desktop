export type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
export type PermissionMode = 'ask' | 'auto';
export interface Settings {
  language: 'zh-CN' | 'en';
  grokPath: string;
  theme: 'dark' | 'light' | 'system';
  modelId: string;
  effort: string;
  permissionMode: PermissionMode;
  recentProjects: string[];
  lastProject: string;
  notifications?: boolean;
  ui?: { sidebar: boolean; inspector: boolean; inspectorTab: 'files' | 'changes' | 'plan' };
  window?: { x: number; y: number; width: number; height: number; maximized: boolean } | null;
}
export interface Model {
  modelId: string;
  name?: string;
  description?: string;
  _meta?: {
    reasoningEffort?: string;
    supportsReasoningEffort?: boolean;
    totalContextTokens?: number;
    reasoningEfforts?: {
      id: string;
      value?: string;
      label: string;
      description?: string;
      default?: boolean;
    }[];
    [key: string]: unknown;
  };
}
export interface ModelsState {
  currentModelId: string;
  availableModels: Model[];
}
export interface Command {
  name: string;
  description?: string;
  input?: { hint?: string } | null;
  _meta?: Record<string, unknown>;
}
export interface AcpUpdate {
  sessionUpdate: string;
  content?: any;
  toolCallId?: string;
  title?: string;
  status?: string;
  rawInput?: any;
  rawOutput?: any;
  entries?: any[];
  availableCommands?: Command[];
  _meta?: Record<string, any>;
  [key: string]: any;
}
export interface SessionSummary {
  sessionId: string;
  cwd: string;
  title: string;
  updatedAt?: string;
  createdAt?: string;
}
export interface SessionSnapshot {
  permissionMode: PermissionMode;
  sessionId: string;
  cwd: string;
  models: ModelsState;
  commands: Command[];
  updates: AcpUpdate[];
  modes?: {
    currentModeId: string;
    availableModes: { id: string; name: string; description?: string }[];
  };
  _meta?: Record<string, any>;
}
export interface PermissionRequest {
  sessionId: string;
  toolCall?: { title?: string; rawInput?: any; content?: any[] };
  options: { optionId: string; name: string; kind: string }[];
}
export type DesktopEvent =
  | {
      type: 'connection';
      state: 'connecting' | 'ready' | 'error' | 'disconnected';
      message?: string;
    }
  | {
      type: 'update';
      sessionId: string;
      turnId?: string;
      update: AcpUpdate;
      replay?: boolean;
    }
  | { type: 'commands'; sessionId?: string; commands: Command[] }
  | { type: 'models'; sessionId?: string; models: ModelsState }
  | {
      type: 'permission';
      sessionId: string;
      turnId?: string;
      requestId: string | number;
      params: PermissionRequest;
    }
  | {
      type: 'permission-resolved';
      requestId: string | number;
      sessionId?: string;
    }
  | { type: 'turn-start'; sessionId: string; turnId: string }
  | { type: 'turn-end'; sessionId: string; turnId: string; result: any }
  | { type: 'turn-error'; sessionId: string; turnId: string; message: string }
  | { type: 'notification'; sessionId?: string; kind: string; payload: any }
  | { type: 'sessions-changed'; sessionId?: string }
  | { type: 'workspace-changed'; cwd: string };
export interface Bootstrap {
  settings: Settings;
  version: string;
  cli: { path: string; version: string; connected: boolean; error?: string };
  models: ModelsState;
  commands: Command[];
}
export interface WorkspaceEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
}
export interface GitChange {
  path: string;
  status: string;
  staged: boolean;
  additions?: number;
  deletions?: number;
}
export interface Attachment {
  name: string;
  path: string;
}
export interface ManagementResult {
  text: string;
  data?: any;
  exitCode?: number;
}
export interface DesktopApi {
  pathsForFiles(files: File[]): Attachment[];
  request<T = unknown>(command: string, payload?: any): Promise<Result<T>>;
  onEvent(callback: (event: DesktopEvent) => void): () => void;
}
declare global {
  interface Window {
    desktop: DesktopApi;
  }
}
