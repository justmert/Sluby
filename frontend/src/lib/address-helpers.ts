// ---------------------------------------------------------------------------
// Address display helpers (replaces the old sui-helpers.ts)
// ---------------------------------------------------------------------------

/** Truncate a long hex address or ID for display. */
export function truncateAddress(
  address: string,
  startChars = 6,
  endChars = 4,
): string {
  if (!address) return '';
  if (address.length <= startChars + endChars + 2) return address;
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}

/** Format an address with a default truncation style. */
export function formatAddress(address: string, chars = 6): string {
  return truncateAddress(address, chars, chars);
}
