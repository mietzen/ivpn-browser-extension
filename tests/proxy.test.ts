import { describe, it, expect } from 'vitest';
import {
  emptyRules,
  isExcluded,
  findRuleForHost,
  resolveRuleTarget,
  DIRECT_GLOBAL,
  DIRECT_TARGET,
  labelForGlobal,
} from '~/lib/proxy/rules';
import type { DomainRule, GlobalProxy } from '~/lib/proxy/rules';

describe('proxy/rules', () => {
  describe('resolve order', () => {
    const rules = {
      global: DIRECT_GLOBAL,
      domainRules: [
        { pattern: 'blocked.example.com', target: DIRECT_TARGET, disabled: false, proxyDns: false },
        {
          pattern: 'via-server.example.com',
          target: { kind: 'socks5' as const, endpoint: { host: 'srv', port: 1080 }, label: 'srv' },
          disabled: false,
          proxyDns: false,
        },
      ],
      exclusions: ['*.lan'],
    };

    it('exclusions take priority over rules and global', () => {
      expect(resolveRuleTarget('foo.lan', rules)).toEqual(DIRECT_TARGET);
    });

    it('first matching rule wins over global', () => {
      expect(resolveRuleTarget('blocked.example.com', rules)).toEqual(DIRECT_TARGET);
    });

    it('rule target is returned for matching host', () => {
      const t = resolveRuleTarget('via-server.example.com', rules);
      expect(t.kind).toBe('socks5');
      if (t.kind === 'socks5') expect(t.label).toBe('srv');
    });

    it('falls back to global when no rule matches', () => {
      const withGlobal: GlobalProxy = { kind: 'socks5', endpoint: { host: 'g', port: 1080 }, label: 'g' };
      const r = { ...rules, global: withGlobal };
      const t = resolveRuleTarget('no-match.example.com', r);
      expect(t.kind).toBe('socks5');
      if (t.kind === 'socks5') expect(t.label).toBe('g');
    });

    it('falls back to direct when global is direct', () => {
      expect(resolveRuleTarget('no-match.example.com', rules)).toEqual(DIRECT_TARGET);
    });

    it('falls back to random target when global is random', () => {
      const r = { ...rules, global: { kind: 'random' as const } };
      expect(resolveRuleTarget('no-match.example.com', r)).toEqual({ kind: 'random' });
    });
  });

  describe('findRuleForHost', () => {
    const rules: DomainRule[] = [
      { pattern: '*.example.com', target: DIRECT_TARGET, disabled: false, proxyDns: false },
      { pattern: 'example.com', target: DIRECT_TARGET, disabled: false, proxyDns: false },
    ];
    it('returns first match in array order', () => {
      const r = findRuleForHost('www.example.com', rules);
      expect(r).toBeDefined();
      expect(r!.pattern).toBe('*.example.com');
    });
    it('skips disabled rules', () => {
      const all = [
        { pattern: 'a.com', target: DIRECT_TARGET, disabled: true, proxyDns: false },
      ];
      expect(findRuleForHost('a.com', all)).toBeUndefined();
    });
  });

  describe('isExcluded', () => {
    it('matches wildcard exclusions', () => {
      expect(isExcluded('foo.lan', ['*.lan'])).toBe(true);
    });
    it('matches CIDR exclusions', () => {
      expect(isExcluded('192.168.1.5', ['192.168.0.0/16'])).toBe(true);
    });
  });

  describe('labelForGlobal', () => {
    it('returns Direct for direct', () => {
      expect(labelForGlobal(DIRECT_GLOBAL)).toBe('Direct');
    });
    it('returns Random for random', () => {
      expect(labelForGlobal({ kind: 'random' })).toBe('Random');
    });
    it('returns label for socks5', () => {
      expect(labelForGlobal({ kind: 'socks5', endpoint: { host: 'h', port: 1080 }, label: 'h' })).toBe('h');
    });
  });

  describe('emptyRules', () => {
    it('starts with direct global and no rules', () => {
      const r = emptyRules();
      expect(r.global).toEqual(DIRECT_GLOBAL);
      expect(r.domainRules).toEqual([]);
      expect(r.exclusions).toEqual([]);
    });
  });
});
