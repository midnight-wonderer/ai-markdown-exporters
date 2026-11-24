/**
 * Normalizes Markdown heading levels so that top-level section headings
 * begin at level 3 (###) under the main turn heading (## Assistant).
 *
 * Code blocks fenced with ``` or ~~~ are safely skipped.
 * Indented code blocks (4 spaces or tab) are also skipped.
 *
 * @param {string} markdown
 * @param {number} [targetMinLevel=3]
 * @returns {string}
 */
export function normalizeHeadingLevels(markdown, targetMinLevel = 3) {
  if (!markdown) return '';
  const lines = markdown.split('\n');

  let activeFence = null;
  const levels = new Set();

  function checkFence(line) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (!match) return false;

    const fenceStr = match[1];
    const fenceChar = fenceStr[0];
    const fenceLen = fenceStr.length;

    if (!activeFence) {
      activeFence = { char: fenceChar, length: fenceLen };
      return true;
    }
    if (activeFence.char === fenceChar && fenceLen >= activeFence.length) {
      activeFence = null;
      return true;
    }
    return false;
  }

  // Pass 1: Identify unique heading levels outside code blocks
  for (const line of lines) {
    if (checkFence(line)) continue;
    if (activeFence) continue;
    if (/^( {4,}|\t)/.test(line)) continue;

    const match = line.match(/^ {0,3}(#{1,6})\s+/);
    if (match) {
      levels.add(match[1].length);
    }
  }

  if (levels.size === 0) return markdown;

  const sortedLevels = Array.from(levels).sort((a, b) => a - b);
  const levelMap = new Map();
  sortedLevels.forEach((raw, idx) => {
    levelMap.set(raw, Math.min(targetMinLevel + idx, 6));
  });

  // Pass 2: Remap heading levels
  activeFence = null;
  return lines
    .map((line) => {
      if (checkFence(line)) return line;
      if (activeFence) return line;
      if (/^( {4,}|\t)/.test(line)) return line;

      const match = line.match(/^( {0,3})(#{1,6})(\s+.*)$/);
      if (match && levelMap.has(match[2].length)) {
        const newLevel = levelMap.get(match[2].length);
        return match[1] + '#'.repeat(newLevel) + match[3];
      }
      return line;
    })
    .join('\n');
}
