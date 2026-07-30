/**
 * IVPN API response types — matched to actual endpoint shapes documented in
 * PLAN.md §2. No fields invented; if IVPN adds more, they belong in a new
 * optional layer, not here.
 */

export interface IvpnServer {
  gateway: string;
  country_code: string;
  country: string;
  city: string;
  load: number;
  status: 'online' | 'offline' | string;
  is_active: boolean;
  in_maintenance: boolean;
  /** SOCKS5 endpoint formatted as "socks5.<gw>.gw.ivpn.net:10.1.x.x" — host:internal-IP, port fixed at 1080. */
  socks5: string;
  /** Optional fields present on some servers but not relied on by the UI. */
  hostname?: string;
  host?: string;
  ipv6?: string;
  pubkey?: string;
}

export interface IvpnGeoLookup {
  ip_address: string;
  country_code: string;
  country: string;
  city: string;
  isp: string;
  longitude: number;
  latitude: number;
  is_vpn: boolean;
}
