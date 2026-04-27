/**
 * Storage tests. Three flows:
 *   1. Round-trip: save → load → returns same value
 *   2. Forget: save → forget → load returns null
 *   3. Hostile environment: localStorage missing or throws → graceful no-op
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadKey, saveKey, forgetKey, loadProvider, saveProvider } from "../storage";

// ── Polyfill localStorage in bun-test (Node-like) env ────────────────────

class InMemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
}

class ThrowingStorage implements Storage {
  get length(): number {
    return 0;
  }
  clear(): void {
    throw new Error("storage disabled");
  }
  getItem(): string | null {
    throw new Error("storage disabled");
  }
  setItem(): void {
    throw new Error("storage disabled");
  }
  removeItem(): void {
    throw new Error("storage disabled");
  }
  key(): string | null {
    throw new Error("storage disabled");
  }
}

const ORIGINAL = (globalThis as unknown as { localStorage?: Storage }).localStorage;

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = new InMemoryStorage();
});

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  } else {
    (globalThis as unknown as { localStorage: Storage }).localStorage = ORIGINAL;
  }
});

// ── Tests ────────────────────────────────────────────────────────────────

describe("BYOK storage: API key", () => {
  test("loadKey returns null when nothing is stored", () => {
    expect(loadKey()).toBeNull();
  });

  test("saveKey persists the value, loadKey returns it", () => {
    saveKey("sk-test-abc");
    expect(loadKey()).toBe("sk-test-abc");
  });

  test("saveKey overwrites previous value", () => {
    saveKey("sk-old");
    saveKey("sk-new");
    expect(loadKey()).toBe("sk-new");
  });

  test("forgetKey removes the value", () => {
    saveKey("sk-doomed");
    forgetKey();
    expect(loadKey()).toBeNull();
  });

  test("forgetKey is idempotent — safe to call when nothing is stored", () => {
    expect(() => forgetKey()).not.toThrow();
    expect(loadKey()).toBeNull();
  });
});

describe("BYOK storage: provider preference", () => {
  test("loadProvider returns null when nothing is stored", () => {
    expect(loadProvider()).toBeNull();
  });

  test("saveProvider + loadProvider round-trips", () => {
    saveProvider("anthropic");
    expect(loadProvider()).toBe("anthropic");
  });

  test("provider and key are independent", () => {
    saveKey("sk-test");
    saveProvider("google");
    expect(loadKey()).toBe("sk-test");
    expect(loadProvider()).toBe("google");
    forgetKey();
    expect(loadKey()).toBeNull();
    expect(loadProvider()).toBe("google"); // forgetKey doesn't touch provider
  });
});

describe("BYOK storage: hostile environments", () => {
  test("missing localStorage → loadKey returns null without throwing", () => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
    expect(loadKey()).toBeNull();
    expect(() => saveKey("x")).not.toThrow();
    expect(() => forgetKey()).not.toThrow();
  });

  test("throwing localStorage (private browsing, quota) → save/load no-op gracefully", () => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = new ThrowingStorage();
    expect(() => saveKey("x")).not.toThrow();
    expect(loadKey()).toBeNull();
    expect(() => forgetKey()).not.toThrow();
  });
});
