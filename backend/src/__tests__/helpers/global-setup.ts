// runs once per vitest run, in the main process, so a skipped suite is
// announced once rather than by every file that skips it
export default function setup(): void {
  if (!process.env.SLUBY_TEST_DATABASE_URL && !process.env.CI) {
    process.stderr.write(
      '\n[postgres tests] SLUBY_TEST_DATABASE_URL is not set: skipping the database ' +
        'query tests. Start a Postgres 18 server and set it to run them, e.g.\n' +
        '  docker run -d --name sluby-test-pg -e POSTGRES_PASSWORD=sluby-test -p 55432:5432 postgres:18-alpine\n' +
        '  SLUBY_TEST_DATABASE_URL=postgres://postgres:sluby-test@localhost:55432/postgres npm test --workspace=backend\n\n',
    );
  }
}
