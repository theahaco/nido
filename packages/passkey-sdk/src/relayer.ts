/**
 * Pure relayer client for the Channels plugin protocol.
 *
 * No environment coupling: callers supply `baseUrl` explicitly. The frontend
 * shim adds its `PUBLIC_RELAYER_URL` default, and dApps can pass their own.
 */
import type { Transaction } from "@stellar/stellar-sdk";

/** Statuses emitted by the Channels plugin. */
export type RelayerStatus = "pending" | "sent" | "submitted" | "confirmed" | "failed" | "expired";

export interface RelayerTxResponse {
  transactionId: string | null;
  hash: string | null;
  status: RelayerStatus | null;
}

export class RelayerError extends Error {
  override name = "RelayerError";

  constructor(
    message: string,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** POST {params} to the /relay route. Handles both observed response nestings:
 *  {success, data: {...}} and {success, data: {result: {...}}}. */
async function call(params: Record<string, unknown>, baseUrl: string): Promise<RelayerTxResponse> {
  if (!baseUrl) throw new RelayerError("Relayer not configured (PUBLIC_RELAYER_URL is empty)");
  const resp = await fetch(`${baseUrl}/relay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ params }),
  });

  let body: { success?: boolean; data?: unknown; error?: string | null };
  try {
    body = (await resp.json()) ?? {};
  } catch {
    throw new RelayerError(`Relayer returned non-JSON (HTTP ${resp.status})`);
  }

  if (body.success === false || (!resp.ok && body.error)) {
    const data = body.data as { code?: string; details?: unknown } | undefined;
    throw new RelayerError(body.error ?? `Relayer HTTP ${resp.status}`, data?.code, data?.details);
  }
  if (!resp.ok) throw new RelayerError(`Relayer HTTP ${resp.status}`);

  const data = body.data as ({ result?: RelayerTxResponse } & RelayerTxResponse) | undefined;
  const payload = data?.result ?? data;
  if (!payload || typeof payload !== "object") throw new RelayerError("Relayer returned an empty payload");
  if (!("transactionId" in payload) && !("status" in payload)) {
    throw new RelayerError("Unrecognized relayer payload", undefined, body);
  }
  return payload as RelayerTxResponse;
}

/** Submit host function + pre-signed auth entries (both base64 XDR). */
export async function submitSorobanTransaction(
  args: { func: string; auth: string[]; skipWait?: boolean },
  baseUrl: string,
): Promise<RelayerTxResponse> {
  return call({ func: args.func, auth: args.auth, skipWait: args.skipWait ?? true }, baseUrl);
}

export async function getRelayerTransaction(
  transactionId: string,
  baseUrl: string,
): Promise<RelayerTxResponse> {
  return call({ getTransaction: { transactionId } }, baseUrl);
}

export async function waitForConfirmation(
  transactionId: string,
  baseUrl: string,
  opts?: { intervalMs?: number; maxAttempts?: number },
): Promise<RelayerTxResponse> {
  const interval = opts?.intervalMs ?? 1500;
  const maxAttempts = opts?.maxAttempts ?? 55;
  let last: RelayerTxResponse | undefined;
  let pollFailures = 0;

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await getRelayerTransaction(transactionId, baseUrl);
      last = res;
      pollFailures = 0;
      if (res.status === "confirmed") return res;
      if (res.status === "failed" || res.status === "expired") {
        throw new RelayerError(`Relayer transaction ${res.status}`, "ONCHAIN_FAILED", res);
      }
    } catch (err) {
      if (err instanceof RelayerError && err.code === "ONCHAIN_FAILED") throw err;
      if (++pollFailures >= 5) {
        throw new RelayerError("Lost contact with the relayer while waiting", "WAIT_TIMEOUT", last);
      }
    }

    if (i < maxAttempts - 1) await new Promise((r) => setTimeout(r, interval));
  }

  throw new RelayerError("Timed out waiting for relayer confirmation", "WAIT_TIMEOUT", last);
}

/** Pull the base64 HostFunction + auth-entry XDRs off a built invoke tx. */
export function extractFuncAndAuth(tx: Transaction): { func: string; auth: string[] } {
  const op = tx.toEnvelope().v1().tx().operations()[0].body().invokeHostFunctionOp();
  return {
    func: op.hostFunction().toXDR("base64"),
    auth: op.auth().map((a) => a.toXDR("base64")),
  };
}
