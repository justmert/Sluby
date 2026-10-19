/**
 * Print a reset link for an account that signs in with an email, for an
 * admin who is locked out (a forgotten password with no other admin to make
 * a link from the Members page).
 *
 *   npm run admin:reset-link -- --email <email>
 *
 * The link works once, for 7 days, and ends the account's other sessions
 * when used.
 */
import { closeDatabase } from '../config/database.js';
import { resetLinkForEmail } from './reset-links.js';

const USAGE =
  'usage: npm run admin:reset-link -- --email <email>\n' +
  '  --email <email>  the email the account signs in with';

function parseArgs(argv: string[]): { email: string } {
  let email: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === '--email' && argv[i + 1]) {
      email = argv[++i];
    } else {
      throw new Error(`unexpected argument ${arg}`);
    }
  }
  if (!email?.trim()) throw new Error('--email is required');
  return { email };
}

async function printResetLink(): Promise<number> {
  let opts: ReturnType<typeof parseArgs>;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${(err as Error).message}\n\n${USAGE}`);
    return 2;
  }

  try {
    const outcome = await resetLinkForEmail(opts.email);
    if (outcome.status === 'unknown_email') {
      console.error(
        `No account signs in with ${opts.email.trim()}. Check the spelling; an account that ` +
          'signs in with GitHub only has no email, and gets its reset link from an admin on ' +
          'the Members page.',
      );
      return 1;
    }
    if (outcome.status === 'removed') {
      console.error(
        `The account of ${outcome.name} (${opts.email.trim()}) was removed from the workspace, ` +
          'so a reset link would not let it in. An admin can restore it on the Members page.',
      );
      return 1;
    }
    console.log('');
    console.log(`Reset link for ${outcome.name}:`);
    console.log('');
    console.log(`  ${outcome.url}`);
    console.log('');
    console.log(
      `It works once, until ${outcome.expiresAt.toISOString()}. Using it sets a new password ` +
        'and signs out every other session of the account.',
    );
    console.log('');
    return 0;
  } finally {
    await closeDatabase();
  }
}

printResetLink().then(
  (code) => process.exit(code),
  (err) => {
    console.error('Failed to make a reset link:', err);
    process.exit(1);
  },
);
