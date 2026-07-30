import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  getServers,
  getConnectionStatus,
  parseSocks5Endpoint,
  IvpnApiError,
} from '~/lib/ivpn/client';
import type { IvpnServer, IvpnGeoLookup } from '~/lib/ivpn/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf-8')) as unknown;

const originalFetch = globalThis.fetch;

function mockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ivpn/client', () => {
  it('getServers unwraps the { servers: [...] } envelope response', async () => {
    const fixture = fixtures('servers-stats.json') as { servers: IvpnServer[] };
    globalThis.fetch = (async () => mockJsonResponse(fixture)) as typeof fetch;

    const servers = await getServers();
    expect(servers).toHaveLength(fixture.servers.length);
    expect(servers[0]?.gateway).toBe('us-nyc-wg-001');
  });

  it('getServers accepts a bare array (backwards compat)', async () => {
    const fixture = (fixtures('servers-stats.json') as { servers: IvpnServer[] }).servers;
    globalThis.fetch = (async () => mockJsonResponse(fixture)) as typeof fetch;

    const servers = await getServers();
    expect(servers).toHaveLength(fixture.length);
  });

  it('getServers throws when neither array nor envelope', async () => {
    globalThis.fetch = (async () => mockJsonResponse({ not: 'array' })) as typeof fetch;
    await expect(getServers()).rejects.toBeInstanceOf(IvpnApiError);
  });

  it('getConnectionStatus parses the geo-lookup response', async () => {
    const fixture = fixtures('geo-lookup.json') as IvpnGeoLookup;
    globalThis.fetch = (async () => mockJsonResponse(fixture)) as typeof fetch;

    const status = await getConnectionStatus();
    expect(status.ip_address).toBe('203.0.113.42');
    expect(status.country_code).toBe('US');
    expect(status.isIvpnServer).toBe(true);
  });

  it('getConnectionStatus throws on non-object response', async () => {
    globalThis.fetch = (async () => mockJsonResponse([1, 2, 3])) as typeof fetch;
    await expect(getConnectionStatus()).rejects.toBeInstanceOf(IvpnApiError);
  });

  it('getServers throws on non-2xx status', async () => {
    globalThis.fetch = (async () => mockJsonResponse({}, 503)) as typeof fetch;
    await expect(getServers()).rejects.toThrow(/503/);
  });

  it('parseSocks5Endpoint returns host and the fixed port 1080', () => {
    const server = fixtures('server-us.json') as IvpnServer;
    const ep = parseSocks5Endpoint(server);
    expect(ep.host).toBe('socks5.us-nyc-wg-001.gw.ivpn.net');
    expect(ep.port).toBe(1080);
  });

  it('parseSocks5Endpoint handles socks5 field with no port suffix', () => {
    const server = { ...(fixtures('server-us.json') as IvpnServer), socks5: 'socks5.example.gw.ivpn.net' };
    const ep = parseSocks5Endpoint(server);
    expect(ep.host).toBe('socks5.example.gw.ivpn.net');
    expect(ep.port).toBe(1080);
  });

  it('parseSocks5Endpoint throws on empty field', () => {
    const server = { ...(fixtures('server-us.json') as IvpnServer), socks5: '' };
    expect(() => parseSocks5Endpoint(server)).toThrow(IvpnApiError);
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });
});
