/**
 * Plain (non-React) helpers for reading / writing the creator wallet address
 * in localStorage.
 *
 * Mirrors the pattern used in api-key-store.ts.
 */

const STORAGE_KEY = 'siastream-creator-address';

export function getStoredCreatorAddress(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEY);
}

export function setStoredCreatorAddress(address: string): void {
  localStorage.setItem(STORAGE_KEY, address);
}
