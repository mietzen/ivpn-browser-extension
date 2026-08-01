import { test, expect } from '@playwright/test';
import { launchWithExtension, openOptionsPage } from '../helpers/extension';

test.describe('options', () => {
  test.beforeEach(({}, testInfo) => {
    if (testInfo.project.name !== 'chromium') {
      test.skip(true, 'Firefox MV3 extension loading via Playwright is not yet supported in this suite');
    }
  });

  test('all 6 tabs render and switch', async ({}, testInfo) => {
    const { context, extensionUrl, cleanup } = await launchWithExtension(
      testInfo.project.name as 'chromium' | 'firefox',
    );
    try {
      const page = await openOptionsPage(context, extensionUrl);
      for (const tab of ['proxy', 'rules', 'exclusions', 'privacy', 'backup', 'about']) {
        await page.click(`.tab[data-tab="${tab}"]`);
        await expect(page.locator(`.tab[data-tab="${tab}"]`)).toHaveClass(/active/);
        await expect(page.locator(`.tab-panel[data-tab="${tab}"]`)).toHaveClass(/active/);
      }
    } finally {
      await cleanup();
    }
  });

  test('add and remove a per-domain rule', async ({}, testInfo) => {
    const { context, extensionUrl, cleanup } = await launchWithExtension(
      testInfo.project.name as 'chromium' | 'firefox',
    );
    try {
      const page = await openOptionsPage(context, extensionUrl);
      await page.click('.tab[data-tab="rules"]');
      await expect(page.locator('#rule-table tbody tr')).toHaveCount(0);
      await page.fill('#rule-pattern', 'example.com');
      await page.selectOption('#rule-target-kind', 'random');
      await page.click('#rule-form button[type="submit"]');
      await expect(page.locator('#rule-table tbody tr')).toHaveCount(1);
      await expect(page.locator('#rule-table tbody tr td').first()).toHaveText('example.com');
      await expect(page.locator('#rule-table tbody tr td').nth(1)).toHaveText('Random');
      await page.click('#rule-table tbody tr button[data-pattern]');
      await expect(page.locator('#rule-table tbody tr')).toHaveCount(0);
    } finally {
      await cleanup();
    }
  });

  test('export downloads a JSON blob', async ({}, testInfo) => {
    const { context, extensionUrl, cleanup } = await launchWithExtension(
      testInfo.project.name as 'chromium' | 'firefox',
    );
    try {
      const page = await openOptionsPage(context, extensionUrl);
      await page.click('.tab[data-tab="backup"]');
      const downloadPromise = page.waitForEvent('download');
      await page.click('#export-btn');
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/^ivpn-proxy-switcher-\d{4}-\d{2}-\d{2}\.json$/);
    } finally {
      await cleanup();
    }
  });
});
