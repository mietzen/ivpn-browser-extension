/**
 * Settings + per-domain rules + history. Persisted via wxt/utils/storage.
 * Storage is versioned so future schema changes migrate on read.
 *
 * v1 schema (legacy): { mode, globalGateway, domainRules, exclusions, ... }
 * v2 schema (current): { global, domainRules, exclusions, ... }
 *
 * Migration happens lazily in `settingsStore.get()` — v1 values are
 * rewritten to v2 and re-saved on first read.
 */

import { storage } from 'wxt/utils/storage';
import type { IvpnServer } from '../ivpn/types';
import type {
  DomainRule,
  GlobalProxy,
  ProxyRules,
  RuleTarget,
} from '../proxy/rules';
import { DIRECT_GLOBAL, DIRECT_TARGET } from '../proxy/rules';

export const STORAGE_VERSION = 2;
const SETTINGS_KEY = 'local:settings';
const HISTORY_KEY = 'local:history';
const CACHE_KEY = 'local:serverCache';

export interface PersistedSettings {
  version: number;
  global: GlobalProxy;
  domainRules: DomainRule[];
  exclusions: string[];
  webRtcEnabled: boolean;
  webRtcDisableApplied: boolean;
  httpsOnlyNudgeDismissed: boolean;
  extensionRecommendationsDismissed: boolean;
}

export interface LegacyPersistedSettingsV1 {
  version?: number;
  mode: 'direct' | 'global' | 'random' | string;
  globalGateway: string | null;
  domainRules: Array<{
    domain: string;
    endpoint: { host: string; port: number } | null;
    label: string;
    disabled: boolean;
    proxyDns: boolean;
  }>;
  exclusions: string[];
  webRtcEnabled: boolean;
  webRtcDisableApplied: boolean;
  httpsOnlyNudgeDismissed: boolean;
  extensionRecommendationsDismissed: boolean;
}

export interface ServerHistoryEntry {
  gateway: string;
  count: number;
  lastUsed: number;
}

export interface ServerCache {
  fetchedAt: number;
  servers: IvpnServer[];
}

function defaultSettings(): PersistedSettings {
  return {
    version: STORAGE_VERSION,
    global: DIRECT_GLOBAL,
    domainRules: [],
    exclusions: [],
    webRtcEnabled: true,
    webRtcDisableApplied: false,
    httpsOnlyNudgeDismissed: false,
    extensionRecommendationsDismissed: false,
  };
}

export const settingsStore = {
  async get(): Promise<PersistedSettings> {
    const raw = await storage.getItem<unknown>(SETTINGS_KEY);
    if (!raw) return defaultSettings();
    const value = raw as PersistedSettings;
    if ((value.version ?? 1) < STORAGE_VERSION) {
      const migrated = migrate(value as unknown as LegacyPersistedSettingsV1);
      await storage.setItem(SETTINGS_KEY, migrated);
      return migrated;
    }
    return value;
  },
  async set(next: PersistedSettings): Promise<void> {
    await storage.setItem(SETTINGS_KEY, next);
  },
  async patch(partial: Partial<PersistedSettings>): Promise<PersistedSettings> {
    const current = await this.get();
    const next = { ...current, ...partial, version: STORAGE_VERSION };
    await this.set(next);
    return next;
  },
};

function migrate(old: LegacyPersistedSettingsV1): PersistedSettings {
  const global: GlobalProxy =
    old.mode === 'global' && old.globalGateway
      ? { kind: 'socks5', endpoint: { host: '__pending__', port: 0 }, label: old.globalGateway }
      : DIRECT_GLOBAL;
  const domainRules: DomainRule[] = old.domainRules.map((r) => {
    const target: RuleTarget = r.endpoint
      ? { kind: 'socks5', endpoint: r.endpoint, label: r.label }
      : DIRECT_TARGET;
    return { pattern: r.domain, target, disabled: r.disabled, proxyDns: r.proxyDns };
  });
  return {
    ...defaultSettings(),
    version: STORAGE_VERSION,
    global,
    domainRules,
    exclusions: old.exclusions,
    webRtcEnabled: old.webRtcEnabled,
    webRtcDisableApplied: old.webRtcDisableApplied,
    httpsOnlyNudgeDismissed: old.httpsOnlyNudgeDismissed,
    extensionRecommendationsDismissed: old.extensionRecommendationsDismissed,
  };
}

/**
 * After migration, the global may have an `endpoint.host === '__pending__'`
 * placeholder. Resolve it against the live server list to get a real
 * endpoint. Called by the background after fetching servers, before the
 * first hydrate push.
 */
export function resolveMigratedGlobal(
  settings: PersistedSettings,
  servers: IvpnServer[],
): { settings: PersistedSettings; global: GlobalProxy } {
  if (settings.global.kind === 'socks5' && settings.global.endpoint.host === '__pending__') {
    const label = settings.global.label;
    const server = servers.find((s) => s.gateway === label);
    if (!server) {
      const next: PersistedSettings = { ...settings, global: DIRECT_GLOBAL };
      return { settings: next, global: DIRECT_GLOBAL };
    }
    const endpoint = parseSocks5EndpointLocal(server);
    const global: GlobalProxy = { kind: 'socks5', endpoint, label: server.gateway };
    return { settings: { ...settings, global }, global };
  }
  return { settings, global: settings.global };
}

function parseSocks5EndpointLocal(server: IvpnServer): { host: string; port: number } {
  const colon = server.socks5.indexOf(':');
  const host = colon === -1 ? server.socks5 : server.socks5.slice(0, colon);
  return { host, port: 1080 };
}

export const historyStore = {
  async getAll(): Promise<Record<string, ServerHistoryEntry>> {
    return (await storage.getItem<Record<string, ServerHistoryEntry>>(HISTORY_KEY)) ?? {};
  },
  async recordUse(gateway: string): Promise<void> {
    const all = await this.getAll();
    const existing = all[gateway];
    const next: ServerHistoryEntry = {
      gateway,
      count: (existing?.count ?? 0) + 1,
      lastUsed: Date.now(),
    };
    await storage.setItem(HISTORY_KEY, { ...all, [gateway]: next });
  },
  async clear(): Promise<void> {
    await storage.removeItem(HISTORY_KEY);
  },
};

export const serverCacheStore = {
  async get(): Promise<ServerCache | null> {
    return (await storage.getItem<ServerCache>(CACHE_KEY)) ?? null;
  },
  async set(servers: IvpnServer[]): Promise<void> {
    await storage.setItem(CACHE_KEY, { fetchedAt: Date.now(), servers });
  },
  async clear(): Promise<void> {
    await storage.removeItem(CACHE_KEY);
  },
};

export function buildRulesFromSettings(settings: PersistedSettings, servers: IvpnServer[]): ProxyRules {
  const cleanedRules = settings.domainRules
    .map((r): DomainRule | null => {
      const t = r.target;
      if (t.kind === 'socks5') {
        const exists = servers.some((s) => s.gateway === t.label);
        if (!exists) return null;
      }
      return r;
    })
    .filter((r): r is DomainRule => r !== null);

  return {
    global: settings.global,
    domainRules: cleanedRules,
    exclusions: settings.exclusions,
  };
}

export interface ExportPayload {
  version: number;
  exportedAt: number;
  settings: PersistedSettings;
  history: Record<string, ServerHistoryEntry>;
}

export async function exportAll(): Promise<ExportPayload> {
  const [settings, history] = await Promise.all([settingsStore.get(), historyStore.getAll()]);
  return { version: STORAGE_VERSION, exportedAt: Date.now(), settings, history };
}

export async function importAll(payload: ExportPayload): Promise<void> {
  if (!payload || payload.version !== STORAGE_VERSION) {
    throw new Error(`Incompatible import version: ${payload?.version ?? 'unknown'}`);
  }
  await storage.setItem(SETTINGS_KEY, payload.settings);
  await storage.setItem(HISTORY_KEY, payload.history);
}
