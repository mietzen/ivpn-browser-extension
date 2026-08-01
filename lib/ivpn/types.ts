/**
 * IVPN API response types — matched to actual endpoint shapes. Fields are kept
 * permissive (mostly optional) to absorb IVPN API drift without breaking the
 * extension.
 */

export interface IvpnServer {
  gateway: string;
  country_code: string;
  country: string;
  city: string;
  load: number;
  status: number | string;
  is_active: boolean;
  in_maintenance: boolean;
  /** SOCKS5 endpoint formatted as "socks5.<gw>.gw.ivpn.net:10.1.x.x" — host:internal-IP, port fixed at 1080. */
  socks5: string;
  /** Newer endpoints may include additional diagnostic fields. */
  hostnames?: { openvpn?: string; wireguard?: string };
  hosts?: { openvpn?: { host: string; hostname: string }; wireguard?: { host: string; hostname: string } };
  isp?: string;
  latitude?: number;
  longitude?: number;
  protocols?: string[];
  wg_public_key?: string;
  multihop_port?: number;
  obfs?: { obfs3_multihop_port?: number; obfs4_multihop_port?: number; obfs4_key?: string };
}

export interface IvpnGeoLookup {
  ip_address: string;
  country_code: string;
  country: string;
  city: string;
  isp: string;
  longitude: number;
  latitude: number;
  isIvpnServer: boolean;
  organization?: string;
}
