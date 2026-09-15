import { test, expect } from '@playwright/test';

/**
 * FR-86 — a failed check explains itself in plain language.
 *
 * The report that started this: the Certificates panel read `fetch failed` in
 * amber, underneath a certificate that had resolved perfectly well. That string
 * is Node's own — literally what `err.message` says when a network fetch fails —
 * and it had travelled untouched from `checks.ts` to the dashboard.
 *
 * Hermetic: the dashboard's API needs auth + Supabase, both blanked in e2e, so
 * the payload is served here — which also lets a spec produce failure states
 * that are otherwise awkward to provoke on demand.
 */

const AT = '2026-09-08T10:00:00.000Z';

function payload(check: Record<string, unknown>) {
  return {
    name: 'Test project',
    generatedAt: AT,
    windowDays: 30,
    overall: 'operational',
    sharedUrl: 'https://ex.test/',
    shareToken: null,
    sites: [
      {
        host: 'ex.test',
        url: 'https://ex.test/',
        state: 'up',
        uptime: { d1: null, d7: null, d30: null },
        uptimeWindowPct: null,
        dailyUptime: [],
        incidents: 0,
        ssl: { daysRemaining: 240, valid: true },
        formWorking: null,
        lastCheckedAt: AT,
        tech: {
          url: 'https://ex.test/',
          statusCode: 200,
          lastResponseMs: 120,
          lastCheckedAt: AT,
          domainDaysRemaining: null,
          avgResponseMs: null,
          responseTrend: [],
          intervalMs: 300000,
          check,
        },
      },
    ],
  };
}

async function open(page: import('@playwright/test').Page, check: Record<string, unknown>) {
  await page.route('**/api/projects/**/url/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload(check)) }),
  );
  await page.goto('/projects/test-project/url/ex-test');
}

test.describe('a check that produced no answer', () => {
  test('says the registry was unreachable — never "fetch failed"', async ({ page }) => {
    await open(page, { domainFailure: 'unreachable' });

    await expect(page.getByText(/could not reach the domain registry/i)).toBeVisible();
    // It reassures, because the domain itself is fine.
    await expect(page.getByText(/nothing is wrong with the domain/i)).toBeVisible();
    // The original bug, asserted directly.
    await expect(page.locator('body')).not.toContainText('fetch failed');
    await expect(page.locator('body')).not.toContainText('RDAP');
  });

  test('distinguishes a registry that simply does not publish an expiry', async ({ page }) => {
    await open(page, { domainFailure: 'not_published' });

    await expect(page.getByText(/does not publish an expiry date/i)).toBeVisible();
    // Permanent and unfixable, so it must not be dressed as a warning — the
    // amber-under-a-healthy-certificate complaint behind this issue.
    const note = page.getByText(/does not publish an expiry date/i);
    await expect(note).not.toHaveClass(/text-warn|text-danger/);
  });

  test('keeps a real problem loud — no certificate is not reassuring news', async ({ page }) => {
    await open(page, { sslFailure: 'no_certificate' });

    const note = page.getByText(/did not present a security certificate/i);
    await expect(note).toBeVisible();
    await expect(note).toHaveClass(/text-danger/);
  });

  test('a result stored before this change does not print its raw text', async ({ page }) => {
    // Pre-FR-86 rows carry the raw message and no kind at all.
    await open(page, { domainError: 'fetch failed', sslError: 'unable to verify the first certificate' });

    await expect(page.locator('body')).not.toContainText('fetch failed');
    await expect(page.locator('body')).not.toContainText('unable to verify');
    // Both legacy fields are replaced by a truthful generic line rather than
    // silence — one for the domain, one for the certificate.
    await expect(page.getByText(/domain’s expiry could not be checked last time/i)).toBeVisible();
    await expect(page.getByText(/certificate could not be checked last time/i)).toBeVisible();
  });
});
