/**
 * Detects and extracts LaTeX math expressions from Google / KaTeX math elements.
 *
 * @param {Node} node
 * @returns {string|null} Markdown math string or null if node is not a math element
 */
export function tryExtractMath(node) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;

  // 1. Element itself has data-xpm-latex or data-math
  if (node.hasAttribute('data-xpm-latex') || node.hasAttribute('data-math')) {
    const tex = (node.getAttribute('data-xpm-latex') || node.getAttribute('data-math') || '').trim();
    if (!tex) return null;
    const isBlock = node.parentElement && (
      node.parentElement.tagName.toLowerCase() === 'div' ||
      node.parentElement.classList.contains('display-math') ||
      node.parentElement.classList.contains('katex-display') ||
      (node.parentElement.getAttribute('role') === 'math' && node.parentElement.tagName.toLowerCase() === 'div')
    );
    return isBlock ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
  }

  // 2. KaTeX annotation
  if (node.tagName.toLowerCase() === 'annotation' && node.getAttribute('encoding') === 'application/x-tex') {
    const tex = node.textContent.trim();
    return tex ? `$${tex}$` : null;
  }

  // 3. Container wrapping a math element
  const mathChild = node.querySelector ? node.querySelector('[data-xpm-latex], [data-math], annotation[encoding="application/x-tex"]') : null;
  if (mathChild) {
    const tag = node.tagName.toLowerCase();
    const isContainer = (
      node.getAttribute('role') === 'math' ||
      node.classList.contains('katex') ||
      node.classList.contains('math-block') ||
      mathChild.parentElement === node ||
      (mathChild.parentElement?.parentElement === node && node.children.length <= 4)
    ) && !node.querySelector('p, h1, h2, h3, h4, h5, h6, table, pre, ul, ol');

    if (isContainer) {
      const tex = (
        mathChild.getAttribute('data-xpm-latex') ||
        mathChild.getAttribute('data-math') ||
        mathChild.textContent ||
        ''
      ).trim();
      if (!tex) return null;

      const isBlock = tag === 'div' ||
        node.classList.contains('katex-display') ||
        node.classList.contains('math-block') ||
        node.parentElement?.tagName.toLowerCase() === 'div';
      return isBlock ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
    }
  }

  return null;
}
