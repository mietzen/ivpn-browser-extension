/**
 * Cross-browser proxy facade. UI code calls this — it doesn't know which
 * browser it's on. Per PLAN.md §4.
 */

import { browser } from 'wxt/browser';
import * as firefoxImpl from './firefox';
import * as chromeImpl from './chrome';
import type { ProxyRules } from './rules';

export const isFirefox = (() => {
  try {
    return typeof browser !== 'undefined' && typeof browser.runtime !== 'undefined' &&
      // The webextension-polyfill exposes both, but only Firefox has
      // browser.proxy.onRequest as an Event.
      typeof (browser as { proxy?: { onRequest?: unknown } }).proxy?.onRequest !== 'undefined';
  } catch {
    return false;
  }
})();

export async function setProxyRules(rules: ProxyRules): Promise<void> {
  if (isFirefox) {
    await firefoxImpl.setProxyRules(rules);
  } else {
    await chromeImpl.setProxyRules(rules);
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
