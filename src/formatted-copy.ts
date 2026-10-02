function plainText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
  if (!(node instanceof HTMLElement)) return '';
  if (node.dataset.mathSource !== undefined) return node.dataset.mathSource;
  if (node.tagName === 'BR') return '\n';
  if (node.tagName === 'IMG') return node.getAttribute('alt') || '';
  if (node.tagName === 'PRE') return `${node.textContent || ''}\n\n`;
  if (node.tagName === 'TR')
    return `${[...node.children].map((child) => plainText(child).trim()).join('\t')}\n`;
  const text = [...node.childNodes].map(plainText).join('');
  if (node.tagName === 'LI') return `${text.trim()}\n`;
  if (/^(?:P|H[1-6]|UL|OL|BLOCKQUOTE|TABLE)$/.test(node.tagName)) return `${text.trim()}\n\n`;
  return text;
}

export function formattedClipboard(container: HTMLElement): { text: string; html: string } {
  const content = container.cloneNode(true) as HTMLElement;
  content
    .querySelectorAll('.code-toolbar,button,.stream-cursor,.message-actions')
    .forEach((node) => node.remove());
  for (const wrapper of content.querySelectorAll('.code-block'))
    wrapper.replaceWith(...wrapper.childNodes);
  return { text: plainText(content).trim(), html: content.innerHTML };
}
