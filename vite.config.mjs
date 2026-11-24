import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

const TARGET = process.env.TARGET || 'gemini';

const TARGET_CONFIGS = {
  gemini: {
    entry: 'src/gemini/index.js',
    fileName: 'gemini-markdown-exporter.user.js',
    userscript: {
      name: 'Gemini Chat Markdown Exporter',
      namespace: 'https://github.com/midnight-wonderer/',
      version: '1.0.0',
      description: 'Adds "Export as Markdown" action to Gemini.',
      match: ['https://gemini.google.com/*'],
      grant: 'none',
      'run-at': 'document-idle',
    },
  },
  'google-ai-mode': {
    entry: 'src/google-ai-mode/index.js',
    fileName: 'google-ai-mode-exporter.user.js',
    userscript: {
      name: 'Google AI Mode Markdown Exporter',
      namespace: 'https://github.com/midnight-wonderer/',
      version: '1.0.1',
      description: 'Export Google Search AI Mode as Markdown',
      match: ['https://*.google.com/search*'],
      grant: ['GM_setClipboard'],
      'run-at': 'document-idle',
    },
  },
  'vertex-ai': {
    entry: 'src/vertex-ai/index.js',
    fileName: 'vertex-ai-search-markdown-exporter.user.js',
    userscript: {
      name: 'Gemini Enterprise (Vertex AI Search) Markdown Exporter',
      namespace: 'https://github.com/midnight-wonderer/',
      version: '1.0.0',
      description: 'Adds "Export as Markdown" action to Gemini Enterprise.',
      match: ['https://vertexaisearch.cloud.google.com/*'],
      grant: 'none',
      'run-at': 'document-idle',
    },
  },
};

const current = TARGET_CONFIGS[TARGET];
if (!current) {
  throw new Error(`Unknown build target: "${TARGET}". Expected one of: ${Object.keys(TARGET_CONFIGS).join(', ')}`);
}

export default defineConfig({
  plugins: [
    monkey({
      entry: current.entry,
      userscript: current.userscript,
      build: {
        fileName: current.fileName,
      },
    }),
  ],
  build: {
    emptyOutDir: false,
  },
});
