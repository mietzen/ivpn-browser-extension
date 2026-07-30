/**
 * Background service worker. Coordinates:
 *   - settings changes → push new proxy rules
 *   - server list fetch + cache (with TTL)
 *   - usage history recording
 *   - badge updates
 *   - WebRTC privacy setting (Firefox-only)
 *   - extension/HTTPS-Only recommendations
 *
 * Wires the storage and proxy layers together. No UI lives here.
 */

import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/sandbox';
import { getServers, getConnectionStatus } from '../lib/ivpn/client';
import type { IvpnServer } from '../lib/ivpn/types';
import { pickRandomServer } from '../lib/ivpn/grouping';
import {
  buildRulesFromSettings,
  historyStore,
  serverCacheStore,
  settingsStore,
  type PersistedSettings,
} from '../lib/storage';
import {
  setProxyRules,
  clearProxyRules,
  targetFromServer,
  isFirefox,
} from '../lib/proxy';
import { updateBadge } from '~/lib/badge';
import { refreshWebRtcSetting, detectWebRtcLeak } from '../lib/webrtc';
import { scanRecommendations } from '../lib/recommendations';

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
  const { settings, servers } = state;
  let randomTarget = null;
  if (settings.mode === 'random') {
    const chosen = pickRandomServer(servers);
    randomTarget = chosen ? targetFromServer(chosen) : null;
  }
  const rules = buildRulesFromSettings(settings, servers, randomTarget);
  if (settings.mode === 'direct' && rules.domainRules.length === 0) {
    await clearProxyRules();
  } else {
    await setProxyRules(rules);
  }
  await updateBadge(settings);
}

async function hydrate(): Promise<void> {
  const [settings, servers] = await Promise.all([
    settingsStore.get(),
    getServersWithCache(),
  ]);
  state = { settings, servers };
  await pushCurrentRules();
  await refreshWebRtcSetting(settings.webRtcEnabled, settings.webRtcDisableApplied);
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async () => {
    await hydrate();
    await scanRecommendations();
  });

  browser.runtime.onStartup.addListener(async () => {
    await hydrate();
  });

  browser.runtime.onMessage.addListener((message: unknown, _sender: unknown) => {
    return handleMessage(message);
  });

  // Initial hydrate. Service workers may restart, so do this on every boot.
  hydrate().catch((err) => {
    console.error('Initial hydrate failed:', err);
  });
});

interface MessageMap {
  'settings/get': undefined;
  'settings/patch': Partial<PersistedSettings>;
  'servers/refresh': undefined;
  'connection/status': undefined;
  'webrtc/leakCheck': undefined;
  'webrtc/toggle': { enabled: boolean };
  'history/get': undefined;
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
      return (await settingsStore.get());
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
    case 'servers/refresh': {
      const servers = await getServersWithCache(true);
      if (state) state.servers = servers;
      await pushCurrentRules();
      return { count: servers.length, fetchedAt: (await serverCacheStore.get())?.fetchedAt };
    }
    case 'connection/status': {
      try {
        return { ok: true, status: await getConnectionStatus() };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    }
    case 'webrtc/leakCheck': {
      return { ok: true, supported: true, ...(await detectWebRtcLeak()) };
    }
    case 'webrtc/toggle': {
      const enabled = (msg.payload as { enabled: boolean }).enabled;
      if (!isFirefox && !enabled) {
        return { ok: false, reason: 'unsupported' };
      }
      const next = await settingsStore.patch({
        webRtcEnabled: enabled,
        webRtcDisableApplied: !enabled && isFirefox,
      });
      if (state) state.settings = next;
      await refreshWebRtcSetting(next.webRtcEnabled, next.webRtcDisableApplied);
      return { ok: true, applied: next.webRtcDisableApplied };
    }
    case 'history/get': {
      return await historyStore.getAll();
    }
    case 'history/clear': {
      await historyStore.clear();
      return { ok: true };
    }
    case 'rules/current': {
      if (!state) return null;
      return buildRulesFromSettings(
        state.settings,
        state.servers,
        state.settings.mode === 'random'
          ? (pickRandomServer(state.servers) ? targetFromServer(pickRandomServer(state.servers)!) : null)
          : null,
      );
    }
    default:
      return { error: `unknown message: ${msg.type}` };
  }
}
