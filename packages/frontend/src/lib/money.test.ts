import { describe, it, expect } from "vitest";
import { xlmToStroops, stroopsToXlm, rawToDecimal } from "./money";

describe("rawToDecimal", () => {
  it("handles arbitrary decimals", () => {
    expect(rawToDecimal(1_500_000n, 6)).toBe("1.5");
    expect(rawToDecimal(123n, 2)).toBe("1.23");
    expect(rawToDecimal(123n, 0)).toBe("123");
    expect(rawToDecimal(0n, 9)).toBe("0");
  });

  it("trims trailing fraction zeros and keeps leading ones", () => {
    expect(rawToDecimal(1_000_000_0n, 7)).toBe("1");
    expect(rawToDecimal(1n, 7)).toBe("0.0000001");
  });

  it("handles negatives", () => {
    expect(rawToDecimal(-15_000_000n, 7)).toBe("-1.5");
  });

  it("backs stroopsToXlm (7 decimals)", () => {
    expect(rawToDecimal(125_000_000n, 7)).toBe(stroopsToXlm(125_000_000n));
  });
});

describe("xlmToStroops", () => {
  it("converts whole numbers", () => {
    expect(xlmToStroops("10")).toBe(100_000_000n);
    expect(xlmToStroops("1")).toBe(10_000_000n);
    expect(xlmToStroops("0")).toBe(0n);
  });

  it("converts fractional amounts up to 7 dp", () => {
    expect(xlmToStroops("1.5")).toBe(15_000_000n);
    expect(xlmToStroops("0.0000001")).toBe(1n);
    expect(xlmToStroops("1.234567")).toBe(12_345_670n);
    expect(xlmToStroops("12.5000000")).toBe(125_000_000n);
  });

  it("trims surrounding whitespace", () => {
    expect(xlmToStroops("  2.5  ")).toBe(25_000_000n);
  });

  it("rejects more than 7 decimal places", () => {
    expect(() => xlmToStroops("1.12345678")).toThrow();
  });

  it("rejects malformed input", () => {
    for (const bad of ["", "abc", "1.2.3", "-1", ".5", "1.", "1e3"]) {
      expect(() => xlmToStroops(bad)).toThrow();
    }
  });

  it("round-trips with stroopsToXlm", () => {
    expect(stroopsToXlm(xlmToStroops("1.234567"))).toBe("1.234567");
    expect(xlmToStroops(stroopsToXlm(98_765_432n))).toBe(98_765_432n);
  });
});
