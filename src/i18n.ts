import { useSyncExternalStore } from 'react';
import { app } from './locales/app';
import { dialogs } from './locales/dialogs';
import { workspace } from './locales/workspace';
import { workflows } from './locales/workflows';
import { usageStatus } from './locales/usage-status';
import { taskPresentation } from './locales/task-presentation';
import { promptTemplates } from './locales/prompt-templates';
import { conversationUpgrades } from './locales/conversation-upgrades';
import { workspaceUpgrades } from './locales/workspace-upgrades';
import { runtimeUpgrades } from './locales/runtime-upgrades';
import { desktopTools } from './locales/desktop-tools';
import { recovery } from './locales/recovery';
import { checkpointReview } from './locales/checkpoint-review';
import { reviewFixes } from './locales/review-fixes';
import { storageCompletion } from './locales/storage-completion';
import { accessCompletion } from './locales/access-completion';
import { approvalUsability } from './locales/approval-usability';
import { usabilityPresentation } from './locales/usability-presentation';
import { usabilityNavigation } from './locales/usability-navigation';
import { taskStatus } from './locales/task-status';

export type Locale = 'zh-CN' | 'en';
type Params = Record<string, string | number>;
const english: Record<string, string> = {
  ...app,
  ...dialogs,
  ...workspace,
  ...workflows,
  ...usageStatus,
  ...taskPresentation,
  ...promptTemplates,
  ...conversationUpgrades,
  ...workspaceUpgrades,
  ...runtimeUpgrades,
  ...desktopTools,
  ...recovery,
  ...checkpointReview,
  ...reviewFixes,
  ...storageCompletion,
  ...accessCompletion,
  ...approvalUsability,
  ...usabilityPresentation,
  ...usabilityNavigation,
  ...taskStatus,
};
const storageKey = 'grok-desktop.language';
let locale: Locale = 'zh-CN';
try {
  if (localStorage.getItem(storageKey) === 'en') locale = 'en';
} catch {
  // The main-process settings remain the source of truth when local storage is unavailable.
}
const listeners = new Set<() => void>();
export const getLocale = () => locale;
export function setLocale(value: string | undefined) {
  const next: Locale = value === 'en' ? 'en' : 'zh-CN';
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  if (next === locale) return;
  locale = next;
  try {
    localStorage.setItem(storageKey, next);
  } catch {
    /* Optional first-paint cache. */
  }
  for (const listener of listeners) listener();
}
export function translate(key: string, params?: Params): string {
  const text = locale === 'en' ? (english[key] ?? key) : key;
  return params
    ? text.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder,
      )
    : text;
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function useI18n() {
  const current = useSyncExternalStore(subscribe, getLocale, getLocale);
  return { t: translate, locale: current };
}
