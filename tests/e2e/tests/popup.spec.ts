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
      const firstServer = page.locator('#global-combobox .combobox-server:not(.combobox-special)').first();
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

  test('picking a server in Current Website shows it and auto-saves a rule', async ({}, testInfo) => {
    const { context, extensionUrl, cleanup } = await launchWithExtension(
      testInfo.project.name as 'chromium' | 'firefox',
      { mockServers: true },
    );
    try {
      const host = 'current-site.test';
      await context.route(`https://${host}/**`, (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>ok</body></html>' }),
      );
      const sitePage = await context.newPage();
      await sitePage.goto(`https://${host}/`);
      // init() resolves the host from the active tab, so bring the site tab
      // to front and reload the popup before interacting.
      const page = await openPopup(context, extensionUrl);
      await sitePage.bringToFront();
      await page.reload();
      await expect(page.locator('#current-host')).toHaveText(`(${host})`);

      await page.locator('#current-site-combobox .combobox-trigger').click();
      const firstServer = page.locator('#current-site-combobox .combobox-server:not(.combobox-special)').first();
      await expect(firstServer).toBeVisible({ timeout: 45000 });
      const gateway = await firstServer.evaluate((el) => el.childNodes[0]?.textContent?.trim() ?? '');
      await firstServer.click();

      await expect(
        page.locator('#current-site-combobox .combobox-trigger').locator('.combobox-value'),
      ).toHaveText(gateway);

      const stored = await page.evaluate(async () => {
        return new Promise<{ domainRules?: Array<{ pattern: string; target: { kind: string } }> }>(
          (resolve, reject) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const w = (globalThis as any).chrome?.runtime ?? (globalThis as any).browser?.runtime;
            if (!w) {
              reject(new Error('extension runtime not found in popup context'));
              return;
            }
            w.sendMessage({ type: 'settings/get' }, (response) => resolve(response ?? {}));
          },
        );
      });
      const rule = stored.domainRules?.find((r) => r.pattern === host);
      expect(rule?.target.kind).toBe('socks5');
    } finally {
      await cleanup();
    }
  });

  test('global combobox offers Random and picks it as the global proxy', async ({}, testInfo) => {
    const { context, extensionUrl, cleanup } = await launchWithExtension(
      testInfo.project.name as 'chromium' | 'firefox',
    );
    try {
      const page = await openPopup(context, extensionUrl);
      await page.locator('#global-combobox .combobox-trigger').click();
      const randomRow = page.locator('#global-combobox .combobox-server', { hasText: /^Random$/ });
      await expect(randomRow).toBeVisible();
      await randomRow.click();
      await expect(
        page.locator('#global-combobox .combobox-trigger').locator('.combobox-value'),
      ).toHaveText('Random');
    } finally {
      await cleanup();
    }
  });

  test('picking a new global proxy keeps the Current Website per-site rule', async ({}, testInfo) => {
    const { context, extensionUrl, cleanup } = await launchWithExtension(
      testInfo.project.name as 'chromium' | 'firefox',
      { mockServers: true },
    );
    try {
      const host = 'current-site.test';
      await context.route(`https://${host}/**`, (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>ok</body></html>' }),
      );
      const sitePage = await context.newPage();
      await sitePage.goto(`https://${host}/`);
      const page = await openPopup(context, extensionUrl);
      await sitePage.bringToFront();
      await page.reload();
      await expect(page.locator('#current-host')).toHaveText(`(${host})`);

      await page.locator('#current-site-combobox .combobox-trigger').click();
      const siteServer = page.locator('#current-site-combobox .combobox-server:not(.combobox-special)').first();
      await expect(siteServer).toBeVisible({ timeout: 45000 });
      const gateway = await siteServer.evaluate((el) => el.childNodes[0]?.textContent?.trim() ?? '');
      await siteServer.click();

      await page.locator('#global-combobox .combobox-trigger').click();
      const globalServer = page.locator('#global-combobox .combobox-server:not(.combobox-special)').nth(1);
      await expect(globalServer).toBeVisible({ timeout: 45000 });
      await globalServer.click();

      await expect(
        page.locator('#current-site-combobox .combobox-trigger').locator('.combobox-value'),
      ).toHaveText(gateway);

      const stored = await page.evaluate(async () => {
        return new Promise<{ domainRules?: Array<{ pattern: string; target: { kind: string } }> }>(
          (resolve, reject) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const w = (globalThis as any).chrome?.runtime ?? (globalThis as any).browser?.runtime;
            if (!w) {
              reject(new Error('extension runtime not found in popup context'));
              return;
            }
            w.sendMessage({ type: 'settings/get' }, (response) => resolve(response ?? {}));
          },
        );
      });
      const rule = stored.domainRules?.find((r) => r.pattern === host);
      expect(rule?.target.kind).toBe('socks5');
    } finally {
      await cleanup();
    }
  });
});
