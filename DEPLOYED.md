# Deployed contracts (testnet)

Current set of contracts the frontend talks to.

| Name | Address | Notes |
|---|---|---|
| Factory | `CBQKB6GYPO7P2CGDKN7KYLEFEBBN6FY5NXZJ7HNR43ZK2DDOU5N7NCV5` | Random-salt account factory. `create_account(salt, key)` deploys v0.7 smart accounts through the relayer. Registered as `unverified/factory`. Embeds smart-account wasm hash `00825acd…`. |
| WebAuthn verifier | `CACVGSAHYFBXY4LJKWW5B57LAAXHCZVDZOANUTYPLNV6HHQI4Q35EGMY` | Registered as `unverified/verifier`. Implements `canonicalize_key` / `batch_canonicalize_key` per current OZ `Verifier` trait. |
| Multisig policy | `CCSDKJYOFCPTCCGQZPF73RJNHFC7TPO532Q36N3M2VBYZFWQOTDB7J7G` | Registered as `unverified/multisig-policy`. Built against soroban-sdk 26 + OZ stellar-contracts main — accepts v0.7 `ContextRule` (with `signer_ids`/`policy_ids`). |
| Spending-limit policy | `CCJMCPGADKMVKYOIZXMV7UWH62XYDAIT6GJRNJPQSZ2CHPOF4K2AU2QC` | Registered as `unverified/spending-limit-policy`. Built against soroban-sdk 26 + OZ stellar-contracts rev `637c53a` — wraps `policies::spending_limit` (rolling window, meters SAC `transfer`). |
| Stellar Registry (unverified) | `CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S` | The registry the factory queries via `Self::resolve(env, name)`. |
| Name registry | `CDVVRZAVXTUQLS5LCGUP3H26RGOIUFKNE2UEJ6CAWYMBWY5LNORF6POX` | Human-readable account names. Independent of the policy-builder set. |
| Status Message demo | `CD5FK6CQ7QIZ5ONARG36Y53ERI5PIBGELSJUTD7OXYLK6EQAS4N3TFBV` | Hardcoded in `packages/frontend/src/pages/status-message/index.astro`. Predates the policy-builder work. |

## Pre-v0.7 contracts (do not use)

These were deployed during earlier iterations and remain on chain but are
incompatible with the current OZ v0.7 smart-account WASM. Accounts created
via the old factory cannot be signed for by the current SDK and need to be
re-created against the new factory.

| Name | Address | Reason superseded |
|---|---|---|
| Factory (old funder-based) | `CDQDNOT4RWQKAIJIZYJE5HK7DMIVTYBJ4QXHIERNOZPPYMUNBT2JZ2SK` | Expected `create_account(funder, key, amount)` and `get_c_address(funder)`, requiring a friendbot-funded setup account. |
| Factory (old) | `CDDMELYHOSD6M2T53F5DUYCXDS3VVOQ72E4KZMMZP37GQWII2WRKM2CC` | Hardcodes pre-v0.7 smart-account WASM hash. No admin/upgrade. |
| Verifier (old) | `CD6IG543VWP4RRNAKJTX25GJEQ3QAR5WPMP44MCENF433IPDFQTIJRTG` | Built before `batch_canonicalize_key` was required by OZ `Verifier`. |
| Multisig policy (old) | `CCJVJVNUXLD6MZDLSQMRWYAV4EKHE7IPOM5UJEPZAQUCL4Q5JMZFEUQA` | Built against soroban-sdk 25 + OZ v0.6 `ContextRule` (6 fields). Traps with `Error(Object, UnexpectedSize)` when v0.7 callers pass it the 8-field rule. |

## Re-deploying

None of the policy-builder-v1 contracts have `admin()/upgrade()`. To ship a
new WASM you deploy a fresh contract and repoint the registry name:

```bash
# build
just build-contracts

# deploy fresh
stellar contract deploy --wasm target/wasm32v1-none/contract/g2c_<name>.wasm \
  --source-account <alias> --network testnet
# → prints new C-address

# repoint registry (uses BARE name without 'unverified/' prefix)
stellar contract invoke --id CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S \
  --source-account <alias> --network testnet -- update_contract_address \
  --contract_name <name> \
  --new_address <new C-address>
```

The factory's `Self::resolve(env, name)` caches in instance storage, but the
cache lives across simulations only when they succeed — a failed sim rolls
the cache back, so the next live call re-reads the registry. Replacing the
factory itself is the same pattern, plus updating `FACTORY_CONTRACT_ID` in
the four frontend `.astro` pages.

For the upgradable-factory rewrite that would make all of this unnecessary,
see [#26](https://github.com/theahaco/g2c/issues/26).
