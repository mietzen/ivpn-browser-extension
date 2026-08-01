/**
 * Toolbar badge. Reflects the effective proxy for the active tab:
 *   - direct  → empty badge, inactive color
 *   - socks5  → gateway code, active color
 *   - random  → "R", active color
 * When no web tab is active, falls back to the global default.
 */

import { browser } from 'wxt/browser';
import type { ProxyRules, RuleTarget } from '../proxy/rules';
import { resolveRuleTarget } from '../proxy/rules';

const ACTIVE_COLOR = '#4f46e5';
const INACTIVE_COLOR = '#6b7280';
const ERROR_COLOR = '#dc2626';

export interface BadgeState {
  text: string;
  color: string;
}

/**
 * Pure badge state for a host. Resolves the effective proxy target the
 * same way the proxy layer does (exclusion > rule > global), so the
 * badge always agrees with what traffic actually does. A null host
 * (extension page, non-http tab) falls back to the global default.
 */
export function badgeForHost(host: string | null, rules: ProxyRules): BadgeState {
  const target = host ? resolveRuleTarget(host, rules) : rules.global;
  return badgeForTarget(target, rules);
}

function badgeForTarget(target: RuleTarget, rules: ProxyRules): BadgeState {
  if (target.kind === 'socks5') {
    return { text: target.label.slice(0, 4).toUpperCase(), color: ACTIVE_COLOR };
  }
  if (target.kind === 'random') {
    return { text: 'R', color: ACTIVE_COLOR };
  }
  if (target.kind === 'global') {
    return badgeForTarget(rules.global, rules);
  }
  return { text: '', color: INACTIVE_COLOR };
}

export async function updateBadge(rules: ProxyRules, host: string | null): Promise<void> {
  const actionApi = (browser.action ?? browser.browserAction) as {
    setBadgeText: (d: { text: string }) => Promise<void>;
    setBadgeBackgroundColor: (d: { color: string }) => Promise<void>;
  };

  const { text, color } = badgeForHost(host, rules);

  await actionApi.setBadgeBackgroundColor({ color });
  await actionApi.setBadgeText({ text });
}

export async function showErrorBadge(message: string): Promise<void> {
  const actionApi = (browser.action ?? browser.browserAction) as {
    setBadgeText: (d: { text: string }) => Promise<void>;
    setBadgeBackgroundColor: (d: { color: string }) => Promise<void>;
  };
  await actionApi.setBadgeBackgroundColor({ color: ERROR_COLOR });
  await actionApi.setBadgeText({ text: message.slice(0, 4).toUpperCase() });
}
