// Try a tiny upload. Expected to fail until wallet is funded + contracts
// form, but the exact error tells us the integration is real.
import { uploadAndPin } from '../src/storage/sia-client.ts';

const payload = new TextEncoder().encode('hello from siastream e2e test');
try {
  const result = await uploadAndPin(payload);
  console.log('UPLOAD SUCCEEDED:', result);
} catch (e) {
  console.log('Upload failed (expected if account not ready yet):');
  console.log('  message :', e?.message);
  console.log('  code    :', e?.code);
  console.log('  cause   :', e?.cause);
}
