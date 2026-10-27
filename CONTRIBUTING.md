# Contributing

Keep the app usable as static files on an HTTPS origin, with no application server. Local proofreading, drafts, import, and export must work without provider credentials. Do not add analytics or send document text without an explicit AI action.

Provider keys belong only in provider authentication headers. Never put keys in URLs, document data, logs, fixtures, build variables, or error messages. Keep provider origins allowlisted in `frontend/src/ai/providers.js`.

Preserve scope validation, complete-response checks, revision guards, meaningful diff previews, and undo when changing the AI workflow. Add tests for behavior changes. Provider tests use fake keys and mocked responses; do not make paid live calls from CI.

Run `npm test`, `npm run build`, and the relevant Playwright tests before submitting changes. The README contains setup instructions.
