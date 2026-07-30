# Plan: IVPN Community Browser Extension (built fresh, Mullvad used as feature reference only)

## 0. Purpose

Execution plan for an AI coding agent (e.g. Claude Code) working autonomously or
semi-autonomously on this repo. Each phase has concrete steps and a "Definition of
Done". Items marked **[ESCALATE]** require a human decision — do not guess; stop
and ask.

## 1. Approach: reference, not fork

`mullvad/browser-extension` (GPLv3) is cloned locally **read-only, for study only**.
This project is a fresh, independent implementation — not a derivative work:

- Do not copy files, functions, CSS, or asset files from the Mullvad clone into
  this project's repo. Read it, understand a feature, then write your own
  implementation against IVPN's API and this project's own code style.
- Because nothing is copied, GPLv3 does not attach to this project by inheritance
  — license choice (MIT, Apache-2.0, GPLv3, whatever) is the human owner's call,
  not a legal requirement. **[ESCALATE]** confirm the chosen license with the
  owner before the first commit; don't default silently.
- Keep the Mullvad clone in a directory that is explicitly gitignored /
  outside the project repo entirely (e.g. a sibling folder, not a git submodule),
  so there's no risk of its history or files accidentally ending up in commits.
- `ivpn/desktop-app` (also GPLv3) continues to be used the same way: read for API
  shape understanding, not copied. Same rule applies if any Go structs/logic end
  up looking suspiciously close to the original — rewrite in your own words/types.

## 2. Ground truth (established, do not re-derive)

**IVPN API endpoints (public HTTPS, no auth required for these two):**

| Endpoint | Purpose | Notes |
|---|---|---|
| `https://api.ivpn.net/v5/servers/stats` | Server list for the location picker | Flat array: `country`, `city`, `load`, `is_active`, `in_maintenance`, `status`, and a per-server `socks5` field |
| `https://api.ivpn.net/v4/geo-lookup` | Connection/IP status check | Direct equivalent of Mullvad's `am.i.mullvad.net` |

**Explicitly out of scope** (session/account lifecycle, belongs to the desktop
client, not a browser companion): `v4/session/new`, `v4/session/status`,
`v4/session/delete`, `v4/session/wg/set`.

**SOCKS5 proxy mechanics:**
- Port is always `1080`.
- Address is per-server — read from the `socks5` field of whichever server the
  user picks in `servers/stats`.
- **Parsing gotcha:** that field is formatted `"socks5.<gw>.gw.ivpn.net:10.1.x.x"`
  — that's **hostname:internal-IP**, not **host:port**. Don't parse a port out of
  it; always pair with the fixed port `1080`.
- Proxy is only reachable while the user's IVPN desktop app has an active tunnel.
  This extension does not start/stop the VPN connection — it assumes the desktop
  app is already connected, same assumption Mullvad's own extension makes.
- **[ESCALATE]** `servers/stats` isn't part of IVPN's documented public API.
  Before shipping a release that depends on it, the repo owner should open a
  GitHub issue or email IVPN describing the project and confirming it's stable
  and acceptable for third-party use. Human/community task, not agent-completable.

## 3. Feature inventory (from actually reading `mullvad/browser-extension` source,
not the README) — tiered by build priority

### Tier 1 — Core MVP (build first)
- **Connection status check**: current IP/country/city → IVPN `geo-lookup`
- **Server/location list**: fetched, filtered (`is_active` && `!in_maintenance`),
  grouped by country/city, searchable → IVPN `servers/stats`
- **Global proxy toggle** ("route all browsing through server X"):
  Firefox via `browser.proxy.onRequest`; Chrome via `chrome.proxy.settings.set`
  with a generated PAC script (see Phase 4 — this is simpler than per-domain and
  a good first slice)
- **Browser-action badge**: on/off state + location code on the toolbar icon
- **Minimal options page**: About tab (community disclosure — mandatory, see
  §4) + a bare-bones Proxy tab (global toggle + location picker only)

### Tier 2 — Second pass (all fully portable, more UI work)
- **Per-domain custom proxy rules**: assign a specific location per domain,
  per-domain DNS-via-proxy toggle, per-domain enable/disable. Model this the
  same way Mullvad does — a plain `{ [domain]: ProxyDetails }` map, matched via
  a domain/subdomain check (parent-domain fallback for subdomains) — this is
  what makes Chrome's PAC-script approach viable for this tier too, not just
  Tier 1 (see correction in Phase 4).
- **"Never proxy" exclusion list** per domain
- **Random proxy mode**: auto-pick a random active server, shuffle badge icon
- **Usage history**: most-used / most-recently-used location quick buttons,
  backed by a local `{count, timestamp}` per server
- **Import/export settings** as a downloadable/uploadable JSON blob (no extra
  permissions needed — just `Blob` + `<a download>`, same trick works in Chrome)
- **WebRTC leak detection**: client-side only (`RTCPeerConnection` ICE candidate
  gathering), fully portable to both browsers. The companion *disable WebRTC*
  toggle uses `browser.privacy.network.peerConnectionEnabled`, which is
  **Firefox-only** — Chrome build can detect and warn, but can't offer the
  one-click disable button (no Chrome equivalent privacy API for this).
- **Extension recommendations**: generic mechanism (recommend an extension,
  track install/enable state live via the `management` API) — the specific
  recommendation (Mullvad recommends uBlock Origin) is generic/not
  Mullvad-branded, can be reused as-is or swapped for whatever the project
  wants to recommend.
- **HTTPS-Only mode nudge**: generic browser API check, portable as-is.

### Tier 3 — Dropped from scope
- DNS leak check, DoH nudges, and the search-engine recommendation were all
  researched and found to depend on services IVPN does not provide. Tier 3 is
  out of scope for v1.

## 4. Cross-browser proxy architecture (corrected)

Earlier drafts of this plan assumed Chrome's lack of a `browser.proxy.onRequest`
equivalent would cap Chrome at a crude "global toggle only" experience. Having
read the actual source, that was overstated: **the entire Mullvad proxy model is
domain-keyed, not tab-keyed** (`hostProxiesDetails`, `excludedHosts`,
`globalProxyDetails` are all plain host→config maps; the `tabs` permission is only
used to look up which domain the *active* tab is on, to prefill the popup UI —
it isn't a separate per-tab-identity mechanism). That means:

- **Firefox**: `browser.proxy.onRequest` listener, matching request host against
  the domain map, same shape as Tier 1/2 above.
- **Chrome (MV3)**: a generated PAC script's `FindProxyForURL(url, host)` can
  replicate the *same* domain-matching logic — global default, per-domain
  overrides, and exclusion list all translate directly into PAC conditionals.
  Regenerate and call `chrome.proxy.settings.set()` whenever the rule set
  changes. Random-mode is handled by picking one random server at toggle-time
  and embedding it as the current global target — not true per-request
  randomness, but neither is anything else in this model.
- What genuinely doesn't carry over to Chrome: the WebRTC-disable toggle (Tier 2,
  noted above) and any true per-request/per-tab dynamic decision that isn't
  reducible to "which domain is this."
- Wrap both implementations behind one interface (`setProxyRules(rules)`,
  `clearProxyRules()`) so UI code doesn't know which browser it's running on.
- Add `webextension-polyfill` so `browser.*` calls work identically on Chrome.

## 5. Non-negotiable constraints

1. Nothing copied verbatim from either reference repo (see §1).
2. **No Mullvad or IVPN branding implying an official product.** Use IVPN's
   visual identity for recognizability, but name/store-listing must not imply
   this is published by IVPN Limited.
3. **Community disclosure is mandatory and visible in-product**, not just in
   the README — see Phase 2 below.
4. License choice is the human owner's call — see §1. Don't assume GPLv3.

## 6. Phase 0 — Repo bootstrap

- [ ] Clone `mullvad/browser-extension` into a local, gitignored reference
      folder (outside the project's own repo).
- [ ] Init a fresh git repo for the project — own tooling choices from scratch
      (Vite/Vue is a reasonable default matching what was studied, but a plainer
      stack is fine too — this is a from-scratch decision, not a constraint
      inherited from Mullvad).
- [ ] Set up MV3 manifest from day one — build both a Chrome-loadable and a
      Firefox-loadable package from one source tree (two manifest templates or
      a cross-browser framework like `wxt` — pick based on how much the team
      wants to hand-roll vs. adopt tooling; **[ESCALATE]** if framework choice
      has long-term maintenance implications the human should weigh in on).

## 7. Phase 1 — Tier 1 MVP build

- [ ] `getServers()` / `getConnectionStatus()` API client against the two
      confirmed IVPN endpoints (§2), with response-shape types matched to
      IVPN's actual fields, not Mullvad's.
- [ ] Global proxy toggle + location picker (country/city grouped, searchable),
      filtering out `in_maintenance`/inactive servers.
- [ ] Firefox `browser.proxy.onRequest` + Chrome PAC-script implementation
      behind the shared interface described in §4.
- [ ] Browser-action badge: on/off + location code.
- [ ] Minimal options page: About tab with the community disclosure (§5.3) +
      bare Proxy tab.

**Definition of Done:** a working extension on both browsers that shows
connection status, lists servers, and can toggle a single global SOCKS5 exit,
with visible unofficial/community disclosure.

## 8. Phase 2 — Community-project disclosure (user-facing, not just docs)

- [ ] README top banner: "⚠️ Unofficial, community-maintained project. Not
      affiliated with, endorsed by, or supported by IVPN Limited. Built as an
      independent implementation, using mullvad/browser-extension (GPLv3) as a
      feature reference only — no code shared."
- [ ] **In the extension UI itself**: a persistent line in the popup footer or
      an About/Settings screen — "Community project — unaffiliated with IVPN.
      Talks directly to IVPN's public API; no data passes through project
      maintainers." Verify it actually renders; this is a stated goal, not
      optional.
- [ ] Name the extension something that doesn't read as an official IVPN
      product — e.g. "IVPN Companion (Community)". **[ESCALATE]** propose 2–3
      names, let the human owner pick.
- [ ] Source IVPN's real brand colors/logo from ivpn.net's press assets or the
      `ui/` theme in `ivpn/desktop-app` (their own app's palette) — don't guess
      hex values from memory.

## 9. Phase 3 — Tier 2 features

- [ ] Per-domain custom proxy rules (add/remove, per-domain DNS toggle,
      per-domain enable/disable) — extend the Phase 1 domain-matching logic,
      don't rebuild it.
- [ ] "Never proxy" exclusion list.
- [ ] Random proxy mode.
- [ ] Usage history (most-used / most-recent quick buttons).
- [ ] Import/export settings as JSON.
- [ ] WebRTC leak detection (both browsers) + disable toggle (Firefox only —
      document the Chrome gap in the UI, don't silently omit the feature there).
- [ ] Extension/HTTPS-Only recommendations (generic, portable as-is with new
      copy where it referenced Mullvad specifically).

## 10. Phase 4 — Tier 3 research spikes

Tier 3 (DNS-leak check, DoH nudges, search-engine recommendation) was
researched and dropped from v1 scope. No further work planned.

## 11. Phase 5 — QA / test matrix

- [ ] Unit/mocked tests for the API client using fixture JSON captured from the
      real endpoints, not live calls, so CI doesn't depend on IVPN's servers.
- [ ] Manual E2E checklist (requires a real, funded IVPN account + active
      tunnel — **[ESCALATE]** human-with-credentials task):
        - [ ] Connection status reflects reality when tunnel up/down.
        - [ ] Server picker filters out `in_maintenance`/inactive servers.
        - [ ] Firefox: proxy toggle actually routes traffic through the
              selected server's SOCKS5 endpoint (verify via `geo-lookup`).
        - [ ] Chrome: same check, via the PAC-script path.
        - [ ] Per-domain rules and exclusions resolve correctly on both browsers.
        - [ ] Disabling proxy / disconnecting VPN doesn't leak traffic.
- [ ] Lint/build/test all green in CI before tagging a release.

## 12. Phase 6 — Packaging & distribution

- [ ] Firefox: unsigned `.xpi` for temporary install first; AMO submission is a
      later, human-owned step (developer account, signing, review).
- [ ] Chrome: Web Store submission requires a human-owned developer account.
      **[ESCALATE]** proxy-permission extensions often get extra manual review
      scrutiny — expect delay, not a bug.

## 13. Summary of escalation points (quick reference)

1. Confirm with IVPN that `servers/stats` is acceptable for third-party use.
2. Confirm the project's license choice (no longer inherited from GPLv3).
3. Build-tooling decision: hand-rolled two-manifest setup vs. a framework
   like `wxt`.
4. Final extension name.
5. DNS-leak-test equivalent: build, substitute, or drop. **(resolved — dropped)**
6. DoH nudges: rewrite around IVPN specifics, or drop. **(resolved — dropped)**
7. Manual E2E test pass requires a human with a live IVPN account.
8. Store account setup and submission.