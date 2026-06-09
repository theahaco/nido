import type { AssetCandidate } from "./types.js";

// Cap the persisted set so a hostile token spray can't grow localStorage (and
// the balance probe) without bound. Oldest entries are dropped first.
const MAX_STORED = 100;

const storageKey = (account: string) => `g2c:assets:known:${account}`;

/**
 * Tokens this browser has seen the account hold or move. Event discovery only
 * reaches ~7 days back (RPC retention), so persisting finds is what keeps a
 * long-held token on the list after its transfers age out of the window.
 */
export function loadKnownAssets(account: string): AssetCandidate[] {
  try {
    const raw = localStorage.getItem(storageKey(account));
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((a): a is AssetCandidate => typeof (a as AssetCandidate)?.contractId === "string")
      .map((a) => ({ ...a, source: "stored" as const }));
  } catch {
    return [];
  }
}

/** Merge `assets` into the persisted set (deduped by contract id). */
export function saveKnownAssets(account: string, assets: AssetCandidate[]): void {
  if (assets.length === 0) return;
  try {
    const merged = new Map(loadKnownAssets(account).map((a) => [a.contractId, a]));
    for (const a of assets) if (!merged.has(a.contractId)) merged.set(a.contractId, a);
    const trimmed = [...merged.values()].slice(-MAX_STORED);
    localStorage.setItem(storageKey(account), JSON.stringify(trimmed));
  } catch {
    /* storage full/blocked — discovery just won't persist */
  }
}
