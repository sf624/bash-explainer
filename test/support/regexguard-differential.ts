// The engine (src/examples/regexguard.ts) against JavaScript's own RegExp, which only tests run: on the table of
// test/fixtures/regexguard-patterns.json, then on seeded patterns and texts. A run the engine finds costly is not given to
// JavaScript, which would take as long. It runs in a process of its own (test/examples-regexguard.test.ts), since a
// mistake here can mean a run without end: `tsx regexguard-differential.ts <seed> <rounds>` prints, as JSON, what it found.
import * as fs from 'fs';
import * as path from 'path';
import { costOf, RegexRefused, scriptRegex } from '../../src/examples/regexguard';
import { Parser } from '../../src/examples/regexparse';

export const TABLE = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/regexguard-patterns.json'), 'utf8')) as { engine: string[]; engineTexts: string[] };

/** What real JavaScript has a run cost at most, in the engine's steps. */
const AFFORDABLE = 2e5;

/** All that a run gives, comparable. */
function shape(m: RegExpExecArray | RegExpMatchArray | null): unknown {
  if (!m) return null;
  const withIndices = m as RegExpExecArray & { indices?: unknown[] & { groups?: unknown } };
  return { all: [...m], index: m.index, input: m.input, groups: m.groups && { ...m.groups }, indices: withIndices.indices && [[...withIndices.indices], withIndices.indices.groups && { ...withIndices.indices.groups }] };
}

/** Each thing a regex is used for: what it gives, on a regex made anew. */
const USES: Record<string, (make: () => RegExp, text: string) => unknown> = {
  exec: (make, text) => { const re = make(); const at = text.length >> 1; re.lastIndex = at; const m = shape(re.exec(text)); return [m, re.lastIndex, shape(re.exec(text)), re.lastIndex]; },
  test: (make, text) => make().test(text),
  search: (make, text) => text.search(make()),
  match: (make, text) => { const m = text.match(make()); return make().global ? m : shape(m); },
  matchAll: (make, text) => { const re = make(); return re.global ? [...text.matchAll(re)].map(shape) : 'needs g'; },
  replace: (make, text) => text.replace(make(), '[$&|$1|$2|$`|$\'|$<n>|$$]'),
  'replace by a function': (make, text) => text.replace(make(), (...a) => JSON.stringify(a)),
  split: (make, text) => text.split(make()),
  'split, to a limit': (make, text) => text.split(make(), 2),
};

export const FLAGS = ['', 'i', 'm', 's', 'g', 'y', 'd', 'gi', 'gm', 'gy', 'gd', 'iy', 'is', 'im', 'ms', 'ims', 'gis', 'dgi'];

const gives = (use: (make: () => RegExp, text: string) => unknown, make: () => RegExp, text: string): string => {
  try {
    return JSON.stringify(use(make, text)) ?? 'undefined';
  } catch (e) {
    return e instanceof RegexRefused ? 'refused' : (e as Error).name;
  }
};

export interface Found { runs: number; refused: number; costly: number; wrong: string[]; invalid: number }

/** Compares the engine with JavaScript on a pattern, flags and a text. */
export function compare(source: string, flags: string, text: string, found: Found): void {
  let isValid = true;
  try {
    new RegExp(source, flags);
  } catch {
    isValid = false;
  }
  let made: RegExp | undefined;
  try {
    made = scriptRegex(source, flags);
  } catch (e) {
    if (e instanceof RegexRefused) {
      found.refused++;
      if (!isValid) found.wrong.push(`/${source}/${flags}: refused, and JavaScript says a syntax error`);
      return;
    }
    found.invalid++;
    if (isValid || !(e instanceof SyntaxError)) found.wrong.push(`/${source}/${flags}: ${(e as Error).name}, and JavaScript makes it`);
    return;
  }
  if (!isValid) {
    found.wrong.push(`/${source}/${flags}: made, and JavaScript says a syntax error`);
    return;
  }
  for (const [name, use] of Object.entries(USES)) {
    found.runs++;
    let ours = '';
    const cost = costOf(() => { ours = gives(use, () => scriptRegex(source, flags), text); });
    if (ours === 'refused' || cost > AFFORDABLE) {
      found.costly++;
      continue;
    }
    const real = gives(use, () => new RegExp(source, flags), text);
    // (A repeat of a huge count can be too big for JavaScript to compile. Nothing to compare.)
    if (real === 'RangeError') {
      found.costly++;
      continue;
    }
    if (real !== ours) found.wrong.push(`${name} /${source}/${flags} on ${JSON.stringify(text)}: ${ours}, and JavaScript ${real}`);
  }
}

/** The numbers of a seed (mulberry32). */
function randomOf(seed: number): (n: number) => number {
  let a = seed >>> 0;
  return (n) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

const UNITS = ['a', 'a', 'a', 'b', 'b', 'A', 'B', 'k', 'K', 'x', '-', '_', ' ', ',', '1', '\n', ' ', 'σ', 'ς', 'Σ', 'ſ', 's', 'S', 'ß', 'ı', 'I', 'i', 'İ', 'é', 'É', 'ÿ', 'Ÿ', 'µ', 'μ', 'Μ', 'K', 'あ', 'ア', '\ud83d', '\ude00', '{', '}', '\\'];
const ATOMS = ['a', 'a', 'b', 'A', 'k', 'K', 'σ', 'Σ', 'ς', 'ß', 'ſ', 'ı', 'µ', 'あ', ',', ' ', '-', '.', '\\.', '\\w', '\\W', '\\d', '\\D', '\\s', '\\S', '\\b', '\\B', '^', '$', '\\n', '\\t', '\\x61', '\\u0061', '\\x4', '\\u12', '\\cA', '\\c!', '\\c', '\\0', '\\07', '\\377', '\\400', '\\8', '\\9', '\\1', '\\2', '\\3', '\\12', '\\18', '\\k', '\\k<n>', '\\k<m>', '\\k<n', '\\k<', '\\p', '\\/', '\\-', '\\{', '\\}', '{', '}', ']', '\\\\', '\\\\{}', '\\\\{,1}', '{}', '{,1}', '{1', 'a{', '[ab]', '[^a]', '[a-c]', '[^a-c]', '[A-C]', '[σ]', '[Σ]', '[^ς]', '[\\w]', '[\\W]', '[\\d-x]', '[a-\\d]', '[\\b]', '[\\c1]', '[\\c_]', '[\\cA]', '[\\c]', '[\\c!]', '[\\0]', '[\\12]', '[\\377]', '[\\8]', '[\\x61]', '[\\u0061]', '[\\x4]', '[\\k]', '[a-]', '[-a]', '[--a]', '[]', '[^]', '[\\]]', '[\\\\]', '[.]', '[(]', '[)', '[z-a]'];
const OPENS = ['(', '(', '(?:', '(?:', '(?=', '(?!', '(?<=', '(?<!', '(?<n>', '(?<m>'];
const REPEATS = ['*', '+', '?', '*?', '+?', '??', '{2}', '{0}', '{1,2}', '{0,}', '{2,}', '{1,2}?', '{0,1}?', '{2,1}', '{99999999999}', '**'];

/** A pattern of the seed's numbers. */
function patternOf(random: (n: number) => number, depth: number): string {
  let out = '';
  for (let items = random(4); items >= 0; items--) {
    let atom = depth > 0 && random(3) === 0 ? `${OPENS[random(OPENS.length)]}${patternOf(random, depth - 1)})` : ATOMS[random(ATOMS.length)];
    if (random(3) === 0) atom += REPEATS[random(REPEATS.length)];
    out += atom;
    if (random(9) === 0) out += '|';
  }
  return out;
}

function textOf(random: (n: number) => number): string {
  let out = '';
  for (let n = random(11); n > 0; n--) out += UNITS[random(UNITS.length)];
  return out;
}

if (require.main === module) {
  const [seed, rounds] = process.argv.slice(2).map(Number);
  const found: Found = { runs: 0, refused: 0, costly: 0, wrong: [], invalid: 0 };
  for (const source of TABLE.engine) for (const text of TABLE.engineTexts) for (const flags of ['', 'i', 'g', 'y', 'dgi', 'm', 's']) compare(source, flags, text, found);
  const random = randomOf(seed);
  for (let k = 0; k < rounds && found.wrong.length < 30; k++) {
    const source = patternOf(random, 3);
    for (let t = 0; t < 3; t++) compare(source, FLAGS[random(FLAGS.length)], textOf(random), found);
    // (The parser ends on any text: what `new RegExp` refuses it does not read in the product, but a loop there would not end.)
    new Parser(textOf(random) + source + OPENS[random(OPENS.length)]).alt();
  }
  process.stdout.write(JSON.stringify(found));
}
