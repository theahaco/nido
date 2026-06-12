import { Asset, Networks } from "@stellar/stellar-sdk";

/** Single source of truth for the network this build targets (currently testnet). */
export const NETWORK_NAME = "testnet" as const;
export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const RPC_URL = "https://soroban-testnet.stellar.org";

/** Stellar Expert human-explorer base (used to link each row to its tx). */
export const EXPLORER_BASE = `https://stellar.expert/explorer/${NETWORK_NAME}`;

/** Native-XLM Stellar Asset Contract id for this network. */
export const NATIVE_SAC_ID = Asset.native().contractId(NETWORK_PASSPHRASE);

/** Optional browser-safe relayer endpoint. Empty means local classic submitter fallback. */
export const RELAYER_URL: string = (import.meta.env.PUBLIC_RELAYER_URL ?? "").replace(/\/+$/, "");

/** Existing on-chain G-address used only as a recording-mode simulation source in relayer mode. */
export const RELAYER_SIM_SOURCE: string = import.meta.env.PUBLIC_RELAYER_SIM_SOURCE ?? "";
