import {
  Account,
  Address,
  Contract,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE, RPC_URL } from "../network.js";

// Same all-zeros dummy source the XLM balance fetch uses (lib/balance.ts) —
// read-only simulations need a source account but never touch it.
const DUMMY_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/**
 * Ledger key of a SAC's Balance entry for a CONTRACT holder. SACs store
 * C-address balances as persistent contract data keyed by
 * vec[symbol("Balance"), holder] (G-address holders use classic trustlines,
 * which never applies to the smart account). Building keys directly lets one
 * getLedgerEntries call probe the whole curated list, instead of one
 * simulation round trip per asset. Exported for tests.
 */
export function sacBalanceLedgerKey(tokenContract: string, holder: string): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(tokenContract).toScAddress(),
      key: xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol("Balance"),
        Address.fromString(holder).toScVal(),
      ]),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
}

/** Amount from a SAC Balance entry's value ({amount, authorized, clawback} map). */
function balanceEntryAmount(val: xdr.LedgerEntryData): bigint | null {
  let native: unknown;
  try {
    native = scValToNative(val.contractData().val());
  } catch {
    return null;
  }
  if (typeof native === "bigint") return native;
  const amount = (native as { amount?: unknown } | null)?.amount;
  return typeof amount === "bigint" ? amount : null;
}

/**
 * Current SAC balances for `holder` across `tokenContracts`, batched into
 * getLedgerEntries calls (RPC caps a call at 200 keys; the curated list plus
 * discoveries stays well under one batch). Tokens with no Balance entry —
 * never held, or archived — read as 0n.
 */
export async function fetchSacBalances(
  tokenContracts: string[],
  holder: string,
  rpcUrl = RPC_URL,
): Promise<Map<string, bigint>> {
  const out = new Map<string, bigint>(tokenContracts.map((t) => [t, 0n]));
  if (tokenContracts.length === 0) return out;

  const server = new rpc.Server(rpcUrl);
  const keys = tokenContracts.map((t) => sacBalanceLedgerKey(t, holder));
  const keyToToken = new Map(keys.map((k, i) => [k.toXDR("base64"), tokenContracts[i]]));

  for (let i = 0; i < keys.length; i += 200) {
    const res = await server.getLedgerEntries(...keys.slice(i, i + 200));
    for (const entry of res.entries) {
      const token = keyToToken.get(entry.key.toXDR("base64"));
      if (!token) continue;
      const amount = balanceEntryAmount(entry.val);
      if (amount !== null) out.set(token, amount);
    }
  }
  return out;
}

/** Read-only simulate `fn(...args)` on `contract`, scValToNative'd; null on any failure. */
async function simulateRead(
  server: rpc.Server,
  contract: string,
  fn: string,
  args: xdr.ScVal[],
): Promise<unknown> {
  const tx = new TransactionBuilder(new Account(DUMMY_SOURCE, "0"), {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(new Contract(contract).call(fn, ...args))
    .setTimeout(0)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) return null;
  const success = sim as rpc.Api.SimulateTransactionSuccessResponse;
  if (!success.result) return null;
  try {
    return scValToNative(success.result.retval);
  } catch {
    return null;
  }
}

export interface TokenProbe {
  balance: bigint;
  decimals: number;
  symbol?: string;
}

type TokenMeta = { decimals: number; symbol?: string };

/**
 * SEP-41 fallback for tokens that aren't SACs: their storage layout is
 * contract-defined, so there is no deterministic Balance ledger key —
 * simulate balance() instead, plus decimals()/symbol() for display. Metadata
 * is immutable, so it's cached in localStorage to keep repeat page loads at
 * one simulation per token. Returns null when the contract isn't a token (or
 * the read fails) so callers can drop the candidate.
 */
export async function probeSep41Token(
  tokenContract: string,
  holder: string,
  rpcUrl = RPC_URL,
): Promise<TokenProbe | null> {
  const server = new rpc.Server(rpcUrl);
  const balance = await simulateRead(server, tokenContract, "balance", [
    Address.fromString(holder).toScVal(),
  ]);
  if (typeof balance !== "bigint") return null;

  const metaKey = `g2c:assets:meta:${tokenContract}`;
  let meta: TokenMeta | null = null;
  try {
    meta = JSON.parse(localStorage.getItem(metaKey) ?? "null") as TokenMeta | null;
  } catch {
    /* corrupt cache — refetch below */
  }
  if (!meta || typeof meta.decimals !== "number") {
    const decimals = await simulateRead(server, tokenContract, "decimals", []);
    const symbol = await simulateRead(server, tokenContract, "symbol", []);
    meta = {
      decimals: typeof decimals === "number" ? decimals : 7,
      symbol: typeof symbol === "string" ? symbol : undefined,
    };
    try {
      localStorage.setItem(metaKey, JSON.stringify(meta));
    } catch {
      /* best-effort cache */
    }
  }
  return { balance, decimals: meta.decimals, symbol: meta.symbol };
}
