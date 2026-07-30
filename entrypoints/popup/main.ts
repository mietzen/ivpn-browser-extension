/**
 * Popup UI controller. Talks to the background via runtime.sendMessage.
 * No business logic here beyond view state + delegation to background.
 */

import { browser } from 'wxt/browser';
import type { IvpnServer } from '~/lib/ivpn/types';
import { groupActiveServers, searchGroups, type ServerGroup } from '~/lib/ivpn/grouping';
import type { PersistedSettings, ServerHistoryEntry } from '~/lib/storage';

type Mode = 'direct' | 'global' | 'random';

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
  modeButtons: document.querySelectorAll<HTMLButtonElement>('.mode-btn'),
  pickerSearch: document.getElementById('picker-search') as HTMLInputElement,
  pickerList: document.getElementById('picker-list') as HTMLDivElement,
  historySection: document.getElementById('history-section') as HTMLElement,
  historyList: document.getElementById('history-list') as HTMLDivElement,
};

interface ServersResponse {
  ok: boolean;
  servers?: IvpnServer[];
  error?: string;
}

let currentSettings: PersistedSettings | null = null;
let allServers: IvpnServer[] = [];

async function sendMessage<T = unknown>(type: string, payload?: unknown): Promise<T> {
  return (await browser.runtime.sendMessage({ type, payload })) as T;
}

async function loadSettings(): Promise<PersistedSettings> {
  return sendMessage<PersistedSettings>('settings/get');
}

async function loadServers(): Promise<IvpnServer[]> {
  try {
    const cache = await sendMessage<{ servers?: IvpnServer[]; error?: string }>('servers/refresh');
    if ('error' in cache) return [];
    return (cache as unknown as ServersResponse).servers ?? [];
  } catch {
    return [];
  }
}

async function patchSettings(patch: Partial<PersistedSettings>): Promise<PersistedSettings> {
  return sendMessage<PersistedSettings>('settings/patch', patch);
}

function setStatus(state: 'checking' | 'vpn' | 'no-vpn' | 'error', headline: string, ip?: string, location?: string, tunnel?: string): void {
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
  const res = await sendMessage<{
    ok: boolean;
    status?: { ip_address: string; country: string; city: string; country_code: string; isIvpnServer: boolean };
    error?: string;
  }>('connection/status');
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

function renderModeButtons(mode: Mode | 'custom'): void {
  els.modeButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}

function renderPicker(groups: ServerGroup[], selectedGateway: string | null): void {
  els.pickerList.innerHTML = '';
  if (groups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'picker-server';
    empty.textContent = 'No servers match.';
    empty.style.color = 'var(--fg-faint)';
    els.pickerList.appendChild(empty);
    return;
  }
  for (const group of groups) {
    const wrap = document.createElement('div');
    wrap.className = 'picker-group';

    const country = document.createElement('div');
    country.className = 'picker-country';
    country.textContent = `${group.country} (${group.countryCode})`;
    wrap.appendChild(country);

    for (const city of group.cities) {
      const cityEl = document.createElement('div');
      cityEl.className = 'picker-city';
      cityEl.textContent = city.city;
      wrap.appendChild(cityEl);

      for (const server of city.servers) {
        const row = document.createElement('div');
        row.className = 'picker-server';
        if (server.gateway === selectedGateway) row.classList.add('selected');
        row.dataset.gateway = server.gateway;
        row.setAttribute('role', 'option');

        const left = document.createElement('span');
        left.textContent = server.gateway;
        const right = document.createElement('span');
        right.className = 'load';
        // IVPN API returns `load` as a percentage (e.g. 25.96), not a
        // ratio. Display as-is with one decimal place.
        right.textContent = `${server.load.toFixed(1)}%`;
        row.appendChild(left);
        row.appendChild(right);
        row.addEventListener('click', () => onPickServer(server.gateway));
        cityEl.appendChild(row);
      }
    }
    els.pickerList.appendChild(wrap);
  }
}

function renderHistory(history: Record<string, ServerHistoryEntry>, servers: IvpnServer[]): void {
  const entries = Object.values(history).sort((a, b) => b.lastUsed - a.lastUsed).slice(0, 5);
  if (entries.length === 0) {
    els.historySection.hidden = true;
    return;
  }
  els.historySection.hidden = false;
  els.historyList.innerHTML = '';
  for (const entry of entries) {
    const server = servers.find((s) => s.gateway === entry.gateway);
    if (!server) continue;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'history-chip';
    chip.textContent = server.gateway;
    chip.title = `${server.city} · ${server.load.toFixed(1)}%`;
    chip.addEventListener('click', () => onPickServer(server.gateway));
    els.historyList.appendChild(chip);
  }
}

function applySearch(query: string, selectedGateway: string | null): void {
  const groups = groupActiveServers(allServers);
  const filtered = searchGroups(groups, query);
  renderPicker(filtered, selectedGateway);
}

async function onPickServer(gateway: string): Promise<void> {
  currentSettings = await patchSettings({ mode: 'global', globalGateway: gateway });
  await sendMessage('history/recordUse', { gateway });
  const history = await sendMessage<Record<string, ServerHistoryEntry>>('history/get');
  renderHistory(history, allServers);
  renderModeButtons(currentSettings.mode);
  applySearch(els.pickerSearch.value, currentSettings.globalGateway);
}

async function onModeChange(mode: Mode | 'custom'): Promise<void> {
  currentSettings = await patchSettings({ mode });
  renderModeButtons(mode);
  applySearch(els.pickerSearch.value, currentSettings.globalGateway);
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
  allServers = await loadServers();
  const history = await sendMessage<Record<string, ServerHistoryEntry>>('history/get');

  renderModeButtons(currentSettings.mode);
  applySearch('', currentSettings.globalGateway);
  renderHistory(history, allServers);

  els.modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => onModeChange(btn.dataset.mode as Mode));
  });
  els.pickerSearch.addEventListener('input', () => {
    applySearch(els.pickerSearch.value, currentSettings?.globalGateway ?? null);
  });
  status.refresh.addEventListener('click', () => {
    refreshStatus().catch((err) => console.error(err));
  });
  els.openOptions.addEventListener('click', () => {
    openOptions().catch((err) => console.error(err));
  });

  refreshStatus().catch((err) => console.error(err));
}

init().catch((err) => {
  console.error('Popup init failed:', err);
});
