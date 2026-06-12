/**
 * Out-of-band recovery handoff between the recovering account's owner (the
 * "originator") and each friend.
 *
 * First-cut channel is a compact URL payload: the originator stores the
 * assembled transaction in Refractor, then encodes only the Refractor tx hash
 * plus the stable auth metadata into a URL-safe string. The friend's wallet
 * fetches the transaction, verifies the recovery rule from chain, signs with
 * their own primary passkey, and hands a `FriendSignature` blob back to the
 * originator.
 *
 * Why the friend still fetches the whole transaction: a `Delegated` friend does
 * NOT verify bytes in the parent's signer map. On-chain, the recovering account
 * calls `friend.require_auth_for_args((parent_auth_digest,))`, so the friend
 * authorizes a *nested* sub-invocation. To produce a valid nested auth entry the
 * friend's wallet must see the real invocation tree (it derives the
 * sub-invocation, computes its own `signature_payload`, then signs
 * `auth_digest = sha256(signature_payload || [0].to_xdr())` with the friend's
 * primary passkey). Refractor provides that transaction by hash without putting
 * the XDR into the share URL.
 */

import { Address, hash, xdr } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { buf2hex, hex2buf, buf2base64url, base64url2buf } from './encoding.js';

const HANDOFF_VERSION = 2 as const;

/**
 * Stable metadata for a recovery handoff. Chain-derived data such as friends,
 * threshold, and display text are intentionally excluded so the URL stays
 * small and the friend verifies current on-chain state before signing.
 */
export interface RotationHandoff {
  version: 2;
  /** The smart account being recovered. */
  account: string;
  /** The on-chain recovery rule id authorizing this rotation. */
  recoveryRuleId: number;
  /**
   * Refractor transaction hash. The friend fetches the assembled, unsigned
   * rotation transaction envelope from Refractor before signing.
   */
  refractorTxHash: string;
  /**
   * The CANONICAL absolute `signatureExpirationLedger` for the PARENT
   * (recovering account) auth entry. Chosen once by the originator at
   * `prepareRotation` time and frozen here. Every party — originator, each
   * friend, and the chain — must feed exactly this value into the parent
   * auth-digest preimage, or the digests diverge and the host rejects the
   * nested entries. Friends MUST NOT recompute it from a live ledger.
   */
  parentSignatureExpirationLedger: number;
}

interface RotationHandoffWire {
  v: 2;
  /** account */
  a: string;
  /** recovery rule id */
  r: number;
  /** Refractor tx hash */
  tx: string;
  /** parent signature expiration ledger */
  exp: number;
}

/** A single friend's signed contribution, handed back to the originator. */
export interface FriendSignature {
  /** The friend's smart-account address (the `Delegated` signer). */
  friendAccount: string;
  /** The verifier the friend's primary passkey uses. */
  verifierAddress: string;
  /** Friend's 65-byte SEC1 uncompressed P-256 public key. */
  publicKey: Uint8Array;
  /** WebAuthn assertion components over the friend's own auth digest. */
  authenticatorData: Uint8Array;
  clientDataJson: Uint8Array;
  /** 64-byte compact (r||s) low-S signature. */
  signature: Uint8Array;
  /** The nonce of the friend's nested auth entry (stringified i64). */
  nonce: string;
  /** Expiration ledger of the friend's nested auth entry. */
  signatureExpirationLedger: number;
}

// --- Handoff (originator -> friend) ----------------------------------------

export function encodeRotationHandoff(h: RotationHandoff): string {
  if (h.version !== HANDOFF_VERSION) {
    throw new Error(`encodeRotationHandoff: unsupported version ${h.version}`);
  }
  const wire: RotationHandoffWire = {
    v: HANDOFF_VERSION,
    a: h.account,
    r: h.recoveryRuleId,
    tx: h.refractorTxHash,
    exp: h.parentSignatureExpirationLedger,
  };
  const json = JSON.stringify(wire);
  return buf2base64url(new TextEncoder().encode(json));
}

export function decodeRotationHandoff(encoded: string): RotationHandoff {
  let json: string;
  try {
    json = new TextDecoder().decode(base64url2buf(encoded));
  } catch {
    throw new Error('decodeRotationHandoff: input is not valid base64url');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('decodeRotationHandoff: payload is not valid JSON');
  }
  const h = parsed as Partial<RotationHandoffWire>;
  if (h.v !== HANDOFF_VERSION) {
    throw new Error(
      `decodeRotationHandoff: unsupported handoff version ${String(h.v)}`,
    );
  }
  if (
    typeof h.a !== 'string' ||
    typeof h.r !== 'number' ||
    typeof h.tx !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(h.tx) ||
    typeof h.exp !== 'number'
  ) {
    throw new Error('decodeRotationHandoff: malformed handoff payload');
  }
  return {
    version: HANDOFF_VERSION,
    account: h.a,
    recoveryRuleId: h.r,
    refractorTxHash: h.tx,
    parentSignatureExpirationLedger: h.exp,
  };
}

// --- Friend signature (friend -> originator) -------------------------------

interface FriendSignatureWire {
  v: 1;
  friend: string;
  verifier: string;
  pub: string; // hex
  ad: string; // hex authenticator data
  cd: string; // hex client data json
  sig: string; // hex 64-byte signature
  nonce: string;
  exp: number;
}

export function encodeFriendSignature(s: FriendSignature): string {
  const wire: FriendSignatureWire = {
    v: 1,
    friend: s.friendAccount,
    verifier: s.verifierAddress,
    pub: buf2hex(s.publicKey),
    ad: buf2hex(s.authenticatorData),
    cd: buf2hex(s.clientDataJson),
    sig: buf2hex(s.signature),
    nonce: s.nonce,
    exp: s.signatureExpirationLedger,
  };
  return buf2base64url(new TextEncoder().encode(JSON.stringify(wire)));
}

export function decodeFriendSignature(encoded: string): FriendSignature {
  let json: string;
  try {
    json = new TextDecoder().decode(base64url2buf(encoded));
  } catch {
    throw new Error('decodeFriendSignature: input is not valid base64url');
  }
  const w = JSON.parse(json) as FriendSignatureWire;
  if (w.v !== 1) {
    throw new Error(`decodeFriendSignature: unsupported version ${String(w.v)}`);
  }
  return {
    friendAccount: w.friend,
    verifierAddress: w.verifier,
    publicKey: hex2buf(w.pub),
    authenticatorData: hex2buf(w.ad),
    clientDataJson: hex2buf(w.cd),
    signature: hex2buf(w.sig),
    nonce: w.nonce,
    signatureExpirationLedger: w.exp,
  };
}

// --- Nested friend auth-entry construction ---------------------------------
//
// For a `Signer::Delegated(addr)`, OZ's `authenticate` calls
// `addr.require_auth_for_args((auth_digest,))`. The host builds the EXPECTED
// `authorized_function` from the CURRENT call-stack frame — the RECOVERING
// account's `__check_auth` invocation — NOT from the friend's address. So a
// friend's nested `SorobanAuthorizationEntry` must authorize an invocation of
// `{ contract_address = the recovering account, function_name = "__check_auth",
//    args = (parent_auth_digest,) }`.
//
// The friend-signing path and the submit path BOTH derive from these
// functions, so the digest the friend signs is byte-identical to the digest
// the host recomputes from the submitted entry.

/**
 * The invocation a friend authorizes:
 * `recovering_account.__check_auth((parent_auth_digest,))`.
 *
 * @param recoveringAccount the smart account being recovered — the
 *   `contract_address` of the invocation the host expects (NOT the friend's
 *   own address).
 * @param parentAuthDigestHex the parent (recovering account) auth digest the
 *   friend authorizes, hex-encoded.
 */
export function buildFriendInvocation(
  recoveringAccount: string,
  parentAuthDigestHex: string,
): xdr.SorobanAuthorizedInvocation {
  const argScVal = xdr.ScVal.scvBytes(Buffer.from(hex2buf(parentAuthDigestHex)));
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(recoveringAccount).toScAddress(),
        functionName: '__check_auth',
        args: [argScVal],
      }),
    ),
    subInvocations: [],
  });
}

/**
 * Compute a friend's `signature_payload` — the sha256 of the
 * HashIdPreimageSorobanAuthorization for the friend's nested invocation. This
 * is what the friend's own `__check_auth` receives as the host payload; the
 * friend then signs `auth_digest = sha256(signature_payload || [0].to_xdr())`
 * (see `computeAuthDigest`).
 */
export function friendSignaturePayload(args: {
  /** The smart account being recovered (invocation contract_address). */
  recoveringAccount: string;
  /** Parent auth digest, hex-encoded. */
  parentAuthDigestHex: string;
  /** Network passphrase the nested entry is bound to. */
  networkPassphrase: string;
  /** The friend's nested-entry nonce (stringified i64). */
  nonce: string;
  /** The friend's nested-entry expiration ledger. */
  signatureExpirationLedger: number;
}): Buffer {
  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(Buffer.from(args.networkPassphrase, 'utf-8')),
      nonce: xdr.Int64.fromString(args.nonce),
      signatureExpirationLedger: args.signatureExpirationLedger,
      invocation: buildFriendInvocation(args.recoveringAccount, args.parentAuthDigestHex),
    }),
  );
  return hash(preimage.toXDR());
}

/**
 * A cryptographically-random positive i64 nonce (as a decimal string).
 *
 * Uses `crypto.getRandomValues` over the full positive i64 range
 * `[0, 2^63 - 1]` (clears the sign bit), not `Math.random()`.
 */
export function randomNonce(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  v &= (1n << 63n) - 1n; // clear sign bit → positive i64
  return v.toString();
}
