import { sedEscapeAt } from '../ctlchars';
import { JsRegex, regexExamples, toJsRegex } from './regex';
import { Unsupported as RunnerUnsupported } from './unsupported';

type Addr =
  | { kind: 'line'; n: number }
  | { kind: 'last' }
  | { kind: 're'; re: JsRegex | undefined }
  | { kind: 'step'; first: number; step: number };

type End = Addr | { kind: 'plus'; n: number };

interface Cmd {
  a1?: Addr;
  a2?: End;
  neg: boolean;
  name: string;
  /** s: pattern (undefined = reuse the last regex), replacement and flags. */
  re?: JsRegex;
  rep?: string;
  global?: boolean;
  nth?: number;
  print?: boolean;
  text?: string;
  from?: string;
  to?: string;
  block?: Cmd[];
  /** Range state while running. */
  active?: boolean;
  endLine?: number;
}

class Unsupported extends RunnerUnsupported {}

/** Parse the subset of sed that the example runner can execute; throws Unsupported otherwise. */
class Parser {
  i = 0;
  /** Patterns in the script, for generating input lines. */
  patterns: { re: JsRegex; kind: 'address' | 's' }[] = [];

  constructor(private src: string, private flavor: 'bre' | 'ere') {}

  script(close = false): Cmd[] {
    const out: Cmd[] = [];
    for (;;) {
      while (/[\s;]/.test(this.src[this.i] ?? '')) this.i++;
      if (this.i >= this.src.length) {
        if (close) throw new Unsupported();
        return out;
      }
      if (this.src[this.i] === '}') {
        if (!close) throw new Unsupported();
        this.i++;
        return out;
      }
      if (this.src[this.i] === '#') {
        while (this.i < this.src.length && this.src[this.i] !== '\n') this.i++;
        continue;
      }
      out.push(this.command());
    }
  }

  private regex(delim: string, kind: 'address' | 's', ignoreCase = false): JsRegex | undefined {
    const start = this.i;
    while (this.i < this.src.length && this.src[this.i] !== delim) {
      if (this.src[this.i] === '\n') throw new Unsupported();
      this.i += this.src[this.i] === '\\' ? 2 : 1;
    }
    if (this.i >= this.src.length) throw new Unsupported();
    let body = this.src.slice(start, this.i++);
    if (delim !== '/') body = body.split('\\' + delim).join(delim);
    if (body === '') return undefined;
    const re = toJsRegex(body, this.flavor, { sedEscapes: true, ignoreCase });
    if (!re) throw new Unsupported();
    this.patterns.push({ re, kind });
    return re;
  }

  private address(): Addr | undefined {
    const rest = this.src.slice(this.i);
    let m: RegExpExecArray | null;
    if ((m = /^(\d+)~(\d+)/.exec(rest))) { this.i += m[0].length; return { kind: 'step', first: Number(m[1]), step: Number(m[2]) }; }
    if ((m = /^\d+/.exec(rest))) { this.i += m[0].length; return { kind: 'line', n: Number(m[0]) }; }
    if (rest[0] === '$') { this.i++; return { kind: 'last' }; }
    if (rest[0] === '/' || rest[0] === '\\') {
      const delim = rest[0] === '/' ? '/' : rest[1];
      this.i += rest[0] === '/' ? 1 : 2;
      const save = this.i;
      // Empty (`//`): the last regex used, when the line is run.
      const re = this.regex(delim, 'address');
      const ignoreCase = this.src[this.i] === 'I';
      if (ignoreCase) {
        // Redo with the case-insensitive flag.
        this.patterns.pop();
        this.i = save;
        const re = this.regex(delim, 'address', true);
        this.i++;
        return { kind: 're', re };
      }
      if (this.src[this.i] === 'M') throw new Unsupported();
      return { kind: 're', re };
    }
    return undefined;
  }

  private command(): Cmd {
    const cmd: Cmd = { neg: false, name: '' };
    cmd.a1 = this.address();
    if (cmd.a1 && this.src[this.i] === ',') {
      this.i++;
      const m = /^\+(\d+)/.exec(this.src.slice(this.i));
      if (m) { this.i += m[0].length; cmd.a2 = { kind: 'plus', n: Number(m[1]) }; }
      else {
        cmd.a2 = this.address();
        if (!cmd.a2) throw new Unsupported();
      }
      // GNU sed: line 0 is only valid with a regex as the end ("invalid usage of line address 0").
      if (cmd.a1.kind === 'line' && cmd.a1.n === 0 && cmd.a2.kind !== 're') throw new Unsupported();
    } else if (cmd.a1?.kind === 'line' && cmd.a1.n === 0) {
      throw new Unsupported();
    }
    while (this.src[this.i] === ' ') this.i++;
    if (this.src[this.i] === '!') { cmd.neg = true; this.i++; }
    while (this.src[this.i] === ' ') this.i++;
    const c = this.src[this.i++];
    cmd.name = c;
    switch (c) {
      case 's': {
        const delim = this.src[this.i++];
        const patStart = this.i;
        cmd.re = this.regex(delim, 's');
        const repStart = this.i;
        while (this.i < this.src.length && this.src[this.i] !== delim) {
          if (this.src[this.i] === '\n') throw new Unsupported();
          this.i += this.src[this.i] === '\\' ? 2 : 1;
        }
        if (this.i >= this.src.length) throw new Unsupported();
        cmd.rep = this.src.slice(repStart, this.i++);
        let flags = '';
        while (/[gpIi0-9]/.test(this.src[this.i] ?? '')) flags += this.src[this.i++];
        if (/[wWmMe]/.test(this.src[this.i] ?? '')) throw new Unsupported();
        cmd.global = flags.includes('g');
        cmd.print = flags.includes('p');
        const n = /\d+/.exec(flags);
        if (n) cmd.nth = Number(n[0]);
        if (/[iI]/.test(flags)) {
          // Re-translate the pattern case-insensitively.
          const end = this.i;
          this.i = patStart;
          this.patterns.pop();
          cmd.re = this.regex(delim, 's', true);
          this.i = end;
        }
        cmd.rep = delim === '/' ? cmd.rep : cmd.rep.split('\\' + delim).join(delim);
        // GNU sed rejects a reference to a group the pattern does not have.
        const groups = cmd.re ? new RegExp(`${cmd.re.source}|`).exec('')!.length - 1 : 9;
        if ([...cmd.rep.matchAll(/\\(.)/g)].some(([, d]) => /[1-9]/.test(d) && Number(d) > groups)) throw new Unsupported();
        void repStart;
        return cmd;
      }
      case 'y': {
        const delim = this.src[this.i++];
        const read = () => {
          const start = this.i;
          while (this.i < this.src.length && this.src[this.i] !== delim) this.i += this.src[this.i] === '\\' ? 2 : 1;
          if (this.i >= this.src.length) throw new Unsupported();
          return unescape(this.src.slice(start, this.i++));
        };
        cmd.from = read();
        cmd.to = read();
        if ([...cmd.from].length !== [...cmd.to].length) throw new Unsupported();
        return cmd;
      }
      case 'a': case 'i': case 'c': {
        if (this.src[this.i] === '\\') this.i++;
        if (this.src[this.i] === '\n') this.i++;
        while (this.src[this.i] === ' ') this.i++;
        const start = this.i;
        while (this.i < this.src.length && this.src[this.i] !== '\n') this.i++;
        cmd.text = this.src.slice(start, this.i);
        return cmd;
      }
      case 'q': case 'Q': {
        const m = /^\s*\d+/.exec(this.src.slice(this.i));
        if (m) this.i += m[0].length;
        return cmd;
      }
      case '{':
        cmd.block = this.script(true);
        return cmd;
      case 'd': case 'p': case '=':
        return cmd;
      default:
        throw new Unsupported();
    }
  }
}

function unescape(s: string): string {
  // `\/` (the delimiter) and other escaped characters stand for themselves.
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\' || i + 1 >= s.length) { out += s[i]; continue; }
    const e = sedEscapeAt(s, i);
    if (e) { out += String.fromCharCode(e.code); i += e.length - 1; continue; }
    out += s[++i];
  }
  return out;
}

/** Build the replacement for one match, handling &, \1…\9, \n and GNU case conversion (\U \L \u \l \E). */
function replacement(rep: string, m: RegExpExecArray): string {
  let out = '';
  let mode: 'U' | 'L' | '' = '';
  let once: 'u' | 'l' | '' = '';
  const add = (s: string) => {
    for (const ch of s) {
      let c = mode === 'U' ? ch.toUpperCase() : mode === 'L' ? ch.toLowerCase() : ch;
      if (once) {
        c = once === 'u' ? c.toUpperCase() : c.toLowerCase();
        once = '';
      }
      out += c;
    }
  };
  for (let i = 0; i < rep.length; i++) {
    const c = rep[i];
    if (c === '&') { add(m[0]); continue; }
    if (c !== '\\' || i + 1 >= rep.length) { add(c); continue; }
    const e = sedEscapeAt(rep, i);
    const n = rep[++i];
    if (/[0-9]/.test(n)) add(m[Number(n)] ?? '');
    else if (e) { add(String.fromCharCode(e.code)); i += e.length - 2; }
    // A case conversion cancels a pending \u or \l, as in GNU sed (`\u\L&` is all lower case).
    else if (n === 'U' || n === 'L') { mode = n; once = ''; }
    else if (n === 'E') { mode = ''; once = ''; }
    else if (n === 'u' || n === 'l') once = n;
    else add(n);
  }
  return out;
}

interface RunState {
  out: string[];
  quit: boolean;
  printQuit: boolean;
  lastRe?: JsRegex;
}

function matches(a: Addr, line: string, no: number, last: boolean, st: RunState): boolean {
  switch (a.kind) {
    case 'line': return no === a.n;
    case 'last': return last;
    case 'step': return a.step === 0 ? no === a.first : no >= a.first && (no - a.first) % a.step === 0;
    case 're': {
      const re = a.re ?? st.lastRe;
      // GNU sed stops: "no previous regular expression".
      if (!re) throw new Unsupported();
      st.lastRe = re;
      return new RegExp(re.source, re.flags).test(line);
    }
  }
}

function selected(cmd: Cmd, line: string, no: number, last: boolean, st: RunState): boolean {
  let hit: boolean;
  if (!cmd.a1) hit = true;
  else if (!cmd.a2) hit = matches(cmd.a1, line, no, last, st);
  else if (cmd.active) {
    hit = true;
    const end = cmd.a2;
    if (end.kind === 'plus') { if (no >= cmd.endLine!) cmd.active = false; }
    else if (end.kind === 'line') { if (no >= end.n) cmd.active = false; }
    else if (matches(end, line, no, last, st)) cmd.active = false;
  } else if (cmd.a1.kind === 'line' && cmd.a1.n === 0) {
    // `0,/re/`: the range starts before line 1, so the regex may end it on line 1.
    hit = no === 1;
    if (hit) cmd.active = !matches(cmd.a2 as Addr, line, no, last, st); // (the parser allows only a regex here)
  } else if (matches(cmd.a1, line, no, last, st)) {
    hit = true;
    const end = cmd.a2;
    if (end.kind === 'plus') {
      cmd.endLine = no + end.n;
      cmd.active = end.n > 0;
    } else if (end.kind === 'line') {
      cmd.active = end.n > no;
    } else {
      cmd.active = true; // a regex end is only checked from the next line
    }
  } else hit = false;
  return cmd.neg ? !hit : hit;
}

/** Run commands on one line; returns the (possibly changed) pattern space, or undefined if deleted. */
function exec(cmds: Cmd[], ps: string, no: number, last: boolean, st: RunState, after: string[], quiet: boolean): string | undefined {
  for (const cmd of cmds) {
    if (st.quit) return ps;
    if (!selected(cmd, ps, no, last, st)) continue;
    switch (cmd.name) {
      case 'd': return undefined;
      case 'p': st.out.push(ps); break;
      case '=': st.out.push(String(no)); break;
      case 'i': st.out.push(cmd.text!); break;
      case 'a': after.push(cmd.text!); break;
      case 'c':
        if (!cmd.a2 || !cmd.active) st.out.push(cmd.text!);
        return undefined;
      case 'q':
        st.quit = true;
        st.printQuit = !quiet;
        return ps;
      case 'Q':
        st.quit = true;
        st.printQuit = false;
        return ps;
      case 'y': {
        const from = [...cmd.from!];
        const to = [...cmd.to!];
        ps = [...ps].map((ch) => (from.includes(ch) ? to[from.indexOf(ch)] : ch)).join('');
        break;
      }
      case 's': {
        const re = cmd.re ?? st.lastRe;
        if (!re) throw new Unsupported();
        st.lastRe = re;
        const g = new RegExp(re.source, re.flags + 'g');
        let count = 0;
        let changed = false;
        let out = '';
        let pos = 0; // start of the text not yet copied
        let at = 0; // where to search next
        let prevEnd = -1; // end of the previous match
        for (;;) {
          g.lastIndex = at;
          const m = g.exec(ps);
          if (!m) break;
          const end = m.index + m[0].length;
          // GNU sed: an empty match right after the previous match is not a match.
          if (m[0] === '' && m.index === prevEnd) {
            if (m.index >= ps.length) break;
            at = m.index + String.fromCodePoint(ps.codePointAt(m.index)!).length;
            continue;
          }
          count++;
          const take = cmd.nth ? (cmd.global ? count >= cmd.nth : count === cmd.nth) : cmd.global || count === 1;
          if (take) {
            changed = true;
            out += ps.slice(pos, m.index) + replacement(cmd.rep!, m);
            pos = end;
          }
          if (!cmd.global && take) break;
          prevEnd = end;
          if (m[0] === '') {
            if (m.index >= ps.length) break;
            at = m.index + String.fromCodePoint(ps.codePointAt(m.index)!).length;
          } else at = end;
        }
        ps = out + ps.slice(pos);
        if (changed && cmd.print) st.out.push(ps);
        break;
      }
      case '{': {
        const r = exec(cmd.block!, ps, no, last, st, after, quiet);
        if (r === undefined) return undefined;
        ps = r;
        break;
      }
    }
  }
  return ps;
}

/** Run a script over input lines, as `sed [-n] [-E]` would. Undefined if the script uses unsupported features. */
export function runSed(script: string, input: string[], given: { quiet: boolean; extended: boolean }): string[] | undefined {
  // (A script whose first two characters are `#n` runs as with `-n`: GNU sed 4.9, as POSIX says.)
  const opts = { ...given, quiet: given.quiet || script.startsWith('#n') };
  const st: RunState = { out: [], quit: false, printQuit: false };
  try {
    const cmds = new Parser(script, opts.extended ? 'ere' : 'bre').script();
    input.forEach((line, k) => {
      if (st.quit) return;
      const after: string[] = [];
      const ps = exec(cmds, line, k + 1, k === input.length - 1, st, after, opts.quiet);
      if (ps !== undefined && (!opts.quiet && !st.quit || st.printQuit)) st.out.push(ps);
      st.out.push(...after);
    });
  } catch (e) {
    if (e instanceof Unsupported) return undefined;
    // A bug in the runner: let it show.
    /* c8 ignore next */
    throw e;
  }
  return st.out.flatMap((l) => l.split('\n'));
}

export interface SedExample {
  input: string[];
  output: string[];
}

/** Make up input lines that exercise the script and show what sed prints for them. */
export function sedExample(script: string, opts: { quiet: boolean; extended: boolean }): SedExample | undefined {
  let parser: Parser;
  let cmds: Cmd[];
  try {
    parser = new Parser(script, opts.extended ? 'ere' : 'bre');
    cmds = parser.script();
  } catch (e) {
    if (e instanceof Unsupported) return undefined;
    // A bug in the parser: let it show.
    /* c8 ignore next */
    throw e;
  }
  const res = parser.patterns.map((p) => ({ ...p, rx: new RegExp(p.re.source, p.re.flags) }));
  // A pattern that matches the empty string (`^[ \t]*`) matches every line, so it cannot rule lines out.
  const plain = (s: string) => !res.some((p) => !p.rx.test('') && p.rx.test(s));
  const neutral = (k: number) => [`line ${k}`, `text ${k}`, `data ${k}`, `note ${k}`].find(plain) ?? `${k}`;
  const lines: string[] = [];
  let sLine: string | undefined;
  for (const p of res) {
    const ex = regexExamples(p.re, 3);
    if (!ex) continue;
    const m = ex.matching[0];
    const src = p.re.source;
    const atStart = src.startsWith('^');
    const atEnd = src.endsWith('$') && !src.endsWith('\\$');
    let line = m;
    if (p.kind === 's') {
      // Two matches on one line show what g (or a number) changes; anchored patterns get text around them.
      const second = ex.matching.find((x) => x !== m && !/^abc |\sxyz$/.test(x)) ?? m;
      line = !atStart && !atEnd ? `${m} ${second}` : atStart && !atEnd ? `${m}text` : !atStart ? `text${m}` : m;
      sLine ??= line;
    }
    if (!lines.includes(line)) lines.push(line);
  }
  // y needs its characters in the input.
  for (const c of walk(cmds)) if (c.name === 'y' && c.from) lines.push(`${c.from} ${c.from}`);
  const maxLine = Math.max(0, ...collectLines(cmds));
  if (maxLine > 8) return undefined;
  const hasAddress = walk(cmds).some((c) => c.a1);
  const numericOnly = hasAddress && walk(cmds).every((c) => (!c.a1 || c.a1.kind !== 're') && (!c.a2 || c.a2.kind !== 're'));
  const input: string[] = [];
  let k = 1;
  if (numericOnly && sLine) {
    // With line-number addresses, every line holds a match, so it is visible which ones change.
    const n = Math.max(maxLine + 1, 3);
    for (let j = 1; j <= n; j++) input.push(`${sLine} ${j}`);
  } else {
    // Regex addresses read best among ordinary lines.
    if (hasAddress) input.push(neutral(k++));
    for (const l of lines) {
      input.push(l);
      if (hasAddress) input.push(neutral(k++));
    }
    if (!lines.length) input.push(neutral(k++), neutral(k++));
    while (input.length < Math.max(maxLine + 1, hasAddress ? 3 : 1)) input.push(neutral(k++));
  }
  if (input.length > 8) return undefined;
  const output = runSed(script, input, opts);
  return output && { input, output };
}

/** Every command, including those inside { } blocks. */
function walk(cmds: Cmd[]): Cmd[] {
  return cmds.flatMap((c) => [c, ...(c.block ? walk(c.block) : [])]);
}

function collectLines(cmds: Cmd[]): number[] {
  return cmds.flatMap((c) => [
    ...(c.a1?.kind === 'line' ? [c.a1.n] : c.a1?.kind === 'step' ? [c.a1.first + (c.a1.step || 0)] : []),
    ...(c.a2?.kind === 'line' ? [c.a2.n] : c.a2?.kind === 'plus' ? [(c.a1?.kind === 'line' ? c.a1.n : 1) + c.a2.n] : []),
    ...(c.block ? collectLines(c.block) : []),
  ]);
}

/** The pattern of a sed script made of a single `s` command, to highlight what it matches. */
export function sedPattern(script: string, flavor: 'ere' | 'bre'): JsRegex | undefined {
  const m = /^\s*s(.)/.exec(script);
  if (!m || /[\s\\\n]/.test(m[1])) return undefined;
  const delim = m[1];
  let i = m[0].length;
  let pat = '';
  for (; i < script.length && script[i] !== delim; i++) {
    if (script[i] === '\\' && script[i + 1] === delim) { pat += delim; i++; continue; }
    if (script[i] === '\\') { pat += script[i] + script[i + 1]; i++; continue; }
    pat += script[i];
  }
  const flags = /^[^;\n]*$/.test(script) ? script.split(delim).pop()! : '';
  return toJsRegex(pat, flavor, { ignoreCase: /[Ii]/.test(flags), sedEscapes: true });
}
