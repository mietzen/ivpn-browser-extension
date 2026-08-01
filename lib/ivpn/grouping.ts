import type { IvpnServer } from './types';

export interface ServerGroup {
  countryCode: string;
  country: string;
  cities: CityGroup[];
}

export interface CityGroup {
  city: string;
  servers: IvpnServer[];
}

/** A server the user can actually pick: active and not in maintenance. */
export function isEligibleServer(server: IvpnServer): boolean {
  return server.is_active && !server.in_maintenance;
}

/**
 * Filter to servers the user can actually pick (active and not in maintenance),
 * then group by country → city. Sorted alphabetically with country/city names;
 * servers within a city stay in their original order.
 */
export function groupActiveServers(servers: IvpnServer[]): ServerGroup[] {
  const eligible = servers.filter(isEligibleServer);

  const byCountry = new Map<string, { country: string; cities: Map<string, IvpnServer[]> }>();
  for (const server of eligible) {
    const countryEntry = byCountry.get(server.country_code) ?? {
      country: server.country,
      cities: new Map<string, IvpnServer[]>(),
    };
    const cityList = countryEntry.cities.get(server.city) ?? [];
    cityList.push(server);
    countryEntry.cities.set(server.city, cityList);
    byCountry.set(server.country_code, countryEntry);
  }

  const groups: ServerGroup[] = [];
  for (const [countryCode, { country, cities }] of byCountry) {
    const cityGroups: CityGroup[] = [];
    for (const [city, list] of cities) {
      cityGroups.push({ city, servers: list });
    }
    cityGroups.sort((a, b) => a.city.localeCompare(b.city));
    groups.push({ countryCode, country, cities: cityGroups });
  }
  groups.sort((a, b) => a.country.localeCompare(b.country));
  return groups;
}

/**
 * Find a single server by gateway. Returns undefined if not in list.
 */
export function findServer(servers: IvpnServer[], gateway: string): IvpnServer | undefined {
  return servers.find((s) => s.gateway === gateway);
}

/**
 * Pick a random active server. Optionally exclude a list of gateways
 * (used by the "random but not these" refresh case).
 */
export function pickRandomServer(
  servers: IvpnServer[],
  exclude: string[] = [],
): IvpnServer | null {
  const eligible = servers.filter((s) => isEligibleServer(s) && !exclude.includes(s.gateway));
  if (eligible.length === 0) return null;
  return eligible[Math.floor(Math.random() * eligible.length)] ?? null;
}

/**
 * Case-insensitive substring search across country and city names plus gateway.
 * Returns matching server groups (with empty cities pruned).
 */
export function searchGroups(groups: ServerGroup[], query: string): ServerGroup[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return groups;
  return groups
    .map((g) => ({
      countryCode: g.countryCode,
      country: g.country,
      cities: g.cities
        .map((c) => ({
          city: c.city,
          servers: c.servers.filter(
            (s) =>
              s.gateway.toLowerCase().includes(trimmed) ||
              s.country.toLowerCase().includes(trimmed) ||
              s.city.toLowerCase().includes(trimmed) ||
              s.country_code.toLowerCase().includes(trimmed),
          ),
        }))
        .filter((c) => c.servers.length > 0),
    }))
    .filter((g) => g.cities.length > 0);
}
