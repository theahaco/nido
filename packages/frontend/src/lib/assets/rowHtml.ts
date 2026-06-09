import { shortAddr } from "../address.js";
import type { AssetHolding } from "./types.js";

/** HTML-escape a value for safe interpolation into an innerHTML string. */
function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/**
 * Render one AssetHolding as a Nido `.row` anchor (an HTML string for
 * `innerHTML`). Every interpolated field is `esc()`-escaped — asset codes and
 * domains come from third-party lists and on-chain events, so they are
 * attacker-influenced strings.
 */
export function assetRowHtml(a: AssetHolding): string {
  const initial = (a.code[0] ?? "?").toUpperCase();
  const sub = a.domain ?? (a.issuer ? shortAddr(a.issuer, 4, 4) : shortAddr(a.contractId, 4, 4));
  return `<a class="row asset-row" href="${esc(a.explorerUrl)}" target="_blank" rel="noopener noreferrer" title="${esc(a.contractId)}">
      <span class="ricon asset-initial">${esc(initial)}</span>
      <span class="rmain"><span class="rtitle">${esc(a.code)}</span><span class="rsub">${esc(sub)}</span></span>
      <span class="ramt">${esc(a.formatted)}</span></a>`;
}
