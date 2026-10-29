import { sse } from './direct-provider.js';
import { test, expect } from '@playwright/test';
import { WEBKIT_SELECT_CSP } from './known-browser-noise.js';

/** Collect console errors and CSP violations for the whole test. */
function watchErrors(page) {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !WEBKIT_SELECT_CSP.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

const editor = (page) => page.locator('.ProseMirror');
const cards = (page) => page.locator('[data-card]');

async function typeDocument(page, text) {
  // The editor is read-only until its document has loaded.
  await expect(editor(page)).toHaveAttribute('contenteditable', 'true');
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text);
}

test('checks locally, applies a correction, and undoes it', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await typeDocument(page, 'Teh invoice for $1,200 may arrive Friday. In order to avoid delays, please confirm.');

  // Real Harper findings arrive from the worker under the production CSP.
  await expect(page.locator('.issue--error').first()).toBeVisible();
  await expect(page.locator('.status__check')).toHaveText('Checked');
  const spelling = cards(page).filter({ hasText: 'Teh' }).first();
  await expect(spelling).toBeVisible();
  await expect(cards(page).filter({ hasText: 'In order to' })).toHaveCount(1);

  await spelling.click();
  await spelling.getByRole('button', { name: /Use “The”/u }).click();
  await expect(editor(page)).toContainText('The invoice for $1,200 may arrive Friday.');

  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(editor(page)).toContainText('Teh invoice');

  expect(errors.filter((e) => !/favicon/u.test(e))).toEqual([]);
});

test('keeps the draft across a reload and shows save status', async ({ page }) => {
  await page.goto('/');
  const marker = `Persistence check ${Date.now()}`;
  await typeDocument(page, marker);
  await expect(page.locator('.status__save')).toHaveText('Saved on this device');
  await page.reload();
  await expect(editor(page)).toContainText(marker);
});

test('dismissing and adding to the dictionary stick', async ({ page }) => {
  await page.goto('/');
  await typeDocument(page, 'Quuxify ships today. Teh plan is ready.');
  const word = cards(page).filter({ hasText: 'Quuxify' }).first();
  await expect(word).toBeVisible();
  await word.click();
  await word.getByRole('button', { name: 'Add to dictionary' }).click();
  await expect(cards(page).filter({ hasText: 'Quuxify' })).toHaveCount(0);

  const teh = cards(page).filter({ hasText: 'Teh' }).first();
  await teh.click();
  await teh.getByRole('button', { name: 'Dismiss' }).click();
  await expect(cards(page).filter({ hasText: 'Teh' })).toHaveCount(0);

  // A later check keeps both suppressed.
  await page.reload();
  await expect(page.locator('.status__check')).toHaveText('Checked');
  await expect(cards(page).filter({ hasText: 'Quuxify' })).toHaveCount(0);
  await expect(cards(page).filter({ hasText: 'Teh' })).toHaveCount(0);
});

test('editing while a check is pending never applies a stale range', async ({ page }) => {
  await page.goto('/');
  await typeDocument(page, 'teh cat sat.');
  const card = cards(page).filter({ hasText: 'teh' }).first();
  await expect(card).toBeVisible();
  await card.click();
  // Insert text before the issue, then accept immediately.
  await editor(page).click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  await page.keyboard.type('Well, ');
  const button = cards(page).filter({ hasText: 'teh' }).first().getByRole('button', { name: /Use/u }).first();
  if (await button.isEnabled().catch(() => false)) await button.click();
  // Either the panel refreshed and the fix landed on "teh", or nothing changed.
  await expect(editor(page)).toHaveText(/^Well, (teh|the) cat sat\.$/u);
});

test.describe('offline', () => {
  test.use({ serviceWorkers: 'allow' });

  test('works offline after the first visit', async ({ page, context, browserName }) => {
    // Playwright drives service workers in Chromium only; check offline by hand in Safari and Firefox.
    test.skip(browserName !== 'chromium', 'service workers are only automatable in Chromium');
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await context.setOffline(true);
    await page.reload();
    await typeDocument(page, 'Offline teh check.');
    await expect(cards(page).filter({ hasText: 'teh' }).first()).toBeVisible();
    await context.setOffline(false);
  });
});

test('narrow screens keep the draft visible and open suggestions on demand', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/');
  await typeDocument(page, 'Teh plan.');
  await expect(page.locator('.assist')).toBeHidden();
  await page.getByRole('button', { name: /Review \(/u }).click();
  await expect(page.locator('.assist')).toBeVisible();
  await expect(editor(page)).toBeVisible();
});

test('first visit opens a welcome document with mistakes to try', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.doc-title')).toHaveValue('Welcome to Open Writer');
  await expect(cards(page).filter({ hasText: 'Teh' }).first()).toBeVisible();
});

test('choosing an issue in the review panel scrolls the page to its text', async ({ page }) => {
  await page.goto('/');
  const filler = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} is clean and says nothing wrong at all.`).join('\n');
  await expect(editor(page)).toHaveAttribute('contenteditable', 'true');
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(filler);
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('The last line has a mistake: teh end.');
  await expect(cards(page).filter({ hasText: 'teh' }).first()).toBeVisible();

  const desk = page.locator('.desk');
  await desk.evaluate((el) => el.scrollTo(0, 0));
  const target = page.locator('[data-issue-id]', { hasText: 'teh' });
  await expect(target).not.toBeInViewport();

  await cards(page).filter({ hasText: 'teh' }).first().click();
  await expect(target).toBeInViewport();
  await expect(target).toHaveClass(/issue--active/u);

  // Choosing it again after scrolling away brings it back.
  await desk.evaluate((el) => el.scrollTo(0, 0));
  await expect(target).not.toBeInViewport();
  await cards(page).filter({ hasText: 'teh' }).first().click();
  await expect(target).toBeInViewport();
});

test('clicking an underline opens the suggestion next to the text', async ({ page }) => {
  await page.goto('/');
  await typeDocument(page, 'We shipped teh release.');
  const word = page.locator('[data-issue-id]', { hasText: 'teh' });
  await expect(word).toBeVisible();
  await word.click();
  const pop = page.getByRole('dialog', { name: 'Suggestion' });
  await expect(pop).toBeVisible();
  await pop.getByRole('button', { name: /Use “the”/u }).click();
  await expect(pop).toBeHidden();
  await expect(editor(page)).toHaveText('We shipped the release.');
});

test('focus mode hides the panels and Escape brings them back', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Focus mode' }).click();
  await expect(page.locator('.assist')).toBeHidden();
  await expect(page.locator('.drawer')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('.assist')).toBeVisible();
});

test('a change saved in another tab replaces this tab’s text, and editing then keeps it', async ({ context }) => {
  const a = await context.newPage();
  await a.goto('/');
  await expect(a.locator('.status__check')).toHaveText('Checked');
  const b = await context.newPage();
  await b.goto('/');
  await expect(b.locator('.status__check')).toHaveText('Checked');

  // An unedited tab reloads quietly.
  await typeDocument(b, 'Written in tab B.');
  await expect(b.locator('.status__save')).toHaveText('Saved on this device');
  await expect(editor(a)).toHaveText('Written in tab B.');

  // Editing after that reload must not bring the old text back.
  await editor(a).click();
  await a.keyboard.press('End');
  await a.keyboard.type(' Then A.');
  await expect(a.locator('.status__save')).toHaveText('Saved on this device');
  await b.reload();
  await expect(editor(b)).toHaveText('Written in tab B. Then A.');

  // Both tabs edit at nearly the same time. If the edits overlap, the tab that saves
  // second sees a conflict and loads the other's version. If they don't (one save lands
  // before the other tab starts typing), the clean tab reloads first and both end on
  // the later edit. Either way nothing is lost silently.
  await typeDocument(a, 'Version A.');
  await typeDocument(b, 'Version B.');
  const loadButton = (p) => p.getByRole('button', { name: 'Load that version' });
  const settled = async () => {
    if ((await loadButton(a).isVisible()) || (await loadButton(b).isVisible())) return 'conflict';
    const [ta, tb] = [await editor(a).innerText(), await editor(b).innerText()];
    const saved = (await a.locator('.status__save').innerText()) === 'Saved on this device' && (await b.locator('.status__save').innerText()) === 'Saved on this device';
    return saved && ta === tb ? 'converged' : null;
  };
  let outcome = null;
  const state = async () => JSON.stringify(await Promise.all([a, b].map(async (p) => [await editor(p).innerText(), await p.locator('.status__save').innerText(), await loadButton(p).isVisible()])));
  await expect.poll(async () => (outcome = await settled()), { timeout: 15_000, message: 'state' }).toBeTruthy().catch(async (e) => {
    throw new Error(`neither a conflict nor convergence: ${await state()}`, { cause: e });
  });
  if (outcome === 'converged') {
    await expect(editor(a)).toHaveText('Version B.');
    return;
  }
  const loser = (await loadButton(a).isVisible()) ? a : b;
  const winner = loser === a ? b : a;
  const winnerText = loser === a ? 'Version B.' : 'Version A.';
  await expect(loadButton(winner)).toHaveCount(0);
  await loadButton(loser).click();
  await expect(editor(loser)).toHaveText(winnerText);
  await editor(loser).click();
  await loser.keyboard.press('End');
  await loser.keyboard.type(' Agreed.');
  await expect(loser.locator('.status__save')).toHaveText('Saved on this device');
  await expect(editor(winner)).toHaveText(`${winnerText} Agreed.`);
});

test('deleting a document right after typing in it does not bring it back', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.status__check')).toHaveText('Checked');
  await page.getByRole('button', { name: 'New' }).click();
  await expect(page.getByRole('button', { name: 'Delete Untitled' })).toBeVisible();
  await expect(editor(page)).toHaveAttribute('contenteditable', 'true');
  await editor(page).click();
  await page.keyboard.type('Short-lived draft');
  // Delete before the save debounce fires.
  await page.getByRole('button', { name: 'Delete Untitled' }).click();
  await page.locator('.doclist__confirm').getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.doc-title')).toHaveValue('Welcome to Open Writer');
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.locator('.status__check')).toHaveText('Checked');
  await expect(page.getByRole('button', { name: 'Delete Untitled' })).toHaveCount(0);
});

test('underlines stay on their words after a fix shortens the text, while checking is paused', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.status__check')).toHaveText('Checked');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Pause checking').check();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.status__check')).toHaveText('Checking paused');

  const card = cards(page).filter({ hasText: 'In order to' }).first();
  await card.click();
  await card.getByRole('button', { name: /Use “To”/u }).click();
  await expect(editor(page)).toContainText('To save time');
  // Nothing rechecks while paused, so the remaining underlines must have moved with the text.
  await expect(page.locator('.issue', { hasText: /^recieved$/u })).toHaveCount(1);
  await expect(page.locator('.status__check')).toHaveText('Checking paused');
});

test('the long-sentence setting accepts a typed number', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const field = page.getByLabel('Mark sentences longer than');
  await field.fill('');
  await field.pressSequentially('25');
  await expect(field).toHaveValue('25');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByLabel('Mark sentences longer than')).toHaveValue('25');
});

test('connecting an AI provider: a rejected key, a working key, trying it, and removing it', async ({ page }) => {
  const errors = watchErrors(page);
  // Stand in for the provider so no real provider is called.
  await page.route('https://api.anthropic.com/v1/models?limit=100', async (route) => {
    const key = route.request().headers()['x-api-key'];
    if (key === 'sk-ant-good') {
      await route.fulfill({ json: { data: [
        { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }, { id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' },
      ] } });
    } else {
      await route.fulfill({ status: 401, json: { error: 'invalid-key', message: 'Anthropic did not accept this API key.' } });
    }
  });
  let tried;
  await page.route('https://api.anthropic.com/v1/messages', async (route) => {
    tried = { body: route.request().postDataJSON(), key: route.request().headers()['x-api-key'] };
    await route.fulfill(sse([
      {type:'content_block_delta',delta:{type:'text_delta',text:'Use “They’re”, remove one “the”, and spell “tomorrow”.'}},
      {type:'message_delta',delta:{stop_reason:'end_turn'}},
      {type:'message_stop'},
    ]));
  });

  await page.goto('/');
  await expect(page.locator('.statusbar__ai')).toHaveText('AI: not connected');
  await page.locator('.statusbar__ai').click();
  const key = page.getByLabel('Anthropic API key');
  await key.fill('sk-ant-wrong');
  await key.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'rejected' })).toBeVisible();
  await expect(page.getByRole('dialog')).toBeVisible(); // Enter connected instead of closing

  const row = page.locator('.conn', { hasText: 'Anthropic' });
  await key.fill('sk-ant-good');
  await row.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(row.getByText('In use')).toBeVisible();
  await expect(row.getByLabel('Model')).toHaveValue('claude-opus-5-5');
  await row.getByLabel('Model').selectOption('claude-haiku-5-5');
  await row.getByRole('button', { name: 'Try it' }).click();
  await expect(row.locator('.conn__trial')).toContainText('spell “tomorrow”');
  expect(tried.key).toBe('sk-ant-good');
  expect(JSON.stringify(tried.body)).not.toContain('sk-ant-good');
  expect(tried.body).toMatchObject({ model: 'claude-haiku-5-5' });

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.statusbar__ai')).toHaveText('AI: Claude Haiku 5.5');
  // Let the first check finish: WebKit logs an error when a reload cancels the worker's load.
  await expect(page.locator('.status__check')).toHaveText('Checked');
  await page.reload();
  await expect(page.locator('.statusbar__ai')).toHaveText('AI: Claude Haiku 5.5');

  await page.locator('.statusbar__ai').click();
  await page.locator('.conn', { hasText: 'Anthropic' }).getByRole('button', { name: 'Remove key' }).click();
  await expect(page.getByLabel('Anthropic API key')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.statusbar__ai')).toHaveText('AI: not connected');
  expect(errors.filter((e) => !/favicon|401/u.test(e))).toEqual([]);
});

test('reporting a wrong suggestion removes it', async ({ page }) => {
  await page.goto('/');
  const card = cards(page).filter({ hasText: 'recieved' }).first();
  await expect(card).toBeVisible();
  await card.click();
  await card.getByRole('button', { name: 'Mark as incorrect' }).click();
  await expect(cards(page).filter({ hasText: 'recieved' })).toHaveCount(0);
});

test('connecting a local OpenAI-compatible endpoint with no key, session only', async ({ page }) => {
  const errors = watchErrors(page);
  // Stand in for Ollama on this machine.
  await page.route('http://localhost:11434/v1/models', async (route) => {
    await route.fulfill({ json: { object: 'list', data: [{ id: 'llama3.2:3b', object: 'model' }, { id: 'qwen2.5:7b', object: 'model' }] } });
  });
  let tried;
  await page.route('http://localhost:11434/v1/chat/completions', async (route) => {
    tried = { body: route.request().postDataJSON(), auth: route.request().headers().authorization };
    await route.fulfill(sse([{ choices: [{ delta: { content: 'Fix “their” and the doubled “the”.' }, finish_reason: 'stop' }] }]));
  });

  await page.goto('/');
  await page.locator('.statusbar__ai').click();
  const row = page.locator('.conn', { hasText: 'Custom endpoint' });
  await row.getByLabel('Custom endpoint URL').fill('http://example.com/v1');
  await row.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(row.getByRole('alert')).toContainText('https');

  await row.getByLabel('Custom endpoint URL').fill('http://localhost:11434/v1/');
  await row.getByLabel('Don’t remember this key on this device').check();
  await row.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(row.getByText('In use')).toBeVisible();
  await expect(row.getByText('Session only')).toBeVisible();
  await expect(row.getByText('Endpoint: localhost:11434')).toBeVisible();
  await expect(row.getByLabel('Model')).toHaveValue('llama3.2:3b');
  await row.getByRole('button', { name: 'Try it' }).click();
  await expect(row.locator('.conn__trial')).toContainText('doubled');
  expect(tried.auth).toBeUndefined();
  expect(tried.body).toMatchObject({ model: 'llama3.2:3b' });

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.statusbar__ai')).toHaveText('AI: llama3.2:3b');
  await expect(page.locator('.status__check')).toHaveText('Checked');
  // Session only: a reload forgets it.
  await page.reload();
  await expect(page.locator('.statusbar__ai')).toHaveText('AI: not connected');
  expect(errors.filter((e) => !/favicon/u.test(e))).toEqual([]);
});

test('the in-browser model row explains WebGPU support and never downloads on its own', async ({ page }) => {
  const errors = watchErrors(page);
  const downloads = [];
  await page.route(/huggingface|mlc\.ai|jsdelivr|githubusercontent/u, (route) => { downloads.push(route.request().url()); route.abort(); });
  await page.goto('/');
  await page.locator('.statusbar__ai').click();
  const row = page.locator('.conn', { hasText: 'In this browser' });
  const supported = await page.evaluate(() => 'gpu' in navigator);
  if (supported) {
    await expect(row.getByRole('button', { name: 'Download and load' })).toBeVisible();
    await expect(row).toContainText('downloaded once');
  } else {
    await expect(row.getByText('Needs WebGPU')).toBeVisible();
    await expect(row).toContainText('does not offer WebGPU');
  }
  await page.getByRole('button', { name: 'Done' }).click();
  expect(downloads).toEqual([]);
  expect(errors.filter((e) => !/favicon/u.test(e))).toEqual([]);
});

test('export the whole library as a zip and import it back without duplicates', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.locator('.status__check')).toHaveText('Checked');
  await page.getByRole('button', { name: 'Settings' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export all documents (.zip)' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^open-writer-library-\d{4}-\d{2}-\d{2}\.zip$/u);
  const path = await download.path();
  await expect(page.getByRole('status').filter({ hasText: 'Exported 1 document.' })).toBeVisible();

  // Importing the same zip changes nothing; a zip of a new Markdown file adds one.
  await page.getByLabel('Import a library or file').setInputFiles(path);
  await expect(page.getByRole('status').filter({ hasText: 'already up to date' })).toBeVisible();
  await page.getByLabel('Import a library or file').setInputFiles({ name: 'trip-notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Trip\n\nPack **light**.\n') });
  await expect(page.getByRole('status').filter({ hasText: '1 added' })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.doclist__title', { hasText: 'trip notes' })).toBeVisible();
  await page.locator('.doclist__open', { hasText: 'trip notes' }).click();
  await expect(page.locator('.prose h1')).toHaveText('Trip');
  await expect(page.locator('.prose strong')).toHaveText('light');
  expect(errors.filter((e) => !/favicon/u.test(e))).toEqual([]);
});

test('a chosen folder gets a Markdown file per document and picks up outside edits', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'File System Access API');
  const errors = watchErrors(page);
  // An in-memory stand-in for the directory picker, visible to the test as window.__folder.
  await page.addInitScript(() => {
    const files = new Map();
    let clock = 1000;
    const fileHandle = (name) => ({
      kind: 'file', name,
      async getFile() { const f = files.get(name); return { name, lastModified: f.lastModified, text: async () => f.text }; },
      async createWritable() { let b = ''; return { async write(t) { b += t; }, async close() { files.set(name, { text: b, lastModified: ++clock }); } }; },
    });
    const folder = {
      kind: 'directory', name: 'Writing',
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; },
      async getFileHandle(name, { create } = {}) { if (!files.has(name)) { if (!create) throw new DOMException('x', 'NotFoundError'); files.set(name, { text: '', lastModified: ++clock }); } return fileHandle(name); },
      async removeEntry(name) { files.delete(name); },
      async *entries() { for (const n of [...files.keys()]) yield [n, fileHandle(n)]; },
    };
    window.__folder = { files, touch: (n, t) => files.set(n, { text: t, lastModified: ++clock }) };
    window.showDirectoryPicker = async () => folder;
  });
  await page.goto('/');
  await expect(page.locator('.status__check')).toHaveText('Checked');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Choose folder' }).click();
  await expect(page.locator('.folder__status')).toContainText('Writing');
  await expect(page.locator('.folder__status')).toContainText('1 written');
  await page.getByRole('button', { name: 'Done' }).click();
  const names = await page.evaluate(() => [...window.__folder.files.keys()]);
  expect(names).toEqual(['Welcome to Open Writer.md']);

  // Typing updates the file.
  await page.locator('.prose').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Folder test.');
  await expect.poll(() => page.evaluate(() => window.__folder.files.get('Welcome to Open Writer.md').text)).toContain('Folder test.');

  // An outside edit is loaded on the next check.
  await page.evaluate(() => {
    const text = window.__folder.files.get('Welcome to Open Writer.md').text;
    window.__folder.touch('Welcome to Open Writer.md', text.replace('# Welcome', '# Welcome back'));
  });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(page.locator('.folder__status')).toContainText('1 updated from the folder');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.prose h1').first()).toHaveText('Welcome back');
  expect(errors.filter((e) => !/favicon/u.test(e))).toEqual([]);
});

test('find and replace: count, replace all, and undo', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.locator('.status__check')).toHaveText('Checked');
  await page.locator('.prose').click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
  const find = page.getByLabel('Find', { exact: true });
  await expect(find).toBeFocused();
  await find.fill('the');
  await expect(page.locator('.findbar__count')).toHaveText(/^\d+ of \d+$/u);
  const total = Number((await page.locator('.findbar__count').textContent()).split(' of ')[1]);
  expect(total).toBeGreaterThan(3);
  await page.getByLabel('Whole word').check();
  await expect(page.locator('.findbar__count')).toHaveText(/^\d+ of \d+$/u);
  await expect(page.locator('.find-match').first()).toBeVisible();
  await page.getByLabel('Replace with').fill('ZZZ');
  await page.getByRole('button', { name: 'Replace all' }).click();
  await expect(page.locator('.findbar__count')).toHaveText('No matches');
  await expect(page.locator('.find-match')).toHaveCount(0);
  await expect(page.locator('.prose')).toContainText('ZZZ');
  await page.getByLabel('Close find').click();
  await expect(page.locator('.findbar')).toHaveCount(0);
  await expect(page.locator('.prose')).toBeFocused();
  await page.locator('.prose').press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect(page.locator('.prose')).not.toContainText('ZZZ');
  expect(errors.filter((e) => !/favicon/u.test(e))).toEqual([]);
});

test('pin, search, and tag documents in the sidebar', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.locator('.status__check')).toHaveText('Checked');
  // A second document, so the list has something to sort and search.
  await page.getByRole('button', { name: 'New' }).click();
  await expect(page.locator('.doclist__item')).toHaveCount(2);
  await expect(page.getByLabel('Document title')).toHaveValue('Untitled');
  await page.getByLabel('Document title').fill('Lisbon trip');
  await page.locator('.prose').click();
  await page.keyboard.type('Pack sandals and a hat.');
  await expect(page.locator('.status__save')).toHaveText('Saved on this device');
  await expect(page.locator('.doclist__title').first()).toHaveText('Lisbon trip');

  // Tag the open document; the tag shows in the list and filters it.
  await page.getByLabel('Add a tag').fill('Travel Plans');
  await page.getByLabel('Add a tag').press('Enter');
  await expect(page.locator('.tags .tag--on')).toHaveText(/#travel-plans/u);
  await expect(page.locator('.status__save')).toHaveText('Saved on this device');
  const chip = page.locator('[aria-label="Filter by tag"] .tag', { hasText: '#travel-plans' });
  await chip.click();
  await expect(page.locator('.doclist__item')).toHaveCount(1);
  await chip.click();
  await expect(page.locator('.doclist__item')).toHaveCount(2);

  // Pin the other document: it moves to the top and stays there after a reload.
  await page.getByRole('button', { name: 'Pin Welcome to Open Writer' }).click();
  await expect(page.locator('.doclist__title').first()).toHaveText(/Welcome to Open Writer/u);
  await page.reload();
  await expect(page.locator('.doclist__title').first()).toHaveText(/Welcome to Open Writer/u);
  await expect(page.locator('.doclist__date').nth(1)).toContainText('#travel-plans');

  // Search matches the first words of a document, not only its title.
  await page.getByLabel('Search documents').fill('sandals');
  await expect(page.locator('.doclist__item')).toHaveCount(1);
  await expect(page.locator('.doclist__title')).toHaveText('Lisbon trip');
  await page.getByLabel('Search documents').fill('zzzz');
  await expect(page.locator('.doclist__empty')).toBeVisible();
  expect(errors.filter((e) => !/favicon/u.test(e))).toEqual([]);
});

test('printing shows the document alone', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.status__check')).toHaveText('Checked');
  await page.locator('summary[aria-label="Export"]').click();
  await expect(page.getByRole('button', { name: 'Print or save as PDF' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.topbar')).toBeHidden();
  await expect(page.locator('.statusbar')).toBeHidden();
  await expect(page.locator('.prose')).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
  await expect(page.locator('.topbar')).toBeVisible();
});

test('history: save a version, see the diff, and restore it', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.locator('.status__check')).toHaveText('Checked');
  await page.getByRole('button', { name: 'History' }).click();
  await page.getByRole('button', { name: 'Save a version now' }).click();
  await expect(page.locator('.history__item')).toHaveCount(1);
  await expect(page.locator('.history__summary')).toHaveText('Same text as now.');
  await page.getByRole('button', { name: 'Close' }).click();

  await page.locator('.prose h1').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' aboard');
  await expect(page.locator('.status__save')).toHaveText('Saved on this device');
  await page.getByRole('button', { name: 'History (1)' }).click();
  await expect(page.locator('.history__summary')).toContainText('1 changed');
  await expect(page.locator('.history__diff ins')).toContainText('aboard');
  await page.getByRole('button', { name: 'Restore this version' }).click();
  await expect(page.locator('.prose h1').first()).toHaveText('Welcome');
  // Restoring kept the text from before as a version.
  await expect(page.getByRole('button', { name: 'History (2)' })).toBeVisible();
  expect(errors.filter((e) => !/favicon/u.test(e))).toEqual([]);
});

test('outline, typewriter setting, daily goal, and PWA file handlers', async ({ page, request }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.locator('.status__check')).toHaveText('Checked');
  // Outline lists the welcome headings and clicking one moves the cursor there.
  const outline = page.locator('.outline__link');
  await expect(outline).toHaveCount(3);
  await expect(outline.nth(1)).toHaveText('Try it');
  await outline.nth(2).click();
  const focusedHeading = await page.evaluate(() => { const ed = document.querySelector('.ProseMirror').editor; return ed.state.selection.$from.parent.textContent; });
  expect(focusedHeading).toBe('Good to know');

  // Daily goal: set in Settings, shown in the status bar, counts words typed.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Daily word goal').fill('100');
  await page.getByLabel('Typewriter scrolling', { exact: false }).check();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.goal__text')).toHaveText('0 / 100 today');
  await page.locator('.prose p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' one two three');
  await expect(page.locator('.goal__text')).toHaveText('3 / 100 today');
  await page.reload();
  await expect(page.locator('.goal__text')).toHaveText('3 / 100 today');

  // The manifest declares file handlers and a large icon.
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.file_handlers[0].accept['text/markdown']).toContain('.md');
  expect(manifest.icons.some((i) => i.sizes === '512x512')).toBe(true);
  expect((await request.get('/logo-512.png')).ok()).toBe(true);
  expect(errors.filter((e) => !/favicon/u.test(e))).toEqual([]);
});
