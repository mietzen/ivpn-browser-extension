/**
 * Options page controller. Tabs: Proxy, Per-domain rules, Never proxy,
 * Privacy, Backup, About.
 */

import { browser } from 'wxt/browser';
import type { IvpnServer } from '~/lib/ivpn/types';
import { groupActiveServers } from '~/lib/ivpn/grouping';
import { parseSocks5Endpoint } from '~/lib/ivpn/client';
import type { PersistedSettings, ExportPayload } from '~/lib/storage';
import { exportAll, importAll } from '~/lib/storage';
import type { DomainRule, GlobalProxy, RuleTarget } from '~/lib/proxy/rules';
import { isWebRtcDisableSupported } from '~/lib/webrtc';
import { isHttpsOnlyAvailable } from '~/lib/recommendations';

const els = {
  tabs: document.querySelectorAll<HTMLButtonElement>('.tab'),
  panels: document.querySelectorAll<HTMLElement>('.tab-panel'),
  globalProxy: document.getElementById('global-proxy') as HTMLSelectElement,
  ruleForm: document.getElementById('rule-form') as HTMLFormElement,
  rulePattern: document.getElementById('rule-pattern') as HTMLInputElement,
  ruleTargetKind: document.getElementById('rule-target-kind') as HTMLSelectElement,
  ruleTargetServer: document.getElementById('rule-target-server') as HTMLSelectElement,
  ruleProxyDns: document.getElementById('rule-proxy-dns') as HTMLInputElement,
  ruleDisabled: document.getElementById('rule-disabled') as HTMLInputElement,
  ruleTableBody: document.querySelector<HTMLTableSectionElement>('#rule-table tbody'),
  exclusionForm: document.getElementById('exclusion-form') as HTMLFormElement,
  exclusionPattern: document.getElementById('exclusion-pattern') as HTMLInputElement,
  exclusionList: document.getElementById('exclusion-list') as HTMLUListElement,
  webrtcSupport: document.getElementById('webrtc-support') as HTMLElement,
  webrtcToggle: document.getElementById('webrtc-toggle') as HTMLInputElement,
  webrtcToggleLabel: document.getElementById('webrtc-toggle-label') as HTMLSpanElement,
  leakCheck: document.getElementById('leak-check') as HTMLButtonElement,
  leakResult: document.getElementById('leak-result') as HTMLPreElement,
  httpsOnlyState: document.getElementById('https-only-state') as HTMLElement,
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
  const res = await sendMessage<{ servers?: IvpnServer[] }>('servers/refresh');
  return res.servers ?? [];
}

function setActiveTab(name: string): void {
  els.tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  els.panels.forEach((p) => p.classList.toggle('active', p.dataset.tab === name));
}

function renderServerSelect(select: HTMLSelectElement, includeBlank: boolean, blankLabel: string): void {
  select.innerHTML = '';
  if (includeBlank) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = blankLabel;
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

function labelForTarget(t: RuleTarget): string {
  switch (t.kind) {
    case 'direct': return 'Direct';
    case 'global': return 'Inherit from global';
    case 'random': return 'Random';
    case 'socks5': return t.label;
  }
}

function renderProxyTab(): void {
  if (!settings) return;
  els.globalProxy.innerHTML = '';
  const direct = document.createElement('option');
  direct.value = 'direct';
  direct.textContent = 'Direct';
  els.globalProxy.appendChild(direct);
  const random = document.createElement('option');
  random.value = 'random';
  random.textContent = 'Random';
  els.globalProxy.appendChild(random);
  const groups = groupActiveServers(servers);
  for (const g of groups) {
    const og = document.createElement('optgroup');
    og.label = g.country;
    for (const c of g.cities) {
      for (const s of c.servers) {
        const opt = document.createElement('option');
        opt.value = s.gateway;
        opt.textContent = `${s.gateway} — ${c.city}`;
        if (settings.global.kind === 'socks5' && settings.global.label === s.gateway) {
          opt.selected = true;
        }
        og.appendChild(opt);
      }
    }
    els.globalProxy.appendChild(og);
  }
  if (settings.global.kind === 'random') {
    els.globalProxy.value = 'random';
  }
}

function renderRulesTab(): void {
  if (!settings) return;
  renderServerSelect(els.ruleTargetServer, false, '');
  els.ruleTableBody!.innerHTML = '';
  for (const rule of settings.domainRules) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(rule.pattern)}</td>
      <td>${escapeHtml(labelForTarget(rule.target))}</td>
      <td>${rule.proxyDns ? 'Yes' : 'No'}</td>
      <td>${rule.disabled ? 'Disabled' : 'Active'}</td>
      <td><button data-pattern="${escapeAttr(rule.pattern)}">Remove</button></td>
    `;
    els.ruleTableBody!.appendChild(tr);
  }
  els.ruleTableBody!.querySelectorAll<HTMLButtonElement>('button[data-pattern]').forEach((b) => {
    b.addEventListener('click', () => {
      if (b.dataset.pattern) removeRule(b.dataset.pattern);
    });
  });
}

function renderExclusionsTab(): void {
  if (!settings) return;
  els.exclusionList.innerHTML = '';
  for (const ex of settings.exclusions) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(ex)}</span><button data-pattern="${escapeAttr(ex)}">×</button>`;
    els.exclusionList.appendChild(li);
  }
  els.exclusionList.querySelectorAll<HTMLButtonElement>('button[data-pattern]').forEach((b) => {
    b.addEventListener('click', () => {
      if (b.dataset.pattern) removeExclusion(b.dataset.pattern);
    });
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
    ? 'Block WebRTC (Firefox-only one-click toggle; Chrome can detect but not disable)'
    : 'Block WebRTC (unsupported on this browser)';

  isHttpsOnlyAvailable().then((ok) => {
    els.httpsOnlyState.textContent = ok
      ? 'HTTPS-Only mode is available in this browser. Enable it in the browser settings.'
      : 'HTTPS-Only mode is not exposed by this browser API.';
  });
}

async function addRule(pattern: string, kind: string, server: string, proxyDns: boolean, disabled: boolean): Promise<void> {
  if (!settings) return;
  let target: RuleTarget;
  if (kind === 'direct') {
    target = { kind: 'direct' };
  } else if (kind === 'global') {
    target = { kind: 'global' };
  } else if (kind === 'random') {
    target = { kind: 'random' };
  } else {
    const found = servers.find((s) => s.gateway === server);
    if (!found) return;
    target = { kind: 'socks5', endpoint: parseSocks5Endpoint(found), label: found.gateway };
  }
  const newRule: DomainRule = { pattern, target, disabled, proxyDns };
  const filtered = settings.domainRules.filter((r) => r.pattern !== newRule.pattern);
  settings = await sendMessage<PersistedSettings>('settings/patch', {
    domainRules: [...filtered, newRule],
  });
  renderRulesTab();
}

async function removeRule(pattern: string): Promise<void> {
  if (!settings) return;
  settings = await sendMessage<PersistedSettings>('settings/patch', {
    domainRules: settings.domainRules.filter((r) => r.pattern !== pattern),
  });
  renderRulesTab();
}

async function addExclusion(pattern: string): Promise<void> {
  if (!settings) return;
  if (settings.exclusions.includes(pattern)) return;
  settings = await sendMessage<PersistedSettings>('settings/patch', {
    exclusions: [...settings.exclusions, pattern],
  });
  renderExclusionsTab();
}

async function removeExclusion(pattern: string): Promise<void> {
  if (!settings) return;
  settings = await sendMessage<PersistedSettings>('settings/patch', {
    exclusions: settings.exclusions.filter((d) => d !== pattern),
  });
  renderExclusionsTab();
}

async function setGlobal(value: string): Promise<void> {
  let global: GlobalProxy;
  if (value === 'direct') {
    global = { kind: 'direct' };
  } else if (value === 'random') {
    global = { kind: 'random' };
  } else {
    const found = servers.find((s) => s.gateway === value);
    if (!found) return;
    global = { kind: 'socks5', endpoint: parseSocks5Endpoint(found), label: found.gateway };
  }
  settings = await sendMessage<PersistedSettings>('settings/setGlobal', { global });
  renderProxyTab();
}

async function toggleWebRtc(): Promise<void> {
  const enabled = !els.webrtcToggle.checked;
  const res = await sendMessage<{ ok: boolean; reason?: string }>('webrtc/toggle', { enabled });
  if (!res.ok && res.reason === 'unsupported') {
    els.webrtcToggle.checked = false;
    return;
  }
  renderPrivacyTab();
}

async function runLeakCheck(): Promise<void> {
  els.leakResult.hidden = false;
  els.leakResult.textContent = 'Running…';
  const res = await sendMessage<{ hasWebRtc: boolean; leakedAddresses: string[]; error?: string }>('webrtc/leakCheck');
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
  a.download = `ivpn-proxy-switcher-${new Date().toISOString().slice(0, 10)}.json`;
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
    els.importResult.textContent = `Imported ${Object.keys(payload.history).length} history entries, ${payload.settings.domainRules.length} rules.`;
    renderAll();
  } catch (err) {
    els.importResult.hidden = false;
    els.importResult.textContent = `Import failed: ${(err as Error).message}`;
  }
}

function renderAll(): void {
  renderProxyTab();
  renderRulesTab();
  renderExclusionsTab();
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

  els.globalProxy.addEventListener('change', () => {
    setGlobal(els.globalProxy.value).catch((err) => console.error(err));
  });

  els.ruleTargetKind.addEventListener('change', () => {
    els.ruleTargetServer.hidden = els.ruleTargetKind.value !== 'socks5';
  });
  els.ruleForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const kind = els.ruleTargetKind.value;
    addRule(
      els.rulePattern.value.trim(),
      kind,
      els.ruleTargetServer.value,
      els.ruleProxyDns.checked,
      els.ruleDisabled.checked,
    ).catch((err) => console.error(err));
    els.rulePattern.value = '';
  });
  els.exclusionForm.addEventListener('submit', (e) => {
    e.preventDefault();
    addExclusion(els.exclusionPattern.value.trim()).catch((err) => console.error(err));
    els.exclusionPattern.value = '';
  });

  els.webrtcToggle.addEventListener('change', () => {
    toggleWebRtc().catch((err) => console.error(err));
  });
  els.leakCheck.addEventListener('click', () => {
    runLeakCheck().catch((err) => console.error(err));
  });

  els.exportBtn.addEventListener('click', () => {
    doExport().catch((err) => console.error(err));
  });
  els.importInput.addEventListener('change', () => {
    const file = els.importInput.files?.[0];
    if (file) doImport(file).catch((err) => console.error(err));
  });
  els.clearHistory.addEventListener('click', () => {
    sendMessage('history/clear').catch((err) => console.error(err));
  });
}

init().catch((err) => {
  console.error('Options init failed:', err);
});
