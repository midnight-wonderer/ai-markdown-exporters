// ==UserScript==
// @name         Gemini Chat Markdown Exporter
// @namespace    https://gemini.google.com/
// @version      2.0.0
// @description  Adds a native "Export as Markdown" action to Gemini's top-bar conversation menu.
// @author       Antigravity
// @match        https://gemini.google.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // =========================================================================
  // 1. HTML TO GFM MARKDOWN SERIALIZER (Reverse-engineered from Gemini AST)
  // =========================================================================

  class GeminiMarkdownConverter {
    convert(node, indentLevel = 0) {
      if (!node) return '';
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
      if (node.nodeType !== Node.ELEMENT_NODE) return '';

      const el = node;
      const tag = el.tagName.toLowerCase();

      // UI components & screen-reader headings to exclude
      if (
        el.classList.contains('cdk-visually-hidden') ||
        el.classList.contains('screen-reader-user-query-label') ||
        el.classList.contains('screen-reader-model-response-label') ||
        el.classList.contains('luminous-actions-container') ||
        el.classList.contains('response-footer') ||
        el.classList.contains('hide-on-print') ||
        el.getAttribute('data-suppress-highlight-to-ask') !== null ||
        tag === 'button' ||
        tag === 'gem-icon' ||
        tag === 'mat-icon' ||
        tag === 'gem-icon-button' ||
        tag === 'message-actions' ||
        tag === 'sources-list' ||
        tag.endsWith('-disclaimer')
      ) {
        return '';
      }

      // 1. LaTeX Math (Gemini binds raw TeX directly to data-math)
      if (el.hasAttribute('data-math')) {
        const tex = el.getAttribute('data-math').trim();
        const isBlock = tag === 'div' || el.classList.contains('katex-display') || el.closest('.katex-display');
        return isBlock ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
      }
      if (el.classList.contains('katex') || el.classList.contains('math-block')) {
        const annotation = el.querySelector('annotation[encoding="application/x-tex"]');
        if (annotation) {
          const tex = annotation.textContent.trim();
          const isBlock = el.classList.contains('katex-display') || el.classList.contains('math-block');
          return isBlock ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
        }
      }

      // 2. Code Blocks
      if (
        el.getAttribute('data-testid') === 'code-block' ||
        tag === 'code-block' ||
        (tag === 'pre' && !el.closest('[data-testid="code-block"], code-block'))
      ) {
        return this.parseCodeBlock(el);
      }

      // 3. Inline Code
      if (tag === 'code' && !el.closest('pre')) {
        return `\`${el.textContent}\``;
      }

      // 4. Headings (clamped between 3 and 6 so inner headings never collide with ## User / ## Assistant)
      if (/^h[1-6]$/.test(tag)) {
        const parsedLevel = parseInt(tag[1], 10);
        const level = Math.min(Math.max(parsedLevel >= 3 ? parsedLevel : parsedLevel + 2, 3), 6);
        const prefix = '#'.repeat(level);
        const content = this.processChildren(el, indentLevel).trim();
        return `\n\n${prefix} ${content}\n\n`;
      }

      // 5. Paragraphs
      if (tag === 'p') {
        const content = this.processChildren(el, indentLevel).trim();
        return content ? `\n\n${content}\n\n` : '';
      }

      // 6. Formatting
      if (tag === 'strong' || tag === 'b') return `**${this.processChildren(el, indentLevel)}**`;
      if (tag === 'em' || tag === 'i') return `*${this.processChildren(el, indentLevel)}*`;
      if (tag === 'del' || tag === 's') return `~~${this.processChildren(el, indentLevel)}~~`;
      if (tag === 'mark') return `==${this.processChildren(el, indentLevel)}==`;
      if (tag === 'u') return `<u>${this.processChildren(el, indentLevel)}</u>`;
      if (tag === 'sub') {
        const text = this.processChildren(el, indentLevel).trim();
        return text ? `<sub>${text}</sub>` : '';
      }
      if (tag === 'sup') {
        const text = this.processChildren(el, indentLevel).trim();
        return text ? `<sup>${text}</sup>` : '';
      }

      // 7. Blockquotes
      if (tag === 'blockquote') {
        const content = this.processChildren(el, indentLevel).trim();
        return `\n\n${content.split('\n').map((l) => `> ${l}`).join('\n')}\n\n`;
      }

      // 8. Lists & Checklists
      if (tag === 'ul' || tag === 'ol') {
        return this.parseList(el, indentLevel, tag === 'ol');
      }

      // 9. Tables
      if (tag === 'table') {
        return this.parseTable(el);
      }

      // 10. Horizontal Rule & Breaks
      if (tag === 'hr') return '\n\n---\n\n';
      if (tag === 'br') return '\n';

      // 11. Links & Images
      if (tag === 'a') {
        const href = el.getAttribute('href') || '';
        const text = this.processChildren(el, indentLevel).trim() || href;
        return href ? `[${text}](${href})` : text;
      }
      if (tag === 'img') {
        const src = el.getAttribute('src') || '';
        const alt = el.getAttribute('alt') || 'image';
        return src ? `![${alt}](${src})` : '';
      }

      return this.processChildren(el, indentLevel);
    }

    processChildren(el, indentLevel) {
      let result = '';
      for (let i = 0; i < el.childNodes.length; i++) {
        result += this.convert(el.childNodes[i], indentLevel);
      }
      return result;
    }

    parseCodeBlock(el) {
      let lang = '';
      const langEl = el.querySelector(
        '[variant="body-medium-emphasized"], .code-block-decoration, .code-block-header span, [class*="language-"]'
      );
      if (langEl) {
        const text = langEl.textContent.trim().toLowerCase();
        if (text && !text.includes('code snippet') && !text.includes('copy') && !text.includes('download')) {
          lang = text.replace(/^language-/, '');
        }
      }

      const codeNode = el.querySelector('[data-testid="code-content"]') || el.querySelector('pre, code') || el;
      const clone = codeNode.cloneNode(true);
      clone.querySelectorAll('button, gem-icon-button, .code-block-header').forEach((b) => b.remove());
      const codeContent = clone.textContent.replace(/^\n+|\n+$/g, '');

      let md = `\n\n\`\`\`${lang}\n${codeContent}\n\`\`\`\n\n`;

      const outputNode = el.querySelector('[data-testid="code-output-stdout-stderr"]');
      if (outputNode && outputNode.textContent.trim()) {
        md += `> **Output:**\n\`\`\`\n${outputNode.textContent.trim()}\n\`\`\`\n\n`;
      }
      return md;
    }

    parseList(el, indentLevel, isOrdered) {
      let result = '\n';
      const indent = '  '.repeat(indentLevel);
      let idx = 1;

      for (let i = 0; i < el.children.length; i++) {
        const child = el.children[i];
        if (child.tagName.toLowerCase() === 'li') {
          let bullet = isOrdered ? `${idx++}. ` : '- ';
          const checkbox = child.querySelector('input[type="checkbox"]');
          if (checkbox) {
            bullet = checkbox.checked ? '- [x] ' : '- [ ] ';
          }

          let itemText = '';
          for (let j = 0; j < child.childNodes.length; j++) {
            const sub = child.childNodes[j];
            if (sub.nodeType === Node.ELEMENT_NODE && (sub.tagName.toLowerCase() === 'ul' || sub.tagName.toLowerCase() === 'ol')) {
              itemText += this.parseList(sub, indentLevel + 1, sub.tagName.toLowerCase() === 'ol');
            } else {
              itemText += this.convert(sub, indentLevel);
            }
          }
          result += `${indent}${bullet}${itemText.trim()}\n`;
        }
      }
      return result + '\n';
    }

    parseTable(tableEl) {
      const rows = Array.from(tableEl.querySelectorAll('tr'));
      if (rows.length === 0) return '';

      const matrix = [];
      rows.forEach((row) => {
        const cells = Array.from(row.querySelectorAll('th, td')).map((cell) =>
          cell.textContent.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
        );
        if (cells.length > 0) matrix.push(cells);
      });

      if (matrix.length === 0) return '';
      const maxCols = Math.max(...matrix.map((r) => r.length));
      const normalized = matrix.map((row) => {
        while (row.length < maxCols) row.push('');
        return row;
      });

      let md = '\n\n| ' + normalized[0].join(' | ') + ' |\n';
      md += '| ' + new Array(maxCols).fill('---').join(' | ') + ' |\n';
      for (let i = 1; i < normalized.length; i++) {
        md += '| ' + normalized[i].join(' | ') + ' |\n';
      }
      return md + '\n\n';
    }
  }

  // =========================================================================
  // 2. CONVERSATION EXTRACTION & DOWNLOAD
  // =========================================================================

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

  function downloadConversationAsMarkdown() {
    const converter = new GeminiMarkdownConverter();

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

    containers.forEach((item) => {
      const uqEl = item instanceof HTMLElement ? item.querySelector('user-query') : item.userQuery;
      const mrEl = item instanceof HTMLElement ? item.querySelector('model-response') : item.modelResponse;

      if (uqEl) {
        const contentHolder = uqEl.querySelector('.query-text, .rendered-markdown-query, .query-content') || uqEl;
        const uqText = converter.convert(contentHolder).trim();
        if (uqText) {
          markdown += `## User\n\n${uqText}\n\n---\n\n`;
          turnCount++;
        }
      }

      if (mrEl) {
        let assistantContent = '';
        const thinkingEl = mrEl.querySelector('thinking-overlay, .is-embedded-thought');
        if (thinkingEl && thinkingEl.textContent.trim()) {
          const thoughtText = converter.convert(thinkingEl).trim();
          if (thoughtText) {
            assistantContent += `<details data-type="thought">\n<summary>Thought Process</summary>\n\n${thoughtText}\n\n</details>\n\n`;
          }
        }

        const responseHolder = mrEl.querySelector('message-content .markdown, message-content, .model-response-text') || mrEl;
        const mrText = converter.convert(responseHolder).trim();
        if (mrText) {
          assistantContent += `${mrText}\n\n`;

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
    });

    if (turnCount === 0) {
      alert('No conversation turns found to export.');
      return;
    }

    markdown = markdown.replace(/\n{3,}/g, '\n\n').trim() + '\n';
    const safeTitle = chatTitle.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '_').substring(0, 50);
    const dateSlug = new Date().toISOString().slice(0, 10);
    const filename = `gemini_${safeTitle || 'chat'}_${dateSlug}.md`;

    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8;' });
    const urlBlob = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = urlBlob;
    a.download = filename;
    document.documentElement.appendChild(a);
    a.click();
    document.documentElement.removeChild(a);
    URL.revokeObjectURL(urlBlob);
  }

  // =========================================================================
  // 3. ZERO-BLOAT NATIVE INJECTION (Composer Bar + Menus)
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

  // 1. Composer Toolbar Injection: Direct child of .trailing-actions-wrapper between model-picker and input-buttons
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
      transition: background-color 0.15s cubic-bezier(0.2, 0, 0, 1);
      vertical-align: middle;
      outline: none;
      flex-shrink: 0;
    `;

    btn.appendChild(createDownloadIcon(18, false));

    // Static icon color; circular halo carries the hover/active states
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

    // Insert as direct child of .trailing-actions-wrapper before .input-buttons-wrapper-bottom
    const rightGroup = wrapper.querySelector('.input-buttons-wrapper-bottom');
    if (rightGroup && rightGroup.parentNode === wrapper) {
      wrapper.insertBefore(btn, rightGroup);
    } else {
      wrapper.appendChild(btn);
    }
  }

  // 2. Menu Injection: Injects into popovers (top-bar conversation-action-menu or response more-menu)
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
    // 1. Composer toolbar button (between switcher and mic button)
    injectComposerExportButton();

    // 2. PDF menu item match anywhere
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

    // 3. Any active popover (top-bar conversation-action-menu or response more-menu)
    const activePopover = document.querySelector(
      'conversation-action-menu gem-popover, top-bar-actions gem-popover, [data-test-id="more-menu-button"] + gem-popover, .more-menu-button-container gem-popover'
    );
    if (activePopover && activePopover.children.length > 0) {
      injectExportMenuItem(activePopover);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Initial check on load
  injectComposerExportButton();
})();
