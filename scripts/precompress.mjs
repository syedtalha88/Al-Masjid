// Writes .br and .gz siblings for compressible build outputs so Caddy can serve them directly
// (`file_server { precompressed br gzip }`, 01 §9). Usage: node scripts/precompress.mjs <dir>
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const COMPRESSIBLE = new Set(['.js', '.mjs', '.css', '.html', '.svg', '.json', '.webmanifest', '.txt', '.xml', '.ico']);
const MIN_BYTES = 1024;

const dir = process.argv[2];
if (!dir) {
  process.stderr.write('usage: node scripts/precompress.mjs <dir>\n');
  process.exit(2);
}

/** @param {string} path @returns {string[]} */
const walk = (path) =>
  readdirSync(path).flatMap((name) => {
    const full = join(path, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

let count = 0;
for (const file of walk(dir)) {
  if (!COMPRESSIBLE.has(extname(file)) || statSync(file).size < MIN_BYTES) continue;
  const content = readFileSync(file);
  writeFileSync(`${file}.br`, brotliCompressSync(content, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
  writeFileSync(`${file}.gz`, gzipSync(content, { level: 9 }));
  count += 1;
}
process.stdout.write(`precompressed ${String(count)} files in ${dir}\n`);
