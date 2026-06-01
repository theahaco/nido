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

export interface PasskeySheetCopy {
  /** Heading shown while confirming (default "Confirm it's you"). */
  title?: string;
  /** Sub text shown while confirming (default uses the detected label). */
  sub?: string;
}

interface Els {
  scrim: HTMLElement;
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
  e.scrim.classList.add("show");
  e.scrim.style.pointerEvents = "auto";
}

/** Close the sheet. No-op if the host isn't mounted. */
export function closePasskeySheet(): void {
  const e = els();
  if (!e) return;
  e.scrim.classList.remove("show");
  e.scrim.style.pointerEvents = "none";
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
