/**
 * Cross-browser proxy facade. UI code calls this — it doesn't know
 * which browser it's on.
 */

import { browser } from 'wxt/browser';
import * as firefoxImpl from './firefox';
import * as chromeImpl from './chrome';
import type { IvpnServer } from '../ivpn/types';
import { parseSocks5Endpoint } from '../ivpn/client';
import { isEligibleServer } from '../ivpn/grouping';
import type { ProxyRules, Socks5Endpoint } from './rules';

export const isFirefox = (() => {
  try {
    return typeof browser !== 'undefined' &&
      typeof browser.runtime !== 'undefined' &&
      typeof (browser as { proxy?: { onRequest?: unknown } }).proxy?.onRequest !== 'undefined';
  } catch {
    return false;
  }
})();

function randomPool(servers: IvpnServer[]): Socks5Endpoint[] {
  return servers.filter(isEligibleServer).map(parseSocks5Endpoint);
}

export async function setProxyRules(rules: ProxyRules, servers: IvpnServer[]): Promise<void> {
  if (isFirefox) {
    await firefoxImpl.setProxyRules(rules, servers);
  } else {
    await chromeImpl.setProxyRules(rules, randomPool(servers));
  }
}

export async function clearProxyRules(): Promise<void> {
  if (isFirefox) {
    await firefoxImpl.clearProxyRules();
  } else {
    await chromeImpl.clearProxyRules();
  }
}

export { generatePacScript } from './chrome';
export * from './rules';
export { patternMatches } from './pattern';
