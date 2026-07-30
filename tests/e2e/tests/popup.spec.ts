import { test, expect } from '@playwright/test';
import { launchWithExtension, openPopup } from '../helpers/extension';

test.describe('popup', () => {
  test.beforeEach(({}, testInfo) => {
    if (testInfo.project.name !== 'chromium') {
      test.skip(true, 'Firefox MV3 extension loading via Playwright is not yet supported in this suite');
    }
  });

  test('renders with live server list (api.ivpn.net hit live)', async ({}, testInfo) => {
    const { context, extensionUrl, cleanup } = await launchWithExtension(
      testInfo.project.name as 'chromium' | 'firefox',
    );
    try {
      const page = await openPopup(context, extensionUrl);
      // The live server list must populate. We don't hardcode counts because
      // IVPN adds/removes servers over time — just assert non-empty.
      const serverCount = await page.locator('.picker-server').count();
      expect(serverCount, 'live server list returned at least one server').toBeGreaterThan(0);
      const countryCount = await page.locator('.picker-country').count();
      expect(countryCount, 'at least one country group').toBeGreaterThan(0);
      // IVPN text mark in the brand
      await expect(page.locator('.brand-mark')).toHaveText('IVPN');
      // Community disclosure in the footer
      await expect(page.locator('.disclosure')).toContainText('IVPN Limited');
    } finally {
      await cleanup();
    }
  });

  test('mode toggle changes the active button', async ({}, testInfo) => {
    const { context, extensionUrl, cleanup } = await launchWithExtension(
      testInfo.project.name as 'chromium' | 'firefox',
    );
    try {
      const page = await openPopup(context, extensionUrl);
      // Initially direct mode (default settings)
      await expect(page.locator('.mode-btn[data-mode="direct"]')).toHaveClass(/active/);
      // Click global
      await page.click('.mode-btn[data-mode="global"]');
      await expect(page.locator('.mode-btn[data-mode="global"]')).toHaveClass(/active/);
      await expect(page.locator('.mode-btn[data-mode="direct"]')).not.toHaveClass(/active/);
      // Back to direct
      await page.click('.mode-btn[data-mode="direct"]');
      await expect(page.locator('.mode-btn[data-mode="direct"]')).toHaveClass(/active/);
    } finally {
      await cleanup();
    }
  });

  test('search filters the server list', async ({}, testInfo) => {
    const { context, extensionUrl, cleanup } = await launchWithExtension(
      testInfo.project.name as 'chromium' | 'firefox',
    );
    try {
      const page = await openPopup(context, extensionUrl);
      const totalBefore = await page.locator('.picker-server').count();
      expect(totalBefore).toBeGreaterThan(0);

      // Pick the first country name and search for it. This is data-driven
      // so it works against any live server list.
      const firstCountryText = await page.locator('.picker-country').first().textContent();
      expect(firstCountryText).toBeTruthy();
      const firstCountry = firstCountryText!.replace(/\s*\([A-Z]{2}\)\s*$/, '').trim();

      await page.fill('#picker-search', firstCountry);
      const filteredCount = await page.locator('.picker-server').count();
      expect(filteredCount, 'search should match the first country group').toBeGreaterThan(0);
      expect(filteredCount, 'search should reduce visible servers').toBeLessThan(totalBefore);

      await page.fill('#picker-search', '');
      await expect(page.locator('.picker-server')).toHaveCount(totalBefore);
    } finally {
      await cleanup();
    }
  });
});
