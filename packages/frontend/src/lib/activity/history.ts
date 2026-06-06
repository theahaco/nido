import { fetchExpertPage, ExpertUnavailableError } from "./expertSource.js";
import { fetchRpcRecent } from "./rpcSource.js";
import type { ActivityItem, ActivityPage } from "./types.js";

function dedupSort(items: ActivityItem[]): ActivityItem[] {
  const seen = new Map<string, ActivityItem>();
  for (const it of items) if (!seen.has(it.id)) seen.set(it.id, it);
  return [...seen.values()].sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Load a page of activity. Primary source is Stellar Expert (full history,
 * paginated by `cursor`). If Expert is unavailable AND we're loading the first
 * page (no cursor), fall back to the recent-window RPC source.
 */
export async function loadActivityPage(opts: { address: string; cursor?: string | null }): Promise<ActivityPage> {
  const cursor = opts.cursor ?? null;
  try {
    const page = await fetchExpertPage(opts.address, cursor);
    return { ...page, items: dedupSort(page.items) };
  } catch (err) {
    if (err instanceof ExpertUnavailableError && cursor === null) {
      const page = await fetchRpcRecent(opts.address);
      return { ...page, items: dedupSort(page.items) };
    }
    throw err;
  }
}
