import { describe, it, expect } from 'vitest';
import { StrKey, xdr, scValToNative } from '@stellar/stellar-sdk';
import {
  buildAuthPayloadScVal,
  type SignerSignature,
} from './multiSigner.js';
import type { PasskeySignature } from './types.js';

const VERIFIER = StrKey.encodeContract(new Uint8Array(32).fill(0x56));
const FRIEND_A = StrKey.encodeContract(new Uint8Array(32).fill(0x01));
const FRIEND_B = StrKey.encodeContract(new Uint8Array(32).fill(0x02));

function fakePasskeySig(): PasskeySignature {
  return {
    authenticatorData: new Uint8Array(37).fill(0xaa),
    clientDataJson: new TextEncoder().encode('{"type":"webauthn.get"}'),
    signature: new Uint8Array(64).fill(0xbb),
  };
}

describe('buildAuthPayloadScVal', () => {
  it('builds an AuthPayload with one delegated friend signer', () => {
    const scv = buildAuthPayloadScVal({
      contextRuleIds: [7],
      signers: [{ kind: 'delegated', address: FRIEND_A }],
    });
    // Decode back into a JS object: { context_rule_ids, signers }
    const native = scValToNative(scv) as {
      context_rule_ids: number[];
      signers: Map<unknown, unknown> | Record<string, unknown>;
    };
    expect(native.context_rule_ids).toEqual([7]);
    // The map key is a Signer enum tuple ["Delegated", address].
    const entries =
      native.signers instanceof Map
        ? Array.from(native.signers.keys())
        : Object.keys(native.signers);
    expect(entries.length).toBe(1);
  });

  it('orders map keys with Symbol("context_rule_ids") before "signers"', () => {
    const scv = buildAuthPayloadScVal({
      contextRuleIds: [0],
      signers: [{ kind: 'delegated', address: FRIEND_A }],
    });
    const map = scv.map();
    expect(map).toBeTruthy();
    const keys = map!.map((e) => e.key().sym().toString());
    expect(keys).toEqual(['context_rule_ids', 'signers']);
  });

  it('supports multiple delegated friends plus an external passkey', () => {
    const pubkey = new Uint8Array(65);
    pubkey[0] = 0x04;
    const signers: SignerSignature[] = [
      {
        kind: 'external',
        verifierAddress: VERIFIER,
        publicKey: pubkey,
        passkeySignature: fakePasskeySig(),
      },
      { kind: 'delegated', address: FRIEND_A },
      { kind: 'delegated', address: FRIEND_B },
    ];
    const scv = buildAuthPayloadScVal({ contextRuleIds: [3], signers });
    const signersMap = scv
      .map()!
      .find((e) => e.key().sym().toString() === 'signers')!
      .val()
      .map()!;
    expect(signersMap.length).toBe(3);
  });

  it('encodes the External signer variant with verifier + pubkey bytes', () => {
    const pubkey = new Uint8Array(65);
    pubkey[0] = 0x04;
    pubkey[1] = 0x11;
    const scv = buildAuthPayloadScVal({
      contextRuleIds: [0],
      signers: [
        {
          kind: 'external',
          verifierAddress: VERIFIER,
          publicKey: pubkey,
          passkeySignature: fakePasskeySig(),
        },
      ],
    });
    const signerKey = scv
      .map()!
      .find((e) => e.key().sym().toString() === 'signers')!
      .val()
      .map()![0].key();
    // Signer::External(verifier, pubkey) => Vec[Symbol, Address, Bytes]
    const vec = signerKey.vec()!;
    expect(vec[0].sym().toString()).toBe('External');
    const decodedPub = new Uint8Array(vec[2].bytes());
    expect(Array.from(decodedPub)).toEqual(Array.from(pubkey));
  });

  it('round-trips through XDR', () => {
    const scv = buildAuthPayloadScVal({
      contextRuleIds: [9],
      signers: [{ kind: 'delegated', address: FRIEND_A }],
    });
    const restored = xdr.ScVal.fromXDR(scv.toXDR());
    expect(restored.toXDR().toString('base64')).toBe(scv.toXDR().toString('base64'));
  });
});
