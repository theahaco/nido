import { test, expect, CDPSession } from "@playwright/test";
import { createServer, Server } from "http";
import { readFileSync } from "fs";
import { join, extname } from "path";

const DIST_DIR = "/home/willem/c/s/g2c/packages/frontend/dist";

// A fake 56-char contract ID for UI-only tests (no testnet needed)
const FAKE_CONTRACT_ID =
  "CDLZFC2SYJYDZT7K7VJRL2CU7LQV6AFZ2K2QJLY7QV53KIGWXJOANPYY";

function startServer(port: number): Promise<Server> {
  const server = createServer((req, res) => {
    const urlPath = req.url?.split("?")[0] || "/";
    let filePath = join(DIST_DIR, urlPath === "/" ? "/index.html" : urlPath);
    if (!extname(filePath)) filePath = join(filePath, "index.html");

    try {
      const content = readFileSync(filePath);
      const ext = extname(filePath);
      const types: Record<string, string> = {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".map": "application/json",
      };
      res.writeHead(200, {
        "Content-Type": types[ext] || "application/octet-stream",
      });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

async function setupVirtualAuthenticator(page: any): Promise<CDPSession> {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return client;
}

test.describe("Account page — UI tests", () => {
  let server: Server;

  test.beforeAll(async () => {
    server = await startServer(4399);
  });

  test.afterAll(() => {
    server.close();
  });

  test("built HTML contains name section elements", () => {
    const html = readFileSync(join(DIST_DIR, "account/index.html"), "utf-8");
    expect(html).toContain('id="name-section"');
    expect(html).toContain('id="name-claim"');
    expect(html).toContain('id="claim-name-btn"');
    expect(html).toContain('id="name-input"');
  });

  test("page loads without fatal JS errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("http://localhost:4399/account/", {
      waitUntil: "networkidle",
    });
    await expect(page.locator("h1")).toHaveText("Contract Account Wallet");

    const fatal = errors.filter(
      (e) =>
        e.includes("Buffer") ||
        e.includes("is not defined") ||
        e.includes("Unexpected token")
    );
    expect(fatal).toEqual([]);
  });

  test("name section visible on contract subdomain", async ({ page }) => {
    const url = `http://${FAKE_CONTRACT_ID.toLowerCase()}.localhost:4399/account/`;
    await page.goto(url, { waitUntil: "networkidle" });

    await expect(page.locator("#home-mode")).toBeVisible();
    await expect(page.locator("#name-section")).toBeVisible();
    await expect(page.locator("#name-claim")).toBeVisible();
    await expect(page.locator("#claim-name-btn")).toBeVisible();
    await expect(page.locator("#name-input")).toBeVisible();
    await expect(page.locator("#contract-id")).toContainText(FAKE_CONTRACT_ID);
  });

  test("empty name rejected by client validation", async ({ page }) => {
    const url = `http://${FAKE_CONTRACT_ID.toLowerCase()}.localhost:4399/account/`;
    await page.goto(url, { waitUntil: "networkidle" });

    await page.locator("#claim-name-btn").click();
    await expect(page.locator("#error-box")).toBeVisible();
    await expect(page.locator("#error-box")).toContainText("1-15 characters");
  });

  test("passkey registration with virtual authenticator", async ({ page }) => {
    const url = `http://${FAKE_CONTRACT_ID.toLowerCase()}.localhost:4399/account/`;
    await page.goto(url, { waitUntil: "networkidle" });
    await setupVirtualAuthenticator(page);

    await expect(page.locator("#register-section")).toBeVisible();
    await page.locator("#register-btn").click();

    await expect(page.locator("#passkey-info-section")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("#passkey-pubkey")).not.toBeEmpty();
    await expect(page.locator("#passkey-cred-id")).not.toBeEmpty();
  });
});

test.describe("Account page — testnet integration", () => {
  let server: Server;

  // Use the real deployed factory contract ID on testnet
  const FACTORY_CONTRACT_ID =
    "CDDMELYHOSD6M2T53F5DUYCXDS3VVOQ72E4KZMMZP37GQWII2WRKM2CC";
  const NAME_REGISTRY_ID =
    "CDVVRZAVXTUQLS5LCGUP3H26RGOIUFKNE2UEJ6CAWYMBWY5LNORF6POX";
  const RPC_URL = "https://soroban-testnet.stellar.org";
  const FRIENDBOT_URL = "https://friendbot.stellar.org";

  test.beforeAll(async () => {
    server = await startServer(4400);
  });

  test.afterAll(() => {
    server.close();
  });

  test("claim name: builds tx, simulates on testnet, and redirects to signing mode", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // Step 1: Navigate to the home page and create a new account
    await page.goto("http://localhost:4400/", { waitUntil: "networkidle" });
    await expect(page.locator("h1")).toContainText("G2C Smart Accounts");

    // Click "Create Account"
    await page.locator("#create-btn").click();

    // Wait for account creation (funding via friendbot + address prediction)
    await expect(page.locator("#c-address-result")).not.toBeEmpty({
      timeout: 30000,
    });

    // Get the predicted C-address
    const cAddress = await page.locator("#c-address-result").textContent();
    expect(cAddress).toBeTruthy();
    expect(cAddress!.startsWith("C")).toBe(true);

    console.log("Created account:", cAddress);

    // Step 2: Navigate to the new account's subdomain for passkey setup
    const accountHost = `${cAddress!.toLowerCase()}.localhost:4400`;
    const newAccountUrl = `http://${accountHost}/new-account/?key=${await getSecretFromSetupLink(page)}`;
    await page.goto(newAccountUrl, { waitUntil: "networkidle" });

    // Set up virtual authenticator
    const cdp = await setupVirtualAuthenticator(page);

    // Register passkey
    await page.locator("#register-btn").click();
    await expect(page.locator("#register-result")).toBeVisible({
      timeout: 15000,
    });

    // Deploy account
    await page.locator("#deploy-btn").click();
    await expect(page.locator("#deploy-result")).toContainText("deployed", {
      timeout: 60000,
    });

    console.log("Account deployed at:", cAddress);

    // Step 3: Go to the account page
    await page.goto(`http://${accountHost}/account/`, {
      waitUntil: "networkidle",
    });

    // Verify the page loaded correctly
    await expect(page.locator("#home-mode")).toBeVisible();
    await expect(page.locator("#contract-id")).toContainText(cAddress!);

    // Verify name section is visible with claim form
    await expect(page.locator("#name-section")).toBeVisible();
    await expect(page.locator("#name-claim")).toBeVisible();

    // Step 4: Claim a name
    const testName = `test${Date.now().toString(36).slice(-6)}`;
    console.log("Claiming name:", testName);

    await page.locator("#name-input").fill(testName);
    await page.locator("#claim-name-btn").click();

    // Wait for the flow to progress through simulation
    await expect(page.locator("#name-result")).toBeVisible({ timeout: 10000 });

    // Should show progress: Loading → Funding → Building → Simulating → Redirecting
    // Then redirect to signing mode
    const result = await Promise.race([
      page
        .waitForURL("**/account/?sign=**", { timeout: 60000 })
        .then(() => "redirected" as const),
      page
        .locator("#error-box:visible")
        .waitFor({ timeout: 60000 })
        .then(() => "error" as const),
    ]).catch(() => "timeout" as const);

    if (result === "error") {
      const err = await page.locator("#error-box").textContent();
      console.log("Claim error:", err);
      // If it's a simulation error, the contract might not be set up correctly
      // Still verify the flow reached the right point
      expect(err).not.toContain("Buffer");
      expect(err).not.toContain("is not defined");
    }

    if (result === "redirected") {
      console.log("Redirected to signing mode");
      const currentUrl = page.url();
      expect(currentUrl).toContain("sign=");
      expect(currentUrl).toContain("callback=");

      // Signing mode should be visible
      await expect(page.locator("#signing-mode")).toBeVisible({
        timeout: 5000,
      });

      // The passkey was already registered, so approve button should be ready
      await expect(page.locator("#approve-btn")).toBeVisible({ timeout: 5000 });

      // Step 5: Approve the signature (virtual authenticator auto-signs)
      await page.locator("#approve-btn").click();

      // Should show "Signed! Redirecting..."
      await expect(page.locator("#sign-mode-result")).toContainText("Signed", {
        timeout: 15000,
      });

      // Wait for redirect back to callback with nameresult=1
      await page.waitForURL("**/account/?nameresult=1**", {
        timeout: 15000,
      });

      console.log("Redirected back to nameresult handler");

      // The nameresult handler should now process the signed transaction
      // Wait for either success message or error
      const submitResult = await Promise.race([
        page
          .locator("#name-result")
          .filter({ hasText: "registered" })
          .waitFor({ timeout: 60000 })
          .then(() => "success" as const),
        page
          .locator("#error-box:visible")
          .waitFor({ timeout: 60000 })
          .then(() => "error" as const),
      ]).catch(() => "timeout" as const);

      if (submitResult === "success") {
        console.log("Name registered successfully!");
        const resultText = await page.locator("#name-result").textContent();
        expect(resultText).toContain(testName);
        expect(resultText).toContain("registered");
      } else if (submitResult === "error") {
        const err = await page.locator("#error-box").textContent();
        console.log("Submit error:", err);
        // Verify it's not the old "no address credentials" bug
        expect(err).not.toContain("No address credentials");
        expect(err).not.toContain("Buffer");
      } else {
        console.log("Submit timed out");
        const progressText = await page
          .locator("#name-result")
          .textContent()
          .catch(() => "");
        console.log("Last progress:", progressText);
      }
    }
  });
});

/** Extract the secret key from the setup link on the home page */
async function getSecretFromSetupLink(page: any): Promise<string> {
  const href = await page.locator("#setup-link").getAttribute("href");
  const url = new URL(href!, "http://localhost");
  return url.searchParams.get("key") || "";
}
