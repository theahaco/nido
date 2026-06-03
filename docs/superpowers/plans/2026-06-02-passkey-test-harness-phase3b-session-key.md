# Passkey Test Harness — Phase 3b (Session-Key Delegation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** E2E-test the session-key delegation ceremony — a dapp gets a scoped session key installed on a smart account (`/security/delegate/`, signed by the primary passkey), then uses that session key to sign — on real testnet, via the shim.

**Architecture:** The delegate page builds an `add_context_rule` install (a `CallContract(target)`-scoped rule whose signer is the session pubkey as an `External` signer) and signs it with the **primary passkey** via `signAndSubmit` — a **self-modification** the Default rule authorizes (so it should succeed on-chain, unlike the external-call name-claim). The test passes a deterministic shim-derived session pubkey, drives `#approve`, and asserts `?delegation=ok` + the rule landing on-chain. A second task drives the dapp **using** the installed session key to sign (the session key, scoped to the target, signs via the shim under its own rule).

**Tech Stack:** Playwright 1.60.x, the Phase 1-3a shim/fixtures + `tests/support/{auth,testnet}.ts` (incl. `seedBank`, `seedCredential`, `credentialFor`), `@stellar/stellar-sdk`, the deployed v0.7 factory + verifier on testnet.

**Scope:** Phase 3b = **session-key delegation only**. **Multisig recovery is a separate plan (Phase 3b-recovery)** — it needs N+1 deployed accounts, a pre-provisioned recovery rule (`add_multisig_recovery` with friend signers + the multisig policy), and the byte-identical nested-auth handoff ceremony; that's a large effort likely to surface contract-auth findings, planned on its own.

---

## Context (verified on `feat/nido-rebrand`)

**Delegate ceremony** (`/security/delegate/` on `<caddr>.localhost:PORT`, `packages/frontend/src/pages/security/delegate/index.astro`):
- Reads `?origin=<dappOrigin>&target=<C…>&pubkey=<04+128 hex>&duration=24h|7d|30d|none&return=<url>` (return must be same-origin as origin). Validates: `target` matches `/^C[A-Z0-9]{55}$/`, `pubkey` matches `/^04[0-9a-fA-F]{128}$/`.
- Ids: `#origin-text`, `#target-text`, `#pubkey-text`, `#expiry-text`, `#approve`, `#deny`, `#status`.
- `#approve` → `fetchVerifierAddress(account)` → `client.add_context_rule({ context_type: CallContract(target), name:'session-key', valid_until, signers:[External(verifier, sessionPubkey)], policies: empty })` → `signAndSubmit({account, operation, verifierAddress})` (primary passkey signs the self-modification, shim handles `navigator.credentials.get`, uses `computeAuthDigest`) → redirect `?delegation=ok`. `#deny` → `?delegation=cancelled`.
- This installs a **new CallContract-scoped rule** (a non-zero rule id) whose lone signer is the session key. Self-modification ⇒ authorized by the Default rule (rule 0) ⇒ expected to succeed on-chain.

**Using a session key** (`packages/frontend/src/pages/status-message/index.astro`, session path lines ~489-530; `packages/passkey-sdk/src/sessionKey.ts`): when session-key material exists for `(account, target)`, the dapp discovers the rule via `findRuleForPubkey(account, sessionPublicKey)`, computes `computeAuthDigest(payload, [thatRuleId])`, and signs with the session passkey via `navigator.credentials.get` (shim dispatches by the session credentialId).

**Multi-identity shim:** `useIdentity(page, label)` sets `window.__testAuthenticator.nextLabel` (controls which credential `create()` mints); `get()` dispatches by `allowCredentials[0].id` (deterministic per credentialId). `credentialFor(SEED_HEX, label)` (Phase 3a) returns the deterministic `{credentialIdB64u, publicKeyHex}` for any label without a browser.

---

## File Structure

**New:**
- `tests/support/sessionKey.ts` — helper to seed session-key material into a dapp origin's localStorage (so the "use" test finds it), keyed per `(account, target)` matching `packages/passkey-sdk/src/storage.ts` (`SessionKeyMaterial`).
- `tests/e2e/testnet/session-key.testnet.spec.ts` — install (Task 1) + use (Task 2).

**Modify:** none.

---

## Task 1: Install a session key via the delegate ceremony (`@testnet`)

**Files:**
- Create: `tests/e2e/testnet/session-key.testnet.spec.ts`

- [ ] **Step 1: Write the install test**

`tests/e2e/testnet/session-key.testnet.spec.ts`:
```ts
import { test, expect, SEED_HEX } from '../../support/fixtures';
import { seedBank } from '../../support/testnet';
import { credentialFor } from '../../support/auth/seed';

const PORT = Number(process.env.E2E_PORT || 4399);
const DAPP = `http://dapp.localhost:${PORT}`;
// A real testnet C-address to scope the session key to (the status-message demo).
const TARGET = 'CD5FK6CQ7QIZ5ONARG36Y53ERI5PIBGELSJUTD7OXYLK6EQAS4N3TFBV';

test.describe('@testnet session-key delegation', () => {
  test.describe.configure({ timeout: 240_000 });

  test('install: delegate ceremony adds a session-key rule (primary-passkey signed)', async ({ page, context }) => {
    await seedBank(context);
    // 1) create + deploy a v0.7 account (COPY account-lifecycle.testnet.spec.ts
    //    steps 1-3). Capture cAddress + host = `${cAddress.toLowerCase()}.localhost:${PORT}`.
    //    The account's primary passkey ('default') is registered during deploy.

    // 2) The dapp's session key = the shim's deterministic 'session' identity.
    const session = await credentialFor(SEED_HEX, 'session');

    // 3) Drive the delegate ceremony on the account subdomain.
    const ret = `${DAPP}/cb`;
    const url =
      `http://${host}/security/delegate/?origin=${encodeURIComponent(DAPP)}` +
      `&target=${TARGET}&pubkey=${session.publicKeyHex}&duration=24h` +
      `&return=${encodeURIComponent(ret)}`;
    await page.goto(url, { waitUntil: 'load' });
    await expect(page.locator('#pubkey-text')).toContainText(session.publicKeyHex.slice(0, 16));
    await expect(page.locator('#approve')).toBeEnabled();

    // 4) Approve → primary passkey signs the add_context_rule install (shim) →
    //    redirect ?delegation=ok. Self-modification under the Default rule, so
    //    EXPECT SUCCESS. If it fails, capture #status and report (don't mask).
    await page.locator('#approve').click();
    const outcome = await Promise.race([
      page.waitForURL('**/cb?delegation=ok**', { timeout: 120_000 }).then(() => 'ok' as const),
      page.locator('#status').filter({ hasText: /Failed:/ }).waitFor({ timeout: 120_000 }).then(() => 'failed' as const),
    ]).catch(() => 'timeout' as const);
    if (outcome !== 'ok') {
      const status = await page.locator('#status').textContent().catch(() => '');
      throw new Error(`delegate install did not reach ?delegation=ok (outcome=${outcome}): ${status}`);
    }

    // 5) Verify on-chain: the session pubkey is now an External signer on some
    //    rule of the account.
    const ruleId = await page.evaluate(async ([acc, pk]) => {
      const { findRuleForPubkey } = await import('/src/lib/policyChainFetch.ts');
      return findRuleForPubkey(acc, pk);
    }, [cAddress, session.publicKeyHex] as const).catch(() => null);
    expect(ruleId, 'session pubkey should be installed on a rule').not.toBeNull();
  });
});
```
NOTE: Step 5's in-page `import('/src/lib/policyChainFetch.ts')` only works under `astro dev`, not the static `dist` server. Prefer instead to **query the rules from the Node test process** with `@stellar/stellar-sdk` (mirror `findRuleForPubkey` in `packages/frontend/src/lib/policyChainFetch.ts`: `get_context_rules_count` then `get_context_rule(i)`, scan `signers` for an `External` whose pubkey hex == `session.publicKeyHex`). Implement that inline in the test (Node side) — do NOT import the SDK barrel (it breaks the Playwright TS transform; inline the rpc calls, as the Phase 3a tx-sign spec does).

- [ ] **Step 2: Implement create+deploy + the on-chain rule check, then run**

Copy the create+deploy block from `tests/e2e/testnet/account-lifecycle.testnet.spec.ts` (steps 1-3, through `#done-section`) to define `cAddress`/`host`. Implement the Node-side `findRuleForPubkey` equivalent (inline rpc `get_context_rule` scan). Run:
```bash
cd /home/willem/c/s/g2c-phase3
npx tsc -p ./packages/passkey-sdk/tsconfig.json && npx astro build --root ./packages/frontend
set -a; . tests/.env.testnet; set +a
npx playwright test --project=testnet-chromium tests/e2e/testnet/session-key.testnet.spec.ts
```
Expected: PASS — `?delegation=ok` + the session pubkey found on an installed rule. Adapt the param names / `#status` failure text / rule-scan decoding to reality. If the install is rejected on-chain for a contract-auth reason (unexpected — it's a self-modification), capture the exact `#status`/diagnostic and report (pin only if it's a genuine contract issue).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/testnet/session-key.testnet.spec.ts
git commit -m "test(e2e): testnet session-key delegation install (primary-passkey signed)"
```

---

## Task 2: Use the installed session key to sign (`@testnet`)

**Files:**
- Create: `tests/support/sessionKey.ts`
- Modify: `tests/e2e/testnet/session-key.testnet.spec.ts`

After install, the dapp signs a `target` invocation with the **session key** (not the primary), under the session rule. This exercises `findRuleForPubkey` + `computeAuthDigest(payload, [sessionRuleId])` + the session credentialId via the shim.

- [ ] **Step 1: Implement `tests/support/sessionKey.ts`** — seed `SessionKeyMaterial` into a dapp origin's localStorage

```ts
import type { Page } from '@playwright/test';
import { credentialFor } from './auth/seed';

/** Seed session-key material the dapp's session-sign path reads. Keys/shape per
 *  packages/passkey-sdk/src/storage.ts (SessionKeyMaterial); confirm the exact
 *  localStorage key (e.g. `g2c.{account}.session-key.{target}`) and JSON fields
 *  ({credentialId, publicKey, label?}) against saveSessionKeyMaterial before use. */
export async function seedSessionKey(
  page: Page, account: string, target: string, seedHex: string, label = 'session',
) {
  const cred = await credentialFor(seedHex, label);
  await page.evaluate(
    ([acc, tgt, cid, pk]) => {
      const key = `g2c.${acc}.session-key.${tgt}`; // ADAPT to saveSessionKeyMaterial
      localStorage.setItem(key, JSON.stringify({ credentialId: cid, publicKey: pk }));
    },
    [account, target, cred.credentialIdB64u, cred.publicKeyHex] as const,
  );
}
```

- [ ] **Step 2: Add a "use session key" test** that (after install, reusing the deployed account + installed session rule) seeds the session material on the dapp origin, drives the dapp's session-sign of a `target` (status-message `udpate_message`) invocation, and asserts it succeeds on-chain (the session key signs under its scoped rule). Mirror the status-message session path. **Run-to-validate**; assert success, and if the session-key auth is rejected on-chain, capture the exact error and report/pin.

- [ ] **Step 3: Run + commit**

```bash
set -a; . tests/.env.testnet; set +a
npx playwright test --project=testnet-chromium tests/e2e/testnet/session-key.testnet.spec.ts
git add tests/support/sessionKey.ts tests/e2e/testnet/session-key.testnet.spec.ts
git commit -m "test(e2e): testnet session-key usage (session-passkey signed)"
```

---

## Self-Review

**Spec coverage (Phase 3b / session-key):**
- Session-key install via the delegate ceremony (primary-passkey signed self-modification) → Task 1, with on-chain rule verification.
- Session-key usage (session-passkey signed, scoped rule) → Task 2.
- Multi-identity via the shim: the session pubkey is the deterministic 'session' identity (`credentialFor`); the primary signs install ('default'); the session key signs usage (Task 2 dispatch by its credentialId). No new shim work needed.

**Deferred (separate Phase 3b-recovery plan):** multisig recovery — N+1 deployed accounts, `add_multisig_recovery` provisioning, the friend nested-auth handoff (byte-identical `parentSignatureExpirationLedger`), M-of-N collection + submit. Largest remaining flow; likely surfaces contract-auth findings.

**Placeholder scan:** Task 1's create+deploy is "copy from the lifecycle spec" (a concrete, existing source — not a placeholder), and the on-chain rule check has an explicit Node-side implementation note (mirror `findRuleForPubkey`, inline rpc, don't import the SDK barrel — the Phase 3a tx-sign spec proves this pattern). Task 2 is run-to-validate with an explicit "confirm the SessionKeyMaterial key/shape" step. No vague "handle errors" placeholders.

**Type consistency:** `credentialFor(SEED_HEX, label) → {credentialIdB64u, publicKeyHex}` (Phase 3a) reused in both tasks. `seedBank`/`SEED_HEX` consistent with Phases 1-3a. `@testnet` tag + `E2E_PORT` consistent. Element ids (`#approve`/`#deny`/`#pubkey-text`/`#status`) match the verified delegate page; the session-rule scoping (`CallContract(target)`) matches the page's `add_context_rule` call.
