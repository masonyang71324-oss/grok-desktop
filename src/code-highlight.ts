import hljs from 'highlight.js/lib/core';

const languages = {
  javascript: () => import('highlight.js/lib/languages/javascript'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  json: () => import('highlight.js/lib/languages/json'),
  python: () => import('highlight.js/lib/languages/python'),
  bash: () => import('highlight.js/lib/languages/bash'),
  powershell: () => import('highlight.js/lib/languages/powershell'),
  css: () => import('highlight.js/lib/languages/css'),
  xml: () => import('highlight.js/lib/languages/xml'),
};
const aliases: Record<string, keyof typeof languages> = {
  js: 'javascript',
  jsx: 'javascript',
  javascript: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  typescript: 'typescript',
  json: 'json',
  py: 'python',
  python: 'python',
  sh: 'bash',
  shell: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  pwsh: 'powershell',
  powershell: 'powershell',
  css: 'css',
  html: 'xml',
  xml: 'xml',
  svg: 'xml',
};
const pending = new Map<string, Promise<void>>();

export async function highlightCode(code: HTMLElement, label: string) {
  const language = aliases[label.toLowerCase()];
  if (!language) return;
  if (!pending.has(language))
    pending.set(
      language,
      languages[language]().then((module) => {
        hljs.registerLanguage(language, module.default);
      }),
    );
  await pending.get(language);
  if (!code.isConnected) return;
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed && selection.containsNode(code, true)) return;
  const highlighted = hljs.highlight(code.textContent || '', { language, ignoreIllegals: true });
  code.innerHTML = highlighted.value;
  code.classList.add('hljs');
}
