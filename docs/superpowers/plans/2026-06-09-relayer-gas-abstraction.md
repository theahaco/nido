# Relayer Gas Abstraction Implementation Plan (Deliverable 4, PR 1 — #72/#73)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nido wallet users submit transactions without holding XLM: the wallet passkey-signs only the `SorobanAuthorizationEntry`; a self-hosted OpenZeppelin Relayer v1.5.0 + Channels plugin on Fly.io is transaction source and fee payer.

**Architecture:** One Fly app runs the official relayer image (Docker Hub `openzeppelin/openzeppelin-relayer:v1.5.0`) with the Channels plugin (`@openzeppelin/relayer-plugin-channels@0.20.0`) layered in, plus a Caddy sidecar in the same container that terminates CORS and injects the relayer API key server-side (the relayer has **no CORS support** — verified against v1.5.0 `Cargo.toml`/`main.rs` — and the browser never sees the key this way). State in Upstash Redis. The frontend gains a small fetch-based relayer client (the npm Channels client is CommonJS/Node-only — not browser-safe) and a relayer branch in `signAndSubmit` behind a `PUBLIC_RELAYER_URL` build flag, falling back to today's ephemeral-G self-submission when unset.

**Tech Stack:** OZ Relayer v1.5.0 (Rust, AGPL-3.0), relayer-plugin-channels 0.20.0 (ts-node inside the relayer image), Caddy, Fly.io + Upstash Redis, Astro/TypeScript frontend, vitest.

**Spec:** `docs/superpowers/specs/2026-06-09-relayer-gas-abstraction-design.md`. Research facts (image, config schema, API shapes, plugin protocol) were verified against the v1.5.0 git tag and plugin v0.20.0 source on 2026-06-09; key facts are restated inline so tasks are self-contained.

**Verified facts used throughout (do not re-derive):**
- Image `docker.io/openzeppelin/openzeppelin-relayer:v1.5.0`: wolfi-base, user `nonroot`, `ENTRYPOINT /app/openzeppelin-relayer`, `APP_PORT=8080`, Node 20.19 + pnpm + ts-node baked in, repo `plugins/` at `/app/plugins`, config read from `/app/config/config.json` when `IN_DOCKER=true`.
- Required env: `REDIS_URL` (always), `API_KEY` (always, ≥32 chars), `STORAGE_ENCRYPTION_KEY` (when `REPOSITORY_STORAGE_TYPE=redis`), `KEYSTORE_PASSPHRASE` (referenced from config.json). Health: `GET /api/v1/health` → `200 OK` (no auth). Plugin call: `POST /api/v1/plugins/{id}/call`, body `{"params": ...}`, `Authorization: Bearer <API_KEY>` (+ `x-api-key` for per-key fee tracking).
- Channels plugin env: `STELLAR_NETWORK`, `FUND_RELAYER_ID`, `PLUGIN_ADMIN_SECRET`. Fund relayer needs `"concurrent_transactions": true`. Channel accounts are ordinary relayer entries; after funding they must be activated once via the `setChannelAccounts` management action. Plugin re-simulates server-side in enforce mode with our auth entries; auth must use **address credentials** (ours do); `signatureExpirationLedger` only has a MINIMUM buffer (default 2 ledgers; we sign +10000, ample).
- Plugin response statuses: `pending|sent|submitted|confirmed|failed|expired`. Response envelope `{success, data, error}`; v1.5.0 may nest payload as `data.result` (handle both).
- Wallet signing today (`packages/frontend/src/lib/primaryPasskeySigner.ts`): recording-mode sim (auth stripped) → extract auth entry → passkey-sign digest → `injectPasskeySignature` (sets expiration `lastLedger + 10000`) → enforce-mode re-sim + fee refit → sign with friendbot-funded ephemeral G → `sendTransaction` + poll. The relayer branch replaces everything after `injectPasskeySignature`.

---

## File structure

```
infra/relayer/
  Dockerfile               # v1.5.0 image + caddy + plugin + config baked in
  fly.toml                 # app nido-relayer, org aha-684, internal_port 8080 (caddy)
  Caddyfile                # CORS + API-key injection + /relay -> plugin call
  entrypoint.sh            # write keystores from secrets, start caddy + relayer
  config/
    config.json            # 1 fund + 2 channel relayers, local signers, channels plugin
    networks/stellar.json  # network defs (copied verbatim from relayer repo)
  plugins/channels/
    index.ts               # one-line re-export of the plugin handler
    package.json
    .npmrc                 # engine-strict=false (image Node 20.19 vs plugin engines >=22)
  scripts/
    create-keys.sh         # generate 3 local keystores via relayer's create_key example
    activate-channels.sh   # one-time setChannelAccounts management call
  README.md                # runbook: app create, redis, secrets, fund, activate
.github/workflows/
  deploy-relayer.yml       # NEW: paths-filtered deploy via 1Password->Fly
  preview.yml              # MODIFIED: add paths filter (packages/**)
packages/frontend/src/lib/
  network.ts               # MODIFIED: RELAYER_URL + RELAYER_SIM_SOURCE consts
  relayerClient.ts         # NEW: fetch client for /relay (+ extractFuncAndAuth)
  relayerClient.test.ts    # NEW: vitest unit tests
  primaryPasskeySigner.ts  # MODIFIED: relayer branch in signAndSubmit
scripts/
  relayer-proof.mjs        # NEW: automated gas-abstraction proof on testnet
```

---

### Task 1: Relayer infra files (`infra/relayer/`)

**Files:**
- Create: `infra/relayer/config/config.json`
- Create: `infra/relayer/config/networks/stellar.json`
- Create: `infra/relayer/plugins/channels/index.ts`, `package.json`, `.npmrc`
- Create: `infra/relayer/Caddyfile`
- Create: `infra/relayer/entrypoint.sh`
- Create: `infra/relayer/Dockerfile`
- Create: `infra/relayer/fly.toml`

- [ ] **Step 1.1: Write `infra/relayer/config/config.json`**

```json
{
  "relayers": [
    {
      "id": "channels-fund",
      "name": "Channels Fund",
      "network": "testnet",
      "paused": false,
      "network_type": "stellar",
      "signer_id": "fund-signer",
      "policies": { "concurrent_transactions": true, "fee_payment_strategy": "relayer" }
    },
    {
      "id": "channel-001",
      "name": "Channel 001",
      "network": "testnet",
      "paused": false,
      "network_type": "stellar",
      "signer_id": "channel-001-signer",
      "policies": { "fee_payment_strategy": "relayer" }
    },
    {
      "id": "channel-002",
      "name": "Channel 002",
      "network": "testnet",
      "paused": false,
      "network_type": "stellar",
      "signer_id": "channel-002-signer",
      "policies": { "fee_payment_strategy": "relayer" }
    }
  ],
  "notifications": [],
  "signers": [
    {
      "id": "fund-signer",
      "type": "local",
      "config": {
        "path": "config/keys/fund.json",
        "passphrase": { "type": "env", "value": "KEYSTORE_PASSPHRASE" }
      }
    },
    {
      "id": "channel-001-signer",
      "type": "local",
      "config": {
        "path": "config/keys/channel-001.json",
        "passphrase": { "type": "env", "value": "KEYSTORE_PASSPHRASE" }
      }
    },
    {
      "id": "channel-002-signer",
      "type": "local",
      "config": {
        "path": "config/keys/channel-002.json",
        "passphrase": { "type": "env", "value": "KEYSTORE_PASSPHRASE" }
      }
    }
  ],
  "networks": "./config/networks",
  "plugins": [
    { "id": "channels", "path": "channels/index.ts", "timeout": 30, "emit_logs": true }
  ]
}
```

- [ ] **Step 1.2: Write `infra/relayer/config/networks/stellar.json`** (verbatim from relayer v1.5.0 `config/networks/stellar.json` — definitions are NOT built into the binary)

```json
{
  "networks": [
    {
      "type": "stellar",
      "network": "mainnet",
      "rpc_urls": ["https://mainnet.sorobanrpc.com"],
      "explorer_urls": ["https://stellar.expert/explorer/public"],
      "average_blocktime_ms": 5000,
      "is_testnet": false,
      "passphrase": "Public Global Stellar Network ; September 2015",
      "horizon_url": "https://horizon.stellar.org"
    },
    {
      "from": "mainnet",
      "type": "stellar",
      "network": "testnet",
      "rpc_urls": ["https://soroban-testnet.stellar.org"],
      "explorer_urls": ["https://stellar.expert/explorer/testnet"],
      "is_testnet": true,
      "passphrase": "Test SDF Network ; September 2015",
      "horizon_url": "https://horizon-testnet.stellar.org"
    }
  ]
}
```

- [ ] **Step 1.3: Write the plugin wrapper**

`infra/relayer/plugins/channels/index.ts`:
```ts
export { handler } from '@openzeppelin/relayer-plugin-channels';
```

`infra/relayer/plugins/channels/package.json` (deps mirror the official `examples/channels-plugin-example`):
```json
{
  "name": "nido-channels-plugin",
  "private": true,
  "dependencies": {
    "@openzeppelin/relayer-plugin-channels": "0.20.0",
    "@openzeppelin/relayer-sdk": "^1.10.0"
  }
}
```

`infra/relayer/plugins/channels/.npmrc` (plugin declares `engines.node >= 22.18`; the v1.5.0 image ships Node 20.19 — the official example runs on it, so don't let pnpm hard-fail):
```
engine-strict=false
```

- [ ] **Step 1.4: Write `infra/relayer/Caddyfile`** (CORS + server-side key injection; relayer listens internally on 8090)

```
:8080 {
	@preflight {
		method OPTIONS
		path /relay
	}
	handle @preflight {
		header Access-Control-Allow-Origin "*"
		header Access-Control-Allow-Methods "POST, OPTIONS"
		header Access-Control-Allow-Headers "Content-Type"
		respond 204
	}
	handle /relay {
		header Access-Control-Allow-Origin "*"
		request_header Authorization "Bearer {$API_KEY}"
		request_header x-api-key "nido-wallet"
		rewrite * /api/v1/plugins/channels/call
		reverse_proxy 127.0.0.1:8090
	}
	handle /api/v1/health {
		reverse_proxy 127.0.0.1:8090
	}
	handle {
		respond 404
	}
}
```

Notes: `x-api-key` is a non-secret label used by the plugin for per-caller fee accounting (`API_KEY_HEADER` default). `Access-Control-Allow-Origin *` is acceptable on testnet because abuse cost = relayer's friendbot-funded XLM; tighten to the wallet origins before mainnet. Management actions go through the same endpoint but are gated by `PLUGIN_ADMIN_SECRET`, which is never exposed.

- [ ] **Step 1.5: Write `infra/relayer/entrypoint.sh`** (wolfi sh is not bash — keep POSIX; caddy in background, relayer foreground so the container dies with the relayer; if caddy dies, the Fly HTTP check on :8080 fails and the machine restarts)

```sh
#!/bin/sh
set -eu

mkdir -p /app/config/keys
printf '%s' "$KEYSTORE_FUND_B64" | base64 -d > /app/config/keys/fund.json
printf '%s' "$KEYSTORE_CHANNEL_001_B64" | base64 -d > /app/config/keys/channel-001.json
printf '%s' "$KEYSTORE_CHANNEL_002_B64" | base64 -d > /app/config/keys/channel-002.json

caddy run --config /app/Caddyfile --adapter caddyfile &

exec /app/openzeppelin-relayer
```

- [ ] **Step 1.6: Write `infra/relayer/Dockerfile`**

```dockerfile
FROM docker.io/openzeppelin/openzeppelin-relayer:v1.5.0

USER root
RUN apk add --no-cache caddy

COPY plugins/channels /app/plugins/channels
RUN cd /app/plugins/channels && pnpm install --prod --frozen-lockfile \  # as built: lockfile committed, exact pins
    && mkdir -p /app/config/keys \
    && chown -R nonroot /app/plugins/channels /app/config

COPY config/config.json /app/config/config.json
COPY config/networks /app/config/networks
COPY Caddyfile /app/Caddyfile
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh && chown -R nonroot /app/config

USER nonroot
ENV IN_DOCKER=true
ENTRYPOINT ["/app/entrypoint.sh"]
```

(If `apk add caddy` fails on the wolfi base, fall back to `RUN apk add --no-cache curl && curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=amd64" -o /usr/bin/caddy && chmod +x /usr/bin/caddy`.)

- [ ] **Step 1.7: Write `infra/relayer/fly.toml`**

```toml
app = "nido-relayer"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[env]
  APP_PORT = "8090"
  METRICS_ENABLED = "false"
  REPOSITORY_STORAGE_TYPE = "redis"
  REDIS_KEY_PREFIX = "nido-relayer"
  STELLAR_NETWORK = "testnet"
  FUND_RELAYER_ID = "channels-fund"
  RATE_LIMIT_REQUESTS_PER_SECOND = "20"
  RATE_LIMIT_BURST_SIZE = "60"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1

  [[http_service.checks]]
    interval = "15s"
    timeout = "5s"
    grace_period = "30s"
    method = "GET"
    path = "/api/v1/health"

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
```

Secrets (NOT in fly.toml; set in Task 4): `API_KEY`, `STORAGE_ENCRYPTION_KEY`, `KEYSTORE_PASSPHRASE`, `PLUGIN_ADMIN_SECRET`, `REDIS_URL`, `KEYSTORE_FUND_B64`, `KEYSTORE_CHANNEL_001_B64`, `KEYSTORE_CHANNEL_002_B64`.

- [ ] **Step 1.8: Validate JSON + commit**

Run: `jq . infra/relayer/config/config.json infra/relayer/config/networks/stellar.json infra/relayer/plugins/channels/package.json > /dev/null && echo OK`
Expected: `OK`

```bash
git add infra/relayer
git commit -m "feat(relayer): infra for self-hosted OZ Relayer + Channels on Fly (#72)"
```

---

### Task 2: Key scripts + runbook

**Files:**
- Create: `infra/relayer/scripts/create-keys.sh`
- Create: `infra/relayer/scripts/activate-channels.sh`
- Create: `infra/relayer/README.md`

- [ ] **Step 2.1: Write `infra/relayer/scripts/create-keys.sh`** (the keystore format comes from the relayer's own `create_key` example — generate with the pinned tag, never hand-roll)

```sh
#!/bin/sh
# Generates the three local keystores for the relayer (fund + 2 channels).
# Usage: KEYSTORE_PASSPHRASE='<strong passphrase>' ./create-keys.sh <output-dir>
# Passphrase rules (enforced by create_key): >=12 chars, upper, lower, digit, special.
set -eu
OUT="${1:?usage: create-keys.sh <output-dir>}"
: "${KEYSTORE_PASSPHRASE:?set KEYSTORE_PASSPHRASE}"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
git clone --depth 1 --branch v1.5.0 https://github.com/OpenZeppelin/openzeppelin-relayer "$WORK/relayer"
cd "$WORK/relayer"
for name in fund channel-001 channel-002; do
  cargo run --example create_key -- \
    --password "$KEYSTORE_PASSPHRASE" \
    --output-dir "$OUT" \
    --filename "$name.json"
done
echo "Keystores written to $OUT — store them in 1Password (vault theahaco), then:"
for name in fund channel-001 channel-002; do
  upper=$(echo "$name" | tr 'a-z-' 'A-Z_')
  echo "  fly secrets set KEYSTORE_${upper}_B64=\"\$(base64 -w0 $OUT/$name.json)\" -a nido-relayer"
done
```

- [ ] **Step 2.2: Write `infra/relayer/scripts/activate-channels.sh`** (one-time pool activation after funding — the plugin won't process transactions until channel accounts are registered in its KV pool)

```sh
#!/bin/sh
# Usage: API_KEY=... PLUGIN_ADMIN_SECRET=... ./activate-channels.sh https://nido-relayer.fly.dev
set -eu
BASE="${1:?usage: activate-channels.sh <relayer-base-url>}"
: "${API_KEY:?}" ; : "${PLUGIN_ADMIN_SECRET:?}"
curl -fsS -X POST "$BASE/api/v1/plugins/channels/call" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"params\":{\"management\":{\"action\":\"setChannelAccounts\",\"adminSecret\":\"$PLUGIN_ADMIN_SECRET\",\"relayerIds\":[\"channel-001\",\"channel-002\"]}}}"
echo
```

Note: this script talks to the relayer's authenticated port directly (path `/api/v1/...`), which Caddy doesn't expose — run it against the Fly **internal** address via `fly proxy 8090:8090 -a nido-relayer` and `BASE=http://localhost:8090`, or temporarily add a Caddy passthrough. Document in README (Step 2.3) that `fly proxy` is the expected route.

- [ ] **Step 2.3: Write `infra/relayer/README.md`** — runbook with these sections (full prose, no placeholders):
  1. **What this is**: relayer + channels plugin + caddy, one Fly app `nido-relayer` in org `aha-684`; browser calls `POST /relay` (no key); Caddy injects `Authorization` from the `API_KEY` secret.
  2. **One-time bootstrap** (operator, local flyctl + 1Password):
     ```bash
     fly apps create nido-relayer --org aha-684
     fly redis create --name nido-relayer-redis --org aha-684 --region iad --no-replicas   # note the redis URL it prints
     KEYSTORE_PASSPHRASE='<generate + save to 1Password>' ./scripts/create-keys.sh /tmp/relayer-keys
     fly secrets set -a nido-relayer \
       REDIS_URL='<from fly redis create>' \
       API_KEY="$(openssl rand -hex 32)" \
       STORAGE_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
       KEYSTORE_PASSPHRASE='<same as above>' \
       PLUGIN_ADMIN_SECRET="$(openssl rand -hex 32)" \
       KEYSTORE_FUND_B64="$(base64 -w0 /tmp/relayer-keys/fund.json)" \
       KEYSTORE_CHANNEL_001_B64="$(base64 -w0 /tmp/relayer-keys/channel-001.json)" \
       KEYSTORE_CHANNEL_002_B64="$(base64 -w0 /tmp/relayer-keys/channel-002.json)"
     fly deploy infra/relayer --remote-only --ha=false
     ```
     Save `API_KEY`, `STORAGE_ENCRYPTION_KEY`, `KEYSTORE_PASSPHRASE`, `PLUGIN_ADMIN_SECRET`, and the three keystore JSONs to 1Password vault `theahaco` (item per secret or one `nido-relayer` item), then delete `/tmp/relayer-keys`.
  3. **Fund + activate**: read the three G-addresses from `fly logs -a nido-relayer` ("Syncing sequence for relayer: ... (G...)"), `curl "https://friendbot.stellar.org?addr=G..."` each, `fly apps restart nido-relayer`, then run `activate-channels.sh` via `fly proxy 8090:8090 -a nido-relayer`. Record the **fund account G-address** — the frontend needs it as `PUBLIC_RELAYER_SIM_SOURCE`.
  4. **Smoke test**: `curl https://nido-relayer.fly.dev/api/v1/health` → `OK`; a `POST /relay` with `{"params":{"getTransaction":{"transactionId":"nonexistent"}}}` → structured error (proves plugin executes).
  5. **Ops notes**: version pinned to v1.5.0 (Stellar support officially "under active development" — bump deliberately); `max_fee` default 1,000,000 stroops per tx; memos unsupported on Soroban ops; mainnet TODOs (KMS signer, CORS origin allowlist, scoped deploy token).

- [ ] **Step 2.4: Commit**

```bash
chmod +x infra/relayer/scripts/*.sh
git add infra/relayer
git commit -m "docs(relayer): bootstrap scripts + runbook (#72)"
```

---

### Task 3: CI — deploy workflow + preview paths filter

**Files:**
- Create: `.github/workflows/deploy-relayer.yml`
- Modify: `.github/workflows/preview.yml` (top `on:` block only)

- [ ] **Step 3.1: Write `.github/workflows/deploy-relayer.yml`**

```yaml
name: deploy-relayer

on:
  push:
    branches: [main, feat/72-relayer-gas-abstraction]  # branch entry is TEMPORARY for PR-phase deploys; drop before merge (Task 7)
    paths: ['infra/relayer/**']
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: deploy-relayer
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4

      - name: Load Fly token from 1Password
        uses: 1password/load-secrets-action@v2
        with:
          export-env: true
        env:
          OP_SERVICE_ACCOUNT_TOKEN: ${{ secrets.OP_SERVICE_ACCOUNT_TOKEN }}
          FLY_API_TOKEN: op://theahaco/nido_fly_io/credential

      - uses: superfly/flyctl-actions/setup-flyctl@master

      - name: Deploy
        run: flyctl deploy infra/relayer --remote-only --ha=false
```

(The `op://theahaco/nido_fly_io/credential` reference and `OP_SERVICE_ACCOUNT_TOKEN` wiring were verified working in CI on 2026-06-09 by `relayer-secrets-check.yml`.)

- [ ] **Step 3.2: Add paths filter to `preview.yml`** — change the `on:` block from:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened]
```

to:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened]
    paths:
      - 'packages/**'
      - 'package.json'
      - 'package-lock.json'
```

(Frontend previews skip PRs that only touch `infra/`, `contracts/`, `crates/`, docs. `packages/**` keeps previews for workspace deps the frontend build consumes.)

- [ ] **Step 3.3: Commit**

```bash
git add .github/workflows/deploy-relayer.yml .github/workflows/preview.yml
git commit -m "ci(relayer): deploy workflow via 1Password->Fly; scope frontend previews to packages/** (#72)"
```

---

### Task 4: Bootstrap + first deploy (operator checklist — needs Willem for `op signin`; flyctl install is scriptable)

- [ ] **Step 4.1:** Install flyctl locally if absent: `curl -L https://fly.io/install.sh | sh` (installs to `~/.fly/bin`). Get the Fly token: `export FLY_API_TOKEN=$(op read "op://theahaco/nido_fly_io/credential")` — requires the user to authenticate `op` (ask them to run `! op signin` or enable the desktop-app CLI integration).
- [ ] **Step 4.2:** Run the runbook bootstrap (README §2): app create, redis create, create-keys, secrets set.
- [ ] **Step 4.3:** First deploy: `fly deploy infra/relayer --remote-only --ha=false`. Expected: machine starts, `GET https://nido-relayer.fly.dev/api/v1/health` → `OK`.
- [ ] **Step 4.4:** Fund the three accounts via friendbot (addresses from `fly logs`), restart, run `activate-channels.sh`. Record the fund G-address for `PUBLIC_RELAYER_SIM_SOURCE`.
- [ ] **Step 4.5:** Save all generated secrets + keystores to 1Password vault `theahaco`. Verify `fly secrets list -a nido-relayer` shows all 8 names.

No commit (operational state only). If any relayer startup error appears in `fly logs`, fix config in Task 1 files and redeploy before proceeding.

---

### Task 5: Frontend relayer client (TDD)

**Files:**
- Modify: `packages/frontend/src/lib/network.ts` (append)
- Create: `packages/frontend/src/lib/relayerClient.ts`
- Test: `packages/frontend/src/lib/relayerClient.test.ts`

- [ ] **Step 5.1: Append to `network.ts`** (follows the file's existing exported-const pattern; `import.meta.env` is inlined by Astro/vite at build time):

```ts
/** OZ Relayer (Channels) endpoint. Empty string = relayer disabled; the wallet
 *  falls back to ephemeral-G self-submission. Set PUBLIC_RELAYER_URL at build
 *  time once the Fly app is live (e.g. https://nido-relayer.fly.dev). */
export const RELAYER_URL: string = import.meta.env.PUBLIC_RELAYER_URL ?? "";

/** Funded G-address used as the *simulation-only* tx source in relayer mode
 *  (the relayer's fund account — guaranteed on-chain). Never signs, never pays.
 *  Required because recording-mode simulateTransaction needs an existing
 *  source account, and in relayer mode we no longer friendbot-fund one. */
export const RELAYER_SIM_SOURCE: string = import.meta.env.PUBLIC_RELAYER_SIM_SOURCE ?? "";
```

- [ ] **Step 5.2: Write the failing tests** — `packages/frontend/src/lib/relayerClient.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RelayerError,
  extractFuncAndAuth,
  submitSorobanTransaction,
  getRelayerTransaction,
  waitForConfirmation,
} from "./relayerClient";
import { Networks, Operation, TransactionBuilder, Account, nativeToScVal, Address } from "@stellar/stellar-sdk";

const FETCH_URL = "https://relayer.test";
vi.stubEnv("PUBLIC_RELAYER_URL", FETCH_URL); // note: RELAYER_URL is read via injected baseUrl param in tests below

function mockFetchOnce(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("submitSorobanTransaction", () => {
  it("POSTs {params:{func,auth,skipWait}} to /relay and parses a flat data payload", async () => {
    const fetchMock = mockFetchOnce(200, {
      success: true,
      data: { transactionId: "tx_1", hash: null, status: "pending" },
      error: null,
    });
    const res = await submitSorobanTransaction({ func: "AAA=", auth: ["BBB="] }, FETCH_URL);
    expect(fetchMock).toHaveBeenCalledWith(`${FETCH_URL}/relay`, expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      params: { func: "AAA=", auth: ["BBB="], skipWait: true },
    });
    expect(res).toEqual({ transactionId: "tx_1", hash: null, status: "pending" });
  });

  it("unwraps the v1.5.0 data.result nesting", async () => {
    mockFetchOnce(200, {
      success: true,
      data: { result: { transactionId: "tx_2", hash: "abc", status: "confirmed" } },
      error: null,
    });
    const res = await submitSorobanTransaction({ func: "AAA=", auth: [] }, FETCH_URL);
    expect(res.transactionId).toBe("tx_2");
    expect(res.status).toBe("confirmed");
  });

  it("throws RelayerError with the plugin code on success:false", async () => {
    mockFetchOnce(400, {
      success: false,
      data: { code: "AUTH_EXPIRY_TOO_SHORT", details: { margin: 1 } },
      error: "Auth expiry too short",
    });
    await expect(submitSorobanTransaction({ func: "AAA=", auth: [] }, FETCH_URL)).rejects.toMatchObject({
      name: "RelayerError",
      code: "AUTH_EXPIRY_TOO_SHORT",
      message: "Auth expiry too short",
    });
  });
});

describe("waitForConfirmation", () => {
  it("polls getTransaction until confirmed", async () => {
    const responses = [
      { success: true, data: { transactionId: "tx_3", hash: null, status: "submitted" }, error: null },
      { success: true, data: { transactionId: "tx_3", hash: "deadbeef", status: "confirmed" }, error: null },
    ];
    const fn = vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => responses.shift(),
    }));
    vi.stubGlobal("fetch", fn);
    const res = await waitForConfirmation("tx_3", FETCH_URL, { intervalMs: 1, maxAttempts: 5 });
    expect(res.hash).toBe("deadbeef");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fn.mock.calls[0][1].body)).toEqual({ params: { getTransaction: { transactionId: "tx_3" } } });
  });

  it("throws on terminal failed status", async () => {
    mockFetchOnce(200, { success: true, data: { transactionId: "tx_4", hash: null, status: "failed" }, error: null });
    await expect(waitForConfirmation("tx_4", FETCH_URL, { intervalMs: 1, maxAttempts: 2 })).rejects.toMatchObject({
      code: "ONCHAIN_FAILED",
    });
  });
});

describe("extractFuncAndAuth", () => {
  it("pulls base64 HostFunction + auth entries from an invoke tx", () => {
    const source = new Account("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7", "1");
    const op = Operation.invokeContractFunction({
      contract: "CD5FK6CQ7QIZ5ONARG36Y53ERI5PIBGELSJUTD7OXYLK6EQAS4N3TFBV",
      function: "update_message",
      args: [nativeToScVal("hi", { type: "string" }), Address.fromString(source.accountId()).toScVal()],
    });
    const tx = new TransactionBuilder(source, { fee: "100", networkPassphrase: Networks.TESTNET })
      .addOperation(op)
      .setTimeout(0)
      .build();
    const { func, auth } = extractFuncAndAuth(tx);
    expect(typeof func).toBe("string");
    expect(Buffer.from(func, "base64").length).toBeGreaterThan(0);
    expect(auth).toEqual([]); // no auth entries attached pre-simulation
  });
});
```

- [ ] **Step 5.3: Run tests, verify they fail**

Run: `cd packages/frontend && npx vitest run src/lib/relayerClient.test.ts`
Expected: FAIL — `Cannot find module './relayerClient'` (or equivalent resolve error) for every suite.

- [ ] **Step 5.4: Write `packages/frontend/src/lib/relayerClient.ts`**

```ts
import type { Transaction } from "@stellar/stellar-sdk";
import { RELAYER_URL } from "./network";

/** Statuses emitted by the Channels plugin. */
export type RelayerStatus = "pending" | "sent" | "submitted" | "confirmed" | "failed" | "expired";

export interface RelayerTxResponse {
  transactionId: string | null;
  hash: string | null;
  status: RelayerStatus | null;
}

export class RelayerError extends Error {
  override name = "RelayerError";
  constructor(
    message: string,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function relayerEnabled(): boolean {
  return RELAYER_URL.length > 0;
}

/** POST {params} to the Caddy /relay route (which forwards to the Channels
 *  plugin with the relayer API key injected server-side — the browser never
 *  holds a key). Handles both response nestings: the plugin README documents
 *  {success, data: {...}}, while the relayer v1.5.0 example README shows
 *  {success, data: {result: {...}}}. */
async function call(params: Record<string, unknown>, baseUrl: string): Promise<RelayerTxResponse> {
  const resp = await fetch(`${baseUrl}/relay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ params }),
  });
  let body: { success?: boolean; data?: unknown; error?: string | null };
  try {
    body = await resp.json();
  } catch {
    throw new RelayerError(`Relayer returned non-JSON (HTTP ${resp.status})`);
  }
  if (body.success === false || (!resp.ok && body.error)) {
    const data = body.data as { code?: string; details?: unknown } | undefined;
    throw new RelayerError(body.error ?? `Relayer HTTP ${resp.status}`, data?.code, data?.details);
  }
  if (!resp.ok) throw new RelayerError(`Relayer HTTP ${resp.status}`);
  const data = body.data as ({ result?: RelayerTxResponse } & RelayerTxResponse) | undefined;
  const payload = data?.result ?? data;
  if (!payload || typeof payload !== "object") throw new RelayerError("Relayer returned an empty payload");
  return payload as RelayerTxResponse;
}

/** Submit host function + pre-signed auth entries (both base64 XDR).
 *  skipWait defaults to true: we poll ourselves rather than holding the
 *  plugin's 30s execution window open. */
export async function submitSorobanTransaction(
  args: { func: string; auth: string[]; skipWait?: boolean },
  baseUrl: string = RELAYER_URL,
): Promise<RelayerTxResponse> {
  return call({ func: args.func, auth: args.auth, skipWait: args.skipWait ?? true }, baseUrl);
}

export async function getRelayerTransaction(
  transactionId: string,
  baseUrl: string = RELAYER_URL,
): Promise<RelayerTxResponse> {
  return call({ getTransaction: { transactionId } }, baseUrl);
}

export async function waitForConfirmation(
  transactionId: string,
  baseUrl: string = RELAYER_URL,
  opts?: { intervalMs?: number; maxAttempts?: number },
): Promise<RelayerTxResponse> {
  const interval = opts?.intervalMs ?? 1500;
  const maxAttempts = opts?.maxAttempts ?? 40;
  for (let i = 0; i < maxAttempts; i++) {
    const res = await getRelayerTransaction(transactionId, baseUrl);
    if (res.status === "confirmed") return res;
    if (res.status === "failed" || res.status === "expired") {
      throw new RelayerError(`Relayer transaction ${res.status}`, "ONCHAIN_FAILED", res);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new RelayerError("Timed out waiting for relayer confirmation", "WAIT_TIMEOUT");
}

/** Pull the base64 HostFunction + auth-entry XDRs off a built invoke tx —
 *  exactly the {func, auth} shape the Channels plugin consumes. */
export function extractFuncAndAuth(tx: Transaction): { func: string; auth: string[] } {
  const op = tx.toEnvelope().v1().tx().operations()[0].body().invokeHostFunctionOp();
  return {
    func: op.hostFunction().toXDR("base64"),
    auth: op.auth().map((a) => a.toXDR("base64")),
  };
}
```

- [ ] **Step 5.5: Run tests, verify they pass**

Run: `cd packages/frontend && npx vitest run src/lib/relayerClient.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5.6: Commit**

```bash
git add packages/frontend/src/lib/network.ts packages/frontend/src/lib/relayerClient.ts packages/frontend/src/lib/relayerClient.test.ts
git commit -m "feat(frontend): fetch-based Channels relayer client behind PUBLIC_RELAYER_URL (#72)"
```

---

### Task 6: Relayer branch in `signAndSubmit`

**Files:**
- Modify: `packages/frontend/src/lib/primaryPasskeySigner.ts` (two locations: source-account selection ~line 79-82; post-`injectPasskeySignature` submission ~line 165+)

- [ ] **Step 6.1: Add imports** at the top of `primaryPasskeySigner.ts`:

```ts
import { relayerEnabled, extractFuncAndAuth, submitSorobanTransaction, waitForConfirmation } from "./relayerClient";
import { RELAYER_SIM_SOURCE } from "./network";
```

- [ ] **Step 6.2: Branch the simulation source.** Replace (current lines ~79-82):

```ts
  const submitter = await getSubmitter();
  const sourceAccount = await server.getAccount(submitter.publicKey());
```

with:

```ts
  // Relayer mode: no ephemeral G is created or funded — recording-mode
  // simulation just needs SOME existing on-chain source account, so we use
  // the relayer's (public) fund address. It never signs and never pays here.
  // Classic mode: friendbot-funded ephemeral G as before.
  const submitter = relayerEnabled() ? null : await getSubmitter();
  const sourceAccount = submitter
    ? await server.getAccount(submitter.publicKey())
    : await server.getAccount(RELAYER_SIM_SOURCE);
```

- [ ] **Step 6.3: Branch submission after `injectPasskeySignature`.** Immediately after the `injectPasskeySignature(...)` call (currently ~line 154-163), insert — BEFORE the enforce-mode re-simulation block:

```ts
  if (relayerEnabled()) {
    // The Channels plugin re-simulates server-side in enforce mode, builds
    // the footprint itself, and a channel account becomes the tx source with
    // the fund account fee-bumping — our enforce re-sim + fee refit + G
    // signature + RPC submission are all its job now. We ship only the host
    // function and the passkey-signed auth entry.
    const { func, auth } = extractFuncAndAuth(assembled_tx);
    const submitted = await submitSorobanTransaction({ func, auth });
    if (!submitted.transactionId) {
      throw new Error("Relayer accepted the transaction but returned no transaction id");
    }
    const confirmed = await waitForConfirmation(submitted.transactionId);
    if (!confirmed.hash) throw new Error("Relayer confirmed without a transaction hash");
    return {
      status: "PENDING",
      hash: confirmed.hash,
      latestLedger: 0,
      latestLedgerCloseTime: 0,
    } as unknown as rpc.Api.SendTransactionResponse;
  }
```

The classic path below it is untouched, except `submitter` is now possibly-null — TypeScript will flag `refitted_tx.sign(submitter)`; since that line is only reachable when `relayerEnabled()` is false, change it to `refitted_tx.sign(submitter!);` (or guard with `if (!submitter) throw new Error("unreachable: classic path without submitter");`).

- [ ] **Step 6.4: Type-check + full frontend test suite**

Run: `cd packages/frontend && npx tsc --noEmit -p tsconfig.json 2>/dev/null || npx astro check; npx vitest run`
Expected: no NEW errors vs. main (astro check has a known 2-error baseline per project memory); all vitest suites pass.

- [ ] **Step 6.5: Commit**

```bash
git add packages/frontend/src/lib/primaryPasskeySigner.ts
git commit -m "feat(frontend): submit via OZ Relayer when PUBLIC_RELAYER_URL is set (#72)"
```

---

### Task 7: Testnet proof + wrap-up

**Files:**
- Create: `scripts/relayer-proof.mjs`
- Modify: `.github/workflows/deploy-relayer.yml` (drop the temporary branch trigger)

- [ ] **Step 7.1: Write `scripts/relayer-proof.mjs`** — *(as-built note: the snippet below simulates with the user as source, which records unsignable `sorobanCredentialsSourceAccount` credentials — the committed script uses a never-funded ghost sim source instead and asserts address credentials)* — automated, browser-free gas-abstraction proof: a fresh G-account *authorizes* a status-message write but pays **nothing**; the relayer's channel/fund accounts source and fee the transaction. (The passkey/smart-account variant of the same flow is exercised manually through the wallet UI — same `{func, auth}` shape, different signer.)

```js
#!/usr/bin/env node
// Proof of gas abstraction (Deliverable 4 / #72):
//   node scripts/relayer-proof.mjs https://nido-relayer.fly.dev
// Asserts: tx confirmed on testnet; envelope is a fee-bump whose fee source
// is NOT the user; the user's XLM balance is unchanged after the call.
import {
  Address, Horizon, Keypair, Networks, Operation, TransactionBuilder,
  authorizeEntry, nativeToScVal, rpc, xdr,
} from "@stellar/stellar-sdk";

const RELAYER = process.argv[2] ?? "https://nido-relayer.fly.dev";
const RPC_URL = "https://soroban-testnet.stellar.org";
const HORIZON = "https://horizon-testnet.stellar.org";
// DEPLOYED.md: status-message demo contract. NOTE: the originally-deployed
// contract's entry point is `udpate_message` (historic typo, fixed in the
// example copy) — if simulation fails with "function not found", flip NAME.
const CONTRACT = "CD5FK6CQ7QIZ5ONARG36Y53ERI5PIBGELSJUTD7OXYLK6EQAS4N3TFBV";
const NAME = "update_message";

const server = new rpc.Server(RPC_URL);
const horizon = new Horizon.Server(HORIZON);

// 1. Fresh "user": exists on-chain (friendbot) but will never spend a stroop.
const user = Keypair.random();
const fb = await fetch(`https://friendbot.stellar.org?addr=${user.publicKey()}`);
if (!fb.ok) throw new Error(`friendbot: ${fb.statusText}`);
const balanceOf = async (g) =>
  (await horizon.loadAccount(g)).balances.find((b) => b.asset_type === "native").balance;
const before = await balanceOf(user.publicKey());

// 2. Build + recording-simulate the contract call (user only authorizes).
const op = Operation.invokeContractFunction({
  contract: CONTRACT,
  function: NAME,
  args: [
    nativeToScVal(`gas-abstracted via OZ relayer ${Date.now()}`, { type: "string" }),
    Address.fromString(user.publicKey()).toScVal(),
  ],
});
const acct = await server.getAccount(user.publicKey());
const simTx = new TransactionBuilder(acct, { fee: "1000000", networkPassphrase: Networks.TESTNET })
  .addOperation(op).setTimeout(0).build();
const sim = await server.simulateTransaction(simTx);
if (rpc.Api.isSimulationError(sim)) throw new Error(`simulate: ${sim.error}`);

// 3. Sign ONLY the auth entry (ed25519 here; the wallet does the same with a passkey).
const entry = sim.result.auth[0];
const signedEntry = await authorizeEntry(entry, user, sim.latestLedger + 600, Networks.TESTNET);

// 4. Ship {func, auth} to the relayer.
const func = simTx.toEnvelope().v1().tx().operations()[0].body()
  .invokeHostFunctionOp().hostFunction().toXDR("base64");
const resp = await fetch(`${RELAYER}/relay`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ params: { func, auth: [signedEntry.toXDR("base64")], skipWait: false } }),
});
const body = await resp.json();
const data = body.data?.result ?? body.data;
if (body.success === false) throw new Error(`relayer: ${body.error} (${data?.code})`);
if (data.status !== "confirmed" || !data.hash) throw new Error(`unexpected: ${JSON.stringify(data)}`);

// 5. Assertions.
const tx = await server.getTransaction(data.hash);
if (tx.status !== "SUCCESS") throw new Error(`on-chain status: ${tx.status}`);
const envelope = tx.envelopeXdr;
const isFeeBump = envelope.switch() === xdr.EnvelopeType.envelopeTypeTxFeeBump();
const feeSource = isFeeBump
  ? Address.fromXDR(envelope.feeBump().tx().feeSource().toXDR(), "raw") // muxed account -> address
  : null;
const after = await balanceOf(user.publicKey());
console.log(JSON.stringify({
  hash: data.hash,
  explorer: `https://stellar.expert/explorer/testnet/tx/${data.hash}`,
  isFeeBump,
  userBalanceBefore: before,
  userBalanceAfter: after,
  userPaidNothing: before === after,
}, null, 2));
if (!isFeeBump) throw new Error("expected a fee-bump envelope (fund account paying)");
if (before !== after) throw new Error("user balance changed — fees were NOT abstracted");
console.log("PROOF OK: user authorized the call; relayer sourced and paid for it.");
```

(If `Address.fromXDR(...feeSource...)` fights the muxed-account type, replace the `feeSource` extraction with `xdr` text inspection: `envelope.feeBump().tx().feeSource()` → `Address.account(...)`; the load-bearing assertions are `isFeeBump` + balance-unchanged, keep those exact.)

- [ ] **Step 7.2: Run the proof**

Run: `node scripts/relayer-proof.mjs https://nido-relayer.fly.dev`
Expected: JSON output with `userPaidNothing: true` and final line `PROOF OK: ...`. Paste the JSON (with explorer link) into PR #73's description under "Proof of completion".

- [ ] **Step 7.3: Manual wallet proof (passkey path).** Build the frontend with the relayer enabled and exercise a real send:

```bash
cd packages/frontend
PUBLIC_RELAYER_URL=https://nido-relayer.fly.dev \
PUBLIC_RELAYER_SIM_SOURCE=<fund G-address from Task 4> \
npx astro dev
```
Send XLM from a passkey smart account; confirm in devtools that no friendbot call happens, the only outbound submission is `POST /relay`, and record the tx hash. Add hash + screenshot to the PR description.

- [ ] **Step 7.4: Pre-merge CI cleanup** — in `deploy-relayer.yml` drop the temporary branch entry AND the self-path `paths` entry (`branches: [main]`, `paths: ['infra/relayer/**']`); delete `.github/workflows/relayer-secrets-check.yml` and `.github/workflows/bootstrap-relayer.yml` (one-off wiring/bootstrap tools, subsumed).

- [ ] **Step 7.5: Full verification + commit**

Run: `just test && cd packages/frontend && npx vitest run && npx astro build`
Expected: all green (astro check 2-error baseline excepted).

```bash
git add scripts/relayer-proof.mjs .github/workflows/deploy-relayer.yml
git commit -m "feat(relayer): testnet gas-abstraction proof script (#72)"
```

- [ ] **Step 7.6:** Update PR #73: tick the checklist in the description, add proof artifacts, mark ready for review (`gh pr ready 73`) — only after Willem has reviewed the diff.

---

## Self-review notes

- Spec coverage: infra (Task 1-2), deploy workflow + 1Password (Task 3), wallet submission path + flag + fallback (Task 5-6), expiration margin (kept at existing +10000; plugin minimum is 2 — documented in Task 6 comment and runbook), proof (Task 7), preview paths filter (Task 3.2). The spec's "ChannelsClient npm client" was replaced by a fetch client after research showed the npm package is CJS/Node-only; the spec's "browser-visible API key accepted" risk was eliminated by the Caddy key-injection design (relayer also has no CORS, making a proxy hop mandatory anyway).
- Known deliberate deviations from the official example: one shared `KEYSTORE_PASSPHRASE` (vs per-account env names) — the config schema references env names per signer, so this is valid; plugin wrapper dir named `channels/` with config path `channels/index.ts` (the example's dir is `channel/`).
- Risk register: `apk add caddy` fallback documented (Task 1.6); `data` vs `data.result` nesting handled in client; status-message function-name typo handled in proof script; plugin `engines.node` mismatch neutralized via `.npmrc`.
