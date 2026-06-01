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
import { Buffer } from 'buffer';
import { Client as SmartAccountClient } from 'smart-account';
import { extractXdrOperations } from '../assembledTx.js';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
/**
 * Turn a rotation request into an ordered list of contract calls. Pure — no
 * RPC, no client. `add_signer` is emitted before `remove_signer` so the
 * account never transiently has zero signers on the rule.
 */
export function planRotation(req) {
    const calls = [];
    if (req.addPasskey) {
        if (req.addPasskey.publicKey.length !== 65) {
            throw new Error(`planRotation: new passkey must be a 65-byte SEC1 uncompressed P-256 key, got ${req.addPasskey.publicKey.length}`);
        }
        calls.push({
            method: 'add_signer',
            contextRuleId: req.defaultRuleId,
            signer: {
                tag: 'External',
                values: [
                    req.addPasskey.verifierAddress,
                    Buffer.from(req.addPasskey.publicKey),
                ],
            },
        });
    }
    if (typeof req.removeSignerId === 'number') {
        calls.push({
            method: 'remove_signer',
            contextRuleId: req.defaultRuleId,
            signerId: req.removeSignerId,
        });
    }
    if (calls.length === 0) {
        throw new Error('planRotation: nothing to rotate (no add or remove specified)');
    }
    return { calls };
}
/** Human-readable summary of a rotation plan for the signing UI. */
export function describeRotation(plan) {
    const parts = [];
    for (const c of plan.calls) {
        if (c.method === 'add_signer')
            parts.push('add a new passkey');
        else
            parts.push(`remove signer #${c.signerId}`);
    }
    return `Recovery rotation: ${parts.join(' and ')}`;
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
export async function buildRotation(args) {
    const plan = planRotation(args.request);
    const client = new SmartAccountClient({
        contractId: args.account,
        networkPassphrase: TESTNET_PASSPHRASE,
        rpcUrl: args.rpcUrl,
    });
    const operations = [];
    for (const call of plan.calls) {
        let tx;
        if (call.method === 'add_signer') {
            tx = await client.add_signer({
                context_rule_id: call.contextRuleId,
                signer: call.signer,
            });
        }
        else {
            tx = await client.remove_signer({
                context_rule_id: call.contextRuleId,
                signer_id: call.signerId,
            });
        }
        operations.push(...extractXdrOperations(tx, 'multisig-rotation'));
    }
    return {
        operations,
        contextRuleIds: operations.map(() => args.recoveryRuleId),
        description: describeRotation(plan),
    };
}
//# sourceMappingURL=multisigRotation.js.map