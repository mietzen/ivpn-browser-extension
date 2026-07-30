import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  groupActiveServers,
  searchGroups,
  findServer,
  pickRandomServer,
} from '~/lib/ivpn/grouping';
import type { IvpnServer } from '~/lib/ivpn/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const loadServers = (): IvpnServer[] =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', 'servers-stats.json'), 'utf-8')) as IvpnServer[];

describe('ivpn/grouping', () => {
  it('filters out inactive and in-maintenance servers', () => {
    const groups = groupActiveServers(loadServers());
    const gateways = groups.flatMap((g) => g.cities.flatMap((c) => c.servers.map((s) => s.gateway)));
    expect(gateways).toContain('us-nyc-wg-001');
    expect(gateways).toContain('de-fra-wg-001');
    expect(gateways).not.toContain('de-fra-wg-maint');
    expect(gateways).not.toContain('jp-tok-wg-001');
  });

  it('groups by country then city, sorted alphabetically', () => {
    const groups = groupActiveServers(loadServers());
    expect(groups.map((g) => g.countryCode)).toEqual(['DE', 'US']);
    const us = groups.find((g) => g.countryCode === 'US')!;
    expect(us.cities.map((c) => c.city)).toEqual(['New York', 'San Francisco']);
  });

  it('searchGroups matches by country, city, gateway, or code', () => {
    const groups = groupActiveServers(loadServers());
    expect(searchGroups(groups, 'frank').map((g) => g.countryCode)).toEqual(['DE']);
    expect(searchGroups(groups, 'us-').map((g) => g.countryCode)).toEqual(['US']);
    expect(searchGroups(groups, 'tok').map((g) => g.countryCode)).toEqual([]);
    expect(searchGroups(groups, '').length).toBeGreaterThan(0);
  });

  it('findServer returns the matching gateway or undefined', () => {
    const servers = loadServers();
    expect(findServer(servers, 'us-nyc-wg-001')?.city).toBe('New York');
    expect(findServer(servers, 'does-not-exist')).toBeUndefined();
  });

  it('pickRandomServer never returns excluded gateways', () => {
    const servers = loadServers();
    const chosen = pickRandomServer(servers, ['us-nyc-wg-001', 'us-nyc-wg-002', 'us-sfo-wg-001']);
    expect(chosen?.gateway).toBe('de-fra-wg-001');
  });

  it('pickRandomServer returns null when no eligible remain', () => {
    const servers = loadServers().filter((s) => s.is_active && !s.in_maintenance);
    const chosen = pickRandomServer(servers, servers.map((s) => s.gateway));
    expect(chosen).toBeNull();
  });
});
