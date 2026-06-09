import { describe, it, expect } from "vitest";
import { nativeToScVal, Address, xdr } from "@stellar/stellar-sdk";
import { discoveryFilters, extractTokenCandidates } from "./discover.js";
import { NATIVE_SAC_ID } from "../network.js";
import type { RawEvent } from "../activity/rpcSource.js";

const SELF = "CCA2KXEUA4EQW3NL4QRCIZ2VRMA7V6A54DHXPA4RBTAGH72PCCYT5MSA";
const OTHER = "GCQZN6KXTEATCRNES3ZPTPZV4NNVK7CZKA6RHLMP2HPWP7SPDN7MFGBS";
const USDC_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const SEP41_TOKEN = "CCXLTPPNPNJ45QG4JG2YQWLOC4IMSRJ7KCF5RYF5BGT62SZGA3XDGKXQ";

const sym = (s: string) => nativeToScVal(s, { type: "symbol" });
const addr = (a: string) => Address.fromString(a).toScVal();

function ev(contractId: string, topics: xdr.ScVal[], txHash = "TX"): RawEvent {
  return {
    contractId: { toString: () => contractId },
    topic: topics,
    value: nativeToScVal(100n, { type: "i128" }),
    txHash,
    ledgerClosedAt: "2026-06-01T00:00:00Z",
  };
}

describe("discoveryFilters", () => {
  it("is one unpinned contract filter covering SAC and bare SEP-41 transfer shapes", () => {
    const filters = discoveryFilters(SELF);
    expect(filters).toHaveLength(1);
    expect(filters[0].type).toBe("contract");
    expect(filters[0].contractIds).toBeUndefined(); // unpinned: any token contract
    const transferTopic = sym("transfer").toXDR("base64");
    const selfTopic = addr(SELF).toXDR("base64");
    expect(filters[0].topics).toEqual([
      [transferTopic, "*", selfTopic, "*"],
      [transferTopic, selfTopic, "*", "*"],
      [transferTopic, "*", selfTopic],
      [transferTopic, selfTopic, "*"],
    ]);
  });
});

describe("extractTokenCandidates", () => {
  it("extracts a SAC token with code/issuer from the 4-topic asset string", () => {
    const raw = [ev(USDC_SAC, [sym("transfer"), addr(OTHER), addr(SELF), nativeToScVal(`USDC:${OTHER}`, { type: "string" })])];
    expect(extractTokenCandidates(raw, SELF)).toEqual([
      { contractId: USDC_SAC, code: "USDC", issuer: OTHER, sac: true, source: "events" },
    ]);
  });

  it("treats a 3-topic transfer as a non-SAC SEP-41 token", () => {
    const raw = [ev(SEP41_TOKEN, [sym("transfer"), addr(SELF), addr(OTHER)])];
    expect(extractTokenCandidates(raw, SELF)).toEqual([
      { contractId: SEP41_TOKEN, code: undefined, issuer: undefined, sac: false, source: "events" },
    ]);
  });

  it("skips the native SAC, non-transfer events, and transfers not involving self", () => {
    const raw = [
      ev(NATIVE_SAC_ID, [sym("transfer"), addr(OTHER), addr(SELF), nativeToScVal("native", { type: "string" })]),
      ev(USDC_SAC, [sym("mint"), addr(SELF), nativeToScVal(`USDC:${OTHER}`, { type: "string" })]),
      ev(USDC_SAC, [sym("transfer"), addr(OTHER), addr(OTHER), nativeToScVal(`USDC:${OTHER}`, { type: "string" })]),
    ];
    expect(extractTokenCandidates(raw, SELF)).toEqual([]);
  });

  it("dedups multiple transfers of the same token", () => {
    const raw = [
      ev(USDC_SAC, [sym("transfer"), addr(OTHER), addr(SELF), nativeToScVal(`USDC:${OTHER}`, { type: "string" })], "TX1"),
      ev(USDC_SAC, [sym("transfer"), addr(SELF), addr(OTHER), nativeToScVal(`USDC:${OTHER}`, { type: "string" })], "TX2"),
    ];
    expect(extractTokenCandidates(raw, SELF)).toHaveLength(1);
  });
});
