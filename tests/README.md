# Tests

Three tiers:

- **Unit (TestAuthenticator):** `just test-support` — Vitest, Node, validates
  the passkey shim crypto against the SDK parsers.
- **Fast UI e2e (`@fast`):** `just test-e2e` — Playwright on
  chromium/firefox/webkit using the in-page shim. No chain. Builds the
  frontend first.
- **Chromium CDP fidelity lane:** `just test-e2e-cdp` — real virtual
  authenticator; `*.cdp.spec.ts`.

The shim (`tests/support/auth/`) overrides `navigator.credentials` with a
deterministic P-256 vault keyed by credentialId. See
`docs/superpowers/specs/2026-06-02-cross-browser-passkey-test-harness-design.md`.

Testnet e2e, dapp/SEP-7, multi-actor recovery, and BrowserStack are added in
later phases.
