import { test, expect } from '@playwright/test';
import { launchWithExtension } from '../helpers/extension';

test.describe('install', () => {
  test('service worker registered, options page renders', async ({}, testInfo) => {
    const browserName = testInfo.project.name as 'chromium' | 'firefox';
    if (browserName !== 'chromium') {
      test.skip(true, 'Firefox MV3 extension loading via Playwright is not yet supported in this suite');
    }
    const { context, extensionUrl, cleanup } = await launchWithExtension(browserName, { mockGeo: false });
    try {
      // The helper already waits for the SW during launch — just verify
      // it was registered.
      expect(context.serviceWorkers().length, 'service worker registered').toBeGreaterThan(0);

      const page = await context.newPage();
      await page.goto(`${extensionUrl}/options.html`);
      await expect(page.locator('.options-header h1')).toContainText('IVPN Companion');
      await expect(page.locator('.tab[data-tab="proxy"]')).toBeVisible();
      await expect(page.locator('.tab[data-tab="domains"]')).toBeVisible();
      await expect(page.locator('.tab[data-tab="privacy"]')).toBeVisible();
      await expect(page.locator('.tab[data-tab="backup"]')).toBeVisible();
      await expect(page.locator('.tab[data-tab="about"]')).toBeVisible();
    } finally {
      await cleanup();
    }
  });
});
