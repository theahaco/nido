import { describe, it, expect } from "vitest";
import {
  Address,
  Asset,
  Networks,
  StrKey,
  scValToNative,
} from "@stellar/stellar-sdk";
import { validateRecipient, buildSendXlmOperation } from "./sendXlm";

const SMART_ACCOUNT = StrKey.encodeContract(Buffer.alloc(32, 0xaa));
const DEST_C = StrKey.encodeContract(Buffer.alloc(32, 0xbb));
const DEST_G = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 0xcd));

describe("validateRecipient", () => {
  it("accepts contract (C) addresses", () => {
    expect(validateRecipient(DEST_C)).toBe(true);
  });
  it("accepts account (G) addresses", () => {
    expect(validateRecipient(DEST_G)).toBe(true);
  });
  it("rejects garbage and empty", () => {
    for (const bad of ["nope", "", "C123", "G123"]) {
      expect(validateRecipient(bad)).toBe(false);
    }
  });
});

describe("buildSendXlmOperation", () => {
  it("builds account.execute(XLM_SAC, transfer, [from, to, i128])", () => {
    const stroops = 12_345_670n;
    const op = buildSendXlmOperation({
      smartAccount: SMART_ACCOUNT,
      destination: DEST_G,
      stroops,
    });

    const ic = op.body().invokeHostFunctionOp().hostFunction().invokeContract();

    // Outer call targets the smart account's `execute` entrypoint.
    expect(Address.fromScAddress(ic.contractAddress()).toString()).toBe(SMART_ACCOUNT);
    expect(ic.functionName().toString()).toBe("execute");

    const args = ic.args();
    // target = XLM SAC
    expect(scValToNative(args[0])).toBe(Asset.native().contractId(Networks.TESTNET));
    // target_fn = "transfer"
    expect(scValToNative(args[1])).toBe("transfer");
    // target_args = [from = account, to = destination, amount = i128]
    const inner = scValToNative(args[2]) as [string, string, bigint];
    expect(inner[0]).toBe(SMART_ACCOUNT);
    expect(inner[1]).toBe(DEST_G);
    expect(inner[2]).toBe(stroops);
  });
});
