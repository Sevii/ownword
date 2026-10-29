# Open Writer

An open-source writing editor that runs in your browser. Adapted from `abstract-writer/online-writer`, retaining its React/Tiptap editor, local proofreading engine, document storage, import/export, and review-before-apply AI workflow.

Currently hosted on github pages

**No application backend, account, proxy, or telemetry.** Your documents stay in IndexedDB on your device. AI actions connect directly to the provider you choose, using your own API key and credits.

## Run

Requires Node.js 22.12+ and npm.

```sh
npm ci --prefix frontend
npm run dev
```

Open the URL printed by Vite. In Settings → AI connections, add a personal API key, choose a model, and try an AI action. API access and billing are separate from consumer chat subscriptions.

```sh
npm run build
npm run preview
```

The deployable app is `frontend/dist/`: upload those static files to any HTTPS static host. Builds default to the origin root; set `OW_BASE_PATH=/your-repository/` for a subpath. Use the same value when running the local preview. No Rust service, environment secrets, functions, database, or API routes are needed. Local development/preview uses Vite only to serve files. This is a browser app, not a double-click `file://` HTML file; service workers require HTTPS or localhost.

After the first complete visit and service worker installation, the editor, bundled fonts, and Harper grammar engine work offline. AI requires a network connection to the provider. The grammar engine includes an approximately 20 MB WebAssembly asset, so the first download can take a moment.

## GitHub Pages

The included `.github/workflows/pages.yml` builds and deploys the app from your repository's default branch. It reads the actual Pages base path, so repository sites (`https://USERNAME.github.io/REPOSITORY/`), account sites, and custom domains use the correct asset paths automatically.

1. Push this project to your GitHub repository, including `.github/workflows/`.
2. In **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**.
3. In **Actions**, run **Deploy to GitHub Pages** on the default branch, or push another commit to that branch. The completed deployment shows the site URL.

No API keys or extra repository secrets are needed. Visitors enter their own keys in the app. The workflow runs unit tests plus browser checks for navigation, offline editing, and the deployment path before uploading `frontend/dist`. Deployment requires the normal Pages environment approval if your repository has configured one. This workflow has been prepared locally; publishing still requires pushing the files and enabling Pages in your repository.

To reproduce a repository-site build locally:

```sh
OW_BASE_PATH=/open-online-writer/ npm run build
OW_BASE_PATH=/open-online-writer/ npm run test:pages
OW_BASE_PATH=/open-online-writer/ npm run preview
```

Open the preview URL with `/open-online-writer/` appended. To return to a root-hosted build, run `npm run build` without `OW_BASE_PATH`. Set the custom domain in GitHub's Pages settings before deploying to it, then rerun the workflow. Changing the hosting origin changes the browser storage location; export drafts before moving between domains.

See [GitHub's custom-workflow instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) and [Vite's GitHub Pages deployment guide](https://vite.dev/guide/static-deploy#github-pages).

## Features

- Rich text editing, local autosave and recovery copies, multiple documents.
- Local spelling, grammar, and style suggestions with dictionary and dialect settings.
- Word, Markdown, and text import/export; print or save as PDF; find and replace; version history with diffs.
- Share links that carry the text inside the URL fragment, so nothing is uploaded or stored anywhere.
- Landing pages for a grammar checker, paraphrasing tool, passive voice checker, word counter, readability checker, and sentence rewriter.
- AI proofreading, tone/audience review, rewriting, and explanations.
- Review diffs and meaning changes before applying; undo an accepted rewrite.
- OpenAI Responses, Anthropic Messages, Gemini, and OpenRouter streaming directly from the browser.
- Any OpenAI-compatible endpoint as a custom connection: Ollama or LM Studio on your own machine with no key, or vLLM, Groq, Together, and proxies over HTTPS.
- A small model running in the browser itself with WebGPU (WebLLM). The weights are downloaded once (about 1 to 3 GB) and cached; after that, AI actions need no network and send nothing anywhere.

Model lists come from the provider. Model availability, permissions, browser access, and billing depend on your account; a listed model may still reject a generation request. There is no proxy fallback. An interrupted, truncated, or malformed response cannot be applied as a completed rewrite.

## Data and credentials

In Chrome and Edge, Settings → Folder on this computer keeps every document as a Markdown file in a folder you choose, written as you type and read back when the files change elsewhere, so Git, Obsidian, or a backup tool can see your writing. In every browser, Settings → Your documents exports the whole library as a zip and imports one back.

Keys are saved unencrypted in browser IndexedDB, separately from documents, and sent in authentication headers only to fixed provider origins, or to the one custom endpoint you typed. Tick “Don’t remember this key on this device” when connecting to keep a key in memory only until the tab closes. They are not embedded in builds or exports. Use personal keys, remove them on shared devices, and set provider spending limits. Anyone with access to this browser profile can access its stored keys and drafts. Clearing site data removes local drafts and keys; export important writing.

Only explicit AI actions transmit the selected scope and supporting context to your provider. Provider retention policies still apply. OpenAI requests set `store: false`; that is not a promise of zero provider retention. Cancellation aborts the browser request; it cannot undo processing or charges already incurred.

## Development and checks

```sh
npm test
npm run build
cd frontend
npx playwright install chromium
npm run test:e2e -- --project=chromium --project=android
cd ..
npm run eval:smoke
```

`npm run eval:full` scores the proofreader on the dev corpus and `npm run eval:gate` fails when it drops below `eval/harness/thresholds.json`; CI runs both. From `frontend/`, `npm run eval:rules` prints, per rule, how often it lands on an annotated error versus clean text. The held-out split needs `HELDOUT=1` and every run is logged.

Browser tests start their own static preview on port 5004 and require a completed build. AI tests mock provider responses and spend no credits. Real-key browser compatibility and generation must be checked separately before release. Other configured browser projects require the corresponding Playwright browser installs.

| Directory | Contents |
| --- | --- |
| `frontend/src/app` | Editor UI |
| `frontend/src/analysis` | Local proofreading and meaning checks |
| `frontend/src/ai` | Direct provider adapters, prompts, output validation, review state |
| `frontend/src/documents` | Browser storage and export |
| `contracts` | Shared data schemas and fixtures |
| `eval` | Local grammar/style evaluation corpus and harness |

The original server, operations tooling, deployment setup, and browser extension are not part of this fork. The original project is unchanged. See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution conventions and [NOTICE](NOTICE) for provenance.

## API references

- [OpenAI streaming responses](https://developers.openai.com/api/docs/guides/streaming-responses)
- [Anthropic TypeScript client and browser headers](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/client.ts)
- [Gemini content generation](https://ai.google.dev/api/generate-content)
- [OpenRouter streaming](https://openrouter.ai/docs/api-reference/streaming)

## License

MIT. Dependencies retain their own licenses.
