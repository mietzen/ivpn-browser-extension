/**
 * Extension + HTTPS-Only helpers. Kept thin — the recommendation list
 * itself is empty by design (no third-party extension promotion in the
 * community build). `isHttpsOnlyAvailable` is still used by the options
 * privacy tab to surface a Firefox-specific nudge.
 */

import { browser } from 'wxt/browser';

export interface ExtensionRecommendation {
  id: string;
  name: string;
  reason: string;
  storeUrls: { firefox?: string; chrome?: string };
  matchIds?: { firefox?: string[]; chrome?: string[] };
}

export const RECOMMENDATIONS: ExtensionRecommendation[] = [];

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
