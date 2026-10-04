import { Marked } from 'marked';

function escaped(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function mathHtml(token: { text: string; raw: string; display: boolean }) {
  return `<span class="math-source" data-math-source="${escaped(token.text)}" data-math-display="${token.display ? 'true' : 'false'}">${escaped(token.raw)}</span>${token.display ? '\n' : ''}`;
}

export const conversationMarkdown = new Marked({ async: false, gfm: true, breaks: true });
conversationMarkdown.use({
  // Model-authored HTML is displayed as source. Only Markdown renderers and our
  // math extension may create elements, classes or attributes in the app DOM.
  renderer: { html: ({ text }) => escaped(text) },
  extensions: [
    {
      name: 'blockMath',
      level: 'block',
      start: (source: string) => source.match(/^(?:\$\$|\\\[)/m)?.index,
      tokenizer(source: string) {
        const match =
          /^(?:\$\$[ \t]*\n([\s\S]+?)\n\$\$[ \t]*(?:\n|$)|\\\[[ \t]*\n([\s\S]+?)\n\\\][ \t]*(?:\n|$)|\$\$([^\n]+?)\$\$[ \t]*(?:\n|$))/.exec(
            source,
          );
        if (match)
          return {
            type: 'blockMath',
            raw: match[0],
            text: (match[1] || match[2] || match[3]).trim(),
            display: true,
          };
      },
      renderer: (token) =>
        mathHtml(token as unknown as { text: string; raw: string; display: boolean }),
    },
    {
      name: 'inlineMath',
      level: 'inline',
      start: (source: string) => source.match(/\$|\\\(/)?.index,
      tokenizer(source: string) {
        const match = /^(?:\$([^\s$](?:[^\n$]*?[^\s$])?)\$(?!\d)|\\\(([^\n]+?)\\\))/.exec(source);
        if (!match) return;
        const text = match[1] || match[2];
        // A bare amount is currency; math remains available through \(...\).
        if (match[1] && /^\d[\d,.]*$/.test(text)) return;
        return { type: 'inlineMath', raw: match[0], text, display: false };
      },
      renderer: (token) =>
        mathHtml(token as unknown as { text: string; raw: string; display: boolean }),
    },
  ],
});
