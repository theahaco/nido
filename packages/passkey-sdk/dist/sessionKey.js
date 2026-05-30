export async function generateSessionKey() {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    // X, Y, D are base64url-encoded 32-byte big-endian field elements.
    const x = b64uToBytes(jwk.x);
    const y = b64uToBytes(jwk.y);
    const d = b64uToBytes(jwk.d);
    const publicKey = new Uint8Array(65);
    publicKey[0] = 0x04;
    publicKey.set(x, 1);
    publicKey.set(y, 33);
    const credentialId = 'sk-' + bytesToHex(crypto.getRandomValues(new Uint8Array(8)));
    return { publicKey, privateKey: d, credentialId };
}
function b64uToBytes(s) {
    const pad = (4 - (s.length % 4)) % 4;
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        u[i] = bin.charCodeAt(i);
    return u;
}
function bytesToHex(b) {
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
//# sourceMappingURL=sessionKey.js.map