/**
 * Toolbar badge. v2 model: badge reflects the global proxy state.
 *   - global.direct  → empty badge, inactive color
 *   - global.socks5  → gateway code, active color
 *   - per-domain rules present (any non-inherit target) → show "R" or
 *     a count badge so the user knows at a glance that per-host
 *     overrides are active.
 */

import { browser } from 'wxt/browser';
import type { PersistedSettings } from '../storage';

const ACTIVE_COLOR = '#4f46e5';
const INACTIVE_COLOR = '#6b7280';
const ERROR_COLOR = '#dc2626';

export async function updateBadge(settings: PersistedSettings): Promise<void> {
  const actionApi = (browser.action ?? browser.browserAction) as {
    setBadgeText: (d: { text: string }) => Promise<void>;
    setBadgeBackgroundColor: (d: { color: string }) => Promise<void>;
  };

  let text: string;
  let color: string;

  if (settings.global.kind === 'socks5') {
    text = settings.global.label.slice(0, 4).toUpperCase();
    color = ACTIVE_COLOR;
  } else if (hasActiveOverride(settings)) {
    text = 'R';
    color = ACTIVE_COLOR;
  } else {
    text = '';
    color = INACTIVE_COLOR;
  }

  await actionApi.setBadgeBackgroundColor({ color });
  await actionApi.setBadgeText({ text });
}

function hasActiveOverride(settings: PersistedSettings): boolean {
  return settings.domainRules.some(
    (r) => !r.disabled && r.target.kind !== 'global',
  );
}

export async function showErrorBadge(message: string): Promise<void> {
  const actionApi = (browser.action ?? browser.browserAction) as {
    setBadgeText: (d: { text: string }) => Promise<void>;
    setBadgeBackgroundColor: (d: { color: string }) => Promise<void>;
  };
  await actionApi.setBadgeBackgroundColor({ color: ERROR_COLOR });
  await actionApi.setBadgeText({ text: message.slice(0, 4).toUpperCase() });
}
