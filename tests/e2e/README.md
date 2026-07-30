# E2E Tests (Playwright)

Smoke tests for the extension running in a real browser.

## What's covered

- Extension installs and renders the options page
- Popup renders the **live** IVPN server list, mode toggle, search filter
- Options page: 5 tabs, per-domain rule CRUD, export download
- Settings persist across popup reload

## What's NOT covered (out of scope for v1)

- Real SOCKS5 traffic routing through a live IVPN tunnel
- Firefox MV3 extension loading (Playwright limitation; tests
  self-skip on Firefox until upstream support lands)

## Network usage

The `/v5/servers/stats` endpoint is hit **live** on every test run so
the suite catches IVPN API breakage (response shape, downtime, etc.).
Tests that rely on stable values (status panel IP/country) mock
`/v4/geo-lookup` with a canned fixture — the geo-lookup returns the
user's own IP, which changes per environment.

## Local development

```bash
# one-time
npx playwright install --with-deps chromium   # firefox optional, see note above

# build the extension first — tests load the unpacked .output/
npm run build:chrome
npm run build:firefox

# run
npm run test:e2e          # headless
npm run test:e2e:headed   # see the browser
npm run test:e2e:ui       # Playwright UI mode
```

## CI

`.github/workflows/e2e.yml` runs on PR to main. Builds both
browsers, then runs the Playwright suite. Caches the Playwright
browser binaries across runs. Uploads the HTML report as an
artifact on failure.

## Writing new tests

Use the helpers in `helpers/extension.ts`:

- `launchWithExtension(browserName, { headless?, mockGeo? })` —
  returns `{ context, extensionUrl, cleanup }`. Always call
  `cleanup()` in a `finally` block.
- `openPopup(context, extensionUrl)` — returns a `Page` with the
  popup loaded and the picker ready.
- `openOptionsPage(context, extensionUrl)` — same for options.

The server list is always live. Don't hardcode gateway IDs in your
tests — read them from the DOM (e.g. `page.locator('#rule-server
option').nth(1).getAttribute('value')`) so tests stay stable as
IVPN adds or removes servers.

Always end a test with a `finally { await cleanup(); }` so the
browser instance is closed even on assertion failures.
