import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Automated accessibility checks (WCAG 2.1 A and AA) on each main view, light and
// dark. Automated rules catch a subset of problems; keyboard and screen-reader
// checks by hand are still part of M6.2.

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function scan(page, label) {
  // Measure colors after fade-in animations finish, not mid-fade.
  await page.evaluate(() =>
    Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))),
  );
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = violations.map((v) => `${label}: ${v.id} (${v.impact}) ${v.help} -> ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  expect(summary).toEqual([]);
}

for (const scheme of ['light', 'dark']) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme });
    test.skip(({ browserName }) => browserName !== 'chromium', 'axe results do not depend on the engine');

    test('editor, review panel, and suggestion popover', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('.status__check')).toHaveText('Checked');
      await scan(page, 'editor');
      await page.locator('.ProseMirror .issue', { hasText: /^recieved$/u }).click();
      await expect(page.getByRole('dialog', { name: 'Suggestion' })).toBeVisible();
      await scan(page, 'popover');
    });

    test('AI tab and settings dialog', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('.status__check')).toHaveText('Checked');
      await page.getByRole('tab', { name: /AI/u }).click();
      await scan(page, 'ai tab');
      await page.getByRole('button', { name: 'Settings' }).click();
      await scan(page, 'settings');
    });

    test('landing and privacy pages', async ({ page }) => {
      for (const path of ['/grammar-checker/', '/paraphrasing-tool/', '/passive-voice-checker/', '/privacy/']) {
        await page.goto(path);
        await scan(page, path);
      }
    });
  });
}

test('keyboard only: skip to the editor, move through suggestions, open and close dialogs', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one engine is enough for keyboard flow');
  await page.goto('/');
  await expect(page.locator('.status__check')).toHaveText('Checked');

  // The first Tab stop is the skip link, and it leads into the document.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to editor' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.ProseMirror')).toBeFocused();

  // Alt+Down selects the next suggestion; Escape closes the popover and keeps focus in the document.
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.locator('[data-card][aria-current="true"]')).toHaveCount(1);
  await page.locator('.ProseMirror .issue', { hasText: /^recieved$/u }).click();
  await expect(page.getByRole('dialog', { name: 'Suggestion' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Suggestion' })).toHaveCount(0);

  // Cards: arrow keys move between them.
  await page.locator('[data-card]').first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-card]').nth(1)).toBeFocused();

  // Settings opens with focus inside and Escape returns focus to the button.
  const settings = page.getByRole('button', { name: 'Settings' });
  await settings.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(settings).toBeFocused();
});
