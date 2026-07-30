import { test, expect } from '@playwright/test';
import { launchWithExtension, openPopup } from '../helpers/extension';

test.describe('persistence', () => {
  test.beforeEach(({}, testInfo) => {
    if (testInfo.project.name !== 'chromium') {
      test.skip(true, 'Firefox MV3 extension loading via Playwright is not yet supported in this suite');
    }
  });

  test('mode setting persists in storage across popup reload', async ({}, testInfo) => {
    const { context, extensionUrl, cleanup } = await launchWithExtension(
      testInfo.project.name as 'chromium' | 'firefox',
    );
    try {
      // First popup: click random and confirm the mode button is active.
      const page = await openPopup(context, extensionUrl);
      await page.click('.mode-btn[data-mode="random"]');
      await expect(page.locator('.mode-btn[data-mode="random"]')).toHaveClass(/active/);

      // Ask the background what it sees. This is the same code path the
      // popup uses on next load, so it exercises the real persistence
      // contract end-to-end.
      const storedMode = await page.evaluate(async () => {
        return new Promise<string>((resolve, reject) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const w = (globalThis as any).chrome?.runtime ?? (globalThis as any).browser?.runtime;
          if (!w) {
            reject(new Error('extension runtime not found in popup context'));
            return;
          }
          w.sendMessage({ type: 'settings/get' }, (response: { mode?: string }) => {
            resolve(response?.mode ?? '');
          });
        });
      });
      expect(storedMode, 'background reports mode=random').toBe('random');

      // Reload and verify the popup reads the persisted value.
      await page.reload();
      await page.waitForSelector('.mode-btn[data-mode="random"]', { state: 'visible', timeout: 15000 });
      await expect(page.locator('.mode-btn[data-mode="random"]')).toHaveClass(/active/);

      // Reset so other tests aren't affected by leaked state.
      await page.click('.mode-btn[data-mode="direct"]');
      await expect(page.locator('.mode-btn[data-mode="direct"]')).toHaveClass(/active/);
    } finally {
      await cleanup();
    }
  });
});
