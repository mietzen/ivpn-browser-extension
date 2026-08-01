/**
 * Shared Playwright helpers for E2E tests.
 *
 * Centralizes the boilerplate around loading the unpacked extension,
 * mocking the geo-lookup endpoint (the server list is loaded live
 * so the suite catches IVPN API breakage), finding the extension ID,
 * and opening popup / options pages.
 */

import { type BrowserContext, type Page, chromium, firefox } from '@playwright/test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');

export const PATHS = {
  chromeBuild: join(repoRoot, '.output', 'chrome-mv3'),
  firefoxBuild: join(repoRoot, '.output', 'firefox-mv3'),
  fixtures: join(__dirname, '..', 'fixtures'),
  sharedFixtures: join(repoRoot, 'tests', 'fixtures'),
};

function loadFixture(name: string): unknown {
  for (const dir of [PATHS.fixtures, PATHS.sharedFixtures]) {
    try {
      return JSON.parse(readFileSync(join(dir, name), 'utf-8')) as unknown;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  throw new Error(`Fixture not found: ${name}`);
}

export interface LaunchOptions {
  headless?: boolean;
  /**
   * Mock /v4/geo-lookup. Defaults to true. The geo-lookup response
   * is the user's own IP and changes per environment, so mocking it
   * gives stable assertions. Set to false to load it live.
   */
  mockGeo?: boolean;
  /**
   * Mock /v5/servers/stats with the captured fixture. Defaults to
   * false (live, so the suite catches IVPN API breakage). Tests that
   * reload the popup hit the endpoint twice per run; set this to true
   * to keep them deterministic.
   */
  mockServers?: boolean;
}

/**
 * Launch a fresh browser with the unpacked extension loaded. The
 * /v5/servers/stats endpoint is ALWAYS hit live so the suite catches
 * IVPN API breakage (response shape, downtime, etc.).
 */
export async function launchWithExtension(
  browserName: 'chromium' | 'firefox',
  options: LaunchOptions = {},
): Promise<{ context: BrowserContext; extensionUrl: string; cleanup: () => Promise<void> }> {
  const { headless = true, mockGeo = true, mockServers = false } = options;

  let context: BrowserContext;

  if (browserName === 'chromium') {
    // Chrome's headless-shell binary doesn't support --load-extension, so we
    // need either headful mode or the new headless mode. New headless is
    // opt-in via the chrome-headless-shell opt-out: pass a real userDataDir
    // (launchPersistentContext with '' uses a non-extension-capable binary
    // path). Create a temp dir so each test starts clean.
    const userDataDir = mkdtempSync(join(tmpdir(), 'ivpn-e2e-'));
    const launchArgs = [
      `--disable-extensions-except=${PATHS.chromeBuild}`,
      `--load-extension=${PATHS.chromeBuild}`,
      '--no-first-run',
    ];
    // `channel: 'chromium'` opts out of chrome-headless-shell and uses full
    // Chromium, which honors --load-extension in both headless and headful
    // modes.
    context = await chromium.launchPersistentContext(userDataDir, {
      headless,
      channel: 'chromium',
      args: launchArgs,
    });
    // Best-effort cleanup; Chromium releases the dir lock on close.
    context.on('close', () => {
      try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });
  } else {
    if (!existsSync(PATHS.firefoxBuild)) {
      throw new Error(`Firefox build not found at ${PATHS.firefoxBuild}. Run \`npm run build:firefox\` first.`);
    }
    context = await firefox.launchPersistentContext('', {
      headless,
      firefoxUserPrefs: {},
    });
    // Firefox MV3 extension loading via Playwright is not yet scriptable.
    // Tests self-skip on the firefox project.
  }

  if (mockGeo) {
    await mockGeoLookup(context);
  }
  if (mockServers) {
    await mockServersList(context);
  }

  // Capture console + pageerror events from all pages so tests can surface
  // background-script failures (e.g. failed API calls) in their failure output.
  const logs: string[] = [];
  context.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      logs.push(`[${msg.type()}] ${msg.text()}`);
    }
  });
  context.on('weberror', (err) => {
    logs.push(`[weberror] ${err.error().message}`);
  });
  context.on('page', (page) => {
    page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`));
  });

  const extensionUrl = browserName === 'chromium' ? await waitForExtensionUrl(context) : 'about:blank';

  return {
    context,
    extensionUrl,
    cleanup: async () => {
      if (logs.length > 0) {
        console.error(`[e2e] console/web errors from ${browserName} run:\n${logs.join('\n')}`);
      }
      await context.close();
    },
  };
}

function existsSync(p: string): boolean {
  try {
    const { statSync } = require('node:fs') as typeof import('node:fs');
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for the extension's service worker to register and return its URL.
 * Chromium MV3 only. Checks already-registered workers first, then waits
 * for a new registration event (whichever resolves first).
 */
async function waitForExtensionUrl(context: BrowserContext): Promise<string> {
  // The extension may have registered its SW between `launchPersistentContext`
  // returning and us getting here. Check the already-registered list first.
  const existing = context.serviceWorkers();
  if (existing.length > 0) {
    return extractExtensionUrl(existing[0]!.url());
  }
  // Otherwise, wait for a new one. We also listen for `background` pages
  // (which is how Firefox MV3 reports event-driven background pages, and
  // some Chrome versions signal via background pages too).
  const swPromise = context.waitForEvent('serviceworker', { timeout: 20000 });
  const sw = await swPromise;
  return extractExtensionUrl(sw.url());
}

function extractExtensionUrl(url: string): string {
  const match = url.match(/^(chrome-extension:\/\/[a-z]+)\//);
  return match ? match[1]! : url;
}

/**
 * Mock the geo-lookup endpoint with a canned fixture. The IP/ISP in this
 * response changes per environment, so we mock it for stable UI assertions.
 * The /v5/servers/stats endpoint is intentionally NOT mocked — see
 * launchWithExtension for the rationale.
 */
export async function mockGeoLookup(context: BrowserContext): Promise<void> {
  const geo = loadFixture('mock-geo.json');
  await context.route('**/api.ivpn.net/v4/geo-lookup', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(geo),
    }),
  );
}

export async function mockServersList(context: BrowserContext): Promise<void> {
  const servers = loadFixture('servers-stats.json');
  await context.route('**/api.ivpn.net/v5/servers/stats', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(servers),
    }),
  );
}

/**
 * Open the extension's popup as a Playwright Page. Waits for the two
 * combobox triggers to be present, which means init() has rendered.
 */
export async function openPopup(context: BrowserContext, extensionUrl: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${extensionUrl}/popup.html`);
  await page.waitForSelector('.combobox-trigger', { state: 'visible', timeout: 20000 });
  return page;
}

/**
 * Open the extension's options page as a Playwright Page.
 */
export async function openOptionsPage(context: BrowserContext, extensionUrl: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${extensionUrl}/options.html`);
  await page.waitForSelector('.tab-panel.active', { timeout: 15000 });
  // Wait for the live server select to populate. Live API can be slow.
  await page.waitForFunction(
    () => document.querySelectorAll('#global-proxy option').length > 0,
    null,
    { timeout: 45000 },
  );
  return page;
}
