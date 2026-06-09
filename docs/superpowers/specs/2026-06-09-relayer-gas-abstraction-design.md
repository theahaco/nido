# Gas Abstraction via Self-Hosted OZ Relayer (Deliverable 4, PR 1)

**Issue:** [#72](https://github.com/theahaco/g2c/issues/72) — SCF Tranche 2, Deliverable 2 ("OZ Relayer Integration + Session Keys").
**Scope of this spec:** the gas-abstraction half. The session-key scope UI ships as PR 2 under the same issue and is outlined at the end.

## Goal

A Nido user with a passkey smart account (C-address) submits transactions without holding XLM. The user signs only the `SorobanAuthorizationEntry` with their passkey; a relayer we operate is the transaction source and fee payer.

Proof of completion: a gas-abstracted transaction on testnet originating from a flow in which no user-controlled account holds or spends XLM for fees.

## Background and constraints (researched 2026-06-09, adversarially verified)

- OZ Relayer (AGPL-3.0, Rust, latest v1.5.0) supports Stellar testnet + mainnet: payments, Soroban `invoke_contract`, raw XDR, fee-bumps. Stellar support is flagged "partial / under active development" — we pin the deployed version.
- The Soroban invoke flow's `auth: xdr` mode accepts pre-signed `SorobanAuthorizationEntry` objects; the relayer becomes tx source + fee payer. This is exactly our wallet's signing shape (`walletSign.ts` already signs auth entries, not envelopes).
- SDF discontinued Launchtube (repo archived 2026-03-09) and designates OZ Relayer + the **Channels plugin** as the replacement. The plugin ([relayer-plugin-channels](https://github.com/OpenZeppelin/relayer-plugin-channels)) adds channel-account parallel submission + fee bumping, with an MIT TS client: `ChannelsClient.submitSorobanTransaction({ func, auth })`.
- Persistent relayer deployments require Redis (`REPOSITORY_STORAGE_TYPE=redis`) and a mandatory `STORAGE_ENCRYPTION_KEY`. REST API is API-key authenticated.
- Gotchas: memos rejected on Soroban ops; default per-request `max_fee` = 1,000,000 stroops; the relayer's "sponsored transactions" feature is pay-fees-in-tokens — not what we want; signed-XDR submission requires `fee_bump: true` (we use the invoke + `auth: xdr` path instead).

## Decisions (settled with Willem, 2026-06-09)

1. **Self-hosted OZ Relayer + Channels plugin on Fly.io**, Upstash Redis, pinned relayer version.
2. **This PR delivers gas abstraction only**; session-key UI is PR 2 on the same issue.
3. **CI deploys** via `1password/load-secrets-action` (1Password service account) pulling the Fly token from the `theahaco/nido_fly_io` vault.
4. **Session UI (PR 2) extends existing flows** (`/security/delegate` approval + Security page management) rather than adding a new area.
5. **Testnet signer:** `local` keystore, friendbot-funded relayer account. Mainnet moves to a KMS-backed signer (Tranche 3 concern).

## Architecture

```
Browser (Nido wallet)
  │  passkey-signs SorobanAuthorizationEntry (unchanged)
  │  ChannelsClient.submitSorobanTransaction({ func, auth })   [API key]
  ▼
OZ Relayer + Channels plugin  ──  Fly.io app (pinned image + plugin layer)
  │  channel account = tx source; relayer fund account fee-bumps
  │  Redis (Upstash) state; STORAGE_ENCRYPTION_KEY, keystore in fly secrets
  ▼
Soroban RPC → testnet
```

### Component 1: `infra/relayer/`

- `Dockerfile`: thin layer over the pinned official relayer image that adds the Channels plugin (the plugin is TypeScript loaded by the relayer's plugin runtime). Exact layering verified during implementation; if the official image can load the plugin via mounted config alone, the Dockerfile collapses to the stock image.
- `config/config.json`: one Stellar testnet relayer, `local` signer (keystore file generated at deploy, passphrase from secrets), Soroban RPC `https://soroban-testnet.stellar.org`, plugin registration, API-key auth.
- `fly.toml`: app config; Upstash Redis attached; env `REPOSITORY_STORAGE_TYPE=redis`; secrets: `REDIS_URL`, `STORAGE_ENCRYPTION_KEY`, `KEYSTORE_PASSPHRASE`, `API_KEY`.
- `README.md`: runbook — create app, attach Redis, set secrets from 1Password, fund signer + channel accounts via friendbot, rotate keys.

### Component 2: deploy workflow

`.github/workflows/deploy-relayer.yml`, triggered on push to `main` touching `infra/relayer/**` (plus manual dispatch):
1. `1password/load-secrets-action` with `OP_SERVICE_ACCOUNT_TOKEN` (Actions secret) reads the Fly token from `theahaco/nido_fly_io`.
2. `flyctl deploy --config infra/relayer/fly.toml` with the pinned image.

Open item: confirm what the vault's "connected to the repo" integration already provides; if the service-account token isn't present as an Actions secret yet, add it once.

### Component 3: frontend submission path

- New `packages/frontend/src/lib/relayerSubmit.ts`: wraps `@openzeppelin/relayer-plugin-channels`' `ChannelsClient`; input = host-function XDR + signed auth-entry XDRs; output = tx hash/status (poll until final).
- `primaryPasskeySigner.ts` `signAndSubmit(...)` gains a relayer branch: simulate against RPC (unchanged) → passkey-sign auth entry → if `PUBLIC_RELAYER_URL` is configured, submit via relayer; otherwise fall back to the current ephemeral-G self-submission. Feature flag keeps `main` deployable while the Fly app stabilizes.
- Config: `PUBLIC_RELAYER_URL`, `PUBLIC_RELAYER_API_KEY`. The API key is browser-visible — accepted for the testnet milestone; production hardening (policy proxy / per-origin keys / rate limits) is tracked in #72 as a follow-up.
- Auth-entry expiration: wallet signs `signature_expiration_ledger = current + margin`; margin must outlive relayer queueing/re-simulation. Start at ~120 ledgers (~10 min) and validate empirically; document the chosen value in code.

### Error handling

- Relayer/network failure → typed error surfaced in the existing tx-status UI; fallback path (self-submit) only when explicitly configured, never silent (fee origin changes are user-visible behavior).
- Relayer rejections to map: missing/invalid API key, `max_fee` exceeded, expired auth entry, malformed auth XDR.
- Deploy workflow fails loudly if secrets are missing (no skip-and-green).

## Testing

- **Unit (vitest):** `relayerSubmit.ts` against a mocked Channels endpoint — payload shape (`func`, `auth` arrays), status polling, error mapping.
- **Testnet integration:** extend `test-testnet.yml` (or a script in `infra/relayer/`) — create/fund nothing for the user; passkey-equivalent signer signs an auth entry for a `status-message` `update_message` call; submit via deployed relayer; assert success and that the fee account ≠ any user account. This run is the deliverable's proof artifact.
- **Baseline:** `just test` stays green (no contract changes in PR 1).

## Out of scope for PR 1 (lands in PR 2 / follow-ups)

- **PR 2 — session-key scope UI:** delegate approval screen gains spending-limit + time-window controls (→ `add_context_rule` with `spending_limit` policy + `valid_until`); Security page lists per-app scopes with revoke (`remove_context_rule`); proof = status-message dApp executes a scoped tx with a session key and an out-of-scope call is rejected. Contracts already support all of this (`scoped_session_key.rs`).
- Routing onboarding (factory deploy) through the relayer — would eliminate the friendbot G-address entirely; separate issue.
- Mainnet KMS signer, relayer API hardening proxy.
