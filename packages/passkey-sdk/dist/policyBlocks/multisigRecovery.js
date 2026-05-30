import { Client as SmartAccountClient } from 'smart-account';
import { registerPolicyBlockModule } from './registry.js';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
export const multisigRecoveryModule = {
    kind: 'multisig-recovery',
    async buildInstall(args) {
        if (!args.policyAddress) {
            throw new Error('multisig-recovery: policyAddress fetcher required');
        }
        const policyAddr = await args.policyAddress('multisig');
        const client = new SmartAccountClient({
            contractId: args.account,
            networkPassphrase: TESTNET_PASSPHRASE,
            rpcUrl: args.rpcUrl,
        });
        const tx = await client.add_context_rule({
            context_type: { tag: 'CallContract', values: [args.account] },
            name: args.block.label ?? 'recovery',
            valid_until: undefined,
            signers: args.block.friends.map((f) => ({
                tag: 'Delegated',
                values: [f.address],
            })),
            policies: new Map([
                [policyAddr, { threshold: args.block.threshold }],
            ]),
        });
        return {
            operations: extractOperations(tx),
            description: `Set up ${args.block.threshold}-of-${args.block.friends.length} recovery`,
        };
    },
    async buildRevoke(args) {
        const client = new SmartAccountClient({
            contractId: args.account,
            networkPassphrase: TESTNET_PASSPHRASE,
            rpcUrl: args.rpcUrl,
        });
        const tx = await client.remove_context_rule({ context_rule_id: args.ruleId });
        return {
            operations: extractOperations(tx),
            description: 'Remove recovery rule',
        };
    },
    fromChain(rule, state, overlay) {
        if (rule.policies.length === 0)
            return null;
        if (rule.contextType.kind !== 'call-contract')
            return null;
        const policyAddr = rule.policies[0];
        const ps = state[policyAddr];
        const threshold = ps?.threshold;
        if (typeof threshold !== 'number')
            return null;
        return {
            kind: 'multisig-recovery',
            ruleId: rule.ruleId,
            threshold,
            friends: rule.signers
                .filter((s) => s.kind === 'delegated')
                .map((s) => ({
                address: s.address,
                inputAs: s.address,
                nickname: overlay.friendNicknames[s.address],
            })),
            label: overlay.blockLabels[rule.ruleId],
        };
    },
    summarize(block) {
        const n = block.friends.length;
        return `${block.threshold} of ${n} friend${n === 1 ? '' : 's'} can rotate this account's signers and rules`;
    },
    defaultDraft() {
        return { kind: 'multisig-recovery', threshold: 2, friends: [], label: 'Recovery' };
    },
};
/** Pull the Soroban Operation[] out of an AssembledTransaction.
 *  The exact property path depends on the SDK version; adjust if needed. */
function extractOperations(tx) {
    // Common shapes across @stellar/stellar-sdk 12-14:
    //   tx.built.operations
    const built = tx.built;
    if (!built || !built.operations) {
        throw new Error('multisig-recovery: could not extract operations from AssembledTransaction');
    }
    return Array.from(built.operations);
}
registerPolicyBlockModule(multisigRecoveryModule);
//# sourceMappingURL=multisigRecovery.js.map