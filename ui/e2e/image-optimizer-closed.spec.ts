import { test, expect } from '@playwright/test';

/**
 * Next.js serves a built-in image optimizer at /_next/image. The app renders no
 * optimized images, and the optimizer is where Next 14's most severe advisories
 * live, so it is switched off in next.config.mjs and answers 404 for everyone.
 *
 * The suite runs with sign-in disabled. Next answers this route before its
 * middleware runs, so what is proven here holds with sign-in configured too.
 */

test.describe('the image optimizer endpoint', () => {
  test('is closed, whatever it is asked for', async ({ request }) => {
    for (const path of [
      '/_next/image?url=%2Ficon.svg&w=64&q=75',
      '/_next/image?url=%2Fopengraph-image.png&w=1200&q=75',
      '/_next/image?url=https%3A%2F%2Fexample.com%2Fa.png&w=64&q=75',
      '/_next/image',
    ]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(404);
    }
  });

  test('leaves the public brand assets and pages reachable', async ({ request, page }) => {
    for (const path of ['/icon.svg', '/opengraph-image.png']) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
    }

    await page.goto('/docs');
    await expect(page.locator('body')).not.toBeEmpty();
    expect(await page.title()).not.toBe('');
  });
});
