/**
 * IVPN public API client.
 *
 * Endpoints used (see PLAN.md §2):
 *   GET https://api.ivpn.net/v5/servers/stats
 *   GET https://api.ivpn.net/v4/geo-lookup
 *
 * No auth required. Session/account endpoints deliberately not used — those
 * belong to the desktop client. This extension assumes the desktop app is
 * already connected.
 */

import type { IvpnGeoLookup, IvpnServer } from './types';

const BASE_URL = 'https://api.ivpn.net';
const SOCKS5_PORT = 1080;
const DEFAULT_TIMEOUT_MS = 10_000;
const GEO_LOOKUP_TIMEOUT_MS = 6_000;

export class IvpnApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'IvpnApiError';
  }
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getJson<T>(path: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const url = `${BASE_URL}${path}`;
  let response: Response;
  try {
    response = await fetchWithTimeout(url, timeoutMs, {
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    throw new IvpnApiError(`Network error contacting ${url}`, undefined, err);
  }
  if (!response.ok) {
    throw new IvpnApiError(`IVPN API ${path} returned ${response.status}`, response.status);
  }
  try {
    return (await response.json()) as T;
  } catch (err) {
    throw new IvpnApiError(`Invalid JSON from ${path}`, response.status, err);
  }
}

function asArray(raw: unknown): IvpnServer[] {
  if (!Array.isArray(raw)) {
    throw new IvpnApiError('Expected array from /v5/servers/stats');
  }
  return raw as IvpnServer[];
}

function asObject(raw: unknown): IvpnGeoLookup {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new IvpnApiError('Expected object from /v4/geo-lookup');
  }
  return raw as IvpnGeoLookup;
}

export async function getServers(): Promise<IvpnServer[]> {
  const raw = await getJson<unknown>('/v5/servers/stats');
  return asArray(raw);
}

export async function getConnectionStatus(): Promise<IvpnGeoLookup> {
  const raw = await getJson<unknown>('/v4/geo-lookup', GEO_LOOKUP_TIMEOUT_MS);
  return asObject(raw);
}

/**
 * Pull a SOCKS5 host out of the `socks5` field.
 *
 * Per PLAN.md §2, the field is formatted
 *   "socks5.<gw>.gw.ivpn.net:10.1.x.x"
 * — that is hostname:internal-IP, not host:port. We split on the first `:` and
 * use whatever precedes it, then pair with the fixed port 1080.
 */
export function parseSocks5Endpoint(server: IvpnServer): { host: string; port: number } {
  if (typeof server.socks5 !== 'string' || server.socks5.length === 0) {
    throw new IvpnApiError(`Server ${server.gateway} has no socks5 endpoint`);
  }
  const colonIndex = server.socks5.indexOf(':');
  const host = colonIndex === -1 ? server.socks5 : server.socks5.slice(0, colonIndex);
  if (!host) {
    throw new IvpnApiError(`Server ${server.gateway} socks5 field has no host part`);
  }
  return { host, port: SOCKS5_PORT };
}

export const IVPN_CONSTANTS = {
  BASE_URL,
  SOCKS5_PORT,
} as const;
