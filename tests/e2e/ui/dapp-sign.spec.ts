import { test, expect, SEED_HEX } from '../../support/fixtures';
import { seedCredential } from '../../support/auth/seed';

const PORT = Number(process.env.E2E_PORT || 4399);
const FAKE_CONTRACT_ID = 'CDLZFC2SYJYDZT7K7VJRL2CU7LQV6AFZ2K2QJLY7QV53KIGWXJOANPYY';
const host = `${FAKE_CONTRACT_ID.toLowerCase()}.localhost:${PORT}`;
const DAPP = `http://dapp.localhost:${PORT}`;

async function gotoSign(page: import('@playwright/test').Page, query: string) {
  // Land on the account origin first to seed the credential, then load /sign/.
  await page.goto(`http://${host}/account/`, { waitUntil: 'load' });
  await seedCredential(page, FAKE_CONTRACT_ID, SEED_HEX, 'default');
  const ret = `${DAPP}/cb`;
  await page.goto(
    `http://${host}/sign/?${query}&dapp=${encodeURIComponent(DAPP)}&return=${encodeURIComponent(ret)}`,
    { waitUntil: 'load' },
  );
}

test.describe('@fast dapp sign (message)', () => {
  test('signs a message and returns g2c_signed', async ({ page }) => {
    await gotoSign(page, 'kind=message&message=' + encodeURIComponent('hello world'));
    await expect(page.locator('#needs-register')).toBeHidden();
    await expect(page.locator('#approve')).toBeEnabled();
    await page.locator('#approve').click();
    await page.waitForURL('**/cb?g2c_signed=**', { timeout: 15_000 });
    const u = new URL(page.url());
    expect(u.searchParams.get('kind')).toBe('message');
    expect(u.searchParams.get('g2c_signed')).toBeTruthy();
  });

  test('cancel returns g2c_sign=cancelled', async ({ page }) => {
    await gotoSign(page, 'kind=message&message=hi');
    await page.locator('#cancel').click();
    await page.waitForURL('**/cb?g2c_sign=cancelled**', { timeout: 10_000 });
  });
});
