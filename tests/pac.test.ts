import { describe, it, expect } from 'vitest';
import { generatePacScript } from '~/lib/proxy/chrome';
import { resolveRuleTarget } from '~/lib/proxy/rules';
import type { GlobalProxy, ProxyRules, RuleTarget } from '~/lib/proxy/rules';
import { DIRECT_GLOBAL, DIRECT_TARGET } from '~/lib/proxy/rules';

/**
 * Golden test: the generated Chrome PAC script must resolve every host
 * exactly the way resolveRuleTarget does. The PAC inlines its own copy of
 * the resolution logic and pattern matcher; this test evaluates the
 * generated script and compares its output against the host-side resolver
 * for a representative matrix of rules and hosts.
 */

// Deterministic stand-in for the random pool the background would inject.
const RANDOM_STUB = "function() { return 'SOCKS5 10.0.0.1:1080'; }";
const RANDOM_PROXY_STRING = 'SOCKS5 10.0.0.1:1080';

function evaluatePac(script: string): (url: string, host: string) => string {
  const factory = new Function(`${script}\nreturn FindProxyForURL;`);
  return factory() as (url: string, host: string) => string;
}

// The proxy string resolveRuleTarget's answer must map to inside the PAC.
function pacStringFor(target: RuleTarget, global: GlobalProxy): string {
  if (target.kind === 'direct') return 'DIRECT';
  if (target.kind === 'socks5') return `SOCKS5 ${target.endpoint.host}:${target.endpoint.port}`;
  if (target.kind === 'random') return RANDOM_PROXY_STRING;
  if (target.kind === 'global') {
    if (global.kind === 'socks5') return `SOCKS5 ${global.endpoint.host}:${global.endpoint.port}`;
    if (global.kind === 'random') return RANDOM_PROXY_STRING;
    return 'DIRECT';
  }
  return 'DIRECT';
}

const GLOBAL_SOCKS: GlobalProxy = { kind: 'socks5', endpoint: { host: 'global.socks5', port: 1080 }, label: 'global' };
const RULE_SOCKS: RuleTarget = { kind: 'socks5', endpoint: { host: 'rule.socks5', port: 1080 }, label: 'rule' };

function rulesWith(global: GlobalProxy): ProxyRules {
  return {
    global,
    exclusions: ['*.lan', '192.168.0.0/16'],
    domainRules: [
      { pattern: 'direct.example.com', target: DIRECT_TARGET, disabled: false, proxyDns: false },
      { pattern: 'socks.example.com', target: RULE_SOCKS, disabled: false, proxyDns: true },
      { pattern: 'rand.example.com', target: { kind: 'random' }, disabled: false, proxyDns: false },
      { pattern: 'inherit.example.com', target: { kind: 'global' }, disabled: false, proxyDns: false },
      { pattern: 'off.example.com', target: RULE_SOCKS, disabled: true, proxyDns: false },
    ],
  };
}

describe('Chrome PAC golden test', () => {
  it('PAC output matches resolveRuleTarget for a representative matrix', () => {
    const cases: Array<{ host: string; global: GlobalProxy }> = [
      // exclusions beat rules and global
      { host: 'foo.lan', global: GLOBAL_SOCKS },
      { host: '192.168.5.10', global: GLOBAL_SOCKS },
      { host: 'FOO.LAN', global: GLOBAL_SOCKS },
      // domain rules
      { host: 'direct.example.com', global: GLOBAL_SOCKS },
      { host: 'socks.example.com', global: GLOBAL_SOCKS },
      { host: 'www.socks.example.com', global: GLOBAL_SOCKS },
      { host: 'rand.example.com', global: GLOBAL_SOCKS },
      { host: 'inherit.example.com', global: GLOBAL_SOCKS },
      // disabled rule skipped -> falls to global
      { host: 'off.example.com', global: GLOBAL_SOCKS },
      // global fallbacks
      { host: 'nomatch.com', global: GLOBAL_SOCKS },
      { host: 'nomatch.com', global: { kind: 'random' } },
      { host: 'inherit.example.com', global: { kind: 'random' } },
      { host: 'rand.example.com', global: { kind: 'random' } },
      { host: 'nomatch.com', global: DIRECT_GLOBAL },
    ];

    for (const { host, global } of cases) {
      const rules = rulesWith(global);
      const script = generatePacScript(rules, RANDOM_STUB);
      const find = evaluatePac(script);
      const target = resolveRuleTarget(host, rules);
      const expected = pacStringFor(target, global);
      expect(find(`https://${host}/path`, host), `host=${host} global=${global.kind}`).toBe(expected);
    }
  });

  it('PAC handles random-global without throwing', () => {
    const script = generatePacScript(rulesWith({ kind: 'random' }), RANDOM_STUB);
    const find = evaluatePac(script);
    expect(find('https://nomatch.com/', 'nomatch.com')).toBe(RANDOM_PROXY_STRING);
  });
});
