import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Address, nativeToScVal, rpc, xdr } from "@stellar/stellar-sdk";
import { loadAssets, mergeCandidates, sortHoldings } from "./assets.js";
import { sacBalanceLedgerKey } from "./balances.js";
import { NATIVE_SAC_ID } from "../network.js";
import type { AssetCandidate, AssetHolding } from "./types.js";

const SELF = "CCA2KXEUA4EQW3NL4QRCIZ2VRMA7V6A54DHXPA4RBTAGH72PCCYT5MSA";
const ISSUER = "GCQZN6KXTEATCRNES3ZPTPZV4NNVK7CZKA6RHLMP2HPWP7SPDN7MFGBS";
const USDC_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

const cand = (contractId: string, extra: Partial<AssetCandidate> = {}): AssetCandidate => ({
  contractId,
  sac: false,
  source: "events",
  ...extra,
});

describe("mergeCandidates", () => {
  it("dedups by contract id; earlier groups win but gaps are backfilled", () => {
    const merged = mergeCandidates(
      [cand(USDC_SAC, { code: "USDC", source: "curated", sac: true })],
      [cand(USDC_SAC, { code: "WRONG", issuer: ISSUER, domain: "centre.io" })],
    );
    expect(merged).toEqual([
      {
        contractId: USDC_SAC,
        code: "USDC",          // first group's value kept
        issuer: ISSUER,        // gap backfilled from the later group
        domain: "centre.io",
        decimals: undefined,
        sac: true,
        source: "curated",
      },
    ]);
  });

  it("ORs the sac flag so an event-only SAC sighting upgrades a stored entry", () => {
    const merged = mergeCandidates(
      [cand(USDC_SAC, { source: "stored", sac: false })],
      [cand(USDC_SAC, { sac: true })],
    );
    expect(merged[0].sac).toBe(true);
  });
});

describe("sortHoldings", () => {
  const holding = (contractId: string, code: string): AssetHolding => ({
    contractId, code, decimals: 7, raw: 1n, formatted: "1", explorerUrl: "",
  });

  it("puts XLM first, then alphabetical by code", () => {
    const sorted = sortHoldings([
      holding(USDC_SAC, "USDC"),
      holding("C1", "AQUA"),
      holding(NATIVE_SAC_ID, "XLM"),
    ]);
    expect(sorted.map((h) => h.code)).toEqual(["XLM", "AQUA", "USDC"]);
  });
});

describe("loadAssets (wiring)", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("lists XLM (always) plus curated assets with nonzero batched balances", async () => {
    // Curated list: USDC only.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ assets: [{ code: "USDC", issuer: ISSUER, contract: USDC_SAC, domain: "centre.io" }] }),
    }));
    // Event discovery: a USDC transfer (dedups against the curated entry).
    vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockResolvedValue({ sequence: 3_000_000 } as never);
    vi.spyOn(rpc.Server.prototype, "getEvents").mockResolvedValue({
      events: [{
        contractId: { toString: () => USDC_SAC },
        topic: [
          nativeToScVal("transfer", { type: "symbol" }),
          Address.fromString(ISSUER).toScVal(),
          Address.fromString(SELF).toScVal(),
          nativeToScVal(`USDC:${ISSUER}`, { type: "string" }),
        ],
        value: nativeToScVal(25_0000000n, { type: "i128" }),
        txHash: "TX1",
        ledgerClosedAt: "2026-06-01T00:00:00Z",
      }],
      latestLedger: 3_000_000,
    } as never);
    // Balances: XLM 12.5, USDC 25 — one batched ledger-entry read.
    const xlmKey = sacBalanceLedgerKey(NATIVE_SAC_ID, SELF);
    const usdcKey = sacBalanceLedgerKey(USDC_SAC, SELF);
    const entry = (key: xdr.LedgerKey, amount: bigint) => ({
      key,
      val: { contractData: () => ({ val: () => nativeToScVal(amount, { type: "i128" }) }) },
    });
    vi.spyOn(rpc.Server.prototype, "getLedgerEntries").mockResolvedValue({
      latestLedger: 3_000_000,
      entries: [entry(xlmKey, 125_000_000n), entry(usdcKey, 250_000_000n)],
    } as never);

    const holdings = await loadAssets(SELF);

    expect(holdings.map((h) => [h.code, h.formatted])).toEqual([
      ["XLM", "12.5"],
      ["USDC", "25"],
    ]);
    // The discovered token was persisted for future loads (beyond the ~7-day event window).
    expect(localStorage.getItem(`g2c:assets:known:${SELF}`)).toContain(USDC_SAC);
  });

  it("always shows XLM even when everything else is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockRejectedValue(new Error("rpc down"));
    vi.spyOn(rpc.Server.prototype, "getLedgerEntries").mockResolvedValue({
      latestLedger: 1,
      entries: [],
    } as never);

    const holdings = await loadAssets(SELF);
    expect(holdings.map((h) => [h.code, h.formatted])).toEqual([["XLM", "0"]]);
  });
});
