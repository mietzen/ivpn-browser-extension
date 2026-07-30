/**
 * Extension + HTTPS-Only recommendations. Generic — not tied to any specific
 * vendor. Per PLAN.md §3, the recommendation content is the only thing that
 * needs the new copy. uBlock Origin is the de-facto choice for content
 * blockers; HTTPS-Only mode is built into Firefox already.
 */

import { browser } from 'wxt/browser';

export interface ExtensionRecommendation {
  id: string;
  name: string;
  reason: string;
  /** Chrome Web Store / Firefox AMO URLs. We try AMO first on Firefox. */
  storeUrls: { firefox?: string; chrome?: string };
  /** When present, ask the management API whether it's already installed. */
  matchIds?: { firefox?: string[]; chrome?: string[] };
}

export const RECOMMENDATIONS: ExtensionRecommendation[] = [
  {
    id: 'ublock-origin',
    name: 'uBlock Origin',
    reason: 'Lightweight, open-source content blocker. Reduces ads, trackers, and malware pages.',
    storeUrls: {
      firefox: 'https://addons.mozilla.org/firefox/addon/ublock-origin/',
      chrome: 'https://chromewebstore.google.com/detail/ublock-origin/cjpalhdlnbpafiamejdnhcphjbkeiagm',
    },
    matchIds: {
      firefox: ['uBlock0@raymondhill.net'],
      chrome: ['cjpalhdlnbpafiamejdnhcphjbkeiagm'],
    },
  },
];

export interface RecommendationStatus {
  id: string;
  installed: boolean;
  enabled: boolean;
  reason: string;
  installUrl: string;
}

async function detectInstalled(rec: ExtensionRecommendation): Promise<boolean> {
  try {
    const managementApi = (browser as { management?: { getAll: () => Promise<Array<{ id: string }>> } }).management;
    if (!managementApi) return false;
    const all = await managementApi.getAll();
    const ids = all.map((e) => e.id);
    const matchIds = rec.matchIds?.[detectBrowserKey()] ?? [];
    return matchIds.some((id) => ids.includes(id));
  } catch {
    return false;
  }
}

export function detectBrowserKey(): 'firefox' | 'chrome' {
  try {
    const runtime = (browser as { runtime?: { getURL?: (p: string) => string } }).runtime;
    const url = runtime?.getURL ? runtime.getURL('') : '';
    return url.startsWith('moz-extension') ? 'firefox' : 'chrome';
  } catch {
    return 'chrome';
  }
}

export async function scanRecommendations(): Promise<RecommendationStatus[]> {
  const browserKey = detectBrowserKey();
  const results: RecommendationStatus[] = [];
  for (const rec of RECOMMENDATIONS) {
    const installed = await detectInstalled(rec);
    results.push({
      id: rec.id,
      installed,
      enabled: installed,
      reason: rec.reason,
      installUrl: rec.storeUrls[browserKey] ?? rec.storeUrls.chrome ?? '#',
    });
  }
  return results;
}

export async function isHttpsOnlyAvailable(): Promise<boolean> {
  try {
    return typeof (browser as { privacy?: { websites?: { httpsOnlyMode?: unknown } } }).privacy?.websites?.httpsOnlyMode !== 'undefined';
  } catch {
    return false;
  }
}
