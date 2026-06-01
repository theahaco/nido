/**
 * Recovery *completion* (key rotation).
 *
 * Once friends have collected enough signatures, the recovering account needs
 * a transaction that rotates its signers: typically `add_signer(new passkey)`
 * on the default rule, optionally paired with `remove_signer(old signer id)`.
 *
 * That transaction is authorized NOT by the lost primary passkey but by the
 * recovery rule — a `CallContract(self)` rule gated by the multisig-policy.
 * So its `AuthPayload.context_rule_ids` must reference the recovery rule id,
 * and its `signers` map carries one `Delegated(friend)` entry per friend whose
 * signature counts toward the threshold (see `multiSigner.ts`).
 *
 * `planRotation` is a pure function (unit-testable, no RPC) that turns a
 * rotation request into the sequence of contract calls. `buildRotation`
 * threads those through the generated bindings to produce XDR operations,
 * mirroring `multisigRecovery.buildInstall`.
 */
import type { Signer } from 'smart-account';
import type { TxBuild } from './types.js';
/** A new External (passkey) signer to install. */
export interface NewPasskeySigner {
    /** WebAuthn verifier contract address the account trusts. */
    verifierAddress: string;
    /** 65-byte SEC1 uncompressed P-256 public key. */
    publicKey: Uint8Array;
}
/** The rotation the owner wants performed. */
export interface RotationRequest {
    /**
     * The rule id whose signers are being rotated — almost always the default
     * rule (id 0), which holds the account's primary passkey.
     */
    defaultRuleId: number;
    /** New passkey to add as a signer (the recovered key). */
    addPasskey?: NewPasskeySigner;
    /** Existing signer id to remove (the lost key). */
    removeSignerId?: number;
}
/** A single contract call making up a rotation. */
export type RotationCall = {
    method: 'add_signer';
    contextRuleId: number;
    signer: Extract<Signer, {
        tag: 'External';
    }>;
} | {
    method: 'remove_signer';
    contextRuleId: number;
    signerId: number;
};
export interface RotationPlan {
    calls: RotationCall[];
}
/**
 * Turn a rotation request into an ordered list of contract calls. Pure — no
 * RPC, no client. `add_signer` is emitted before `remove_signer` so the
 * account never transiently has zero signers on the rule.
 */
export declare function planRotation(req: RotationRequest): RotationPlan;
/** Human-readable summary of a rotation plan for the signing UI. */
export declare function describeRotation(plan: RotationPlan): string;
export interface BuildRotationArgs {
    /** Smart account being recovered. */
    account: string;
    rpcUrl: string;
    /** The on-chain recovery rule id (CallContract(self) + multisig policy). */
    recoveryRuleId: number;
    /** The rotation to perform. */
    request: RotationRequest;
}
export interface RotationTxBuild extends TxBuild {
    /**
     * Context rule ids aligned by index with `operations` — every op is
     * authorized by the recovery rule, so each entry is `recoveryRuleId`.
     * Feed this to the auth-digest computation and the AuthPayload.
     */
    contextRuleIds: number[];
}
/**
 * Build the unsigned rotation transaction operations plus the metadata the
 * signing flow needs: the recovery rule id each op is authorized under, and a
 * description. Mirrors `multisigRecovery.buildInstall`.
 *
 * The returned operations are unsigned; the caller simulates, computes the
 * per-op `auth_digest = sha256(signature_payload || [recoveryRuleId].to_xdr())`,
 * collects friend signatures over it, and injects them before submitting.
 */
export declare function buildRotation(args: BuildRotationArgs): Promise<RotationTxBuild>;
//# sourceMappingURL=multisigRotation.d.ts.map