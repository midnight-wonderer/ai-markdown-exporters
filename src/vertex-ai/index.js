import { normalizeHeadingLevels } from '../shared/headings.js';
import { downloadMarkdown, getDateSlug } from '../shared/download.js';

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

function findElementsDeep(selector, root = document) {
  const results = [];
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    if (current.querySelectorAll) {
      const found = current.querySelectorAll(selector);
      for (const el of found) results.push(el);
      const all = current.querySelectorAll('*');
      for (const el of all) {
        if (el.shadowRoot) queue.push(el.shadowRoot);
      }
    }
  }
  return results;
}

// Clean thought text by stripping trailing raw followup JSON
function cleanThoughtText(text) {
  return text.replace(/\n\n\{"questions":\s*\[.*$/s, '').trim();
}

// Extract thinking process from <ucs-activity-timeline> elements within a turn container
function extractTimelineThoughts(container) {
  if (!container) return '';
  const timelines = findElementsDeep('ucs-activity-timeline', container);
  if (timelines.length === 0) return '';

  const sections = [];
  for (const tl of timelines) {
    const sectionTitle = tl.shadowRoot?.querySelector('summary .title')?.textContent?.trim() || '';

    // Approach 1: In-memory .steps property on <ucs-activity-timeline>
    if (Array.isArray(tl.steps) && tl.steps.length > 0) {
      const thoughts = tl.steps
        .filter((s) => s.kind === 'thought' && s.title)
        .map((s) => s.title.trim());

      if (thoughts.length > 0) {
        sections.push(sectionTitle ? `**${sectionTitle}**\n${thoughts.join('\n\n')}` : thoughts.join('\n\n'));
        continue;
      }
    }

    // Approach 2: Shadow DOM fallback
    if (tl.shadowRoot) {
      const thoughtRows = tl.shadowRoot.querySelectorAll('.row.thought .title, .row.thought .label');
      const thoughts = Array.from(thoughtRows)
        .map((r) => r.textContent.trim())
        .filter(Boolean);

      if (thoughts.length > 0) {
        sections.push(sectionTitle ? `**${sectionTitle}**\n${thoughts.join('\n\n')}` : thoughts.join('\n\n'));
      }
    }
  }

  return sections.join('\n\n').trim();
}

// Extract reasoning / thought process from turn object or its DOM timeline
function extractTurnThought(t, turnEl) {
  if (Array.isArray(t.reply?.answer?.summaryThoughts) && t.reply.answer.summaryThoughts.length > 0) {
    return t.reply.answer.summaryThoughts
      .map((st) => (st.title ? `**${st.title}**\n${cleanThoughtText(st.summary || '')}` : cleanThoughtText(st.summary || '')))
      .filter(Boolean)
      .join('\n\n')
      .trim();
  }
  if (Array.isArray(t.reply?.answer?.rawThoughts) && t.reply.answer.rawThoughts.length > 0) {
    return t.reply.answer.rawThoughts.map(cleanThoughtText).join('\n\n').trim();
  }
  return extractTimelineThoughts(turnEl);
}

// 2. Extract turns from <ucs-conversation>
function extractConversationData() {
  const conv = findElementDeep('ucs-conversation');
  if (!conv || !Array.isArray(conv.turns)) return null;

  const turns = [];
  let modelId = '';
  let sessionId = '';
  const turnEls = conv.shadowRoot?.querySelectorAll('.turn') || [];

  conv.turns.forEach((t, idx) => {
    const user = t.query?.text || '';

    if (!modelId && t.reply?.queryConfig?.modelId) {
      modelId = t.reply.queryConfig.modelId;
    }
    if (!sessionId && t.reply?.session) {
      sessionId = t.reply.session.split('/').pop();
    }

    const thought = extractTurnThought(t, turnEls[idx] || conv);

    let assistant = '';
    const references = [];
    const seenUris = new Set();

    if (Array.isArray(t.reply?.answer?.segments)) {
      let rawText = '';
      for (const s of t.reply.answer.segments) {
        if (s.text) {
          rawText += s.text;
        }
        if (Array.isArray(s.references)) {
          for (const ref of s.references) {
            if (ref?.uri && !seenUris.has(ref.uri)) {
              seenUris.add(ref.uri);
              references.push({
                title: ref.title || ref.domain || ref.uri,
                uri: ref.uri,
              });
            }
          }
        }
      }
      assistant = rawText
        .replace(/\[\[section:[^\]]+\]\]/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    if (user || assistant) {
      turns.push({
        user: user.trim(),
        assistant: assistant.trim(),
        thought: thought.trim(),
        sources: references,
      });
    }
  });

  return { turns, modelId, sessionId };
}

// 3. Format as clean Markdown document adhering to unified standard
function generateMarkdown({ turns, modelId, sessionId }) {
  const url = window.location.href;
  const sessionMatch = url.match(/\/session\/([^\/?#]+)/);
  const resolvedSessionId = sessionId || (sessionMatch ? sessionMatch[1] : 'unknown');
  const timestamp = new Date().toISOString();

  let doc = `---\n`;
  doc += `title: "Vertex AI Search Chat Session"\n`;
  doc += `source: "vertex-ai-search"\n`;
  if (modelId) {
    doc += `model: ${JSON.stringify(modelId)}\n`;
  }
  doc += `session_id: ${JSON.stringify(resolvedSessionId)}\n`;
  doc += `exported_at: "${timestamp}"\n`;
  doc += `url: "${url}"\n`;
  doc += `---\n\n`;

  for (const t of turns) {
    if (t.user) {
      doc += `## User\n\n${t.user}\n\n---\n\n`;
    }
    if (t.assistant) {
      doc += `## Assistant\n\n`;
      if (t.thought) {
        doc += `<details data-type="thought">\n<summary>Thought Process</summary>\n\n${t.thought}\n\n</details>\n\n`;
      }
      doc += `${normalizeHeadingLevels(t.assistant)}\n\n`;

      if (Array.isArray(t.sources) && t.sources.length > 0) {
        doc += `### Sources\n\n`;
        t.sources.forEach((s, idx) => {
          doc += `${idx + 1}. [${s.title}](${s.uri})\n`;
        });
        doc += `\n`;
      }
      doc += `---\n\n`;
    }
  }

  return doc.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// 4. Inject "Export as Markdown" into <md-menu> under "Export as JSON"
let isObservingMenu = false;

function injectMenuItem() {
  const headerBar = findElementDeep('ucs-header-action-bar');
  if (!headerBar || !headerBar.shadowRoot) return;

  const menu = headerBar.shadowRoot.querySelector('md-menu');
  if (!menu) return;

  if (!isObservingMenu) {
    const observer = new MutationObserver(() => injectMenuItem());
    observer.observe(menu, { childList: true });
    isObservingMenu = true;
  }

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
  if (menu.querySelector('.export-markdown-menu-item')) return;

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

  mdItem.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.open = false;

    const data = extractConversationData();
    if (!data || !data.turns || data.turns.length === 0) {
      alert('Could not find conversation turns. Make sure the chat session has loaded.');
      return;
    }

    const sessionMatch = window.location.href.match(/\/session\/([^\/?#]+)/);
    const sessionId = data.sessionId || (sessionMatch ? sessionMatch[1] : 'session');
    const doc = generateMarkdown(data);
    const dateSlug = getDateSlug();
    downloadMarkdown(`vertex-search_${sessionId.slice(0, 10)}_${dateSlug}.md`, doc);
  });

  jsonItem.insertAdjacentElement('afterend', mdItem);
}

// Periodically check and wire up listeners
setInterval(injectMenuItem, 1000);

window.addEventListener('click', () => {
  setTimeout(injectMenuItem, 100);
});
