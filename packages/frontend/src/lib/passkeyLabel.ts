/**
 * Platform passkey detection.
 *
 * WebAuthn never reveals the exact biometric in use, so we infer a likely
 * label/icon from the platform UA and refine it with
 * `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`.
 * Copy stays generic ("your passkey") wherever the platform is unknown or no
 * platform authenticator is available.
 *
 * Ported from the Nido prototype (`app/ui.jsx` `detectPasskey`). Real and
 * reusable: no fake timers, no UI — just a label/icon hint for copy.
 */

export type PasskeyMethod =
  | "faceid"
  | "touch"
  | "fingerprint"
  | "hello"
  | "passkey";

/** Icon name (matches the `Icon` component's `paths` map) to pair with a label. */
export type PasskeyIcon = "faceid" | "fingerprint" | "eye" | "key";

export interface PasskeyLabel {
  /** Coarse platform method bucket. */
  method: PasskeyMethod;
  /** Human label for copy, e.g. "Face ID", "your fingerprint", "your passkey". */
  label: string;
  /** Icon name to render beside the label. */
  icon: PasskeyIcon;
}

/**
 * Best-effort synchronous guess from the User-Agent string alone.
 *
 * Safe on the server / before hydration: falls back to the generic passkey
 * label when `navigator` is unavailable.
 */
export function detectPasskeyLabel(): PasskeyLabel {
  const ua =
    typeof navigator !== "undefined" ? navigator.userAgent || "" : "";

  if (/iPhone|iPad|iPod/.test(ua))
    return { method: "faceid", label: "Face ID", icon: "faceid" };
  if (/Macintosh|Mac OS X/.test(ua) && !/Mobile/.test(ua))
    return { method: "touch", label: "Touch ID", icon: "fingerprint" };
  if (/Android/.test(ua))
    return { method: "fingerprint", label: "your fingerprint", icon: "fingerprint" };
  if (/Windows/.test(ua))
    return { method: "hello", label: "Windows Hello", icon: "eye" };

  return { method: "passkey", label: "your passkey", icon: "key" };
}

const GENERIC: PasskeyLabel = {
  method: "passkey",
  label: "your passkey",
  icon: "key",
};

/**
 * Refined detection: the UA guess, downgraded to the generic passkey label when
 * no platform (user-verifying) authenticator is actually available.
 *
 * Browser-only (uses `PublicKeyCredential`). Resolves to the generic label if
 * the check is unsupported or throws.
 */
export async function detectPasskeyLabelAsync(): Promise<PasskeyLabel> {
  const guess = detectPasskeyLabel();
  try {
    const pkc = (globalThis as { PublicKeyCredential?: typeof PublicKeyCredential })
      .PublicKeyCredential;
    if (pkc?.isUserVerifyingPlatformAuthenticatorAvailable) {
      const available = await pkc.isUserVerifyingPlatformAuthenticatorAvailable();
      if (!available) return GENERIC;
    }
  } catch {
    /* fall through to the UA guess */
  }
  return guess;
}
