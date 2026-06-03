// Connect needs no passkey (just account selection + redirect), so use the
// base Playwright test — not the shim fixture.
import { test, expect } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 4399);
const FAKE_CONTRACT_ID = 'CDLZFC2SYJYDZT7K7VJRL2CU7LQV6AFZ2K2QJLY7QV53KIGWXJOANPYY';
const DAPP = `http://dapp.localhost:${PORT}`;

test.describe('@fast dapp connect ceremony', () => {
  test('picker returns the chosen account via redirect', async ({ page }) => {
    // Seed g2c:accounts on the WALLET origin (localhost:PORT) before loading
    // the connect page, so loadAccounts() finds the account.
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await page.evaluate((acc) => {
      // Account-store format: key "g2c:accounts", value = JSON array of C-address strings.
      localStorage.setItem('g2c:accounts', JSON.stringify([acc]));
    }, FAKE_CONTRACT_ID);

    const ret = `${DAPP}/cb`;
    await page.goto(
      `http://localhost:${PORT}/connect/?dapp=${encodeURIComponent(DAPP)}&return=${encodeURIComponent(ret)}`,
      { waitUntil: 'load' },
    );
    await expect(page.locator('#accounts-list .account-row')).toHaveCount(1);
    await expect(page.locator('#dapp-origin')).toContainText('dapp.localhost');
    await page.locator('#accounts-list .account-row').first().click();
    await page.waitForURL(`**/cb?g2c_address=${FAKE_CONTRACT_ID}**`, { timeout: 10_000 });
    expect(new URL(page.url()).searchParams.get('g2c_address')).toBe(FAKE_CONTRACT_ID);
  });

  test('cancel returns g2c_connect=cancelled', async ({ page }) => {
    const ret = `${DAPP}/cb`;
    await page.goto(
      `http://localhost:${PORT}/connect/?dapp=${encodeURIComponent(DAPP)}&return=${encodeURIComponent(ret)}`,
      { waitUntil: 'load' },
    );
    await page.locator('#cancel').click();
    await page.waitForURL('**/cb?g2c_connect=cancelled**', { timeout: 10_000 });
  });
});
