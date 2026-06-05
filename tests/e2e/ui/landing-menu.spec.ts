import { test, expect } from '@playwright/test';

// The landing "Get started" buttons dispatch a `nido:open-menu` event that
// MyNidoMenu opens on. Regression: that dispatching click keeps bubbling up to
// the document-level "click outside closes" handler, which must NOT close the
// menu it just opened. (It does when open() runs synchronously during the same
// click — the menu flashes open then closes, so the button "does nothing".)
test.describe('landing My Nido menu (shim) @fast', () => {
  test('Get started opens — and keeps open — the My Nido menu @fast', async ({
    page,
  }) => {
    await page.goto('/');

    // Closed to begin with.
    await expect(page.locator('#mynido')).not.toHaveClass(/mynido-open/);

    // Clicking the hero CTA opens the menu popover and it stays open.
    await page.locator('#get-started-hero').click();
    await expect(page.locator('#mynido')).toHaveClass(/mynido-open/);
    await expect(page.locator('#mynido-panel')).toBeVisible();
  });
});
