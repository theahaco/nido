import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Address, nativeToScVal, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { sacBalanceLedgerKey, fetchSacBalances, probeSep41Token } from "./balances.js";

const HOLDER = "CCA2KXEUA4EQW3NL4QRCIZ2VRMA7V6A54DHXPA4RBTAGH72PCCYT5MSA";
const USDC_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const OTHER_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const SEP41_TOKEN = "CCXLTPPNPNJ45QG4JG2YQWLOC4IMSRJ7KCF5RYF5BGT62SZGA3XDGKXQ";

/** A SAC Balance entry value: map { amount: i128, authorized, clawback }. */
function balanceVal(amount: bigint): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("amount"), val: nativeToScVal(amount, { type: "i128" }) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("authorized"), val: xdr.ScVal.scvBool(true) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("clawback"), val: xdr.ScVal.scvBool(false) }),
  ]);
}

/** Duck-typed LedgerEntryResult: fetchSacBalances only touches key + val.contractData().val(). */
function entryFor(token: string, amount: bigint) {
  return {
    key: sacBalanceLedgerKey(token, HOLDER),
    val: { contractData: () => ({ val: () => balanceVal(amount) }) },
  };
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("sacBalanceLedgerKey", () => {
  it("builds the persistent contract-data key vec[Balance, holder]", () => {
    const key = sacBalanceLedgerKey(USDC_SAC, HOLDER).contractData();
    expect(Address.fromScAddress(key.contract()).toString()).toBe(USDC_SAC);
    expect(key.durability()).toBe(xdr.ContractDataDurability.persistent());
    const vec = key.key().vec()!;
    expect(scValToNative(vec[0])).toBe("Balance");
    expect(scValToNative(vec[1])).toBe(HOLDER);
  });
});

describe("fetchSacBalances", () => {
  it("batches one getLedgerEntries call and reads amounts; missing entries are 0n", async () => {
    const spy = vi
      .spyOn(rpc.Server.prototype, "getLedgerEntries")
      .mockResolvedValue({ latestLedger: 1, entries: [entryFor(USDC_SAC, 123_0000000n)] } as never);

    const balances = await fetchSacBalances([USDC_SAC, OTHER_SAC], HOLDER);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toHaveLength(2); // both keys in one variadic call
    expect(balances.get(USDC_SAC)).toBe(123_0000000n);
    expect(balances.get(OTHER_SAC)).toBe(0n);
  });

  it("makes no RPC call for an empty token list", async () => {
    const spy = vi.spyOn(rpc.Server.prototype, "getLedgerEntries");
    expect((await fetchSacBalances([], HOLDER)).size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("probeSep41Token", () => {
  function simResult(retval: xdr.ScVal) {
    return { result: { retval }, latestLedger: 1 } as never;
  }

  it("simulates balance/decimals/symbol and caches metadata", async () => {
    const spy = vi
      .spyOn(rpc.Server.prototype, "simulateTransaction")
      .mockResolvedValueOnce(simResult(nativeToScVal(42_000_000n, { type: "i128" })))
      .mockResolvedValueOnce(simResult(nativeToScVal(6, { type: "u32" })))
      .mockResolvedValueOnce(simResult(nativeToScVal("SOBA", { type: "string" })));

    expect(await probeSep41Token(SEP41_TOKEN, HOLDER)).toEqual({
      balance: 42_000_000n,
      decimals: 6,
      symbol: "SOBA",
    });
    expect(spy).toHaveBeenCalledTimes(3);

    // Second probe: metadata comes from the localStorage cache — 1 simulation.
    spy.mockClear();
    spy.mockResolvedValueOnce(simResult(nativeToScVal(43_000_000n, { type: "i128" })));
    expect(await probeSep41Token(SEP41_TOKEN, HOLDER)).toEqual({
      balance: 43_000_000n,
      decimals: 6,
      symbol: "SOBA",
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("returns null when the contract isn't a token (simulation errors)", async () => {
    vi.spyOn(rpc.Server.prototype, "simulateTransaction")
      .mockResolvedValue({ error: "host invocation failed", latestLedger: 1 } as never);
    expect(await probeSep41Token(SEP41_TOKEN, HOLDER)).toBeNull();
  });
});
