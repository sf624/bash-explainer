/** Run a whole pipeline of supported commands on sample input, keeping every stage's output. */
import { awkExample, awkInvocation, runAwk } from './awk';
import { utf8Length } from './bytes';
import { perlExample, perlOptions, runPerl } from './perlrun';
import { awkMarks, joinRanges, type LineMarks, type StageMarks } from './marks';
import { grepWrap, JsRegex, literalRegex, posixMatches, regexExamples, toJsRegex } from './regex';
import { runSed, sedExample, sedMarks } from './sed';
import { bashPrintf, ShellWordsUnsupported } from './shellwords';
import { cutMarks, FILTERS, parseOptions, parseWords, runSeq, sampleInput, shortKeys, sortMarks, sortsUnique, Unsupported } from './textfilters';
import { runXargs, showCommand } from './runtime';
import { canonicalName, impliedWords } from '../dict/aliases';
import { selectedModes, values } from '../argv/query';

export interface Stage {
  cmd: string;
  /** Argument words (undefined when not literal). */
  words: (string | undefined)[];
  /** The stage as written, for labels. */
  text: string;
  /** It prints what it reads as it is (`CommandSpec.copies`: cat): no step of its own is shown, but for the last. */
  copies?: boolean;
}

type Runner = (input: string[]) => string[];

// ---------------------------------------------------------------- grep

/** The options of grep the simulation follows. */
const GREP = shortKeys('ivcnowxEFPGsqhem');

function grepRegexes(words: (string | undefined)[], relax = false): { res: JsRegex[]; p: ReturnType<typeof parseOptions> } {
  const p = parseOptions('grep', words, GREP);
  const has = (c: string) => p.opts.some(([n]) => n === c);
  const patterns = p.opts.filter(([n]) => n === 'e').map(([, v]) => v);
  if (!patterns.length) {
    const first = p.operands.shift();
    if (first === undefined) throw new Unsupported('pattern');
    patterns.push(first);
  }
  const flavor = has('P') ? 'pcre' : has('E') ? 'ere' : 'bre';
  const res = patterns.flatMap((pat) => pat.split('\n')).map((pat) => {
    // `relax` leaves out what -i, -w and -x change, to find lines that show their effect.
    const ic = has('i') && !relax;
    const js = has('F') ? literalRegex(pat, ic) : toJsRegex(pat, flavor, { ignoreCase: ic });
    if (!js) throw new Unsupported('regex');
    return relax ? js : grepWrap(js, has('x'), has('w'));
  });
  return { res, p };
}

/**
 * The lines grep reads, in order, and whether it selects each (for `-v`, those that do not match); it stops reading at
 * the limit `-m` gives, and `-q` at the first it selects.
 */
function grepReads(res: JsRegex[], p: ReturnType<typeof parseOptions>, input: string[]): boolean[] {
  const has = (c: string) => p.opts.some(([n]) => n === c);
  const max = p.opts.find(([n]) => n === 'm')?.[1];
  const limit = has('q') ? 1 : max !== undefined ? Number(max) : Infinity;
  const read: boolean[] = [];
  let count = 0;
  for (const line of input) {
    if (count >= limit) break;
    const hit = res.some((r) => new RegExp(r.source, r.flags).test(line));
    read.push(hit !== has('v'));
    if (hit !== has('v')) count++;
  }
  return read;
}

export function runGrep(words: (string | undefined)[], input: string[]): string[] {
  const { res, p } = grepRegexes(words);
  const has = (c: string) => p.opts.some(([n]) => n === c);
  const read = grepReads(res, p, input);
  if (has('q')) return [];
  if (has('c')) return [String(read.filter(Boolean).length)];
  return read.flatMap((selected, i) => {
    if (!selected) return [];
    const prefix = has('n') ? `${i + 1}:` : '';
    // `-o -v` prints nothing: the selected lines have no match to print.
    if (!has('o')) return [prefix + input[i]];
    return has('v') ? [] : matchesOf(res, p, input[i]).map(([a, b]) => prefix + input[i].slice(a, b));
  });
}

/** The non-empty matches of grep's patterns on a line, in order: POSIX's leftmost longest, PCRE's (`-P`) first. */
const matchesOf = (res: JsRegex[], p: ReturnType<typeof parseOptions>, line: string) =>
  posixMatches(res, line, !p.opts.some(([n]) => n === 'P')).filter(([a, b]) => b > a);

/**
 * What grep matches on each line it reads (all its matches, as `--color` and `-o` show them: POSIX's leftmost longest,
 * PCRE's first), and the lines it leaves out: those it does not select, and those after its limit (`-m`), unread.
 */
export function grepMarks(words: (string | undefined)[], input: string[]): LineMarks {
  const { res, p } = grepRegexes(words);
  const read = grepReads(res, p, input);
  return {
    ranges: input.map((line, i) => (i < read.length ? matchesOf(res, p, line) : [])),
    dropped: input.flatMap((_, i) => (read[i] ? [] : [i])),
  };
}

const PREFIXES = ['disk ', 'net ', 'db ', 'cache '];
const SUFFIXES = [' failed', ' timeout', ' retry', ' again'];

/** Whether any of the regexes matches the line. */
function matchesAny(res: JsRegex[], line: string): boolean {
  return res.some((r) => new RegExp(r.source, r.flags).test(line));
}

/**
 * Sample lines for grep: matching and non-matching ones, a line that shows what -i, -w or -x
 * changes, and `more` extra matching lines (for the limits and counts further down a pipeline).
 */
function grepSample(words: (string | undefined)[], more = 0): string[] | undefined {
  const { res, p } = grepRegexes(words);
  const inverted = p.opts.some(([n]) => n === 'v');
  const ex = regexExamples(res[0], 3);
  if (!ex) return undefined;
  const yes = ex.matching.filter((x) => !/^abc |\sxyz$/.test(x)).concat(ex.matching.filter((x) => /^abc |\sxyz$/.test(x)));
  const no = ex.nonMatching.length ? ex.nonMatching : ['other line'];
  const lines = [no[0], yes[0], yes[1] ?? yes[0], no[1] ?? no[0], yes[2] ?? yes[0]];
  // A line the plain pattern and the real one disagree about.
  const plain = grepRegexes(words, true).res;
  const base = yes[0];
  const swapped = base.replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
  const contrast = [swapped, 'x' + base, base + 'x', `abc ${base} xyz`, base + base.slice(-1)]
    .find((c) => matchesAny(plain, c) !== matchesAny(res, c));
  if (contrast !== undefined) lines.splice(3, 0, contrast);
  // Extra lines grep selects (for -v, those that do not match), in a fixed order; case variants last.
  const extras: string[] = [];
  const seed = inverted ? no[0] : base;
  for (const b of [seed, seed.replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()))]) {
    for (const pre of PREFIXES) extras.push(pre + b);
    for (const suf of SUFFIXES) extras.push(b + suf);
    for (const pre of PREFIXES) for (const suf of SUFFIXES) extras.push(pre + b + suf);
  }
  const out = [...new Set(lines)];
  let added = 0;
  for (const e of extras) {
    if (added >= more) break;
    if (!out.includes(e) && matchesAny(res, e) !== inverted) { out.push(e); added++; }
  }
  return out;
}

// ---------------------------------------------------------------- other runners

/** The options of sed the simulation follows (`-i`, `-s` and `-u` change nothing it shows). */
const SED = shortKeys('enEisu');

function sedArgs(words: (string | undefined)[]): { script: string; quiet: boolean; extended: boolean } {
  if (words.includes(undefined)) throw new Unsupported('non-literal');
  const p = parseOptions('sed', words, SED);
  const parse = parseWords('sed', words);
  const scripts = p.opts.filter(([n]) => n === 'e').map(([, v]) => v);
  // (sed reads each -e script with the options given before it, `ValueSpec.inOrder`: `sed -e 's/a+/x/' -E` reads a
  // BRE; the script operand, with all of them. Scripts read in different flavours are not run as one.)
  const extended = new Set((scripts.length ? values(parse, '-e').map(({ word }) => word) : [undefined]).map((w) => selectedModes(parse, w).has('ere')));
  if (extended.size > 1) throw new Unsupported('flavours');
  if (!scripts.length) {
    const first = p.operands[0];
    if (first === undefined) throw new Unsupported('script');
    scripts.push(first);
  }
  return { script: scripts.join('\n'), quiet: p.opts.some(([n]) => n === 'n'), extended: [...extended][0] };
}

function awkArgs(words: (string | undefined)[]): { program: string; fs?: string; vars: Record<string, string>; assigns: Record<string, string> } {
  const a = awkInvocation(words);
  if (a.unsupported !== undefined) throw new Unsupported(a.unsupported);
  if (a.program === undefined) throw new Unsupported('program');
  return { program: a.program, fs: a.fs, vars: a.vars, assigns: a.assigns };
}

function runWc(words: (string | undefined)[], input: string[]): string[] {
  const p = parseOptions('wc', words, shortKeys('lwcmL'));
  if (p.operands.length) throw new Unsupported('wc files');
  const text = input.map((l) => l + '\n').join('');
  const counts: Record<string, number> = {
    l: input.length, w: text.split(/\s+/).filter(Boolean).length, c: utf8Length(text), m: [...text].length,
  };
  let which = p.opts.map(([c]) => c);
  if (!which.length) which = ['l', 'w', 'c'];
  if (which.includes('L')) throw new Unsupported('-L');
  const order = ['l', 'w', 'm', 'c'].filter((c) => which.includes(c));
  // From stdin, a single count is printed bare; several are right-aligned in 7 columns.
  if (order.length === 1) return [String(counts[order[0]])];
  return [order.map((c) => String(counts[c]).padStart(7)).join(' ')];
}

/** Whether the words give no option (else Unsupported) and no file but `-` (or a word not literal). */
const readsOnlyStdin = (cmd: string, words: (string | undefined)[]): boolean => parseOptions(cmd, words, {}).operands.every((x) => x === '-' || x === undefined);

/** A runner for one stage, or undefined if the command is not supported. */
export function runner(stage: Stage): Runner | undefined {
  const w = stage.words;
  switch (canonicalName(stage.cmd)) {
    case 'grep': {
      const words = [...impliedWords(stage.cmd), ...w];
      grepRegexes(words);
      return (input) => runGrep(words, input);
    }
    case 'sed': {
      const a = sedArgs(w);
      return (input) => {
        const out = runSed(a.script, input, { quiet: a.quiet, extended: a.extended });
        if (!out) throw new Unsupported('sed');
        return out;
      };
    }
    case 'awk': {
      const a = awkArgs(w);
      return (input) => {
        const out = runAwk(a.program, input, a);
        if (!out) throw new Unsupported('awk');
        return out;
      };
    }
    case 'perl': {
      const parsed = perlOptions(w);
      if (!parsed || !parsed.opts.loop) return undefined;
      return (input) => {
        const out = runPerl(parsed.code, parsed.opts, input);
        if (!out) throw new Unsupported('perl');
        return out;
      };
    }
    case 'tee': return (input) => input;
    // (No option of these is followed: `cat -n` numbers the lines. A file operand is read instead of the pipe.)
    case 'cat': return readsOnlyStdin('cat', w) ? (input) => input : undefined;
    case 'tac': return readsOnlyStdin('tac', w) ? (input) => [...input].reverse() : undefined;
    case 'rev': return readsOnlyStdin('rev', w) ? (input) => input.map((l) => [...l].reverse().join('')) : undefined;
    case 'wc': return (input) => runWc(w, input);
    case 'xargs': return (input) => runXargs(w, input.map((l) => l + '\n').join('')).map(showCommand);
  }
  const f = FILTERS[stage.cmd];
  return f && ((input) => f(w, input));
}

/**
 * What `stage` reads of `input`, the lines it is given (src/examples/marks.ts): grep's matches, sed's (a `p` or `d` at
 * a regex, an `s`), awk's fields and regexes, what cut takes, the keys sort compares; and the lines it leaves out.
 * Undefined for another command, or when it reads all of every line. Only for a stage that has run on `input`.
 */
export function stageMarks(stage: Stage, input: string[]): StageMarks | undefined {
  const w = stage.words;
  let m: LineMarks | undefined;
  let kind: StageMarks['kind'] = 'match';
  switch (canonicalName(stage.cmd)) {
    case 'grep': m = grepMarks([...impliedWords(stage.cmd), ...w], input); break;
    case 'sed': { const a = sedArgs(w); m = sedMarks(a.script, input, { quiet: a.quiet, extended: a.extended }); break; }
    case 'awk': { const a = awkMarks(awkInvocation(w), input); m = a; kind = a.kind; break; }
    case 'cut': m = cutMarks(w, input); kind = 'take'; break;
    case 'sort': m = sortMarks(w, input); kind = 'key'; break;
  }
  if (!m || (!m.ranges.some((r) => r.length) && !m.dropped.length)) return undefined;
  return { kind, ranges: m.ranges.map(joinRanges), dropped: m.dropped };
}

/**
 * What the stages print, when it is known: the first reads `given` (the text of a here-string or a here-document), or
 * else prints without reading input (echo, printf, seq). Undefined when a stage cannot be followed, or runs commands
 * (xargs), whose output is not known.
 */
export function pipedOutput(stages: Stage[], given?: string[]): string[] | undefined {
  try {
    let data = given ?? sourceOutput(stages[0]);
    if (!data) return undefined;
    for (const stage of given ? stages : stages.slice(1)) {
      const run = stage.cmd === 'xargs' ? undefined : runner(stage);
      if (!run) return undefined;
      data = run(data);
    }
    return data;
  } catch (e) {
    if (e instanceof Unsupported || e instanceof ShellWordsUnsupported) return undefined;
    // A bug in a runner: let it show.
    /* c8 ignore next */
    throw e;
  }
}

/** Output of a stage that starts a pipeline without reading input (echo, printf, seq). */
function sourceOutput(stage: Stage): string[] | undefined {
  const w = stage.words;
  if (w.some((x) => x === undefined)) return undefined;
  const words = w as string[];
  switch (stage.cmd) {
    case 'echo': {
      // (`echo -n` prints its words with no newline: nothing at all when there are none.)
      const printed = words[0] === '-n' ? words.slice(1) : words;
      if (printed[0]?.startsWith('-')) return undefined;
      const line = printed.join(' ');
      return words[0] === '-n' && line === '' ? [] : [line];
    }
    case 'printf': {
      if (!words.length || words[0].startsWith('-')) return undefined;
      const out = bashPrintf(words[0], words.slice(1));
      const lines = out.split('\n');
      if (lines[lines.length - 1] === '') lines.pop();
      return lines;
    }
    case 'seq': return runSeq(words);
  }
  return undefined;
}

/** Sample input for the first stage that reads input. */
function sampleFor(stage: Stage, more = 0): string[] | undefined {
  const w = stage.words;
  switch (canonicalName(stage.cmd)) {
    case 'grep':
      return grepSample([...impliedWords(stage.cmd), ...w], more);
    case 'sed': {
      const a = sedArgs(w);
      return sedExample(a.script, { quiet: a.quiet, extended: a.extended })?.input;
    }
    case 'awk': {
      const a = awkArgs(w);
      return awkExample(a.program, a)?.input;
    }
    case 'perl': {
      const parsed = perlOptions(w);
      return parsed ? perlExample(parsed.code, parsed.opts)?.input : undefined;
    }
  }
  return sampleInput(stage.cmd, w, more) ?? ['banana', 'apple', 'cherry', 'apple'];
}

/** The most lines added to a sample to make the stages change the data. */
const MAX_MORE = 24;

/** The most lines the whole-pipeline example shows in a section; a grown sample must fit in it. */
export const MAX_SHOWN_LINES = 12;

/**
 * How many stages hand on exactly what they got (cat and tee are meant to); Infinity when the
 * input or a stage's output is too long to be shown whole.
 */
function inertStages(stages: Stage[], input: string[], limit = Infinity): number {
  let data = input;
  let n = 0;
  let longest = input.length;
  for (const stage of stages) {
    const run = runner(stage);
    if (!run) return 0;
    const out = run(data);
    longest = Math.max(longest, out.length);
    if (stage.cmd !== 'cat' && stage.cmd !== 'tee' && out.length === data.length && out.every((l, i) => l === data[i])) n++;
    data = out;
  }
  return longest > limit ? Infinity : n;
}

export interface PipelineStep {
  stage: Stage;
  output: string[];
  /** What the next stage that does not copy its input (cat) reads of `output` (`stageMarks`). */
  marks?: StageMarks;
}

export interface PipelineExample {
  input?: string[];
  /** What the first stage that does not copy its input reads of `input`. */
  inputMarks?: StageMarks;
  steps: PipelineStep[];
}

/**
 * Run every stage. `readsFile` says the first stage reads a file (cat file, < file), whose
 * contents are made up for the stage that consumes them.
 */
/** Run sample data (or `given`, the user's own input) through every stage. */
export function pipelineExample(stages: Stage[], readsFile: boolean, given?: string[]): PipelineExample | undefined {
  try {
    // (Given lines, one stage is enough: what `ps aux` prints, made up, is the input of the one after it.)
    if (stages.length < (given ? 1 : 2)) return undefined;
    let input: string[] | undefined;
    let rest = stages;
    const src = !readsFile ? sourceOutput(stages[0]) : undefined;
    const first = stages[0];
    // `cat FILE | …`: the stage shows the file. cat with an option (`cat -n f`) throws Unsupported, as its runner declines it.
    const firstIsCatFile = first.cmd === 'cat' && parseOptions('cat', first.words, {}).operands.some((x) => x !== '-');
    const steps: PipelineStep[] = [];
    if (src) {
      steps.push({ stage: first, output: src });
      rest = stages.slice(1);
    } else {
      // The data comes from a file: invent it for the first stage that processes it.
      const consumer = firstIsCatFile ? stages[1] : first;
      const wantsDuplicates = stages.some((s) => s.cmd === 'uniq' || (s.cmd === 'sort' && sortsUnique(s.words)));
      // (A sort the simulation cannot follow throws Unsupported there: it gives no example anyway.)
      const build = (more: number): string[] | undefined => {
        let lines = given ?? sampleFor(consumer, more);
        // Duplicates make uniq, sort -u and counting visible further down.
        if (lines && !given && wantsDuplicates) {
          const keep = consumer.cmd.endsWith('grep') ? runGrep(consumer.words, lines) : lines;
          if (keep.length) lines = [...lines, keep[0], keep[keep.length - 1], keep[0]];
        }
        return lines;
      };
      input = build(0);
      if (!input) return undefined;
      if (firstIsCatFile) rest = stages.slice(1);
      // A stage that leaves its data as it is (head -n 3 of 2 lines) teaches nothing: add lines
      // to the sample until every stage changes something, if a few more lines do it.
      if (!given) {
        let best = inertStages(rest, input);
        for (let more = 1; best > 0 && more <= MAX_MORE; more++) {
          const grown = build(more)!;
          const score = inertStages(rest, grown, MAX_SHOWN_LINES);
          if (score < best) {
            best = score;
            input = grown;
          }
        }
      }
      if (firstIsCatFile) steps.push({ stage: first, output: input });
    }
    let data = src ?? input!;
    let inputMarks: StageMarks | undefined;
    for (const [i, stage] of rest.entries()) {
      if (stage.cmd === 'xargs' && i !== rest.length - 1) return undefined;
      const run = runner(stage);
      if (!run) return undefined;
      const before = data;
      data = run(data);
      // The sections that show its input: the step before, and those before a stage that copies them (cat).
      const marks = stageMarks(stage, before);
      if (marks) {
        for (let j = steps.length - 1; j >= 0 && (j === steps.length - 1 || steps[j + 1].stage.copies); j--) steps[j].marks = marks;
        if (!src && steps.every((st) => st.stage.copies)) inputMarks = marks;
      }
      steps.push({ stage, output: data });
    }
    return { input: src ? undefined : input, ...(inputMarks ? { inputMarks } : {}), steps };
  } catch (e) {
    // (`printf '\231' | …`: bashPrintf has no raw bytes to show; it throws its own kind.)
    if (e instanceof Unsupported || e instanceof ShellWordsUnsupported) return undefined;
    // A bug in a runner: let it show.
    /* c8 ignore next */
    throw e;
  }
}
