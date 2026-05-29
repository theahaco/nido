use soroban_sdk::{
    contract, contractimpl, deploy::DeployerWithAddress, Address, Bytes, BytesN, Env,
};
use soroban_sdk_tools::{contractstorage, InstanceItem};
use stellar_accounts::smart_account::Signer;

use crate::xlm;

const ACCOUNT_HASH: &[u8; 32] = b"\xb9\x4b\x29\x9f\x8c\x53\x04\xf1\x63\xdf\x15\x2e\x0d\xcf\x1a\xb8\x06\x63\xed\x03\x7c\xa1\xa3\x85\xd4\xec\x7b\xee\x7f\x3e\xcc\xf3";
const VERIFIER: &[u8; 32] = b"\xb9\x39\x33\x11\xf9\x7b\x49\x8f\xbb\x89\x76\xec\x50\xdd\x85\x85\xdd\x99\xad\x44\x3b\x8f\x13\xec\x5f\x75\x19\x86\x72\x9f\x99\xbe";
/// Wasm hash of `g2c_multisig_policy.wasm`. Filled in by Task 4 once the
/// policy wasm has been published via `stellar registry publish`.
const MULTISIG_POLICY: &[u8; 32] = &[0u8; 32];

#[contractstorage]
pub struct Config {
    account: InstanceItem<BytesN<32>>,
    passkey: InstanceItem<Address>,
}

#[contract]
pub struct Contract;

#[contractimpl]
impl Contract {
    pub fn __constructor(e: &Env) {
        xlm::register(e, &e.current_contract_address());
    }

    ///Deploy an account contract and add a passkey to it. Lastly transfer funds to the contract's account.
    ///
    pub fn create_account(e: &Env, funder: &Address, key: BytesN<65>, amount: &i128) -> Address {
        funder.require_auth();
        let new_account = Self::deploy_account_contract(e, funder, key.to_bytes());
        let xlm_sac = xlm::stellar_asset_client(e);
        xlm_sac.transfer(funder, &new_account, amount);
        new_account
    }

    pub fn get_c_address(e: &Env, funder: &Address) -> Address {
        Self::deployer(e, funder).deployed_address()
    }

    fn deployer(e: &Env, funder: &Address) -> DeployerWithAddress {
        e.deployer()
            .with_address(funder.clone(), BytesN::from_array(e, &[0; 32]))
    }

    fn deploy_account_contract(e: &Env, funder: &Address, key: Bytes) -> Address {
        let verifier_addr = Self::verifier_address(e);
        let signer = Signer::External(verifier_addr, key);
        let signers = soroban_sdk::vec![e, signer];
        let policies: soroban_sdk::Map<soroban_sdk::Address, soroban_sdk::Val> =
            soroban_sdk::Map::new(e);
        Self::deployer(e, funder)
            .deploy_v2(BytesN::from_array(e, ACCOUNT_HASH), (&signers, &policies))
    }

    /// Lazy-deploy and return the WebAuthn verifier singleton.
    pub fn verifier_address(e: &Env) -> Address {
        Self::singleton_at(e, VERIFIER)
    }

    /// Lazy-deploy and return the shared multisig policy singleton.
    pub fn multisig_policy_address(e: &Env) -> Address {
        Self::singleton_at(e, MULTISIG_POLICY)
    }

    fn singleton_at(e: &Env, hash: &[u8; 32]) -> Address {
        let bytes: BytesN<32> = BytesN::from_array(e, hash);
        let deployer = e.deployer().with_current_contract(bytes.clone());
        let address = deployer.deployed_address();
        if address.executable().is_none() {
            deployer.deploy_v2(bytes, ())
        } else {
            address
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::Env;

    #[test]
    fn multisig_policy_address_is_deterministic_and_idempotent() {
        let env = Env::default();
        env.mock_all_auths();
        let factory_addr = env.register(Contract, ());
        // MULTISIG_POLICY is [0u8; 32] (placeholder until Task 4 publishes the
        // real wasm).  SHA-256 of any actual bytes will never equal all-zeros,
        // so we cannot upload a wasm that matches the placeholder hash.
        //
        // Instead we test singleton_at directly with a hash obtained by
        // uploading the factory's own compiled wasm as a stand-in.  The
        // idempotency invariant under test is independent of which wasm hash is
        // used: first call deploys, second call detects the executable and
        // returns the same address.
        //
        // NOTE: requires `just build-contracts` before running unit tests.
        const FACTORY_WASM: &[u8] = include_bytes!(
            "../../../target/wasm32v1-none/contract/g2c_factory.wasm"
        );
        let hash = env
            .deployer()
            .upload_contract_wasm(soroban_sdk::Bytes::from_slice(&env, FACTORY_WASM));
        let first = env.as_contract(&factory_addr, || {
            Contract::singleton_at(&env, &hash.to_array())
        });
        let second = env.as_contract(&factory_addr, || {
            Contract::singleton_at(&env, &hash.to_array())
        });
        assert_eq!(first, second);
    }
}
