/**
 * App metadata shared between onboarding and runtime reconnect.
 *
 * The `sia-storage` SDK's `connect(url, appMeta, appKey)` requires the same
 * appMeta that was used at registration. Keeping the constants in one place
 * means any change is applied consistently.
 */

import { fromHex } from 'sia-storage';
import type { AppMeta } from 'sia-storage';

export const APP_NAME = 'SiaStream';
export const APP_DESCRIPTION = 'Video streaming platform on Sia';
export const APP_SERVICE_URL =
  process.env.SIASTREAM_SERVICE_URL ?? 'http://localhost:5173';

/** Build the AppMeta object from the 32-byte App ID (hex-encoded). */
export function buildAppMeta(appIdHex: string): AppMeta {
  return {
    id: Buffer.from(fromHex(appIdHex)),
    name: APP_NAME,
    description: APP_DESCRIPTION,
    serviceUrl: APP_SERVICE_URL,
  };
}
