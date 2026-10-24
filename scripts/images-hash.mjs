// The README images show the UI: the hover, the panel and the name hints. This hashes the files
// that decide how those look, so a release can tell whether the images were recorded with them.
// Usage: node scripts/images-hash.mjs [--write | --check]
//   (no option)  print the hash
//   --write      store it in images/.source-hash (the recording script does this)
//   --check      exit 1 when the stored hash differs (the Release workflow does this)
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORE = path.join(ROOT, 'images', '.source-hash');
/** What the images look like depends on these; the explanations' wording is left out on purpose. */
const SOURCES = ['src/ui', 'media', 'images/demo.sh', 'images/hints.sh', 'scripts/capture-readme-images.mjs'];

function files(rel) {
  const abs = path.join(ROOT, rel);
  if (fs.statSync(abs).isFile()) return [rel];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => files(path.posix.join(rel, e.name)));
}

export function imagesHash() {
  const hash = createHash('sha256');
  for (const rel of SOURCES.flatMap(files).sort()) {
    // Line endings differ between a Windows and a Linux checkout; the look does not.
    const data = /\.(png|svg)$/.test(rel) ? fs.readFileSync(path.join(ROOT, rel)) : fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
    hash.update(`${rel}\0`).update(data).update('\0');
  }
  return hash.digest('hex');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const now = imagesHash();
  if (process.argv.includes('--write')) {
    fs.writeFileSync(STORE, `${now}\n`);
  } else if (process.argv.includes('--check')) {
    const stored = fs.existsSync(STORE) ? fs.readFileSync(STORE, 'utf8').trim() : '(none)';
    if (stored !== now) {
      console.error(`The README images were recorded with another version of the UI (${SOURCES.join(', ')} changed).`);
      console.error('Re-record them first: run the "README images" workflow and merge its pull request (see images/RECORDING.md).');
      process.exit(1);
    }
    console.log('The README images are up to date with the UI.');
  } else {
    console.log(now);
  }
}
