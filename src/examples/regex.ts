import { sedEscapeAt } from '../ctlchars';
import type { Flavor } from '../embedded/regex';
import { wordTable } from '../wordtable';
import { type Node, Parser } from './regexparse';
import { longestExec, RegexRefused, scriptRegex } from './regexguard';

/** A POSIX or PCRE pattern translated to a JavaScript RegExp. */
export interface JsRegex {
  source: string;
  flags: string;
}

const CLASS_TO_JS: Record<string, string> = wordTable({
  digit: '0-9', alpha: 'A-Za-z', alnum: 'A-Za-z0-9', upper: 'A-Z', lower: 'a-z', space: '\\s', blank: ' \\t',
  xdigit: '0-9A-Fa-f', punct: '!-\\/:-@\\[-`{-~', word: 'A-Za-z0-9_', cntrl: '\\x00-\\x1f', print: ' -~', graph: '!-~',
});

const SED_ESCAPES: Record<string, string> = { t: '\\t', n: '\\n', r: '\\r', f: '\\f', v: '\\v', a: '\\x07' };

/** Copy a POSIX bracket expression starting at `i` as a JS character class; returns [class, end]. */
function posixBracket(src: string, i: number, sedEscapes: boolean): [string, number] | undefined {
  let j = i + 1;
  let out = '[';
  if (src[j] === '^') { out += '^'; j++; }
  let first = true;
  while (j < src.length && (src[j] !== ']' || first)) {
    first = false;
    const cls = /^\[:(\w+):\]/.exec(src.slice(j));
    if (cls) {
      if (!CLASS_TO_JS[cls[1]]) return undefined;
      out += CLASS_TO_JS[cls[1]];
      j += cls[0].length;
      continue;
    }
    if (/^\[[.=]/.test(src.slice(j))) return undefined;
    const c = src[j];
    if (sedEscapes && c === '\\' && SED_ESCAPES[src[j + 1]]) {
      out += SED_ESCAPES[src[j + 1]];
      j += 2;
      continue;
    }
    // In POSIX brackets a backslash is literal.
    out += c === '\\' || c === ']' || c === '[' ? `\\${c}` : c;
    j++;
  }
  if (j >= src.length) return undefined;
  return [out + ']', j + 1];
}

/**
 * GNU sed turns `\xHH`, `\oNNN`, `\dNNN` and `\cX` into the character before it compiles the
 * regex. When that character is special in a regex, what it means differs between sed releases
 * (a literal in some, an operator in 4.9), so no example is made (undefined).
 */
function sedCharacters(src: string): string | undefined {
  let out = '';
  for (let i = 0; i < src.length;) {
    const e = src[i] === '\\' && /[xodc]/.test(src[i + 1] ?? '') ? sedEscapeAt(src, i) : undefined;
    if (!e) {
      out += src[i] === '\\' ? src.slice(i, i + 2) : src[i];
      i += src[i] === '\\' ? 2 : 1;
      continue;
    }
    const ch = String.fromCharCode(e.code);
    if ('\\^$.*+?()[]{}|'.includes(ch)) return undefined;
    out += ch;
    i += e.length;
  }
  return out;
}

/**
 * Translate a regex to JavaScript syntax. Returns undefined for constructs JavaScript cannot
 * express (possessive quantifiers, atomic groups, equivalence classes…), so no example is made.
 */
export function toJsRegex(src: string, flavor: Flavor, opts: { ignoreCase?: boolean; sedEscapes?: boolean } = {}): JsRegex | undefined {
  if (opts.sedEscapes) {
    const plain = sedCharacters(src);
    if (plain === undefined) return undefined;
    src = plain;
  }
  let flags = opts.ignoreCase ? 'i' : '';
  let out = '';
  let i = 0;
  const atStart = () => out === '' || out.endsWith('(') || out.endsWith('|') || out === '^';
  // POSIX lets quantifiers stack (`a+?` is `(a+)?`, `a**` is `(a*)*`); JavaScript reads `+?` as lazy or fails.
  // So the last atom's start is tracked, and an atom that is already repeated is wrapped before it is repeated again.
  let atomStart = -1;
  let repeated = false;
  const groups: number[] = [];
  const atom = (t: string) => { atomStart = out.length; repeated = false; out += t; };
  const quantifier = (q: string) => {
    if (repeated) out = `${out.slice(0, atomStart)}(?:${out.slice(atomStart)})`;
    out += q;
    repeated = true;
  };
  const open = () => { groups.push(out.length); out += '('; atomStart = -1; repeated = false; };
  const close = () => { atomStart = groups.pop() ?? -1; repeated = false; out += ')'; };
  const branch = () => { out += '|'; atomStart = -1; repeated = false; };
  if (flavor === 'pcre') {
    const inline = /^\(\?([imsx]+)\)/.exec(src);
    if (inline) {
      if (inline[1].includes('i')) flags += 'i';
      if (inline[1].includes('s')) flags += 's';
      i = inline[0].length;
    }
    if (/\(\?>|[*+?}][+]|\\Q|\(\?[imsx-]+\)|\\[pPXRK]/.test(src.slice(i))) return undefined;
  }
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (flavor === 'pcre') {
      if (c === '\\' && n === 'A') { out += '^'; i += 2; continue; }
      if (c === '\\' && (n === 'z' || n === 'Z')) { out += '$'; i += 2; continue; }
      if (c === '\\' && n === 'h') { out += '[ \\t]'; i += 2; continue; }
      if (src.startsWith('(?P<', i)) { out += '(?<'; i += 4; continue; }
      // `]` first in a class is literal in Perl, but would close an empty class in JavaScript.
      if (c === '[') {
        const m = /^\[\^?\]/.exec(src.slice(i));
        if (m) { out += m[0].slice(0, -1) + '\\]'; i += m[0].length; continue; }
      }
      if (c === '\\' && n !== undefined) { out += c + n; i += 2; continue; }
      out += c;
      i++;
      continue;
    }
    if (c === '[') {
      const b = posixBracket(src, i, !!opts.sedEscapes);
      if (!b) return undefined;
      atom(b[0]);
      i = b[1];
      continue;
    }
    if (c === '\\') {
      if (n === undefined) return undefined;
      i += 2;
      if (/[1-9]/.test(n)) { atom('\\' + n); continue; }
      if (n === '<' || n === '>') { atom('\\b'); continue; }
      if ('wWsSbB'.includes(n)) { atom('\\' + n); continue; }
      if (opts.sedEscapes && SED_ESCAPES[n]) { atom(SED_ESCAPES[n]); continue; }
      if (flavor === 'bre' && n === '{') {
        // `\{n,m\}`; GNU says "Unmatched \{" for anything else.
        const m = /^(\d*)(,?)(\d*)\\\}/.exec(src.slice(i));
        if (!m || (!m[1] && !m[3])) return undefined;
        quantifier(`{${m[1] || '0'}${m[2]}${m[3]}}`);
        i += m[0].length;
        continue;
      }
      if (flavor === 'bre' && (n === '+' || n === '?')) { quantifier(n); continue; }
      if (flavor === 'bre' && n === '(') { open(); continue; }
      if (flavor === 'bre' && n === ')') { close(); continue; }
      if (flavor === 'bre' && n === '|') { branch(); continue; }
      if (flavor === 'bre' && n === '}') return undefined;
      if (n === '`' || n === "'") return undefined;
      // Anything else escaped is that character itself.
      atom(/[\\^$.*+?()[\]{}|/-]/.test(n) ? '\\' + n : n);
      continue;
    }
    if (flavor === 'bre') {
      if ('+?(){}|'.includes(c)) { atom('\\' + c); i++; continue; }
      if (c === '*' && atStart()) { atom('\\*'); i++; continue; }
      if (c === '*') { quantifier('*'); i++; continue; }
      if (c === '^' && out !== '' && !out.endsWith('(') && !out.endsWith('|')) { atom('\\^'); i++; continue; }
      if (c === '$' && i < src.length - 1 && !src.startsWith('\\)', i + 1) && !src.startsWith('\\|', i + 1)) { atom('\\$'); i++; continue; }
    } else if (c === '(') {
      open();
      i++;
      continue;
    } else if (c === ')') {
      close();
      i++;
      continue;
    } else if (c === '|') {
      branch();
      i++;
      continue;
    } else if (c === '*' || c === '+' || c === '?') {
      // A quantifier with nothing before it: GNU grep ignores it (with a warning), sed -E rejects it.
      if (atStart()) return undefined;
      quantifier(c);
      i++;
      continue;
    } else if (c === '{') {
      const m = /^\{(\d*)(,?)(\d*)\}/.exec(src.slice(i));
      if (m && (m[1] || m[3])) {
        quantifier(`{${m[1] || '0'}${m[2]}${m[3]}}`);
        i += m[0].length;
        continue;
      }
      atom('\\{');
      i++;
      continue;
    }
    atom(c === '/' ? '\\/' : c);
    i++;
  }
  try {
    new RegExp(out, flags);
  } catch {
    return undefined;
  }
  return { source: out, flags };
}

/** Generate a string for `node`. `v` varies the choices so different variants give different strings. */
function gen(node: Node, v: number, caps: string[], left: { steps: number }): string | undefined {
  // (Like a run on a text, what it makes of `(){2000000000}` or `(ab{1000}){1000}` may take too long.)
  if (--left.steps < 0) throw new RegexRefused();
  switch (node.t) {
    case 'anchor': return '';
    case 'char': return node.c;
    case 'set': return node.pick(v);
    case 'backref': return caps[node.n] ?? '';
    case 'alt': return gen(node.options[v % node.options.length], Math.floor(v / node.options.length), caps, left);
    case 'seq': {
      let out = '';
      for (let k = 0; k < node.items.length; k++) {
        const part = gen(node.items[k], v, caps, left);
        if (part === undefined) return undefined;
        out += part;
      }
      return out;
    }
    case 'group': {
      // Negative lookarounds add nothing; positive ones contribute their text to the line.
      if (node.look === '!' || node.look === '<!') return '';
      const text = gen(node.node, v, caps, left);
      if (text === undefined) return undefined;
      if (node.no) caps[node.no] = text;
      return text;
    }
    case 'repeat': {
      const { min, max } = node;
      const choices = [Math.max(min, 1), min, Math.min(max, min + 2)].map((n) => Math.min(n, max, min + 3));
      const count = choices[v % choices.length];
      let out = '';
      for (let k = 0; k < count; k++) {
        const part = gen(node.node, v + k, caps, left);
        if (part === undefined) return undefined;
        out += part;
      }
      return out;
    }
  }
}

export interface RegexExamples {
  matching: string[];
  nonMatching: string[];
}

/** Example lines that match (and nearby ones that do not), verified against the pattern itself. */
export function regexExamples(js: JsRegex, max = 3): RegexExamples | undefined {
  const re = scriptRegex(js.source, js.flags);
  // Parser reads every regex JavaScript accepts, to the end, and throws nothing of its own: an error from it is a
  // bug, which shows.
  const p = new Parser(js.source);
  const tree = p.alt();
  // A guard: it reads to the end.
  /* c8 ignore next */
  if (p.i < js.source.length) return undefined;
  // (Whether it repeats depends on the release of the tool: no lines to show.)
  if (p.openBrace) return undefined;
  const matching: string[] = [];
  const left = { steps: 100000 };
  for (let v = 0; v < 12 && matching.length < max; v++) {
    const text = gen(tree, v, [], left);
    if (text === undefined || text === '' || /[\n\r]/.test(text) || matching.includes(text)) continue;
    if (re.test(text)) matching.push(text);
  }
  if (!matching.length) return undefined;
  const base = matching[0];
  // Unless the pattern is anchored, a match can be just part of a line; show that once.
  const inLine = `${js.source.startsWith('^') ? '' : 'abc '}${base}${js.source.endsWith('$') && !js.source.endsWith('\\$') ? '' : ' xyz'}`;
  if (inLine !== base && re.test(inLine)) {
    if (matching.length >= max) matching.pop();
    matching.push(inLine);
  }
  const mutations = [
    base.slice(0, -1), base.slice(1), base.replace(/\d/, 'x'), base.replace(/[A-Za-z]/, '1'),
    js.flags.includes('i') ? '' : swapCase(base), base.replace(/[^A-Za-z0-9]/, ''), base + base.slice(-1), 'x' + base,
  ];
  const nonMatching = [...new Set(mutations)].filter((m) => m !== '' && !re.test(m)).slice(0, 2);
  return { matching, nonMatching };
}

/** A JavaScript regex for a fixed string (grep -F). */
export function literalRegex(text: string, ignoreCase: boolean): JsRegex {
  return { source: text.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&'), flags: ignoreCase ? 'i' : '' };
}

/** Apply grep's -x (whole line) and -w (whole word) to a pattern. */
export function grepWrap(js: JsRegex, wholeLine: boolean, wholeWord: boolean): JsRegex {
  if (wholeLine) return { ...js, source: `^(?:${js.source})$` };
  if (wholeWord) return { ...js, source: `(?<![A-Za-z0-9_])(?:${js.source})(?![A-Za-z0-9_])` };
  return js;
}

/**
 * The matches of the regexes on `line` one after another, as a POSIX tool finds them (grep's `-o`, sed's `s///g`): at
 * each place, the leftmost match of any of them and, of those that start there, the longest (`longest`; PCRE's is the
 * first its alternatives give, as JavaScript's), then again from its end; an empty match just after the one before is
 * not one (GNU sed), and after an empty match the search goes on one character further. `[start, end)` each.
 */
export function posixMatches(res: JsRegex[], line: string, longest: boolean): [number, number][] {
  const out: [number, number][] = [];
  let at = 0;
  let prevEnd = -1;
  while (at <= line.length) {
    let start = Infinity;
    let end = -1;
    for (const r of res) {
      const m = longest ? posixExec(r, line, at) : firstExec(r, line, at);
      if (m && (m.index < start || (m.index === start && m.index + m[0].length > end))) [start, end] = [m.index, m.index + m[0].length];
    }
    if (end < 0) break;
    if (start === end && start === prevEnd) { at = start + 1; continue; }
    out.push([start, end]);
    prevEnd = end;
    at = end > start ? end : start + 1;
  }
  return out;
}

/** JavaScript's match of `r` from `at` on. */
function firstExec(r: JsRegex, line: string, at: number): RegExpExecArray | null {
  const g = scriptRegex(r.source, r.flags + 'g');
  g.lastIndex = at;
  return g.exec(line);
}

/**
 * The match of `r` that a POSIX tool finds from `at` on: the leftmost and, of those there, the longest (JavaScript's is
 * the first its alternatives give: `a\|ab` takes `a` of `ab`), with its groups; null when there is none.
 */
export function posixExec(r: JsRegex, line: string, at: number): RegExpExecArray | null {
  return longestExec(r.source, r.flags, line, at);
}

function swapCase(s: string): string {
  return s.replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
}
