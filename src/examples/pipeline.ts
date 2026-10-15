/** Run a whole pipeline of supported commands on sample input, keeping every stage's output. */
import { awkExample, runAwk } from './awk';
import { perlExample, perlOptions, runPerl } from './perlrun';
import { grepWrap, JsRegex, literalRegex, regexExamples, toJsRegex } from './regex';
import { runSed, sedExample } from './sed';
import { bashPrintf } from './shellwords';
import { FILTERS, parseOptions, runSeq, sampleInput, Unsupported } from './textfilters';
import { runXargs, showCommand } from './runtime';

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

function grepRegexes(words: (string | undefined)[]): { res: JsRegex[]; p: ReturnType<typeof parseOptions> } {
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
    const js = has('F') ? literalRegex(pat, has('i')) : toJsRegex(pat, flavor, { ignoreCase: has('i') });
    if (!js) throw new Unsupported('regex');
    return grepWrap(js, has('x'), has('w'));
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
    if (has('o') && !has('v')) {
      for (const r of res) for (const m of line.matchAll(new RegExp(r.source, r.flags + 'g'))) if (m[0]) out.push(prefix + m[0]);
    } else out.push(prefix + line);
  }
  if (has('q')) return [];
  return has('c') ? [String(count)] : out;
}

function grepSample(words: (string | undefined)[]): string[] | undefined {
  const { res, p } = grepRegexes(words);
  const ex = regexExamples(res[0], 3);
  if (!ex) return undefined;
  const yes = ex.matching.filter((x) => !/^abc |\sxyz$/.test(x)).concat(ex.matching.filter((x) => /^abc |\sxyz$/.test(x)));
  const no = ex.nonMatching.length ? ex.nonMatching : ['other line'];
  const lines = [no[0], yes[0], yes[1] ?? yes[0], no[1] ?? no[0], yes[2] ?? yes[0]];
  void p;
  return [...new Set(lines)];
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

function awkArgs(words: (string | undefined)[]): { program: string; fs?: string; vars: Record<string, string> } {
  let fs: string | undefined;
  const vars: Record<string, string> = {};
  let i = 0;
  for (; i < words.length; i++) {
    const w = words[i];
    if (w === undefined) throw new Unsupported('non-literal');
    if (w === '-F') { fs = words[++i]; continue; }
    if (/^-F./.test(w)) { fs = w.slice(2); continue; }
    if (w === '-v' || /^-v./.test(w)) {
      const v = w === '-v' ? words[++i] : w.slice(2);
      const eq = v?.indexOf('=') ?? -1;
      if (!v || eq < 1) throw new Unsupported('-v');
      vars[v.slice(0, eq)] = v.slice(eq + 1);
      continue;
    }
    if (w === '--') { i++; break; }
    if (w.startsWith('-')) throw new Unsupported(`awk ${w}`);
    break;
  }
  const program = words[i];
  if (program === undefined) throw new Unsupported('program');
  if (fs !== undefined) fs = fs === 't' ? '\t' : fs.replace(/\\t/g, '\t');
  return { program, fs, vars };
}

function runWc(words: (string | undefined)[], input: string[]): string[] {
  const p = parseOptions(words, { flags: 'lwcmL', values: '', long: { lines: 'l', words: 'w', bytes: 'c', chars: 'm' } });
  if (p.operands.length) throw new Unsupported('wc files');
  const text = input.map((l) => l + '\n').join('');
  const counts: Record<string, number> = {
    l: input.length, w: text.split(/\s+/).filter(Boolean).length, c: Buffer.byteLength(text), m: [...text].length,
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
        const out = runAwk(a.program, input, { fs: a.fs, vars: a.vars });
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
function sampleFor(stage: Stage): string[] | undefined {
  const w = stage.words;
  switch (stage.cmd) {
    case 'grep': case 'egrep': case 'fgrep':
      return grepSample(stage.cmd === 'egrep' ? ['-E', ...w] : stage.cmd === 'fgrep' ? ['-F', ...w] : w);
    case 'sed': {
      const a = sedArgs(w);
      return sedExample(a.script, { quiet: a.quiet, extended: a.extended })?.input;
    }
    case 'awk': case 'gawk': case 'mawk': {
      const a = awkArgs(w);
      return awkExample(a.program, { fs: a.fs, vars: a.vars })?.input;
    }
    case 'perl': {
      const parsed = perlOptions(w);
      return parsed ? perlExample(parsed.code, parsed.opts)?.input : undefined;
    }
  }
  return sampleInput(stage.cmd, w) ?? ['banana', 'apple', 'cherry', 'apple'];
}

/** Whether the first stage names a file to read (grep PATTERN FILE, sort FILE, cat FILE…). */
export function readsFileOperand(stage: Stage): boolean {
  const w = stage.words;
  // Options whose value is the next word, per command.
  const takesValue: Record<string, RegExp> = {
    grep: /^-[efmABCd]$/, egrep: /^-[efmABCd]$/, fgrep: /^-[efmABCd]$/, sed: /^-[ef]$/, awk: /^-[Ffv]$/, gawk: /^-[Ffv]$/, mawk: /^-[Ffv]$/,
    perl: /^-\w*[eE]$/, sort: /^-[tkoS]$/, cut: /^-[dfcb]$/, head: /^-[nc]$/, tail: /^-[nc]$/, uniq: /^-[fsw]$/,
  };
  const value = takesValue[stage.cmd];
  const operands = w.filter((x, i) => (x === undefined || !x.startsWith('-')) && !(value && value.test(w[i - 1] ?? '')));
  const inline = w.some((x) => /^-[ef]$/.test(x ?? '') || (stage.cmd === 'perl' && /^-\w*[eE]$/.test(x ?? '')));
  switch (stage.cmd) {
    case 'grep': case 'egrep': case 'fgrep': case 'sed': case 'awk': case 'gawk': case 'mawk': case 'perl':
      // The first operand is the pattern, script or program unless given with -e / -f.
      return operands.length > (inline ? 0 : 1);
    case 'tr': case 'echo': case 'printf': case 'seq': case 'xargs': return false;
    default: return operands.length > 0;
  }
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
export function pipelineExample(stages: Stage[], readsFile: boolean): PipelineExample | undefined {
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
      input = sampleFor(consumer);
      if (!input) return undefined;
      // Duplicates make uniq, sort -u and counting visible further down.
      if (stages.some((s) => s.cmd === 'uniq' || (s.cmd === 'sort' && s.words.some((x) => /^-[a-zA-Z]*u/.test(x ?? ''))))) {
        const keep = consumer.cmd.endsWith('grep') ? runGrep(consumer.words, input) : input;
        if (keep.length) input = [...input, keep[0], keep[keep.length - 1], keep[0]];
      }
      if (firstIsCatFile) {
        steps.push({ stage: first, output: input });
        rest = stages.slice(1);
      }
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
    if (e instanceof Unsupported) return undefined;
    throw e;
  }
}
