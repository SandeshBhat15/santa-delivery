// Packs a Web Lens zip that satisfies Snapchat's platform requirements.
//
//   node tools/pack.mjs
//
// Written against the ZIP specification by hand rather than with a dependency,
// because the one rule that actually breaks submissions is path separators:
// PowerShell's Compress-Archive and .NET's ZipFile both write `a\game.js`, which
// an unpacker that follows the spec treats as one filename containing a
// backslash, so index.html asks for `./a/game.js` and finds nothing. This script
// only ever emits forward slashes, so the result is identical everywhere.
//
// Requirements enforced here (developers.snap.com/web-lenses/requirements):
//   - index.html sits at the root of the zip, not inside a folder
//   - index.html is 1 MB or smaller
//   - the whole zip is 8 MB or smaller
//   - every entry name uses `/`

import { createWriteStream } from 'node:fs';
import { readdir, stat, readFile, mkdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '..');
const SRC_DIR = join(ROOT, 'release', 'santas-sleigh-run-web');
const OUT_ZIP = join(ROOT, 'release', 'santas-sleigh-run-web-v1.zip');

const MAX_ZIP_BYTES = 8 * 1024 * 1024;
const MAX_INDEX_BYTES = 1024 * 1024;

// Source maps are never needed by the Lens, and Snapchat's requirements page
// calls them out as pure weight. Everything else in the build ships: the
// desktop instructions poster is only 0.55 MB and keeping it means no <picture>
// branch can ever 404, which matters more than the bytes on a first submission.
// `_headers` is a Netlify deploy config, not part of the game. It lives in
// public/ so `npm run build` always ships it, but it has no meaning inside a
// Lens zip.
const EXCLUDE = new Set(['_headers']);

// --- CRC-32 ---------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// --- ZIP ------------------------------------------------------------------
// Both headers are little-endian, and so are the sizes and offsets below.
function dosDateTime(date) {
  const time =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getSeconds() >> 1) & 0x1f);
  const day =
    (((date.getFullYear() - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return { time, day };
}

async function collect(dir, base = dir) {
  const out = [];
  const items = await readdir(dir, { withFileTypes: true });
  for (const item of items) {
    const abs = join(dir, item.name);
    const info = await stat(abs);
    if (info.isDirectory()) {
      out.push(...(await collect(abs, base)));
    } else if (info.isFile()) {
      // Always `/`, never the platform separator.
      const name = relative(base, abs).split(sep).join('/');
      out.push({ abs, name, size: info.size });
    }
  }
  return out;
}

async function main() {
  let entries;
  try {
    entries = await collect(SRC_DIR);
  } catch (err) {
    console.error(`Cannot read build output at ${SRC_DIR}`);
    console.error('Run `npm run build:snap` first.');
    process.exit(1);
  }

  entries = entries.filter((e) => !EXCLUDE.has(e.name) && !e.name.endsWith('.map'));
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  if (!entries.some((e) => e.name === 'index.html')) {
    console.error('Build output has no index.html at its root.');
    process.exit(1);
  }

  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const data = await readFile(entry.abs);
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const crc = crc32(data);
    const compressed = deflateRawSync(data, { level: 9 });
    const { time, day } = dosDateTime(new Date());

    // 0x0800 = names are UTF-8.
    const flags = 0x0800;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  const zip = Buffer.concat([...localParts, centralDir, end]);

  await mkdir(ROOT + '/release', { recursive: true });
  await new Promise((resolvePromise, reject) => {
    const stream = createWriteStream(OUT_ZIP);
    stream.on('error', reject);
    stream.on('finish', resolvePromise);
    stream.end(zip);
  });

  // --- Report and enforce the limits ------------------------------------
  const indexEntry = entries.find((e) => e.name === 'index.html');
  const problems = [];
  if (indexEntry.size > MAX_INDEX_BYTES) {
    problems.push(`index.html is ${indexEntry.size} bytes (limit 1 MB)`);
  }
  if (zip.length > MAX_ZIP_BYTES) {
    problems.push(`zip is ${zip.length} bytes (limit 8 MB)`);
  }
  if (entries.some((e) => e.name.includes('\\'))) {
    problems.push('an entry name contains a backslash');
  }
  if (entries.some((e) => e.name.startsWith('/'))) {
    problems.push('an entry name starts with /');
  }

  console.log(`Packaged ${entries.length} files -> ${OUT_ZIP.replace(ROOT + sep, '')}`);
  console.log(`  zip: ${(zip.length / 1024 / 1024).toFixed(2)} MB of 8 MB`);
  console.log(`  index.html: ${(indexEntry.size / 1024).toFixed(1)} KB of 1024 KB`);
  console.log('  entries:');
  for (const e of entries) {
    console.log(`    ${e.name}  (${(e.size / 1024).toFixed(0)} KB)`);
  }

  if (problems.length) {
    console.error('\nDoes not meet platform requirements:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('\nOK: root index.html, relative paths, forward slashes, within size limits.');
}

main();