import { test, expect } from '@playwright/test';
import { WEBKIT_SELECT_CSP } from './known-browser-noise.js';

function watchErrors(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !WEBKIT_SELECT_CSP.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

const LANDINGS = [
  ['/grammar-checker/', 'Free grammar checker', 'Check my writing'],
  ['/paraphrasing-tool/', 'Paraphrasing tool you can check', 'Open in the editor'],
  ['/passive-voice-checker/', 'Passive voice checker', 'Check for passive voice'],
];

for (const [path, heading, button] of LANDINGS) {
  test(`landing page ${path} opens the editor with the pasted text`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
    await expect(page).toHaveTitle(/Open Writer/u);
    expect(await page.locator('meta[name="description"]').getAttribute('content')).toBeTruthy();
    const go = page.getByRole('button', { name: button });
    await expect(go).toBeDisabled();
    const text = 'The report was approved by the board.\n\nTeh second paragraph is here.';
    await page.getByLabel(/text/iu).fill(text);
    await go.click();

    await expect(page).toHaveURL(/\/$/u);
    expect(page.url()).not.toContain('report'); // never in the URL
    const editor = page.locator('.ProseMirror');
    await expect(editor.locator('p').first()).toHaveText('The report was approved by the board.');
    await expect(editor.locator('p').nth(1)).toHaveText('Teh second paragraph is here.');
    await expect(page.locator('.doc-title')).toHaveValue('The report was approved by the');
    if (path === '/paraphrasing-tool/') await expect(page.getByRole('tab', { name: /AI/u })).toHaveAttribute('aria-selected', 'true');
    // Handed over once: a reload keeps the document but doesn't import again.
    await expect(page.locator('.status__check')).toHaveText('Checked');
    await page.reload();
    await expect(page.locator('.doclist li')).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}

test('the privacy page explains the data flow and the editor links to it', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/privacy/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy and data');
  await expect(page.getByRole('table')).toContainText('Your AI API key');
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Details' })).toHaveAttribute('href', '/privacy/');
  expect(errors).toEqual([]);
});
