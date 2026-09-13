// AUDIT 2026-09-12 (FAIL-L1, P2) — Web Storage access that can never throw.
//
// In Chrome/Edge with "Block all cookies" (or site data blocked), in Safari
// with storage disabled, and inside some sandboxed/enterprise contexts, merely
// READING `window.localStorage` throws a SecurityError. `typeof localStorage`
// evaluates the same getter, so the old `typeof localStorage === 'undefined'`
// guards threw too. One such check ran at module scope (ghl.ts) — the whole
// bundle aborted and the site rendered a blank page for those visitors.
//
// Every storage touch in src/ goes through these helpers. They return null /
// no-op instead of throwing, so the app degrades to memory-only behaviour
// (language falls back to the browser setting, cookie banner re-prompts,
// chat memory lives for the tab only).

export type StorageKind = 'local' | 'session';

function resolve(kind: StorageKind): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    const store = kind === 'local' ? window.localStorage : window.sessionStorage;
    return store ?? null;
  } catch {
    return null;
  }
}

/** The Storage object, or null when the browser denies access. Never throws. */
export function getLocalStorage(): Storage | null { return resolve('local'); }
export function getSessionStorage(): Storage | null { return resolve('session'); }

/** Read a key. Returns null when storage is unavailable or the read throws. */
export function storageGet(kind: StorageKind, key: string): string | null {
  try { return resolve(kind)?.getItem(key) ?? null; } catch { return null; }
}

/** Write a key. Returns false when storage is unavailable or the write throws (quota, private mode). */
export function storageSet(kind: StorageKind, key: string, value: string): boolean {
  try { const s = resolve(kind); if (!s) return false; s.setItem(key, value); return true; } catch { return false; }
}

/** Remove a key. Silent when storage is unavailable. */
export function storageRemove(kind: StorageKind, key: string): void {
  try { resolve(kind)?.removeItem(key); } catch { /* unavailable — nothing to remove */ }
}
