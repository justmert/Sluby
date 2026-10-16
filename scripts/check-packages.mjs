#!/usr/bin/env node
// packs each published package the way `npm publish` would and checks the
// tarball: the license texts are in it, and attw and publint find no problems
// with its exports and type declarations. run from the repo root after building:
//
//   npm run check:packages

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PACKAGES = ['packages/sdk', 'packages/player'];
const REQUIRED_FILES = ['package.json', 'README.md', 'LICENSE', 'NOTICE'];
const bin = (name) => path.resolve('node_modules/.bin', name);

const out = mkdtempSync(path.join(tmpdir(), 'sluby-pack-'));
let failed = false;

try {
  for (const dir of PACKAGES) {
    const stdout = execFileSync('npm', ['pack', '--json', '--pack-destination', out], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    // the prepack build logs to the same stdout, so the json is the trailing array
    const [packed] = JSON.parse(stdout.slice(stdout.lastIndexOf('\n[') + 1));
    const tarball = path.join(out, packed.filename);
    const files = new Set(packed.files.map((f) => f.path));
    console.log(`\n${packed.name}@${packed.version}: ${files.size} files`);

    const missing = REQUIRED_FILES.filter((f) => !files.has(f));
    if (missing.length > 0) {
      console.error(`  missing from the tarball: ${missing.join(', ')}`);
      failed = true;
    }

    for (const [tool, args] of [
      // node10 resolution predates package.json exports, so it can never see a
      // subpath like @sluby/player/hls; every other resolution mode is checked
      ['attw', ['--profile', 'node16', tarball]],
      ['publint', ['--strict', tarball]],
    ]) {
      try {
        execFileSync(bin(tool), args, { stdio: 'inherit' });
      } catch {
        console.error(`  ${tool} reported problems for ${packed.name}`);
        failed = true;
      }
    }
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}

if (failed) process.exit(1);
console.log('\nall packages ok');
