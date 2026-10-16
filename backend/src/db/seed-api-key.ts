/**
 * CLI script to create an admin API key.
 * Solves the bootstrap problem: you need an API key with `manage` scope
 * to create new keys via the API, but there's no key to start with.
 *
 * Usage:
 *   npm run db:seed-key
 *   npm run db:seed-key -- --name "My Key"
 *   npm run db:seed-key -- --address 0xabc...
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { ADMIN_SCOPES, createAdminApiKey } from './api-key-seeding.js';

// Load .env
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPaths = [
  resolve(__dirname, '../../../.env'),
  resolve(__dirname, '../../.env'),
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../.env'),
];
for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    dotenvConfig({ path: envPath });
    break;
  }
}

const connectionString =
  process.env.DATABASE_URL || 'postgresql://sluby:sluby@localhost:5432/sluby';

// Parse CLI args
const args = process.argv.slice(2);
function getArg(flag: string, defaultValue: string): string {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return defaultValue;
}

const name = getArg('--name', 'admin');
const creatorAddress = getArg(
  '--address',
  '0x0000000000000000000000000000000000000000000000000000000000000000',
);

async function seedApiKey() {
  const sql = postgres(connectionString, { max: 1 });
  const db = drizzle(sql);

  const { id, rawKey } = await createAdminApiKey(db, { name, creatorAddress });

  console.log('');
  console.log('API key created successfully.');
  console.log('');
  console.log(`  ID:      ${id}`);
  console.log(`  Name:    ${name}`);
  console.log(`  Scopes:  ${ADMIN_SCOPES.join(', ')}`);
  console.log(`  Key:     ${rawKey}`);
  console.log('');
  console.log('Save this key — it will not be shown again.');
  console.log('');

  await sql.end();
}

seedApiKey().catch((err) => {
  console.error('Failed to create API key:', err);
  process.exit(1);
});
