import { test, expect } from '@playwright/test';
import { launchWithExtension, openPopup } from '../helpers/extension';

test.describe('popup', () => {
  test.beforeEach(({}, testInfo) => {
    if (testInfo.project.name !== 'chromium') {
      test.skip(true, 'Firefox MV3 extension loading via Playwright is not yet supported in this suite');
    }
  });

  test('renders the two combobox sections and a status line', async ({}, testInfo) => {
    const { context, extensionUrl, cleanup } = await launchWithExtension(
      testInfo.project.name as 'chromium' | 'firefox',
    );
    try {
      const page = await openPopup(context, extensionUrl);
      await expect(page.locator('.brand-mark')).toHaveText('IVPN Proxy-Switcher');
      await expect(page.locator('.proxy-section .section-label').first()).toHaveText('Global');
      await expect(page.locator('.proxy-section').nth(1).locator('.section-label')).toContainText(
        'Current Website',
      );
      await expect(page.locator('.combobox-trigger')).toHaveCount(2);
      await expect(page.locator('.disclosure')).toContainText('IVPN Limited');
    } finally {
      await cleanup();
    }
  });

  test('global combobox shows Direct by default with no server set', async ({}, testInfo) => {
    const { context, extensionUrl, cleanup } = await launchWithExtension(
      testInfo.project.name as 'chromium' | 'firefox',
    );
    try {
      const page = await openPopup(context, extensionUrl);
      await expect(page.locator('.combobox-trigger').first().locator('.combobox-value')).toHaveText('Direct');
    } finally {
      await cleanup();
    }
  });

  test('opening the global combobox reveals Quick Pick + full list', async ({}, testInfo) => {
    const { context, extensionUrl, cleanup } = await launchWithExtension(
      testInfo.project.name as 'chromium' | 'firefox',
    );
    try {
      // Seed usage history BEFORE the popup opens — the popup snapshots
      // history at init, so recording afterwards wouldn't appear.
      const seed = await context.newPage();
      await seed.goto(`${extensionUrl}/popup.html`);
      await seed.evaluate(() => {
        return new Promise<string>((resolve) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const w = (globalThis as any).chrome?.runtime;
          w.sendMessage({ type: 'history/recordUse', payload: { gateway: 'us-nyc-wg-001' } }, () =>
            resolve('ok'),
          );
        });
      });
      await seed.close();

      const page = await openPopup(context, extensionUrl);
      await page.locator('#global-combobox .combobox-trigger').click();
      await expect(page.locator('#global-combobox .combobox-quickpick')).toBeVisible();
      await expect(page.locator('#global-combobox .combobox-search input')).toBeVisible();
      const firstServer = page.locator('#global-combobox .combobox-server').first();
      await expect(firstServer).toBeVisible({ timeout: 45000 });
    } finally {
      await cleanup();
    }
  });

  test('Current Website section is present and shows host label', async ({}, testInfo) => {
    const { context, extensionUrl, cleanup } = await launchWithExtension(
      testInfo.project.name as 'chromium' | 'firefox',
    );
    try {
      const page = await openPopup(context, extensionUrl);
      const hostText = await page.locator('#current-host').textContent();
      expect(hostText).toBeTruthy();
    } finally {
      await cleanup();
    }
  });
});
