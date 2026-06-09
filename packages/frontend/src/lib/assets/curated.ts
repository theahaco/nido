import { NATIVE_SAC_ID, NETWORK_NAME } from "../network.js";
import { sanitizeDecimals } from "./balances.js";
import type { AssetCandidate } from "./types.js";

/**
 * SEP-42 curated asset list — Stellar Expert's top-50, the same default list
 * Freighter ships for testnet. Unlike Stellar Expert's balance and `/tx`
 * APIs (origin-gated: 403 to third-party browser Origins), the asset-list
 * route is served with `access-control-allow-origin: *`, so this static
 * frontend can fetch it directly. Each entry carries the asset's SAC
 * contract id, which is what the balance probe needs (issue #71).
 */
export const CURATED_LIST_URL =
  `https://api.stellar.expert/explorer/${NETWORK_NAME}/asset-list/top50`;

const CACHE_KEY = "g2c:assets:curated";

const isContractId = (s: unknown): s is string =>
  typeof s === "string" && /^C[A-Z2-7]{55}$/.test(s);

/**
 * Parse a SEP-42 asset-list document into candidates. Entries without a valid
 * SAC contract id are dropped; the native XLM entry is dropped too (XLM is
 * added unconditionally by the orchestrator). Pure — exported for tests.
 */
export function parseAssetList(doc: unknown): AssetCandidate[] {
  const assets = (doc as { assets?: unknown } | null)?.assets;
  if (!Array.isArray(assets)) return [];
  const out: AssetCandidate[] = [];
  for (const entry of assets) {
    const e = entry as Record<string, unknown>;
    if (!isContractId(e.contract) || e.contract === NATIVE_SAC_ID) continue;
    // Normalize empty strings to absent — "" would win ?? / || fallback
    // chains downstream and render a blank row title.
    const issuer = typeof e.issuer === "string" && e.issuer ? e.issuer : undefined;
    out.push({
      contractId: e.contract,
      code: typeof e.code === "string" && e.code ? e.code : undefined,
      issuer,
      domain: typeof e.domain === "string" && e.domain ? e.domain : undefined,
      decimals: sanitizeDecimals(e.decimals) ?? undefined,
      // A classic issuer means the contract is that asset's SAC; entries
      // without one are standalone Soroban tokens (custom storage layout).
      sac: issuer !== undefined,
      source: "curated",
    });
  }
  return out;
}

/**
 * Fetch the curated list, falling back to the last good copy cached in
 * localStorage when the network or the list service is down. Returns [] when
 * neither is available — the assets card still shows XLM + discovered tokens.
 */
export async function fetchCuratedAssets(): Promise<AssetCandidate[]> {
  try {
    const res = await fetch(CURATED_LIST_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc: unknown = await res.json();
    const parsed = parseAssetList(doc);
    if (parsed.length > 0) {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(doc));
      } catch {
        /* storage full/blocked — caching is best-effort */
      }
    }
    return parsed;
  } catch {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) return parseAssetList(JSON.parse(cached));
    } catch {
      /* corrupt cache — treat as absent */
    }
    return [];
  }
}
