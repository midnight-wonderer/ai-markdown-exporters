import TurndownService from 'turndown';
import { gfm } from '@joplin/turndown-plugin-gfm';
import { tryExtractMath } from './math.js';

/**
 * Creates and configures a TurndownService tailored for Google AI web interfaces.
 *
 * @param {object} [options]
 * @param {Array<string>} [options.removeSelectors] Additional selectors to drop
 * @returns {TurndownService}
 */
export function createGoogleTurndownService(options = {}) {
  const service = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
  });

  service.use(gfm);

  // 1. Math formulas (LaTeX via data-math, data-xpm-latex, or KaTeX annotation)
  service.addRule('googleMath', {
    filter: (node) => tryExtractMath(node) !== null,
    replacement: (_content, node) => tryExtractMath(node),
  });

  // 2. Clamped Headings: subheadings inside turns start at level 3 (###) up to 6
  service.addRule('clampedHeadings', {
    filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    replacement: (content, node) => {
      const rawLevel = parseInt(node.tagName[1], 10);
      const level = Math.min(Math.max(rawLevel >= 3 ? rawLevel : rawLevel + 2, 3), 6);
      const text = content.trim();
      return text ? `\n\n${'#'.repeat(level)} ${text}\n\n` : '';
    },
  });

  // 3. Mark / Highlight
  service.addRule('mark', {
    filter: 'mark',
    replacement: (content) => {
      const text = content.trim();
      return text ? `==${text}==` : '';
    },
  });

  // 4. Subscript / Superscript
  service.addRule('subscript', {
    filter: 'sub',
    replacement: (content) => (content.trim() ? `<sub>${content.trim()}</sub>` : ''),
  });
  service.addRule('superscript', {
    filter: 'sup',
    replacement: (content) => (content.trim() ? `<sup>${content.trim()}</sup>` : ''),
  });

  // 5. Google Link redirect unwrap
  service.addRule('unwrapGoogleLinks', {
    filter: 'a',
    replacement: (content, node) => {
      let href = node.getAttribute('href') || '';
      const text = content.trim();
      if (!href || href.startsWith('javascript:') || href.startsWith('#') || !text) {
        return text;
      }
      if (href.startsWith('/url?') || href.includes('google.com/url?')) {
        try {
          const u = new URL(href, window.location.origin);
          href = u.searchParams.get('q') || u.searchParams.get('url') || href;
        } catch (_) {}
      }
      try {
        const u = new URL(href, window.location.origin);
        if (
          u.hostname.endsWith('google.com') &&
          (u.pathname.startsWith('/search') || u.pathname.startsWith('/preferences') || href.includes('ibp=oshop'))
        ) {
          return text;
        }
      } catch (_) {}

      return `[${text}](${href})`;
    },
  });

  // 6. Gemini & Google AI Mode code-block components
  service.addRule('codeBlockComponent', {
    filter: (node) =>
      node.nodeType === 1 &&
      (node.getAttribute('data-testid') === 'code-block' ||
        node.tagName.toLowerCase() === 'code-block' ||
        node.tagName.toLowerCase() === 'pre'),
    replacement: (_content, node) => {
      let lang = '';

      // Check Gemini semantic attributes or class patterns
      const langEl = node.querySelector?.(
        '[variant="body-medium-emphasized"], .code-block-decoration, .code-block-header span, [class*="language-"]'
      );
      if (langEl) {
        const text = langEl.textContent.trim().toLowerCase();
        if (text && !text.includes('code snippet') && !text.includes('copy') && !text.includes('download') && !text.includes('caution')) {
          lang = text.replace(/^language-/, '').split(/\s+/)[0];
        }
      }

      // If lang not found on node itself, search upward for a preceding language label element
      if (!lang) {
        let curr = node;
        while (curr && curr.tagName.toLowerCase() !== 'body') {
          let prev = curr.previousElementSibling;
          while (prev) {
            const text = prev.textContent.trim().toLowerCase();
            if (text && text.length < 25 && !text.includes(' ') && !text.includes('copy') && !text.includes('caution')) {
              lang = text;
              break;
            }
            prev = prev.previousElementSibling;
          }
          if (lang) break;
          curr = curr.parentElement;
        }
      }

      const codeNode = node.querySelector?.('[data-testid="code-content"]') || node;
      const clone = codeNode.cloneNode(true);
      clone.querySelectorAll?.('button, gem-icon-button, .code-block-header').forEach((b) => b.remove());
      const codeContent = clone.textContent.replace(/^\n+|\n+$/g, '');

      let md = `\n\n\`\`\`${lang}\n${codeContent}\n\`\`\`\n\n`;
      const outputNode = node.querySelector?.('[data-testid="code-output-stdout-stderr"]');
      if (outputNode && outputNode.textContent.trim()) {
        md += `> **Output:**\n\`\`\`\n${outputNode.textContent.trim()}\n\`\`\`\n\n`;
      }
      return md;
    },
  });

  // 7. Images: preserve substantive content images, drop icons & tracking pixels
  service.addRule('filterImages', {
    filter: 'img',
    replacement: (_content, node) => {
      const src = node.getAttribute('src') || '';
      const alt = node.getAttribute('alt') || '';
      if (!src || src.startsWith('data:image/gif;base64,R0lGOD')) {
        return '';
      }
      const w = parseInt(node.getAttribute('width') || node.style?.width || '0', 10);
      const h = parseInt(node.getAttribute('height') || node.style?.height || '0', 10);
      if ((w > 0 && w <= 48) || (h > 0 && h <= 48)) {
        return '';
      }
      if (node.closest('a, button, [role="button"]') && (src.includes('favicon') || src.startsWith('data:'))) {
        return '';
      }
      if (src.startsWith('data:') && !alt) {
        return '';
      }
      return alt ? `\n\n![${alt}](${src})\n\n` : `\n\n![](${src})\n\n`;
    },
  });

  // 8. Strip chrome, hidden elements & noisy UI components
  const removeSelectors = [
    'script',
    'style',
    'noscript',
    'button',
    'svg',
    'gem-icon',
    'mat-icon',
    'gem-icon-button',
    'message-actions',
    'sources-list',
    '[aria-hidden="true"]',
    '.cdk-visually-hidden',
    '.screen-reader-user-query-label',
    '.screen-reader-model-response-label',
    '.luminous-actions-container',
    '.response-footer',
    '.hide-on-print',
    '[data-suppress-highlight-to-ask]',
    '[data-skip-highlighting]',
    '[data-ignore-copy]',
    '[data-xid="Gd7Hsc"]',
    '[data-xid="aim-aside-initial-corroboration-container"]',
    '[role="progressbar"]',
    '[role="status"]',
    '[role="alert"]',
  ];

  if (Array.isArray(options.removeSelectors)) {
    removeSelectors.push(...options.removeSelectors);
  }

  const combinedSelector = removeSelectors.join(', ');

  service.addRule('stripChromeAndHighlights', {
    filter: (node) => {
      if (node.nodeType !== 1) return false;
      if (node.style && node.style.display === 'none') return true;
      const text = node.textContent?.trim();
      if (text === '[Highlight start]' || text === '[Highlight end]') return true;
      if (text === 'Use code with caution.' || text.startsWith('Use code with caution')) return true;
      if (text === 'Copy code text to clipboard' || text.startsWith('Copy code')) return true;

      // Language label element placed immediately before a code container
      const next = node.nextElementSibling;
      if (next && next.querySelector && next.querySelector('pre')) {
        if (text && text.length < 25 && !text.includes(' ') && !text.includes('\n')) {
          return true;
        }
      }

      if (node.matches && node.matches(combinedSelector)) return true;
      return false;
    },
    replacement: () => '',
  });

  return service;
}
