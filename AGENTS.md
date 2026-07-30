# AGENTS.md

## Project Overview

`ivpn-browser-extension-community` is an unofficial companion browser extension for the [IVPN](https://www.ivpn.net/) desktop app. Routes browser traffic through the IVPN desktop app's SOCKS5 proxy. Cross-browser (Firefox MV3 + Chrome MV3) from a single source tree. Not affiliated with IVPN Limited.

- **Language:** TypeScript
- **Build system:** [wxt](https://wxt.dev/) (Vite-based extension framework)
- **UI:** Vanilla TS, no framework
- **Test framework:** vitest
- **Lint:** eslint
- **Runtime manager:** [mise](https://mise.jdx.dev/) (pins Node 24 via `.mise.toml`)
- **License:** MIT

## Repository Structure

```
.
├── entrypoints/             # wxt entrypoints
│   ├── background.ts        # Service worker: settings, rules push, badge, history
│   ├── popup.html           # Toolbar popup
│   ├── popup/               # Popup controller + styles
│   ├── options.html         # Full options page
│   └── options/             # Options controller + styles
├── lib/                     # Domain logic (no UI)
│   ├── ivpn/                # API client + types + grouping/search
│   ├── proxy/               # Domain-keyed rules + Firefox onRequest + Chrome PAC
│   ├── storage/             # Typed wxt/storage wrapper, import/export
│   ├── webrtc/              # Leak detection + Firefox-only disable
│   ├── recommendations/     # Generic extension + HTTPS-Only nudges
│   └── badge/               # Toolbar action badge
├── tests/                   # vitest unit tests
│   ├── fixtures/            # Captured API responses (no live calls in CI)
│   └── *.test.ts
├── public/                  # Static assets
├── .github/
│   ├── dependabot.yml       # Dependabot config (npm, github-actions)
│   └── workflows/           # GitHub Actions
├── PLAN.md                  # Original planning doc (historical)
├── wxt.config.ts            # wxt build config
├── tsconfig.json
├── eslint.config.js
└── vitest.config.ts
```

## CI/CD Architecture

### Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | PR to main | Install mise → Node 24 → `actions/cache` npm → `mise run lint/compile/test/build-chrome/build-firefox` → upload zip artifacts |
| `e2e.yml` | PR to main | Install mise → Node 24 → build both browsers → cache + run Playwright (chromium + firefox matrix) → upload report on failure |
| `release.yml` | `v*` tag push | Install mise → Node 24 → `actions/cache` npm → matrix `mise run build-<browser>` → `gh release create` (first-party) |
| `auto-merge-dependabot.yml` | Schedule (every 6h) + manual | Enables auto-merge via GitHub App token. 14-day cooldown for npm PRs (package.json / package-lock.json); github-actions PRs auto-merge on next schedule tick. |

### Dependabot

Watches two ecosystems:
- **npm** (`/`): all package.json dependencies, weekly
- **github-actions** (`/.github/workflows`): action version bumps, weekly

### Release Process

**New feature/bugfix release** (manual):
1. Check the latest release with `gh release list --repo mietzen/ivpn-browser-extension --limit 1` to pick the next SemVer bump
2. Create a `vX.Y.Z` tag locally and push it (`git tag vX.Y.Z && git push origin vX.Y.Z`)
3. `release.yml` builds Chrome + Firefox MV3 zips and attaches them to the release. The tag version is injected into `package.json` at build time, so the manifest version inside the zips always matches the tag — `package.json` on main is not manually bumped between releases

**Dependabot bumps** (automated):
1. Dependabot opens PR
2. `ci.yml` runs PR checks
3. `auto-merge-dependabot.yml` runs every 6 hours (and on manual dispatch). For github-actions PRs, auto-merge is enabled on the next schedule tick. For npm PRs (those touching `package.json` or `package-lock.json`), auto-merge is gated until the PR is at least 14 days old — defence against supply-chain attacks via newly published malicious versions. `gh pr merge --auto --squash` is used; the actual merge happens only when CI is green.
4. On merge, no new release is cut

**Version format:** `vX.Y.Z` tag → `X.Y.Z` used in zip filenames and injected into `package.json` at build time. The Git tag is the source of truth; `package.json` `version` on main is the dev baseline and is not bumped between releases.

### Secrets

| Secret | Used by | Required |
|--------|---------|----------|
| `APP_ID` | `auto-merge-dependabot.yml` | Yes (for auto-merge) |
| `APP_PRIVATE_KEY` | `auto-merge-dependabot.yml` | Yes (for auto-merge) |
| `GITHUB_TOKEN` | `release.yml` (asset upload) | Auto-provided |

Without `APP_ID` / `APP_PRIVATE_KEY`, the auto-merge workflow fails open — dependabot PRs still get CI checks, they just don't auto-merge.

## Testing

```bash
# Unit tests (33 tests, mocked fixtures, no network)
mise run test
# (equivalent: npm test)

# Lint
mise run lint
# (equivalent: npm run lint)

# Type check
mise run compile
# (equivalent: npm run compile)

# Full PR sequence
mise run ci

# E2E (Playwright, requires built .output/ — run build first)
npm run build:chrome
npm run build:firefox
mise run test-e2e
# UI mode for local debugging: mise run test-e2e-ui
```

All test/build/lint commands are exposed as mise tasks in `.mise.toml` and shared between local dev and CI. The npm cache lives at `.npm-cache/` (project-local, gitignored) per `.npmrc`. The E2E suite lives in `tests/e2e/` (Playwright) and mocks the IVPN API at the network layer — no live tunnel required. See `tests/e2e/README.md` for details.

Test fixtures in `tests/fixtures/` are captured from the live IVPN endpoints. CI never makes live API calls.

### Local development

```shell
mise install              # tool versions (Node 24)
mise run bootstrap        # npm ci into ./node_modules
mise run ci               # full CI sequence locally
```

`bootstrap` is a transitive dependency of every real-work task, so `mise run lint` will run `npm ci` first if `node_modules` is missing. No separate `npm install` step needed locally.

CI deliberately avoids third-party actions where possible — only first-party (`actions/checkout`, `actions/upload-artifact`, `actions/download-artifact`, `actions/cache`) and the `gh` CLI for release creation. The npm cache is persisted across CI runs via `actions/cache@v4` keyed on `package-lock.json`.

## Coding Conventions

- **Source style:** No comments in code (unless explaining a non-obvious gotcha from PLAN.md, e.g. the SOCKS5 host:internal-IP parsing). Follow the surrounding module's style.
- **Indentation:** 2 spaces, LF line endings (`.editorconfig`).
- **Module aliases:** `~/*` resolves to the project root (`tsconfig.json` paths).
- **wxt/browser** for all extension API access; `webextension-polyfill` is a dependency for cross-browser `browser.*` calls.
- **No copying from reference projects.** Mullvad browser extension and IVPN desktop app clones are gitignored siblings, study aids only. If a function looks suspiciously close to either, rewrite it.
- **Community disclosure** is mandatory in product UI: popup footer + options About tab + README. The text is short and explicit (see current README "Disclaimer" block for the canonical wording).
- **Brand colors** (CSS variables `--ivpn-red` and `--ivpn-blue`) are sourced from IVPN's official open-source desktop app (`github.com/ivpn/desktop-app`, GPLv3): red `#FF3344` from `ui/src/assets/logo.svg` (official wordmark), blue `#449cf8` from `ui/src/components/scss/settings.scss` (selected-state border). The values are visual reference only; do not copy logos, icons, or other IVPN IP into this project.
- **Tier 3 features** (DNS-leak check, DoH nudges) were researched and dropped from v1 scope. Do not re-add without confirming the underlying IVPN service exists.

## Reference

- [PLAN.md](./PLAN.md) — historical planning doc with the full feature inventory and ground-truth API endpoints
- [wxt docs](https://wxt.dev/) — build framework
- [IVPN API](https://api.ivpn.net/) — public endpoints used
- [mullvad/browser-extension](https://github.com/mullvad/browser-extension) — feature reference (study only, never copy)
