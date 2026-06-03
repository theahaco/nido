import { test, expect, SEED_HEX } from '../../support/fixtures';
import { seedBank, withRetry } from '../../support/testnet';
import { credentialFor } from '../../support/auth/seed';
import {
  Account,
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
} from '@stellar/stellar-sdk';

const PORT = Number(process.env.E2E_PORT || 4399);
const DAPP = `http://dapp.localhost:${PORT}`;
const RPC_URL = 'https://soroban-testnet.stellar.org';
const DUMMY_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
// Scope target for the session key: the deployed status-message contract on
// testnet (mirrors STATUS_FALLBACK in dapp-sign-tx.testnet.spec.ts). It's a
// real C-address that satisfies the delegate page's target regex.
const TARGET = 'CD5FK6CQ7QIZ5ONARG36Y53ERI5PIBGELSJUTD7OXYLK6EQAS4N3TFBV';

const enc = encodeURIComponent;

/**
 * Node-side mirror of `findRuleForPubkey` (packages/frontend/src/lib/
 * policyChainFetch.ts). Inlined here using ONLY `@stellar/stellar-sdk` — we do
 * NOT import the `@g2c/passkey-sdk` barrel (its untranspiled `export * as`
 * namespace trips Playwright's TS transform in the Node test process; see the
 * Phase-3a dapp-sign-tx spec).
 *
 * Simulates `get_context_rules_count` then `get_context_rule(i)` on the account,
 * decodes each rule RAW via `scValToNative`, and scans every signer for an
 * `["External", verifierAddr, pubkeyBytes]` whose pubkey hex equals `pubkeyHex`.
 * Returns the matching rule id (or null). Also exposes the verifier + context
 * type of the match for diagnostics.
 */
async function findRuleForPubkey(
  account: string,
  pubkeyHex: string,
): Promise<{ ruleId: number; verifier: string; contextType: string } | null> {
  const server = new rpc.Server(RPC_URL);

  async function simulateView(method: string, ...args: ReturnType<typeof nativeToScVal>[]) {
    const source = new Account(DUMMY_SOURCE, '0');
    const tx = new TransactionBuilder(source, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(new Contract(account).call(method, ...args))
      .setTimeout(0)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      throw new Error(
        `simulateView ${method}: ${(sim as rpc.Api.SimulateTransactionErrorResponse).error}`,
      );
    }
    const result = (sim as rpc.Api.SimulateTransactionSuccessResponse).result;
    if (!result) throw new Error(`simulateView ${method}: no result`);
    return result.retval;
  }

  // Decode the bytes a raw-`scValToNative` External signer hands back (it may
  // arrive as Uint8Array, a number[], or an object with numeric keys).
  function bytesToHex(raw: unknown): string | null {
    if (raw instanceof Uint8Array) {
      return Array.from(raw, (b) => b.toString(16).padStart(2, '0')).join('');
    }
    if (Array.isArray(raw)) {
      return (raw as number[]).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    if (typeof raw === 'object' && raw !== null) {
      const obj = raw as Record<string, number>;
      const ordered: number[] = [];
      for (let j = 0; obj[j as unknown as string] !== undefined; j++) {
        ordered.push(obj[j as unknown as string]);
      }
      if (ordered.length > 0) {
        return ordered.map((b) => b.toString(16).padStart(2, '0')).join('');
      }
    }
    return null;
  }

  // Raw-decoded Soroban enum: a tag-first array (e.g. ["CallContract", addr]),
  // or a bare symbol for a fieldless variant (e.g. "Default").
  function ctxTypeLabel(ct: unknown): string {
    if (Array.isArray(ct)) return ct.map((v) => String(v)).join(':');
    return String(ct);
  }

  const countRv = await simulateView('get_context_rules_count');
  const count = scValToNative(countRv) as number;
  const lowerHex = pubkeyHex.toLowerCase();

  for (let i = 0; i < count; i++) {
    const ruleRv = await simulateView('get_context_rule', nativeToScVal(i, { type: 'u32' }));
    const native = scValToNative(ruleRv) as {
      id?: number;
      signers?: unknown[];
      context_type?: unknown;
    };
    for (const s of native.signers ?? []) {
      // ["External", verifier, pubkey_bytes]
      if (Array.isArray(s) && s[0] === 'External') {
        const candidateHex = bytesToHex(s[2]);
        if (candidateHex && candidateHex.toLowerCase() === lowerHex) {
          return {
            ruleId: native.id ?? i,
            verifier: String(s[1]),
            contextType: ctxTypeLabel(native.context_type),
          };
        }
      }
    }
  }
  return null;
}

/**
 * @testnet — real-chain end-to-end of the session-key delegation ceremony.
 *
 * A dApp wants the account to grant a scoped session key. It opens
 * `<caddr>.localhost/security/delegate/?origin&target&pubkey&duration&return`.
 * The account owner approves; the page builds
 * `add_context_rule({ context_type: CallContract(target), name:'session-key',
 * signers:[External(verifier, sessionPubkey)] })` and signs it with the PRIMARY
 * passkey (shim → computeAuthDigest), then redirects `?delegation=ok`.
 *
 * This is a SELF-modification — the account adds its OWN rule — so it's
 * authorized by the account's Default rule. We EXPECT SUCCESS. A `#status`
 * "Failed: …" here would be a genuine contract-auth finding (a self-add being
 * rejected) and is surfaced verbatim rather than swallowed.
 *
 * After the redirect we verify on-chain (Node-side, mirroring findRuleForPubkey)
 * that the session pubkey is now an External signer on some rule of the account.
 */
test.describe('@testnet session-key delegation install (primary-passkey signed)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('installs a scoped session key via /security/delegate/ and verifies it on-chain', async ({
    page,
    context,
  }) => {
    await seedBank(context);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // -----------------------------------------------------------------
    // PART A — create + deploy a v0.7 account (mirrors account-lifecycle)
    // -----------------------------------------------------------------

    // 1) Home → create account (friendbot fund + factory.get_c_address).
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('#create-btn').click();
    await expect(page.locator('#c-address-result')).not.toBeEmpty({ timeout: 60_000 });
    const cAddress = (await page.locator('#c-address-result').textContent())?.trim() ?? '';
    expect(cAddress).toMatch(/^C[A-Z2-7]{55}$/);

    // 2) Follow the setup link (carries ?key=<secret>) to the C-address subdomain.
    const setupHref = await page.locator('#setup-link').getAttribute('href');
    expect(setupHref).toContain('/new-account/');
    expect(setupHref).toContain('key=');
    const key = new URL(setupHref!, 'http://x').searchParams.get('key')!;
    const host = `${cAddress.toLowerCase()}.localhost:${PORT}`;
    await page.goto(`http://${host}/new-account/?key=${encodeURIComponent(key)}`, {
      waitUntil: 'domcontentloaded',
    });

    // 3) Register passkey (shim) → auto-deploy → #done-section. Registration
    //    stores the primary ('default') credential on the C-address origin, so
    //    the delegate page (same origin) signs the add_context_rule with it.
    await page.locator('#register-btn').click();
    await expect(page.locator('#done-section')).toBeVisible({ timeout: 120_000 });
    const cred = await page.evaluate(
      (cid) => localStorage.getItem(`passkey:${cid}:credentialId`),
      cAddress,
    );
    expect(cred).toBeTruthy();
    expect(errors.filter((e) => /Buffer|is not defined|Unexpected token/.test(e))).toEqual([]);

    // -----------------------------------------------------------------
    // PART B — the dApp's session key (deterministic, Node-side)
    // -----------------------------------------------------------------

    // The dApp generated its own session keypair; we derive the public half
    // deterministically. publicKeyHex is 65-byte uncompressed SEC1 (0x04 || x ||
    // y), matching the delegate page's /^04[0-9a-fA-F]{128}$/ pubkey regex.
    const session = await credentialFor(SEED_HEX, 'session');
    expect(session.publicKeyHex).toMatch(/^04[0-9a-fA-F]{128}$/);

    // -----------------------------------------------------------------
    // PART C — drive the /security/delegate/ ceremony on the account subdomain
    // -----------------------------------------------------------------

    const delegateUrl =
      `http://${host}/security/delegate/?origin=${enc(DAPP)}` +
      `&target=${TARGET}` +
      `&pubkey=${session.publicKeyHex}` +
      `&duration=24h` +
      `&return=${enc(`${DAPP}/cb`)}`;
    await page.goto(delegateUrl, { waitUntil: 'domcontentloaded' });

    // Request surfaced correctly + approval allowed (validate() passed).
    await expect(page.locator('#pubkey-text')).toHaveText(session.publicKeyHex);
    await expect(page.locator('#target-text')).toHaveText(TARGET);
    await expect(page.locator('#approve')).toBeEnabled({ timeout: 30_000 });

    // -----------------------------------------------------------------
    // PART D — approve → shim signs with primary passkey → ?delegation=ok
    // -----------------------------------------------------------------

    await page.locator('#approve').click();

    // Race the success redirect against the page's own "Failed: …" #status so an
    // on-chain rejection surfaces verbatim instead of timing out blind.
    const outcome = await Promise.race([
      page
        .waitForURL('**/cb?delegation=ok**', { timeout: 180_000 })
        .then(() => 'ok' as const),
      page
        .locator('#status')
        .filter({ hasText: /Failed:/ })
        .first()
        .waitFor({ state: 'visible', timeout: 180_000 })
        .then(() => 'failed' as const),
    ]).catch(() => 'timeout' as const);

    if (outcome !== 'ok') {
      // Surface the ceremony / on-chain error verbatim. A failure here is an
      // important finding: a SELF-modification (the account adding its own rule)
      // should authorize under the account's Default rule, so an unexpected
      // rejection is real signal — REPORT it, don't loosen the assert.
      const statusText = (await page.locator('#status').textContent().catch(() => null))?.trim();
      throw new Error(
        `session-key install did not reach ?delegation=ok (outcome=${outcome}). ` +
          `#status="${statusText ?? '<none>'}". ` +
          `account=${cAddress} target=${TARGET} sessionPubkey=${session.publicKeyHex}. ` +
          `EXPECTED SUCCESS — a self-add of a context rule authorizes under the Default rule.`,
      );
    }
    expect(outcome).toBe('ok');

    // -----------------------------------------------------------------
    // PART E — verify on-chain the session key is now an External signer
    // -----------------------------------------------------------------

    // Retry the rule read: after the redirect the install tx has closed, but a
    // different RPC node can briefly lag behind ledger close. withRetry (backoff)
    // avoids a spurious null from that race; it throws (→ test fails) if the rule
    // genuinely never appears.
    const match = await withRetry(
      async () => {
        const m = await findRuleForPubkey(cAddress, session.publicKeyHex);
        if (!m) throw new Error('session pubkey not yet visible on any rule');
        return m;
      },
      { tries: 4, baseMs: 1500 },
    );
    expect(
      match,
      `session pubkey ${session.publicKeyHex} not found as an External signer on any rule of ${cAddress}`,
    ).not.toBeNull();
    expect(match!.ruleId).toBeGreaterThanOrEqual(0);

    expect(errors.filter((e) => /Buffer|is not defined|Unexpected token/.test(e))).toEqual([]);
    test.info().annotations.push({ type: 'cAddress', description: cAddress });
    test.info().annotations.push({ type: 'sessionPubkey', description: session.publicKeyHex });
    test.info().annotations.push({ type: 'ruleId', description: String(match!.ruleId) });
    test.info().annotations.push({ type: 'verifier', description: match!.verifier });
    test.info().annotations.push({ type: 'contextType', description: match!.contextType });
  });
});
