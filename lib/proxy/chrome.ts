/**
 * Chrome MV3 proxy handler. Generates a PAC script and registers it via
 * chrome.proxy.settings. The PAC inlines the same pattern-matcher logic
 * used by the Firefox listener, so rules apply identically on both
 * browsers.
 */

import { browser } from 'wxt/browser';
import type { GlobalProxy, ProxyRules, RuleTarget, Socks5Endpoint } from './rules';

function escapeJsString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function toProxyString(endpoint: Socks5Endpoint | null): string {
  if (!endpoint) return "'DIRECT'";
  return `'SOCKS5 ${endpoint.host}:${endpoint.port}'`;
}

function resolveToEndpointJs(target: RuleTarget, global: GlobalProxy, hasRandom: boolean): string {
  if (target.kind === 'direct') return toProxyString(null);
  if (target.kind === 'socks5') return toProxyString(target.endpoint);
  if (target.kind === 'global') {
    if (global.kind === 'socks5') return toProxyString(global.endpoint);
    if (global.kind === 'random') return hasRandom ? JSON.stringify('randomChoice') : toProxyString(null);
    return toProxyString(null);
  }
  if (target.kind === 'random') {
    return hasRandom ? JSON.stringify('randomChoice') : toProxyString(null);
  }
  return toProxyString(null);
}

/**
 * Generate PAC script. Resolution order matches the Firefox handler:
 * exclusion > first matching rule > global > direct.
 *
 * Patterns (wildcards, CIDR) are matched by inlining the same algorithm
 * the host-side pattern matcher uses.
 */
export function generatePacScript(rules: ProxyRules, randomChoiceJs: string): string {
  const exclusionList = rules.exclusions
    .map((e) => `'${escapeJsString(e.toLowerCase())}'`)
    .join(',');
  const ruleList = rules.domainRules
    .filter((r) => !r.disabled)
    .map((r) => {
      const t = resolveToEndpointJs(r.target, rules.global, true);
      return `{pattern: '${escapeJsString(r.pattern.toLowerCase())}', target: ${t}, proxyDns: ${r.proxyDns ? 'true' : 'false'}}`;
    })
    .join(',\n');
  const globalJs =
    rules.global.kind === 'socks5'
      ? toProxyString(rules.global.endpoint)
      : rules.global.kind === 'random'
        ? 'randomPool()'
        : toProxyString(null);

  return `
function FindProxyForURL(url, host) {
  var exclusions = [${exclusionList}];
  var domainRules = [${ruleList}];
  var randomPool = ${randomChoiceJs};
  var globalProxy = ${globalJs};

  host = (host || '').toLowerCase().replace(/\\.+$/, '');
  if (!host) return 'DIRECT';

  for (var i = 0; i < exclusions.length; i++) {
    if (matchPattern(host, exclusions[i])) return 'DIRECT';
  }

  for (var j = 0; j < domainRules.length; j++) {
    if (matchPattern(host, domainRules[j].pattern)) {
      if (domainRules[j].target === 'randomChoice') return randomPool();
      return domainRules[j].target;
    }
  }

  return globalProxy;
}

function matchPattern(host, pattern) {
  pattern = (pattern || '').toLowerCase().replace(/\\.+$/, '');
  if (pattern.indexOf('/') !== -1) {
    return cidrMatch(host, pattern);
  }
  if (pattern.indexOf('*') !== -1) {
    var re = new RegExp('^' + pattern.replace(/[.+?^\${}()|[\\]\\\\]/g, '\\\\$&').replace(/\\*/g, '[^.]+') + '$');
    return re.test(host);
  }
  return host === pattern || host.endsWith('.' + pattern);
}

function cidrMatch(host, cidr) {
  var slash = cidr.indexOf('/');
  if (slash === -1) return false;
  var ip = cidr.substring(0, slash);
  var bits = parseInt(cidr.substring(slash + 1), 10);
  if (host.indexOf(':') !== -1) return ipv6CidrContains(host, ip, bits);
  if (!/^\\d{1,3}(\\.\\d{1,3}){3}$/.test(host)) return false;
  return ipv4CidrContains(host, ip, bits);
}

function ipv4ToInt(s) {
  var p = s.split('.').map(Number);
  if (p.length !== 4 || p.some(function (n) { return !Number.isInteger(n) || n < 0 || n > 255; })) return -1;
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

function ipv4CidrContains(host, ip, bits) {
  var h = ipv4ToInt(host);
  var n = ipv4ToInt(ip);
  if (h < 0 || n < 0) return false;
  if (bits === 0) return true;
  var mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
  return (h & mask) === (n & mask);
}

function expandIpv6(s) {
  if (s.indexOf(':::') !== -1) return null;
  var parts;
  if (s.indexOf('::') !== -1) {
    var split = s.split('::');
    var head = split[0] === '' ? [] : split[0].split(':');
    var tail = split[1] === '' ? [] : split[1].split(':');
    var missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    parts = head.concat(new Array(missing).fill('0')).concat(tail);
  } else {
    parts = s.split(':');
  }
  if (parts.length !== 8) return null;
  for (var i = 0; i < parts.length; i++) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(parts[i])) return null;
    parts[i] = ('0000' + parts[i]).slice(-4);
  }
  return parts.join(':');
}

function ipv6ToBigInt(s) {
  var expanded = expandIpv6(s);
  if (expanded === null) return null;
  var parts = expanded.split(':');
  var result = 0n;
  for (var i = 0; i < parts.length; i++) {
    result = (result << 16n) | BigInt(parseInt(parts[i], 16));
  }
  return result;
}

function ipv6CidrContains(host, ip, bits) {
  var h = ipv6ToBigInt(host);
  var n = ipv6ToBigInt(ip);
  if (h === null || n === null) return false;
  if (bits === 0) return true;
  var fullMask = (1n << 128n) - 1n;
  var mask = bits === 128 ? fullMask : ((1n << BigInt(128 - bits)) - 1n) ^ fullMask;
  return (h & mask) === (n & mask);
}
`.trim();
}

export async function setProxyRules(rules: ProxyRules, randomPool: Socks5Endpoint[]): Promise<void> {
  const randomChoiceJs =
    randomPool.length > 0
      ? `function() {
  var pool = ${JSON.stringify(randomPool)};
  var pick = pool[Math.floor(Math.random() * pool.length)];
  return 'SOCKS5 ' + pick.host + ':' + pick.port;
}`
      : "function() { return 'DIRECT'; }";

  const pacScript = generatePacScript(rules, randomChoiceJs);

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
