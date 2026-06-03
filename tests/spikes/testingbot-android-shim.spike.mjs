// Phase 0 de-risking spike (THROWAWAY ARTIFACT)
//
// Binary question: does Playwright's context.addInitScript run at document_start
// (BEFORE the page's own inline scripts) on a TestingBot REAL Android Chrome
// device, driven via Playwright's `_android` module?
//
// This gates whether g2c's WebAuthn passkey shim (an esbuild IIFE injected via
// addInitScript) can run on a real Android device in TestingBot's cloud.
//
// Secret discipline: TB_KEY / TB_SECRET are read from env and embedded in the
// wsEndpoint at runtime only. We NEVER log the key/secret or the full URL — only
// a redacted form.
//
// Run:
//   set -a; . /home/willem/c/theahaco/iac/.env; set +a
//   export TB_KEY=$(op read "op://theahaco/TheTestingBot/key")
//   export TB_SECRET=$(op read "op://theahaco/TheTestingBot/secret")
//   node tests/spikes/testingbot-android-shim.spike.mjs
//
// STATUS (2026-06-03): BLOCKED — and the real-device lane (Phase 0/4) is PAUSED
// by decision. The connection code below is CORRECT (matches TestingBot's
// official _android Playwright docs) and the creds authenticate, but the
// TheTestingBot account is on a *Manual Testing Plan* with no automation
// entitlement, so the WS handshake is rejected before any session:
//     wss://cloud.testingbot.com/playwright -> 400
//     "No sessionId: Manual Testing Plan only. Please upgrade to an automation
//      plan to perform automated testing."
// This was identical across 4 device names AND the desktop chromium.connect
// variant -> it's the account plan, not the code/device/API.
//
// TO RESUME: upgrade TheTestingBot to an Automation plan, then run the command
// above unchanged — it will give the binary document_start answer. The
// underlying risk is LOW (addInitScript at document_start is a Chromium/CDP
// property — Page.addScriptToEvaluateOnNewDocument — so it almost certainly
// works on Chrome-for-Android regardless of vendor). Still-unverified, separate
// follow-on: the TestingBot Tunnel + g2c's `*.localhost` subdomain routing,
// needed for the FULL passkey flow (this spike deliberately uses a data:/public
// URL to isolate the addInitScript question from the tunnel).

import { _android } from 'playwright-core';

const TB_KEY = process.env.TB_KEY;
const TB_SECRET = process.env.TB_SECRET;

// --- fail fast on missing creds ----------------------------------------------
if (!TB_KEY || !TB_SECRET) {
  console.error('FATAL: TB_KEY and/or TB_SECRET not set in env. Aborting.');
  process.exit(2);
}

// Device matrix to try, in order. TestingBot mobile docs show 'Pixel 8' /
// browserVersion '14.0'; we keep a couple of fallbacks in case that device/
// version is unavailable at run time.
const DEVICE_CANDIDATES = [
  { deviceName: 'Pixel 8', browserVersion: '14.0' },
  { deviceName: 'Pixel 7', browserVersion: '13.0' },
  { deviceName: 'Pixel 6', browserVersion: '13.0' },
  { deviceName: 'Galaxy S23', browserVersion: '13.0' },
];

function buildCaps({ deviceName, browserVersion }) {
  return {
    browserName: 'chrome',
    platformName: 'Android',
    deviceName,
    browserVersion,
    key: TB_KEY,
    secret: TB_SECRET,
  };
}

function buildWsEndpoint(caps) {
  return `wss://cloud.testingbot.com/playwright?capabilities=${encodeURIComponent(
    JSON.stringify(caps)
  )}`;
}

// Redacted form for logging — strips creds out of the capabilities blob.
function redactedEndpoint(caps) {
  const safe = { ...caps, key: '***', secret: '***' };
  return `wss://cloud.testingbot.com/playwright?capabilities=${encodeURIComponent(
    JSON.stringify(safe)
  )}`;
}

// The init script under test. Mirrors how g2c's passkey shim is injected:
// a side-effecting function that sets a global + a DOM marker as early as
// possible. If addInitScript runs at document_start, __g2cInitRan will be
// defined BEFORE any inline <script> in <head> parses.
function initScriptFn() {
  // eslint-disable-next-line no-undef
  window.__g2cInitRan = 'document_start';
  try {
    // eslint-disable-next-line no-undef
    document.documentElement.dataset.g2cShim = '1';
  } catch (e) {
    /* ignore */
  }
}

async function runOnDevice(candidate) {
  const caps = buildCaps(candidate);
  const wsEndpoint = buildWsEndpoint(caps);

  console.log(
    `\n=== Attempting device: ${candidate.deviceName} (Android ${candidate.browserVersion}) ===`
  );
  console.log(`wsEndpoint (redacted): ${redactedEndpoint(caps)}`);

  let device;
  let context;
  try {
    // TestingBot docs: _android.connect(wsEndpoint) — string form.
    device = await _android.connect(wsEndpoint);

    // Best-effort device identity logging.
    try {
      const model = typeof device.model === 'function' ? device.model() : device.model;
      const serial =
        typeof device.serial === 'function' ? device.serial() : device.serial;
      console.log(`Connected. device.model=${model ?? '?'} serial=${serial ?? '?'}`);
    } catch {
      console.log('Connected (device identity not introspectable).');
    }

    // launchBrowser() returns a Playwright BrowserContext.
    context = await device.launchBrowser();
    const page = await context.newPage();

    // --- inject the shim BEFORE any navigation -------------------------------
    await context.addInitScript(initScriptFn);

    // --- ORDERING proof via data: URL ---------------------------------------
    // An inline <head> script records whether __g2cInitRan was ALREADY defined
    // at parse time. If addInitScript runs at document_start, sentinel === true.
    const html =
      '<!doctype html><html><head><script>window.__sentinelAtParse = (typeof window.__g2cInitRan !== "undefined");</script></head><body>ok</body></html>';

    let urlStrategy = 'data:';
    let atParse = null;
    let ran = null;

    try {
      await page.goto('data:text/html,' + encodeURIComponent(html), {
        waitUntil: 'load',
        timeout: 60000,
      });
      atParse = await page.evaluate(() => window.__sentinelAtParse);
      ran = await page.evaluate(() => window.__g2cInitRan);
    } catch (dataErr) {
      // data: URLs sometimes rejected on the Android bridge. Fall back to a
      // public URL — proves "ran at all" (weaker) but not ordering at parse.
      console.warn(
        `data: URL navigation failed (${dataErr.message}); falling back to https://example.com (ran-at-all check only).`
      );
      urlStrategy = 'https://example.com (fallback)';
      await page.goto('https://example.com', { waitUntil: 'load', timeout: 60000 });
      ran = await page.evaluate(() => window.__g2cInitRan);
      // sentinel not meaningful here; leave atParse null.
    }

    console.log('\n--- RESULTS ---');
    console.log(`URL strategy:        ${urlStrategy}`);
    console.log(`__sentinelAtParse:   ${JSON.stringify(atParse)} (true => ran at document_start)`);
    console.log(`__g2cInitRan:        ${JSON.stringify(ran)} (=> ran at all)`);

    let status;
    if (atParse === true && ran === 'document_start') {
      status = 'PASS';
    } else if (ran === 'document_start' && atParse !== true) {
      status =
        urlStrategy.startsWith('https')
          ? 'PARTIAL (ran-at-all confirmed; ordering not testable via fallback URL)'
          : 'PARTIAL (ran at all, but NOT before inline parse — sentinel false)';
    } else {
      status = 'FAIL (init script did not run)';
    }
    console.log(`\nSTATUS: ${status}`);

    return { status, atParse, ran, urlStrategy, device: candidate };
  } finally {
    try {
      if (context) await context.close();
    } catch (e) {
      console.warn(`context.close() warning: ${e.message}`);
    }
    try {
      if (device) await device.close();
    } catch (e) {
      console.warn(`device.close() warning: ${e.message}`);
    }
  }
}

(async () => {
  let lastErr;
  for (const candidate of DEVICE_CANDIDATES) {
    try {
      const result = await runOnDevice(candidate);
      console.log('\n=================================================');
      console.log('FINAL:', JSON.stringify(result, null, 2));
      console.log('=================================================');
      process.exit(result.status.startsWith('PASS') ? 0 : 1);
    } catch (err) {
      lastErr = err;
      console.error(
        `\nDevice ${candidate.deviceName} (${candidate.browserVersion}) failed to establish/run:`
      );
      // Full error is NOT a secret — print it so we can distinguish a connection
      // failure from a feature failure. (No creds appear in PW error messages.)
      console.error(err && err.stack ? err.stack : err);
      console.error('Trying next device candidate (if any)...');
    }
  }

  console.error('\n=================================================');
  console.error('BLOCKED: no TestingBot Android session could be established.');
  console.error('Last error:');
  console.error(lastErr && lastErr.stack ? lastErr.stack : lastErr);
  console.error('=================================================');
  process.exit(3);
})();
