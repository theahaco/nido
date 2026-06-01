/**
 * Pure URL construction for the g2c stellar-wallets-kit module.
 *
 * The module runs at the *dApp* origin, so — unlike the wallet's own pages —
 * it can't derive the g2c base domain from `window.location`. The base is
 * supplied as configuration (e.g. `g2c.example.xyz` or `http://localhost:4321`)
 * and these helpers turn it into the apex `/connect/` picker URL and the
 * per-account `<c-address>.<base>/sign/` ceremony URL.
 *
 * Mirrors the redirect+return pattern established by `delegationHandover.ts`:
 * every URL carries the dApp `origin` and a same-origin `return` URL so the
 * wallet can hand control back and the dApp can verify the response came from
 * the origin it expects.
 */
import { isContractId } from '@g2c/passkey-sdk';
/** Strip a leading scheme if present; returns `[scheme | null, host]`. */
function splitScheme(base) {
    const m = base.match(/^([a-z]+):\/\/(.+)$/i);
    if (m)
        return [m[1], m[2]];
    return [null, base];
}
/**
 * The apex origin for the g2c deployment, e.g. `https://g2c.example.xyz`.
 * If `base` already carries a scheme (handy for `http://localhost:4321` in
 * dev) it's preserved; otherwise `https` is assumed.
 */
export function apexOrigin(base) {
    const [scheme, host] = splitScheme(base);
    return `${scheme ?? 'https'}://${host}`;
}
/**
 * The wallet origin for a specific smart account: the lowercased C-address as
 * a subdomain of the base. This is where the primary-passkey ceremony must run
 * so WebAuthn's `rpId` matches the credential registered at that subdomain.
 */
export function accountOrigin(base, account) {
    if (!isContractId(account)) {
        throw new Error(`accountOrigin: not a contract id: ${account}`);
    }
    const [scheme, host] = splitScheme(base);
    return `${scheme ?? 'https'}://${account.toLowerCase()}.${host}`;
}
/**
 * The apex account picker. The user chooses a smart account; the picker
 * returns its C-address (non-secret) to `returnUrl`.
 */
export function connectUrl(p) {
    const u = new URL('/connect/', apexOrigin(p.base));
    u.searchParams.set('dapp', p.dappOrigin);
    u.searchParams.set('return', p.returnUrl);
    return u.toString();
}
/** The per-account transaction-signing ceremony URL. */
export function signTransactionUrl(p) {
    const u = new URL('/sign/', accountOrigin(p.base, p.account));
    u.searchParams.set('kind', 'tx');
    u.searchParams.set('xdr', p.xdr);
    if (p.networkPassphrase)
        u.searchParams.set('network', p.networkPassphrase);
    u.searchParams.set('dapp', p.dappOrigin);
    u.searchParams.set('return', p.returnUrl);
    return u.toString();
}
/** The per-account arbitrary-message-signing ceremony URL. */
export function signMessageUrl(p) {
    const u = new URL('/sign/', accountOrigin(p.base, p.account));
    u.searchParams.set('kind', 'message');
    u.searchParams.set('message', p.message);
    u.searchParams.set('dapp', p.dappOrigin);
    u.searchParams.set('return', p.returnUrl);
    return u.toString();
}
/** The per-account auth-entry-signing ceremony URL. */
export function signAuthEntryUrl(p) {
    const u = new URL('/sign/', accountOrigin(p.base, p.account));
    u.searchParams.set('kind', 'authEntry');
    u.searchParams.set('authEntry', p.authEntry);
    if (p.networkPassphrase)
        u.searchParams.set('network', p.networkPassphrase);
    u.searchParams.set('dapp', p.dappOrigin);
    u.searchParams.set('return', p.returnUrl);
    return u.toString();
}
//# sourceMappingURL=urls.js.map