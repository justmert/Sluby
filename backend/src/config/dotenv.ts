import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Load the repository's .env into process.env, for every entry point that
 * runs from source (the server, db:migrate, db:seed-key), so they all reach
 * the same database. Variables already set win over the file, which is how
 * compose's values apply inside the containers.
 */
export function loadDotenv(): void {
  const candidates = [
    resolve(here, '../../../.env'), // backend/src/config or backend/dist/config
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../.env'),
  ];
  const found = candidates.find((path) => existsSync(path));
  if (found) dotenvConfig({ path: found, quiet: true });
}
