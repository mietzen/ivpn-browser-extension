/**
 * Toolbar badge — on/off state and current location code.
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

  let text = '';
  let color = INACTIVE_COLOR;

  if (settings.mode === 'direct' && settings.domainRules.length === 0) {
    text = '';
    color = INACTIVE_COLOR;
  } else if (settings.mode === 'random') {
    text = 'R';
    color = ACTIVE_COLOR;
  } else if (settings.globalGateway) {
    text = settings.globalGateway.slice(0, 4).toUpperCase();
    color = ACTIVE_COLOR;
  } else {
    text = 'ON';
    color = ACTIVE_COLOR;
  }

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
