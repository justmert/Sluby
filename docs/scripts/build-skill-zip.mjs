// packs public/skills/<name>/ into public/skills/<name>.zip with the skill
// folder at the zip root, the layout claude.ai skill uploads ask for. node's
// zlib does the deflate and crc32, so this needs no zip dependency. entries are
// sorted and carry a fixed date, so an unchanged skill gives the same bytes.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const skillsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'skills');
const skills = process.argv.slice(2);
if (skills.length === 0) skills.push('sluby');

// 1980-01-01 00:00, the earliest date a zip entry can hold
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

function walk(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? [path + sep, ...walk(path)] : [path];
    });
}

function buildZip(name) {
  const root = join(skillsDir, name);
  if (!statSync(join(root, 'SKILL.md'), { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`${root} has no SKILL.md`);
  }
  const paths = [root + sep, ...walk(root)];
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const path of paths) {
    const isDir = path.endsWith(sep);
    // zip names use forward slashes and start at the skill folder
    const entryName = relative(skillsDir, path).split(sep).join('/') + (isDir ? '/' : '');
    const nameBytes = Buffer.from(entryName, 'utf8');
    const data = isDir ? Buffer.alloc(0) : readFileSync(path);
    const packed = isDir ? data : deflateRawSync(data, { level: 9 });
    const method = isDir ? 0 : 8;
    const crc = isDir ? 0 : crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(0x0800, 6); // names are utf-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4); // made by: unix, 2.0, so the mode bits below count
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attributes
    // rwxr-xr-x for folders, rw-r--r-- for files, plus the dos folder bit
    central.writeUInt32LE((((isDir ? 0o40755 : 0o100644) << 16) | (isDir ? 0x10 : 0)) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + packed.length;
  }

  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(paths.length, 8);
  end.writeUInt16LE(paths.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);

  const out = join(skillsDir, `${name}.zip`);
  writeFileSync(out, Buffer.concat([...locals, ...centrals, end]));
  console.log(`wrote ${relative(process.cwd(), out)} (${paths.length} entries)`);
}

for (const name of skills) buildZip(name);
