/** Run a whole pipeline of supported commands on sample input, keeping every stage's output. */
import { awkExample, awkInvocation, runAwk } from './awk';
import { utf8Length } from './bytes';
import { perlExample, perlOptions, runPerl } from './perlrun';
import { grepWrap, JsRegex, literalRegex, regexExamples, toJsRegex } from './regex';
import { runSed, sedExample } from './sed';
import { bashPrintf, ShellWordsUnsupported } from './shellwords';
import { FILTERS, parseOptions, runSeq, sampleInput, Unsupported } from './textfilters';
import { runXargs, showCommand } from './runtime';
import type { ArgvParse } from '../argv/interpret';
import { operands } from '../argv/query';

export interface Stage {
  cmd: string;
  /** Argument words (undefined when not literal). */
  words: (string | undefined)[];
  /** The stage as written, for labels. */
  text: string;
}

type Runner = (input: string[]) => string[];

// ---------------------------------------------------------------- grep

const GREP = {
  flags: 'ivcnowxEFPGsqHhz',
  values: 'em',
  long: {
    'ignore-case': 'i', 'invert-match': 'v', count: 'c', 'line-number': 'n', 'only-matching': 'o', 'word-regexp': 'w', 'line-regexp': 'x',
    'extended-regexp': 'E', 'fixed-strings': 'F', 'perl-regexp': 'P', 'basic-regexp': 'G', 'no-messages': 's', quiet: 'q', silent: 'q',
    regexp: 'e', 'max-count': 'm', 'no-filename': 'h', 'with-filename': 'H',
  },
};

function grepRegexes(words: (string | undefined)[], relax = false): { res: JsRegex[]; p: ReturnType<typeof parseOptions> } {
  const p = parseOptions(words, GREP);
  const has = (c: string) => p.opts.some(([n]) => n === c);
  if (has('z') || has('H')) throw new Unsupported('grep option');
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

export function runGrep(words: (string | undefined)[], input: string[]): string[] {
  const { res, p } = grepRegexes(words);
  const has = (c: string) => p.opts.some(([n]) => n === c);
  const max = p.opts.find(([n]) => n === 'm')?.[1];
  const limit = max !== undefined ? Number(max) : Infinity;
  const out: string[] = [];
  let count = 0;
  for (const [i, line] of input.entries()) {
    if (count >= limit) break;
    const hit = res.some((r) => new RegExp(r.source, r.flags).test(line));
    if (hit === has('v')) continue;
    count++;
    if (has('q') || has('c')) continue;
    const prefix = has('n') ? `${i + 1}:` : '';
    // `-o -v` prints nothing: the selected lines have no match to print.
    if (has('o')) {
      if (!has('v')) for (const r of res) for (const m of line.matchAll(new RegExp(r.source, r.flags + 'g'))) if (m[0]) out.push(prefix + m[0]);
    } else out.push(prefix + line);
  }
  if (has('q')) return [];
  return has('c') ? [String(count)] : out;
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

function sedArgs(words: (string | undefined)[]): { script: string; quiet: boolean; extended: boolean } {
  const scripts: string[] = [];
  let quiet = false;
  let extended = false;
  const operands: (string | undefined)[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === undefined) throw new Unsupported('non-literal');
    if (w === '-e' || w === '--expression') { const v = words[++i]; if (v === undefined) throw new Unsupported('-e'); scripts.push(v); continue; }
    if (w.startsWith('--expression=')) { scripts.push(w.slice(13)); continue; }
    if (w === '-n' || w === '--quiet' || w === '--silent') { quiet = true; continue; }
    if (w === '-E' || w === '-r' || w === '--regexp-extended') { extended = true; continue; }
    if (/^-[nErse]+$/.test(w)) {
      if (w.includes('n')) quiet = true;
      if (/[Er]/.test(w)) extended = true;
      if (w.endsWith('e')) { const v = words[++i]; if (v === undefined) throw new Unsupported('-e'); scripts.push(v); }
      continue;
    }
    if (/^-i/.test(w) || w === '-s' || w === '-u') continue;
    if (w.startsWith('-')) throw new Unsupported(`sed ${w}`);
    operands.push(w);
  }
  if (!scripts.length) {
    const first = operands.shift();
    if (first === undefined) throw new Unsupported('script');
    scripts.push(first);
  }
  return { script: scripts.join('\n'), quiet, extended };
}

function awkArgs(words: (string | undefined)[]): { program: string; fs?: string; vars: Record<string, string>; assigns: Record<string, string> } {
  const a = awkInvocation(words);
  if (a.unsupported !== undefined) throw new Unsupported(a.unsupported);
  if (a.program === undefined) throw new Unsupported('program');
  return { program: a.program, fs: a.fs, vars: a.vars, assigns: a.assigns };
}

function runWc(words: (string | undefined)[], input: string[]): string[] {
  const p = parseOptions(words, { flags: 'lwcmL', values: '', long: { lines: 'l', words: 'w', bytes: 'c', chars: 'm' } });
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

/** A runner for one stage, or undefined if the command is not supported. */
export function runner(stage: Stage): Runner | undefined {
  const w = stage.words;
  switch (stage.cmd) {
    case 'grep': case 'egrep': case 'fgrep': {
      const words = stage.cmd === 'egrep' ? ['-E', ...w] : stage.cmd === 'fgrep' ? ['-F', ...w] : w;
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
    case 'awk': case 'gawk': case 'mawk': {
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
    case 'cat': case 'tee':
      if (stage.cmd === 'cat' && w.some((x) => x !== '-' && x !== undefined && !x.startsWith('-'))) return undefined;
      return (input) => input;
    case 'tac': return (input) => [...input].reverse();
    case 'rev': return (input) => input.map((l) => [...l].reverse().join(''));
    case 'wc': return (input) => runWc(w, input);
    case 'xargs': return (input) => runXargs(w, input.map((l) => l + '\n').join('')).map(showCommand);
  }
  const f = FILTERS[stage.cmd];
  return f && ((input) => f(w, input));
}

/** Output of a stage that starts a pipeline without reading input (echo, printf, seq). */
function sourceOutput(stage: Stage): string[] | undefined {
  const w = stage.words;
  if (w.some((x) => x === undefined)) return undefined;
  const words = w as string[];
  switch (stage.cmd) {
    case 'echo':
      if (words[0]?.startsWith('-')) return undefined;
      return [words.join(' ')];
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
  switch (stage.cmd) {
    case 'grep': case 'egrep': case 'fgrep':
      return grepSample(stage.cmd === 'egrep' ? ['-E', ...w] : stage.cmd === 'fgrep' ? ['-F', ...w] : w, more);
    case 'sed': {
      const a = sedArgs(w);
      return sedExample(a.script, { quiet: a.quiet, extended: a.extended })?.input;
    }
    case 'awk': case 'gawk': case 'mawk': {
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

/**
 * Whether a stage names a file to read (grep PATTERN FILE, sort FILE, cat FILE…), from the operands of `parse`, the
 * parse of its words: then it does not read its standard input. `-` names the standard input.
 */
export function readsFileOperand(stage: Stage, parse: ArgvParse): boolean {
  const named = operands(parse).filter(({ word, role }) => stage.words[word] !== '-' && !role.assignment);
  // The first operand (`ARG1`) of these is the pattern, script or program, unless an option gives it (`-e`, `-f`):
  // then the operands start at the second (src/dict/types.ts, `fills`). awk's `NAME=value` operands are assignments.
  const program = new Set(operands(parse, 'ARG1').map(({ word }) => word));
  switch (stage.cmd) {
    case 'grep': case 'egrep': case 'fgrep': case 'sed': case 'awk': case 'gawk': case 'mawk': case 'perl':
      return named.some(({ word }) => !program.has(word));
    // tee writes to the files it names.
    case 'tr': case 'echo': case 'printf': case 'seq': case 'xargs': case 'tee': return false;
    default: return named.length > 0;
  }
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
}

export interface PipelineExample {
  input?: string[];
  steps: PipelineStep[];
}

/**
 * Run every stage. `readsFile` says the first stage reads a file (cat file, < file), whose
 * contents are made up for the stage that consumes them.
 */
/** Run sample data (or `given`, the user's own input) through every stage. */
export function pipelineExample(stages: Stage[], readsFile: boolean, given?: string[]): PipelineExample | undefined {
  try {
    if (stages.length < 2) return undefined;
    let input: string[] | undefined;
    let rest = stages;
    const src = !readsFile ? sourceOutput(stages[0]) : undefined;
    const first = stages[0];
    const firstIsCatFile = first.cmd === 'cat' && first.words.some((x) => x === undefined || (x !== '-' && !x.startsWith('-')));
    const steps: PipelineStep[] = [];
    if (src) {
      steps.push({ stage: first, output: src });
      rest = stages.slice(1);
    } else {
      // The data comes from a file: invent it for the first stage that processes it.
      const consumer = firstIsCatFile ? stages[1] : first;
      const wantsDuplicates = stages.some((s) => s.cmd === 'uniq' || (s.cmd === 'sort' && s.words.some((x) => /^-[a-zA-Z]*u/.test(x ?? ''))));
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
    for (const [i, stage] of rest.entries()) {
      if (stage.cmd === 'xargs' && i !== rest.length - 1) return undefined;
      const run = runner(stage);
      if (!run) return undefined;
      data = run(data);
      steps.push({ stage, output: data });
    }
    return { input: src ? undefined : input, steps };
  } catch (e) {
    // (`printf '\231' | …`: bashPrintf has no raw bytes to show; it throws its own kind.)
    if (e instanceof Unsupported || e instanceof ShellWordsUnsupported) return undefined;
    // A bug in a runner: let it show.
    /* c8 ignore next */
    throw e;
  }
}
