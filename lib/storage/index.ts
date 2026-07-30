/**
 * Settings + per-domain rules + history. All persisted in browser.storage.local
 * via wxt's typed storage helpers. Versioned so future schema changes can
 * migrate cleanly.
 */

import { storage } from 'wxt/utils/storage';
import type { IvpnServer } from '../ivpn/types';
import type { DomainRule, ProxyMode, ProxyRules, ProxyTarget } from '../proxy/rules';
import { DIRECT_TARGET, emptyRules, targetFromServer } from '../proxy/rules';

const STORAGE_VERSION = 1;

export interface PersistedSettings {
  version: number;
  mode: ProxyMode;
  globalGateway: string | null;
  domainRules: DomainRule[];
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

const SETTINGS_KEY = 'local:settings';
const HISTORY_KEY = 'local:history';
const CACHE_KEY = 'local:serverCache';

function defaultSettings(): PersistedSettings {
  return {
    version: STORAGE_VERSION,
    mode: 'direct',
    globalGateway: null,
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
    const value = await storage.getItem<PersistedSettings>(SETTINGS_KEY);
    if (!value) return defaultSettings();
    if (value.version !== STORAGE_VERSION) {
      const migrated = migrateSettings(value);
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

function migrateSettings(old: PersistedSettings): PersistedSettings {
  return { ...defaultSettings(), ...old, version: STORAGE_VERSION };
}

/**
 * Build a ProxyRules snapshot from persisted settings + the current server list.
 */
export function buildRulesFromSettings(
  settings: PersistedSettings,
  servers: IvpnServer[],
  randomTarget?: ProxyTarget | null,
): ProxyRules {
  const global = settings.globalGateway
    ? servers.find((s) => s.gateway === settings.globalGateway)
    : undefined;
  const globalTarget: ProxyTarget = global ? targetFromServer(global) : DIRECT_TARGET;

  const rules: ProxyRules = {
    ...emptyRules(),
    mode: settings.mode,
    globalTarget,
    domainRules: settings.domainRules.filter((r) => {
      if (!r.endpoint) return true;
      return servers.some(
        (s) => s.gateway.toLowerCase() === r.label.toLowerCase(),
      );
    }),
    exclusions: settings.exclusions,
    randomTarget: randomTarget ?? null,
  };
  return rules;
}

/**
 * Import/export of all user-visible state. Versioned envelope so future schema
 * changes can refuse imports or attempt migration.
 */
export interface ExportPayload {
  version: number;
  exportedAt: number;
  settings: PersistedSettings;
  history: Record<string, ServerHistoryEntry>;
}

export async function exportAll(): Promise<ExportPayload> {
  const [settings, history] = await Promise.all([
    settingsStore.get(),
    historyStore.getAll(),
  ]);
  return { version: STORAGE_VERSION, exportedAt: Date.now(), settings, history };
}

export async function importAll(payload: ExportPayload): Promise<void> {
  if (!payload || payload.version !== STORAGE_VERSION) {
    throw new Error(`Incompatible import version: ${payload?.version ?? 'unknown'}`);
  }
  await storage.setItem(SETTINGS_KEY, payload.settings);
  await storage.setItem(HISTORY_KEY, payload.history);
}
