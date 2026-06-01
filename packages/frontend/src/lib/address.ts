/**
 * Address formatting helpers for Stellar C-addresses (and G-addresses).
 *
 * Centralizes the truncation logic that was previously duplicated ad-hoc across
 * components (e.g. `addr.slice(0, 6) + '…' + addr.slice(-6)`). New code should
 * import from here; existing call sites are migrated opportunistically.
 */

/**
 * Truncate a long address to `head`…`tail` form.
 *
 * @param addr  full address string (C… / G… / contract id)
 * @param head  characters to keep at the start (default 4)
 * @param tail  characters to keep at the end (default 4)
 * @returns truncated string, or the original if it is already short enough
 *
 * @example shortAddr("CABC…XYZ", 4, 4) -> "CABC…WXYZ"
 */
export function shortAddr(addr: string, head = 4, tail = 4): string {
  if (!addr) return "";
  // Keep short strings intact; only truncate when there is something to hide.
  return addr.length > head + tail + 1
    ? `${addr.slice(0, head)}…${addr.slice(-tail)}`
    : addr;
}
