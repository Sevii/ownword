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
