import type { ApiKeyRecord } from '@/hooks/useApiKeys';
import { NO_VALUE } from '@/lib/formatters';

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

/**
 * Who made a key, for its Created by cell: the member's name, Server for a
 * key made on the server's command line (no member), or nothing when the
 * listing did not say. `known` is false for the two that name no person.
 */
export function keyCreator(k: Pick<ApiKeyRecord, 'createdBy'>): { text: string; known: boolean } {
  if (k.createdBy === undefined) return { text: NO_VALUE, known: false };
  if (k.createdBy === null) return { text: 'Server', known: false };
  return { text: k.createdBy.name, known: true };
}
