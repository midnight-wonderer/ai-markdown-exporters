import sanitize from 'sanitize-filename';

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
 * Sanitizes an untrusted title string into a safe filesystem filename,
 * preserving international unicode characters while stripping illegal OS characters.
 *
 * @param {string} text
 * @param {number} [maxLength=50]
 * @returns {string}
 */
export function sanitizeFilename(text, maxLength = 50) {
  if (!text) return '';
  const sanitized = sanitize(text.trim(), { replacement: '_' })
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return sanitized.slice(0, maxLength);
}
