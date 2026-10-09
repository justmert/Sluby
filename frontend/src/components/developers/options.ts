import type { KeyScope } from '@/hooks/useApiKeys';

// the choices the key and webhook forms offer, with the words people see.
// scope and event names stay as the api spells them (mono); the details say
// what each one means.

export const KEY_SCOPES: { value: KeyScope; detail: string }[] = [
  { value: 'upload', detail: 'Upload videos' },
  { value: 'read', detail: 'See videos, playback URLs and storage details' },
  { value: 'manage', detail: 'Edit and delete videos, keys and webhooks' },
];

export const DEFAULT_SCOPES: KeyScope[] = ['upload', 'read'];
export const DEFAULT_RATE_LIMIT = 100;

/** How long the old key keeps working after a rotation, in seconds. */
export const GRACE_OPTIONS = [
  { value: '0', label: 'No, stop it now' },
  { value: '3600', label: '1 hour' },
  { value: '86400', label: '24 hours' },
  { value: '604800', label: '7 days' },
];

/** Every event a webhook can subscribe to, in the order they happen. */
export const WEBHOOK_EVENTS = [
  { value: 'upload.started', detail: 'An upload started' },
  { value: 'upload.completed', detail: 'The file arrived' },
  { value: 'upload.failed', detail: 'The upload could not start processing' },
  { value: 'processing.started', detail: 'Processing started' },
  { value: 'asset.ready', detail: 'The video is ready to play' },
  { value: 'asset.errored', detail: 'Processing failed and will not retry' },
];

export const DEFAULT_EVENTS = ['asset.ready', 'asset.errored'];
