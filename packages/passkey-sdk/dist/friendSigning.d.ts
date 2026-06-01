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
import { xdr } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
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
export declare function encodeRotationHandoff(h: RotationHandoff): string;
export declare function decodeRotationHandoff(encoded: string): RotationHandoff;
export declare function encodeFriendSignature(s: FriendSignature): string;
export declare function decodeFriendSignature(encoded: string): FriendSignature;
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
export declare function buildFriendInvocation(recoveringAccount: string, parentAuthDigestHex: string): xdr.SorobanAuthorizedInvocation;
/**
 * Compute a friend's `signature_payload` — the sha256 of the
 * HashIdPreimageSorobanAuthorization for the friend's nested invocation. This
 * is what the friend's own `__check_auth` receives as the host payload; the
 * friend then signs `auth_digest = sha256(signature_payload || [0].to_xdr())`
 * (see `computeAuthDigest`).
 */
export declare function friendSignaturePayload(args: {
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
}): Buffer;
/**
 * A cryptographically-random positive i64 nonce (as a decimal string).
 *
 * Uses `crypto.getRandomValues` over the full positive i64 range
 * `[0, 2^63 - 1]` (clears the sign bit), not `Math.random()`.
 */
export declare function randomNonce(): string;
//# sourceMappingURL=friendSigning.d.ts.map