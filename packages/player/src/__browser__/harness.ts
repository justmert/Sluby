// Browser side of the real-browser tests: talks to the fixture gateway's
// /__fixture/ endpoints and mounts React trees into the page.

import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ApiRequest, FixtureCatalog, GatewayRequest, ShareRequest } from './gateway';

export type {
  ApiRequest,
  FixtureCatalog,
  FixtureRendition,
  GatewayRequest,
  ShareRequest,
} from './gateway';

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

export async function shareRequests(): Promise<ShareRequest[]> {
  const res = await fetch('/__fixture/share-requests');
  return (await res.json()) as ShareRequest[];
}

export async function apiRequests(): Promise<ApiRequest[]> {
  const res = await fetch('/__fixture/api-requests');
  return (await res.json()) as ApiRequest[];
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

/** The share id the fixture gates, like a private asset or a signed playback id. */
export const GATED_SHARE_ID = 'pb_signedsignedsigned';

/** Master urls for the gated id, signed by the fixture the way a backend signs them. */
export async function signedUrls(
  expiresIn = 3600,
): Promise<{ stream: string; object: string; expires: number }> {
  const res = await fetch(`/__fixture/sign?expires_in=${expiresIn}`);
  const body = (await res.json()) as { stream: string; object: string; expires: number };
  return {
    stream: `${location.origin}${body.stream}`,
    object: `${location.origin}${body.object}`,
    expires: body.expires,
  };
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
