import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: './',
  outDir: '.output',

  manifestVersion: 3,

  manifest: ({ browser }) => ({
    name: 'IVPN Browser Extension (Community)',
    short_name: 'IVPN Companion',
    description:
      'Community-maintained browser extension for IVPN. Routes browser traffic through IVPN desktop app SOCKS5 proxy. Unofficial, not affiliated with IVPN Limited.',
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
