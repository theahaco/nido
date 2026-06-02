# Nido Desktop / Responsive Layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Nido frontend a real responsive system — full-bleed landing, a desktop sidebar+grid app shell, focused centered flows — plus the two Nido logo swaps, replacing PR #38's "every page clamped to a 448px phone column."

**Architecture:** Add a `shell` prop (`app` | `focused` | `bleed`) to `NidoLayout.astro` that swaps only the wrapper around `<slot/>`; page bodies and their auth `<script>` blocks stay byte-identical. Responsive behavior lives in `nido.css` (breakpoints 800/1024) plus a new `Sidebar.astro`. Pages opt into a shell and (for `app` pages) wrap their existing cards in a grid.

**Tech Stack:** Astro 5, vanilla CSS (`nido.css` design tokens), Vitest, Playwright (visual checks).

**Spec:** [`docs/superpowers/specs/2026-06-01-nido-desktop-responsive-design.md`](../specs/2026-06-01-nido-desktop-responsive-design.md)

**Verification model (read first):** This is presentational. There is no meaningful unit-test surface, so "tests" per task = **(a) regression green** — `npx vitest run` unchanged, `npx astro check` introduces **no new** errors (baseline = 2 pre-existing: `recoveryActions.ts:213`, `account/index.astro:414`), `npx astro build` builds all 9 pages — **plus (b) a Playwright screenshot** at the relevant width(s), eyeballed against the spec. All commands run from `packages/frontend/`.

**Setup (once, before Task 1):** This worktree has no deps yet.
```bash
cd <worktree-root> && npm install          # workspaces install
cd packages/frontend && npx vitest run      # baseline: 23 passed
npx astro check                             # baseline: 2 errors, 3 hints
npx astro build                             # baseline: 9 pages built
```
Record those three baselines; every task compares against them.

---

## File Structure

| File | Responsibility | New/Mod |
|---|---|---|
| `src/layouts/NidoLayout.astro` | `shell` prop; render `app`/`focused`/`bleed` wrapper | Modify |
| `src/components/Sidebar.astro` | Desktop left rail: Nido mark, nav, account chip | **New** |
| `src/styles/nido.css` | sidebar + card-grid + 800/1024 breakpoints; `app`/`bleed` rules; `.span-all` | Modify |
| `src/pages/index.astro` | `shell="bleed"` | Modify |
| `src/pages/new-account/index.astro`, `sign/index.astro`, `connect/index.astro` | `shell="focused"` | Modify |
| `src/pages/account/index.astro` | `shell="app"`; `.card-grid` wrap; Developer `<details>`; mark/chip placement | Modify |
| `src/pages/security/index.astro`, `security/recover/index.astro`, `security/delegate/index.astro` | `shell="app"`; `.card-grid` wrap | Modify |
| `src/pages/status-message/index.astro` | `shell="app"`; `.card-grid` wrap | Modify |
| `../stellar-wallets-kit-module/src/module.ts` (+ `dist/`) | Nest-Ring `productIcon` | Modify |

---

## Task 1: `shell` prop + wrapper modes on NidoLayout

**Files:**
- Modify: `src/layouts/NidoLayout.astro`
- Modify: `src/styles/nido.css`

- [ ] **Step 1: Add the prop.** In the frontmatter of `NidoLayout.astro`, replace the Props interface:

```astro
interface Props {
  title: string;
  /** Layout shell. `app` = sidebar+grid on desktop (default); `focused` =
   *  centered card; `bleed` = full-bleed (landing). */
  shell?: "app" | "focused" | "bleed";
}

const { title, shell = "app" } = Astro.props;
```

- [ ] **Step 2: Make the body wrapper conditional.** Replace the `<body>…</body>` block's stage contents. Keep `#preview-banner` and `#webview-warning` exactly as-is; only the wrapper around `<slot/>` changes:

```astro
  <body>
    <a id="preview-banner" style="display:none" target="_blank" rel="noopener"></a>
    <div class="stage" data-shell={shell}>
      <div id="webview-warning" style="display:none"></div>
      {shell === "bleed" && <slot />}
      {shell === "focused" && (
        <div class="appwrap">
          <div class="col"><slot /></div>
        </div>
      )}
      {shell === "app" && (
        <div class="appwrap appwrap-app">
          <Sidebar />
          <div class="col col-app"><slot /></div>
        </div>
      )}
    </div>
  </body>
```

> Note: the `#webview-warning` inner copy is now set by the existing `<script>` (from PR #39), so the element is intentionally empty here — do not re-add the old `<p>` markup.

- [ ] **Step 3: Import Sidebar.** Add to the frontmatter imports:

```astro
import Sidebar from "../components/Sidebar.astro";
```

(Task 2 creates `Sidebar.astro`; this import will fail to build until then — that's expected, Task 2 immediately follows.)

- [ ] **Step 4: Add base shell CSS.** Append to `src/styles/nido.css` (after the existing `.col` / `@media (min-width: 800px)` block around line 101):

```css
/* ---------- responsive shells (desktop redesign) ---------- */
/* `focused` keeps the existing .col phone-card. `app` widens + adds a sidebar.
   `bleed` renders the slot straight into .stage (landing escapes the column). */

/* 800–1024: app pages widen to a centered ~820px column, no sidebar yet. */
@media (min-width: 800px) {
  .appwrap-app { align-items: flex-start; }
  .col-app { max-width: 820px; }
  .appwrap-app > .nido-sidebar { display: none; }
}

/* ≥1024: real desktop — sidebar + content rail, centered as a unit. */
@media (min-width: 1024px) {
  .appwrap-app {
    max-width: 1200px;
    margin-inline: auto;
    gap: 24px;
    padding: 28px 24px 36px;
    align-items: stretch;
  }
  .appwrap-app > .nido-sidebar { display: flex; }
  .col-app {
    max-width: none;
    flex: 1;
    min-height: min(860px, calc(100vh - 64px));
    max-height: calc(100vh - 64px);
    background: var(--paper-2);
    border: 1px solid var(--line);
    border-radius: 28px;
    box-shadow: var(--sh-3);
    overflow: hidden;
  }
}
```

- [ ] **Step 5: Verify (build will fail on missing Sidebar — that's the gate to Task 2).**

Run: `npx astro check 2>&1 | tail -3`
Expected: an error about `Sidebar` not found (resolved in Task 2). No *other* new errors.

- [ ] **Step 6: Commit.**

```bash
git add src/layouts/NidoLayout.astro src/styles/nido.css
git commit -m "feat(frontend): add shell prop (app/focused/bleed) + responsive shell CSS to NidoLayout"
```

---

## Task 2: Sidebar component

**Files:**
- Create: `src/components/Sidebar.astro`

- [ ] **Step 1: Create the component.** It reuses existing `Logo`/`Nest`/`Avatar`/`Icon` components. Active nav state is derived from the current path.

```astro
---
// Nido desktop sidebar (≥1024px). Brand mark + wordmark (top), section nav,
// account chip (bottom). Hidden below 1024 via CSS (see nido.css .nido-sidebar).
import Logo from "./Logo.astro";
import Avatar from "./Avatar.astro";
import Icon from "./Icon.astro";

const path = Astro.url.pathname;
const isActive = (href: string) =>
  href === "/" ? path === "/" : path.startsWith(href);

const NAV = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/security/", label: "Security", icon: "shield" },
] as const;
---

<aside class="nido-sidebar">
  <a class="nido-sidebar-brand" href="/" aria-label="Nido home">
    <Logo size={20} mark markSize={28} />
  </a>

  <nav class="nido-sidebar-nav">
    {NAV.map((item) => (
      <a
        class:list={["nido-navitem", { "is-active": isActive(item.href) }]}
        href={item.href}
        aria-current={isActive(item.href) ? "page" : undefined}
      >
        <Icon name={item.icon} size={18} />
        <span>{item.label}</span>
      </a>
    ))}
  </nav>

  <a class="nido-sidebar-account" href="/account/" aria-label="Your account">
    <Avatar seed="nido" size={32} class="js-avatar" />
    <span class="nido-account-name js-account-nickname">Your Nido</span>
  </a>
</aside>
```

> If `Icon.astro` has no `home`/`shield` glyph, add them to its glyph map (check `src/components/Icon.astro` first; reuse the closest existing names if so — do NOT invent a new icon system).

- [ ] **Step 2: Add sidebar CSS.** Append to `src/styles/nido.css`:

```css
.nido-sidebar {
  display: none; /* shown ≥1024 via .appwrap-app media query */
  flex-direction: column;
  width: 240px;
  flex: 0 0 240px;
  padding: 8px 4px;
  gap: 6px;
}
.nido-sidebar-brand { display: flex; padding: 10px 12px 18px; text-decoration: none; }
.nido-sidebar-nav { display: flex; flex-direction: column; gap: 4px; }
.nido-navitem {
  display: flex; align-items: center; gap: 12px;
  padding: 11px 14px; border-radius: 13px;
  color: var(--ink-soft); font-weight: 700; font-size: 15px;
  text-decoration: none;
}
.nido-navitem:hover { background: var(--chip); color: var(--ink); }
.nido-navitem.is-active { background: var(--acc-soft); color: var(--acc); }
.nido-sidebar-account {
  margin-top: auto;
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: 14px;
  text-decoration: none; color: var(--ink);
}
.nido-sidebar-account:hover { background: var(--chip); }
.nido-account-name { font-weight: 700; font-size: 14px; }
```

- [ ] **Step 3: Verify build is clean again.**

Run: `npx astro check 2>&1 | tail -3`
Expected: back to baseline — **2 errors, 3 hints**, no new errors.

Run: `npx astro build 2>&1 | tail -3`
Expected: 9 pages built.

- [ ] **Step 4: Commit.**

```bash
git add src/components/Sidebar.astro src/styles/nido.css
git commit -m "feat(frontend): add Nido desktop Sidebar (brand mark, nav, account chip)"
```

---

## Task 3: Landing un-clamp (`bleed`) — the "renders desktop to mobile" fix

**Files:**
- Modify: `src/pages/index.astro`

- [ ] **Step 1: Opt the landing into `bleed`.** In `src/pages/index.astro`, change the layout open tag:

```astro
<NidoLayout title="Nido — A safe place for everything" shell="bleed">
```

- [ ] **Step 2: Drop the column-scroll wrapper.** The landing markup wraps content in `<div class="col-scroll"><div class="lp">…`. In `bleed` there is no `.col`, so `.col-scroll` (a `flex:1; overflow-y:auto` element) can create a nested scroll. Remove the `<div class="col-scroll">` open tag and its matching close, leaving `<div class="lp">…</div>` as the direct child of the slot. (Verify the close tag you remove is the one paired with that open — it's the outermost wrapper inside `<NidoLayout>`.)

- [ ] **Step 3: Verify visually at desktop width.** Build, preview, screenshot.

```bash
npx astro build && (npx astro preview --host 0.0.0.0 --port 4330 &) && sleep 3
```
Then Playwright: navigate to `http://localhost:4330/`, resize to **1440×900**, screenshot.
Expected: the landing renders **full width** — `.lp-hero` is a 2-column grid (copy left, preview card right), `.lp-steps`/`.lp-feat` are 3-up — NOT a centered 448px phone column.
Also screenshot at **375×812**: single-column, unchanged from before.
Kill preview: `pkill -f "astro preview"`.

- [ ] **Step 4: Regression.**

Run: `npx astro check 2>&1 | tail -3` → 2 errors (baseline).

- [ ] **Step 5: Commit.**

```bash
git add src/pages/index.astro
git commit -m "fix(frontend): render landing full-bleed (shell=bleed) so its desktop layout un-clamps"
```

---

## Task 4: Card-grid CSS + wire the `app` pages

**Files:**
- Modify: `src/styles/nido.css`
- Modify: `src/pages/account/index.astro`, `security/index.astro`, `security/recover/index.astro`, `security/delegate/index.astro`, `status-message/index.astro`

- [ ] **Step 1: Add grid CSS.** Append to `src/styles/nido.css`:

```css
/* Card grid: app-page content reflows multi-column on wider viewports. The
   content stays a single stacked column until 800px (mobile unchanged). */
.card-grid { display: flex; flex-direction: column; gap: 14px; }
@media (min-width: 800px) {
  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 16px;
    align-content: start;
  }
  .card-grid > .span-all { grid-column: 1 / -1; }
}
/* On the app shell the content scrolls inside the rounded card at ≥1024. */
@media (min-width: 1024px) {
  .col-app > .col-scroll { padding: 22px; }
}
```

- [ ] **Step 2: Set `shell="app"` on each app page.** These are already the default, but set it explicitly for clarity. In each of the 5 files, ensure the layout tag reads `shell="app"`:
  - `account/index.astro`: `<NidoLayout title="Your Nido" shell="app">`
  - `security/index.astro`: `<NidoLayout title="Security" shell="app">`
  - `security/recover/index.astro` and `security/delegate/index.astro`: add `shell="app"` to their `<NidoLayout …>` tags
  - `status-message/index.astro`: `<NidoLayout title="Status Message" shell="app">`

- [ ] **Step 3: Wrap each app page's cards in `.card-grid`.** In each of the 5 pages, the page body is a series of stacked cards/sections inside `<div class="col-scroll">`. Wrap that run of cards in `<div class="card-grid"> … </div>` (immediately inside `col-scroll`, after any top bar/title). Leave the top bar/title and any single hero element outside the grid, or give the hero `class="… span-all"`. Read each file and apply the wrap around the section blocks (the `section-label` + `card` groups).

  For `security/index.astro` the two sections (Recovery, Delegation) + the passkey card go in the grid; the `<h1 class="disp">` title stays above it.

- [ ] **Step 4: Verify visually.** Build + preview (port 4330 as Task 3). Playwright screenshot **`/security/`** at **1440×900** and **1024×768**: cards in a 2–3 col grid inside the rounded card pane, sidebar on the left with "Security" active. At **375×812**: single stacked column, unchanged.

- [ ] **Step 5: Regression.** `npx astro check` → baseline 2 errors; `npx astro build` → 9 pages.

- [ ] **Step 6: Commit.**

```bash
git add src/styles/nido.css src/pages/account/index.astro src/pages/security src/pages/status-message/index.astro
git commit -m "feat(frontend): card-grid reflow + sidebar shell for account/security/status pages"
```

---

## Task 5: Focused flows stay centered

**Files:**
- Modify: `src/pages/new-account/index.astro`, `src/pages/sign/index.astro`, `src/pages/connect/index.astro`

- [ ] **Step 1: Opt into `focused`.** Add `shell="focused"` to the `<NidoLayout …>` tag in each:
  - `new-account/index.astro`: `<NidoLayout title="Nido — Set up your account" shell="focused">`
  - `sign/index.astro`: `<NidoLayout title="Sign request" shell="focused">`
  - `connect/index.astro`: `<NidoLayout title="Connect to dApp" shell="focused">`

- [ ] **Step 2: Verify visually.** Preview + Playwright screenshot **`/new-account/?key=test`** at **1440×900**: a single centered phone-card on the stage, **no sidebar**, no full-width stretch. At **375×812**: unchanged phone column.

- [ ] **Step 3: Regression.** `npx astro check` → baseline; `npx astro build` → 9 pages.

- [ ] **Step 4: Commit.**

```bash
git add src/pages/new-account/index.astro src/pages/sign/index.astro src/pages/connect/index.astro
git commit -m "feat(frontend): keep onboarding/sign/connect as focused centered cards"
```

---

## Task 6: Account page — top-left mark, chip placement, Developer card, hero span

**Files:**
- Modify: `src/pages/account/index.astro`

- [ ] **Step 1: Top-left mark + chip to the right (mobile/middle tier).** In the `.topbar` (around line 31), the left slot is currently `<Avatar seed="nido" size={36} class="js-avatar" />` with the nickname. Replace the left Avatar with the Nido mark and move the account avatar + nickname to the right side of the bar:

```astro
<div class="topbar">
  <a href="/" class="topbar-mark" aria-label="Nido home"><Nest size={30} /></a>
  <a href="/account/" class="topbar-account">
    <span id="account-nickname" style="font-weight:800; font-size:14.5px; white-space:nowrap;">Your Nido</span>
    <Avatar seed="nido" size={32} class="js-avatar" />
  </a>
</div>
```

Add `import Nest from "../../components/Nest.astro";` to the frontmatter if not present. Add CSS to `nido.css`:

```css
.topbar-mark { display: inline-flex; text-decoration: none; }
.topbar-account { display: inline-flex; align-items: center; gap: 9px; text-decoration: none; color: var(--ink); }
/* On the desktop sidebar shell the brand mark lives in the sidebar, so hide the
   in-bar mark ≥1024 (the account chip stays, top-right). */
@media (min-width: 1024px) { .col-app .topbar-mark { display: none; } }
```

- [ ] **Step 2: Wrap the cards in `.card-grid` + span the hero.** Inside `col-scroll`, after the `.topbar`, wrap the stack of cards in `<div class="card-grid"> … </div>`. Give the primary card (the first big balance/address card) `class="card span-all"`.

- [ ] **Step 3: Fold dev actions into a Developer card.** The two developer sections (*Invoke a contract* / *Sign a hash*, near lines 223–235) become one collapsed `<details>` at the END of the grid:

```astro
<details class="card dev-card span-all">
  <summary style="cursor:pointer; font-weight:700; font-size:14px;">Developer</summary>
  <!-- move the existing "Invoke a contract" and "Sign a hash" blocks here, verbatim -->
</details>
```

Move the two existing dev blocks (markup + their button IDs `register-btn`, `sign-btn`, inputs) inside the `<details>` **unchanged** so the existing `<script>` handlers still bind. Add CSS:

```css
.dev-card > summary { list-style: none; }
.dev-card[open] > summary { margin-bottom: 12px; }
```

- [ ] **Step 4: Verify visually.** Preview + Playwright **`/account/`** at **1440×900**: sidebar (Home active) + card grid; the balance/address card spans full width; "Developer" is a collapsed disclosure at the bottom; the account chip is top-right, the brand mark is in the sidebar (not duplicated in the bar). At **375×812**: phone column with the **Nest mark top-left** and the account chip top-right. Expand "Developer" and confirm the contract/sign actions still work (button handlers bound).

- [ ] **Step 5: Regression.** `npx vitest run` → 23 passed; `npx astro check` → baseline 2 errors; `npx astro build` → 9 pages.

- [ ] **Step 6: Commit.**

```bash
git add src/pages/account/index.astro src/styles/nido.css
git commit -m "feat(frontend): account — Nido mark top-left, account chip right, Developer disclosure, grid hero span"
```

---

## Task 7: Wallet-kit logo (#3) — Nest-Ring `productIcon`

**Files:**
- Modify: `../stellar-wallets-kit-module/src/module.ts`
- Modify: `../stellar-wallets-kit-module/dist/module.js` (via rebuild)

- [ ] **Step 1: Define the Nest-Ring SVG.** The mark on a cream tile. Save this exact SVG to a scratch file `/tmp/nido-mark.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect width="120" height="120" rx="26" fill="#FFF8F0"/><circle cx="60" cy="60" r="34" fill="none" stroke="#F25C2A" stroke-width="6" stroke-dasharray="14 9" stroke-linecap="round"/><circle cx="60" cy="60" r="23" fill="none" stroke="#F5A623" stroke-width="6" stroke-dasharray="11 8" stroke-linecap="round"/><circle cx="60" cy="60" r="9" fill="#0E9AA8"/></svg>
```

- [ ] **Step 2: Base64-encode it and read the data URI.**

```bash
echo "data:image/svg+xml;base64,$(base64 -w0 /tmp/nido-mark.svg)"
```
Copy the full `data:image/svg+xml;base64,…` string.

- [ ] **Step 3: Replace `G2C_ICON`.** In `../stellar-wallets-kit-module/src/module.ts` (around line 53) replace the `G2C_ICON` value with the new data URI from Step 2. Leave `productName` and everything else unchanged (the wallet is still named `g2c`).

- [ ] **Step 4: Rebuild dist.**

```bash
cd ../stellar-wallets-kit-module && npm run build && cd ../frontend
```
(Check the package's `build` script first; if none, run `npx tsc` per its tsconfig. The committed `dist/module.js` must contain the new `G2C_ICON`.)

- [ ] **Step 5: Verify.** Confirm the new data URI is present in both src and dist:

```bash
grep -c "FFF8F0" ../stellar-wallets-kit-module/src/module.ts ../stellar-wallets-kit-module/dist/module.js
```
Expected: `1` in each (the cream tile fill is a unique marker for the new icon). Optionally render the data URI in a browser to eyeball the mark.

- [ ] **Step 6: Commit.**

```bash
git add ../stellar-wallets-kit-module/src/module.ts ../stellar-wallets-kit-module/dist
git commit -m "feat(wallet-kit): replace standin productIcon with the Nido Nest-Ring mark"
```

---

## Task 8: Final cross-screen visual verification + regression sweep

**Files:** none (verification only)

- [ ] **Step 1: Full regression.** From `packages/frontend/`:

```bash
npx vitest run        # expect 23 passed
npx astro check       # expect 2 errors, 3 hints (baseline) — NO new
npx astro build       # expect 9 pages built
```

- [ ] **Step 2: Screenshot matrix.** Preview (`npx astro preview --host 0.0.0.0 --port 4330`), then Playwright-screenshot each at **1440 / 1024 / 375**:
  - `/` (landing) — wide marketing at 1440/1024; single col at 375.
  - `/account/` — sidebar+grid (1440), widened 2-up (1024), phone+mark-left (375).
  - `/security/` — same shell, "Security" nav active.
  - `/new-account/?key=test` — centered card, no sidebar, all widths.

  Eyeball each against the spec §5–§8. Note any overflow, clipped cards, or sidebar/nav glitches; fix in the owning task's file and re-screenshot.

- [ ] **Step 3: Commit any fixes** (if Step 2 surfaced tweaks), else nothing to do.

- [ ] **Step 4: Push + open PR into `feat/nido-rebrand`.**

```bash
git push -u origin feat/nido-desktop-responsive
gh pr create --base feat/nido-rebrand --head feat/nido-desktop-responsive \
  --title "Nido desktop/responsive layout: sidebar+grid app shell, full-bleed landing, logo swaps" \
  --body-file <(printf '%s\n' "Implements docs/superpowers/specs/2026-06-01-nido-desktop-responsive-design.md. Sidebar+grid app shell (≥1024), widened column (800–1024), unchanged phone column (<800); full-bleed landing; focused centered flows; Nido mark top-left; Nest-Ring wallet-kit icon. Verified: vitest 23/23, astro check no new errors, astro build 9 pages, Playwright at 1440/1024/375.")
```

---

## Self-Review (completed by plan author)

**Spec coverage:** §3 shell modes → Task 1; §4 breakpoints → Tasks 1+4 CSS; §5 desktop sidebar+grid → Tasks 2+4+6; §6 mobile/middle + mark-left → Tasks 4+6; §7 focused → Task 5; §8 landing bleed → Task 3; §9 logo #3 → Task 7, logo #4 → Task 6 (mobile) + Task 2 (sidebar header); §10 chip placement → Task 6; §11–§12 file inventory → covered; §13 verification → Tasks 3–8. No gaps.

**Placeholders:** none — every code/CSS block is concrete; page-edit steps name exact files + anchors and instruct reading the file (existing-codebase wraps, not invented code).

**Type/name consistency:** `shell` prop values (`app`/`focused`/`bleed`) and class names (`.appwrap-app`, `.col-app`, `.nido-sidebar`, `.card-grid`, `.span-all`, `.topbar-mark`, `.topbar-account`, `.dev-card`) are used identically across Tasks 1, 2, 4, 6. `Sidebar` import (Task 1) matches the file created in Task 2.
