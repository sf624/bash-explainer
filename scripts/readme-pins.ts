// A README shown on a package page (Marketplace, Open VSX, npm) must describe the version it is
// published with, so every link and image that points into this repository is pinned to the
// release's tag (v0.9.0), not to a branch (main, HEAD). Relative links would resolve to HEAD there.
//
//   pin:   vsce does it for the extension (`--githubBranch <tag>`, see scripts/package-vsix.ts);
//          pinReadme() does it for the npm package (scripts/build-cli.ts --tag=<tag>).
//   note:  README.md opens with a note that it describes the development version (main), between
//          <!-- development-note --> markers; the package carries the README without it
//          (stripDevelopmentNote(), used by scripts/package-vsix.ts).
//   check: findUnpinned() lists what is not pinned. Run as a program, it reads the README out of a
//          packaged .vsix or npm tarball and exits 1 when anything is left (the Release workflow, and
//          test/readme-pins.test.ts).
//
// Usage: npx tsx scripts/readme-pins.ts --vsix <file> [--tag v0.9.0]
//        npx tsx scripts/readme-pins.ts --tgz <file> [--tag v0.9.0]
//        npx tsx scripts/readme-pins.ts --file <README.md> [--tag v0.9.0]
// The tag defaults to v<version of package.json>.
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { inflateRawSync } from 'zlib';

export const REPO = 'sf624/bash-explainer';

/** A link or image target in Markdown (inline, reference definition) or in an HTML tag. */
interface Target {
  url: string;
  image: boolean;
}

const INLINE = /\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
const DEFINITION = /^( {0,3}\[[^\]]+\]:\s*)(\S+)/gm;
const HTML = /(<(img|a|video|source)\b[^>]*?\s(?:src|href)=)(["'])([^"']*)\3/gi;

/** Whether the `[` that the `]` at `close` closes is preceded by `!`. */
function isImage(text: string, close: number): boolean {
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (text[i] === ']') depth++;
    else if (text[i] === '[' && --depth === 0) return text[i - 1] === '!';
  }
  return false;
}

/** Every target in the README, with a function that rewrites them. */
function rewrite(text: string, fix: (target: Target) => string): string {
  return text
    .replace(INLINE, (all, url: string, offset: number) => all.replace(url, fix({ url, image: isImage(text, offset) })))
    .replace(DEFINITION, (_all, head: string, url: string) => head + fix({ url, image: /\.(png|gif|jpe?g|svg|webp)(\?|#|$)/i.test(url) }))
    .replace(HTML, (_all, head: string, tag: string, quote: string, url: string) => head + quote + fix({ url, image: !/^a$/i.test(tag) }) + quote);
}

function targets(text: string): Target[] {
  const found: Target[] = [];
  rewrite(text, (t) => (found.push(t), t.url));
  return found;
}

const SKIPPED = /^(#|mailto:|tel:|data:)/i;
const ABSOLUTE = /^[a-z][a-z0-9+.-]*:/i;
const RAW_HOST = new RegExp(`^(https://raw\\.githubusercontent\\.com/${REPO}/)([^/?#]+)(/.*)?$`, 'i');
const GITHUB_HOST = new RegExp(`^(https://github\\.com/${REPO}/(?:blob|tree|raw)/)([^/?#]+)(/.*)?$`, 'i');

/**
 * What is wrong with a target that should be pinned to `tag`, or undefined when it is fine. A changelog
 * may link to the tags of its older versions (`anyTag`); a README names exactly the tag.
 */
function problem(url: string, tag: string, anyTag: boolean): string | undefined {
  if (SKIPPED.test(url)) return undefined;
  if (!ABSOLUTE.test(url)) return 'a relative link (it resolves to the default branch)';
  const m = RAW_HOST.exec(url) ?? GITHUB_HOST.exec(url);
  if (m && m[2] !== tag && !(anyTag && /^v\d+\.\d+\.\d+/.test(m[2]))) return `pinned to ${m[2]}, not ${tag}`;
  return undefined;
}

export interface Unpinned {
  url: string;
  why: string;
}

/** The links and images of `text` that point into this repository but not at `tag` (or, with `anyTag`, at no version's tag). */
export function findUnpinned(text: string, tag: string, anyTag = false): Unpinned[] {
  return targets(text).flatMap((t) => {
    const why = problem(t.url, tag, anyTag);
    return why ? [{ url: t.url, why }] : [];
  });
}

/** The images of `text` that are served from this repository at `tag`. */
export function pinnedImages(text: string, tag: string): string[] {
  return targets(text).filter((t) => t.image && (RAW_HOST.exec(t.url) ?? GITHUB_HOST.exec(t.url))?.[2] === tag).map((t) => t.url);
}

/**
 * Pins the README at `dir` (relative to the repository root: 'cli' for cli/README.md) to `tag`:
 * relative targets become absolute ones in this repository at the tag, and the ones that name a
 * branch (main, HEAD) name the tag.
 */
export function pinReadme(text: string, dir: string, tag: string): string {
  return rewrite(text, ({ url, image }) => {
    if (SKIPPED.test(url)) return url;
    const m = RAW_HOST.exec(url) ?? GITHUB_HOST.exec(url);
    if (m) return /^(main|master|HEAD)$/.test(m[2]) ? `${m[1]}${tag}${m[3] ?? ''}` : url;
    if (ABSOLUTE.test(url)) return url;
    const [, file, rest] = /^([^?#]*)(.*)$/.exec(url)!;
    const target = file.startsWith('/') ? path.posix.normalize(file.slice(1)) : path.posix.normalize(path.posix.join(dir, file));
    if (target.startsWith('..')) throw new Error(`${url} leaves the repository`);
    if (image) return `https://raw.githubusercontent.com/${REPO}/${tag}/${target}${rest}`;
    return `https://github.com/${REPO}/${target.endsWith('/') || target === '.' ? 'tree' : 'blob'}/${tag}/${target === '.' ? '' : target}${rest}`;
  });
}

const NOTE = /<!-- development-note -->[\s\S]*?<!-- \/development-note -->\n*/g;

/** The README as a package page shows it: without the note that it describes the development version. */
export function stripDevelopmentNote(text: string): string {
  if (text.match(NOTE)?.length !== 1) throw new Error('README.md must hold exactly one <!-- development-note --> block');
  return text.replace(NOTE, '');
}

/** One file of a zip archive (a .vsix), found by its name in any case, read with no tool: the central directory, then the data. */
export function readZipEntry(zip: Buffer, name: string): string | undefined {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');
  let at = zip.readUInt32LE(eocd + 16);
  for (let i = 0, n = zip.readUInt16LE(eocd + 10); i < n; i++) {
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const entry = zip.toString('utf8', at + 46, at + 46 + nameLength);
    if (entry.toLowerCase() === name.toLowerCase()) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      return (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return undefined;
}

/** The changelog without its `## Unreleased` section, which links to main until the release renames it. */
export function withoutUnreleased(text: string | undefined): string | undefined {
  return text?.replace(/^## Unreleased\n[\s\S]*?(?=^## |(?![\s\S]))/m, '');
}

/** The problems of one packaged file: nothing found, or what is wrong, for the program's report. */
function checkText(label: string, text: string | undefined, tag: string, needImages: boolean): string[] {
  if (text === undefined) return [`${label}: not in the package`];
  const lines = findUnpinned(text, tag, !needImages).map((u) => `${label}: ${u.url}: ${u.why}`);
  if (needImages && !pinnedImages(text, tag).length) lines.push(`${label}: no image is pinned to ${tag} (is the README's image missing?)`);
  return lines;
}

function main(): void {
  const args = process.argv.slice(2);
  const option = (name: string) => args[args.indexOf(`--${name}`) + 1];
  const root = path.join(__dirname, '..');
  const tag = args.includes('--tag') ? option('tag') : `v${JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version}`;
  let problems: string[];
  if (args.includes('--vsix')) {
    const zip = fs.readFileSync(option('vsix'));
    problems = [
      ...checkText('extension/README.md', readZipEntry(zip, 'extension/README.md'), tag, true),
      ...checkText('extension/CHANGELOG.md', withoutUnreleased(readZipEntry(zip, 'extension/CHANGELOG.md')), tag, false),
    ];
  } else if (args.includes('--tgz')) {
    const text = execFileSync('tar', ['-xzOf', option('tgz'), 'package/README.md'], { encoding: 'utf8' });
    problems = checkText('package/README.md', text, tag, true);
  } else if (args.includes('--file')) {
    problems = checkText(option('file'), fs.readFileSync(option('file'), 'utf8'), tag, true);
  } else {
    console.error('Usage: readme-pins.ts (--vsix <file> | --tgz <file> | --file <README.md>) [--tag v0.9.0]');
    process.exit(2);
  }
  if (problems.length) {
    console.error(`These links are not pinned to ${tag}:`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(`Every link and image into ${REPO} is pinned to ${tag}.`);
}

if (require.main === module) main();
