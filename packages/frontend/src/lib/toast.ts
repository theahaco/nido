/**
 * Toast helper — drives the `<Toast />` host rendered by `Toast.astro`.
 *
 * Ported from the Nido prototype's `toast()` / `ToastHost` (`app/ui.jsx`), but
 * as framework-free vanilla TS. Intended to replace ad-hoc "Copied!" text swaps
 * scattered through the existing pages.
 *
 * Usage (after `<Toast />` is in the layout):
 *   import { toast } from "../lib/toast";
 *   toast("Copied address");
 *   toast({ msg: "Sent", icon: "check" });
 */

export interface ToastOptions {
  /** Message text. */
  msg: string;
  /** Optional icon name (matches the `Icon` component's `paths` map). */
  icon?: string;
  /** How long the toast stays visible, in ms (default 2200). */
  duration?: number;
}

const HOST_ID = "nido-toast-host";
const MSG_ID = "nido-toast-msg";
const ICON_ID = "nido-toast-icon";

let hideTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Show a transient toast. No-op outside the browser (e.g. SSR).
 *
 * @param input  message string, or `{ msg, icon, duration }`
 */
export function toast(input: string | ToastOptions): void {
  if (typeof document === "undefined") return;

  const opts: ToastOptions =
    typeof input === "string" ? { msg: input } : input;
  const { msg, icon, duration = 2200 } = opts;

  const host = document.getElementById(HOST_ID);
  const msgEl = document.getElementById(MSG_ID);
  if (!host || !msgEl) {
    // Host not mounted (layout didn't include <Toast />). Fail quietly.
    return;
  }

  msgEl.textContent = msg;

  // Toggle the icon glyph if the host provides an icon slot. The Icon component
  // renders an <svg>; we only flip visibility here, the markup is pre-rendered
  // per icon name and matched by data-icon attribute.
  const iconHost = document.getElementById(ICON_ID);
  if (iconHost) {
    const glyphs = iconHost.querySelectorAll<HTMLElement>("[data-icon]");
    let shown = false;
    glyphs.forEach((g) => {
      const match = !!icon && g.dataset.icon === icon;
      g.hidden = !match;
      shown = shown || match;
    });
    iconHost.hidden = !shown;
  }

  host.classList.add("show");
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    host.classList.remove("show");
  }, duration);
}

/** Immediately hide the toast (e.g. on navigation). No-op outside the browser. */
export function hideToast(): void {
  if (typeof document === "undefined") return;
  const host = document.getElementById(HOST_ID);
  host?.classList.remove("show");
  if (hideTimer) clearTimeout(hideTimer);
}
