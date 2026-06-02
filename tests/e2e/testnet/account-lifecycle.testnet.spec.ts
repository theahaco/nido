import { test, expect } from '../../support/fixtures';
import { seedBank } from '../../support/testnet';

const PORT = Number(process.env.E2E_PORT || 4399);

// Real-chain: slow + retried. Quarantined via the testnet-* projects.
test.describe('@testnet account lifecycle', () => {
  test.describe.configure({ timeout: 180_000 });

  test('create + deploy, then claim a name on testnet', async ({ page, context }) => {
    await seedBank(context);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

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

    // 3) Register passkey (shim) → auto-deploy → #done-section.
    await page.locator('#register-btn').click();
    await expect(page.locator('#done-section')).toBeVisible({ timeout: 120_000 });

    // Credential persisted; no fatal JS errors.
    const cred = await page.evaluate(
      (cid) => localStorage.getItem(`passkey:${cid}:credentialId`),
      cAddress,
    );
    expect(cred).toBeTruthy();
    expect(errors.filter((e) => /Buffer|is not defined|Unexpected token/.test(e))).toEqual([]);

    // 4) Go to the account page on the C-address subdomain.
    await page.goto(`http://${host}/account/`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#home-mode')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#name-claim')).toBeVisible({ timeout: 30_000 });

    // 5) Claim a unique name (Date.now() is fine in a Playwright test runtime).
    const { uniqueName } = await import('../../support/testnet');
    const name = uniqueName('t', Date.now());
    await page.locator('#name-input').fill(name);
    await page.locator('#claim-name-btn').click();

    // 6) Claim builds+simulates, then redirects into signing mode (?sign=...).
    await page.waitForURL('**/account/?sign=**', { timeout: 90_000 });
    await expect(page.locator('#signing-mode')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#approve-btn')).toBeVisible({ timeout: 10_000 });

    // 7) Approve → shim get() signs → redirect to ?nameresult=1, then the return
    //    flow injects+submits+polls and finally redirects to the NAME subdomain.
    await page.locator('#approve-btn').click();
    await page.waitForURL(
      (u) => u.hostname.startsWith(`${name}.`) || /nameresult=1/.test(u.search),
      { timeout: 120_000 },
    );

    // 8) Confirm the name landed. The success path redirects to the NAME
    //    subdomain after a brief delay; if we caught the ?nameresult=1 URL
    //    first, wait for the success message ("Your Nido is now … taking you
    //    there") or the subsequent subdomain redirect. (The app's success text
    //    is "Nido is now", not "registered"/"success".)
    const onNameSubdomain = () => new URL(page.url()).hostname.startsWith(`${name}.`);
    if (!onNameSubdomain()) {
      await Promise.race([
        page.waitForURL((u) => u.hostname.startsWith(`${name}.`), { timeout: 120_000 }),
        expect(page.locator('#name-result')).toContainText(/Nido is now|registered|success/i, {
          timeout: 120_000,
        }),
      ]);
    }
    expect(errors.filter((e) => /No address credentials|Buffer|is not defined/.test(e))).toEqual([]);

    test.info().annotations.push({ type: 'cAddress', description: cAddress });
  });
});
