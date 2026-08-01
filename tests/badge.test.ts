import { describe, it, expect } from 'vitest';
import { badgeForHost } from '~/lib/badge';
import type { ProxyRules, DomainRule } from '~/lib/proxy/rules';
import { DIRECT_GLOBAL, DIRECT_TARGET } from '~/lib/proxy/rules';

const socks5 = (label: string, host = 'srv') => ({
  kind: 'socks5' as const,
  endpoint: { host, port: 1080 },
  label,
});

function rules(overrides: Partial<ProxyRules> = {}): ProxyRules {
  return { global: DIRECT_GLOBAL, domainRules: [], exclusions: [], ...overrides };
}

function rule(pattern: string, target: DomainRule['target']): DomainRule {
  return { pattern, target, disabled: false, proxyDns: false };
}

describe('lib/badge badgeForHost', () => {
  describe('global-only', () => {
    it('direct global and no matching rule → empty badge', () => {
      const { text, color } = badgeForHost('example.com', rules());
      expect(text).toBe('');
      expect(color).toBe('#6b7280');
    });

    it('socks5 global → gateway code', () => {
      const { text, color } = badgeForHost('example.com', rules({ global: socks5('us-nyc-wg-001') }));
      expect(text).toBe('US-N');
      expect(color).toBe('#4f46e5');
    });

    it('random global → R', () => {
      const { text, color } = badgeForHost('example.com', rules({ global: { kind: 'random' } }));
      expect(text).toBe('R');
      expect(color).toBe('#4f46e5');
    });
  });

  describe('per-site rules override the global', () => {
    it('per-site socks5 rule on the active host shows the per-site gateway, not the global', () => {
      const r = rules({ global: socks5('us-nyc-wg-001') });
      r.domainRules = [rule('example.com', socks5('ch-zrh-wg-001'))];
      const { text } = badgeForHost('example.com', r);
      expect(text).toBe('CH-Z');
    });

    it('per-site random rule on the active host shows R even when global is socks5', () => {
      const r = rules({ global: socks5('us-nyc-wg-001') });
      r.domainRules = [rule('example.com', { kind: 'random' })];
      const { text } = badgeForHost('example.com', r);
      expect(text).toBe('R');
    });

    it('per-site direct rule on the active host → empty badge even when global is active', () => {
      const r = rules({ global: socks5('us-nyc-wg-001') });
      r.domainRules = [rule('example.com', DIRECT_TARGET)];
      const { text } = badgeForHost('example.com', r);
      expect(text).toBe('');
    });

    it('a direct rule for another host does not affect the active host badge', () => {
      const r = rules({ global: socks5('us-nyc-wg-001') });
      r.domainRules = [rule('other.com', DIRECT_TARGET)];
      const { text } = badgeForHost('example.com', r);
      expect(text).toBe('US-N');
    });

    it('rule target inherit-from-global resolves to the global', () => {
      const r = rules({ global: socks5('us-nyc-wg-001') });
      r.domainRules = [rule('example.com', { kind: 'global' })];
      const { text } = badgeForHost('example.com', r);
      expect(text).toBe('US-N');
    });

    it('disabled rule is ignored', () => {
      const r = rules({ global: DIRECT_GLOBAL });
      r.domainRules = [{ ...rule('example.com', socks5('us-nyc-wg-001')), disabled: true }];
      const { text } = badgeForHost('example.com', r);
      expect(text).toBe('');
    });
  });

  describe('exclusions', () => {
    it('excluded host → empty badge even with an active global', () => {
      const r = rules({ global: socks5('us-nyc-wg-001'), exclusions: ['*.lan'] });
      const { text } = badgeForHost('foo.lan', r);
      expect(text).toBe('');
    });
  });

  describe('no active web host', () => {
    it('null host falls back to the global default', () => {
      const { text, color } = badgeForHost(null, rules({ global: { kind: 'random' } }));
      expect(text).toBe('R');
      expect(color).toBe('#4f46e5');
    });

    it('null host with direct global → empty badge', () => {
      const { text } = badgeForHost(null, rules());
      expect(text).toBe('');
    });
  });
});
