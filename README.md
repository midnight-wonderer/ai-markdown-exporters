# AI Markdown Exporters

[![Latest Release](https://img.shields.io/github/v/release/midnight-wonderer/ai-markdown-exporters?color=blueviolet&label=Release)](https://github.com/midnight-wonderer/ai-markdown-exporters/releases)
[![Build Provenance](https://img.shields.io/badge/Build_Artefacts-Attested-brightgreen?logo=github)](https://github.com/midnight-wonderer/ai-markdown-exporters/attestations)
[![License](https://img.shields.io/badge/License-BSD_3--Clause-blue.svg)](LICENSE.md)

A suite of lightweight, zero-dependency UserScripts to export chat sessions from Google AI platforms into clean, standardized Markdown. 

---

## Supported Platforms

| Platform | Script | Target URL | Integration Point |
| :--- | :--- | :--- | :--- |
| **Google Gemini** | `gemini-markdown-exporter.user.js` | `gemini.google.com` | Composer toolbar & top menu |
| **Google Search AI Mode** | `google-ai-mode-exporter.user.js` | `google.com/search` | Composer toolbar |
| **Vertex AI Search** | `vertex-ai-search-markdown-exporter.user.js` | `vertexaisearch.cloud.google` | Top menu |

---

## Key Features

- **Mathematical Formulations (LaTeX):** Preserves display equations (`$$...$$`) and inline variables (`$...$`) across KaTeX, MathML, and Google's internal `data-xpm-latex` rendering.
- **Preserved Citations & Grounding:** Resolves outbound source URLs and deduplicates them into a clean `### Sources` section at the end of each assistant turn.
- **Thinking / CoT Support:** Retains chain-of-thought reasoning in collapsible `<details data-type="thought">` blocks.

---

## Standard Output Specification

All exporters produce documents conforming to this structure:

```markdown
---
title: "Python 3.13 GIL Removal Updates"
source: "gemini" # or "google-ai-mode" | "vertex-ai-search"
model: "gemini-3.8-flash" # when detectable
session_id: "11892409207010026470"
exported_at: "2026-11-22T14:30:00.000Z"
url: "https://..."
---

## User

Search the web for the latest updates on Python 3.13's GIL removal.

---

## Assistant

<details data-type="thought">
<summary>Thought Process</summary>

Step-by-step reasoning and search synthesis...
</details>

Starting in Python 3.13, CPython introduced an experimental free-threaded build...

### 1. Performance Overview

| Metric | Python 3.12 | Python 3.13t (Free-threaded) |
| --- | --- | --- |
| Single-threaded | Baseline (1.0x) | 1.05x - 1.08x overhead |

Theoretical scaling follows Amdahl's Law:

$$
S_{\text{latency}}(s) = \frac{1}{(1 - p) + \frac{p}{s}}
$$

### Sources

1. [Python experimental support for free threading](https://docs.python.org/3.13/howto/free-threading-python.html)
2. [PEP 703 – Making the Global Interpreter Lock Optional](https://peps.python.org/pep-0703/)

---
```

---

## Installation

1. Install a UserScript manager extension in your browser:
   * [Violentmonkey](https://violentmonkey.github.io/) (Recommended)
   * [Tampermonkey](https://www.tampermonkey.net/)
2. Download the `.user.js` asset from the latest [GitHub Releases](../../releases) (clicking the `.user.js` link triggers an automatic install prompt in Violentmonkey/Tampermonkey).

---

## Development

Prerequisites: Node.js 20+

```bash
# Install dependencies
npm install

# Start development with live reload / HMR for a specific platform:
npm run dev:gemini
npm run dev:google-ai-mode
npm run dev:vertex-ai

# Build all userscripts into dist/
npm run build
```
