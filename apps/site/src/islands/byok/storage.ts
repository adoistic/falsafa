/**
 * BYOK API key storage.
 *
 * The user's API key is sensitive. Storage rules from /plan-eng-review run 2
 * Issue 2.3:
 *  - localStorage (NOT sessionStorage; users want persistence across reloads)
 *  - Reset on demand via Forget button
 *  - Page-level CSP excludes third-party scripts on /try
 *  - input type=password in the UI (auto-redacted by session-replay tools)
 *
 * This module is the storage layer; the UI layer wires the password input
 * + Forget button + state.rememberKey flag.
 */

const KEY_NAME = "falsafa-byok-key";
const PROVIDER_NAME = "falsafa-byok-provider";
const MODEL_NAME = "falsafa-byok-model";

/** Read whatever's persisted. Safe in environments without localStorage. */
export function loadKey(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(KEY_NAME);
  } catch {
    // localStorage may be disabled (private browsing, ITP, quota errors).
    return null;
  }
}

/** Persist the key. Caller is responsible for the rememberKey gate. */
export function saveKey(key: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(KEY_NAME, key);
  } catch {
    /* fall through silently — UI can't recover and user data is in memory anyway */
  }
}

/** Drop the key from local storage. Used by the Forget button. */
export function forgetKey(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(KEY_NAME);
  } catch {
    /* fall through silently */
  }
}

/** Persist the chosen provider so reloads remember the picker selection. */
export function loadProvider(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(PROVIDER_NAME);
  } catch {
    return null;
  }
}

export function saveProvider(provider: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PROVIDER_NAME, provider);
  } catch {
    /* fall through silently */
  }
}

/** Persist the chosen model so reloads remember the picker selection. */
export function loadModel(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(MODEL_NAME);
  } catch {
    return null;
  }
}

export function saveModel(modelId: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(MODEL_NAME, modelId);
  } catch {
    /* fall through silently */
  }
}
