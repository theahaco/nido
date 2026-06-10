// Bare account-location links. An account lives at the root of its own
// subdomain — `alice.nido.fyi` — and that root redirects to `/account/`
// (src/pages/index.astro). So a shareable / navigational link to an account is
// the bare subdomain, with no `/account/` suffix.
import { accountUrl } from "@g2c/passkey-sdk";
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
