/**
 * Options page controller. Tabs, per-domain rules, exclusions, privacy, backup.
 */

import { browser } from 'wxt/browser';
import type { IvpnServer } from '~/lib/ivpn/types';
import { groupActiveServers } from '~/lib/ivpn/grouping';
import { parseSocks5Endpoint } from '~/lib/ivpn/client';
import type { PersistedSettings, ExportPayload } from '~/lib/storage';
import { exportAll, importAll } from '~/lib/storage';
import type { DomainRule } from '~/lib/proxy/rules';
import { isWebRtcDisableSupported } from '~/lib/webrtc';
import { isHttpsOnlyAvailable, scanRecommendations } from '~/lib/recommendations';

type Mode = 'direct' | 'global' | 'random';

const els = {
  tabs: document.querySelectorAll<HTMLButtonElement>('.tab'),
  panels: document.querySelectorAll<HTMLElement>('.tab-panel'),
  modeRadios: document.querySelectorAll<HTMLInputElement>('input[name="mode"]'),
  globalServer: document.getElementById('global-server') as HTMLSelectElement,
  refreshServers: document.getElementById('refresh-servers') as HTMLButtonElement,
  ruleForm: document.getElementById('rule-form') as HTMLFormElement,
  ruleDomain: document.getElementById('rule-domain') as HTMLInputElement,
  ruleServer: document.getElementById('rule-server') as HTMLSelectElement,
  ruleDns: document.getElementById('rule-dns') as HTMLInputElement,
  ruleDisabled: document.getElementById('rule-disabled') as HTMLInputElement,
  ruleTableBody: document.querySelector<HTMLTableSectionElement>('#rule-table tbody'),
  exclusionForm: document.getElementById('exclusion-form') as HTMLFormElement,
  exclusionDomain: document.getElementById('exclusion-domain') as HTMLInputElement,
  exclusionList: document.getElementById('exclusion-list') as HTMLUListElement,
  webrtcSupport: document.getElementById('webrtc-support') as HTMLElement,
  webrtcToggle: document.getElementById('webrtc-toggle') as HTMLInputElement,
  webrtcToggleLabel: document.getElementById('webrtc-toggle-label') as HTMLSpanElement,
  leakCheck: document.getElementById('leak-check') as HTMLButtonElement,
  leakResult: document.getElementById('leak-result') as HTMLPreElement,
  httpsOnlyState: document.getElementById('https-only-state') as HTMLElement,
  recList: document.getElementById('recommendation-list') as HTMLUListElement,
  exportBtn: document.getElementById('export-btn') as HTMLButtonElement,
  importInput: document.getElementById('import-input') as HTMLInputElement,
  importResult: document.getElementById('import-result') as HTMLPreElement,
  clearHistory: document.getElementById('clear-history') as HTMLButtonElement,
};

let settings: PersistedSettings | null = null;
let servers: IvpnServer[] = [];

async function sendMessage<T = unknown>(type: string, payload?: unknown): Promise<T> {
  return (await browser.runtime.sendMessage({ type, payload })) as T;
}

async function loadSettings(): Promise<PersistedSettings> {
  return sendMessage<PersistedSettings>('settings/get');
}

async function loadServers(): Promise<IvpnServer[]> {
  const res = (await sendMessage<{ servers?: IvpnServer[] }>('servers/refresh'));
  return res?.servers ?? [];
}

function setActiveTab(name: string): void {
  els.tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  els.panels.forEach((p) => p.classList.toggle('active', p.dataset.tab === name));
}

function renderServerSelect(select: HTMLSelectElement, includeBlank: boolean): void {
  select.innerHTML = '';
  if (includeBlank) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '— select server —';
    select.appendChild(opt);
  }
  const groups = groupActiveServers(servers);
  for (const g of groups) {
    const og = document.createElement('optgroup');
    og.label = g.country;
    for (const c of g.cities) {
      for (const s of c.servers) {
        const opt = document.createElement('option');
        opt.value = s.gateway;
        opt.textContent = `${s.gateway} — ${c.city}`;
        og.appendChild(opt);
      }
    }
    select.appendChild(og);
  }
}

function renderProxyTab(): void {
  if (!settings) return;
  els.modeRadios.forEach((r) => {
    r.checked = r.value === settings!.mode;
  });
  renderServerSelect(els.globalServer, false);
  if (settings.globalGateway) {
    els.globalServer.value = settings.globalGateway;
  }
}

function renderRulesTab(): void {
  if (!settings || !els.ruleTableBody) return;
  renderServerSelect(els.ruleServer, true);
  els.ruleTableBody.innerHTML = '';
  for (const rule of settings.domainRules) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(rule.domain)}</td>
      <td>${escapeHtml(rule.label)}</td>
      <td>${rule.proxyDns ? 'Yes' : 'No'}</td>
      <td>${rule.disabled ? 'Disabled' : 'Active'}</td>
      <td><button data-domain="${escapeAttr(rule.domain)}">Remove</button></td>
    `;
    els.ruleTableBody.appendChild(tr);
  }
  els.ruleTableBody.querySelectorAll<HTMLButtonElement>('button[data-domain]').forEach((b) => {
    b.addEventListener('click', () => removeRule(b.dataset.domain!));
  });

  els.exclusionList.innerHTML = '';
  for (const ex of settings.exclusions) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(ex)}</span><button data-ex="${escapeAttr(ex)}">×</button>`;
    els.exclusionList.appendChild(li);
  }
  els.exclusionList.querySelectorAll<HTMLButtonElement>('button[data-ex]').forEach((b) => {
    b.addEventListener('click', () => removeExclusion(b.dataset.ex!));
  });
}

function renderPrivacyTab(): void {
  if (!settings) return;
  const supported = isWebRtcDisableSupported();
  els.webrtcSupport.textContent = supported
    ? 'WebRTC peer connection can be disabled in this browser.'
    : 'This browser does not expose the peerConnectionEnabled privacy setting. Detection still works.';
  els.webrtcToggle.disabled = !supported;
  els.webrtcToggle.checked = !settings.webRtcEnabled;
  els.webrtcToggleLabel.textContent = supported
    ? 'Disable WebRTC (Firefox-only one-click toggle; Chrome can detect but not disable)'
    : 'Disable WebRTC (unsupported on this browser)';

  isHttpsOnlyAvailable().then((ok) => {
    els.httpsOnlyState.textContent = ok
      ? 'HTTPS-Only mode is available in this browser. Enable it in the browser settings.'
      : 'HTTPS-Only mode is not exposed by this browser API.';
  });

  scanRecommendations().then((results) => {
    els.recList.innerHTML = '';
    for (const r of results) {
      const li = document.createElement('li');
      const state = r.installed ? 'Installed' : 'Not installed';
      const action = r.installed
        ? '<span class="hint">No action needed</span>'
        : `<a href="${escapeAttr(r.installUrl)}" target="_blank" rel="noopener noreferrer">Install</a>`;
      li.innerHTML = `
        <div>
          <strong>${escapeHtml(r.id)}</strong>
          <div class="hint">${escapeHtml(r.reason)}</div>
        </div>
        <div>
          <span>${state}</span>
          ${action}
        </div>
      `;
      els.recList.appendChild(li);
    }
  });
}

async function addRule(domain: string, gateway: string, proxyDns: boolean, disabled: boolean): Promise<void> {
  const server = servers.find((s) => s.gateway === gateway);
  if (!server) return;
  const endpoint = parseSocks5Endpoint(server);
  const newRule: DomainRule = {
    domain: domain.toLowerCase().trim(),
    endpoint,
    label: server.gateway,
    proxyDns,
    disabled,
  };
  const existing = settings?.domainRules ?? [];
  const filtered = existing.filter((r) => r.domain !== newRule.domain);
  settings = await sendMessage<PersistedSettings>('settings/patch', {
    domainRules: [...filtered, newRule],
  });
  renderRulesTab();
}

async function removeRule(domain: string): Promise<void> {
  const existing = settings?.domainRules ?? [];
  settings = await sendMessage<PersistedSettings>('settings/patch', {
    domainRules: existing.filter((r) => r.domain !== domain),
  });
  renderRulesTab();
}

async function addExclusion(domain: string): Promise<void> {
  const d = domain.toLowerCase().trim();
  const existing = settings?.exclusions ?? [];
  if (existing.includes(d)) return;
  settings = await sendMessage<PersistedSettings>('settings/patch', {
    exclusions: [...existing, d],
  });
  renderRulesTab();
}

async function removeExclusion(domain: string): Promise<void> {
  const existing = settings?.exclusions ?? [];
  settings = await sendMessage<PersistedSettings>('settings/patch', {
    exclusions: existing.filter((d) => d !== domain),
  });
  renderRulesTab();
}

async function setMode(mode: Mode): Promise<void> {
  settings = await sendMessage<PersistedSettings>('settings/patch', { mode });
  renderProxyTab();
}

async function setGlobalServer(gateway: string): Promise<void> {
  settings = await sendMessage<PersistedSettings>('settings/patch', { globalGateway: gateway });
  renderProxyTab();
}

async function toggleWebRtc(): Promise<void> {
  const enabled = !els.webrtcToggle.checked;
  const res = (await sendMessage<{ ok: boolean; reason?: string }>('webrtc/toggle', { enabled }));
  if (!res.ok && res.reason === 'unsupported') {
    els.webrtcToggle.checked = false;
    return;
  }
  renderPrivacyTab();
}

async function runLeakCheck(): Promise<void> {
  els.leakResult.hidden = false;
  els.leakResult.textContent = 'Running…';
  const res = (await sendMessage<{ hasWebRtc: boolean; leakedAddresses: string[]; error?: string }>(
    'webrtc/leakCheck',
  ));
  if (res.error) {
    els.leakResult.textContent = `Error: ${res.error}`;
    return;
  }
  if (!res.hasWebRtc) {
    els.leakResult.textContent = 'No WebRTC support detected.';
    return;
  }
  if (res.leakedAddresses.length === 0) {
    els.leakResult.textContent = 'No public IP leaked through WebRTC ICE candidates.';
  } else {
    els.leakResult.textContent = `Leaked public IP(s): ${res.leakedAddresses.join(', ')}`;
  }
}

async function doExport(): Promise<void> {
  const payload: ExportPayload = await exportAll();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ivpn-companion-community-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function doImport(file: File): Promise<void> {
  try {
    const text = await file.text();
    const payload = JSON.parse(text) as ExportPayload;
    await importAll(payload);
    settings = await loadSettings();
    els.importResult.hidden = false;
    els.importResult.textContent = `Imported ${Object.keys(payload.history).length} history entries, ${payload.settings.domainRules.length} domain rules.`;
    renderAll();
  } catch (err) {
    els.importResult.hidden = false;
    els.importResult.textContent = `Import failed: ${(err as Error).message}`;
  }
}

function renderAll(): void {
  renderProxyTab();
  renderRulesTab();
  renderPrivacyTab();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}

async function init(): Promise<void> {
  settings = await loadSettings();
  servers = await loadServers();
  renderAll();

  els.tabs.forEach((tab) => {
    tab.addEventListener('click', () => setActiveTab(tab.dataset.tab!));
  });

  els.modeRadios.forEach((r) => {
    r.addEventListener('change', () => {
      if (r.checked) setMode(r.value as Mode);
    });
  });

  els.globalServer.addEventListener('change', () => setGlobalServer(els.globalServer.value));
  els.refreshServers.addEventListener('click', async () => {
    servers = await loadServers();
    renderAll();
  });

  els.ruleForm.addEventListener('submit', (e) => {
    e.preventDefault();
    addRule(els.ruleDomain.value, els.ruleServer.value, els.ruleDns.checked, els.ruleDisabled.checked);
    els.ruleDomain.value = '';
  });
  els.exclusionForm.addEventListener('submit', (e) => {
    e.preventDefault();
    addExclusion(els.exclusionDomain.value);
    els.exclusionDomain.value = '';
  });

  els.webrtcToggle.addEventListener('change', () => toggleWebRtc());
  els.leakCheck.addEventListener('click', () => runLeakCheck());

  els.exportBtn.addEventListener('click', () => doExport());
  els.importInput.addEventListener('change', () => {
    const file = els.importInput.files?.[0];
    if (file) doImport(file);
  });
  els.clearHistory.addEventListener('click', async () => {
    await sendMessage('history/clear');
  });
}

init().catch((err) => {
  console.error('Options init failed:', err);
});
