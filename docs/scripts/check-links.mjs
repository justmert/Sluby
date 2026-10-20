// checks every link in the static export: internal pages, files and #anchors
// must exist in out/. with --external it also requests every external url.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const outDir = path.resolve(import.meta.dirname, '..', 'out');
const checkExternal = process.argv.includes('--external');

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '_next') continue;
      yield* walk(full);
    } else if (entry.name.endsWith('.html')) {
      yield full;
    }
  }
}

function decode(value) {
  return value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#x27;', "'");
}

const pages = new Map();
for await (const file of walk(outDir)) {
  const html = await readFile(file, 'utf8');
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => decode(m[1])));
  // only links inside the page content and navigation, not the next.js runtime payload
  const hrefs = [...html.matchAll(/<a\s[^>]*?href="([^"]+)"/g)].map((m) => decode(m[1]));
  pages.set(file, { ids, hrefs });
}

async function exists(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

function targetFile(pathname) {
  const clean = decodeURIComponent(pathname);
  if (clean.endsWith('/')) return path.join(outDir, clean, 'index.html');
  return path.join(outDir, clean);
}

const errors = [];
const external = new Map();

for (const [file, { hrefs }] of pages) {
  const from = '/' + path.relative(outDir, file).replace(/index\.html$/, '');
  for (const href of hrefs) {
    if (href.startsWith('mailto:')) continue;
    if (/^https?:\/\//.test(href)) {
      if (!external.has(href)) external.set(href, from);
      continue;
    }
    const url = new URL(href, 'http://site' + from);
    let target = targetFile(url.pathname);
    if (!(await exists(target))) {
      // a page linked without its trailing slash
      const withSlash = path.join(outDir, decodeURIComponent(url.pathname), 'index.html');
      if (await exists(withSlash)) target = withSlash;
      else {
        errors.push(`${from}: broken link ${href}`);
        continue;
      }
    }
    if (url.hash && target.endsWith('.html')) {
      const id = decodeURIComponent(url.hash.slice(1));
      const page = pages.get(target);
      if (!page || !page.ids.has(id)) errors.push(`${from}: missing anchor ${href}`);
    }
  }
}

if (checkExternal) {
  for (const [href, from] of external) {
    try {
      let res = await fetch(href, { method: 'HEAD', redirect: 'follow' });
      if (res.status >= 400) res = await fetch(href, { redirect: 'follow' });
      if (res.status >= 400) errors.push(`${from}: external ${href} answered ${res.status}`);
    } catch (error) {
      errors.push(`${from}: external ${href} failed (${error.message})`);
    }
  }
}

console.log(
  `checked ${pages.size} pages` + (checkExternal ? ` and ${external.size} external urls` : ''),
);
if (errors.length > 0) {
  console.error(errors.join('\n'));
  console.error(`${errors.length} link problems`);
  process.exit(1);
}
