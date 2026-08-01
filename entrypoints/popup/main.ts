/**
 * Popup UI controller. Two sections (Global, Current Website) each
 * use a ServerCombobox. The current tab's host is fetched via the
 * background; on save, a per-domain rule is upserted in storage.
 */

import { browser } from 'wxt/browser';
import type { IvpnServer } from '~/lib/ivpn/types';
import { parseSocks5Endpoint } from '~/lib/ivpn/client';
import type { RuleTarget } from '~/lib/proxy/rules';
import type { PersistedSettings, ServerHistoryEntry } from '~/lib/storage';
import { sendMessage, loadSettings, loadServers } from '~/lib/messages';
import {
  ServerCombobox,
  SPECIAL_VALUES,
  buildGlobalOptions,
  buildCurrentSiteOptions,
} from '~/lib/ui/server-combobox';

interface StatusEl {
  panel: HTMLElement;
  headline: HTMLElement;
  ipRow: HTMLElement;
  ip: HTMLElement;
  locRow: HTMLElement;
  loc: HTMLElement;
  sep: HTMLElement;
  sep2: HTMLElement;
  tunnelRow: HTMLElement;
  tunnel: HTMLElement;
  refresh: HTMLButtonElement;
}

const status = (() => {
  const panel = document.getElementById('status-panel') as HTMLElement;
  return {
    panel,
    headline: document.getElementById('status-headline') as HTMLElement,
    ipRow: document.getElementById('status-ip-row') as HTMLElement,
    ip: document.getElementById('status-ip') as HTMLElement,
    locRow: document.getElementById('status-loc-row') as HTMLElement,
    loc: document.getElementById('status-loc') as HTMLElement,
    sep: document.getElementById('status-sep') as HTMLElement,
    sep2: document.getElementById('status-sep2') as HTMLElement,
    tunnelRow: document.getElementById('status-tunnel-row') as HTMLElement,
    tunnel: document.getElementById('status-tunnel') as HTMLElement,
    refresh: document.getElementById('status-refresh') as HTMLButtonElement,
  } satisfies StatusEl;
})();

const els = {
  openOptions: document.getElementById('open-options') as HTMLButtonElement,
  currentHost: document.getElementById('current-host') as HTMLElement,
};

let currentSettings: PersistedSettings | null = null;
let allServers: IvpnServer[] = [];
let currentTabHost: string | null = null;

const globalCombo = new ServerCombobox();
const currentSiteCombo = new ServerCombobox();
document.getElementById('global-combobox')!.appendChild(globalCombo.element);
document.getElementById('current-site-combobox')!.appendChild(currentSiteCombo.element);

async function getActiveTabHost(): Promise<string | null> {
  const res = await sendMessage('tabs/active');
  return res.host;
}

function setStatus(
  state: 'checking' | 'vpn' | 'no-vpn' | 'error',
  headline: string,
  ip?: string,
  location?: string,
  tunnel?: string,
): void {
  status.panel.dataset.state = state;
  status.headline.textContent = headline;

  const hasIp = !!ip;
  const hasLoc = !!location;
  const hasTunnel = !!tunnel;

  status.ipRow.hidden = !hasIp;
  if (hasIp) status.ip.textContent = ip!;
  status.sep.hidden = !(hasIp && hasLoc);
  status.locRow.hidden = !hasLoc;
  if (hasLoc) status.loc.textContent = location!;
  status.sep2.hidden = !(hasLoc && hasTunnel);
  status.tunnelRow.hidden = !hasTunnel;
  if (hasTunnel) status.tunnel.textContent = tunnel!;
}

async function refreshStatus(): Promise<void> {
  setStatus('checking', 'Checking…');
  const res = await sendMessage('connection/status');
  if (!res.ok || !res.status) {
    setStatus('error', res.error ?? 'Unavailable');
    return;
  }
  const s = res.status;
  if (s.isIvpnServer) {
    setStatus('vpn', 'Connected via IVPN', s.ip_address, `${s.country} · ${s.city}`, 'Active');
  } else {
    setStatus('no-vpn', 'Not connected to IVPN', s.ip_address, `${s.country} · ${s.city}`);
  }
}

function reloadComboboxes(history: Record<string, ServerHistoryEntry>): void {
  if (!currentSettings) return;

  const global = currentSettings.global;
  const currentGlobalValue =
    global.kind === 'direct'
      ? SPECIAL_VALUES.globalDirect
      : global.kind === 'random'
        ? SPECIAL_VALUES.globalRandom
        : SPECIAL_VALUES.globalSocks5;
  globalCombo.setOptions({
    options: buildGlobalOptions(global),
    history,
    servers: allServers,
    placeholder: 'Direct',
    emptyText: 'No servers available',
    onSelect: (value) => {
      if (value === SPECIAL_VALUES.globalDirect || value === SPECIAL_VALUES.globalRandom) {
        void onGlobalSelect(value, history);
      } else {
        void pickGlobalServer(value);
      }
    },
    onOpenChange: (open) => toggleComboboxOpen(open),
  });
  globalCombo.setValue(currentGlobalValue);

  let currentTargetValue: string;
  const existingRule = currentTabHost
    ? currentSettings.domainRules.find((r) => r.pattern === currentTabHost)
    : undefined;

  if (existingRule) {
    switch (existingRule.target.kind) {
      case 'direct': currentTargetValue = SPECIAL_VALUES.siteDirect; break;
      case 'random': currentTargetValue = SPECIAL_VALUES.siteRandom; break;
      case 'global': currentTargetValue = SPECIAL_VALUES.siteInherit; break;
      case 'socks5': currentTargetValue = existingRule.target.label; break;
    }
  } else {
    currentTargetValue = SPECIAL_VALUES.siteInherit;
  }

  currentSiteCombo.setOptions({
    options: buildCurrentSiteOptions(global),
    history,
    servers: allServers,
    placeholder: 'Inherit from global',
    emptyText: 'No servers available',
    onSelect: (value) => void onCurrentSiteSelect(value),
    onOpenChange: (open) => toggleComboboxOpen(open),
  });
  currentSiteCombo.setValue(currentTargetValue);
}

async function onGlobalSelect(value: string, history: Record<string, ServerHistoryEntry>): Promise<void> {
  if (!currentSettings) return;
  let global: PersistedSettings['global'];
  if (value === SPECIAL_VALUES.globalDirect) {
    global = { kind: 'direct' };
  } else if (value === SPECIAL_VALUES.globalRandom) {
    global = { kind: 'random' };
  } else {
    // 'global:socks5' means "let me pick". Open the popover to pick.
    // When user picks a server, we receive its gateway value.
    return;
  }
  await applyGlobal(global);
  reloadComboboxes(history);
}

async function pickGlobalServer(gateway: string): Promise<void> {
  if (!currentSettings) return;
  const server = allServers.find((s) => s.gateway === gateway);
  if (!server) return;
  await applyGlobal({ kind: 'socks5', endpoint: parseSocks5Endpoint(server), label: server.gateway });
  await sendMessage('history/recordUse', { gateway });
  const updated = await sendMessage('history/get');
  if (!currentSettings) return;
  reloadComboboxes(updated);
}

/**
 * Persist a new global proxy. Per-site rules are left untouched so the
 * Current Website field keeps its explicit choice instead of silently
 * reverting to "Inherit from global".
 */
async function applyGlobal(global: PersistedSettings['global']): Promise<void> {
  if (!currentSettings) return;
  currentSettings = await sendMessage('settings/setGlobal', { global });
}

function toggleComboboxOpen(open: boolean): void {
  document.documentElement.classList.toggle('combobox-open', open);
}

async function onCurrentSiteSelect(value: string): Promise<void> {
  if (!currentTabHost || !currentSettings) return;

  if (value === SPECIAL_VALUES.siteInherit) {
    currentSettings = await sendMessage('rules/remove', { pattern: currentTabHost });
    return;
  }
  const target = ruleTargetFromValue(value);
  if (!target) return;
  currentSettings = await sendMessage('rules/add', {
    pattern: currentTabHost,
    target,
    proxyDns: false,
    disabled: false,
  });
}

function ruleTargetFromValue(
  value: string,
): RuleTarget | null {
  if (value === SPECIAL_VALUES.siteDirect) return { kind: 'direct' };
  if (value === SPECIAL_VALUES.siteRandom) return { kind: 'random' };
  const server = allServers.find((s) => s.gateway === value);
  if (!server) return null;
  return { kind: 'socks5', endpoint: parseSocks5Endpoint(server), label: server.gateway };
}

async function openOptions(): Promise<void> {
  try {
    await browser.runtime.openOptionsPage();
  } catch (err) {
    console.error('openOptionsPage failed:', err);
  }
}

async function init(): Promise<void> {
  currentSettings = await loadSettings();
  const [history, tabHost] = await Promise.all([
    sendMessage('history/get'),
    getActiveTabHost(),
  ]);
  currentTabHost = tabHost;
  if (currentTabHost) {
    els.currentHost.textContent = `(${currentTabHost})`;
  } else {
    els.currentHost.textContent = '(no active page)';
  }

  allServers = await loadServers();

  globalCombo.element.addEventListener('click', (e) => {
    if (e.target instanceof HTMLElement && e.target.closest('.combobox-server')) return;
  });

  // Wire up the global combobox so picking a server (not the special
  // 'Direct' option) sets the global gateway.
  globalCombo.setOptions({
    options: [],
    history,
    servers: allServers,
    placeholder: 'Direct',
    emptyText: 'No servers available',
    onSelect: (value) => {
      if (value === SPECIAL_VALUES.globalDirect || value === SPECIAL_VALUES.globalRandom) {
        void onGlobalSelect(value, history);
      } else {
        // Picked a server from the popover list
        void pickGlobalServer(value);
      }
    },
    onOpenChange: (open) => toggleComboboxOpen(open),
  });

  currentSiteCombo.setOptions({
    options: [],
    history,
    servers: allServers,
    placeholder: 'Inherit from global',
    emptyText: 'No servers available',
    onSelect: (value) => void onCurrentSiteSelect(value),
    onOpenChange: (open) => toggleComboboxOpen(open),
  });

  reloadComboboxes(history);

  els.openOptions.addEventListener('click', () => {
    openOptions().catch((err) => console.error(err));
  });
  status.refresh.addEventListener('click', () => {
    refreshStatus().catch((err) => console.error(err));
  });

  refreshStatus().catch((err) => console.error(err));
}

init().catch((err) => {
  console.error('Popup init failed:', err);
});
