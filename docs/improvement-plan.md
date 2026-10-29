# Open Writer improvement plan

Status: 2026-10-29. Implemented on master: every item except 0.3
(naming, a maintainer decision). The corpus is at 299 dev and 99 held-out
cases (1.3); a confusables rule covers the mix-ups Harper missed. Latest
results: dev precision 93.0% and lenient recall 76.4%; held-out precision
83.8% and lenient recall 74.1% (eval/reports/final-heldout.md). Phases are ordered by dependency and by how much
each one changes what a daily writer experiences. Every phase ends with
`npm test`, `npm run build`, and the relevant Playwright project passing, as
CONTRIBUTING.md requires.

Constraints that apply to everything below:

- Static files on an HTTPS origin, no application server.
- Local proofreading, drafts, import, and export work with no credentials.
- No analytics. Document text leaves the device only on an explicit AI action.
- Provider keys travel only in authentication headers to a known origin.

## Phase 0: Baseline and foundations

Goal: a measured starting point and a codebase that the later phases can
extend without fighting `App.jsx`.

### 0.1 Commit a real eval baseline

`eval/reports/latest.md` is a 10-case smoke run. The corpus already has 119
dev cases (89 annotated, 154 expected issues) and 39 held-out cases.

1. Run `npm run eval -- --split dev --save` and `--split heldout --save`.
2. Commit the reports as `eval/reports/baseline-dev.md` and
   `baseline-heldout.md`. Keep `latest.*` as the moving target.
3. Add an `eval:full` script to `frontend/package.json`, and run it in
   `.github/workflows/check.yml` on pull requests so precision and false
   positive rate are visible in CI logs.

Done when: both baseline reports are committed and CI prints the summary
table.

### 0.2 Split `App.jsx` into hooks

`frontend/src/app/App.jsx` is 912 lines with about 25 state values and 20
refs. Its section comments already mark the seams.

| New file | Takes over App.jsx section | Owns |
| --- | --- | --- |
| `app/hooks/useDocuments.js` | documents and preferences (lines 95-263) | doc list, active doc, prefs, dismissals, load, create, delete, rename, BroadcastChannel |
| `app/hooks/useAutosave.js` | part of documents | debounced save chain, recovery copies, save status, persistence prompt |
| `app/hooks/useProofreading.js` | checking (264-341) | scheduler, envelope, hidden set, check status, AI issue re-anchoring |
| `app/hooks/useDocumentEditor.js` | editor (342-509) | Tiptap instance, decorations, popover, reveal, selection words |
| `app/hooks/useImportExport.js` | export and import (616-721) | file pickers, docx/md/txt in and out |
| `app/hooks/useShortcuts.js` | keyboard (722-754) | global key handling |

Rules for the split:

- Move code, do not change behavior. One hook per commit.
- Each hook returns a plain object. `App.jsx` becomes composition and render.
- `frontend/tests/editor/editor.test.js` and the Playwright suite must pass
  unchanged after every commit.
- Add a unit test for `useAutosave` (save conflict, recovery cadence) and
  `useDocuments` (first-run welcome, handoff) using happy-dom.

Done when: `App.jsx` is under 300 lines and no test changed except additions.

### 0.3 Pick one name

The repository is `ownword`, the app is Open Writer, the manifest short name
is Writer. Decide before the site is indexed. Then update `README.md`,
`manifest.webmanifest`, landing page titles, and `welcome.js` in one commit.
The site is hosted at https://sevii.github.io/ownword/
Lets use the ownword term 


## Phase 1: Proofreading quality

Goal: fewer wrong underlines, more right ones, proven by the eval harness.
Depends on 0.1.

### 1.1 Triage the baseline

1. Read the false positive and forbidden-span sections of the baseline
   reports. Group by Harper rule name (the report already lists
   `harper.SpellCheck`, `harper.ExpandMinimum`, and so on).
2. For each rule with more false positives than true positives on dev, add it
   to `DEFAULT_OFF_RULES` in `frontend/src/analysis/engines/harper.js`, or
   gate it on the document formality goal.
3. Bump `RULES_VERSION` when a rule in `analysis/rules/` changes.

### 1.2 Formality-aware policy

`documentProfile` and document goals already carry formality. Use them:

- Informal: allow contractions like "y'know", skip `ExpandMinimum` and
  similar expansion rules, keep spelling and repetition.
- Formal: keep all rules on, add hedging and passive voice as suggestions.

Implement as a `policyFor(settings, goals)` function in
`analysis/engines/harper.js` that returns the lint config diff. Unit test it
in `tests/analysis/engines.test.js`.

### 1.3 Grow the corpus

Target 300 dev cases and 100 held-out, covering the five genres the harness
already knows (email, post, document, message, essay).

- Seed from public GEC corpora with compatible licenses (JFLEG is CC BY-NC-SA,
  so check against the MIT license before including; W&I+LOCNESS requires
  attribution). Record `source.license` on every case, as the schema demands.
- Add at least 40 informal cases so 1.2 has something to measure.
- Add cases for the rules in `analysis/rules/` (redundant phrase, repetition,
  long sentence, passive voice, hedging), which the current report shows as
  five style observations with no annotated targets.

### 1.4 Gate on the numbers

Add to `check.yml`: fail the build if clean-text false positives per 1k words
exceed the committed baseline plus a tolerance, or if likely-error recall on
dev drops. Store the thresholds in `eval/harness/thresholds.json`.

Done when: held-out precision and false positive rate are both better than
baseline and CI enforces it.

## Phase 2: Private AI

Goal: AI that matches the privacy promise. Depends on 0.2 for the settings
UI work.

### 2.1 Custom OpenAI-compatible endpoint

Covers Ollama, LM Studio, vLLM, Groq, Together, and any proxy the user runs.

1. In `ai/providers.js`, add provider `custom` whose origin comes from the
   connection record instead of `ORIGINS`. Require `https:` or
   `http://localhost` / `http://127.0.0.1`. Reject anything else at
   `connect` time and at request time.
2. In `ai/connections.js`, extend `Connection` with `baseUrl` for `custom`
   only. `normalize` drops a custom connection with an invalid URL.
3. In `app/ConnectionsSection.jsx`, add a URL field and allow an empty key
   for localhost origins, since Ollama needs none.
4. `listModels` uses `/models` with the chat-completions shape already used
   for OpenRouter.
5. Update CONTRIBUTING.md: the allowlist rule now reads "fixed origins, or a
   single origin the user typed in Settings". Document the risk in README.

Tests: `tests/ai/connections.test.js` for URL validation,
`tests/ai/client.test.js` for the request shape, a Playwright test with a
mocked localhost server.

### 2.2 In-browser model with WebLLM

Fully local generation for users who will not use any cloud.

1. Add `@mlc-ai/web-llm` as an optional, lazily imported chunk. Never in the
   service worker precache (the weights are gigabytes and the model cache is
   managed by WebLLM itself).
2. Provider `local` in `ai/providers.js` returns a stream from the engine
   instead of a `fetch`. Keep the `client.js` streaming interface unchanged
   so `validate.js`, `rewrite.js`, and the review state do not care.
3. Settings shows a model picker (start with one 1B to 3B instruct model),
   a download progress bar, WebGPU detection, and a storage estimate.
4. Prompts: the JSON output contract in `ai/prompts.js` is strict. Add a
   repair pass in `validate.js` for small models (strip fences, fix trailing
   commas) before rejecting.

Tests: unit tests with a fake engine. Playwright test skipped when WebGPU is
unavailable.

### 2.3 Session-only keys

A "Don't remember this key" checkbox on the connection form keeps the key in
memory only for the session. That covers the shared-computer case with about
twenty lines of code and no passphrase.

1. In `ai/connections.js`, add `remember: boolean` to `Connection`. A
   connection with `remember: false` is never written to the `aiConnections`
   pref.
2. In `app/ConnectionsSection.jsx`, add the checkbox on the key form and a
   "Session only" label in the connection list.
3. README "Data and credentials": mention the option.

Done when: a user can run an AI action against Ollama with no key, against
WebLLM with no network, and can choose not to persist a key.

## Phase 3: Own your files

Goal: documents survive cleared site data and are usable by other tools.
Depends on 0.2.

### 3.1 Library export and import

Works everywhere, so it ships first.

1. `documents/library.js`: `exportLibrary()` writes a zip containing one
   `.md` per document with front matter (id, title, created, updated,
   goals) plus `library.json` with prefs and dismissals. Use `fflate` or the
   browser's `CompressionStream`.
2. `importLibrary(file)` merges by id, keeping the newer `updatedAt`, and
   reports counts.
3. Buttons in `SettingsDialog.jsx`. Mention in README before "Clearing site
   data removes local drafts".

### 3.2 Folder autosave with the File System Access API

Chromium only, feature-detected, off by default.

1. `documents/folder-sync.js`: user picks a directory; the handle is stored
   in IndexedDB (`prefs`). On each successful save in `useAutosave`, write
   `<safeFilename(title)>.md` through `toMarkdown`. Debounce behind the
   existing 600 ms save.
2. On load, if a folder is connected, scan it for `.md` files not in the
   database and offer to import them. Detect external edits by comparing the
   file's `lastModified` with the stored `updatedAt`, and offer a diff
   instead of overwriting silently.
3. Permission can lapse between sessions. Show a one-click "Reconnect folder"
   notice, never a modal on load.
4. Firefox and Safari see the feature as unavailable with a short
   explanation and a pointer to 3.1.

Tests: unit tests with a fake directory handle. One Playwright test on
Chromium using the test-only `showDirectoryPicker` override.

Done when: a user on Chromium can point the app at an Obsidian vault or a
Git repository and see Markdown files appear and update as they type.

## Phase 4: Editor essentials

Goal: the features a daily writer expects. Each item is independent and can
ship on its own. Depends on 0.2.

### 4.1 Find and replace

- `editor/find.js`: a ProseMirror plugin that decorates matches, with
  case and whole-word options. Replace one, replace all, as a single
  history step.
- Shortcut `Mod+F` and a slim bar below the format bar. `Escape` closes it.
- Playwright test: find, replace all, undo restores the text.

### 4.2 Sidebar search, pinning, and tags

- `Sidebar.jsx` gains a filter box (title and first 200 characters of
  text), a pin toggle, and tag chips. Store `pinned` and `tags` on
  `StoredDocument`; bump `DB_VERSION` to 2 with a no-op upgrade.
- Sorting: pinned first, then `updatedAt`.

### 4.3 Version history with diffs

- Recovery copies already exist every 5 minutes. Add a "History" entry in
  the document menu that lists them with timestamps and word counts.
- Selecting one shows a block-level diff against the current document using
  the existing `diff` dependency and the preview components from
  `ai/preview.js`. "Restore" creates a recovery copy of the current state
  first.
- Raise `RECOVERY_KEEP` to 30 and add a daily cap so long sessions do not
  fill storage.

### 4.4 Print and PDF

- A print stylesheet in `styles.css`: hide chrome, set the measure, use the
  body font, page margins, headings that do not orphan.
- "Print or save as PDF" in the export menu calls `window.print()`.
- No PDF library. The browser's print dialog is the PDF exporter.

### 4.5 Outline, typewriter scrolling, and session goal

- Outline: a headings list in the assist panel that scrolls to the block.
  Headings already carry `blockId`, so this is a read of the snapshot.
- Typewriter scrolling: a toggle that keeps the caret in the vertical
  middle in focus mode.
- Session goal: a word target in the topbar counter with a progress ring.
  Resets on a new day. Stored in prefs.

### 4.6 PWA file handlers and share target

- `manifest.webmanifest`: add `file_handlers` for `.md`, `.txt`, `.docx`.
  Handle `launchQueue` in `main.jsx` and route through the existing import
  path.
- Add a 512 px icon and a maskable icon, which the manifest currently lacks.

Done when: each item has a unit or Playwright test and a line in the README
feature list.

## Phase 5: Reach

Goal: more people find and share the editor without any server.

### 5.1 Share links in the URL fragment

- `site/share.js`: serialize the snapshot to Markdown, compress with
  `CompressionStream`, base64url encode, put it after `#`. Fragments never
  reach the server or Pages logs.
- Opening such a link imports the text as a new document and clears the
  fragment with `history.replaceState`.
- Cap at about 32 KB compressed with a clear message above that.
- The `handoff.js` sessionStorage path stays for landing pages.

### 5.2 More landing pages

Each page is a copy of `grammar-checker/index.html` with new copy and a
`data-handoff` intent. Add:

- `word-counter/`: shows live counts on the page itself using
  `documentProfile`, then offers the editor.
- `readability-checker/`: Flesch score and reading time on the page.
- `sentence-rewriter/`: hands off with intent `paraphrase` and a selection
  hint.

Register each in `vite.config.js` inputs and in `playwright.pages.config.js`.

### 5.3 Install and update prompts

- Show the `beforeinstallprompt` once after the second visit.
- The service worker already uses `skipWaiting`. Add a small "Updated,
  reload for the new version" toast when a new worker takes control.

## Sequencing

```
0.1 baseline ──┐
0.2 App split ─┼─► 1.x proofreading ─► 1.4 CI gate
0.3 naming ────┘      │
                      ├─► 2.1 custom endpoint ─► 2.2 WebLLM ─► 2.3 session-only keys
                      ├─► 3.1 library zip ─► 3.2 folder autosave
                      ├─► 4.1 find/replace, 4.2 sidebar, 4.3 history, 4.4 print, 4.5, 4.6
                      └─► 5.1 share links, 5.2 landing pages, 5.3 install prompt
```

Suggested first milestone: 0.1, 0.2, 1.1, 1.2, 2.1, 4.1. That gives a
measured proofreader, a maintainable shell, local models through Ollama, and
find and replace.

## Out of scope for now

- Real-time collaboration. It needs a signaling or relay server, which the
  project's constraints exclude.
- Tables and images in the editor. The schema is deliberately limited and
  the proofreading pipeline assumes text blocks.
- Any telemetry, even opt-in. `telemetry.js` stays a no-op.
