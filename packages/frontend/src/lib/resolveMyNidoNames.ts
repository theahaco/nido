import type { MyNidoRow } from "./myNidoModel.js";

/**
 * Fill in on-chain registry names for active rows that lack a locally-cached
 * name, and persist each hit so later renders are instant. The My Nido menu
 * otherwise shows a name only when this browser previously claimed it or
 * visited its name subdomain — so a contract whose name lives only in the
 * registry rendered nameless ("Your Nido" + raw address).
 *
 * Independent of the DOM and the SDK: `lookup` is a contract-id → name resolver
 * (typically the registry reverse lookup) and `persist` writes the cache.
 * Best-effort — a row whose lookup rejects or returns null is left unchanged.
 *
 * @returns a map of the names newly resolved this pass (contractId → name),
 *   so the caller can patch just those rows in place.
 */
export async function resolveMissingNames(
  rows: MyNidoRow[],
  lookup: (contractId: string) => Promise<string | null>,
  persist: (contractId: string, name: string) => void,
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();

  // Pending rows can't have a registered name yet (not deployed); rows that
  // already carry a name need no network round-trip.
  const candidates = rows.filter((r) => r.status === "active" && !r.name);

  await Promise.all(
    candidates.map(async (row) => {
      try {
        const name = await lookup(row.contractId);
        if (name) {
          persist(row.contractId, name);
          resolved.set(row.contractId, name);
        }
      } catch {
        /* best-effort: a single registry failure must not blank other rows */
      }
    }),
  );

  return resolved;
}
