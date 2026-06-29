/**
 * Plain (non-React) helpers for reading / writing the API key in localStorage.
 * The React context + hook lives in api-key-provider.tsx (created by scaffolding).
 *
 * Both modules MUST use the same localStorage key.
 */

const STORAGE_KEY = 'sluby-api-key';

// ---------------------------------------------------------------------------
// Auto-seed from VITE_API_KEY env var on first load
// ---------------------------------------------------------------------------

const envKey =
  typeof import.meta !== 'undefined'
    ? (import.meta.env?.VITE_API_KEY as string | undefined)
    : undefined;

if (envKey && typeof localStorage !== 'undefined' && !localStorage.getItem(STORAGE_KEY)) {
  localStorage.setItem(STORAGE_KEY, envKey);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getStoredApiKey(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEY);
}

export function setStoredApiKey(key: string): void {
  localStorage.setItem(STORAGE_KEY, key);
}

export function clearStoredApiKey(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function maskApiKey(key: string): string {
  if (!key || key.length < 8) return key;
  const last4 = key.slice(-4);
  return `sluby_****...${last4}`;
}
