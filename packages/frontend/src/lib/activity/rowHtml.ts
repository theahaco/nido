import type { ActivityItem } from "./types.js";

/**
 * Render one ActivityItem as a Nido `.row` anchor (an HTML string for
 * `innerHTML`). Shared by the home "Recent activity" card and the full
 * `/account/activity` page so the row markup lives in exactly one place.
 *
 * All interpolated fields come from on-chain data with no HTML-significant
 * characters (hex tx hash, base32 strkey, formatted number, asset code) or from
 * a fixed title table — so they are safe to inject without escaping.
 */
export function activityRowHtml(it: ActivityItem): string {
  const icon = it.kind === "payment" ? (it.direction === "in" ? "↓" : "↑") : "•";
  const iconCls = it.kind === "payment" && it.direction === "in" ? "in" : "acc";
  const when = new Date(it.timestamp * 1000).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  const sign = it.kind === "payment" ? (it.direction === "in" ? "+" : "−") : "";
  const amt = it.amount ? `<span class="ramt">${sign}${it.amount} <small>${it.asset}</small></span>` : "";
  return `<a class="row" href="${it.explorerUrl}" target="_blank" rel="noopener noreferrer">
      <span class="ricon ${iconCls}">${icon}</span>
      <span class="rmain"><span class="rtitle">${it.title}</span><span class="rsub">${it.subtitle ?? when}</span></span>${amt}</a>`;
}
