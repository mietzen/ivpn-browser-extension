/**
 * WebRTC leak detection + Firefox-only disable toggle.
 *
 * Per PLAN.md §3:
 *   - Leak detection: client-side only (RTCPeerConnection ICE candidate
 *     gathering), portable to both browsers.
 *   - Disable: uses browser.privacy.network.peerConnectionEnabled, Firefox-only.
 *     Chrome build detects and warns, but can't offer the one-click disable
 *     button.
 */

import { browser } from 'wxt/browser';

export interface LeakCheckResult {
  hasWebRtc: boolean;
  leakedAddresses: string[];
  error?: string;
}

export async function detectWebRtcLeak(): Promise<LeakCheckResult> {
  if (typeof RTCPeerConnection === 'undefined') {
    return { hasWebRtc: false, leakedAddresses: [] };
  }
  return new Promise<LeakCheckResult>((resolve) => {
    const leaked = new Set<string>();
    const seenPublic = new Set<string>();
    let pc: RTCPeerConnection | null = null;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      try { pc?.close(); } catch { /* ignore */ }
      resolve({
        hasWebRtc: true,
        leakedAddresses: Array.from(leaked),
      });
    };

    const timeoutId = setTimeout(finish, 5000);

    try {
      pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      pc.onicecandidate = (e) => {
        if (!e.candidate) {
          clearTimeout(timeoutId);
          finish();
          return;
        }
        const cand = e.candidate.candidate;
        const match = cand.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
        if (!match) return;
        const ip = match[1]!;
        if (isPublicIp(ip) && !seenPublic.has(ip)) {
          seenPublic.add(ip);
          leaked.add(ip);
        }
      };
      pc.createDataChannel('');
      pc.createOffer()
        .then((offer) => pc?.setLocalDescription(offer))
        .catch((err) => {
          clearTimeout(timeoutId);
          resolve({ hasWebRtc: true, leakedAddresses: [], error: (err as Error).message });
        });
    } catch (err) {
      clearTimeout(timeoutId);
      resolve({ hasWebRtc: false, leakedAddresses: [], error: (err as Error).message });
    }
  });
}

function isPublicIp(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return false;
  if (a === 127) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false;
  if (a === 0) return false;
  if (a >= 224) return false;
  return true;
}

export function isWebRtcDisableSupported(): boolean {
  try {
    return !!(browser as { privacy?: { network?: { peerConnectionEnabled?: unknown } } }).privacy?.network?.peerConnectionEnabled;
  } catch {
    return false;
  }
}

export async function refreshWebRtcSetting(enabled: boolean, applied: boolean): Promise<void> {
  if (!isWebRtcDisableSupported()) return;
  const api = (browser as unknown as {
    privacy: { network: { peerConnectionEnabled: { set: (d: { value: boolean }) => Promise<void> } } };
  }).privacy.network.peerConnectionEnabled;
  if (enabled) {
    await api.set({ value: true });
    return;
  }
  if (applied) {
    await api.set({ value: false });
  }
}
