#!/usr/bin/env node
// packs each published package the way `npm publish` would and checks the
// tarball: the license texts are in it, attw and publint find no problems with
// its exports and type declarations, both packages work when installed (the
// sdk from both module formats, the player rendered on the server and its hls
// entry without react), and their declarations type-check in a strict
// consumer that has neither @types/node nor @types/react. run from the repo
// root after building:
//
//   npm run check:packages

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PACKAGES = ['packages/sdk', 'packages/player'];
const REQUIRED_FILES = ['package.json', 'README.md', 'LICENSE', 'NOTICE'];
// the react the player is checked against on the server, as an app would install it
const REACT_VERSION = '^19.3.0';
const bin = (name) => path.resolve('node_modules/.bin', name);

const out = mkdtempSync(path.join(tmpdir(), 'sluby-pack-'));
let failed = false;

/** Run a tool, telling a tool that could not start apart from one that found problems. */
function runTool(label, file, args, options = {}) {
  try {
    execFileSync(file, args, { stdio: 'inherit', ...options });
    return true;
  } catch (err) {
    if (err.code === 'ENOENT' || err.status === null) {
      console.error(`  could not run ${label}: ${err.message}`);
    } else {
      console.error(`  ${label} reported problems`);
    }
    failed = true;
    return false;
  }
}

function install(dir, specs) {
  mkdirSync(dir);
  writeFileSync(path.join(dir, 'package.json'), '{"private":true}');
  execFileSync('npm', ['install', '--no-audit', '--no-fund', ...specs], {
    cwd: dir,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

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

    // node10 resolution predates package.json exports, so it can never see a
    // subpath like @sluby/player/hls; every other resolution mode is checked
    runTool(`attw for ${packed.name}`, bin('attw'), ['--profile', 'node16', tarball]);
    runTool(`publint for ${packed.name}`, bin('publint'), ['--strict', tarball]);
  }

  const tarballs = readdirSync(out).filter((f) => f.endsWith('.tgz'));
  const sdkTarball = path.join(
    out,
    tarballs.find((f) => f.startsWith('sluby-sdk-')),
  );
  const playerTarball = path.join(
    out,
    tarballs.find((f) => f.startsWith('sluby-player-')),
  );

  // an app with react: load the sdk from both module formats and run code
  // that differs between the builds (webhook signing needs node:crypto, which
  // the esm build cannot get through require), and render the player on the
  // server, which must not touch the dom or the media apis
  const app = path.join(out, 'app');
  install(app, [sdkTarball, playerTarball, `react@${REACT_VERSION}`, `react-dom@${REACT_VERSION}`]);
  const webhooks = `
    const secret = 'whsec_check';
    const payload = '{"event":"asset.ready"}';
    const sig = createHmac('sha256', secret).update(payload).digest('hex');
    const hooks = new SlubyClient({ apiKey: 'sluby_check', baseUrl: 'http://localhost' }).webhooks;
    if (hooks.verifySignature(payload, sig, secret) !== true) throw new Error('valid signature rejected');
    if (hooks.verifySignature(payload, 'f'.repeat(64), secret) !== false) throw new Error('bad signature accepted');
  `;
  const ssr = `
    const html = renderToString(createElement(SlubyPlayer, { src: 'https://example.com/v1/stream/a/master.m3u8' }));
    if (!html.includes('<video')) throw new Error('the player rendered no video element: ' + html);
    if (typeof createSiaLoader !== 'function') throw new Error('the hls entry has no createSiaLoader');
  `;
  for (const [format, file, code] of [
    [
      'esm',
      'check.mjs',
      `import { SlubyClient } from '@sluby/sdk';
import { SlubyPlayer } from '@sluby/player';
import { createSiaLoader } from '@sluby/player/hls';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createHmac } from 'node:crypto';
${webhooks}
${ssr}`,
    ],
    [
      'cjs',
      'check.cjs',
      `const { SlubyClient } = require('@sluby/sdk');
const { SlubyPlayer } = require('@sluby/player');
const { createSiaLoader } = require('@sluby/player/hls');
const { createElement } = require('react');
const { renderToString } = require('react-dom/server');
const { createHmac } = require('node:crypto');
${webhooks}
${ssr}`,
    ],
  ]) {
    writeFileSync(path.join(app, file), code);
    if (runTool(`the ${format} smoke check`, 'node', [file], { cwd: app })) {
      console.log(
        `both packages load from ${format}: webhook signatures verify, the player renders on the server`,
      );
    }
  }

  // an app with neither react nor any @types: the hls entry must load and its
  // declarations, like the sdk's, must type-check with every lib file checked
  const plain = path.join(out, 'plain');
  install(plain, [sdkTarball, playerTarball]);
  const installed = readdirSync(path.join(plain, 'node_modules'));
  const typesDir = installed.includes('@types')
    ? readdirSync(path.join(plain, 'node_modules', '@types'))
    : [];
  for (const unwanted of ['react', 'react-dom']) {
    if (installed.includes(unwanted)) {
      console.error(
        `  installing the packages pulled in ${unwanted}, a peer the hls entry does not need`,
      );
      failed = true;
    }
  }
  for (const unwanted of ['node', 'react']) {
    if (typesDir.includes(unwanted)) {
      console.error(`  installing the packages pulled in @types/${unwanted}`);
      failed = true;
    }
  }
  writeFileSync(
    path.join(plain, 'load.mjs'),
    `import { createSiaLoader } from '@sluby/player/hls';
if (typeof createSiaLoader !== 'function') throw new Error('no createSiaLoader');`,
  );
  if (runTool('loading @sluby/player/hls without react', 'node', ['load.mjs'], { cwd: plain })) {
    console.log('@sluby/player/hls loads without react installed');
  }
  writeFileSync(
    path.join(plain, 'index.ts'),
    `import { SlubyClient, type VideoAsset, type SiaObject } from '@sluby/sdk';
import { createSiaLoader, type SiaPlaybackSession } from '@sluby/player/hls';
import Hls from 'hls.js';

const client = new SlubyClient({ baseUrl: 'https://video.example.com', sia: { indexerUrl: 'https://sia.storage', appId: 'a', appKey: 'b' } });
const session: SiaPlaybackSession = client.sia!;
const hls = new Hls({ loader: createSiaLoader(session, 'asset', { src: client.playback.streamUrl('asset') }) });
export const used: [Hls, VideoAsset | null, SiaObject | null] = [hls, null, null];
`,
  );
  for (const [label, compilerOptions, extension] of [
    ['bundler resolution', { module: 'esnext', moduleResolution: 'bundler' }, 'ts'],
    ['node16 esm', { module: 'node16', moduleResolution: 'node16' }, 'mts'],
    ['node16 commonjs', { module: 'node16', moduleResolution: 'node16' }, 'cts'],
  ]) {
    const name = `index.${extension}`;
    if (extension !== 'ts') {
      writeFileSync(path.join(plain, name), readFileSync(path.join(plain, 'index.ts'), 'utf8'));
    }
    const tsconfig = `tsconfig.${extension}.json`;
    writeFileSync(
      path.join(plain, tsconfig),
      JSON.stringify({
        compilerOptions: {
          ...compilerOptions,
          target: 'es2022',
          lib: ['es2022', 'dom', 'dom.iterable'],
          types: [],
          strict: true,
          skipLibCheck: false,
          noEmit: true,
        },
        files: [name],
      }),
    );
    if (
      runTool(`tsc (${label}, skipLibCheck false, no @types)`, bin('tsc'), ['-p', tsconfig], {
        cwd: plain,
      })
    ) {
      console.log(
        `the declarations type-check: ${label}, skipLibCheck false, no @types/node or @types/react`,
      );
    }
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}

if (failed) process.exit(1);
console.log('\nall packages ok');
