import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock only the browser popup glue; everything else (URL building, return
// parsing, the cache) runs for real so these tests cover the actual wiring.
vi.mock('./redirect.js', () => ({
  openCeremonyPopup: vi.fn(),
}));

// The kit reads `localStorage` at import time (browser-only side effect);
// module.ts only needs the `ModuleType` enum from it, so stub the package.
vi.mock('@creit.tech/stellar-wallets-kit', () => ({
  ModuleType: { HOT_WALLET: 'HOT_WALLET' },
}));

import { openCeremonyPopup } from './redirect.js';
import { NidoModule, ACCOUNT_SWITCH_REQUESTED, AccountSwitchRequestedError } from './module.js';
import { saveCachedAddress, loadCachedAddress } from './handover.js';

const C = 'CCV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XMCW';
const BASE = 'nido.example.xyz';
const DAPP = 'https://dapp.example.com';

const popup = vi.mocked(openCeremonyPopup);

class MemStore {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key(_i: number) { return null; }
  get length() { return this.m.size; }
}

function makeModule(): NidoModule {
  return new NidoModule({ base: BASE, dappOrigin: DAPP, returnUrl: `${DAPP}/cb` });
}

beforeEach(() => {
  (globalThis as any).localStorage = new MemStore();
  popup.mockReset();
});

describe('NidoModule.getAddress', () => {
  it('opens the picker even when an address is cached, passing it as `previous`', async () => {
    saveCachedAddress(C);
    popup.mockResolvedValueOnce({ search: `?nido_address=${C}` });

    const { address } = await makeModule().getAddress();

    expect(address).toBe(C);
    expect(popup).toHaveBeenCalledTimes(1);
    const url = new URL(popup.mock.calls[0][0]);
    expect(url.pathname).toBe('/connect/');
    expect(url.searchParams.get('previous')).toBe(C);
  });

  it('omits `previous` when nothing is cached', async () => {
    popup.mockResolvedValueOnce({ search: `?nido_address=${C}` });

    await makeModule().getAddress();

    const url = new URL(popup.mock.calls[0][0]);
    expect(url.searchParams.get('previous')).toBeNull();
  });

  it('caches the picked address', async () => {
    popup.mockResolvedValueOnce({ search: `?nido_address=${C}` });

    await makeModule().getAddress();

    expect(loadCachedAddress()).toBe(C);
  });

  it('with skipRequestAccess reads the cache without opening a popup', async () => {
    saveCachedAddress(C);

    const { address } = await makeModule().getAddress({ skipRequestAccess: true });

    expect(address).toBe(C);
    expect(popup).not.toHaveBeenCalled();
  });

  it('with skipRequestAccess and an empty cache throws without opening a popup', async () => {
    await expect(makeModule().getAddress({ skipRequestAccess: true })).rejects.toThrow(
      /no account connected/,
    );
    expect(popup).not.toHaveBeenCalled();
  });
});

describe('NidoModule sign methods on switch-account', () => {
  it('clears the cached address and rejects with ACCOUNT_SWITCH_REQUESTED', async () => {
    saveCachedAddress(C);
    popup.mockResolvedValueOnce({ search: '?nido_sign=switch-account' });

    const err = await makeModule()
      .signTransaction('AAAA')
      .then(
        () => { throw new Error('expected rejection'); },
        (e: unknown) => e,
      );

    expect(err).toBeInstanceOf(AccountSwitchRequestedError);
    expect((err as Error).name).toBe(ACCOUNT_SWITCH_REQUESTED);
    expect(loadCachedAddress()).toBeNull();
  });
});
