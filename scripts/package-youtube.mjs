// Checks the YouTube Playables build against the published limits and zips it for upload.
// Run via `npm run build:youtube`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = new URL('..', import.meta.url).pathname;
const dist = join(root, 'dist-youtube');
const out = join(root, 'release');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const MiB = 1024 * 1024;

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(dist);

let total = 0;
let gz = 0;
const problems = [];
const warnings = [];
for (const f of files) {
  const buf = readFileSync(f);
  total += buf.length;
  gz += /\.(js|css|html|json|svg)$/.test(f) ? gzipSync(buf).length : buf.length;
  const rel = relative(dist, f);
  if (buf.length >= 30 * MiB) problems.push(`${rel} is ${(buf.length / MiB).toFixed(1)} MiB (hard limit 30 MiB per file)`);
  else if (buf.length > 512 * 1024) warnings.push(`${rel} is ${(buf.length / 1024).toFixed(0)} KiB (recommended < 512 KiB)`);
  if (/[^\w.\-/]/.test(rel)) warnings.push(`${rel}: unusual characters in file name`);
}

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const sdk = html.indexOf('https://www.youtube.com/game_api/v1');
const game = html.indexOf('type="module"');
if (sdk < 0) problems.push('index.html does not load the YouTube Playables SDK');
else if (game >= 0 && sdk > game) problems.push('the SDK must be loaded before the game script');
const external = [...html.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]).filter((u) => !u.startsWith('https://www.youtube.com/game_api/'));
if (external.length) problems.push(`external resources in index.html: ${external.join(', ')}`);

if (total >= 250 * MiB) problems.push('total bundle exceeds 250 MiB');
if (gz >= 30 * MiB) problems.push('initial bundle exceeds 30 MiB');

console.log(`\nYouTube Playables bundle: ${files.length} files`);
console.log(`  total size        ${(total / MiB).toFixed(2)} MiB  (limit 250 MiB)`);
console.log(`  ~compressed size  ${(gz / MiB).toFixed(2)} MiB  (initial limit 30 MiB, target < 15 MiB)`);
for (const w of warnings) console.log(`  note: ${w}`);
for (const p of problems) console.log(`  ERROR: ${p}`);
if (problems.length) process.exit(1);

mkdirSync(out, { recursive: true });
const zip = join(out, `crunchy-trail-youtube-v${pkg.version}.zip`);
rmSync(zip, { force: true });
execFileSync('zip', ['-r', '-X', '-q', zip, '.'], { cwd: dist });
console.log(`\n  -> ${relative(root, zip)} (${(statSync(zip).size / MiB).toFixed(2)} MiB)\n`);
