# Passkey Test Harness — Phase 3b-recovery (Multisig Recovery) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** E2E-test the social-recovery flow on testnet — an account with a friend-gated recovery rule rotates its passkey when the owner "loses" their device: the originator stages a rotation, a friend signs a nested auth entry (with their own passkey), and the originator collects the threshold and submits.

**Architecture:** Multi-actor on one browser context (the shim is stateless/deterministic, so distinct identities work across subdomains via `useIdentity` before each registration). Start with the **minimal 1-of-1 scenario** (originator + 1 friend, threshold 1). Setup: deploy two accounts with **distinct** passkeys, then install a 1-of-1 recovery rule (`CallContract(self)`, multisig policy threshold 1, the friend as a signer) — a primary-passkey self-modification (proven to work). Ceremony: `#om-new-key` → `#om-prepare` (stages, freezes the canonical `parentSignatureExpirationLedger`, emits the `?handoff=` link) → friend opens the link on their subdomain, `#fm-sign` (shim signs the nested digest) → originator pastes the blob, `#om-add-sig`, `#om-submit`. **Assert-or-pin:** recovery is the most auth-fragile flow (nested auth + byte-identical expiration + multisig policy); if a step is rejected on-chain, pin it with the exact error rather than mask.

**Tech Stack:** Playwright 1.60.x, the shim/fixtures + `useIdentity` (Phase 1) + `tests/support/{auth,testnet}.ts`, `@stellar/stellar-sdk`, the deployed v0.7 factory + verifier + multisig-policy on testnet.

**Scope:** Phase 3b-recovery = the **1-of-1 recovery happy path** (rotate the primary key, friend-gated) + the install/setup. **Out of scope (note as follow-ons):** M-of-N (>1 friend), negative cases (insufficient sigs, wrong-scope), and the "recovered key actually works afterward" round-trip — add once 1-of-1 is green.

---

## Context (verified — see the two investigation reports this plan is built on)

**Friend identity / signer model:** friends are **deployed smart accounts**; the frontend resolves friend input (C-address / name / G-address) to a contract address (`resolveFriendInput`). The friend signs a **nested auth entry targeting the RECOVERING account's `__check_auth`** with their OWN primary passkey (`recoveryActions.ts::signRotationAsFriend`, `navigator.credentials.get` on the friend digest). The recovery rule is `CallContract(self)` with a multisig threshold policy; friends are its signers; the multisig policy counts authenticated friend signatures ≥ threshold.

**Byte-identity invariant:** the originator freezes a single absolute `parentSignatureExpirationLedger` into the `RotationHandoff`; the friend recomputes the parent auth digest via `buildAuthHashAt(parentEntry, TESTNET, thatLedger)` + `computeAuthDigest(payload, [recoveryRuleId])` — must be identical across originator/friend/chain or auth fails.

**Setup (security page, `mountRecoveryForm`):** `#add-recovery` → form ids `#rc-friends` (friend rows, placeholder "Nido name, C…, or G…"), `#rc-add-friend`, `#rc-m-down`/`#rc-m-up`/`#rc-m-value` (threshold), `#rc-n-value`, `#rc-rule-name`, `#rc-cancel`, `#rc-save` → `installRecovery(account, draft)` (a primary-passkey self-mod adding the `CallContract(self)` recovery rule). Friends must be **pre-deployed** accounts.

**Originator ceremony** (`/security/recover/`, no `?handoff=`): `#om-new-key` (`createSessionPasskey` — new passkey, shim `create`) → `#om-remove-id` (old signer id, optional) → `#om-prepare` (`prepareRotation` → stages `g2c.{account}.recovery-rotation`, emits handoff link in `#om-link`) → `#om-collect` reveals: `#om-paste` + `#om-add-sig` + `#om-progress` + `#om-collected` → `#om-submit` (`submitRotation`, on-chain) + `#om-submit-status`.

**Friend ceremony** (`/security/recover/?handoff=<b64>` on the FRIEND's subdomain): `#friend-mode`, `#fm-account`, `#fm-desc`, `#fm-sign` (`signRotationAsFriend` → shim `get` with the friend's primary passkey on the friend digest), `#fm-blob` (the signature blob, readonly), `#fm-copy`, `#fm-status`.

**Multi-actor mechanics:** ONE browser context; navigate between the originator subdomain and the friend subdomain (localStorage is per-origin, so each account's credential + the originator's staging persist). The handoff travels **in the URL** (`?handoff=`); the friend blob is read from `#fm-blob` (a test variable) and filled into `#om-paste`. **Distinct identities:** before each account's registration (`#register-btn`), call `useIdentity(page, '<actor>')` so the originator and friend get **different** passkeys (otherwise label 'default' yields identical keys).

---

## File Structure

**New:**
- `tests/support/recovery.ts` — helpers: `createAndDeployAs(page, context, PORT, identityLabel)` (create+deploy with a distinct identity → returns `{cAddress, host, key}`); `installRecoveryRule(page, host, friendAddresses, threshold)` (drive the security-page form). Extracted so the ceremony test stays readable.
- `tests/e2e/testnet/recovery.testnet.spec.ts` — the 1-of-1 recovery lifecycle.

**Modify:** `tests/support/fixtures.ts` only if `useIdentity` needs a tweak for pre-registration timing (likely not).

---

## Task 1: Multi-identity create+deploy + recovery-rule setup helpers

**Files:**
- Create: `tests/support/recovery.ts`

This task has no standalone unit test (it's Playwright glue verified by Task 2's run). Build it, then prove it inside Task 2.

- [ ] **Step 1: Implement `tests/support/recovery.ts`**

```ts
import type { BrowserContext, Page } from '@playwright/test';
import { useIdentity } from './fixtures';

/**
 * Create + deploy a fresh v0.7 account whose primary passkey is the shim's
 * `identityLabel` identity (distinct per actor — without this, every account
 * registers the SAME 'default' key). Mirrors account-lifecycle.testnet.spec.ts
 * steps 1-3. Returns the C-address + its subdomain host.
 */
export async function createAndDeployAs(
  page: Page, PORT: number, identityLabel: string,
): Promise<{ cAddress: string; host: string }> {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.locator('#create-btn').click();
  await page.waitForFunction(() => {
    const el = document.querySelector('#c-address-result');
    return !!el && (el.textContent ?? '').trim().length > 0;
  }, { timeout: 60_000 });
  const cAddress = (await page.locator('#c-address-result').textContent())!.trim();
  const setupHref = await page.locator('#setup-link').getAttribute('href');
  const key = new URL(setupHref!, 'http://x').searchParams.get('key')!;
  const host = `${cAddress.toLowerCase()}.localhost:${PORT}`;
  await page.goto(`http://${host}/new-account/?key=${encodeURIComponent(key)}`, { waitUntil: 'load' });
  // Distinct identity for THIS account's primary passkey, set BEFORE register.
  await useIdentity(page, identityLabel);
  await page.locator('#register-btn').click();
  await page.locator('#done-section').waitFor({ state: 'visible', timeout: 120_000 });
  return { cAddress, host };
}

/**
 * Install an M-of-N recovery rule on the account currently loaded at `host`,
 * via the security page form. Friends are pre-deployed account C-addresses.
 * Signs the install (add_context_rule self-mod) with the primary passkey.
 */
export async function installRecoveryRule(
  page: Page, host: string, friendAddresses: string[], threshold: number,
): Promise<void> {
  await page.goto(`http://${host}/security/`, { waitUntil: 'load' });
  await page.locator('#add-recovery').click();
  // Friend rows: one input per friend. The first row exists; add more as needed.
  const inputs = page.locator('#rc-friends input');
  for (let i = 0; i < friendAddresses.length; i++) {
    if (i > 0) await page.locator('#rc-add-friend').click();
    await inputs.nth(i).fill(friendAddresses[i]);
  }
  // Set threshold (M) via the stepper to the desired value.
  // (#rc-m-value shows current M; click #rc-m-up/#rc-m-down to adjust.)
  for (let guard = 0; guard < 10; guard++) {
    const m = parseInt((await page.locator('#rc-m-value').textContent())!.trim(), 10);
    if (m === threshold) break;
    await page.locator(m < threshold ? '#rc-m-up' : '#rc-m-down').click();
  }
  await page.locator('#rc-save').click();
  // Save signs the install with the primary passkey (shim). Wait for the form to
  // resolve (the recovery card appears / form closes). ADAPT the success
  // indicator to the page (e.g. #recovery-list gains a card, or #rc-save status).
  await page.waitForSelector('#recovery-form #rc-save', { state: 'detached', timeout: 120_000 })
    .catch(() => { /* fall through; Task-2 assertions will catch a real failure */ });
}
```

- [ ] **Step 2: Commit (helper only; exercised in Task 2)**

```bash
git add tests/support/recovery.ts
git commit -m "feat(test): recovery e2e helpers (multi-identity deploy + rule install)"
```

---

## Task 2: 1-of-1 recovery lifecycle (`@testnet`)

**Files:**
- Create: `tests/e2e/testnet/recovery.testnet.spec.ts`

**Run-to-validate.** This deploys 2 accounts + installs a recovery rule + runs the multi-actor ceremony — slow (~60-120s) and the most auth-fragile flow. Assert success where it works; **pin** any on-chain rejection with the exact error.

- [ ] **Step 1: Write the lifecycle test**

`tests/e2e/testnet/recovery.testnet.spec.ts`:
```ts
import { test, expect, useIdentity } from '../../support/fixtures';
import { seedBank, withRetry } from '../../support/testnet';
import { createAndDeployAs, installRecoveryRule } from '../../support/recovery';

const PORT = Number(process.env.E2E_PORT || 4399);

test.describe('@testnet social recovery (1-of-1)', () => {
  test.describe.configure({ timeout: 360_000 });

  test('friend-gated rotation: stage → friend signs → collect → submit', async ({ page, context }) => {
    await seedBank(context);

    // --- SETUP: deploy friend, then originator (distinct identities) ---
    const friend = await createAndDeployAs(page, PORT, 'friend-a');
    const orig = await createAndDeployAs(page, PORT, 'originator');

    // Install a 1-of-1 recovery rule on the originator, friend = friend account.
    await installRecoveryRule(page, orig.host, [friend.cAddress], 1);

    // --- ORIGINATOR: new key + stage rotation ---
    await page.goto(`http://${orig.host}/security/recover/`, { waitUntil: 'load' });
    await expect(page.locator('#originator-mode')).toBeVisible({ timeout: 30_000 });
    // The NEW rotation passkey is a fresh identity.
    await useIdentity(page, 'orig-rotated');
    await page.locator('#om-new-key').click();
    await expect(page.locator('#om-key-status')).toContainText(/created|ready|0x|04/i, { timeout: 30_000 });
    await page.locator('#om-prepare').click();
    await expect(page.locator('#om-collect')).toBeVisible({ timeout: 90_000 });
    const handoff = (await page.locator('#om-link').inputValue()).trim();
    expect(handoff).toContain('handoff=');

    // --- FRIEND: open handoff on the friend subdomain, sign ---
    // The handoff link points at the ORIGINATOR host; rewrite host→friend host
    // (the friend signs on THEIR subdomain so loadCredential finds their key).
    const handoffParam = new URL(handoff, `http://${orig.host}`).searchParams.get('handoff')!;
    await page.goto(`http://${friend.host}/security/recover/?handoff=${encodeURIComponent(handoffParam)}`, { waitUntil: 'load' });
    await expect(page.locator('#friend-mode')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#fm-account')).toContainText(orig.cAddress.slice(0, 8));
    await page.locator('#fm-sign').click();
    await expect(page.locator('#fm-blob')).not.toBeEmpty({ timeout: 30_000 });
    const blob = (await page.locator('#fm-blob').inputValue()).trim();
    expect(blob.length).toBeGreaterThan(0);

    // --- ORIGINATOR: collect + submit ---
    await page.goto(`http://${orig.host}/security/recover/`, { waitUntil: 'load' });
    await expect(page.locator('#om-collect')).toBeVisible({ timeout: 30_000 }); // staging persists
    await page.locator('#om-paste').fill(blob);
    await page.locator('#om-add-sig').click();
    await expect(page.locator('#om-progress')).toContainText(/1\s*(of|\/)\s*1/i, { timeout: 15_000 });
    await expect(page.locator('#om-submit')).toBeEnabled({ timeout: 15_000 });
    await page.locator('#om-submit').click();

    // --- ASSERT or PIN ---
    const outcome = await Promise.race([
      page.locator('#om-submit-status').filter({ hasText: /submitted|success|rotated|done/i })
        .first().waitFor({ timeout: 180_000 }).then(() => 'ok' as const),
      page.locator('#error-box, #om-submit-status').filter({ hasText: /Error|Failed|InvalidAction|#3\d{3}/i })
        .first().waitFor({ state: 'visible', timeout: 180_000 }).then(() => 'failed' as const),
    ]).catch(() => 'timeout' as const);

    if (outcome !== 'ok') {
      const status = (await page.locator('#om-submit-status').textContent().catch(() => ''))?.trim();
      const errBox = (await page.locator('#error-box').textContent().catch(() => ''))?.trim();
      // PIN: recovery is the most auth-fragile flow (nested auth + byte-identical
      // expiration + multisig policy). A rejection here is a real finding worth
      // capturing precisely. >>> FLIP to assert 'ok' once recovery works on-chain.
      throw new Error(
        `recovery submit did not succeed (outcome=${outcome}). ` +
          `om-submit-status="${status}" error-box="${errBox}" ` +
          `orig=${orig.cAddress} friend=${friend.cAddress}.`,
      );
    }
    expect(outcome).toBe('ok');
  });
});
```

- [ ] **Step 2: Run on testnet**

```bash
cd /home/willem/c/s/nido-phase3
npx tsc -p ./packages/passkey-sdk/tsconfig.json && npx astro build --root ./packages/frontend
set -a; . tests/.env.testnet; set +a
npx playwright test --project=testnet-chromium tests/e2e/testnet/recovery.testnet.spec.ts
```
This is the most likely flow to need adaptation: verify each ceremony id against the live page (`#om-new-key`/`#om-prepare`/`#om-collect`/`#om-link`/`#om-paste`/`#om-add-sig`/`#om-progress`/`#om-submit`/`#om-submit-status`, `#fm-sign`/`#fm-blob`, and the setup form ids). Confirm `installRecoveryRule` actually lands the rule (the security page shows it). If the **submit fails on-chain**, capture the EXACT `#error-box`/`#om-submit-status`/diagnostic text and report it — that's a genuine recovery/contract-auth finding (compare against the integration-test snapshots `two_friend_signatures_pass_for_self_scope`). Then **pin** (the throw above already documents the failure; convert it to a passing pin with a "flip when fixed" assertion if the failure is a real, stable contract finding). If `installRecoveryRule` itself can't be driven via the UI (e.g. friend resolution needs on-chain name registration), report BLOCKED with specifics — we may need to install the rule via the SDK instead.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/testnet/recovery.testnet.spec.ts
git commit -m "test(e2e): testnet 1-of-1 social recovery lifecycle (assert or pin)"
```

---

## Self-Review

**Spec coverage (Phase 3b-recovery / 1-of-1):**
- Setup (deploy originator + friend with DISTINCT identities, install 1-of-1 recovery rule) → Task 1 helpers + Task 2 setup block.
- Originator ceremony (new key, stage, handoff) → Task 2.
- Friend ceremony (handoff link on friend subdomain, sign, blob) → Task 2.
- Collect + submit + assert/pin → Task 2.
- Multi-actor via one context navigating subdomains; distinct identities via `useIdentity` before each register; handoff via URL + blob via `#fm-blob`→`#om-paste`.

**Deferred (follow-ons):** M-of-N (>1 friend, threshold>1), negative cases (insufficient/over-scope sigs — cf. integration snapshots), and verifying the rotated key works afterward.

**Placeholder scan:** Task 1 helpers are complete code. Task 2 is run-to-validate with explicit "verify each id against the live page" + "pin the exact error / report BLOCKED if the UI can't install the rule" guidance — concrete, not vague. The `installRecoveryRule` success-wait is best-effort (a real failure is caught by Task 2's assertions) with a documented fallback.

**Type consistency:** `createAndDeployAs(page, PORT, label) → {cAddress, host}` and `installRecoveryRule(page, host, friends[], threshold)` (Task 1) used consistently in Task 2. `useIdentity`/`SEED_HEX` from fixtures; `seedBank`/`withRetry` from testnet.ts. `@testnet` + `E2E_PORT` consistent. Element ids match the verified recover/security pages.
