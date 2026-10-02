import { renderToString } from 'katex';

export function renderMath(node: HTMLElement) {
  const expressions = [
    ...(node.matches('[data-math-source]') ? [node] : []),
    ...node.querySelectorAll<HTMLElement>('[data-math-source]'),
  ];
  for (const expression of expressions) {
    if (expression.dataset.mathRendered) continue;
    try {
      const html = renderToString(expression.dataset.mathSource || '', {
        displayMode: expression.dataset.mathDisplay === 'true',
        throwOnError: true,
        trust: false,
        strict: 'ignore',
        output: 'htmlAndMathml',
      });
      expression.innerHTML = html;
      expression.dataset.mathRendered = 'true';
    } catch {
      // Incomplete or unsupported formulas keep their readable original source.
    }
  }
}
