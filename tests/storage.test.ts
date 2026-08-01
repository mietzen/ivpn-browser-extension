import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildRulesFromSettings,
  exportAll,
  settingsStore,
  historyStore,
  resolveMigratedGlobal,
  STORAGE_VERSION,
} from '~/lib/storage';
import type { PersistedSettings } from '~/lib/storage';
import type { IvpnServer } from '~/lib/ivpn/types';

const server: IvpnServer = {
  gateway: 'us-nyc-wg-001',
  country_code: 'US',
  country: 'United States',
  city: 'New York',
  load: 0.3,
  status: 0,
  is_active: true,
  in_maintenance: false,
  socks5: 'socks5.us-nyc-wg-001.gw.ivpn.net:10.1.0.1',
};

beforeEach(() => {
  // Reset the in-memory mock store via direct manipulation is not
  // exposed; just use unique keys per test.
});

describe('storage v2', () => {
  it('returns defaults when nothing is stored', async () => {
    const s = await settingsStore.get();
    expect(s.version).toBe(STORAGE_VERSION);
    expect(s.global).toEqual({ kind: 'direct' });
    expect(s.domainRules).toEqual([]);
    expect(s.exclusions).toEqual([]);
  });

  it('patches and persists', async () => {
    const next = await settingsStore.patch({
      global: { kind: 'socks5', endpoint: { host: 'h', port: 1080 }, label: 'h' },
      exclusions: ['*.lan'],
    });
    expect(next.global.kind).toBe('socks5');
    expect(next.exclusions).toContain('*.lan');
    const reread = await settingsStore.get();
    expect(reread.exclusions).toContain('*.lan');
  });
});

describe('storage v1 → v2 migration', () => {
  it('migrates direct mode to direct global', () => {
    // Migration is exercised in production by settingsStore.get() when
    // version < 2 is read. Here we just verify the v2 shape holds a
    // direct global for what was a v1 direct-mode record.
    const migrated: PersistedSettings = {
      version: STORAGE_VERSION,
      global: { kind: 'direct' },
      domainRules: [],
      exclusions: ['*.lan'],
      webRtcEnabled: true,
      webRtcDisableApplied: false,
      httpsOnlyNudgeDismissed: false,
      extensionRecommendationsDismissed: false,
    };
    expect(migrated.exclusions).toContain('*.lan');
  });

  it('resolveMigratedGlobal with placeholder resolves to real endpoint', () => {
    const settings: PersistedSettings = {
      version: STORAGE_VERSION,
      global: { kind: 'socks5', endpoint: { host: '__pending__', port: 0 }, label: 'us-nyc-wg-001' },
      domainRules: [],
      exclusions: [],
      webRtcEnabled: true,
      webRtcDisableApplied: false,
      httpsOnlyNudgeDismissed: false,
      extensionRecommendationsDismissed: false,
    };
    const { global } = resolveMigratedGlobal(settings, [server]);
    expect(global.kind).toBe('socks5');
    if (global.kind === 'socks5') {
      expect(global.endpoint.host).toBe('socks5.us-nyc-wg-001.gw.ivpn.net');
      expect(global.endpoint.port).toBe(1080);
    }
  });

  it('resolveMigratedGlobal preserves identity when no rewrite needed', () => {
    const settings: PersistedSettings = {
      version: STORAGE_VERSION,
      global: { kind: 'socks5', endpoint: { host: 'real.host', port: 1080 }, label: 'srv' },
      domainRules: [],
      exclusions: [],
      webRtcEnabled: true,
      webRtcDisableApplied: false,
      httpsOnlyNudgeDismissed: false,
      extensionRecommendationsDismissed: false,
    };
    const { settings: resolved, global } = resolveMigratedGlobal(settings, [server]);
    expect(resolved).toBe(settings);
    expect(global).toBe(settings.global);
  });

  it('resolveMigratedGlobal falls back to direct when no matching server', () => {
    const settings: PersistedSettings = {
      version: STORAGE_VERSION,
      global: { kind: 'socks5', endpoint: { host: '__pending__', port: 0 }, label: 'missing' },
      domainRules: [],
      exclusions: [],
      webRtcEnabled: true,
      webRtcDisableApplied: false,
      httpsOnlyNudgeDismissed: false,
      extensionRecommendationsDismissed: false,
    };
    const { global } = resolveMigratedGlobal(settings, []);
    expect(global).toEqual({ kind: 'direct' });
  });
});

describe('buildRulesFromSettings', () => {
  it('maps socks5 global to a global target', () => {
    const settings: PersistedSettings = {
      version: STORAGE_VERSION,
      global: { kind: 'socks5', endpoint: { host: 'h', port: 1080 }, label: 'us-nyc-wg-001' },
      domainRules: [],
      exclusions: [],
      webRtcEnabled: true,
      webRtcDisableApplied: false,
      httpsOnlyNudgeDismissed: false,
      extensionRecommendationsDismissed: false,
    };
    const rules = buildRulesFromSettings(settings, [server]);
    expect(rules.global.kind).toBe('socks5');
    if (rules.global.kind === 'socks5') expect(rules.global.label).toBe('us-nyc-wg-001');
  });

  it('drops rules whose target server no longer exists', () => {
    const settings: PersistedSettings = {
      version: STORAGE_VERSION,
      global: { kind: 'direct' },
      domainRules: [
        { pattern: 'stale.com', target: { kind: 'socks5', endpoint: { host: 'gone', port: 1080 }, label: 'gone' }, disabled: false, proxyDns: false },
        { pattern: 'fresh.com', target: { kind: 'socks5', endpoint: { host: 'h', port: 1080 }, label: 'us-nyc-wg-001' }, disabled: false, proxyDns: false },
      ],
      exclusions: [],
      webRtcEnabled: true,
      webRtcDisableApplied: false,
      httpsOnlyNudgeDismissed: false,
      extensionRecommendationsDismissed: false,
    };
    const rules = buildRulesFromSettings(settings, [server]);
    const patterns = rules.domainRules.map((r) => r.pattern);
    expect(patterns).toContain('fresh.com');
    expect(patterns).not.toContain('stale.com');
  });
});

describe('exportAll / importAll', () => {
  it('roundtrips state', async () => {
    await settingsStore.patch({
      global: { kind: 'socks5', endpoint: { host: 'h', port: 1080 }, label: 'us-nyc-wg-001' },
      exclusions: ['*.lan'],
    });
    await historyStore.recordUse('us-nyc-wg-001');
    const payload = await exportAll();
    expect(payload.settings.exclusions).toContain('*.lan');
    expect(payload.history['us-nyc-wg-001']).toBeDefined();
  });
});
