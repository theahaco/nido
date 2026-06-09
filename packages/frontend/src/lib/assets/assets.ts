import { EXPLORER_BASE, NATIVE_SAC_ID } from "../network.js";
import { formatXlm, rawToDecimal } from "../money.js";
import { shortAddr } from "../address.js";
import { fetchCuratedAssets } from "./curated.js";
import { discoverFromEvents } from "./discover.js";
import { loadKnownAssets, saveKnownAssets } from "./store.js";
import { fetchSacBalances, probeSep41Token } from "./balances.js";
import type { AssetCandidate, AssetHolding } from "./types.js";

/** SACs always expose 7 decimals (classic-asset precision). */
export const SAC_DECIMALS = 7;

/**
 * Dedup candidates by contract id. Earlier groups win on conflicts but
 * metadata gaps are backfilled from later ones (the curated list usually has
 * the richest metadata; an event find for the same token adds nothing).
 * Pure — exported for tests.
 */
export function mergeCandidates(...groups: AssetCandidate[][]): AssetCandidate[] {
  const byId = new Map<string, AssetCandidate>();
  for (const group of groups) {
    for (const c of group) {
      const prev = byId.get(c.contractId);
      byId.set(
        c.contractId,
        prev
          ? {
              ...prev,
              code: prev.code ?? c.code,
              issuer: prev.issuer ?? c.issuer,
              domain: prev.domain ?? c.domain,
              decimals: prev.decimals ?? c.decimals,
              sac: prev.sac || c.sac,
            }
          : c,
      );
    }
  }
  return [...byId.values()];
}

/**
 * Display order: XLM first, then alphabetical by code, codeless tokens last.
 * Pure — exported for tests.
 */
export function sortHoldings(items: AssetHolding[]): AssetHolding[] {
  return [...items].sort((a, b) => {
    if (a.contractId === NATIVE_SAC_ID) return -1;
    if (b.contractId === NATIVE_SAC_ID) return 1;
    return a.code.localeCompare(b.code, "en");
  });
}

function toHolding(c: AssetCandidate, raw: bigint, decimals: number): AssetHolding {
  return {
    contractId: c.contractId,
    code: c.code ?? shortAddr(c.contractId, 4, 4),
    issuer: c.issuer,
    domain: c.domain,
    decimals,
    raw,
    formatted: formatXlm(rawToDecimal(raw, decimals)),
    explorerUrl: `${EXPLORER_BASE}/contract/${c.contractId}`,
  };
}

/**
 * All assets the account holds, best-effort within a static frontend's reach.
 *
 * Candidates: native XLM (always) + the curated SEP-42 testnet list + tokens
 * seen in recent transfer events + this browser's persisted finds. Balances:
 * ONE batched ledger-entry read for SAC-backed assets, a balance() simulation
 * per non-SAC SEP-41 token. Full enumeration of an arbitrary C-address is not
 * possible without an indexer today — Horizon can't see contract balances at
 * all and RPC has no portfolio API (issue #71 documents the research) — so a
 * token outside the curated list that hasn't moved in ~7 days and was never
 * seen by this browser is missed until it next moves.
 *
 * Zero balances are hidden, except XLM which anchors the list.
 */
export async function loadAssets(address: string): Promise<AssetHolding[]> {
  const native: AssetCandidate = {
    contractId: NATIVE_SAC_ID,
    code: "XLM",
    domain: "stellar.org",
    sac: true,
    source: "native",
  };
  const [curated, discovered] = await Promise.all([
    fetchCuratedAssets(),
    discoverFromEvents(address),
  ]);
  const stored = loadKnownAssets(address);
  const candidates = mergeCandidates([native], curated, discovered, stored);

  // Persist non-curated finds so they outlive RPC's ~7-day event window.
  saveKnownAssets(address, discovered);

  const sacs = candidates.filter((c) => c.sac);
  const others = candidates.filter((c) => !c.sac);

  const holdings: AssetHolding[] = [];

  const sacBalances = await fetchSacBalances(sacs.map((c) => c.contractId), address);
  for (const c of sacs) {
    const raw = sacBalances.get(c.contractId) ?? 0n;
    if (raw <= 0n && c.contractId !== NATIVE_SAC_ID) continue;
    holdings.push(toHolding(c, raw, SAC_DECIMALS));
  }

  for (const c of others) {
    const probe = await probeSep41Token(c.contractId, address).catch(() => null);
    if (!probe || probe.balance <= 0n) continue;
    holdings.push(
      toHolding({ ...c, code: c.code ?? probe.symbol }, probe.balance, c.decimals ?? probe.decimals),
    );
  }

  return sortHoldings(holdings);
}
