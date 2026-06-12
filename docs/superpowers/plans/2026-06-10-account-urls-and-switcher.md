# Account URLs + Nido Switcher + Home-link fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a shareable account URL the bare subdomain (`alice.nido.fyi`, no `/account/`), fix the "home" link to return to the apex from a subdomain, and turn the account-identity chip (mobile topbar + desktop sidebar) into a "My Nido" switcher.

**Architecture:** Centralize bare-link construction in one tested helper (`lib/accountLinks.ts`). Extract the switcher's runtime out of `MyNidoMenu.astro`'s inline script into `lib/nidoSwitcher.ts` (`mountNidoSwitcher(root)`), scoped per-root by data-attributes so multiple triggers coexist on a page. `MyNidoMenu.astro` becomes a thin wrapper with a `trigger` slot + `placement` prop; the account topbar and the shared `Sidebar` render it with the existing chip as the trigger.

**Tech Stack:** Astro (static), TypeScript, vitest, `@nidohq/passkey-sdk` (`accountUrl`, `stripSubdomain`), `@stellar/stellar-sdk`.

Spec: `docs/superpowers/specs/2026-06-10-account-urls-and-switcher-design.md`

---

## File map

| File | Change | Responsibility |
| --- | --- | --- |
| `src/lib/accountLinks.ts` | **Create** | Pure bare-URL helpers: `accountShareUrl`, `accountShareLabel`, `nidoRowHref` |
| `src/lib/accountLinks.test.ts` | **Create** | Unit tests for the above |
| `src/lib/nidoSwitcher.ts` | **Create** | `mountNidoSwitcher(root, opts)` — render/wire one switcher panel |
| `src/components/MyNidoMenu.astro` | **Rewrite** | Shell (root + panel + `trigger` slot + `placement`) + mount all instances |
| `src/pages/index.astro` | **Modify** | `<MyNidoMenu />` → `<MyNidoMenu primary />` |
| `src/pages/account/index.astro` | **Modify** | Bare share/claim links; topbar chip → switcher trigger |
| `src/components/Sidebar.astro` | **Modify** | Brand → apex on subdomain; account chip → switcher trigger (`placement="up"`) |
| `src/styles/nido.css` | **Modify** | Button resets for `.topbar-account` / `.nido-sidebar-account`; sidebar wrapper `margin-top:auto` |

---

## Task 0: Pre-flight baseline

**Files:** none (record baselines)

- [ ] **Step 1: Record the `astro check` baseline**

Run: `cd packages/frontend && npx astro check 2>&1 | tail -5`
Note the error/warning count. (Per project memory there may be a small pre-existing baseline — record it so Task 7 can confirm "no regression" rather than "zero".)

- [ ] **Step 2: Confirm the test baseline**

Run: `cd packages/frontend && npm test 2>&1 | tail -5`
Expected: `Test Files 15 passed`, `Tests 87 passed`.

---

## Task 1: Bare-link helpers (pure, TDD)

**Files:**
- Create: `packages/frontend/src/lib/accountLinks.ts`
- Test: `packages/frontend/src/lib/accountLinks.test.ts`

Background: `accountUrl(host, nameOrId, path = "/")` (in `@nidohq/passkey-sdk`, `packages/passkey-sdk/src/url.ts`) returns a protocol-relative `//<id>.<apex><path>` and lowercases the id/name. It already defaults `path` to `/`, so a bare account URL is just `accountUrl(host, nameOrId, "/")`.

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/src/lib/accountLinks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { accountShareUrl, accountShareLabel, nidoRowHref } from "./accountLinks.js";
import type { MyNidoRow } from "./myNidoModel.js";

describe("accountShareUrl", () => {
  it("builds a bare subdomain URL with no /account/ suffix", () => {
    expect(accountShareUrl("nido.fyi", "alice")).toBe("//alice.nido.fyi/");
  });
  it("lowercases a contract-id subdomain and has no /account/ suffix", () => {
    const url = accountShareUrl("nido.fyi", "CABC");
    expect(url).toBe("//cabc.nido.fyi/");
    expect(url).not.toContain("/account/");
  });
});

describe("accountShareLabel", () => {
  it("strips the scheme and trailing slash", () => {
    expect(accountShareLabel("nido.fyi", "alice")).toBe("alice.nido.fyi");
  });
  it("never contains an /account/ suffix", () => {
    expect(accountShareLabel("nido.fyi", "alice")).not.toContain("/account");
  });
});

describe("nidoRowHref", () => {
  it("active row with a name → bare account URL", () => {
    const row: MyNidoRow = { contractId: "CABCDEF", name: "alice", status: "active" };
    expect(nidoRowHref("nido.fyi", row)).toBe("//alice.nido.fyi/");
  });
  it("active row without a name → bare contract subdomain", () => {
    const row: MyNidoRow = { contractId: "CABCDEF", name: null, status: "active" };
    expect(nidoRowHref("nido.fyi", row)).toBe("//cabcdef.nido.fyi/");
  });
  it("pending row → resume setup at /new-account/, no /account/ suffix", () => {
    const row: MyNidoRow = { contractId: "CABCDEF", name: null, status: "pending", resumeKey: "S123" };
    const href = nidoRowHref("nido.fyi", row);
    expect(href).toContain("/new-account/?key=S123");
    expect(href).not.toContain("/account/");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/frontend && npx vitest run src/lib/accountLinks.test.ts`
Expected: FAIL — `Failed to resolve import "./accountLinks.js"` / module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/frontend/src/lib/accountLinks.ts`:

```ts
// Bare account-location links. An account lives at the root of its own
// subdomain — `alice.nido.fyi` — and that root redirects to `/account/`
// (src/pages/index.astro). So a shareable / navigational link to an account is
// the bare subdomain, with no `/account/` suffix.
import { accountUrl } from "@nidohq/passkey-sdk";
import type { MyNidoRow } from "./myNidoModel";

/** Protocol-relative bare account URL, e.g. `//alice.nido.fyi/`. */
export function accountShareUrl(host: string, nameOrId: string): string {
  return accountUrl(host, nameOrId, "/");
}

/** Display label for a share link, e.g. `alice.nido.fyi` (no scheme, no trailing slash). */
export function accountShareLabel(host: string, nameOrId: string): string {
  return accountShareUrl(host, nameOrId).replace(/^\/\//, "").replace(/\/+$/, "");
}

/** Href for a My Nido switcher row: active rows → bare account URL; pending rows
 *  → resume the setup flow at `/new-account/`. */
export function nidoRowHref(host: string, row: MyNidoRow): string {
  if (row.status === "pending") {
    return accountUrl(host, row.contractId, `/new-account/?key=${row.resumeKey}`);
  }
  return accountShareUrl(host, row.name ?? row.contractId);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/frontend && npx vitest run src/lib/accountLinks.test.ts`
Expected: PASS (3 suites, 7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/accountLinks.ts packages/frontend/src/lib/accountLinks.test.ts
git commit -m "feat(frontend): add bare account-link helpers (no /account suffix)"
```

---

## Task 2: Account page uses bare share + claim links

**Files:**
- Modify: `packages/frontend/src/pages/account/index.astro` (imports; share link ~`:962-966`; claim redirect ~`:1196`)

- [ ] **Step 1: Add the import**

In the script's import block (it already imports `accountUrl`, `stripSubdomain`, … from `@nidohq/passkey-sdk`), add below the SDK import:

```ts
  import { accountShareUrl, accountShareLabel } from "../../lib/accountLinks";
```

(Keep the existing `accountUrl` import — it is still used by the signing-mode redirect.)

- [ ] **Step 2: Make the "Share link" row bare**

Replace (share-link block, currently ~lines 962-966):

```ts
      const rootHost = stripSubdomain(window.location.host);
      const nameLink = document.getElementById("name-url") as HTMLAnchorElement;
      const nameHref = accountUrl(rootHost, existingName, "/account/");
      nameLink.textContent = nameHref.replace(/^\/\//, "");
      nameLink.href = nameHref;
```

with:

```ts
      const rootHost = stripSubdomain(window.location.host);
      const nameLink = document.getElementById("name-url") as HTMLAnchorElement;
      nameLink.href = accountShareUrl(rootHost, existingName);
      nameLink.textContent = accountShareLabel(rootHost, existingName);
```

- [ ] **Step 3: Make the post-name-claim redirect bare**

Replace (claim redirect, currently ~line 1196):

```ts
              const nameUrl = accountUrl(rootHost, pendingName, "/account/");
```

with:

```ts
              const nameUrl = accountShareUrl(rootHost, pendingName);
```

(Leave the surrounding `rootHost` / `setTimeout(... window.location.href = protocol + nameUrl ...)` unchanged. Leave the signing-mode redirect that uses `accountUrl(rootHost, resolved, window.location.pathname + window.location.search)` UNCHANGED — it must keep `?sign=&callback=`.)

- [ ] **Step 4: Typecheck**

Run: `cd packages/frontend && npx astro check 2>&1 | tail -5`
Expected: no new errors vs the Task 0 baseline.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/pages/account/index.astro
git commit -m "feat(frontend): bare account URL for the share link and name-claim redirect"
```

---

## Task 3: Sidebar brand returns to the apex home

**Files:**
- Modify: `packages/frontend/src/components/Sidebar.astro` (brand anchor + new script)

Background: the mobile topbar Nest mark (`#home-link`) is already rewritten to `//<apex>/` in `account/index.astro`. The desktop sidebar brand still points at `/`, which on a subdomain redirects back to `/account/` (the loop).

- [ ] **Step 1: Give the brand anchor an id**

Replace:

```astro
  <a class="nido-sidebar-brand" href="/" aria-label="Nido home">
    <Logo size={20} mark markSize={28} />
  </a>
```

with:

```astro
  <a id="sidebar-home-link" class="nido-sidebar-brand" href="/" aria-label="Nido home">
    <Logo size={20} mark markSize={28} />
  </a>
```

- [ ] **Step 2: Add the apex-rewrite script**

Append to the end of `Sidebar.astro`:

```astro
<script>
  import { stripSubdomain } from "@nidohq/passkey-sdk";
  // On an account subdomain, "/" redirects back to /account/, so the brand would
  // loop. Point it at the apex home instead (mirrors the mobile #home-link fix).
  const brand = document.getElementById("sidebar-home-link") as HTMLAnchorElement | null;
  if (brand) brand.href = `//${stripSubdomain(window.location.host)}/`;
</script>
```

- [ ] **Step 3: Typecheck + build**

Run: `cd packages/frontend && npx astro check 2>&1 | tail -5 && npm run build 2>&1 | tail -5`
Expected: no new check errors; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/Sidebar.astro
git commit -m "fix(frontend): sidebar brand returns to apex home from a subdomain"
```

---

## Task 4: Extract the switcher runtime + make MyNidoMenu a multi-instance wrapper

**Files:**
- Create: `packages/frontend/src/lib/nidoSwitcher.ts`
- Rewrite: `packages/frontend/src/components/MyNidoMenu.astro`
- Modify: `packages/frontend/src/pages/index.astro` (`<MyNidoMenu primary />`)

This must keep the **landing** behavior byte-identical (default pill, opens on `nido:open-menu`).

- [ ] **Step 1: Create `lib/nidoSwitcher.ts`**

This is the current `MyNidoMenu.astro` script, refactored: scoped to `root`/`panel` (no global IDs), runtime element ids → classes, row hrefs via `nidoRowHref`, `nido:open-menu` gated on `opts.primary`, and `verifyPending` run once per page.

```ts
// Runtime for the "My Nido" switcher popover. Extracted from MyNidoMenu.astro so
// multiple triggers (landing pill, account topbar chip, desktop sidebar chip)
// share one implementation. Each `.mynido` root is mounted independently; every
// query is scoped to the root (no global IDs).
import {
  loadAccounts,
  loadPendingAccounts,
  loadAccountName,
  activateAccount,
} from "@nidohq/passkey-sdk";
import { rpc, xdr } from "@stellar/stellar-sdk";
import { buildMyNidoModel, type MyNidoRow } from "./myNidoModel";
import { nidoRowHref } from "./accountLinks";
import { fetchXlmBalance } from "./balance";
import { avatarBackground } from "./avatarStyle";
import { shortAddr } from "./address";
import { formatXlm } from "./money";
import { createNido } from "./createNido";

const RPC_URL = "https://soroban-testnet.stellar.org";

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function rowHtml(row: MyNidoRow): string {
  const av = `<span class="mn-av" style="background:${avatarBackground(row.contractId)}"><span class="st"></span></span>`;
  const title = esc(row.name ?? "Your Nido");
  const href = esc(nidoRowHref(window.location.host, row));
  if (row.status === "pending") {
    return `<a class="mn-row mn-pending" role="menuitem" href="${href}">${av}
      <span class="mn-main"><span class="mn-name">${title}</span><span class="mn-meta">Finishing setup…</span></span>
      <span class="mn-chev">›</span></a>`;
  }
  return `<a class="mn-row" role="menuitem" href="${href}" data-balance-for="${row.contractId}">${av}
    <span class="mn-main"><span class="mn-name">${title}</span><span class="mn-meta">${esc(shortAddr(row.contractId, 6, 6))}</span></span>
    <span class="mn-bal"><span class="skeleton">&nbsp;</span></span>
    <span class="mn-chev">›</span></a>`;
}

function nestSvg(size: number): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="60" cy="60" r="46" fill="none" stroke="var(--coral)" stroke-width="7" stroke-dasharray="14 9" stroke-linecap="round"/>
    <circle cx="60" cy="60" r="31" fill="none" stroke="var(--honey)" stroke-width="7" stroke-dasharray="11 8" stroke-linecap="round"/>
    <circle cx="60" cy="60" r="11" fill="var(--teal)"/></svg>`;
}

// verifyPending hits the RPC; with several triggers on one page, run it once.
let verifiedPending = false;

export interface MountOptions {
  /** Only the primary instance (the landing pill) responds to `nido:open-menu`. */
  primary?: boolean;
}

export function mountNidoSwitcher(root: HTMLElement, opts: MountOptions = {}): void {
  const btn = root.querySelector<HTMLElement>("[data-mynido-trigger]");
  const panel = root.querySelector<HTMLElement>("[data-mynido-panel]");
  if (!btn || !panel) return;

  function render() {
    const accounts = loadAccounts();
    const pending = loadPendingAccounts();
    const model = buildMyNidoModel(accounts, pending, loadAccountName);

    if (model.state === "empty") {
      const pendingRows = model.rows.map(rowHtml).join("");
      panel!.innerHTML = `<div class="mn-create">
          <div style="display:grid;place-items:center;"><span class="mn-nest"></span></div>
          <div class="t">Create your Nido</div>
          <div class="s">A safe place for everything you own. Set up in seconds — just your face.</div>
          <button class="btn acc cbtn mn-create-btn" type="button">Set up with your face</button>
        </div>
        ${pendingRows ? `<div class="mn-div"></div><div class="mn-body">${pendingRows}</div>` : ""}
        <div class="mn-err" style="display:none"></div>`;
      (panel!.querySelector(".mn-nest") as HTMLElement).innerHTML = nestSvg(54);
      wireCreate();
      return;
    }

    const header =
      model.state === "single"
        ? `<div class="mn-head"><span class="lockchip">Only you</span><div class="hl">Welcome back</div><div class="hs">Your Nido is ready</div></div>`
        : `<div class="mn-head"><div class="hl">Your Nidos</div><div class="hs">${model.rows.length} on this device</div></div>`;

    panel!.innerHTML = `${header}
      <div class="mn-body">
        ${model.rows.map(rowHtml).join("")}
        <div class="mn-div"></div>
        <button class="mn-foot mn-create-btn" type="button"><span class="pl">+</span> Create another Nido</button>
      </div>
      <div class="mn-err" style="display:none"></div>`;
    wireCreate();
    loadBalances();
  }

  function wireCreate() {
    const cbtn = panel!.querySelector<HTMLButtonElement>(".mn-create-btn");
    if (!cbtn) return;
    cbtn.addEventListener("click", async () => {
      const errEl = panel!.querySelector<HTMLElement>(".mn-err")!;
      errEl.style.display = "none";
      cbtn.disabled = true;
      const label = cbtn.textContent ?? "";
      cbtn.textContent = "Reserving your Nido…";
      try {
        const url = await createNido(window.location.host);
        cbtn.textContent = "Taking you in…";
        window.location.href = url;
      } catch (err: any) {
        errEl.textContent = err?.message || String(err);
        errEl.style.display = "block";
        cbtn.disabled = false;
        cbtn.textContent = label;
      }
    });
  }

  async function loadBalances() {
    const rows = panel!.querySelectorAll<HTMLElement>("[data-balance-for]");
    rows.forEach(async (rowEl) => {
      const id = rowEl.dataset.balanceFor!;
      const balEl = rowEl.querySelector(".mn-bal")!;
      try {
        const raw = await fetchXlmBalance(id, RPC_URL);
        balEl.innerHTML = `${formatXlm(raw)} <small>XLM</small>`;
      } catch {
        balEl.innerHTML = `<small>—</small>`;
      }
    });
  }

  async function verifyPending() {
    const pending = loadPendingAccounts();
    if (pending.length === 0) return;
    const active = new Set(loadAccounts());
    let changed = false;
    const server = new rpc.Server(RPC_URL);
    for (const { contractId } of pending) {
      if (active.has(contractId)) continue;
      try {
        await server.getContractData(contractId, xdr.ScVal.scvLedgerKeyContractInstance());
        activateAccount(contractId);
        changed = true;
      } catch {
        /* not deployed yet */
      }
    }
    if (changed && root.classList.contains("mynido-open")) render();
  }

  function open() {
    render();
    root.classList.add("mynido-open");
    btn!.setAttribute("aria-expanded", "true");
    panel!.setAttribute("aria-hidden", "false");
  }
  function close() {
    root.classList.remove("mynido-open");
    btn!.setAttribute("aria-expanded", "false");
    panel!.setAttribute("aria-hidden", "true");
  }
  function toggle() {
    root.classList.contains("mynido-open") ? close() : open();
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggle();
  });
  document.addEventListener("click", (e) => {
    if (root.classList.contains("mynido-open") && !root.contains(e.target as Node)) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  // Hero / CTA-band buttons dispatch `nido:open-menu` on the landing page only;
  // the primary (landing) instance handles it. Defer to the next tick so the
  // originating click settles past the document "click outside closes" handler.
  if (opts.primary) {
    window.addEventListener("nido:open-menu", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
      setTimeout(open, 0);
    });
  }

  if (!verifiedPending) {
    verifiedPending = true;
    void verifyPending();
  }
}
```

- [ ] **Step 2: Rewrite `MyNidoMenu.astro`**

Replace the whole file with the shell + appended `up` placement styles + mount script. The `<style is:global>` block keeps every existing rule (lines 22-102 of the current file) and adds the `[data-placement="up"]` variant; the markup swaps global ids for data-attributes and adds a `trigger` slot:

```astro
---
// "My Nido" switcher: a trigger + an anchored popover listing this device's
// nidos (+ "Create another"). The trigger defaults to a "My Nido ▾" pill but can
// be overridden via the `trigger` slot (e.g. an account chip). All runtime wiring
// lives in lib/nidoSwitcher.ts; this component renders the shell and mounts every
// `.mynido` instance on the page.
interface Props {
  /** `down` (default) opens below-right; `up` opens above-left (sidebar). */
  placement?: "down" | "up";
  /** The instance that responds to the `nido:open-menu` event (landing buttons). */
  primary?: boolean;
}
const { placement = "down", primary = false } = Astro.props;
---

<div class="mynido" data-mynido data-placement={placement} data-mynido-primary={primary ? "" : undefined}>
  <slot name="trigger">
    <button class="mynido-btn" type="button" data-mynido-trigger aria-haspopup="true" aria-expanded="false">
      My Nido <span class="mynido-caret" aria-hidden="true">▾</span>
    </button>
  </slot>
  <div class="mynido-panel" data-mynido-panel role="menu" aria-hidden="true"></div>
</div>

<!-- is:global is required: the menu's header/rows/foot are injected at runtime via
     innerHTML, so Astro's scoped-style data-attribute never lands on them. All
     classes are uniquely prefixed (.mynido* / .mn-*), so global scope is safe. -->
<style is:global>
  .mynido { position: relative; }
  .mynido-btn {
    display: inline-flex; align-items: center; gap: 7px;
    background: var(--acc-btn); color: #fff; font-family: var(--body);
    font-weight: 800; font-size: 13.5px; padding: 9px 16px; border: none;
    border-radius: var(--r-pill); cursor: pointer; box-shadow: var(--sh-acc);
    transition: box-shadow .3s, transform .12s;
  }
  .mynido-btn:active { transform: scale(.97); }
  .mynido-open .mynido-btn { box-shadow: 0 8px 26px rgba(207,74,30,.45); }
  .mynido-caret { display: inline-flex; transition: transform .42s cubic-bezier(.2,.9,.25,1.12); }
  .mynido-open .mynido-caret { transform: rotate(180deg); }

  .mynido-panel {
    /* width caps to the viewport (minus a small gutter) so the right-anchored
       panel never clips off the left edge on the smallest phones (~320px). */
    position: absolute; top: calc(100% + 9px); right: 0; width: min(300px, calc(100vw - 32px)); z-index: 90;
    background: var(--paper-2); border: 1px solid var(--line); border-radius: 20px;
    box-shadow: 0 28px 70px rgba(42,26,18,.20), 0 6px 16px rgba(42,26,18,.08);
    overflow: hidden; transform-origin: top right; display: none;
  }
  .mynido-panel::before {
    content: ""; position: absolute; top: -7px; right: 34px; width: 13px; height: 13px;
    background: #FFF1E8; border-left: 1px solid var(--line); border-top: 1px solid var(--line);
    transform: rotate(45deg);
  }
  .mynido-open .mynido-panel { display: block; }

  /* placement: up (sidebar) — open above the trigger, aligned to its left edge. */
  .mynido[data-placement="up"] .mynido-panel {
    top: auto; bottom: calc(100% + 9px); right: auto; left: 0; transform-origin: bottom left;
  }
  .mynido[data-placement="up"] .mynido-panel::before {
    top: auto; bottom: -7px; right: auto; left: 24px;
    border-left: none; border-top: none;
    border-right: 1px solid var(--line); border-bottom: 1px solid var(--line);
  }

  /* header */
  .mn-head { background: linear-gradient(135deg, #FFF1E8, var(--acc-soft)); padding: 15px 16px 13px; border-bottom: 1px solid var(--line-soft); }
  .mn-head .hl { font-family: var(--disp); font-weight: 800; font-size: 15px; }
  .mn-head .hs { font-size: 11px; color: var(--ink-soft); margin-top: 2px; }
  .mn-head .lockchip { float: right; background: var(--good-soft); color: var(--good); font-size: 9.5px; font-weight: 800; padding: 4px 9px; border-radius: var(--r-pill); }

  /* rows */
  .mn-body { padding: 7px; }
  .mn-row { display: flex; align-items: center; gap: 11px; padding: 10px; border-radius: 13px; cursor: pointer; text-decoration: none; color: var(--ink); }
  .mn-row:hover { background: var(--paper-3); }
  .mn-av { width: 36px; height: 36px; border-radius: 50%; flex: 0 0 auto; box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.4); position: relative; }
  .mn-av .st { position: absolute; right: -1px; bottom: -1px; width: 11px; height: 11px; border-radius: 50%; background: var(--good); border: 2px solid var(--paper-2); }
  .mn-main { flex: 1; min-width: 0; }
  .mn-name { display: block; font-weight: 800; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mn-meta { display: block; font-size: 11px; color: var(--mut); font-family: var(--mono); }
  .mn-bal { text-align: right; font-weight: 800; font-size: 13px; white-space: nowrap; }
  .mn-bal small { color: var(--mut); font-weight: 700; font-size: 10px; }
  .mn-bal .skeleton { display: inline-block; width: 46px; height: 14px; vertical-align: middle; }
  .mn-chev { color: #c9b9a8; flex: 0 0 auto; }
  .mn-pending .mn-meta { color: var(--acc-ink); }

  .mn-div { height: 1px; background: var(--line-soft); margin: 5px 12px; }
  .mn-foot { display: flex; align-items: center; gap: 9px; padding: 11px 12px; cursor: pointer; color: var(--acc-ink); font-weight: 800; font-size: 12.5px; background: none; border: none; width: 100%; text-align: left; font-family: var(--body); }
  .mn-foot .pl { width: 24px; height: 24px; border-radius: 8px; background: var(--acc-soft); display: grid; place-items: center; }

  /* create-card (empty state) */
  .mn-create { padding: 20px 18px 18px; text-align: center; }
  .mn-create .t { font-family: var(--disp); font-weight: 800; font-size: 18px; margin-top: 12px; }
  .mn-create .s { font-size: 11.5px; color: var(--ink-soft); line-height: 1.45; margin: 7px 0 14px; }
  .mn-create .cbtn { width: 100%; }
  .mn-err { color: var(--danger); font-size: 12px; padding: 0 14px 12px; }

  /* motion — entrance only when motion is welcome */
  @media (prefers-reduced-motion: no-preference) {
    .mynido-open .mynido-panel { animation: mn-open .42s cubic-bezier(.2,.9,.25,1.12); }
    .mynido-open .mn-head,
    .mynido-open .mn-row,
    .mynido-open .mn-create,
    .mynido-open .mn-foot { animation: mn-rise .46s cubic-bezier(.2,.8,.25,1) both; }
    .mynido-open .mn-head { animation-delay: .06s; }
    .mynido-open .mn-row:nth-of-type(1) { animation-delay: .13s; }
    .mynido-open .mn-row:nth-of-type(2) { animation-delay: .20s; }
    .mynido-open .mn-row:nth-of-type(3) { animation-delay: .27s; }
    .mynido-open .mn-row:nth-of-type(n+4) { animation-delay: .30s; }
    .mynido-open .mn-foot { animation-delay: .35s; }
    .mn-av .st { animation: mn-pulse 2.4s ease-in-out infinite; }
  }
  @keyframes mn-open { from { opacity: 0; transform: scale(.94) translateY(-8px); } to { opacity: 1; transform: none; } }
  @keyframes mn-rise { from { opacity: 0; transform: translateY(10px) scale(.985); } to { opacity: 1; transform: none; } }
  @keyframes mn-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(14,154,168,.5); } 50% { box-shadow: 0 0 0 5px rgba(14,154,168,0); } }
</style>

<script>
  import { mountNidoSwitcher } from "../lib/nidoSwitcher";
  document.querySelectorAll<HTMLElement>("[data-mynido]").forEach((root) =>
    mountNidoSwitcher(root, { primary: root.hasAttribute("data-mynido-primary") }),
  );
</script>
```

- [ ] **Step 3: Mark the landing instance primary**

In `packages/frontend/src/pages/index.astro`, change:

```astro
        <MyNidoMenu />
```

to:

```astro
        <MyNidoMenu primary />
```

- [ ] **Step 4: Typecheck + build**

Run: `cd packages/frontend && npx astro check 2>&1 | tail -5 && npm run build 2>&1 | tail -5`
Expected: no new check errors; build succeeds.

- [ ] **Step 5: Manual smoke (landing unchanged)**

Run: `cd packages/frontend && npm run preview` (or `npm run dev`), open the landing page.
Verify: the "My Nido ▾" pill renders top-right; clicking it opens the panel; "Get started" (hero + band) opens it; Escape / click-outside closes it; switcher rows link to bare `//<name-or-id>.<apex>/` (inspect an `<a class="mn-row">` href — no `/account/`).

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/lib/nidoSwitcher.ts packages/frontend/src/components/MyNidoMenu.astro packages/frontend/src/pages/index.astro
git commit -m "refactor(frontend): extract nidoSwitcher runtime; MyNidoMenu mounts multiple instances"
```

---

## Task 5: Mobile topbar chip → switcher trigger

**Files:**
- Modify: `packages/frontend/src/pages/account/index.astro` (import + topbar markup ~`:33-39`)
- Modify: `packages/frontend/src/styles/nido.css` (`.topbar-account` button reset, line ~610)

- [ ] **Step 1: Import MyNidoMenu on the account page**

In the account page frontmatter (the `---` import block with the other component imports), add:

```astro
import MyNidoMenu from "../../components/MyNidoMenu.astro";
```

- [ ] **Step 2: Replace the topbar account chip with a switcher trigger**

Replace:

```astro
      <a href="/account/" class="topbar-account">
        <span id="account-nickname" style="font-weight:800; font-size:14.5px; white-space:nowrap;">Your Nido</span>
        <Avatar seed="nido" size={32} class="js-avatar" />
      </a>
```

with:

```astro
      <MyNidoMenu>
        <button slot="trigger" type="button" class="topbar-account" data-mynido-trigger aria-haspopup="true" aria-expanded="false" aria-label="Switch Nido">
          <span id="account-nickname" style="font-weight:800; font-size:14.5px; white-space:nowrap;">Your Nido</span>
          <Avatar seed="nido" size={32} class="js-avatar" />
          <span class="mynido-caret" aria-hidden="true">▾</span>
        </button>
      </MyNidoMenu>
```

- [ ] **Step 3: Make `.topbar-account` work as a button**

In `packages/frontend/src/styles/nido.css`, replace:

```css
.topbar-account { display: inline-flex; align-items: center; gap: 9px; text-decoration: none; color: var(--ink); }
```

with:

```css
.topbar-account { display: inline-flex; align-items: center; gap: 9px; text-decoration: none; color: var(--ink); background: none; border: none; padding: 0; cursor: pointer; font-family: var(--body); }
```

- [ ] **Step 4: Typecheck + build**

Run: `cd packages/frontend && npx astro check 2>&1 | tail -5 && npm run build 2>&1 | tail -5`
Expected: no new check errors; build succeeds.

- [ ] **Step 5: Manual smoke (mobile width)**

Run preview/dev, open `/account/` at a mobile width (<1024). Verify the top-right chip ("Your Nido" + avatar + caret) opens the switcher panel below it; rows navigate; "Create another" works; Escape/click-outside close.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/pages/account/index.astro packages/frontend/src/styles/nido.css
git commit -m "feat(frontend): account topbar chip opens the Nido switcher (mobile)"
```

---

## Task 6: Desktop sidebar chip → switcher trigger

**Files:**
- Modify: `packages/frontend/src/components/Sidebar.astro` (import + account chip markup)
- Modify: `packages/frontend/src/styles/nido.css` (`.nido-sidebar-account` button reset; `.nido-sidebar > .mynido` margin)

- [ ] **Step 1: Import MyNidoMenu in the Sidebar**

In `Sidebar.astro` frontmatter (which already imports `Logo`, `Avatar`, `Icon`), add:

```astro
import MyNidoMenu from "./MyNidoMenu.astro";
```

- [ ] **Step 2: Replace the sidebar account chip with a switcher trigger**

Replace:

```astro
  <a class="nido-sidebar-account" href="/account/" aria-label="Your account">
    <Avatar seed="nido" size={32} class="js-avatar" />
    <span class="nido-account-name">Your Nido</span>
  </a>
```

with:

```astro
  <MyNidoMenu placement="up">
    <button slot="trigger" type="button" class="nido-sidebar-account" data-mynido-trigger aria-haspopup="true" aria-expanded="false" aria-label="Switch Nido">
      <Avatar seed="nido" size={32} class="js-avatar" />
      <span class="nido-account-name js-account-name">Your Nido</span>
      <span class="mynido-caret" aria-hidden="true" style="margin-left:auto;">▾</span>
    </button>
  </MyNidoMenu>
```

(The added `js-account-name` class lets the account page's existing name-update loop set the sidebar name to the current nido. On Activity/Security it stays "Your Nido" — acceptable fallback.)

- [ ] **Step 3: Button reset + bottom anchoring in CSS**

In `packages/frontend/src/styles/nido.css`, replace:

```css
.nido-sidebar-account {
  margin-top: auto;
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: var(--r-md);
  text-decoration: none; color: var(--ink);
}
.nido-sidebar-account:hover { background: var(--chip); }
```

with:

```css
/* the .mynido wrapper is the flex child now, so it carries the bottom push */
.nido-sidebar > .mynido { margin-top: auto; }
.nido-sidebar-account {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 10px 12px; border-radius: var(--r-md);
  text-decoration: none; color: var(--ink); text-align: left;
  background: none; border: none; cursor: pointer; font-family: var(--body); font-size: 14px;
}
.nido-sidebar-account:hover { background: var(--chip); }
```

- [ ] **Step 4: Typecheck + build**

Run: `cd packages/frontend && npx astro check 2>&1 | tail -5 && npm run build 2>&1 | tail -5`
Expected: no new check errors; build succeeds.

- [ ] **Step 5: Manual smoke (desktop width)**

Run preview/dev, open `/account/` at desktop width (≥1024). Verify the sidebar account chip (bottom-left) shows a caret and opens the switcher panel **upward**, aligned to the chip's left edge; rows navigate; "Create another" works; Escape/click-outside close. Open `/account/activity/` and `/security/` and confirm the sidebar chip also opens the switcher there.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/components/Sidebar.astro packages/frontend/src/styles/nido.css
git commit -m "feat(frontend): sidebar account chip opens the Nido switcher (desktop)"
```

---

## Task 7: Full verification + finishing

**Files:** none (verification)

- [ ] **Step 1: Full test suite**

Run: `cd packages/frontend && npm test 2>&1 | tail -8`
Expected: `Test Files 16 passed`, `Tests 94 passed` (87 baseline + 7 new).

- [ ] **Step 2: Typecheck — no regression**

Run: `cd packages/frontend && npx astro check 2>&1 | tail -5`
Expected: error count ≤ the Task 0 baseline (no new errors).

- [ ] **Step 3: Production build**

Run: `cd packages/frontend && npm run build 2>&1 | tail -8`
Expected: build succeeds.

- [ ] **Step 4: Manual acceptance against the three goals**

Using preview/dev (and editing `/etc/hosts` or a wildcard preview host if needed to exercise subdomains, e.g. `alice.localhost` / `<contractid>.localhost`):
  - **Bare share link:** on `/account/` with a claimed name, the "Share link" row reads `alice.<apex>` (no `/account/`); its href is `//alice.<apex>/`. Visiting that bare URL lands on the account page.
  - **Home → apex:** on a subdomain, the desktop sidebar brand and the mobile Nest mark both navigate to the apex marketing home (not back to `/account/`). The sidebar "Home" nav still lands on the account overview.
  - **Switcher:** mobile topbar chip and desktop sidebar chip both open the same panel (your nidos + "Create another"); rows go to bare account URLs; create works.

- [ ] **Step 5: Finish the branch**

Use superpowers:finishing-a-development-branch to choose merge/PR. Suggested PR title: `feat(frontend): bare account URLs, Nido switcher on account pages, home-link fix`. Confirm the branch is rebased/current on `origin/main` before opening the PR.

---

## Notes / pitfalls

- **Don't touch** the signing-mode redirect (`accountUrl(rootHost, resolved, window.location.pathname + window.location.search)`) — it must keep `?sign=&callback=` for passkey RP binding.
- **Don't change** `index.astro`'s subdomain → `/account/` redirect — bare links resolve *to* it.
- **No global ids** in the switcher runtime: multiple `.mynido` instances coexist on the account page (mobile topbar + desktop sidebar). Everything is scoped to the root/panel; runtime-injected elements use classes (`.mn-create-btn`, `.mn-err`, `.mn-nest`), not ids.
- **Sidebar popover clipping (watch in Task 6 Step 5):** the `placement="up"` panel is `position:absolute` and overflows the 240px sidebar into the content area. If a container (`.appwrap-app` / `.nido-sidebar` / `.col-app`) has `overflow:hidden`/`auto`, the upward panel can be clipped. If so, fix by allowing overflow on the offending container (or raise the panel's stacking/escape it) — verify the panel is fully visible.
- **Local account-page testing needs a subdomain host:** `/account/` resolves its contract id from the hostname, so plain `localhost/account/` shows the "navigate to <contractId>.<domain>" state. Use a subdomain host (e.g. `cabc….localhost:4321` or a name like `alice.localhost:4321`, plus a matching localStorage account) to exercise the topbar/sidebar switchers and the bare-link/home behavior.
- **Out of scope:** the `status-message` example dApp account link; per-name social cards; changing the name-resolution/redirect strategy in `index.astro`.
