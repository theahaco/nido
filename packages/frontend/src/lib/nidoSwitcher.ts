// Runtime for the "My Nido" switcher popover. Extracted from MyNidoMenu.astro so
// multiple triggers (landing pill, account topbar chip, desktop sidebar chip)
// share one implementation. Each `.mynido` root is mounted independently; every
// query is scoped to the root (no global IDs).
import {
  loadAccounts,
  loadPendingAccounts,
  loadAccountName,
  activateAccount,
} from "@g2c/passkey-sdk";
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

// Minimal inline Nest mark (matches Nest.astro: dashed coral + honey rings, teal dot).
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

  // Promote any pending account that has since deployed, then re-render if needed.
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
