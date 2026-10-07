/**
 * Mint a full-scope API key from the command line, for when no key exists yet
 * to create one through the API.
 *
 *   npm run db:seed-key -- --address user:<account id> [--name "My Key"]
 *   npm run db:seed-key -- --platform [--name ops]
 *
 * --address mints a key for one owner. --platform mints a key for the
 * platform identity, which reads and changes every tenant's data and sees the
 * deployment-wide status and metrics. One of the two is required, so a
 * cross-tenant key is never minted by accident.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../config/env.js';
import { PLATFORM_ADDRESS } from '../api/ownership.js';
import { ADMIN_SCOPES, createAdminApiKey } from './api-key-seeding.js';

const USAGE =
  'usage: npm run db:seed-key -- (--address <owner> | --platform) [--name <name>]\n' +
  '  --address <owner>  owner the key belongs to, such as user:<account id>\n' +
  '  --platform         a cross-tenant platform key: every tenant and the operator data\n' +
  '  --name <name>      label shown in the key list (default: admin)';

function parseArgs(argv: string[]): { name: string; creatorAddress: string; platform: boolean } {
  let name = 'admin';
  let address: string | undefined;
  let platform = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === '--platform') {
      platform = true;
    } else if ((arg === '--name' || arg === '--address') && argv[i + 1]) {
      if (arg === '--name') name = argv[++i];
      else address = argv[++i];
    } else {
      throw new Error(`unexpected argument ${arg}`);
    }
  }
  if (platform === (address !== undefined)) {
    throw new Error('pass exactly one of --address <owner> and --platform');
  }
  return { name, creatorAddress: address ?? PLATFORM_ADDRESS, platform };
}

async function seedApiKey() {
  let opts: ReturnType<typeof parseArgs>;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${(err as Error).message}\n\n${USAGE}`);
    process.exit(2);
  }

  const sql = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const { id, rawKey } = await createAdminApiKey(drizzle(sql), opts);
    console.log('');
    console.log('API key created.');
    console.log('');
    console.log(`  ID:      ${id}`);
    console.log(`  Name:    ${opts.name}`);
    console.log(`  Owner:   ${opts.creatorAddress}`);
    console.log(`  Scopes:  ${ADMIN_SCOPES.join(', ')}`);
    console.log(`  Key:     ${rawKey}`);
    console.log('');
    if (opts.platform) {
      console.log(
        'This is a platform key: it reads, changes and deletes the data of every tenant. ' +
          'Keep it with the operator.',
      );
    }
    console.log('Save the key now. It is not shown again.');
    console.log('');
  } finally {
    await sql.end();
  }
}

seedApiKey().catch((err) => {
  console.error('Failed to create API key:', err);
  process.exit(1);
});
