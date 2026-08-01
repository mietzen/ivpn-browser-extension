import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: './',
  outDir: '.output',

  manifestVersion: 3,

  manifest: ({ browser }) => ({
    name: 'IVPN Proxy-Switcher',
    short_name: 'IVPN Proxy-Switcher',
    description:
      'Routes browser traffic through the IVPN desktop app SOCKS5 proxy. Unofficial, not affiliated with IVPN Limited.',
    permissions: [
      'proxy',
      'storage',
      'tabs',
      'activeTab',
      'webRequest',
      'privacy',
      'management',
    ],
    host_permissions: ['<all_urls>'],

    action: {
      default_title: 'IVPN Companion (Community)',
      default_popup: 'popup.html',
      default_icon: {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
        48: 'icons/icon-48.png',
        128: 'icons/icon-128.png',
      },
    },

    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },

    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'ivpn-companion-community@local.invalid',
          strict_min_version: '115.0',
        },
      },
      background: {
        scripts: ['background.js'],
        persistent: false,
        type: 'module',
      },
    }),

    ...(browser === 'chrome' && {
      minimum_chrome_version: '120',
    }),
  }),

  vite: () => ({
    server: {
      port: 3000,
    },
  }),
});
