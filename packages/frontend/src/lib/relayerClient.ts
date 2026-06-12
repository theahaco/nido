/**
 * Thin shim over the pure relayer client in @g2c/passkey-sdk. It re-exports
 * types/error/extractor unchanged and wraps calls with this app's
 * `PUBLIC_RELAYER_URL` default.
 */
import { RELAYER_URL } from "./network.js";
export {
  RelayerError,
  type RelayerStatus,
  type RelayerTxResponse,
  extractFuncAndAuth,
} from "@g2c/passkey-sdk";
import {
  submitSorobanTransaction as sdkSubmit,
  getRelayerTransaction as sdkGet,
  waitForConfirmation as sdkWait,
} from "@g2c/passkey-sdk";

export function relayerEnabled(): boolean {
  return RELAYER_URL.length > 0;
}

export const submitSorobanTransaction = (
  args: { func: string; auth: string[]; skipWait?: boolean },
  baseUrl: string = RELAYER_URL,
) => sdkSubmit(args, baseUrl);

export const getRelayerTransaction = (id: string, baseUrl: string = RELAYER_URL) => sdkGet(id, baseUrl);

export const waitForConfirmation = (
  id: string,
  baseUrl: string = RELAYER_URL,
  opts?: { intervalMs?: number; maxAttempts?: number },
) => sdkWait(id, baseUrl, opts);
