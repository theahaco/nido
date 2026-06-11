import {
  resolveFriendInput,
  type ResolvedFriend,
  type ResolveFriendOptions,
} from '@g2c/passkey-sdk';

// Cosmetic suffixes a user might append to a nido name. Longest first so
// `alice.nido.fyi` strips the whole suffix, not just `.fyi`. These are pure
// UI convenience — the on-chain registry stores bare labels only.
const KNOWN_SUFFIXES = ['.nido.fyi', '.nido', '.localhost'];

/**
 * Normalize a typed recipient string for resolution. Strips a known cosmetic
 * nido suffix (lowercasing the remaining label), otherwise returns the trimmed
 * input untouched so a raw C…/G… address passes through with its case intact.
 */
export function normalizeRecipientInput(raw: string): string {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  for (const suffix of KNOWN_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      return lower.slice(0, -suffix.length);
    }
  }
  return trimmed;
}

/**
 * Pull the destination out of a scanned QR payload. Nido receive QRs encode the
 * plain C-address, but this also accepts common payment URI query parameters.
 */
export function recipientFromQrPayload(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  try {
    const url = new URL(trimmed);
    const destination =
      url.searchParams.get('destination') ??
      url.searchParams.get('to') ??
      url.searchParams.get('address');
    if (destination) return normalizeRecipientInput(destination);
  } catch {
    // Not a URI. Treat as plain address/name text below.
  }

  return normalizeRecipientInput(trimmed);
}

/**
 * Resolve a typed Send recipient (nido name, `alice.nido`, C…, or G…) to a
 * concrete address. Thin wrapper: normalize then delegate to the SDK's
 * `resolveFriendInput`. Returns null when a name is unregistered or the input
 * is neither a valid name nor address.
 */
export function resolveSendRecipient(
  input: string,
  opts: ResolveFriendOptions,
): Promise<ResolvedFriend | null> {
  return resolveFriendInput(normalizeRecipientInput(input), opts);
}
