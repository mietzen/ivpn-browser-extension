/**
 * Typed message protocol between the UI controllers and the background
 * service worker. MessageMap is the single source of truth for the
 * interface; the background handler and the popup/options controllers
 * both type against it. sendMessage is the only transport helper —
 * controllers no longer build { type, payload } objects by hand.
 */

import { browser } from 'wxt/browser';
import type { IvpnGeoLookup, IvpnServer } from './ivpn/types';
import type { GlobalProxy, ProxyRules, RuleTarget } from './proxy/rules';
import type { PersistedSettings, ServerHistoryEntry } from './storage';
import type { LeakCheckResult } from './webrtc';

export interface MessageMap {
  'settings/get': { request: undefined; response: PersistedSettings };
  'settings/setGlobal': { request: { global: GlobalProxy }; response: PersistedSettings };
  'rules/add': {
    request: { pattern: string; target: RuleTarget; proxyDns: boolean; disabled: boolean };
    response: PersistedSettings;
  };
  'rules/remove': { request: { pattern: string }; response: PersistedSettings };
  'exclusions/add': { request: { pattern: string }; response: PersistedSettings };
  'exclusions/remove': { request: { pattern: string }; response: PersistedSettings };
  'servers/refresh': { request: undefined; response: { servers: IvpnServer[]; count: number; fetchedAt: number | undefined } };
  'servers/list': { request: undefined; response: IvpnServer[] };
  'connection/status': { request: undefined; response: { ok: boolean; status?: IvpnGeoLookup; error?: string } };
  'tabs/active': { request: undefined; response: { host: string | null } };
  'webrtc/leakCheck': { request: undefined; response: { ok: boolean; supported: boolean } & LeakCheckResult };
  'webrtc/toggle': { request: { enabled: boolean }; response: { ok: boolean; applied: boolean; reason?: string } };
  'history/get': { request: undefined; response: Record<string, ServerHistoryEntry> };
  'history/recordUse': { request: { gateway: string }; response: { ok: boolean } };
  'history/clear': { request: undefined; response: { ok: boolean } };
  'rules/current': { request: undefined; response: ProxyRules | null };
}

export async function sendMessage<K extends keyof MessageMap>(
  type: K,
  payload?: MessageMap[K]['request'],
): Promise<MessageMap[K]['response']> {
  return (await browser.runtime.sendMessage({ type, payload })) as MessageMap[K]['response'];
}

export async function loadSettings(): Promise<PersistedSettings> {
  return sendMessage('settings/get');
}

export async function loadServers(): Promise<IvpnServer[]> {
  try {
    const res = await sendMessage('servers/refresh');
    return res.servers ?? [];
  } catch {
    return [];
  }
}
