// Vitest setup — provide a minimal browser API stub for unit tests so
// modules that touch wxt/browser can import without throwing.
import { vi } from 'vitest';

type Listener = (...args: unknown[]) => unknown;

const browserStub = {
  runtime: {
    onInstalled: { addListener: (_l: Listener) => undefined },
    onStartup: { addListener: (_l: Listener) => undefined },
    onMessage: { addListener: (_l: Listener) => undefined },
    sendMessage: vi.fn(async () => undefined),
    openOptionsPage: vi.fn(async () => undefined),
    getURL: vi.fn((p: string) => `chrome-extension://test/${p}`),
  },
  action: {
    setBadgeText: vi.fn(async () => undefined),
    setBadgeBackgroundColor: vi.fn(async () => undefined),
  },
  browserAction: {
    setBadgeText: vi.fn(async () => undefined),
    setBadgeBackgroundColor: vi.fn(async () => undefined),
  },
  storage: {
    local: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    },
  },
  proxy: {
    onRequest: { addListener: (_l: Listener) => undefined, removeListener: (_l: Listener) => undefined },
    settings: { set: vi.fn(async () => undefined), clear: vi.fn(async () => undefined) },
  },
  privacy: {
    network: { peerConnectionEnabled: { set: vi.fn(async () => undefined) } },
    websites: { httpsOnlyMode: { get: vi.fn(async () => ({ value: 'off' })) } },
  },
  tabs: {},
  management: { getAll: vi.fn(async () => []) },
};

(globalThis as unknown as { browser: typeof browserStub }).browser = browserStub;

// Stub wxt/storage to use an in-memory map.
vi.mock('wxt/storage', () => {
  const memStore = new Map<string, unknown>();
  return {
    storage: {
      getItem: async <T>(key: string): Promise<T | null> => (memStore.get(key) as T | null) ?? null,
      setItem: async (key: string, value: unknown): Promise<void> => {
        memStore.set(key, value);
      },
      removeItem: async (key: string): Promise<void> => {
        memStore.delete(key);
      },
    },
  };
});

vi.mock('wxt/browser', () => ({ browser: browserStub }));

// Stub wxt/sandbox defineBackground to be a no-op.
vi.mock('wxt/sandbox', () => ({ defineBackground: (fn: () => void) => fn }));
