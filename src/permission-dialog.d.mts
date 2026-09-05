import type { PermissionRequest } from './types';
export function permissionChoice(option: PermissionRequest['options'][number]): {
  label: string;
  description: string;
  original: string;
};
export function permissionOverview(toolCall?: PermissionRequest['toolCall']): {
  title: string;
  preview: string;
  sections: { label: string; text: string }[];
};
