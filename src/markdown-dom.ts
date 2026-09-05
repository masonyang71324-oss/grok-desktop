import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { translate } from './i18n';

function decorateCodeBlocks(node: Node): Node {
  if (!(node instanceof HTMLElement)) return node;
  let result: Node = node;
  const blocks = [
    ...(node.matches('pre') ? [node] : []),
    ...node.querySelectorAll<HTMLElement>('pre'),
  ];
  for (const pre of blocks) {
    const code = pre.querySelector<HTMLElement>('code');
    if (!code) continue;
    const language =
      [...code.classList].find((name) => name.startsWith('language-'))?.slice(9) || '';
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block';
    const toolbar = document.createElement('div');
    toolbar.className = 'code-toolbar';
    const label = document.createElement('span');
    if (!language) label.dataset.codePlainText = '';
    label.textContent = language || translate('纯文本');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.copyCode = '';
    button.textContent = translate('复制代码');
    button.setAttribute('aria-live', 'polite');
    toolbar.append(label, button);
    pre.replaceWith(wrapper);
    wrapper.append(toolbar, pre);
    if (pre === node) result = wrapper;
    // A changing code block can disappear before this runs; completed blocks are retained.
    if (language)
      window.setTimeout(() => {
        if (code.isConnected)
          void import('./code-highlight')
            .then((module) => module.highlightCode(code, language))
            .catch(() => {});
      }, 80);
  }
  return result;
}

export function updateMarkdownLabels(container: HTMLElement) {
  for (const label of container.querySelectorAll<HTMLElement>('[data-code-plain-text]'))
    label.textContent = translate('纯文本');
  for (const button of container.querySelectorAll<HTMLButtonElement>('button[data-copy-code]'))
    button.textContent = translate(button.dataset.copyState || '复制代码');
}

export function updateMarkdown(
  container: HTMLElement,
  text: string,
  originals: WeakMap<Node, Node>,
) {
  // Keep full-document parsing: later reference definitions can change earlier links.
  const fragment = DOMPurify.sanitize(
    marked.parse(text, { async: false, gfm: true, breaks: true }) as string,
    { RETURN_DOM_FRAGMENT: true },
  );
  let current = container.firstChild;
  for (const node of Array.from(fragment.childNodes)) {
    const next = current?.nextSibling || null;
    if (!current || !(originals.get(current) || current).isEqualNode(node)) {
      const original = node.cloneNode(true);
      const decorated = decorateCodeBlocks(node);
      originals.set(decorated, original);
      if (current) container.replaceChild(decorated, current);
      else container.appendChild(decorated);
    }
    current = next;
  }
  while (current) {
    const next = current.nextSibling;
    container.removeChild(current);
    current = next;
  }
}
