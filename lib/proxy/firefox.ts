/**
 * Firefox proxy handler. Uses browser.proxy.onRequest to evaluate each
 * request against the current ruleset and pick a target.
 */

import { browser } from 'wxt/browser';
import type { IvpnServer } from '../ivpn/types';
import { parseSocks5Endpoint } from '../ivpn/client';
import type { GlobalProxy, ProxyRules, RuleTarget, Socks5Endpoint } from './rules';
import { resolveRuleTarget, findRuleForHost } from './rules';
import { patternMatches } from './pattern';

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

export interface ResolveContext {
  rules: ProxyRules;
  servers: IvpnServer[];
}

let currentContext: ResolveContext | null = null;
let listenerRegistered = false;

function randomServer(ctx: ResolveContext): { endpoint: Socks5Endpoint; label: string } | null {
  const eligible = ctx.servers.filter((s) => s.is_active && !s.in_maintenance);
  if (eligible.length === 0) return null;
  const server = eligible[Math.floor(Math.random() * eligible.length)]!;
  return { endpoint: parseSocks5Endpoint(server), label: server.gateway };
}

function resolveEndpoint(target: RuleTarget, ctx: ResolveContext): { endpoint: Socks5Endpoint; label: string } | null {
  if (target.kind === 'direct') return null;
  if (target.kind === 'socks5') return { endpoint: target.endpoint, label: target.label };
  if (target.kind === 'random') return randomServer(ctx);
  if (target.kind === 'global') {
    if (ctx.rules.global.kind === 'socks5') {
      return { endpoint: ctx.rules.global.endpoint, label: ctx.rules.global.label };
    }
    return null;
  }
  return null;
}

async function handleRequest(details: ProxyRequestDetails): Promise<ProxyInfo> {
  if (!currentContext) return { type: 'direct' };
  let host: string;
  try {
    host = new URL(details.url).hostname;
  } catch {
    return { type: 'direct' };
  }
  if (!host) return { type: 'direct' };

  const target = resolveRuleTarget(host, currentContext.rules);
  const resolved = resolveEndpoint(target, currentContext);
  if (!resolved) return { type: 'direct' };

  const rule = findRuleForHost(host, currentContext.rules.domainRules);
  const proxyDns = rule ? rule.proxyDns : false;

  return {
    type: 'socks',
    host: resolved.endpoint.host,
    port: resolved.endpoint.port,
    proxyDNS: proxyDns,
  };
}

export function setResolveContext(ctx: ResolveContext): void {
  currentContext = ctx;
}

export async function setProxyRules(rules: ProxyRules, servers: IvpnServer[]): Promise<void> {
  currentContext = {
    rules,
    servers,
  };
  if (!listenerRegistered) {
    const proxyApi = browser.proxy as unknown as {
      onRequest: { addListener: (cb: OnRequestCallback, filter?: unknown, extraInfo?: string[]) => void };
    };
    proxyApi.onRequest.addListener(handleRequest, { urls: ['<all_urls>'] });
    listenerRegistered = true;
  }
}

export async function clearProxyRules(): Promise<void> {
  currentContext = null;
  if (listenerRegistered) {
    const proxyApi = browser.proxy as unknown as {
      onRequest: { removeListener: (cb: OnRequestCallback) => void };
    };
    proxyApi.onRequest.removeListener(handleRequest);
    listenerRegistered = false;
  }
}

export { patternMatches };
export type { GlobalProxy };
