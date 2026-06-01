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
export declare function encodeRotationHandoff(h: RotationHandoff): string;
export declare function decodeRotationHandoff(encoded: string): RotationHandoff;
export declare function encodeFriendSignature(s: FriendSignature): string;
export declare function decodeFriendSignature(encoded: string): FriendSignature;
//# sourceMappingURL=friendSigning.d.ts.map