import { describe, it, expect } from 'vitest';
import { p256 } from '@noble/curves/nist.js';
import { computeAuthDigest } from './auth.js';
import { buildSyntheticAssertion } from './syntheticAssertion.js';
import {
  encodeRotationHandoff,
  decodeRotationHandoff,
  encodeFriendSignature,
  decodeFriendSignature,
  type RotationHandoff,
} from './friendSigning.js';

const VERIFIER = 'CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S';
const ACCOUNT = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH';

function sampleHandoff(): RotationHandoff {
  return {
    version: 1,
    account: ACCOUNT,
    recoveryRuleId: 4,
    description: 'Recovery rotation: add a new passkey',
    // base64 XDR of the assembled, unsigned rotation transaction envelope.
    txXdr: Buffer.from('not-a-real-envelope').toString('base64'),
    friends: [
      'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB',
      'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC',
    ],
    parentSignatureExpirationLedger: 1234567,
  };
}

describe('rotation handoff encoding', () => {
  it('round-trips through a URL-safe string', () => {
    const h = sampleHandoff();
    const encoded = encodeRotationHandoff(h);
    expect(typeof encoded).toBe('string');
    expect(encoded).not.toMatch(/[+/=]/); // URL-safe
    const decoded = decodeRotationHandoff(encoded);
    expect(decoded).toEqual(h);
  });

  it('rejects a handoff with the wrong version', () => {
    const badJson = JSON.stringify({ ...sampleHandoff(), version: 99 });
    const encoded = Buffer.from(badJson)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(() => decodeRotationHandoff(encoded)).toThrow(/version/i);
  });

  it('rejects garbage input', () => {
    expect(() => decodeRotationHandoff('!!!not base64!!!')).toThrow();
  });

  it('rejects a handoff missing the canonical parent expiration ledger', () => {
    const { parentSignatureExpirationLedger, ...rest } = sampleHandoff();
    void parentSignatureExpirationLedger;
    const badJson = JSON.stringify(rest);
    const encoded = Buffer.from(badJson)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(() => decodeRotationHandoff(encoded)).toThrow(/malformed/i);
  });

  it('round-trips the canonical parent expiration ledger', () => {
    const h = sampleHandoff();
    const decoded = decodeRotationHandoff(encodeRotationHandoff(h));
    expect(decoded.parentSignatureExpirationLedger).toBe(
      h.parentSignatureExpirationLedger,
    );
  });
});

describe('friend signature encoding', () => {
  it('round-trips a friend signature blob', async () => {
    const priv = p256.utils.randomSecretKey();
    const pub = p256.getPublicKey(priv, false); // 65-byte uncompressed
    // Friend signs their OWN auth digest.
    const friendPayload = new Uint8Array(32).fill(0x42);
    const friendDigest = computeAuthDigest(friendPayload, [0]);
    const assertion = await buildSyntheticAssertion(priv, new Uint8Array(friendDigest));

    const blob = encodeFriendSignature({
      friendAccount: ACCOUNT,
      verifierAddress: VERIFIER,
      publicKey: pub,
      authenticatorData: assertion.authenticatorData,
      clientDataJson: assertion.clientDataJSON,
      signature: assertion.signature,
      nonce: '12345',
      signatureExpirationLedger: 99999,
    });
    expect(typeof blob).toBe('string');
    const decoded = decodeFriendSignature(blob);
    expect(decoded.friendAccount).toBe(ACCOUNT);
    expect(decoded.verifierAddress).toBe(VERIFIER);
    expect(decoded.nonce).toBe('12345');
    expect(decoded.signatureExpirationLedger).toBe(99999);
    expect(Array.from(decoded.publicKey)).toEqual(Array.from(pub));
    expect(Array.from(decoded.signature)).toEqual(Array.from(assertion.signature));
  });

  it('produces a signature the P-256 verifier accepts over the friend digest', async () => {
    // This mirrors what the on-chain WebAuthn verifier checks: the signature
    // is over sha256(authenticatorData || sha256(clientDataJSON)).
    const priv = p256.utils.randomSecretKey();
    const pub = p256.getPublicKey(priv, false);
    const friendPayload = new Uint8Array(32).fill(0x7e);
    const friendDigest = new Uint8Array(computeAuthDigest(friendPayload, [0]));
    const assertion = await buildSyntheticAssertion(priv, friendDigest);

    const cdHash = new Uint8Array(
      await crypto.subtle.digest('SHA-256', assertion.clientDataJSON),
    );
    const msg = new Uint8Array(assertion.authenticatorData.length + cdHash.length);
    msg.set(assertion.authenticatorData, 0);
    msg.set(cdHash, assertion.authenticatorData.length);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', msg));

    expect(p256.verify(assertion.signature, digest, pub, { prehash: false })).toBe(true);
  });
});
