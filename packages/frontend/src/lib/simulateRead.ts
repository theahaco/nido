import {
  Account,
  Contract,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE } from "./network.js";

/** All-zeros account: read-only simulations need a source but never touch it. */
export const DUMMY_SOURCE =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/**
 * Read-only simulate `fn(...args)` on `contract` and return the
 * scValToNative'd result. Simulation-level failures (the contract traps, no
 * return value, undecodable retval) yield null; network errors propagate so
 * callers can distinguish "contract says no" from "RPC unreachable".
 */
export async function simulateRead(
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
