import { describe, it, expect } from "vitest";
import { checkPasskeySupport } from "./passkeySupport.js";

describe("checkPasskeySupport", () => {
  it("flags an insecure context (http://moss) as unsupported with an https hint", () => {
    // The exact field state Safari presents over plain http on a non-loopback
    // host: navigator.credentials / PublicKeyCredential are stripped.
    const r = checkPasskeySupport({
      isSecureContext: false,
      hasPublicKeyCredential: false,
      hasCredentials: false,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("insecure-context");
    expect(r.message).toMatch(/secure connection|https/i);
  });

  it("flags a secure context that lacks WebAuthn as unsupported (not insecure)", () => {
    const r = checkPasskeySupport({
      isSecureContext: true,
      hasPublicKeyCredential: false,
      hasCredentials: false,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("unsupported");
  });

  it("passes when secure and WebAuthn is present", () => {
    const r = checkPasskeySupport({
      isSecureContext: true,
      hasPublicKeyCredential: true,
      hasCredentials: true,
    });
    expect(r.ok).toBe(true);
    expect(r.message).toBeUndefined();
  });
});
