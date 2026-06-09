import { describe, it, expect, beforeEach } from "vitest";
import { loadKnownAssets, saveKnownAssets } from "./store.js";
import type { AssetCandidate } from "./types.js";

const ACCOUNT = "CCA2KXEUA4EQW3NL4QRCIZ2VRMA7V6A54DHXPA4RBTAGH72PCCYT5MSA";
const token = (n: number): AssetCandidate => ({
  contractId: `C${String(n).padStart(55, "0")}`,
  sac: false,
  source: "events",
});

beforeEach(() => localStorage.clear());

describe("known-assets store", () => {
  it("round-trips and remaps source to 'stored'", () => {
    saveKnownAssets(ACCOUNT, [{ ...token(1), code: "FOO" }]);
    expect(loadKnownAssets(ACCOUNT)).toEqual([{ ...token(1), code: "FOO", source: "stored" }]);
  });

  it("merges without duplicating and keeps existing entries", () => {
    saveKnownAssets(ACCOUNT, [token(1)]);
    saveKnownAssets(ACCOUNT, [token(1), token(2)]);
    expect(loadKnownAssets(ACCOUNT).map((a) => a.contractId)).toEqual([
      token(1).contractId,
      token(2).contractId,
    ]);
  });

  it("is scoped per account", () => {
    saveKnownAssets(ACCOUNT, [token(1)]);
    expect(loadKnownAssets("CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC")).toEqual([]);
  });

  it("survives corrupt storage", () => {
    localStorage.setItem(`g2c:assets:known:${ACCOUNT}`, "{not json");
    expect(loadKnownAssets(ACCOUNT)).toEqual([]);
  });

  it("caps the persisted set at 100 entries, dropping the oldest", () => {
    saveKnownAssets(ACCOUNT, Array.from({ length: 100 }, (_, i) => token(i)));
    saveKnownAssets(ACCOUNT, [token(999)]);
    const stored = loadKnownAssets(ACCOUNT);
    expect(stored).toHaveLength(100);
    expect(stored.at(-1)?.contractId).toBe(token(999).contractId);
    expect(stored.some((a) => a.contractId === token(0).contractId)).toBe(false);
  });
});
