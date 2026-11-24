/**
 * Triggers a client-side download of a Markdown file.
 *
 * @param {string} filename
 * @param {string} content
 */
export function downloadMarkdown(filename, content) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Returns today's ISO date slug formatted as YYYY-MM-DD.
 * @returns {string}
 */
export function getDateSlug() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Sanitizes a title string for use in a filename.
 * @param {string} text
 * @param {number} [maxLength=40]
 * @returns {string}
 */
export function sanitizeFilename(text, maxLength = 40) {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength);
}
