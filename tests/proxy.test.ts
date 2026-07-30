import { describe, it, expect } from 'vitest';
import {
  emptyRules,
  findRuleForHost,
  hostMatchesDomain,
  isExcluded,
  resolveTarget,
  targetFromServer,
  DIRECT_TARGET,
} from '~/lib/proxy/rules';
import { generatePacScript } from '~/lib/proxy/chrome';
import type { DomainRule, ProxyRules } from '~/lib/proxy/rules';
import type { IvpnServer } from '~/lib/ivpn/types';

const server: IvpnServer = {
  gateway: 'us-nyc-wg-001',
  country_code: 'US',
  country: 'United States',
  city: 'New York',
  load: 0.3,
  status: 'online',
  is_active: true,
  in_maintenance: false,
  socks5: 'socks5.us-nyc-wg-001.gw.ivpn.net:10.1.0.1',
};

describe('proxy/rules', () => {
  it('hostMatchesDomain: exact and parent-domain, case-insensitive', () => {
    expect(hostMatchesDomain('example.com', 'example.com')).toBe(true);
    expect(hostMatchesDomain('www.example.com', 'example.com')).toBe(true);
    expect(hostMatchesDomain('a.b.example.com', 'example.com')).toBe(true);
    expect(hostMatchesDomain('example.org', 'example.com')).toBe(false);
    expect(hostMatchesDomain('notexample.com', 'example.com')).toBe(false);
    expect(hostMatchesDomain('EXAMPLE.COM', 'example.com')).toBe(true);
    expect(hostMatchesDomain('example.com.', 'example.com')).toBe(true);
  });

  it('findRuleForHost: exact match preferred, then parent-domain', () => {
    const rules: DomainRule[] = [
      { domain: 'example.com', endpoint: { host: 'h1', port: 1080 }, label: 'g1', disabled: false, proxyDns: false },
      { domain: 'www.example.com', endpoint: { host: 'h2', port: 1080 }, label: 'g2', disabled: false, proxyDns: false },
    ];
    expect(findRuleForHost('www.example.com', rules)?.label).toBe('g2');
    expect(findRuleForHost('api.example.com', rules)?.label).toBe('g1');
    expect(findRuleForHost('other.com', rules)).toBeUndefined();
  });

  it('findRuleForHost skips disabled rules', () => {
    const rules: DomainRule[] = [
      { domain: 'example.com', endpoint: { host: 'h1', port: 1080 }, label: 'g1', disabled: true, proxyDns: false },
    ];
    expect(findRuleForHost('example.com', rules)).toBeUndefined();
  });

  it('isExcluded: parent-domain match', () => {
    expect(isExcluded('a.b.lan', ['lan'])).toBe(true);
    expect(isExcluded('lan', ['lan'])).toBe(true);
    expect(isExcluded('public.com', ['lan'])).toBe(false);
  });

  it('resolveTarget precedence: exclusion > per-domain > global', () => {
    const rules: ProxyRules = {
      ...emptyRules(),
      mode: 'global',
      globalTarget: targetFromServer(server),
      domainRules: [
        { domain: 'override.com', endpoint: { host: 'hX', port: 1080 }, label: 'gX', disabled: false, proxyDns: false },
      ],
      exclusions: ['never.com'],
    };
    expect(resolveTarget('never.com', rules)).toEqual(DIRECT_TARGET);
    expect(resolveTarget('override.com', rules).endpoint?.host).toBe('hX');
    expect(resolveTarget('anywhere.com', rules).endpoint?.host).toBe('socks5.us-nyc-wg-001.gw.ivpn.net');
  });

  it('resolveTarget: direct mode never uses global, even with domain rule', () => {
    const rules: ProxyRules = {
      ...emptyRules(),
      mode: 'direct',
      domainRules: [
        { domain: 'override.com', endpoint: { host: 'hX', port: 1080 }, label: 'gX', disabled: false, proxyDns: false },
      ],
    };
    expect(resolveTarget('override.com', rules).endpoint?.host).toBe('hX');
    expect(resolveTarget('anywhere.com', rules)).toEqual(DIRECT_TARGET);
  });
});

describe('proxy/chrome PAC generator', () => {
  it('emits a SOCKS5 entry for the global proxy', () => {
    const rules: ProxyRules = {
      ...emptyRules(),
      mode: 'global',
      globalTarget: targetFromServer(server),
    };
    const pac = generatePacScript(rules);
    expect(pac).toContain('FindProxyForURL');
    expect(pac).toContain("'SOCKS5 ' + globalProxy.host");
    expect(pac).toContain("'socks5.us-nyc-wg-001.gw.ivpn.net'");
  });

  it('emits DIRECT when mode is direct and no domain rules', () => {
    const rules: ProxyRules = { ...emptyRules(), mode: 'direct' };
    const pac = generatePacScript(rules);
    expect(pac).toContain("return 'DIRECT'");
  });

  it('emits a per-domain rule with parent-domain fallback', () => {
    const rules: ProxyRules = {
      ...emptyRules(),
      mode: 'direct',
      domainRules: [
        { domain: 'example.com', endpoint: { host: 'hX', port: 1080 }, label: 'gX', disabled: false, proxyDns: false },
      ],
    };
    const pac = generatePacScript(rules);
    expect(pac).toContain("domain: 'example.com'");
    expect(pac).toContain("'hX'");
    expect(pac).toContain('return proxy + r.host');
  });

  it('emits exclusion entries', () => {
    const rules: ProxyRules = {
      ...emptyRules(),
      mode: 'global',
      globalTarget: targetFromServer(server),
      exclusions: ['lan', 'internal.local'],
    };
    const pac = generatePacScript(rules);
    expect(pac).toContain("'lan'");
    expect(pac).toContain("'internal.local'");
  });

  it('escapes single quotes in domain names', () => {
    const rules: ProxyRules = {
      ...emptyRules(),
      mode: 'direct',
      domainRules: [
        { domain: "weird'name.com", endpoint: { host: 'hX', port: 1080 }, label: 'gX', disabled: false, proxyDns: false },
      ],
    };
    const pac = generatePacScript(rules);
    expect(pac).toContain("\\'");
  });
});
