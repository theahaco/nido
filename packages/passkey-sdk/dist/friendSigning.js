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
const HANDOFF_VERSION = 1;
// --- Handoff (originator -> friend) ----------------------------------------
export function encodeRotationHandoff(h) {
    if (h.version !== HANDOFF_VERSION) {
        throw new Error(`encodeRotationHandoff: unsupported version ${h.version}`);
    }
    const json = JSON.stringify(h);
    return buf2base64url(new TextEncoder().encode(json));
}
export function decodeRotationHandoff(encoded) {
    let json;
    try {
        json = new TextDecoder().decode(base64url2buf(encoded));
    }
    catch {
        throw new Error('decodeRotationHandoff: input is not valid base64url');
    }
    let parsed;
    try {
        parsed = JSON.parse(json);
    }
    catch {
        throw new Error('decodeRotationHandoff: payload is not valid JSON');
    }
    const h = parsed;
    if (h.version !== HANDOFF_VERSION) {
        throw new Error(`decodeRotationHandoff: unsupported handoff version ${String(h.version)}`);
    }
    if (typeof h.account !== 'string' ||
        typeof h.recoveryRuleId !== 'number' ||
        typeof h.txXdr !== 'string' ||
        !Array.isArray(h.friends)) {
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
export function encodeFriendSignature(s) {
    const wire = {
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
export function decodeFriendSignature(encoded) {
    let json;
    try {
        json = new TextDecoder().decode(base64url2buf(encoded));
    }
    catch {
        throw new Error('decodeFriendSignature: input is not valid base64url');
    }
    const w = JSON.parse(json);
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
//# sourceMappingURL=friendSigning.js.map