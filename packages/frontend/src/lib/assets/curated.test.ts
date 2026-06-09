import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseAssetList, fetchCuratedAssets, CURATED_LIST_URL } from "./curated.js";
import { NATIVE_SAC_ID } from "../network.js";

const USDC_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const ISSUER = "GCQZN6KXTEATCRNES3ZPTPZV4NNVK7CZKA6RHLMP2HPWP7SPDN7MFGBS";

const DOC = {
  name: "top50",
  assets: [
    { code: "USDC", issuer: ISSUER, contract: USDC_SAC, domain: "centre.io", decimals: 7 },
    { code: "XLM", contract: NATIVE_SAC_ID, domain: "stellar.org" }, // native: dropped
    { code: "BAD", contract: "not-a-contract" },                     // invalid id: dropped
    { code: "SOBA", contract: "CCXLTPPNPNJ45QG4JG2YQWLOC4IMSRJ7KCF5RYF5BGT62SZGA3XDGKXQ" }, // no issuer: non-SAC
  ],
};

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("parseAssetList", () => {
  it("keeps valid entries, drops native + malformed, flags SAC by issuer presence", () => {
    const parsed = parseAssetList(DOC);
    expect(parsed).toEqual([
      { contractId: USDC_SAC, code: "USDC", issuer: ISSUER, domain: "centre.io", decimals: 7, sac: true, source: "curated" },
      { contractId: "CCXLTPPNPNJ45QG4JG2YQWLOC4IMSRJ7KCF5RYF5BGT62SZGA3XDGKXQ", code: "SOBA", issuer: undefined, domain: undefined, decimals: undefined, sac: false, source: "curated" },
    ]);
  });

  it("returns [] for junk documents", () => {
    for (const junk of [null, {}, { assets: "x" }, 42]) expect(parseAssetList(junk)).toEqual([]);
  });
});

describe("fetchCuratedAssets", () => {
  it("fetches the SEP-42 list and caches the document", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => DOC });
    vi.stubGlobal("fetch", fetchMock);
    const assets = await fetchCuratedAssets();
    expect(fetchMock).toHaveBeenCalledWith(CURATED_LIST_URL);
    expect(assets).toHaveLength(2);
    expect(localStorage.getItem("g2c:assets:curated")).toBe(JSON.stringify(DOC));
  });

  it("falls back to the cached copy when the network fails", async () => {
    localStorage.setItem("g2c:assets:curated", JSON.stringify(DOC));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await fetchCuratedAssets()).toHaveLength(2);
  });

  it("returns [] when both network and cache are unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    expect(await fetchCuratedAssets()).toEqual([]);
  });
});
