# Disclaimer

**This extension is not related to or developed by IVPN Limited. No relationship between the developer(s) of this extension and IVPN Limited exists.**

**All trademarks, logos and brand names are the property of their respective owners. All company, product and service names used in this extension are for identification purposes only. Use of these names, trademarks and brands does not imply endorsement.**

Brand colors used in this extension are derived from IVPN's official open-source desktop application (`github.com/ivpn/desktop-app`, GPLv3), which is used as a visual reference only.

# IVPN Browser Extension (Community)

`ivpn-browser-extension-community` is a unofficial companion browser extension for the [IVPN](https://www.ivpn.net/) desktop app. It routes browser traffic through the IVPN desktop app's SOCKS5 proxy and provides a server picker, per-domain rules, exclusion list, usage history, and WebRTC leak detection.

The extension does not start or stop the VPN connection. It assumes the IVPN desktop app is already connected, the same assumption [mullvad/browser-extension](https://github.com/mullvad/browser-extension) makes.

Inspired by [mullvad/browser-extension](https://github.com/mullvad/browser-extension) (GPLv3) as a feature reference only. No code, assets, or copy from that project has been copied into this one.

## Prerequisites

The IVPN desktop app must be installed and connected. The extension only routes browser traffic through the existing tunnel; it does not bring the tunnel up or down.

The extension uses two IVPN public HTTPS endpoints (no auth required):

- `https://api.ivpn.net/v5/servers/stats` — server list for the location picker
- `https://api.ivpn.net/v4/geo-lookup` — current connection status

# Development

**Minimum required Node version: 24**

## Install

```shell
npm install
```

## Load unpacked

After `npm run dev` finishes, load the unpacked extension from `.output/<browser>-dev`.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on...**
3. Select `.output/firefox-mv2-dev/manifest.json` (dev) or `.output/firefox-mv3-dev/manifest.json` (MV3 dev)

### Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `.output/chrome-mv3-dev/`

## Build

```shell
# Chrome
npm run build:chrome
# Firefox
npm run build:firefox
# Both + zip
npm run zip:chrome
npm run zip:firefox
```

Output is in `.output/<browser>-mv3/`.

# Test

```shell
# Unit tests
npm test

# Lint
npm run lint

# Type check
npm run compile
```

CI runs all three on every pull request to `main`. See `.github/workflows/ci.yml`.

# Permissions

| Permission | Why |
|------------|-----|
| `proxy` | Set the SOCKS5 proxy (Firefox `onRequest`, Chrome PAC script) |
| `storage` | Persist settings, history, and server cache |
| `tabs` | Read the active tab's host to prefill the popup UI |
| `activeTab` | Same, scoped to user-initiated popup opens |
| `webRequest` | Firefox proxy API requires it |
| `privacy` | Firefox `peerConnectionEnabled` toggle (WebRTC disable) |
| `management` | Detect installed recommended extensions (uBlock Origin) |
| `<all_urls>` | The proxy can be applied to any host |

# Privacy

The extension talks directly to `api.ivpn.net` over HTTPS. No request, selection, IP, or URL passes through any infrastructure operated by this project's maintainers.

The Mullvad browser extension was used as a study aid. It lives in a sibling, gitignored folder, and no part of it has been copied into this repository.

# License

MIT. See [LICENSE](./LICENSE).

`IVPN` is a registered trademark of IVPN Limited. Use of the mark here is referential only and does not imply endorsement.
