import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchRefractorTransaction,
  refractorWebTxUrl,
  storeRefractorTransaction,
} from './refractorClient';

const HASH = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('refractorClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores a testnet transaction with the Refractor API shape', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ hash: HASH, network: 'testnet', xdr: 'AAAA' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tx = await storeRefractorTransaction({ xdr: 'AAAA' }, 'https://api.test');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/tx',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ network: 'testnet', xdr: 'AAAA' }),
      }),
    );
    expect(tx.hash).toBe(HASH);
    expect(tx.xdr).toBe('AAAA');
  });

  it('fetches a transaction by hash', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ hash: HASH, network: 'testnet', xdr: 'BBBB' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tx = await fetchRefractorTransaction(HASH, 'https://api.test/');

    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.test/tx/${HASH}`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(tx).toMatchObject({ hash: HASH, network: 'testnet', xdr: 'BBBB' });
  });

  it('rejects malformed hashes before calling fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchRefractorTransaction('not-a-hash')).rejects.toThrow(/invalid/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('builds the public Refractor tx URL', () => {
    expect(refractorWebTxUrl(HASH, 'https://refractor.test/')).toBe(
      `https://refractor.test/tx/${HASH}`,
    );
  });
});
