/**
 * Background service worker. Coordinates:
 *   - settings changes → push new proxy rules
 *   - server list fetch + cache (with TTL)
 *   - smart first-install default (geo-lookup → same-country server → random)
 *   - usage history recording
 *   - badge updates
 *   - WebRTC privacy setting (Firefox-only)
 *   - active tab host lookup for the popup
 */

import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { getServers, getConnectionStatus } from '../lib/ivpn/client';
import type { IvpnServer } from '../lib/ivpn/types';
import { groupActiveServers } from '../lib/ivpn/grouping';
import { buildRulesFromSettings, historyStore, resolveMigratedGlobal, serverCacheStore, settingsStore, type PersistedSettings } from '../lib/storage';
import { setProxyRules, clearProxyRules, targetFromServer } from '../lib/proxy';
import { updateBadge } from '../lib/badge';
import { refreshWebRtcSetting, detectWebRtcLeak } from '../lib/webrtc';

const SERVER_CACHE_TTL_MS = 30 * 60 * 1000;

interface ActiveState {
  settings: PersistedSettings;
  servers: IvpnServer[];
}

let state: ActiveState | null = null;

async function getServersWithCache(force = false): Promise<IvpnServer[]> {
  if (!force) {
    const cached = await serverCacheStore.get();
    if (cached && Date.now() - cached.fetchedAt < SERVER_CACHE_TTL_MS) {
      return cached.servers;
    }
  }
  const fresh = await getServers();
  await serverCacheStore.set(fresh);
  return fresh;
}

async function pushCurrentRules(): Promise<void> {
  if (!state) return;
  const rules = buildRulesFromSettings(state.settings, state.servers);
  const hasProxyGlobal = rules.global.kind === 'socks5' || rules.global.kind === 'random';
  const hasAnySocks5Target = rules.domainRules.some((r) => r.target.kind === 'socks5') || hasProxyGlobal;
  if (!hasAnySocks5Target && rules.domainRules.length === 0) {
    await clearProxyRules();
  } else {
    await setProxyRules(rules, state.servers);
  }
  await updateBadge(state.settings);
}

/**
 * On first install (or whenever the global is still `direct` and no
 * history exists), pick a sensible default: same-country server based
 * on geo-lookup, falling back to a random active server. Idempotent —
 * only fires if global is unset and history is empty.
 */
async function maybeSetSmartDefault(servers: IvpnServer[]): Promise<void> {
  if (!state) return;
  const { settings } = state;
  if (settings.global.kind !== 'direct') return;
  const history = await historyStore.getAll();
  if (Object.keys(history).length > 0) return;
  if (servers.length === 0) return;

  const chosen = (await pickServerInUserCountry(servers)) ?? randomServer(servers);
  if (!chosen) return;

  const target = targetFromServer(chosen);
  if (target.kind === 'socks5') {
    const next = await settingsStore.patch({ global: target });
    state.settings = next;
  }
}

function pickServerInUserCountry(servers: IvpnServer[]): Promise<IvpnServer | null> {
  return getConnectionStatus()
    .then((status) => {
      if (!status?.country_code) return null;
      const code = status.country_code;
      return servers.find((s) => s.country_code === code && s.is_active && !s.in_maintenance) ?? null;
    })
    .catch(() => null);
}

function randomServer(servers: IvpnServer[]): IvpnServer | null {
  const groups = groupActiveServers(servers);
  const flat = groups.flatMap((g) => g.cities.flatMap((c) => c.servers));
  return flat[Math.floor(Math.random() * flat.length)] ?? null;
}

async function hydrate(): Promise<void> {
  let settings = await settingsStore.get();
  const servers = await getServersWithCache();
  const resolved = resolveMigratedGlobal(settings, servers);
  if (resolved.settings !== settings) {
    await settingsStore.set(resolved.settings);
    settings = resolved.settings;
  }
  state = { settings, servers };
  await maybeSetSmartDefault(servers);
  await pushCurrentRules();
  await refreshWebRtcSetting(settings.webRtcEnabled, settings.webRtcDisableApplied);
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async () => {
    await hydrate();
  });

  browser.runtime.onStartup.addListener(async () => {
    await hydrate();
  });

  browser.runtime.onMessage.addListener((message: unknown, _sender: Browser.runtime.MessageSender) => {
    return handleMessage(message);
  });

  hydrate().catch((err) => {
    console.error('Initial hydrate failed:', err);
  });
});

interface MessageMap {
  'settings/get': undefined;
  'settings/patch': Partial<PersistedSettings>;
  'settings/setGlobal': { global: PersistedSettings['global'] };
  'servers/refresh': undefined;
  'servers/list': undefined;
  'connection/status': undefined;
  'tabs/active': undefined;
  'webrtc/leakCheck': undefined;
  'webrtc/toggle': { enabled: boolean };
  'history/get': undefined;
  'history/recordUse': { gateway: string };
  'history/clear': undefined;
  'rules/current': undefined;
}

async function handleMessage(message: unknown): Promise<unknown> {
  if (!message || typeof message !== 'object' || !('type' in message)) {
    return { error: 'bad message' };
  }
  const msg = message as { type: keyof MessageMap; payload?: unknown };

  switch (msg.type) {
    case 'settings/get': {
      return await settingsStore.get();
    }
    case 'settings/patch': {
      const partial = (msg.payload ?? {}) as Partial<PersistedSettings>;
      const next = await settingsStore.patch(partial);
      if (state) state.settings = next;
      await pushCurrentRules();
      if ('webRtcEnabled' in partial || 'webRtcDisableApplied' in partial) {
        await refreshWebRtcSetting(next.webRtcEnabled, next.webRtcDisableApplied);
      }
      return next;
    }
    case 'settings/setGlobal': {
      const { global } = msg.payload as { global: PersistedSettings['global'] };
      const next = await settingsStore.patch({ global });
      if (state) state.settings = next;
      await pushCurrentRules();
      return next;
    }
    case 'servers/refresh': {
      const servers = await getServersWithCache(true);
      if (state) state.servers = servers;
      await pushCurrentRules();
      return { servers, count: servers.length, fetchedAt: (await serverCacheStore.get())?.fetchedAt };
    }
    case 'servers/list': {
      if (!state) return [];
      return state.servers;
    }
    case 'connection/status': {
      try {
        return { ok: true, status: await getConnectionStatus() };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    }
    case 'tabs/active': {
      try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (!tab?.url) return { host: null };
        const u = new URL(tab.url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return { host: null };
        return { host: u.hostname };
      } catch (err) {
        return { host: null, error: (err as Error).message };
      }
    }
    case 'webrtc/leakCheck': {
      return { ok: true, supported: true, ...(await detectWebRtcLeak()) };
    }
    case 'webrtc/toggle': {
      const { enabled } = msg.payload as { enabled: boolean };
      const next = await settingsStore.patch({
        webRtcEnabled: enabled,
        webRtcDisableApplied: !enabled,
      });
      if (state) state.settings = next;
      await refreshWebRtcSetting(next.webRtcEnabled, next.webRtcDisableApplied);
      return { ok: true, applied: next.webRtcDisableApplied };
    }
    case 'history/get': {
      return await historyStore.getAll();
    }
    case 'history/recordUse': {
      const { gateway } = msg.payload as { gateway: string };
      await historyStore.recordUse(gateway);
      return { ok: true };
    }
    case 'history/clear': {
      await historyStore.clear();
      return { ok: true };
    }
    case 'rules/current': {
      if (!state) return null;
      return buildRulesFromSettings(state.settings, state.servers);
    }
    default:
      return { error: `unknown message: ${msg.type}` };
  }
}
