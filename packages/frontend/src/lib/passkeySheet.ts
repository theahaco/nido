/**
 * Passkey "confirming…" sheet controller.
 *
 * CRITICAL: This deliberately does NOT replicate the prototype's
 * `setTimeout(onDone)` fake scanner (`app/ui.jsx` `PasskeySheet`). The prototype
 * faked a biometric scan on a timer; here the sheet's lifecycle is driven by a
 * REAL promise the caller passes in — typically the actual
 * `navigator.credentials.get()` / `navigator.credentials.create()` ceremony.
 *
 * The sheet opens when you call `withPasskeySheet`, stays in its "confirming"
 * state while the OS passkey dialog is up, then closes when the promise
 * settles. We keep only the visual frame (`.scrim` / `.sheet` / `.faceid`).
 *
 * Markup is provided by `PasskeySheet.astro` (a single instance per page).
 */

const SCRIM_ID = "nido-passkey-scrim";
const FACEID_ID = "nido-passkey-faceid";
const TITLE_ID = "nido-passkey-title";
const SUB_ID = "nido-passkey-sub";

// Tracks the element focused before the sheet opened so we can restore it.
let _previousFocus: HTMLElement | null = null;

export interface PasskeySheetCopy {
  /** Heading shown while confirming (default "Confirm it's you"). */
  title?: string;
  /** Sub text shown while confirming (default uses the detected label). */
  sub?: string;
}

interface Els {
  scrim: HTMLElement;
  sheet: HTMLElement | null;
  faceid: HTMLElement | null;
  title: HTMLElement | null;
  sub: HTMLElement | null;
}

function els(): Els | null {
  if (typeof document === "undefined") return null;
  const scrim = document.getElementById(SCRIM_ID);
  if (!scrim) return null;
  return {
    scrim,
    sheet: scrim.querySelector('[role="dialog"]'),
    faceid: document.getElementById(FACEID_ID),
    title: document.getElementById(TITLE_ID),
    sub: document.getElementById(SUB_ID),
  };
}

/** Open the sheet in its confirming state. No-op if the host isn't mounted. */
export function openPasskeySheet(copy: PasskeySheetCopy = {}): void {
  const e = els();
  if (!e) return;
  if (copy.title && e.title) e.title.textContent = copy.title;
  if (copy.sub && e.sub) e.sub.textContent = copy.sub;
  // Confirming (not done): the scan affordance is visible via CSS.
  e.faceid?.classList.remove("done");
  // Capture the currently focused element so we can restore it on close.
  _previousFocus = document.activeElement as HTMLElement | null;
  // Remove inert before showing so the dialog contents are accessible.
  e.sheet?.removeAttribute("inert");
  e.scrim.classList.add("show");
  e.scrim.style.pointerEvents = "auto";
  // Move focus into the dialog. The sheet itself has tabindex="-1" so it is
  // always focusable even when there are no interactive children (the OS
  // handles the passkey UI, so there are no buttons to focus).
  (e.sheet as HTMLElement | null)?.focus();
}

/** Close the sheet. No-op if the host isn't mounted. */
export function closePasskeySheet(): void {
  const e = els();
  if (!e) return;
  e.scrim.classList.remove("show");
  e.scrim.style.pointerEvents = "none";
  // Re-apply inert so the hidden dialog is removed from the accessibility tree.
  e.sheet?.setAttribute("inert", "");
  // Restore focus to the element that was active before the sheet opened.
  _previousFocus?.focus();
  _previousFocus = null;
}

/**
 * Run a real passkey ceremony with the confirming sheet open.
 *
 * Opens the sheet, awaits the caller's promise (the genuine
 * `navigator.credentials.*` call), and always closes the sheet afterward —
 * resolving with the promise's value or re-throwing its error.
 *
 * @example
 *   const cred = await withPasskeySheet(
 *     () => navigator.credentials.get({ publicKey }),
 *     { title: "Confirm it's you", sub: "Confirm with Face ID." },
 *   );
 */
export async function withPasskeySheet<T>(
  ceremony: () => Promise<T>,
  copy: PasskeySheetCopy = {},
): Promise<T> {
  openPasskeySheet(copy);
  try {
    return await ceremony();
  } finally {
    closePasskeySheet();
  }
}
