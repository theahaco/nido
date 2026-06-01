/**
 * Out-of-band recovery handoff between the recovering account's owner (the
 * "originator") and each friend.
 *
 * First-cut channel is copy/paste (no QR): the originator encodes a
 * `RotationHandoff` into a URL-safe string and shares a link with each friend;
 * the friend's wallet decodes it, signs with their own primary passkey, and
 * hands a `FriendSignature` blob back to the originator.
 *
 * Why ship the whole transaction (not just a digest): a `Delegated` friend
 * does NOT verify bytes in the parent's signer map. On-chain, the recovering
 * account calls `friend.require_auth_for_args((parent_auth_digest,))`, so the
 * friend authorizes a *nested* sub-invocation. To produce a valid nested auth
 * entry the friend's wallet must see the real invocation tree (it derives the
 * sub-invocation, computes its own `signature_payload`, then signs
 * `auth_digest = sha256(signature_payload || [0].to_xdr())` with the friend's
 * primary passkey). Sharing the assembled tx XDR lets the friend reconstruct
 * exactly that, and lets the originator splice the returned signature back
 * into the same tree before submitting.
 */

import { buf2hex, hex2buf, buf2base64url, base64url2buf } from './encoding.js';

const HANDOFF_VERSION = 1 as const;

/**
 * Everything a friend needs to review and sign a recovery rotation. Shared by
 * the originator via a copy/paste link.
 */
export interface RotationHandoff {
  version: 1;
  /** The smart account being recovered. */
  account: string;
  /** The on-chain recovery rule id authorizing this rotation. */
  recoveryRuleId: number;
  /** Human-readable summary of the rotation, for the friend's review screen. */
  description: string;
  /**
   * Base64 XDR of the assembled, unsigned rotation transaction envelope. The
   * friend's wallet reconstructs the auth tree from this, derives its own
   * sub-invocation, and signs.
   */
  txXdr: string;
  /** All friend accounts being asked to sign (so each can find its own entry). */
  friends: string[];
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
  const json = JSON.stringify(h);
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
  const h = parsed as Partial<RotationHandoff>;
  if (h.version !== HANDOFF_VERSION) {
    throw new Error(
      `decodeRotationHandoff: unsupported handoff version ${String(h.version)}`,
    );
  }
  if (
    typeof h.account !== 'string' ||
    typeof h.recoveryRuleId !== 'number' ||
    typeof h.txXdr !== 'string' ||
    !Array.isArray(h.friends)
  ) {
    throw new Error('decodeRotationHandoff: malformed handoff payload');
  }
  return {
    version: HANDOFF_VERSION,
    account: h.account,
    recoveryRuleId: h.recoveryRuleId,
    description: h.description ?? '',
    txXdr: h.txXdr,
    friends: h.friends,
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
