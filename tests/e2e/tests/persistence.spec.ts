import { test, expect } from '@playwright/test';
import { launchWithExtension, openPopup } from '../helpers/extension';

test.describe('persistence', () => {
  test.beforeEach(({}, testInfo) => {
    if (testInfo.project.name !== 'chromium') {
      test.skip(true, 'Firefox MV3 extension loading via Playwright is not yet supported in this suite');
    }
  });

  test('mode setting persists across popup reload', async ({}, testInfo) => {
    const { context, extensionUrl, cleanup } = await launchWithExtension(
      testInfo.project.name as 'chromium' | 'firefox',
    );
    try {
      // First popup: set to random mode.
      const page = await openPopup(context, extensionUrl);
      await page.click('.mode-btn[data-mode="random"]');
      await expect(page.locator('.mode-btn[data-mode="random"]')).toHaveClass(/active/);

      // Reload the same page (preserves extension context, doesn't kill SW).
      await page.reload();
      await page.waitForSelector('.mode-btn[data-mode="random"]', { state: 'visible', timeout: 15000 });
      // After reload, the same mode should still be active.
      await expect(page.locator('.mode-btn[data-mode="random"]')).toHaveClass(/active/);

      // Reset to direct so other tests aren't affected by leaked state.
      await page.click('.mode-btn[data-mode="direct"]');
      await expect(page.locator('.mode-btn[data-mode="direct"]')).toHaveClass(/active/);
    } finally {
      await cleanup();
    }
  });
});
