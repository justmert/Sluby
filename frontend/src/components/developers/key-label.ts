import type { ApiKeyRecord } from '@/hooks/useApiKeys';

/**
 * How a key is named in sentences: “Production” (sluby_AbC123…). After a
 * rotation two keys share a name, so the prefix tells them apart; keys made
 * before prefixes were stored use the start of their ID instead (FLW-28).
 */
export function keyLabel(k: Pick<ApiKeyRecord, 'id' | 'name' | 'prefix'>): string {
  const tag = k.prefix ? `${k.prefix}…` : `ID ${k.id.slice(0, 8)}`;
  return `“${k.name}” (${tag})`;
}

/** The copy button of a key's notice, where focus goes as the notice appears. */
export const keyCopyButton = (id: string) =>
  document.querySelector<HTMLButtonElement>(`[data-key-copy="${CSS.escape(id)}"] button`);

/** "sluby_7Hq2…f0Kd": enough to tell keys apart, not enough to use one. */
export const maskKey = (key: string) =>
  key.length > 16 ? `${key.slice(0, 10)}…${key.slice(-4)}` : key;
