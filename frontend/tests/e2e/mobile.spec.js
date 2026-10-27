import { mockOpenRouter } from './direct-provider.js';
import { test, expect } from '@playwright/test';
import { WEBKIT_SELECT_CSP } from './known-browser-noise.js';

// Phone flows (run by the android and iphone projects): touch, the off-canvas
// review panel, AI review, dialogs that fit the screen, and landing pages.

const editor = (page) => page.locator('.ProseMirror');

function watchErrors(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !WEBKIT_SELECT_CSP.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

async function noHorizontalScroll(page) {
  const { sw, w } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  expect(sw).toBeLessThanOrEqual(w);
}

test('tap an underline, fix it from the suggestion, and undo', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.locator('.status__check')).toHaveText('Checked');
  await noHorizontalScroll(page);
  const word = editor(page).locator('.issue', { hasText: /^recieved$/u });
  await word.scrollIntoViewIfNeeded();
  await word.tap();
  const pop = page.getByRole('dialog', { name: 'Suggestion' });
  await expect(pop).toBeVisible();
  const box = await pop.boundingBox();
  const vw = page.viewportSize().width;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vw);
  await pop.getByRole('button', { name: /Use “received”/u }).tap();
  await expect(editor(page)).toContainText('confirm you received it');
  expect(errors).toEqual([]);
});

test('the review panel opens over the page and choosing a card scrolls to the text', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.status__check')).toHaveText('Checked');
  await page.getByRole('button', { name: /Review \(\d+\)/u }).tap();
  const panel = page.locator('.assist');
  await expect(panel).toBeInViewport();
  const card = panel.locator('[data-card]', { hasText: 'Teh' }).first();
  await card.tap();
  await page.getByRole('button', { name: 'Close review' }).tap();
  await expect(editor(page).locator('.issue--active')).toBeInViewport();
});

test('AI fix grammar works on a phone and the result can be applied', async ({ page }) => {
  await mockOpenRouter(page);
  await page.goto('/');
  await expect(page.locator('.status__check')).toHaveText('Checked');
  await page.locator('.statusbar__ai').tap();
  const dialog = page.getByRole('dialog');
  await noHorizontalScroll(page);
  const key = page.getByLabel('OpenRouter API key');
  await key.scrollIntoViewIfNeeded();
  await key.fill('sk-or-test');
  await page.locator('.conn', { hasText: 'OpenRouter' }).getByRole('button', { name: 'Connect', exact: true }).tap();
  await expect(page.locator('.conn', { hasText: 'OpenRouter' }).getByText('In use')).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).tap();

  await page.getByRole('button', { name: /Review \(\d+\)/u }).tap();
  await page.getByRole('tab', { name: /AI/u }).tap();
  await page.getByRole('button', { name: 'Fix grammar' }).tap();
  const result = page.getByRole('region', { name: 'Proposed changes' });
  await expect(result).toBeVisible();
  await result.getByRole('button', { name: 'Apply', exact: true }).tap();
  await expect(editor(page)).toContainText('The report is due');
});

test('a landing page works on a phone', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/grammar-checker/');
  await noHorizontalScroll(page);
  await page.getByLabel('Your text').fill('Their going to the meeting.');
  await page.getByRole('button', { name: 'Check my writing' }).tap();
  await expect(editor(page)).toHaveText('Their going to the meeting.');
  await noHorizontalScroll(page);
  expect(errors).toEqual([]);
});
