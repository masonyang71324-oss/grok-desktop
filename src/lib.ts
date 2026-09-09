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
    /^(?:workspace\.(?:list|read|changes|diff)|sessions\.list|session\.usage|account\.usage|tasks\.list|checkpoints\.(?:list|detail)|runner\.(?:inspect|state)|update\.(?:status|check))$/.test(
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
export function classifyFailure(error: unknown): {
  kind: string;
  title: string;
  description: string;
  action: 'login' | 'usage' | 'reconnect' | 'retry' | 'settings';
} {
  const message = errorText(error);
  if (
    /grok.*(?:not found|找不到|未找到)|(?:spawn|executable).*ENOENT|Grok executable/i.test(message)
  )
    return {
      kind: 'setup',
      title: t('找不到 Grok 程序'),
      description: t('请在设置中选择 Grok 程序，再重新连接。'),
      action: 'settings',
    };
  if (
    /\b401\b|unauthorized|not logged in|authentication|login.*expired|未登录|登录.*过期/i.test(
      message,
    )
  )
    return {
      kind: 'auth',
      title: t('需要重新登录'),
      description: t('登录后可回到当前会话，草稿会保留。'),
      action: 'login',
    };
  if (/\b429\b|rate.?limit|quota|credits.*(?:exceed|insufficient)|额度|频率限制/i.test(message))
    return {
      kind: 'usage',
      title: t('额度或请求频率受限'),
      description: t('查看套餐用量和重置时间，稍后再继续。'),
      action: 'usage',
    };
  if (
    /ECONNRESET|ECONNREFUSED|network|timed?\s*out|timeout|连接.*(?:关闭|断开|失败)|进程.*退出/i.test(
      message,
    )
  )
    return {
      kind: 'connection',
      title: t('连接中断'),
      description: t('重新连接会保留现有会话，任务不会自动重发。'),
      action: 'reconnect',
    };
  return {
    kind: 'task',
    title: t('本次操作未完成'),
    description: t('内容已保留，请确认已有修改后再重试。'),
    action: 'retry',
  };
}
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
