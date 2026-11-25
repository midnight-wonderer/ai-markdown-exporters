import { normalizeHeadingLevels } from '../shared/headings.js';
import { downloadMarkdown, getDateSlug, sanitizeFilename } from '../shared/download.js';
import { createGoogleTurndownService } from '../shared/markdown.js';

const turndown = createGoogleTurndownService();

// =========================================================================
// 1. CONVERSATION EXTRACTION & DOWNLOAD
// =========================================================================

async function extractGeminiThought(mrEl) {
  // 1. Check if thought-summary is already mounted in the DOM
  let container = mrEl.querySelector('thought-summary, .thought-steps') || document.querySelector('thought-summary, .thought-steps');

  // 2. If not mounted, open the "Show thinking steps" drawer on demand
  if (!container) {
    const moreBtn = mrEl.querySelector('[aria-label*="more options" i], [aria-label*="More" i]');
    if (moreBtn) {
      moreBtn.click();
      await new Promise((r) => setTimeout(r, 60));

      const menuItems = Array.from(document.querySelectorAll('gem-menu-item, [role="menuitem"], button'));
      const thinkingItem = menuItems.find((el) =>
        /thinking steps/i.test(el.textContent || el.getAttribute('aria-label') || '')
      );

      if (thinkingItem) {
        thinkingItem.click();
        await new Promise((r) => setTimeout(r, 100));
        container = document.querySelector('thought-summary, .thought-steps');

        const closeBtn = document.querySelector('context-sidebar [aria-label*="close" i], context-sidebar button');
        if (closeBtn) closeBtn.click();
      } else {
        moreBtn.click(); // Close popover
      }
    }
  }

  if (!container) return '';

  const stepEls = container.querySelectorAll('.thought-step-container');
  if (stepEls.length > 0) {
    const steps = Array.from(stepEls).map((el) => {
      const title = el.querySelector('.thought-step-title')?.textContent?.replace(/\s+/g, ' ').trim() || '';
      const contentEl = el.querySelector('.thought-content');
      if (!contentEl) return title ? `**${title}**` : '';

      const clone = contentEl.cloneNode(true);
      clone.querySelector('.thought-step-title')?.remove();
      clone.querySelectorAll('button, gem-icon-button, .code-execution-actions, .timeline-track, .code-line-count').forEach((b) => b.remove());

      // If code-execution-block is present, ensure language header isn't squashed into code
      clone.querySelectorAll('.code-execution-block').forEach((block) => {
        const lang = block.querySelector('.code-language')?.textContent?.trim() || '';
        const codeNode = block.querySelector('pre, code') || block;
        const codeText = codeNode.textContent.replace(/^\n+|\n+$/g, '');
        const mdCode = document.createElement('pre');
        mdCode.textContent = `\`\`\`${lang.toLowerCase()}\n${codeText}\n\`\`\``;
        block.replaceWith(mdCode);
      });

      const body = turndown.turndown(clone).trim();
      return title && body ? `**${title}**\n\n${body}` : title || body;
    }).filter(Boolean);

    if (steps.length > 0) {
      return steps.join('\n\n').trim();
    }
  }

  // Fallback to turndown on container if not using .thought-step-container
  return turndown.turndown(container).trim();
}

function extractGeminiSources(mrEl) {
  const sources = [];
  const seen = new Set();
  const sourceContainers = mrEl.querySelectorAll(
    'sources-list, .sources-list, [class*="sources"], .source-inline-chip-container, [data-test-id*="source"], [aria-label*="Source"]'
  );
  const searchScope = sourceContainers.length > 0 ? Array.from(sourceContainers) : [mrEl];

  for (const container of searchScope) {
    const anchors = container.querySelectorAll('a[href]');
    for (const a of anchors) {
      let href = a.getAttribute('href') || '';
      const text = (a.getAttribute('aria-label') || a.textContent || '').replace(/\s+/g, ' ').trim();
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;
      if (href.startsWith('/url?') || href.includes('google.com/url?')) {
        try {
          const u = new URL(href, window.location.origin);
          href = u.searchParams.get('q') || u.searchParams.get('url') || href;
        } catch (_) {}
      }
      if (!text || text.length < 2) continue;
      if (!seen.has(href)) {
        seen.add(href);
        sources.push({ title: text, url: href });
      }
    }
  }
  return sources;
}

async function downloadConversationAsMarkdown() {
  let chatTitle = 'Gemini Conversation';
  const titleEl = document.querySelector('title, [data-test-id="conversation-title"], .conversation-title');
  if (titleEl && titleEl.textContent) {
    chatTitle = titleEl.textContent
      .replace(/\s*-\s*Google Gemini$/i, '')
      .replace(/\s*-\s*Gemini$/i, '')
      .replace(/^Gemini\s*-\s*/i, '')
      .trim();
  }

  let containers = Array.from(document.querySelectorAll('.conversation-container'));
  if (containers.length === 0) {
    const queries = Array.from(document.querySelectorAll('user-query'));
    const responses = Array.from(document.querySelectorAll('model-response'));
    containers = [];
    const len = Math.max(queries.length, responses.length);
    for (let i = 0; i < len; i++) {
      containers.push({ userQuery: queries[i] || null, modelResponse: responses[i] || null });
    }
  }

  const timestamp = new Date().toISOString();
  const url = window.location.href;

  let markdown = `---\n`;
  markdown += `title: ${JSON.stringify(chatTitle)}\n`;
  markdown += `source: "gemini"\n`;
  markdown += `exported_at: "${timestamp}"\n`;
  markdown += `url: "${url}"\n`;
  markdown += `---\n\n`;

  let turnCount = 0;

  for (const item of containers) {
    const uqEl = item instanceof HTMLElement ? item.querySelector('user-query') : item.userQuery;
    const mrEl = item instanceof HTMLElement ? item.querySelector('model-response') : item.modelResponse;

    if (uqEl) {
      const contentHolder = uqEl.querySelector('.query-text, .rendered-markdown-query, .query-content') || uqEl;
      const uqText = turndown.turndown(contentHolder).trim();
      if (uqText) {
        markdown += `## User\n\n${uqText}\n\n---\n\n`;
        turnCount++;
      }
    }

    if (mrEl) {
      let assistantContent = '';
      const thoughtText = await extractGeminiThought(mrEl);
      if (thoughtText) {
        assistantContent += `<details data-type="thought">\n<summary>Thought Process</summary>\n\n${thoughtText}\n\n</details>\n\n`;
      }

      const responseHolder = mrEl.querySelector('message-content .markdown, message-content, .model-response-text') || mrEl;
      const mrText = turndown.turndown(responseHolder).trim();
      if (mrText) {
        assistantContent += `${normalizeHeadingLevels(mrText)}\n\n`;

        const sources = extractGeminiSources(mrEl);
        if (sources.length > 0) {
          assistantContent += `### Sources\n\n`;
          sources.forEach((s, idx) => {
            assistantContent += `${idx + 1}. [${s.title}](${s.url})\n`;
          });
          assistantContent += `\n`;
        }

        markdown += `## Assistant\n\n${assistantContent}---\n\n`;
        turnCount++;
      }
    }
  }

  if (turnCount === 0) {
    alert('No conversation turns found to export.');
    return;
  }

  markdown = markdown.replace(/\n{3,}/g, '\n\n').trim() + '\n';
  const safeTitle = sanitizeFilename(chatTitle, 50);
  const dateSlug = getDateSlug();
  const filename = `gemini_${safeTitle || 'chat'}_${dateSlug}.md`;

  downloadMarkdown(filename, markdown);
}

// =========================================================================
// 2. ZERO-BLOAT NATIVE INJECTION (Composer Bar + Menus)
// =========================================================================

function createDownloadIcon(size = 18, withPadding = false) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.style.cssText = `vertical-align: middle; flex-shrink: 0; ${withPadding ? 'padding: 0 0.125rem;' : ''}`;

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4');

  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  polyline.setAttribute('points', '7 10 12 15 17 10');

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', '12');
  line.setAttribute('y1', '15');
  line.setAttribute('x2', '12');
  line.setAttribute('y2', '3');

  svg.appendChild(path);
  svg.appendChild(polyline);
  svg.appendChild(line);
  return svg;
}

function injectComposerExportButton() {
  const wrapper = document.querySelector('.trailing-actions-wrapper');
  if (!wrapper || wrapper.querySelector('.gemini-composer-export-btn')) return;

  const btn = document.createElement('button');
  btn.className = 'gemini-composer-export-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Export chat as Markdown');
  btn.setAttribute('title', 'Export chat as Markdown');
  btn.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: none;
    background: transparent;
    color: var(--mat-icon-color, inherit);
    cursor: pointer;
    margin: 0 2px;
    padding: 0;
    transition: background-color 0.15s cubic-bezier(0.2, 0, 1);
    vertical-align: middle;
    outline: none;
    flex-shrink: 0;
  `;

  btn.appendChild(createDownloadIcon(18, false));

  btn.onmouseenter = () => {
    btn.style.backgroundColor = 'var(--mat-icon-button-ripple-color, rgba(255, 255, 255, 0.08))';
  };
  btn.onmouseleave = () => {
    btn.style.backgroundColor = 'transparent';
  };
  btn.onmousedown = () => {
    btn.style.backgroundColor = 'rgba(255, 255, 255, 0.14)';
  };
  btn.onmouseup = () => {
    btn.style.backgroundColor = 'var(--mat-icon-button-ripple-color, rgba(255, 255, 255, 0.08))';
  };

  btn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    downloadConversationAsMarkdown();
  };

  const rightGroup = wrapper.querySelector('.input-buttons-wrapper-bottom');
  if (rightGroup && rightGroup.parentNode === wrapper) {
    wrapper.insertBefore(btn, rightGroup);
  } else {
    wrapper.appendChild(btn);
  }
}

function injectExportMenuItem(popover) {
  if (!popover || popover.querySelector('.gemini-export-md-item')) return;

  const menuContainer =
    popover.querySelector('gem-menu, [role="menu"], .gem-menu, mat-nav-list, .mat-mdc-menu-content') || popover;

  const sibling = menuContainer.querySelector('button, [role="menuitem"], gem-menu-item');

  let menuItem;
  if (sibling) {
    menuItem = sibling.cloneNode(true);
    menuItem.classList.add('gemini-export-md-item');
    menuItem.removeAttribute('id');
    menuItem.removeAttribute('jslog');
    menuItem.removeAttribute('data-ved');

    const textEl =
      menuItem.querySelector('.gem-menu-item-label, .mat-mdc-menu-item-text, span:last-child') || menuItem;
    textEl.textContent = 'Export as Markdown';

    const iconEl = menuItem.querySelector('.gem-menu-item-icon, mat-icon, gem-icon, svg');
    if (iconEl) {
      while (iconEl.firstChild) iconEl.removeChild(iconEl.firstChild);
      iconEl.appendChild(createDownloadIcon(16, true));
    }
  } else {
    menuItem = document.createElement('button');
    menuItem.className = 'mat-mdc-menu-item lm-menu-item-theme gemini-export-md-item';
    menuItem.setAttribute('role', 'menuitem');
    menuItem.style.cssText = `
      display: flex;
      align-items: center;
      width: 100%;
      padding: 10px 16px;
      border: none;
      background: transparent;
      color: inherit;
      font-family: inherit;
      font-size: 14px;
      cursor: pointer;
      text-align: left;
      box-sizing: border-box;
    `;
    menuItem.appendChild(createDownloadIcon(16, true));
    const labelSpan = document.createElement('span');
    labelSpan.textContent = 'Export as Markdown';
    menuItem.appendChild(labelSpan);
  }

  menuItem.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();

    const closeTrigger = document.querySelector(
      'conversation-actions-icon button, conversation-action-menu button, [data-test-id="more-menu-button"] button'
    );
    if (closeTrigger) {
      closeTrigger.click();
    } else {
      popover.removeAttribute('open');
    }

    downloadConversationAsMarkdown();
  };

  const existingItems = Array.from(menuContainer.querySelectorAll('button, [role="menuitem"], gem-menu-item'));
  const pdfItem = existingItems.find((el) => /\b(pdf|print)\b/i.test(el.textContent));

  if (pdfItem && pdfItem.parentNode) {
    pdfItem.parentNode.insertBefore(menuItem, pdfItem.nextSibling);
  } else {
    menuContainer.appendChild(menuItem);
  }
}

// Unified observer
const observer = new MutationObserver(() => {
  injectComposerExportButton();

  const pdfButtons = Array.from(
    document.querySelectorAll('button, [role="menuitem"], gem-menu-item, .mat-mdc-menu-item')
  ).filter(
    (el) => /\b(pdf|print)\b/i.test(el.textContent) && !el.classList.contains('gemini-export-md-item')
  );

  for (const pdfBtn of pdfButtons) {
    const container =
      pdfBtn.closest('gem-popover, gem-menu, [role="menu"], .mat-mdc-menu-content, mat-nav-list') ||
      pdfBtn.parentElement;
    if (container && !container.querySelector('.gemini-export-md-item')) {
      injectExportMenuItem(container);
      return;
    }
  }

  const activePopover = document.querySelector(
    'conversation-action-menu gem-popover, top-bar-actions gem-popover, [data-test-id="more-menu-button"] + gem-popover, .more-menu-button-container gem-popover'
  );
  if (activePopover && activePopover.children.length > 0) {
    injectExportMenuItem(activePopover);
  }
});

observer.observe(document.body, { childList: true, subtree: true });
injectComposerExportButton();
