import type { Result } from './types';
import { getLocale, translate as t } from './i18n';
export async function request<T = any>(
  command: string,
  payload?: any,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  if (!window.desktop) throw new Error(t('请通过 Grok Desktop 桌面程序打开此界面。'));
  // Human dialogs and state-changing operations keep their main-process lifetime.
  // A renderer timeout does not cancel an IPC operation, so only safe reads use it by default.
  const safeRead =
    /^(?:workspace\.(?:list|read|changes|diff)|sessions\.list|session\.usage|account\.usage)$/.test(
      command,
    );
  const timeoutMs = options.timeoutMs ?? (safeRead ? 60000 : 0);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waiting = window.desktop.request<T>(command, payload);
  const result: Result<T> = await (
    timeoutMs > 0
      ? Promise.race([
          waiting,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error(t('读取等待超时，请稍后刷新。'))), timeoutMs);
          }),
        ])
      : waiting
  ).finally(() => clearTimeout(timer));
  if (!result.ok)
    throw new Error(result.error === '不支持的操作。' ? t(result.error) : result.error);
  return result.data;
}
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() || path;
export function readableDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(getLocale(), { month: 'numeric', day: 'numeric' });
}
export async function copy(text: string) {
  await request('clipboard.write', { text });
}
