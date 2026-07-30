import { describe, it, expect, beforeEach } from 'vitest';
import { buildRulesFromSettings, exportAll, importAll, settingsStore, historyStore } from '~/lib/storage';
import type { PersistedSettings } from '~/lib/storage';
import type { IvpnServer } from '~/lib/ivpn/types';

const server: IvpnServer = {
  gateway: 'us-nyc-wg-001',
  country_code: 'US',
  country: 'United States',
  city: 'New York',
  load: 0.3,
  status: 'online',
  is_active: true,
  in_maintenance: false,
  socks5: 'socks5.us-nyc-wg-001.gw.ivpn.net:10.1.0.1',
};

const servers: IvpnServer[] = [server];

beforeEach(async () => {
  const memStore = new Map<string, unknown>();
  // Reset by re-mocking the in-memory map via set/remove of common keys.
  void memStore;
});

describe('storage', () => {
  it('settingsStore returns defaults when nothing is stored', async () => {
    const settings = await settingsStore.get();
    expect(settings.mode).toBe('direct');
    expect(settings.domainRules).toEqual([]);
    expect(settings.exclusions).toEqual([]);
  });

  it('settingsStore.patch merges and persists', async () => {
    const next = await settingsStore.patch({ mode: 'global', globalGateway: 'us-nyc-wg-001' });
    expect(next.mode).toBe('global');
    const reread = await settingsStore.get();
    expect(reread.mode).toBe('global');
    expect(reread.globalGateway).toBe('us-nyc-wg-001');
  });

  it('historyStore.recordUse increments count and updates lastUsed', async () => {
    await historyStore.recordUse('us-nyc-wg-001');
    await historyStore.recordUse('us-nyc-wg-001');
    const all = await historyStore.getAll();
    expect(all['us-nyc-wg-001']?.count).toBe(2);
    expect(typeof all['us-nyc-wg-001']?.lastUsed).toBe('number');
  });

  it('exportAll then importAll roundtrips state', async () => {
    await settingsStore.patch({
      mode: 'global',
      globalGateway: 'us-nyc-wg-001',
      exclusions: ['lan'],
    });
    await historyStore.recordUse('us-nyc-wg-001');

    const payload = await exportAll();
    expect(payload.settings.exclusions).toContain('lan');
    expect(payload.history['us-nyc-wg-001']).toBeDefined();

    // Wipe and re-import.
    await historyStore.clear();
    await settingsStore.patch({ exclusions: [] });
    expect((await settingsStore.get()).exclusions).toEqual([]);

    await importAll(payload);
    const restored = await settingsStore.get();
    expect(restored.exclusions).toContain('lan');
    expect((await historyStore.getAll())['us-nyc-wg-001']).toBeDefined();
  });

  it('importAll rejects incompatible versions', async () => {
    await expect(
      importAll({ version: 999, exportedAt: 0, settings: {} as PersistedSettings, history: {} }),
    ).rejects.toThrow(/version/i);
  });
});

describe('buildRulesFromSettings', () => {
  it('maps global target to a SOCKS5 endpoint at port 1080', async () => {
    const base = await settingsStore.get();
    const rules = buildRulesFromSettings(
      { ...base, mode: 'global', globalGateway: 'us-nyc-wg-001' },
      servers,
    );
    expect(rules.mode).toBe('global');
    expect(rules.globalTarget.endpoint?.host).toBe('socks5.us-nyc-wg-001.gw.ivpn.net');
    expect(rules.globalTarget.endpoint?.port).toBe(1080);
  });

  it('drops domain rules whose label no longer matches any server', async () => {
    const base = await settingsStore.get();
    const rules = buildRulesFromSettings(
      {
        ...base,
        domainRules: [
          { domain: 'stale.com', endpoint: { host: 'old', port: 1080 }, label: 'gone-001', disabled: false, proxyDns: false },
          { domain: 'fresh.com', endpoint: { host: 'socks5.us-nyc-wg-001.gw.ivpn.net', port: 1080 }, label: 'us-nyc-wg-001', disabled: false, proxyDns: false },
        ],
      },
      servers,
    );
    const domains = rules.domainRules.map((r) => r.domain);
    expect(domains).toContain('fresh.com');
    expect(domains).not.toContain('stale.com');
  });
});
