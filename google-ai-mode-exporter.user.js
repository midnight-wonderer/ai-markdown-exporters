// ==UserScript==
// @name         Google AI Mode Markdown Exporter
// @namespace    https://github.com/midnight-wonderer/
// @version      1.0.1
// @description  Export Google Search AI Mode as Markdown
// @match        https://*.google.com/search*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /**
   * Pure Semantic & ARIA Selectors:
   *
   * - User Questions: W3C role="heading" level 2 outside the AI response
   * - AI Responses:   Unminified component [data-container-id="main-col"]
   * - UI to ignore:   script, style, noscript, [data-ignore-copy], [data-xid="Gd7Hsc"],
   *                   [data-xid="aim-aside-initial-corroboration-container"],
   *                   button, svg, [aria-hidden="true"],
   *                   [role="progressbar"], [role="status"], [role="alert"]
   */
  const SELECTORS = {
    userQuery: '[role="heading"][aria-level="2"], h2',
    responseContainer: '[data-container-id="main-col"]',
    ignoredElements: [
      'script',
      'style',
      'noscript',
      '[data-ignore-copy]',
      '[data-xid="Gd7Hsc"]',
      '[data-xid="aim-aside-initial-corroboration-container"]',
      'button',
      'svg',
      '[aria-hidden="true"]',
      '[role="progressbar"]',
      '[role="status"]',
      '[role="alert"]'
    ].join(', ')
  };

  /**
   * Detect and extract LaTeX from math containers (Google uses data-xpm-latex or data-math).
   */
  function tryExtractMath(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;

    // 1. Element itself has data-xpm-latex or data-math
    if (node.hasAttribute('data-xpm-latex') || node.hasAttribute('data-math')) {
      const tex = (node.getAttribute('data-xpm-latex') || node.getAttribute('data-math') || '').trim();
      if (!tex) return null;
      const isBlock = node.parentElement && (
        node.parentElement.tagName.toLowerCase() === 'div' ||
        node.parentElement.classList.contains('display-math') ||
        (node.parentElement.getAttribute('role') === 'math' && node.parentElement.tagName.toLowerCase() === 'div')
      );
      return isBlock ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
    }

    // 2. KaTeX annotation
    if (node.tagName.toLowerCase() === 'annotation' && node.getAttribute('encoding') === 'application/x-tex') {
      const tex = node.textContent.trim();
      return tex ? `$${tex}$` : null;
    }

    // 3. Container wrapping a math element (e.g. <span> or <div> containing <img data-xpm-latex="...">)
    const mathChild = node.querySelector ? node.querySelector('[data-xpm-latex], [data-math], annotation[encoding="application/x-tex"]') : null;
    if (mathChild) {
      // Ensure node is the direct math container wrapper, NOT a whole section, paragraph, or table
      const tag = node.tagName.toLowerCase();
      const isContainer = (
        node.getAttribute('role') === 'math' ||
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

        const isBlock = tag === 'div' || node.parentElement?.tagName.toLowerCase() === 'div';
        return isBlock ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
      }
    }

    return null;
  }

  /**
   * Convert an HTML DOM node into clean Markdown recursively.
   */
  function domToMarkdown(node) {
    if (!node) return '';

    // Text node
    if (node.nodeType === Node.TEXT_NODE) {
      return node.nodeValue;
    }

    // Element node
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    // Intercept LaTeX Math before filtering ignoredElements (Google marks math <img> with aria-hidden="true")
    const mathMd = tryExtractMath(node);
    if (mathMd !== null) {
      return mathMd;
    }

    // Filter out scripts, styles, UI chrome & ignored elements
    if (node.matches && node.matches(SELECTORS.ignoredElements)) {
      return '';
    }

    // Filter out screen-reader highlight tokens
    const textContent = node.textContent?.trim();
    if (textContent === '[Highlight start]' || textContent === '[Highlight end]') {
      return '';
    }

    const tag = node.tagName.toLowerCase();

    // Scripts and styles should never produce markdown text
    if (tag === 'script' || tag === 'style' || tag === 'noscript') {
      return '';
    }

    // Headings: W3C role="heading" or h1-h6
    const role = node.getAttribute('role');
    if (role === 'heading' || /^h[1-6]$/.test(tag)) {
      const rawLevel = parseInt(node.getAttribute('aria-level') || (tag.startsWith('h') ? tag[1] : '3'), 10);
      // Clamp heading level to between 3 and 6 so inner headings never collide with ## User / ## Assistant
      const level = Math.min(Math.max(rawLevel >= 3 ? rawLevel : rawLevel + 2, 3), 6);
      const hashes = '#'.repeat(level);
      const text = getChildrenMarkdown(node).replace(/\s+/g, ' ').trim();
      return text ? `\n\n${hashes} ${text}\n\n` : '';
    }

    // Images: preserve substantive content images, omit favicons & 1x1 tracking pixels
    if (tag === 'img') {
      const src = node.getAttribute('src') || '';
      const alt = node.getAttribute('alt') || '';
      if (!src || src.startsWith('data:image/gif;base64,R0lGOD')) {
        return '';
      }
      // Omit tiny icons, citation source favicons, and decorative thumbnails (< 48px)
      const w = parseInt(node.getAttribute('width') || node.style.width || '0', 10);
      const h = parseInt(node.getAttribute('height') || node.style.height || '0', 10);
      if ((w > 0 && w <= 48) || (h > 0 && h <= 48)) {
        return '';
      }
      if (node.closest('a, button, [role="button"]') && (src.includes('favicon') || src.startsWith('data:'))) {
        return '';
      }
      // Omit giant base64 data URLs to prevent markdown bloat unless they have explicit content alt
      if (src.startsWith('data:') && !alt) {
        return '';
      }
      return alt ? `\n\n![${alt}](${src})\n\n` : `\n\n![](${src})\n\n`;
    }

    // Code blocks: <pre> or <pre><code>
    if (tag === 'pre') {
      const codeNode = node.querySelector('code') || node;
      const lang = (codeNode.getAttribute('class') || '').match(/(?:lang|language)-(\w+)/)?.[1] || '';
      const codeText = codeNode.textContent.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '');
      return `\n\n\`\`\`${lang}\n${codeText}\n\`\`\`\n\n`;
    }

    // Inline code
    if (tag === 'code' && node.parentElement?.tagName.toLowerCase() !== 'pre') {
      const code = node.textContent.trim();
      return code ? ` \`${code}\` ` : '';
    }

    // Bold / Strong
    if (tag === 'strong' || tag === 'b') {
      const text = getChildrenMarkdown(node).replace(/\s+/g, ' ').trim();
      return text ? `**${text}**` : '';
    }

    // Italics / Em
    if (tag === 'em' || tag === 'i') {
      const text = getChildrenMarkdown(node).replace(/\s+/g, ' ').trim();
      return text ? `*${text}*` : '';
    }

    // Strikethrough
    if (tag === 'del' || tag === 's') {
      const text = getChildrenMarkdown(node).replace(/\s+/g, ' ').trim();
      return text ? `~~${text}~~` : '';
    }

    // Mark / Highlight
    if (tag === 'mark') {
      const text = getChildrenMarkdown(node).replace(/\s+/g, ' ').trim();
      return text ? `==${text}==` : '';
    }

    // Blockquote
    if (tag === 'blockquote') {
      const text = getChildrenMarkdown(node).trim();
      return text ? `\n\n> ${text.split('\n').join('\n> ')}\n\n` : '';
    }

    // Lists: ul, ol
    if (tag === 'ul' || tag === 'ol') {
      const isOrdered = tag === 'ol';
      const items = [];
      let itemIndex = 1;

      // Handle both direct <li> children and intermediate wrapper children (<div> -> <li>)
      const listItems = Array.from(node.children).map((child) => {
        if (child.tagName.toLowerCase() === 'li') return child;
        return child.querySelector?.(':scope > li, li') || child;
      });

      for (const item of listItems) {
        // Skip empty spacer items by checking text content
        if (!item.textContent.trim()) {
          continue;
        }
        const itemText = getChildrenMarkdown(item).replace(/\s+/g, ' ').trim();
        if (itemText) {
          const prefix = isOrdered ? `${itemIndex++}. ` : '- ';
          items.push(`${prefix}${itemText}`);
        }
      }

      return items.length > 0 ? `\n\n${items.join('\n')}\n\n` : '';
    }

    // Tables
    if (tag === 'table') {
      return renderTableToMarkdown(node);
    }

    // Links: unwrap Google redirects
    if (tag === 'a') {
      let href = node.getAttribute('href') || '';
      const text = getChildrenMarkdown(node).replace(/\s+/g, ' ').trim();
      if (!href || href.startsWith('javascript:') || !text) {
        return text;
      }
      if (href.startsWith('/url?') || href.includes('google.com/url?')) {
        try {
          const u = new URL(href, window.location.origin);
          href = u.searchParams.get('q') || u.searchParams.get('url') || href;
        } catch (_) { }
      }
      return `[${text}](${href})`;
    }

    // Line breaks
    if (tag === 'br') {
      return '\n';
    }

    // Standard paragraphs
    if (tag === 'p') {
      const text = getChildrenMarkdown(node).replace(/\s+/g, ' ').trim();
      return text ? `\n\n${text}\n\n` : '';
    }

    // Default container: recursively process children
    return getChildrenMarkdown(node);
  }

  function getChildrenMarkdown(node) {
    let result = '';
    for (const child of node.childNodes) {
      result += domToMarkdown(child);
    }
    return result;
  }

  /**
   * Convert an HTML <table> into GitHub-Flavored Markdown table
   */
  function renderTableToMarkdown(tableNode) {
    const rows = [];
    const trs = tableNode.querySelectorAll('tr');

    trs.forEach((tr) => {
      const cells = [];
      tr.querySelectorAll('th, td').forEach((cell) => {
        const text = domToMarkdown(cell).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
        cells.push(text);
      });
      if (cells.length > 0) {
        rows.push(cells);
      }
    });

    if (rows.length === 0) return '';

    const colCount = Math.max(...rows.map((r) => r.length));
    const padRow = (row) => {
      while (row.length < colCount) row.push('');
      return '| ' + row.join(' | ') + ' |';
    };

    const header = padRow(rows[0]);
    const separator = '| ' + Array(colCount).fill('---').join(' | ') + ' |';
    const body = rows.slice(1).map(padRow).join('\n');

    return `\n\n${header}\n${separator}${body ? '\n' + body : ''}\n\n`;
  }

  /**
   * Extract unique outbound citation sources using unminified functional heuristics.
   */
  function extractOutboundSources(respNode) {
    const sources = [];
    const seen = new Set();
    const anchors = Array.from(respNode.querySelectorAll('a[href]'));

    for (const a of anchors) {
      let href = a.getAttribute('href') || '';
      const text = a.textContent.replace(/\s+/g, ' ').trim();

      // Must have substantive visible text (filters out icons, tracking pixels, and empty chips)
      if (!text || text.length < 2) continue;

      // Filter out internal anchors, javascript calls, and google action/settings links
      if (href.startsWith('#') || href.startsWith('javascript:')) continue;
      if (href.startsWith('/url?') || href.includes('google.com/url?')) {
        try {
          const u = new URL(href, window.location.origin);
          href = u.searchParams.get('q') || u.searchParams.get('url') || href;
        } catch (_) { }
      }
      // Filter out internal Google domains, support/policy pages, and settings links
      try {
        const parsed = new URL(href, window.location.origin);
        const host = parsed.hostname.toLowerCase();
        if (
          host.endsWith('google.com') ||
          host.endsWith('googleusercontent.com') ||
          host.endsWith('gstatic.com') ||
          href.includes('myadcenter') ||
          href.includes('/preferences') ||
          href.includes('/history')
        ) {
          continue;
        }
      } catch (_) {
        continue;
      }
      if (a.closest('button, [role="button"], [role="menu"]')) continue;

      if (!seen.has(href)) {
        seen.add(href);
        sources.push({ title: text, url: href });
      }
    }
    return sources;
  }

  /**
   * Clean raw user query text extracted from headings or prompts.
   */
  function cleanUserText(nodeOrText) {
    if (!nodeOrText) return '';
    let raw = '';
    if (typeof nodeOrText === 'string') {
      raw = nodeOrText;
    } else {
      raw = nodeOrText.textContent?.includes('\n')
        ? nodeOrText.textContent
        : (nodeOrText.innerText || nodeOrText.textContent || '');
    }
    let text = raw
      .replace(/\r\n/g, '\n')
      .replace(/^You said:\s*/i, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    // Ignore Google AI Mode banner label
    if (/^ai overview$/i.test(text)) {
      return '';
    }
    // Remove duplicate repeated lines from screen-reader double rendering
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 2 && lines[0] === lines[1]) {
      text = lines[0];
    }
    return text;
  }

  /**
   * Extract all conversation turns purely using unminified semantic attributes.
   */
  function extractConversation() {
    // 1. Initial query from URL param 'q' (verbatim source of truth for turn 0)
    let initialQuery = '';
    try {
      initialQuery = new URL(window.location.href).searchParams.get('q') || '';
    } catch (_) {}

    // 2. Collect all model response containers (the ground-truth responses)
    const allResponses = Array.from(document.querySelectorAll(SELECTORS.responseContainer));
    if (allResponses.length === 0) return '';

    const turns = [];

    for (let i = 0; i < allResponses.length; i++) {
      const respNode = allResponses[i];

      // Climb up from respNode to find the isolated turn block containing its user query
      let userNode = null;
      let p = respNode.parentElement;
      while (p && p !== document.body && p.getAttribute('data-xid') !== 'aim-mars-turn-root') {
        const q = p.querySelector(SELECTORS.userQuery);
        if (q && !q.closest(SELECTORS.responseContainer)) {
          if (p.querySelectorAll(SELECTORS.responseContainer).length === 1) {
            userNode = q;
            break;
          }
        }
        p = p.parentElement;
      }

      let uText = cleanUserText(userNode);

      // Fallback for Turn 0: use URL 'q' parameter if heading is missing
      if (i === 0 && !uText && initialQuery) {
        uText = cleanUserText(initialQuery);
      }

      if (uText || respNode) {
        turns.push({
          userText: uText,
          respNode: respNode
        });
      }
    }

    if (turns.length === 0) return '';

    // Document title and metadata
    const firstQText = turns[0]?.userText || 'Google AI Mode Session';
    const pageTitle = document.title.replace(/ - Google Search$/, '').trim() || firstQText;
    const timestamp = new Date().toISOString();
    const url = window.location.href;

    let doc = `---\n`;
    doc += `title: ${JSON.stringify(pageTitle)}\n`;
    doc += `source: "google-ai-mode"\n`;
    doc += `exported_at: "${timestamp}"\n`;
    doc += `url: "${url}"\n`;
    doc += `---\n\n`;

    for (const t of turns) {
      if (t.userText) {
        doc += `## User\n\n${t.userText}\n\n---\n\n`;
      }

      if (t.respNode) {
        const respNode = t.respNode;
        const contentWrapper = respNode.querySelector(':scope > div[style*="contents"]') || respNode;

        const turnBlocks = [];
        for (const child of contentWrapper.children) {
          if (child.matches && child.matches(SELECTORS.ignoredElements)) continue;
          if (child.querySelector?.('[data-ignore-copy], [data-xid="Gd7Hsc"]')) continue;
          if (!child.textContent.trim()) continue;

          const blockMd = domToMarkdown(child).replace(/\n{3,}/g, '\n\n').trim();
          if (blockMd) {
            turnBlocks.push(blockMd);
          }
        }

        let fullRespMd = turnBlocks.join('\n\n').trim();
        if (fullRespMd) {
          doc += `## Assistant\n\n${fullRespMd}\n\n`;

          // Extract citation sources
          const sources = extractOutboundSources(respNode);
          if (sources.length > 0) {
            doc += `### Sources\n\n`;
            sources.forEach((s, idx) => {
              doc += `${idx + 1}. [${s.title}](${s.url})\n`;
            });
            doc += `\n`;
          }

          doc += `---\n\n`;
        }
      }
    }

    return doc.replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  /**
   * Toast notification for non-obtrusive feedback
   */
  function showToast(message) {
    let toast = document.getElementById('aim-exporter-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'aim-exporter-toast';
      toast.style.cssText = `
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: #202124;
        color: #e8eaed;
        padding: 8px 16px;
        border-radius: 20px;
        font-family: Google Sans, Roboto, sans-serif;
        font-size: 13px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        border: 1px solid rgba(255,255,255,0.15);
        z-index: 1000000;
        opacity: 0;
        transition: opacity 0.2s ease, transform 0.2s ease;
        pointer-events: none;
      `;
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(10px)';
    }, 2200);
  }

  /**
   * Handle download or copy action
   */
  function handleExport(isCopyOnly = false) {
    const md = extractConversation();
    if (!md) {
      showToast('No conversation found to export');
      return;
    }

    if (isCopyOnly) {
      if (typeof GM_setClipboard !== 'undefined') {
        GM_setClipboard(md);
      } else {
        navigator.clipboard.writeText(md);
      }
      showToast('✓ Copied Markdown to clipboard');
      return;
    }

    // Download .md file
    const titleMatch = md.match(/^title:\s*"([^"]+)"/m);
    const rawTitle = titleMatch ? titleMatch[1] : 'chat';
    const cleanName = rawTitle.slice(0, 30).replace(/[^a-zA-Z0-9_-]/g, '_');
    const dateSlug = new Date().toISOString().slice(0, 10);
    const filename = `google-ai-mode_${cleanName}_${dateSlug}.md`;

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('✓ Markdown downloaded');
  }

  /**
   * Inject button into the toolbar:
   * 1. Finds button with path containing "440H200v"
   * 2. Finds closest element with role="presentation"
   * 3. Appends the button as a child of that container
   */
  function injectNativeButton() {
    if (document.getElementById('aim-native-export-btn')) return;

    // 1. Find button containing path with "440H200v"
    const plusBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.querySelector('path[d*="440H200v"]')
    );
    if (!plusBtn) return;

    // 2. Find closest element with role="presentation"
    const container = plusBtn.closest('[role="presentation"]');
    if (!container) return;

    const btn = document.createElement('button');
    btn.id = 'aim-native-export-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Download conversation as Markdown (Shift-click to copy)');
    btn.title = 'Download Markdown\n(Shift+Click or Right-Click to Copy)';
    btn.style.cssText = `
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      margin-left: 6px;
      padding: 0;
      border: none;
      background: transparent;
      border-radius: 50%;
      cursor: pointer;
      color: inherit;
      opacity: 0.8;
      transition: background 0.2s, opacity 0.2s, transform 0.1s;
      vertical-align: middle;
      flex-shrink: 0;
    `;

    // Google Material Symbols Download Icon
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true" style="pointer-events: none;">
        <path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-280 280Zm-280 160q-33 0-56.5-23.5T120-240v-80h80v80h560v-80h80v80q0 33-23.5 56.5T760-160H200Z"/>
      </svg>
    `;

    // Hover & Active effects matching native Google buttons
    btn.onmouseover = () => {
      btn.style.background = 'rgba(128, 128, 128, 0.16)';
      btn.style.opacity = '1';
    };
    btn.onmouseout = () => {
      btn.style.background = 'transparent';
      btn.style.opacity = '0.8';
    };
    btn.onmousedown = () => {
      btn.style.transform = 'scale(0.92)';
    };
    btn.onmouseup = () => {
      btn.style.transform = 'scale(1)';
    };

    // Left-click: Download, Shift-click: Copy
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleExport(e.shiftKey);
    };

    // Right-click: Copy directly
    btn.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleExport(true);
    };

    // 3. Append the button as a child of the presentation container
    container.appendChild(btn);
  }

  /**
   * Observe DOM mutations so the button persists across turn transitions & SPA re-renders
   */
  function initObserver() {
    injectNativeButton();

    const observer = new MutationObserver(() => {
      if (!document.getElementById('aim-native-export-btn')) {
        injectNativeButton();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initObserver);
  } else {
    initObserver();
  }
})();
