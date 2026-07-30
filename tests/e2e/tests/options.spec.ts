import { test, expect } from '@playwright/test';
import { launchWithExtension, openOptionsPage } from '../helpers/extension';

test.describe('options', () => {
  test.beforeEach(({}, testInfo) => {
    if (testInfo.project.name !== 'chromium') {
      test.skip(true, 'Firefox MV3 extension loading via Playwright is not yet supported in this suite');
    }
  });

  test('all 5 tabs render and switch', async ({}, testInfo) => {
    const { context, extensionUrl, cleanup } = await launchWithExtension(
      testInfo.project.name as 'chromium' | 'firefox',
    );
    try {
      const page = await openOptionsPage(context, extensionUrl);
      for (const tab of ['proxy', 'domains', 'privacy', 'backup', 'about']) {
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
      await page.click('.tab[data-tab="domains"]');
      await expect(page.locator('#rule-table tbody tr')).toHaveCount(0);
      // Pick the first live server from the rule-server select to avoid
      // hardcoding a gateway that may not exist in the live list.
      const firstServerValue = await page.locator('#rule-server option').nth(1).getAttribute('value');
      expect(firstServerValue, 'live server list populated the select').toBeTruthy();
      await page.fill('#rule-domain', 'example.com');
      await page.selectOption('#rule-server', firstServerValue!);
      await page.click('#rule-form button[type="submit"]');
      await expect(page.locator('#rule-table tbody tr')).toHaveCount(1);
      await expect(page.locator('#rule-table tbody tr td').first()).toHaveText('example.com');
      await page.click('#rule-table tbody tr button[data-domain]');
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
      expect(download.suggestedFilename()).toMatch(/^ivpn-companion-community-\d{4}-\d{2}-\d{2}\.json$/);
    } finally {
      await cleanup();
    }
  });
});
