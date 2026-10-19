import path from 'node:path';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  embedCode,
  embedKinds,
  embedSamples,
  HLS_CDN_URL,
  needsSigning,
  primaryEmbed,
  SIGNED_URL_PATH,
  streamUrl,
  watchUrl,
  type EmbedCode,
} from './embed';

const frontendDir = path.resolve(__dirname, '../..');
const base = 'https://video.example.com/';
const publicVideo = { id: '104086e6-0000-4000-8000-00000000b8bf', accessTier: 'public' as const };
const privateVideo = { id: 'a7f1c2d3-0000-4000-8000-0000000000aa', accessTier: 'private' as const };
const openId = { playbackId: 'pb_open123', policy: 'public' as const };
const signedId = { playbackId: 'pb_signed456', policy: 'signed' as const };

const all: Array<[string, EmbedCode]> = [
  ...embedSamples(publicVideo, { baseUrl: base }).map(
    (c) => [`public-${c.kind}`, c] as [string, EmbedCode],
  ),
  ...embedSamples(privateVideo, { baseUrl: base }).map(
    (c) => [`private-${c.kind}`, c] as [string, EmbedCode],
  ),
  ...embedSamples(publicVideo, { baseUrl: base, by: openId }).map(
    (c) => [`open-${c.kind}`, c] as [string, EmbedCode],
  ),
  ...embedSamples(publicVideo, { baseUrl: base, by: signedId }).map(
    (c) => [`signedid-${c.kind}`, c] as [string, EmbedCode],
  ),
];

/** The script an html sample runs, without the cdn tag. */
const inlineScript = (html: string) => /<script>\n([\s\S]*?)<\/script>/.exec(html)![1];

/**
 * Compile every sample as a reader would paste it: react and server code
 * against the real sdk and player sources, the html script as javascript
 * against hls.js, which the cdn tag puts on the page as a global.
 */
function typecheck() {
  const files = new Map<string, string>();
  for (const [name, c] of all) {
    if (c.language === 'tsx' || c.language === 'ts') {
      files.set(path.join(frontendDir, `__embed_${name}.${c.language}`), c.code);
    } else if (c.language === 'html' && c.code.includes('<script>\n')) {
      // an open iframe is markup alone, with no script to check
      files.set(path.join(frontendDir, `__embed_${name}.js`), inlineScript(c.code));
    }
  }
  files.set(
    path.join(frontendDir, '__embed_hls_global.d.ts'),
    "declare global { const Hls: typeof import('hls.js').default; }\nexport {};",
  );
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    allowJs: true,
    checkJs: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    moduleDetection: ts.ModuleDetectionKind.Force,
    jsx: ts.JsxEmit.ReactJSX,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    types: ['node'],
    paths: {
      '@sluby/sdk': [path.join(frontendDir, '../packages/sdk/src/index.ts')],
      '@sluby/player': [path.join(frontendDir, '../packages/player/src/index.ts')],
    },
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, lang, onError, create) =>
    files.has(fileName)
      ? ts.createSourceFile(fileName, files.get(fileName)!, lang)
      : getSourceFile(fileName, lang, onError, create);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (f) => files.has(f) || fileExists(f);
  const readFile = host.readFile.bind(host);
  host.readFile = (f) => files.get(f) ?? readFile(f);
  const program = ts.createProgram([...files.keys()], options, host);
  const errors = new Map<string, string[]>();
  for (const file of files.keys()) {
    const diags = ts.getPreEmitDiagnostics(program, program.getSourceFile(file));
    errors.set(
      path.basename(file),
      diags.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')),
    );
  }
  return errors;
}

describe('embed code', () => {
  it('typechecks every sample against the real sdk, player and hls.js', () => {
    const errors = typecheck();
    // react and html for the two open cases; server, the iframe's script, react
    // and html for the two signed ones; and the hls global
    expect(errors.size).toBe(13);
    for (const [file, messages] of errors)
      expect({ file, messages }).toEqual({ file, messages: [] });
  });

  it('offers the iframe first for an open video, server code first for a signed one', () => {
    const open = ['iframe', 'link', 'react', 'html', 'stream-url'];
    const signed = ['server', 'iframe', 'react', 'html'];
    expect(embedKinds(publicVideo)).toEqual(open);
    expect(embedKinds(publicVideo, openId)).toEqual(open);
    expect(embedKinds(privateVideo)).toEqual(signed);
    expect(embedKinds(privateVideo, openId)).toEqual(signed);
    expect(embedKinds(publicVideo, signedId)).toEqual(signed);
    expect(needsSigning(publicVideo, signedId)).toBe(true);
    expect(needsSigning(publicVideo)).toBe(false);
  });

  it('embeds the watch page, and links to it by the chosen id', () => {
    expect(watchUrl(base, 'pb_open123')).toBe('https://video.example.com/watch/pb_open123');
    expect(embedCode(publicVideo, { kind: 'link', baseUrl: base, by: openId }).code).toBe(
      'https://video.example.com/watch/pb_open123',
    );
    const iframe = embedCode(publicVideo, { kind: 'iframe', baseUrl: base }).code;
    expect(iframe).toContain(`<iframe src="https://video.example.com/watch/${publicVideo.id}"`);
    expect(iframe).toContain('allowfullscreen');
    expect(iframe).not.toContain('<script>');
    // a signed page takes the signed url's query as it is
    expect(embedCode(privateVideo, { kind: 'iframe', baseUrl: base }).code).toContain(
      `iframe.src = 'https://video.example.com/watch/${privateVideo.id}' + new URL(signedUrl).search;`,
    );
    expect(() => embedCode(privateVideo, { kind: 'link', baseUrl: base })).toThrow(RangeError);
  });

  it('builds the stream url the way the sdk does', async () => {
    const { SlubyClient } = await import('@sluby/sdk');
    const sdk = new SlubyClient({ baseUrl: base });
    expect(streamUrl(base, publicVideo.id)).toBe(sdk.playback.streamUrl(publicVideo.id));
    expect(embedCode(publicVideo, { kind: 'stream-url', baseUrl: base }).code).toBe(
      `https://video.example.com/v1/stream/${publicVideo.id}/master.m3u8`,
    );
    expect(embedCode(publicVideo, { kind: 'stream-url', baseUrl: base, by: openId }).code).toBe(
      'https://video.example.com/v1/stream/pb_open123/master.m3u8',
    );
  });

  it('plays by the chosen id', () => {
    expect(embedCode(publicVideo, { kind: 'react', baseUrl: base, by: openId }).code).toContain(
      "streamUrl('pb_open123')",
    );
    expect(embedCode(publicVideo, { kind: 'server', baseUrl: base, by: signedId }).code).toContain(
      "getSignedUrl('pb_signed456'",
    );
    expect(embedCode(privateVideo, { kind: 'server', baseUrl: base }).code).toContain(
      `getSignedUrl('${privateVideo.id}'`,
    );
  });

  it('keeps the api key out of every browser sample', () => {
    for (const [name, c] of all) {
      if (c.kind === 'server') continue;
      expect({ name, key: /apiKey|SLUBY_API_KEY|sluby_/.test(c.code) }).toEqual({
        name,
        key: false,
      });
    }
    const server = embedCode(privateVideo, { kind: 'server', baseUrl: base }).code;
    expect(server).toContain('process.env.SLUBY_API_KEY');
  });

  it('has the browser samples of a signed video ask the server sample for the url', () => {
    const server = embedCode(privateVideo, { kind: 'server', baseUrl: base }).code;
    expect(server).toContain(`req.url !== '${SIGNED_URL_PATH}'`);
    for (const kind of ['iframe', 'react', 'html'] as const) {
      expect(embedCode(privateVideo, { kind, baseUrl: base }).code).toContain(
        `fetch('${SIGNED_URL_PATH}')`,
      );
    }
    // and a signed react player keeps playing past the url's expiry
    expect(embedCode(privateVideo, { kind: 'react', baseUrl: base }).code).toContain(
      'refreshSrc={signedUrl}',
    );
  });

  it('copies the iframe for a public video and the server code for a private one', () => {
    expect(primaryEmbed(publicVideo, { baseUrl: base })).toMatchObject({
      kind: 'iframe',
      label: 'Iframe',
      language: 'html',
    });
    expect(primaryEmbed(privateVideo, { baseUrl: base })).toMatchObject({
      kind: 'server',
      label: 'Server',
      language: 'ts',
    });
  });

  it('refuses a sample that cannot work', () => {
    expect(() => embedCode(privateVideo, { kind: 'stream-url', baseUrl: base })).toThrow(
      RangeError,
    );
    expect(() => embedCode(publicVideo, { kind: 'server', baseUrl: base })).toThrow(RangeError);
  });

  it('uses this origin by default and never a hardcoded host', () => {
    expect(primaryEmbed(publicVideo).code).toContain(`src="${window.location.origin}/watch/`);
    expect(embedCode(publicVideo, { kind: 'react' }).code).toContain(
      `baseUrl: '${window.location.origin}'`,
    );
    for (const [, c] of all) expect(c.code).not.toMatch(/localhost|api\.sluby\.app/);
  });

  it('loads the hls.js release the player depends on', () => {
    const player = JSON.parse(
      readFileSync(path.join(frontendDir, '../packages/player/package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    const range = player.dependencies['hls.js'];
    const cdn = /hls\.js@(\d+)\.(\d+)\.(\d+)/.exec(HLS_CDN_URL)!;
    expect(range).toBe(`^${cdn[1]}.${cdn[2]}.${cdn[3]}`);
  });
});
