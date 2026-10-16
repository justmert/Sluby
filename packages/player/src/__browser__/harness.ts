// Browser side of the real-browser tests: talks to the fixture gateway's
// /__fixture/ endpoints and mounts React trees into the page.

import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { FixtureCatalog, GatewayRequest } from './gateway';

export type { FixtureCatalog, FixtureRendition, GatewayRequest } from './gateway';

export async function getCatalog(): Promise<FixtureCatalog> {
  const res = await fetch('/__fixture/catalog');
  return (await res.json()) as FixtureCatalog;
}

export async function resetGateway(): Promise<void> {
  await fetch('/__fixture/reset', { method: 'POST' });
}

export async function gatewayRequests(): Promise<GatewayRequest[]> {
  const res = await fetch('/__fixture/requests');
  return (await res.json()) as GatewayRequest[];
}

/** Make the gateway answer `status` for an object, optionally only past a byte. */
export async function injectFault(id: string, status: number, fromByte = 0): Promise<void> {
  await fetch('/__fixture/fault', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, status, fromByte }),
  });
}

/** Raw stored bytes of an object, as the Sia network would hold them. */
export async function objectBytes(id: string): Promise<Uint8Array> {
  const res = await fetch(`/__fixture/sia/${id}`);
  if (!res.ok) throw new Error(`fixture object ${id} missing`);
  return new Uint8Array(await res.arrayBuffer());
}

export function objectUrl(id: string): string {
  return `${location.origin}/v1/objects/${id}`;
}

export interface Mounted {
  container: HTMLElement;
  unmount: () => void;
}

export function mount(element: ReactElement): Mounted {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  root.render(element);
  return {
    container,
    unmount: () => {
      root.unmount();
      container.remove();
    },
  };
}

export function rangeHeader(r: { offset: number; length: number }): string {
  return `bytes=${r.offset}-${r.offset + r.length - 1}`;
}
