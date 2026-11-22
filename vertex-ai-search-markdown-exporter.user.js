// ==UserScript==
// @name         Vertex AI Search - Markdown Exporter
// @namespace    https://vertexaisearch.cloud.google/
// @version      2.1
// @description  Adds "Export as Markdown" under "Export as JSON" in the Vertex AI Search chat session header menu
// @match        https://vertexaisearch.cloud.google/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // 1. Recursive BFS to pierce open Shadow DOMs
  function findElementDeep(selector, root = document) {
    const queue = [root];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      if (current.querySelector) {
        const found = current.querySelector(selector);
        if (found) return found;
        const all = current.querySelectorAll('*');
        for (const el of all) {
          if (el.shadowRoot) queue.push(el.shadowRoot);
        }
      }
    }
    return null;
  }

  // 2. Extract turns from <ucs-conversation> (memory state + Shadow DOM fallback)
  function extractTurns() {
    const conv = findElementDeep('ucs-conversation');
    if (!conv) return null;

    const turns = [];

    // Approach A: Read in-memory .turns property on <ucs-conversation>
    if (Array.isArray(conv.turns) && conv.turns.length > 0) {
      for (const t of conv.turns) {
        const user = t.query?.text || t.query?.parts?.map(p => p.text).join('') || '';
        let assistant = '';
        if (t.reply?.answer?.segments) {
          assistant = t.reply.answer.segments.map(s => s.text || '').join('\n\n');
        } else if (typeof t.reply?.answer === 'string') {
          assistant = t.reply.answer;
        } else if (t.reply?.answer?.raw) {
          assistant = t.reply.answer.raw;
        }
        if (user || assistant) {
          turns.push({ user: user.trim(), assistant: assistant.trim() });
        }
      }
      if (turns.length > 0) return turns;
    }

    // Approach B: Deep Shadow DOM traversal on .turn containers
    if (conv.shadowRoot) {
      const turnEls = conv.shadowRoot.querySelectorAll('.turn');
      for (const el of turnEls) {
        const userFastMd = findElementDeep('ucs-fast-markdown', el);
        const user = userFastMd?.markdown || userFastMd?.shadowRoot?.textContent?.trim() || '';

        const summaryEl = el.querySelector('ucs-summary, ucs-research-summary, ucs-orchestration-summary');
        let assistant = '';
        if (summaryEl) {
          const respMd = findElementDeep('ucs-response-markdown', summaryEl.shadowRoot || summaryEl);
          assistant = respMd?.markdown || findElementDeep('ucs-fast-markdown', respMd?.shadowRoot || summaryEl.shadowRoot)?.markdown || summaryEl.shadowRoot?.textContent?.trim() || '';
        }

        if (user || assistant) {
          turns.push({ user: user.trim(), assistant: assistant.trim() });
        }
      }
    }

    return turns;
  }

  // 3. Format as clean Markdown document
  function generateMarkdown(turns) {
    const url = window.location.href;
    const sessionMatch = url.match(/\/session\/([^\/?#]+)/);
    const sessionId = sessionMatch ? sessionMatch[1] : 'unknown';
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

    let doc = `# Vertex AI Search Chat Session\n\n`;
    doc += `- **Session ID**: \`${sessionId}\`\n`;
    doc += `- **Export Date**: ${timestamp}\n`;
    doc += `- **Source URL**: [Link](${url})\n\n`;
    doc += `---\n\n`;

    for (const t of turns) {
      if (t.user) {
        doc += `### 👤 User\n\n${t.user}\n\n`;
      }
      if (t.assistant) {
        doc += `### 🤖 Assistant\n\n${t.assistant}\n\n`;
      }
      doc += `---\n\n`;
    }

    return doc;
  }

  // 4. Download file helper
  function downloadMarkdown(filename, content) {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }

  // 5. Inject "Export as Markdown" into <md-menu> under "Export as JSON"
  let isObservingMenu = false;

  function injectMenuItem() {
    const headerBar = findElementDeep('ucs-header-action-bar');
    if (!headerBar || !headerBar.shadowRoot) return;

    const menu = headerBar.shadowRoot.querySelector('md-menu');
    if (!menu) return;

    // Attach MutationObserver to md-menu so if Lit re-renders the menu items, we reinject
    if (!isObservingMenu) {
      const observer = new MutationObserver(() => injectMenuItem());
      observer.observe(menu, { childList: true });
      isObservingMenu = true;
    }

    // Locate "Export as JSON" menu item
    let jsonItem = menu.querySelector('.export-json-menu-item');
    if (!jsonItem) {
      const items = menu.querySelectorAll('md-menu-item');
      for (const item of items) {
        if (item.textContent && item.textContent.includes('Export as JSON')) {
          jsonItem = item;
          break;
        }
      }
    }

    if (!jsonItem) return;

    // Check if already injected
    if (menu.querySelector('.export-markdown-menu-item')) return;

    // Create native <md-menu-item> using safe DOM APIs (Trusted Types compliant)
    const mdItem = document.createElement('md-menu-item');
    mdItem.className = 'export-markdown-menu-item';

    const icon = document.createElement('md-icon');
    icon.setAttribute('slot', 'start');
    icon.className = 'action-icon';
    icon.textContent = 'description';

    const headline = document.createElement('div');
    headline.setAttribute('slot', 'headline');
    headline.textContent = 'Export as Markdown';

    mdItem.appendChild(icon);
    mdItem.appendChild(headline);

    // Handle click
    mdItem.addEventListener('click', (e) => {
      e.stopPropagation();

      // Close the menu
      menu.open = false;

      const turns = extractTurns();
      if (!turns || turns.length === 0) {
        alert('Could not find conversation turns. Make sure the chat session has loaded.');
        return;
      }

      const sessionMatch = window.location.href.match(/\/session\/([^\/?#]+)/);
      const sessionId = sessionMatch ? sessionMatch[1] : 'session';
      const doc = generateMarkdown(turns);
      downloadMarkdown(`vertex-search-${sessionId.slice(0, 8)}.md`, doc);
    });

    // Insert immediately below "Export as JSON"
    jsonItem.insertAdjacentElement('afterend', mdItem);
  }

  // Periodically check and wire up listeners
  setInterval(injectMenuItem, 1000);

  // Also hook into clicks on ucs-header-action-bar to inject as soon as menu opens
  window.addEventListener('click', () => {
    setTimeout(injectMenuItem, 100);
  });
})();
