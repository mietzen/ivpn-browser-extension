/**
 * Domain-keyed proxy rules — the unified model that both Firefox and Chrome
 * implementations must satisfy.
 *
 * Per PLAN.md §4, this is a plain host→config map. The "tabs" permission is
 * only used to look up which domain the active tab is on, to prefill UI.
 */

import type { IvpnServer } from '../ivpn/types';
import { parseSocks5Endpoint } from '../ivpn/client';

export type ProxyMode = 'direct' | 'global' | 'random' | 'custom';

export interface Socks5Endpoint {
  host: string;
  port: number;
}

export interface ProxyTarget {
  /** Either a specific server (with full SOCKS5 endpoint resolved) or null. */
  endpoint: Socks5Endpoint | null;
  /** Display label for the target — gateway code or "Direct" or "Random". */
  label: string;
}

export interface DomainRule {
  /** Domain string. Matched as exact host or as a parent domain of a subdomain. */
  domain: string;
  endpoint: Socks5Endpoint | null;
  label: string;
  /** When true, the rule is ignored at lookup time. */
  disabled: boolean;
  /** When true, DNS for this host also goes through the SOCKS5 proxy (SOCKS5h-style). */
  proxyDns: boolean;
}

export interface ProxyRules {
  mode: ProxyMode;
  /** Resolved global target — what gets used when a request doesn't match any domain rule. */
  globalTarget: ProxyTarget;
  /** Per-host overrides. Matched in order: exact host first, then parent-domain fallback. */
  domainRules: DomainRule[];
  /** Hosts that must never go through the proxy, regardless of any other rule. */
  exclusions: string[];
  /** Pre-resolved random target (chosen at toggle-time, not per-request). */
  randomTarget: ProxyTarget | null;
}

export const DIRECT_TARGET: ProxyTarget = { endpoint: null, label: 'Direct' };

export function targetFromServer(server: IvpnServer): ProxyTarget {
  return {
    endpoint: parseSocks5Endpoint(server),
    label: server.gateway,
  };
}

export function emptyRules(): ProxyRules {
  return {
    mode: 'direct',
    globalTarget: DIRECT_TARGET,
    domainRules: [],
    exclusions: [],
    randomTarget: null,
  };
}

/**
 * Returns true if `host` matches `domain` either as an exact match or as a
 * subdomain of `domain` (e.g. host "www.example.com" matches domain
 * "example.com"). Case-insensitive. Trailing dots ignored.
 */
export function hostMatchesDomain(host: string, domain: string): boolean {
  const h = host.toLowerCase().replace(/\.+$/, '');
  const d = domain.toLowerCase().replace(/\.+$/, '');
  if (!h || !d) return false;
  return h === d || h.endsWith(`.${d}`);
}

export function isExcluded(host: string, exclusions: string[]): boolean {
  return exclusions.some((e) => hostMatchesDomain(host, e));
}

export function findRuleForHost(
  host: string,
  rules: DomainRule[],
): DomainRule | undefined {
  const exact = rules.find((r) => !r.disabled && r.domain.toLowerCase() === host.toLowerCase());
  if (exact) return exact;
  return rules.find((r) => !r.disabled && hostMatchesDomain(host, r.domain));
}

/**
 * Resolve the effective proxy target for a given host according to the rules.
 * Order: exclusion list > per-domain rule > global target.
 */
export function resolveTarget(host: string, rules: ProxyRules): ProxyTarget {
  if (isExcluded(host, rules.exclusions)) return DIRECT_TARGET;
  const rule = findRuleForHost(host, rules.domainRules);
  if (rule) {
    return { endpoint: rule.endpoint, label: rule.label };
  }
  if (rules.mode === 'direct') return DIRECT_TARGET;
  if (rules.mode === 'random') return rules.randomTarget ?? DIRECT_TARGET;
  return rules.globalTarget;
}
