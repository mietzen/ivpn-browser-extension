import { describe, it, expect } from 'vitest';
import { patternMatches } from '~/lib/proxy/pattern';

describe('proxy/pattern', () => {
  describe('exact + parent-domain', () => {
    it('matches the host itself', () => {
      expect(patternMatches('github.com', 'github.com')).toBe(true);
    });
    it('matches subdomains', () => {
      expect(patternMatches('www.github.com', 'github.com')).toBe(true);
      expect(patternMatches('api.staging.github.com', 'github.com')).toBe(true);
    });
    it('does not match unrelated hosts', () => {
      expect(patternMatches('notgithub.com', 'github.com')).toBe(false);
      expect(patternMatches('github.io', 'github.com')).toBe(false);
    });
    it('ignores trailing dots', () => {
      expect(patternMatches('example.com.', 'example.com')).toBe(true);
      expect(patternMatches('example.com', 'example.com.')).toBe(true);
    });
    it('is case-insensitive', () => {
      expect(patternMatches('GITHUB.COM', 'github.com')).toBe(true);
    });
  });

  describe('wildcard prefix (*.example.com)', () => {
    it('matches direct subdomains', () => {
      expect(patternMatches('www.example.com', '*.example.com')).toBe(true);
      expect(patternMatches('api.example.com', '*.example.com')).toBe(true);
    });
    it('does not match deeper subdomains', () => {
      expect(patternMatches('a.b.example.com', '*.example.com')).toBe(false);
    });
    it('does not match the apex itself', () => {
      expect(patternMatches('example.com', '*.example.com')).toBe(false);
    });
    it('does not match unrelated hosts', () => {
      expect(patternMatches('notexample.com', '*.example.com')).toBe(false);
    });
  });

  describe('bare *', () => {
    it('matches any host', () => {
      expect(patternMatches('github.com', '*')).toBe(true);
      expect(patternMatches('a.b.c.d.e', '*')).toBe(true);
    });
  });

  describe('IPv4 CIDR', () => {
    it('matches IPs in range', () => {
      expect(patternMatches('192.168.1.5', '192.168.0.0/16')).toBe(true);
      expect(patternMatches('10.0.0.1', '10.0.0.0/8')).toBe(true);
      expect(patternMatches('172.16.0.1', '172.16.0.0/12')).toBe(true);
    });
    it('rejects IPs outside range', () => {
      expect(patternMatches('192.169.0.1', '192.168.0.0/16')).toBe(false);
      expect(patternMatches('11.0.0.1', '10.0.0.0/8')).toBe(false);
    });
    it('handles /32 exact match', () => {
      expect(patternMatches('192.168.1.5', '192.168.1.5/32')).toBe(true);
      expect(patternMatches('192.168.1.6', '192.168.1.5/32')).toBe(false);
    });
    it('handles /0 match-all', () => {
      expect(patternMatches('8.8.8.8', '0.0.0.0/0')).toBe(true);
    });
    it('rejects invalid host for IPv4 CIDR', () => {
      expect(patternMatches('not.an.ip', '192.168.0.0/16')).toBe(false);
    });
  });

  describe('IPv6 CIDR', () => {
    it('matches IPv6 in range', () => {
      expect(patternMatches('fe80::1', 'fe80::/10')).toBe(true);
      expect(patternMatches('2001:db8::1', '2001:db8::/32')).toBe(true);
    });
    it('rejects IPv6 outside range', () => {
      expect(patternMatches('2002:db8::1', '2001:db8::/32')).toBe(false);
    });
    it('handles /128 exact', () => {
      expect(patternMatches('::1', '::1/128')).toBe(true);
    });
  });

  describe('rejects invalid patterns', () => {
    it('rejects empty host or pattern', () => {
      expect(patternMatches('', 'github.com')).toBe(false);
      expect(patternMatches('github.com', '')).toBe(false);
    });
  });
});
