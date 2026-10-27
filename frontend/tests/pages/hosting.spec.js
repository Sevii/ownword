import { test, expect } from '@playwright/test';

const base = process.env.OW_BASE_PATH || '/';
const editor = page => page.locator('.ProseMirror');

test('assets, manifest, navigation and landing-page handoff stay in the deployment path', async ({ page, baseURL }) => {
  const failures = [], escaped = [], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`); });
  page.on('request', r => {
    const url = new URL(r.url());
    if (url.origin === new URL(baseURL).origin && !url.pathname.startsWith(base)) escaped.push(url.pathname);
  });
  await page.goto('./');
  await expect(editor(page)).toBeVisible();
  await expect(page.locator('.status__check')).toHaveText('Checked');
  await expect(page.getByRole('link', { name: 'Details', exact: true })).toHaveAttribute('href', `${base}privacy/`);
  const manifest = await page.evaluate(async () => {
    const url = document.querySelector('link[rel="manifest"]').href;
    return { url, content: await (await fetch(url)).json() };
  });
  expect(new URL(manifest.url).pathname).toBe(`${base}manifest.webmanifest`);
  for (const key of ['start_url', 'scope', 'id']) expect(new URL(manifest.content[key], manifest.url).pathname).toBe(base);
  expect(new URL(manifest.content.icons[0].src, manifest.url).pathname).toBe(`${base}logo.png`);
  await page.goto('privacy/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy and data');
  await page.getByRole('navigation').getByRole('link', { name: 'Grammar checker' }).click();
  await expect(page).toHaveURL(`${baseURL}grammar-checker/`);
  await page.getByLabel('Your text').fill('A draft passed from the landing page.');
  await page.getByRole('button', { name: 'Check my writing' }).click();
  await expect(page).toHaveURL(baseURL);
  await expect(editor(page)).toHaveText('A draft passed from the landing page.');
  await expect(page.locator('.status__check')).toHaveText('Checked');
  expect(failures).toEqual([]);
  expect(escaped).toEqual([]);
  expect(errors).toEqual([]);
});

test('offline app and landing pages work with a scoped service worker', async ({ page, context, baseURL }) => {
  // Seed another installation and an old version of this installation before activation.
  const other = 'open-writer:' + encodeURIComponent('/another-project/') + ':test';
  const previous = 'open-writer:' + encodeURIComponent(base) + ':old';
  const seedURL = `${baseURL}__cache_seed__`;
  await page.route(seedURL, route => route.fulfill({ contentType: 'text/html', body: '<title>Cache setup</title>' }));
  await page.goto(seedURL);
  await page.evaluate(names => Promise.all(names.map(name => caches.open(name))), [other, previous]);
  await page.unroute(seedURL);
  await page.goto('./');
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toBe(baseURL);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(`${baseURL}sw.js`);
  expect(await page.evaluate(name => caches.has(name), previous)).toBe(false);
  expect(await page.evaluate(name => caches.has(name), other)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(editor(page)).toHaveAttribute('contenteditable', 'true');
  await editor(page).fill('Teh draft works offline.');
  await expect(page.locator('[data-card]').filter({ hasText: 'Teh' }).first()).toBeVisible();
  await expect(page.locator('.status__save')).toHaveText('Saved on this device');
  await page.reload();
  await expect(editor(page)).toContainText('Teh draft works offline.');
  await page.goto('privacy/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy and data');
  await page.getByRole('link', { name: 'Open the editor' }).click();
  await expect(editor(page)).toContainText('Teh draft works offline.');
  expect(await page.evaluate(name => caches.has(name), other)).toBe(true);
});
