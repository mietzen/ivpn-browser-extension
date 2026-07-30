/**
 * Firefox proxy implementation — uses browser.proxy.onRequest.
 *
 * Per PLAN.md §4, request host is matched against the domain map (exact host
 * first, then parent-domain fallback). Exclusions are checked first.
 */

import { browser } from 'wxt/browser';
import type { ProxyRules } from './rules';
import { findRuleForHost, isExcluded, resolveTarget } from './rules';

type ProxyRequest = {
  tabId: number;
  url: string;
  documentUrl?: string;
  originUrl?: string;
  tab?: { url?: string; incognito?: boolean };
};

type ProxyInfo = {
  type: 'direct' | 'http' | 'https' | 'socks' | 'socks4';
  host?: string;
  port?: number;
  username?: string;
  proxyDNS?: boolean;
  failoverProxy?: ProxyInfo;
};

type ProxyRequestDetails = ProxyRequest & { requestId: string };
type OnRequestCallback = (details: ProxyRequestDetails) => Promise<ProxyInfo> | ProxyInfo;

let currentRules: ProxyRules | null = null;
let listenerRegistered = false;

async function handleRequest(details: ProxyRequestDetails): Promise<ProxyInfo> {
  if (!currentRules) return { type: 'direct' };
  let host: string;
  try {
    host = new URL(details.url).hostname;
  } catch {
    return { type: 'direct' };
  }
  if (!host) return { type: 'direct' };

  if (isExcluded(host, currentRules.exclusions)) {
    return { type: 'direct' };
  }

  const rule = findRuleForHost(host, currentRules.domainRules);
  let target;
  let proxyDns = false;
  if (rule) {
    target = rule.endpoint ? { endpoint: rule.endpoint, label: rule.label } : { endpoint: null, label: 'Direct' };
    proxyDns = rule.proxyDns;
  } else {
    target = resolveTarget(host, currentRules);
  }

  if (!target.endpoint) return { type: 'direct' };
  return {
    type: 'socks',
    host: target.endpoint.host,
    port: target.endpoint.port,
    proxyDNS: proxyDns,
  };
}

export async function setProxyRules(rules: ProxyRules): Promise<void> {
  currentRules = rules;
  if (!listenerRegistered) {
    const proxyApi = browser.proxy as unknown as {
      onRequest: { addListener: (cb: OnRequestCallback, filter?: unknown, extraInfo?: string[]) => void };
    };
    proxyApi.onRequest.addListener(handleRequest, { urls: ['<all_urls>'] });
    listenerRegistered = true;
  }
}

export async function clearProxyRules(): Promise<void> {
  currentRules = null;
  if (listenerRegistered) {
    const proxyApi = browser.proxy as unknown as {
      onRequest: { removeListener: (cb: OnRequestCallback) => void };
    };
    proxyApi.onRequest.removeListener(handleRequest);
    listenerRegistered = false;
  }
}
