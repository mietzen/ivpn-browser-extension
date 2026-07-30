/**
 * Chrome MV3 proxy implementation — generates a PAC script and registers it
 * with chrome.proxy.settings. Same domain-matching logic as the Firefox path;
 * the PAC just inlines it. Per PLAN.md §4.
 */

import { browser } from 'wxt/browser';
import type { ProxyRules } from './rules';
import { findRuleForHost, hostMatchesDomain, isExcluded } from './rules';

const SOCKS_PROXY_TYPE = 'SOCKS5';

function escapeJsString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function buildExclusionList(exclusions: string[]): string {
  if (exclusions.length === 0) return '[]';
  const items = exclusions.map((e) => `'${escapeJsString(e.toLowerCase())}'`).join(',');
  return `[${items}]`;
}

function buildDomainRules(rules: ProxyRules['domainRules']): string {
  const active = rules.filter((r) => !r.disabled && r.endpoint);
  if (active.length === 0) return '[]';
  const items = active
    .map((r) => {
      const ep = r.endpoint;
      if (!ep) return null;
      return (
        `{domain: '${escapeJsString(r.domain.toLowerCase())}', ` +
        `host: '${escapeJsString(ep.host)}', ` +
        `port: ${ep.port}, ` +
        `label: '${escapeJsString(r.label)}', ` +
        `proxyDns: ${r.proxyDns ? 'true' : 'false'}}`
      );
    })
    .filter((s): s is string => s !== null)
    .join(',\n');
  return `[\n${items}\n]`;
}

function buildGlobalProxy(rules: ProxyRules): string {
  if (rules.mode === 'direct') return 'null';
  const target = rules.mode === 'random' ? rules.randomTarget : rules.globalTarget;
  if (!target || !target.endpoint) return 'null';
  return (
    `{host: '${escapeJsString(target.endpoint.host)}', port: ${target.endpoint.port}}`
  );
}

/**
 * Generate PAC script text. Shape mirrors the JS module logic:
 *   exclusion list → per-domain rule (with parent-domain fallback) → global target.
 */
export function generatePacScript(rules: ProxyRules): string {
  return `
function FindProxyForURL(url, host) {
  var exclusions = ${buildExclusionList(rules.exclusions)};
  var domainRules = ${buildDomainRules(rules.domainRules)};
  var globalProxy = ${buildGlobalProxy(rules)};

  host = (host || '').toLowerCase().replace(/\\.+$/, '');
  if (!host) return 'DIRECT';

  for (var i = 0; i < exclusions.length; i++) {
    var ex = exclusions[i].replace(/\\.+$/, '');
    if (host === ex || host.endsWith('.' + ex)) return 'DIRECT';
  }

  for (var j = 0; j < domainRules.length; j++) {
    var r = domainRules[j];
    var d = r.domain.replace(/\\.+$/, '');
    if (host === d || host.endsWith('.' + d)) {
      var proxy = r.proxyDns ? 'SOCKS5 ' : 'SOCKS ';
      return proxy + r.host + ':' + r.port;
    }
  }

  if (globalProxy) {
    return '${SOCKS_PROXY_TYPE} ' + globalProxy.host + ':' + globalProxy.port;
  }
  return 'DIRECT';
}
`.trim();
}

export async function setProxyRules(rules: ProxyRules): Promise<void> {
  const pacScript = generatePacScript(rules);

  await browser.proxy.settings.set({
    value: {
      mode: 'pac_script',
      pacScript: { data: pacScript },
    },
    scope: 'regular',
  });
}

export async function clearProxyRules(): Promise<void> {
  await browser.proxy.settings.clear({ scope: 'regular' });
}

export { findRuleForHost, hostMatchesDomain, isExcluded };
