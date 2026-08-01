/**
 * Proxy rules — the unified model both Firefox and Chrome implementations
 * must satisfy.
 *
 * v2 model (storage):
 *   - `ProxyMode` for the global default is gone. Global is now a single
 *     discriminated value: either `direct` or a specific SOCKS5 endpoint.
 *   - `DomainRule` uses `pattern` (any host pattern including wildcards
 *     and CIDR) and a `target` that can be `direct`, `global`, `random`,
 *     or a specific SOCKS5 endpoint.
 *   - Resolution: exclusion > first matching rule > global default.
 *   - `random` rules rotate per request through active servers.
 */

import type { IvpnServer } from '../ivpn/types';
import { parseSocks5Endpoint } from '../ivpn/client';
import { patternMatches } from './pattern';

export interface Socks5Endpoint {
  host: string;
  port: number;
}

export type GlobalProxy =
  | { kind: 'direct' }
  | { kind: 'random' }
  | { kind: 'socks5'; endpoint: Socks5Endpoint; label: string };

export type RuleTarget =
  | { kind: 'direct' }
  | { kind: 'global' }
  | { kind: 'random' }
  | { kind: 'socks5'; endpoint: Socks5Endpoint; label: string };

export interface DomainRule {
  pattern: string;
  target: RuleTarget;
  disabled: boolean;
  proxyDns: boolean;
}

export interface ProxyRules {
  global: GlobalProxy;
  domainRules: DomainRule[];
  exclusions: string[];
}

export const DIRECT_GLOBAL: GlobalProxy = { kind: 'direct' };
export const DIRECT_TARGET: RuleTarget = { kind: 'direct' };

export function targetFromServer(server: IvpnServer): RuleTarget {
  return {
    kind: 'socks5',
    endpoint: parseSocks5Endpoint(server),
    label: server.gateway,
  };
}

export function emptyRules(): ProxyRules {
  return {
    global: DIRECT_GLOBAL,
    domainRules: [],
    exclusions: [],
  };
}

export function isExcluded(host: string, exclusions: string[]): boolean {
  return exclusions.some((e) => patternMatches(host, e));
}

export function findRuleForHost(host: string, rules: DomainRule[]): DomainRule | undefined {
  return rules.find((r) => !r.disabled && patternMatches(host, r.pattern));
}

/**
 * Resolve the effective proxy target for a host. Order:
 *   1. exclusion list → direct
 *   2. first matching rule → use its target
 *   3. global default
 *   4. fallback → direct
 *
 * Caller resolves `kind: 'random'` and `kind: 'socks5'` against the
 * active server list. `kind: 'global'` and `kind: 'direct'` need no
 * further resolution.
 */
export function resolveRuleTarget(host: string, rules: ProxyRules): RuleTarget {
  if (isExcluded(host, rules.exclusions)) return DIRECT_TARGET;
  const rule = findRuleForHost(host, rules.domainRules);
  if (rule) return rule.target;
  if (rules.global.kind === 'socks5') {
    return { kind: 'socks5', endpoint: rules.global.endpoint, label: rules.global.label };
  }
  if (rules.global.kind === 'random') {
    return { kind: 'random' };
  }
  return DIRECT_TARGET;
}

export function labelForGlobal(global: GlobalProxy): string {
  if (global.kind === 'direct') return 'Direct';
  if (global.kind === 'random') return 'Random';
  return global.label;
}
