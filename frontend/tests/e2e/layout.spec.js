import { test, expect } from '@playwright/test';

for (const [name, size] of [['phone', { width: 390, height: 700 }], ['tablet', { width: 900, height: 700 }], ['desktop', { width: 1400, height: 900 }]]) {
  test(`${name}: the app fits the viewport with no page scroll`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/');
    await page.locator('.status__check').waitFor();
    const { scrollW, scrollH, statusBottom } = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      scrollH: document.documentElement.scrollHeight,
      statusBottom: document.querySelector('.statusbar').getBoundingClientRect().bottom,
    }));
    expect(scrollW).toBeLessThanOrEqual(size.width);
    expect(scrollH).toBeLessThanOrEqual(size.height);
    // Firefox reports fractional pixels (700.00003 for 700).
    expect(statusBottom).toBeLessThanOrEqual(size.height + 0.5);
  });
}
