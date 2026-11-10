import { type Shell, shellFromName } from '../dialect';
import { featureWorks } from '../shellfeatures';
import type { Pos } from '../analyzer-types';
import type { CallArgument, CallFlags, LanguageRegion, LiteralHole, LiteralSource, ReParam, RegionNote, StringEscapeRisk } from './index';
import { flagsAsCount } from './scripts';
import { type JsonWord, execWords } from './dockerfile';
import { LineOut, Builder } from './builder';
import type { HostMeaning } from '../messages-hosts';
import { isName, isOp, type PyField, type PyLexed, type PyToken, pyLex } from './pylex';
import { argValue, type PyArg, type PyHole } from './pyvalue';
import { dottedAt, type PyImports, pyImports, pyResolve } from './pyimports';
import { type FlagState, PYTHON_FLAGS, type PythonOption } from '../embedded/regex-python';
import { HOLE_COUNT, hasHole, holeChar } from '../embedded/types';

/** Python calls that run a command; `shell` says whether a string goes to /bin/sh. */
interface PyCall { shell: 'always' | 'kwarg' | 'never'; args: 'first' | 'all' }
const PY_CALLS: Record<string, PyCall> = {
  'subprocess.run': { shell: 'kwarg', args: 'first' }, 'subprocess.call': { shell: 'kwarg', args: 'first' },
  'subprocess.check_call': { shell: 'kwarg', args: 'first' }, 'subprocess.check_output': { shell: 'kwarg', args: 'first' },
  'subprocess.Popen': { shell: 'kwarg', args: 'first' },
  'subprocess.getoutput': { shell: 'always', args: 'first' }, 'subprocess.getstatusoutput': { shell: 'always', args: 'first' },
  'os.system': { shell: 'always', args: 'first' }, 'os.popen': { shell: 'always', args: 'first' },
  'asyncio.create_subprocess_shell': { shell: 'always', args: 'first' }, 'asyncio.create_subprocess_exec': { shell: 'never', args: 'all' },
};

/**
 * What a function of `RE_CALLS` gives back, which its example shows (src/examples/python-calls.ts): a match or `None` (`match`), a
 * compiled pattern (`pattern`), the list of what each match captures (`list`), an iterator of matches (`iterator`), the pieces
 * between the matches (`pieces`), the text with them replaced (`replaced`), and that with the count (`counted`).
 */
export type ReReturns = 'match' | 'pattern' | 'list' | 'iterator' | 'pieces' | 'replaced' | 'counted';

/**
 * The functions of Python's `re` that take a pattern (docs/design/python-regex.md, 5.1), by full name: their positional parameters
 * (`flags`, where the flags argument is), what each adds to the pattern: an anchor at the start (`match`), or at both ends
 * (`fullmatch`), and what it gives back. `prefixmatch` is a second name of `match` since Python 3.15.
 */
interface ReCall { params: readonly ReParam[]; anchors?: 'start' | 'whole'; since?: string; returns: ReReturns }
const RE_CALLS: Record<string, ReCall> = {
  're.compile': { params: ['pattern', 'flags'], returns: 'pattern' },
  're.search': { params: ['pattern', 'string', 'flags'], returns: 'match' },
  're.match': { params: ['pattern', 'string', 'flags'], anchors: 'start', returns: 'match' },
  're.prefixmatch': { params: ['pattern', 'string', 'flags'], anchors: 'start', since: '3.15', returns: 'match' },
  're.fullmatch': { params: ['pattern', 'string', 'flags'], anchors: 'whole', returns: 'match' },
  're.findall': { params: ['pattern', 'string', 'flags'], returns: 'list' },
  're.finditer': { params: ['pattern', 'string', 'flags'], returns: 'iterator' },
  're.split': { params: ['pattern', 'string', 'maxsplit', 'flags'], returns: 'pieces' },
  're.sub': { params: ['pattern', 'repl', 'string', 'count', 'flags'], returns: 'replaced' },
  're.subn': { params: ['pattern', 'repl', 'string', 'count', 'flags'], returns: 'counted' },
};

/**
 * The calls `name(` or `a.b(` of a file's tokens (not of an attribute, `x.run(`, nor a definition, `def run(`), each with
 * its full name through the imports (undefined when the name is bound by none).
 */
function* resolvedCalls(src: string, tokens: readonly PyToken[], imports: PyImports): Generator<{ i: number; called: { name: string; next: number }; full: string | undefined }> {
  for (let i = 0; i < tokens.length; i++) {
    const before = tokens[i - 1];
    if (isOp(src, before, '.') || isName(src, before, 'def') || isName(src, before, 'class')) continue;
    const called = dottedAt(src, tokens, i);
    if (!called || !isOp(src, tokens[called.next], '(')) continue;
    yield { i, called, full: pyResolve(imports, called.name) };
  }
}

/** Whether a Python text calls a function of `RE_CALLS` through its imports (`import re` and `re.sub(…)`, `from re import sub` and `sub(…)`): the web page's detection of pasted Python. */
export function callsRe(src: string): boolean {
  const { tokens } = pyLex(src);
  for (const { full } of resolvedCalls(src, tokens, pyImports(src, tokens))) if (full !== undefined && full in RE_CALLS) return true;
  return false;
}

/** What a function of `RE_CALLS` adds to its pattern, and the release it needs (the top row of the pattern says them). */
export function reCallOf(name: string): Pick<ReCall, 'anchors' | 'since'> {
  const { anchors, since } = RE_CALLS[name];
  return { ...(anchors ? { anchors } : {}), ...(since ? { since } : {}) };
}

/** What a function of `RE_CALLS` gives back. */
export const reReturns = (name: string): ReReturns => RE_CALLS[name].returns;

type PyPos = (off: number) => { line: number; col: number };

/** The file's tokens, with its text: what the functions below read. */
interface PyFile extends PyLexed { src: string }

/** The arguments between the brackets at `open` and `close` of the file's tokens: the indexes of each one's tokens, comments left out. */
function pyArgs(lx: PyFile, open: number, close: number): { parts: number[][]; comma: boolean } {
  const parts: number[][] = [[]];
  for (let i = open + 1; i < close; i++) {
    const t = lx.tokens[i];
    if (t.kind === 'comment') continue;
    if (lx.pair[i] > i) {
      for (let k = i; k <= lx.pair[i]; k++) if (lx.tokens[k].kind !== 'comment') parts[parts.length - 1].push(k);
      i = lx.pair[i];
    } else if (isOp(lx.src, t, ',')) parts.push([]);
    else parts[parts.length - 1].push(i);
  }
  // (Without the empty one after a last comma.)
  return { parts: parts.filter((p) => p.length), comma: parts.length > 1 };
}

/** The argument `part` without the parentheses around it: `("a" "b")` is the string, `("a",)` a tuple. */
function unwrap(lx: PyFile, part: number[]): number[] {
  while (part.length > 2 && isOp(lx.src, lx.tokens[part[0]], '(') && lx.pair[part[0]] === part[part.length - 1] && !pyArgs(lx, part[0], part[part.length - 1]).comma) part = part.slice(1, -1);
  return part;
}

export function python(b: Builder): void {
  const src = b.lines.join('\n');
  const lineStarts: number[] = [];
  b.lines.reduce((at, l) => (lineStarts.push(at), at + l.length + 1), 0);
  const pos: PyPos = (off) => {
    // (The last line that starts at or before `off`: asked for each character of a pattern.)
    let [line, high] = [0, lineStarts.length - 1];
    while (line < high) {
      const mid = (line + high + 1) >> 1;
      if (lineStarts[mid] <= off) line = mid;
      else high = mid - 1;
    }
    return { line, col: off - lineStarts[line] };
  };
  const lx: PyFile = { ...pyLex(src), src };
  const { tokens } = lx;
  // Names the calls go by: `import subprocess as sp`, `from subprocess import run as r`.
  const imports = pyImports(src, tokens);
  // (The calls of `re`, read once every line a shell region takes is known: a shell region keeps a line it shares.)
  const patterns: { name: string; full: string; first: number; at: number }[] = [];
  for (const { i, called, full } of resolvedCalls(src, tokens, imports)) {
    if (full !== undefined && full in RE_CALLS) patterns.push({ name: called.name, full, first: i, at: called.next });
    const spec = full === undefined ? undefined : PY_CALLS[full];
    if (!spec) continue;
    const open = called.next;
    const close = lx.pair[open];
    if (close < 0) continue;
    // A line of shell text holds one call: a second call on a line (`os.system("a"); os.system("b")`) is left out.
    let taken = false;
    for (let l = pos(tokens[open].start).line; l <= pos(tokens[close].start).line; l++) taken ||= !!b.outs[l]?.text;
    if (taken) continue;
    const { parts } = pyArgs(lx, open, close);
    /** The tokens of the value of the keyword argument `k`, if it is given. */
    const keyword = (k: string) => parts.find((p) => isName(src, tokens[p[0]], k) && isOp(src, tokens[p[1]], '='))?.slice(2);
    const shellValue = keyword('shell');
    /** `shell=` as written when it is one name (`True`), '' for another expression. */
    const shellArg = shellValue && (shellValue.length === 1 ? src.slice(tokens[shellValue[0]].start, tokens[shellValue[0]].end) : '');
    const positional = parts.filter((p) => !(tokens[p[0]].kind === 'name' && isOp(src, tokens[p[1]], '=')) && !isOp(src, tokens[p[0]], '**'));
    if (!positional.length) continue;
    const usesShell = spec.shell === 'always' || (spec.shell === 'kwarg' && shellArg === 'True');
    const exeValue = keyword('executable');
    const exe = exeValue && literalValue(lx, exeValue)?.value.split('/').pop();
    const target: Shell = (exe && shellFromName(exe)) || 'sh';
    const label = (what: [string, string]): [string, string] => [`Python の \`${called.name}\`（${what[0]}）`, `Python \`${called.name}\` (${what[1]})`];
    const first = unwrap(lx, positional[0]);
    const firstEnd = first[first.length - 1];
    // A list, or a tuple: parentheses with a comma, or none between them.
    const opens = isOp(src, tokens[first[0]], '[') || (isOp(src, tokens[first[0]], '(') && (first.length === 2 || pyArgs(lx, first[0], firstEnd).comma));
    const isList = opens && lx.pair[first[0]] === firstEnd;
    if (spec.args === 'all' || isList) {
      // A list of arguments: run directly, like Docker's exec form.
      const items = (spec.args === 'all' ? positional.filter((p) => !isOp(src, tokens[p[0]], '*')) : pyArgs(lx, first[0], firstEnd).parts).map((p) => unwrap(lx, p));
      if (!items.length) continue;
      if (usesShell && spec.shell === 'kwarg') {
        // shell=True with a list: the first item is the script, the rest become $0, $1…
        const script = pyScript(b, lx, items[0], pos, target);
        if (!script) continue;
        b.region(script.first, script.last, label(['shell=True のリストの最初の要素をシェルが実行', 'shell=True: the shell runs the first item of the list']), target, [{ spec: { id: 'python-shell-list', params: {} } }]);
        continue;
      }
      const words = items.map((p) => pyWord(lx, p, pos));
      if (words.some((w) => !w)) continue;
      const ws = words as JsonWord[];
      execWords(b, ws);
      b.execRegion(ws[0].line, ws[ws.length - 1].line, label(['シェルを通さずに実行する引数のリスト', 'arguments run without a shell']), [{ spec: { id: 'python-exec-list', params: {} } }], ['Python の文字列', 'Python string']);
      continue;
    }
    const script = pyScript(b, lx, first, pos, usesShell ? target : 'bash');
    if (!script) continue;
    const notes: RegionNote[] = [];
    if (!usesShell && /\s/.test(script.text.trim())) {
      notes.push(shellArg === undefined || shellArg === 'False' ? { spec: { id: 'python-string-without-shell', params: {} }, code: 'pythonNoShell' } : { spec: { id: 'python-shell-expression', params: {} } });
    }
    if (usesShell && script.interpolated) {
      notes.push({ spec: { id: 'python-shell-injection', params: {} }, code: 'pythonInjection' });
    }
    if (script.partial) notes.push({ spec: { id: 'python-string-partial', params: {} } });
    const sh = target === 'sh' ? '/bin/sh' : target;
    const what: [string, string] = usesShell ? [`シェル（${sh}）が実行する文字列`, `a string the shell (${sh}) runs`] : ['シェルを通さないコマンド文字列', 'a command string run without a shell'];
    b.region(script.first, script.last, label(what), usesShell ? target : 'bash', notes);
  }
  claimLines(b, patterns.flatMap((p) => reCall(lx, imports, p, pos) ?? []));
}

/**
 * A call of `re` read, before it has its lines: its region but for them, the lines of the call, and those of its pattern's literals
 * (none where the pattern is not literals: a region of the call's facts only).
 */
interface ReCandidate { region: Omit<LanguageRegion, 'lines'>; start: number; end: number; pattern?: { start: number; end: number } }

/**
 * The lines of the calls of `re` (docs/design/python-regex.md, 2.2), each call in the order written. A line a shell region has stays
 * the shell's. A line of a pattern's literals is that call's, the first written when two patterns share one, and a call whose pattern
 * has a line taken so is left out. Every other line of a call is that of the innermost call kept that holds it: the one that starts
 * last, as calls nest (`re.sub(r'a', 'b',` over `re.sub(r'c', 'd', s))`: each line shows its own pattern).
 */
function claimLines(b: Builder, calls: readonly ReCandidate[]): void {
  const owner = new Map<number, ReCandidate>();
  const patternLines = new Set<number>();
  const kept = calls.filter((c) => {
    const { pattern } = c;
    if (!pattern) return true;
    for (let l = pattern.start; l <= pattern.end; l++) if (b.outs[l]?.text || patternLines.has(l)) return false;
    for (let l = pattern.start; l <= pattern.end; l++) {
      patternLines.add(l);
      owner.set(l, c);
    }
    return true;
  });
  for (const c of kept) for (let l = c.start; l <= c.end; l++) if (!b.outs[l]?.text && !patternLines.has(l)) owner.set(l, c);
  for (const c of kept) {
    const lines: number[] = [];
    for (let l = c.start; l <= c.end; l++) if (owner.get(l) === c) lines.push(l);
    // (A call of facts only may have no line left: one inside a pattern's line.)
    if (lines.length) b.languages.push({ ...c.region, lines });
  }
}

/**
 * The call of `re` whose name starts at the token `p.first` and whose `(` is at `p.at`, as a `LanguageRegion` whose lines are not
 * given yet (`claimLines`): its arguments, each with the parameter it binds (`RE_CALLS`: by its slot, or by keyword) and its value
 * when it is string literals. The arguments of `flags`, `count` and `maxsplit` get the flags they name (`reFlags`), and the region
 * the options of its flags. A region reads a pattern of string literals only (one, or several joined, over several lines too; an
 * f-string's fields as holes; a `\N{…}` escape is not read). A call whose pattern is something else is a region only where it
 * has a fact of the call (`flagsAsCount`), with no pattern and no options (docs/design/python-regex.md, 2.2).
 */
function reCall(lx: PyFile, imports: PyImports, p: { name: string; full: string; first: number; at: number }, pos: PyPos): ReCandidate | undefined {
  const { src, tokens } = lx;
  const close = lx.pair[p.at];
  if (close < 0) return undefined;
  const { parts } = pyArgs(lx, p.at, close);
  // (A `*args` or `**kwargs` may hold the pattern or the flags.)
  if (parts.some((a) => isOp(src, tokens[a[0]], '*') || isOp(src, tokens[a[0]], '**'))) return undefined;
  const { params } = RE_CALLS[p.full];
  const at = (off: number): Pos => {
    const q = pos(off);
    return { line: q.line, character: q.col };
  };
  let slot = 0;
  const read = parts.map((a): { arg: CallArgument; value?: PyArg } => {
    const keyword = tokens[a[0]].kind === 'name' && isOp(src, tokens[a[1]], '=');
    // (By keyword, the parameter of that name; else the next slot. One past them binds none: Python raises `TypeError`.)
    const role = keyword ? params.find((n) => isName(src, tokens[a[0]], n)) : params[slot++];
    const part = keyword ? a.slice(2) : a;
    // (Only the pattern's value may have fields, read as holes: docs/design/python-regex.md, 4.3.)
    const found = literalValue(lx, unwrap(lx, part), role === 'pattern');
    const literal = found && literalSource(lx, imports, found, at);
    const value = literal ? found : undefined;
    const span = { start: at(tokens[part[0]].start), end: at(tokens[part[part.length - 1]].end) };
    const flags = role === 'flags' || role === 'count' || role === 'maxsplit' ? reFlags(lx, imports, unwrap(lx, part), at) : undefined;
    return { arg: { ...(role ? { role } : {}), keyword, span, ...(literal ? { literal } : {}), ...(flags ? { flags } : {}) }, value };
  });
  const args = read.map((r) => r.arg);
  if (args.some((a) => !a.role) || !args.some((a) => a.role === 'pattern')) return undefined;
  const pattern = read.find((r) => r.arg.role === 'pattern')!.value;
  if (!pattern && !args.some(flagsAsCount)) return undefined;
  // (No flags argument: none. Names of `re` are on; the rest of an argument not read is not known.)
  const flagsArg = args.find((a) => a.role === 'flags');
  const set = new Set(flagsArg?.flags?.names.map((n) => PYTHON_FLAGS.find((f) => f.name === n.flag)!).flatMap((f) => ('option' in f ? [f.option] : [])));
  const known = !flagsArg || (flagsArg.flags && !flagsArg.flags.unknown.length);
  const state = (o: PythonOption): FlagState => set.has(o) || (known ? false : 'unknown');
  const region: ReCandidate['region'] = {
    label: [`Python の正規表現（\`${p.name}\` の引数）`, `Python regex (argument of \`${p.name}\`)`],
    host: { kind: 'python' }, language: 'regex', flavor: 'python',
    call: { written: p.name, name: p.full, span: { start: at(tokens[p.first].start), end: at(tokens[close].end) } },
    args,
    ...(pattern ? { options: {
      ascii: state('ascii'), ignorecase: state('ignorecase'), multiline: state('multiline'), dotall: state('dotall'), verbose: state('verbose'), locale: state('locale'),
      bytes: pattern.literals[0].token.lit!.bytes,
    } } : {}),
  };
  const lines = { start: pos(tokens[p.first].start).line, end: pos(tokens[close].start).line };
  if (!pattern) return { region, ...lines };
  const literals = pattern.literals;
  return { region, ...lines, pattern: { start: pos(literals[0].token.start).line, end: pos(literals[literals.length - 1].token.end).line } };
}

/** What binds less tightly than `|` in Python, where a join of flags ends: a comparison, `not`, `and`, `or`, `if`, `lambda`, `:=`. */
const LOOSER_OPS: ReadonlySet<string> = new Set(['<', '>', '==', '!=', '<=', '>=', ':=', ':', ',']);
const LOOSER_WORDS: ReadonlySet<string> = new Set(['in', 'not', 'is', 'and', 'or', 'if', 'else', 'lambda']);

/**
 * The flags the argument of the token indexes `part` names (docs/design/python-regex.md, 5.2): terms joined by `|`, each `0` (as
 * `NOFLAG`) or a name of `re`, short or long (`re.I`, `re.IGNORECASE`; `I` after `from re import I`), by the file's imports. A term
 * that is neither is not known (`unknown`, its place): the names are on whatever it adds. Undefined where no term is a name of `re`,
 * or the argument is no such join (`re.I if x else 0`, `re.I |`).
 */
function reFlags(lx: PyFile, imports: PyImports, part: number[], at: (off: number) => Pos): CallFlags | undefined {
  const { src, tokens } = lx;
  // (The terms: the tokens between `|` outside brackets.)
  const terms: number[][] = [[]];
  for (let k = 0; k < part.length; k++) {
    const t = tokens[part[k]];
    const text = src.slice(t.start, t.end);
    if (t.kind === 'op' && text === '|') terms.push([]);
    else if ((t.kind === 'op' && LOOSER_OPS.has(text)) || (t.kind === 'name' && LOOSER_WORDS.has(text))) return undefined;
    else {
      const close = lx.pair[part[k]];
      const end = close > part[k] ? part.indexOf(close, k) : k;
      // (A bracketed group whole: its `|` and keywords are inside it.)
      for (; k <= end; k++) terms[terms.length - 1].push(part[k]);
      k = end;
    }
  }
  const names: CallFlags['names'] = [];
  const unknown: CallFlags['unknown'] = [];
  let value = 0;
  for (const term of terms) {
    if (!term.length) return undefined;
    const span = { start: at(tokens[term[0]].start), end: at(tokens[term[term.length - 1]].end) };
    const own = term.map((i) => tokens[i]);
    const d = dottedAt(src, own, 0);
    const full = d?.next === own.length ? pyResolve(imports, d.name) : undefined;
    const zero = own.length === 1 && own[0].kind === 'number' && src.slice(own[0].start, own[0].end) === '0';
    const flag = zero ? PYTHON_FLAGS.find((f) => f.value === 0) : full?.startsWith('re.') ? PYTHON_FLAGS.find((f) => full === `re.${f.name}` || ('short' in f && full === `re.${f.short}`)) : undefined;
    if (!flag) {
      unknown.push(span);
      continue;
    }
    names.push({ written: zero ? '0' : d!.name, flag: flag.name, span });
    value |= flag.value;
  }
  return names.length ? { names, value, unknown } : undefined;
}

/**
 * Where each character of the value of literals is in the file (`LiteralSource`), with each field of an f-string as a hole character
 * (`holeChar`, src/embedded/types.ts) over the field's source, and the escapes of the strings a regex reads otherwise (`stringRisk`).
 * None where the value holds a hole character of its own, or has more fields than there are hole characters.
 */
function literalSource(lx: PyFile, imports: PyImports, value: PyArg, at: (off: number) => Pos): LiteralSource | undefined {
  const { src } = lx;
  if (hasHole(value.value) || value.holes.length > HOLE_COUNT) return undefined;
  const first = value.literals[0].token;
  const last = value.literals[value.literals.length - 1].token;
  let text = '';
  const from: Pos[] = [];
  const to: Pos[] = [];
  const holes: Record<string, LiteralHole> = {};
  const escapes: { at: number; risk: StringEscapeRisk }[] = [];
  let h = 0;
  const hole = () => {
    const { start, end, field } = value.holes[h] as Extract<PyHole, { kind: 'field' }>;
    const c = holeChar(h++);
    holes[c] = { written: src.slice(start, end), escaped: escapedField(src, imports, field) };
    text += c;
    from.push(at(start));
    to.push(at(end));
  };
  for (let i = 0; i < value.value.length; i++) {
    for (; h < value.holes.length && value.holes[h].at === i;) hole();
    const risk = stringRisk(src, value, i);
    if (risk) escapes.push({ at: text.length, risk });
    text += value.value[i];
    from.push(at(value.offs[i]));
    to.push(at(value.ends[i]));
  }
  while (h < value.holes.length) hole();
  // (The end of the text the reader reads: after the last character, or the start of the first literal's text when it is empty.)
  const after = text.length ? to[to.length - 1] : at(first.lit!.contentStart);
  return { value: text, at: [...from, after], to, span: { start: at(first.start), end: at(last.end) }, ...(h ? { holes } : {}), ...(escapes.length ? { escapes } : {}),
    ...(first.lit!.bytes ? { bytes: true as const } : {}) };
}

/**
 * How the strings write the character `i` of the value, where a regex reads its source otherwise (`StringEscapeRisk`): the escape
 * `\b`, a backspace; an octal escape of one or two digits, not from `0` (`\1`, `\12`), which a regex reads as a group's number;
 * a backslash a literal that is not raw keeps, as it starts no escape of Python's (`"\d"`: SyntaxWarning; `escapeAt`).
 */
function stringRisk(src: string, value: PyArg, i: number): StringEscapeRisk | undefined {
  if (value.kinds[i] === 'kept') return 'kept';
  if (value.kinds[i] !== 'escape') return undefined;
  const written = src.slice(value.offs[i], value.ends[i]);
  return written === '\\b' ? 'backspace' : written.length < 4 && written[1] >= '1' && written[1] <= '7' ? 'octal' : undefined;
}

/**
 * Whether a field of an f-string is a call of `re.escape` and nothing else (`{re.escape(x)}`, by the file's names: `{escape(x)}` after
 * `from re import escape`), with no conversion, format spec or `=`: its value is the text, with every character special in a regex escaped.
 */
function escapedField(src: string, imports: PyImports, f: PyField): boolean {
  if (f.debug !== undefined || f.bang !== undefined || f.colon !== undefined) return false;
  const ts = f.tokens.filter((t) => t.kind !== 'comment');
  const d = dottedAt(src, ts, 0);
  if (!d || pyResolve(imports, d.name) !== 're.escape' || !isOp(src, ts[d.next], '(')) return false;
  // (The `(` after the name closes at the last token: where the brackets from it first come back to none.)
  let depth = 0;
  const close = ts.findIndex((t, k) => {
    const c = t.kind === 'op' ? src.slice(t.start, t.end) : '';
    depth += c === '(' || c === '[' || c === '{' ? 1 : c === ')' || c === ']' || c === '}' ? -1 : 0;
    return k >= d.next && depth === 0;
  });
  return close === ts.length - 1;
}

/**
 * The value of the argument of the token indexes `part` when it is string literals only, with none of their parts unknown; with
 * `fields`, the replacement fields of an f-string may be in it (a pattern's, read as holes), but no `\N{…}`, whose character is not known.
 */
function literalValue(lx: PyFile, part: number[], fields = false): PyArg | undefined {
  const arg = argValue(lx.src, part.map((i) => lx.tokens[i]));
  return arg && !arg.rest.length && arg.holes.every((h) => fields && h.kind === 'field') ? arg : undefined;
}

/** Shell variable name standing for a Python expression. */
function pyName(expr: string): string {
  return `py_${expr.replace(/\W+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'expr'}`;
}

/** An item of an argument list: string literals as a word, or a Python expression as a placeholder. */
function pyWord(lx: PyFile, part: number[], pos: PyPos): JsonWord | undefined {
  const a = lx.tokens[part[0]].start;
  const z = lx.tokens[part[part.length - 1]].end;
  const p = pos(a);
  if (pos(z - 1).line !== p.line) return undefined;
  // (A field, or a `\N{…}` escape, a character we do not name: the word is an expression whose value we do not know.)
  const str = literalValue(lx, part);
  if (str) return { line: p.line, start: p.col, end: pos(z - 1).col + 1, value: str.value, cols: str.offs.map((o) => pos(o).col) };
  const expr = lx.src.slice(a, z);
  return {
    line: p.line, start: p.col, end: pos(z - 1).col + 1, value: '', cols: [],
    placeholder: [`"\${${pyName(expr)}}"`, { kind: 'python-argument', expr }],
  };
}

/**
 * Write the string literal(s) of the argument `part` as shell code for the shell `shell`: adjacent literals are joined
 * (as Python does), escapes undone, and f-string fields and `\N{…}` escapes replaced by placeholders. A newline that an
 * escape gives is what the shell reads there: the end of a command (`;`), a line continuation after a backslash, and in
 * quotes a newline of the word (`'$'\n''` where the shell has `$'…'`, else a quoted placeholder of the one character). `partial`
 * is set when Python code follows the literals (`"…" + x`, `"…".format(…)`). Undefined when it starts with no str or
 * bytes literal or f-string. Nothing is written until the whole string is read.
 */
function pyScript(b: Builder, lx: PyFile, part: number[], pos: PyPos, shell: Shell):
  { first: number; last: number; text: string; interpolated: boolean; partial: boolean } | undefined {
  const { src, tokens } = lx;
  const arg = argValue(src, part.map((i) => tokens[i]));
  if (!arg) return undefined;
  const ops: [number, string, number, number, HostMeaning?][] = [];
  let text = '';
  let interpolated = false;
  let first = -1;
  let last = -1;
  let prevEnd = -1;
  const insert = (s: string, from: number, to: number, meaning?: HostMeaning) => {
    const p = pos(from);
    // Literals on different lines are joined with nothing between: continue the shell line with `\`.
    if (prevEnd >= 0 && pos(prevEnd).line < p.line) ops.push([pos(prevEnd).line, '\\', pos(prevEnd).col, pos(prevEnd).col]);
    prevEnd = -1;
    if (first < 0) first = p.line;
    last = Math.max(last, p.line);
    ops.push([p.line, s, p.col, pos(to - 1).col + 1, meaning]);
    text += s;
  };
  // The backslash-newlines of the source before an offset join the lines, as `\` does in the shell.
  let j = 0;
  const joinsBefore = (at: number) => {
    for (; j < arg.joins.length && arg.joins[j] < at; j++) {
      insert('\\', arg.joins[j], arg.joins[j] + 1);
      text += '\n';
    }
  };
  // The shell's quotes around the character written, and a backslash of the shell not written yet.
  let quote = '';
  let pending: [number, number] | undefined;
  /** A placeholder of one character we do not write, quoted, so that the shell reads it as one, whatever it is. */
  const oneChar = (name: string, from: number, to: number, meaning: HostMeaning) => {
    // (The quotes around it are pieces of their own, so that the expansion is the text the meaning is on.)
    const [open, close] = quote === '"' ? ['', ''] : quote === "'" ? ["'\"", "\"'"] : ['"', '"'];
    if (open) insert(open, from, from);
    insert(`\${${name}}`, from, to, meaning);
    if (close) insert(close, to, to);
  };
  const flush = () => {
    if (pending) insert('\\', pending[0], pending[1]);
    pending = undefined;
  };
  let n = 0;
  let h = 0;
  for (let i = 0; i <= arg.value.length; i++) {
    for (; n < arg.literals.length && arg.literals[n].at === i; n++) {
      if (!n) continue;
      const end = arg.literals[n - 1].token.end;
      joinsBefore(end);
      prevEnd = end;
    }
    for (; h < arg.holes.length && arg.holes[h].at === i; h++) {
      const hole = arg.holes[h];
      joinsBefore(hole.start);
      flush();
      if (hole.kind === 'field') {
        const f = hole.field;
        const expr = src.slice(f.start + 1, f.tokens.length ? f.tokens[f.tokens.length - 1].end : f.start + 1).trim();
        insert(`\${${pyName(expr)}}`, hole.start, hole.end, { kind: 'python-field', expr });
        interpolated = true;
      } else {
        oneChar(pyName(src.slice(hole.start, hole.end)), hole.start, hole.end, { kind: 'python-char', name: hole.name });
      }
    }
    if (i === arg.value.length) break;
    const c = arg.value[i];
    const kind = arg.kinds[i];
    // (The text of a self-documenting field stands at its `{`.)
    const next = arg.holes[h];
    const [o, e] = kind === 'debug' ? [next.start, next.start + 1] : [arg.offs[i], arg.ends[i]];
    joinsBefore(o);
    if (c === '\n' && kind === 'text') {
      // A newline inside a triple-quoted string is a real one.
      flush();
      text += '\n';
      continue;
    }
    if (pending) {
      // After a backslash of the shell: an escaped newline is a line continuation, which the shell removes with it.
      if (c === '\n') pending = undefined;
      else {
        flush();
        insert(c, o, e);
      }
      continue;
    }
    if (c === '\n') {
      if (!quote) insert(';', o, e);
      else if (featureWorks('ansiC', shell)) insert(`${quote}$'\\n'${quote}`, o, e);
      // (A shell with no `$'…'` cannot have it on one line: a placeholder of the one character.)
      else oneChar('py_newline', o, e, { kind: 'python-newline' });
      continue;
    }
    if (c === '\\' && quote !== "'") {
      pending = [o, e];
      continue;
    }
    if (!quote && (c === "'" || c === '"')) quote = c;
    else if (c === quote) quote = '';
    insert(c, o, e);
  }
  flush();
  joinsBefore(Infinity);
  if (first < 0) return undefined;
  for (const [line, s, from, to, meaning] of ops) (b.outs[line] ??= new LineOut()).insert(s, from, to, meaning);
  const rest = arg.rest;
  if (isOp(src, rest[0], '%') || (isOp(src, rest[0], '.') && isName(src, rest[1], 'format') && isOp(src, rest[2], '('))) interpolated = true;
  return { first, last, text, interpolated, partial: rest.length > 0 };
}
