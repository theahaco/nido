import {
  Address,
  Asset,
  Networks,
  Operation,
  StrKey,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { signAndSubmit } from "./primaryPasskeySigner.js";

/** Native-XLM Stellar Asset Contract id on testnet (same derivation as balance.ts). */
const XLM_SAC_ID = Asset.native().contractId(Networks.TESTNET);

/** True if `addr` is a valid Soroban contract (C…) or Stellar account (G…) address. */
export function validateRecipient(addr: string): boolean {
  return StrKey.isValidContract(addr) || StrKey.isValidEd25519PublicKey(addr);
}

/**
 * Build the unsigned operation for an outgoing native-XLM transfer.
 *
 * The smart account invokes its own `execute(target, target_fn, target_args)`
 * entrypoint to call the XLM SAC's `transfer(from, to, amount)`. The
 * `require_auth()` inside `execute` is the single auth entry the passkey signs
 * — the inner transfer's `require_auth(from = account)` is satisfied by the
 * call stack — so this op slots straight into `signAndSubmit`.
 */
export function buildSendXlmOperation(args: {
  smartAccount: string;
  destination: string;
  stroops: bigint;
}): xdr.Operation {
  const targetArgs = xdr.ScVal.scvVec([
    Address.fromString(args.smartAccount).toScVal(), // from
    Address.fromString(args.destination).toScVal(), // to
    nativeToScVal(args.stroops, { type: "i128" }), // amount
  ]);

  return Operation.invokeContractFunction({
    contract: args.smartAccount,
    function: "execute",
    args: [
      Address.fromString(XLM_SAC_ID).toScVal(), // target = XLM SAC
      nativeToScVal("transfer", { type: "symbol" }), // target_fn
      targetArgs, // target_args: Vec<Val>
    ],
  });
}

/**
 * Send native XLM from the user's smart account to `destination`, signed with
 * the primary passkey. Triggers the WebAuthn prompt inside `signAndSubmit` and
 * resolves once the transaction is confirmed on-chain (or throws).
 */
export async function sendXlm(args: {
  smartAccount: string;
  destination: string;
  stroops: bigint;
}): Promise<void> {
  const operation = buildSendXlmOperation(args);
  await signAndSubmit({ account: args.smartAccount, operation });
}
