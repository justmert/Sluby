/**
 * Mint a full-scope API key from the command line, for when no key exists yet
 * to create one through the API.
 *
 *   npm run db:seed-key -- [--name "My Key"]
 *
 * The key belongs to the workspace and has no creator, so it acts as an
 * admin: whoever can run this on the server can do anything there anyway.
 */
import { closeDatabase } from '../config/database.js';
import { ADMIN_SCOPES, createAdminApiKey } from './api-key-seeding.js';

const USAGE =
  'usage: npm run db:seed-key -- [--name <name>]\n' +
  '  --name <name>  label shown in the key list (default: admin)';

function parseArgs(argv: string[]): { name: string } {
  let name = 'admin';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === '--name' && argv[i + 1]) {
      name = argv[++i];
    } else {
      throw new Error(`unexpected argument ${arg}`);
    }
  }
  return { name };
}

async function seedApiKey() {
  let opts: ReturnType<typeof parseArgs>;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${(err as Error).message}\n\n${USAGE}`);
    process.exit(2);
  }

  try {
    const { id, rawKey } = await createAdminApiKey(opts);
    console.log('');
    console.log('API key created.');
    console.log('');
    console.log(`  ID:      ${id}`);
    console.log(`  Name:    ${opts.name}`);
    console.log(`  Scopes:  ${ADMIN_SCOPES.join(', ')}`);
    console.log(`  Key:     ${rawKey}`);
    console.log('');
    console.log(
      'This key acts as an admin: it reads and changes everything in the workspace ' +
        'and sees the operations pages. Keep it safe.',
    );
    console.log('Save the key now. It is not shown again.');
    console.log('');
  } finally {
    await closeDatabase();
  }
}

seedApiKey().catch((err) => {
  console.error('Failed to create API key:', err);
  process.exit(1);
});
