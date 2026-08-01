import { test, expect } from '@playwright/test';
import { launchWithExtension, openPopup } from '../helpers/extension';

test.describe('persistence', () => {
  test.beforeEach(({}, testInfo) => {
    if (testInfo.project.name !== 'chromium') {
      test.skip(true, 'Firefox MV3 extension loading via Playwright is not yet supported in this suite');
    }
  });

  test('global proxy choice persists to storage', async ({}, testInfo) => {
    const { context, extensionUrl, cleanup } = await launchWithExtension(
      testInfo.project.name as 'chromium' | 'firefox',
    );
    try {
      // Pick the first live server in the global combobox and verify the
      // UI updates.
      const page = await openPopup(context, extensionUrl);
      await page.locator('#global-combobox .combobox-trigger').click();
      const firstServer = page.locator('#global-combobox .combobox-server').first();
      await expect(firstServer).toBeVisible();
      await firstServer.click();
      await expect(
        page.locator('#global-combobox .combobox-trigger').locator('.combobox-value'),
      ).not.toHaveText('Direct');

      // Ask the background what it sees. This is the same code path the
      // popup uses on next load — so this verifies the persistence
      // contract end-to-end without racing a UI reload.
      const storedGlobal = await page.evaluate(async () => {
        return new Promise<{ kind?: string; label?: string }>((resolve, reject) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const w = (globalThis as any).chrome?.runtime ?? (globalThis as any).browser?.runtime;
          if (!w) {
            reject(new Error('extension runtime not found in popup context'));
            return;
          }
          w.sendMessage({ type: 'settings/get' }, (response: { global?: { kind: string; label: string } }) => {
            resolve(response?.global ?? {});
          });
        });
      });
      expect(storedGlobal.kind, 'background reports socks5 global after pick').toBe('socks5');
      expect(storedGlobal.label, 'background reports the picked gateway').toBeTruthy();
    } finally {
      await cleanup();
    }
  });
});
