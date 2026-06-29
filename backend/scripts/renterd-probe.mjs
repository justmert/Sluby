// End-to-end probe of the renterd-backed sia-client.
// Uploads a payload, re-reads it with byte-range, and verifies both
// full and ranged reads return identical bytes.
import {
  uploadAndPin,
  uploadAndPinPacked,
  downloadObject,
  getObject,
  deleteObject,
} from '../dist/storage/sia-client.js';

const payload = new TextEncoder().encode(
  'Sluby renterd round-trip ' + Date.now(),
);
console.log('upload size:', payload.length);
const { objectId, size } = await uploadAndPin(payload);
console.log('uploaded:', objectId, 'size:', size);

const meta = await getObject(objectId);
console.log('meta size:', Number(meta.size()), 'slabs:', meta.slabs().length);

// Full download
const full = await downloadObject(objectId);
const fullMatch = Buffer.from(full).equals(Buffer.from(payload));
console.log('full download:', full.length, 'bytes, match:', fullMatch);

// Ranged download — middle 10 bytes
const offset = 5;
const length = 10;
const ranged = await downloadObject(objectId, { offset, length });
const expected = Buffer.from(payload).subarray(offset, offset + length);
const rangedMatch = Buffer.from(ranged).equals(expected);
console.log('ranged download:', ranged.length, 'bytes, match:', rangedMatch);

// Packed batch
const items = [
  new TextEncoder().encode('a-' + Date.now()),
  new TextEncoder().encode('b-' + Date.now()),
  new TextEncoder().encode('c-' + Date.now()),
];
const batch = await uploadAndPinPacked(items);
console.log('packed ids:', batch.map((r) => r.objectId));

// Cleanup
await deleteObject(objectId);
for (const r of batch) await deleteObject(r.objectId);
console.log('cleanup ok');

process.exit(fullMatch && rangedMatch ? 0 : 2);
