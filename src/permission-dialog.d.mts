import type { PermissionRequest } from './types';
export function permissionChoice(option: PermissionRequest['options'][number]): {
  label: string;
  description: string;
  original: string;
};
export function permissionOverview(
  toolCall?: PermissionRequest['toolCall'],
  cwd?: string,
): {
  title: string;
  preview: string;
  sections: { label: string; text: string }[];
  cwd: string;
  diffs: { path: string; text: string }[];
  risks: { kind: 'delete' | 'reset' | 'force-push'; title: string; description: string }[];
  raw: string;
};
