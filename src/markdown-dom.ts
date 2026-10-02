import DOMPurify from 'dompurify';
import { translate } from './i18n';
import { conversationMarkdown } from './markdown-math';
import type { TokensList } from 'marked';

type RenderedBlock = { html: string; nodes: Node[] };
const renderedBlocks = new WeakMap<HTMLElement, RenderedBlock[]>();

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
  if (node.matches('[data-math-source]') || node.querySelector('[data-math-source]'))
    void import('./math-render').then((module) => module.renderMath(node));
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
  // Lex the complete document so appended reference definitions still resolve earlier links.
  // Retain each unchanged rendered block; sanitize only HTML which actually changed.
  const tokens = conversationMarkdown.lexer(text);
  const previous = renderedBlocks.get(container) || [];
  const blocks: RenderedBlock[] = [];
  for (const token of tokens) {
    if (token.type === 'space') continue;
    const single = [token] as TokensList;
    single.links = tokens.links;
    const html = conversationMarkdown.parser(single);
    if (!html) continue;
    const old = previous[blocks.length];
    blocks.push(
      old?.html === html
        ? old
        : {
            html,
            nodes: Array.from(DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true }).childNodes),
          },
    );
  }
  let current = container.firstChild;
  for (const block of blocks)
    for (let index = 0; index < block.nodes.length; index++) {
      const node = block.nodes[index];
      if (current && node === current) {
        current = current.nextSibling;
        continue;
      }
      const next = current?.nextSibling || null;
      if (current && (originals.get(current) || current).isEqualNode(node)) {
        block.nodes[index] = current;
      } else {
        const original = node.cloneNode(true);
        const decorated = decorateCodeBlocks(node);
        originals.set(decorated, original);
        if (current) container.replaceChild(decorated, current);
        else container.appendChild(decorated);
        block.nodes[index] = decorated;
      }
      current = next;
    }
  while (current) {
    const next = current.nextSibling;
    container.removeChild(current);
    current = next;
  }
  renderedBlocks.set(container, blocks);
}
