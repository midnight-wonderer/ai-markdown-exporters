/**
 * Formats a <table> DOM element into a GitHub Flavored Markdown table string.
 *
 * @param {HTMLTableElement} tableEl
 * @param {(cell: HTMLElement) => string} [cellSerializer] Optional custom serializer for cell contents
 * @returns {string}
 */
export function renderTableToMarkdown(tableEl, cellSerializer) {
  if (!tableEl) return '';
  const rows = Array.from(tableEl.querySelectorAll('tr'));
  if (rows.length === 0) return '';

  const matrix = [];
  rows.forEach((row) => {
    const cells = Array.from(row.querySelectorAll('th, td')).map((cell) => {
      if (cellSerializer) {
        return cellSerializer(cell).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
      }
      return cell.textContent.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
    });
    if (cells.length > 0) matrix.push(cells);
  });

  if (matrix.length === 0) return '';
  const maxCols = Math.max(...matrix.map((r) => r.length));
  const normalized = matrix.map((row) => {
    const copy = [...row];
    while (copy.length < maxCols) copy.push('');
    return copy;
  });

  let md = '\n\n| ' + normalized[0].join(' | ') + ' |\n';
  md += '| ' + new Array(maxCols).fill('---').join(' | ') + ' |\n';
  for (let i = 1; i < normalized.length; i++) {
    md += '| ' + normalized[i].join(' | ') + ' |\n';
  }
  return md + '\n\n';
}
