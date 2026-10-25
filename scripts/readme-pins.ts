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
// Code (spans, fenced and indented blocks) is neither checked nor rewritten here, as a Markdown reader
// shows it as it is. vsce, though, rewrites `[text](relative)` in code too (it uses a regular expression),
// so test/readme-pins.test.ts requires that README.md, README.ja.md and CHANGELOG.md hold no such example.
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

/** A link or image target in a README, and where it stands in the text. */
interface Target {
  url: string;
  image: boolean;
  /** A URL in running text, not the target of a link: it is only checked when it names a branch of this repository. */
  bare: boolean;
  start: number;
  end: number;
}

/**
 * The text with its code replaced by spaces of the same length (line ends stay), or, with `keepCode`,
 * the code alone. Code is fenced blocks (``` and ~~~, with an info string), indented blocks and code
 * spans (a backtick run of any length). A Markdown reader shows it as it is, so a link in it is no link.
 */
export function maskCode(text: string, keepCode = false): string {
  const chars = text.split('');
  const isCode = new Array<boolean>(chars.length).fill(false);
  const mark = (from: number, to: number) => isCode.fill(true, from, to);

  // Blocks, line by line.
  let fence: { char: string; length: number } | undefined;
  let afterBlank = true;
  let inList = false;
  let inIndented = false;
  let at = 0;
  for (const line of text.split('\n')) {
    const from = at;
    at += line.length + 1;
    if (fence) {
      mark(from, from + line.length);
      const close = /^[ \t>]*(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = undefined;
      continue;
    }
    const open = /^[ \t>]*(`{3,}|~{3,})(.*)$/.exec(line);
    if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
      fence = { char: open[1][0], length: open[1].length };
      mark(from, from + line.length);
      afterBlank = false;
      inIndented = false;
      continue;
    }
    if (/^\s*$/.test(line)) {
      afterBlank = true;
      continue;
    }
    const indent = /^[ \t]*/.exec(line)![0].replace(/\t/g, '    ').length;
    if (indent >= 4 && (inIndented || (afterBlank && !inList))) {
      mark(from, from + line.length);
      inIndented = true;
    } else {
      inIndented = false;
      if (indent < 4) inList = /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]/.test(line) || (inList && indent > 0);
    }
    afterBlank = false;
  }

  // Code spans, in what the blocks leave.
  const rest = chars.map((c, i) => (isCode[i] ? ' ' : c)).join('');
  const runs = [...rest.matchAll(/`+/g)].map((m) => ({ start: m.index!, length: m[0].length }));
  for (let i = 0; i < runs.length; i++) {
    let { start, length } = runs[i];
    let escapes = 0;
    while (rest[start - 1 - escapes] === '\\') escapes++;
    if (escapes % 2 === 1) {
      start++;
      length--;
    }
    if (length === 0) continue;
    for (let j = i + 1; j < runs.length; j++) {
      if (/\n[ \t]*\n/.test(rest.slice(start + length, runs[j].start))) break;
      if (runs[j].length !== length) continue;
      mark(start, runs[j].start + length);
      i = j;
      break;
    }
  }
  return chars.map((c, i) => (c === '\n' || isCode[i] === keepCode ? c : ' ')).join('');
}

const INLINE = /\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/dg;
const DEFINITION = /^ {0,3}\[[^\]]+\]:\s*<?([^\s>]+)/dgm;
const AUTOLINK = /<([a-z][a-z0-9+.-]{1,31}:[^\s<>]*)>/dgi;
const TAG = /<(img|a|video|source)\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;
const ATTRIBUTE = /\s(src|href|poster|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/dgi;
const SRCSET_URL = /(?:^|,)\s*([^\s,]+)/dg;
const BARE = /https?:\/\/[^\s<>()[\]"'`]+/g;
const IMAGE_FILE = /\.(png|gif|jpe?g|svg|webp)(\?|#|$)/i;

/** Whether the `[` that the `]` at `close` closes is preceded by `!`. */
function isImage(text: string, close: number): boolean {
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (text[i] === ']') depth++;
    else if (text[i] === '[' && --depth === 0) return text[i - 1] === '!';
  }
  return false;
}

/**
 * The targets of the links and images of a README, outside its code: Markdown inline links and images,
 * reference definitions, autolinks, the src, href, poster and srcset of HTML tags (quoted or not), and
 * the URLs written in the text.
 */
function scan(text: string): Target[] {
  const masked = maskCode(text);
  const found: Target[] = [];
  const add = (at: readonly [number, number], image: boolean) => found.push({ url: text.slice(...at), image, bare: false, start: at[0], end: at[1] });
  for (const m of masked.matchAll(INLINE)) add(m.indices![1], isImage(masked, m.index!));
  for (const m of masked.matchAll(DEFINITION)) add(m.indices![1], IMAGE_FILE.test(m[1]));
  for (const m of masked.matchAll(AUTOLINK)) add(m.indices![1], false);
  for (const tag of masked.matchAll(TAG)) {
    const image = !/^a$/i.test(tag[1]);
    const shift = tag.index!;
    for (const attribute of tag[0].matchAll(ATTRIBUTE)) {
      const value = attribute.indices!.slice(2).find(Boolean)!;
      if (attribute[1].toLowerCase() !== 'srcset') add([shift + value[0], shift + value[1]], image);
      else for (const c of tag[0].slice(value[0], value[1]).matchAll(SRCSET_URL)) add([shift + value[0] + c.indices![1][0], shift + value[0] + c.indices![1][1]], true);
    }
  }
  for (const m of masked.matchAll(BARE)) {
    const url = m[0].replace(/[.,;:!?*_~]+$/, '');
    const start = m.index!;
    if (!found.some((t) => start >= t.start && start < t.end)) found.push({ url, image: false, bare: true, start, end: start + url.length });
  }
  return found.sort((a, b) => a.start - b.start);
}

/** The text with every target replaced by what `fix` makes of it. */
function rewrite(text: string, fix: (target: Target) => string): string {
  let out = text;
  for (const t of scan(text).reverse()) out = out.slice(0, t.start) + fix(t) + out.slice(t.end);
  return out;
}

const SKIPPED = /^(#|mailto:|tel:|data:)/i;
const ABSOLUTE = /^[a-z][a-z0-9+.-]*:/i;
const BRANCH = /^(main|master|HEAD)$/;
const REPO_URL = `https?://(?:www\\.)?github\\.com/${REPO}`;
// A URL into this repository names its ref after blob/tree/raw, or as refs/heads/<branch> or refs/tags/<tag>.
const RAW_HOST = new RegExp(`^(https?://raw\\.githubusercontent\\.com/${REPO}/)(?:refs/(?:heads|tags)/)?([^/?#]+)(/.*)?$`, 'i');
const GITHUB_HOST = new RegExp(`^(${REPO_URL}/(?:blob|tree|raw)/)(?:refs/(?:heads|tags)/)?([^/?#]+)(/.*)?$`, 'i');
// The repository's page with an anchor, https://github.com/<repo>#settings, shows the README of the default branch.
const ROOT_ANCHOR = new RegExp(`^${REPO_URL}/?(?:\\?[^#]*)?(#.*)$`, 'i');

/**
 * What is wrong with a target that should be pinned to `tag`, or undefined when it is fine. A changelog
 * may link to the tags of its older versions (`anyTag`); a README names exactly the tag. A URL in the
 * text (`bare`) is only wrong when it names a branch.
 */
function problem({ url, bare }: Target, tag: string, anyTag: boolean): string | undefined {
  if (SKIPPED.test(url)) return undefined;
  if (!ABSOLUTE.test(url)) return 'a relative link (it resolves to the default branch)';
  const m = RAW_HOST.exec(url) ?? GITHUB_HOST.exec(url);
  if (m) return (bare ? BRANCH.test(m[2]) : m[2] !== tag && !(anyTag && /^v\d+\.\d+\.\d+/.test(m[2]))) ? `pinned to ${m[2]}, not ${tag}` : undefined;
  if (!bare && ROOT_ANCHOR.test(url)) return 'the repository page with an anchor (it shows the README of the default branch)';
  return undefined;
}

export interface Unpinned {
  url: string;
  why: string;
}

/** The links and images of `text`, outside its code, that point into this repository but not at `tag` (or, with `anyTag`, at no version's tag). */
export function findUnpinned(text: string, tag: string, anyTag = false): Unpinned[] {
  return scan(text).flatMap((t) => {
    const why = problem(t, tag, anyTag);
    return why ? [{ url: t.url, why }] : [];
  });
}

/** The images of `text` that are served from this repository at `tag`. */
export function pinnedImages(text: string, tag: string): string[] {
  return scan(text).filter((t) => t.image && (RAW_HOST.exec(t.url) ?? GITHUB_HOST.exec(t.url))?.[2] === tag).map((t) => t.url);
}

/**
 * Pins the README at `dir` (relative to the repository root: 'cli' for cli/README.md) to `tag`, outside
 * its code: relative targets become absolute ones in this repository at the tag, the ones that name a
 * branch (main, HEAD, also as refs/heads/main) name the tag, and the repository's page with an anchor
 * becomes the README at the tag with that anchor.
 */
export function pinReadme(text: string, dir: string, tag: string): string {
  return rewrite(text, ({ url, image, bare }) => {
    if (SKIPPED.test(url)) return url;
    const m = RAW_HOST.exec(url) ?? GITHUB_HOST.exec(url);
    if (m) return BRANCH.test(m[2]) ? `${m[1]}${tag}${m[3] ?? ''}` : url;
    if (ABSOLUTE.test(url)) {
      const root = bare ? null : ROOT_ANCHOR.exec(url);
      return root ? `https://github.com/${REPO}/blob/${tag}/README.md${root[1]}` : url;
    }
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
