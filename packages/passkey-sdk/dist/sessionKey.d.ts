/** A fresh P-256 keypair used as a scoped session key.
 *
 *  In v1 the key is generated via SubtleCrypto (not as a resident WebAuthn
 *  credential). The caller is expected to persist the private bytes via
 *  `saveSessionKeyMaterial` immediately. The pubkey is SEC1-uncompressed
 *  (0x04 || X || Y, 65 bytes) so it slots directly into the smart account's
 *  `External(verifier, pubkey)` signer.
 */
export interface GeneratedSessionKey {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
    credentialId: string;
}
export declare function generateSessionKey(): Promise<GeneratedSessionKey>;
//# sourceMappingURL=sessionKey.d.ts.map