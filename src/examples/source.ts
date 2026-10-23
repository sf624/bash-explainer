// Where a command reads the data its worked example shows: the files it names as its input, or its standard input,
// which a pipe, a redirection or a here-document gives. Decided here once, from the parse of the command's words
// (the operands and option values its spec marks with `io: 'input'`, src/argv/spec.ts) and from the syntax around the
// command, for every example that has an input (sed, awk, jq, yq, the text filters, xargs, a pipeline); and the
// labels of their input sections, made by one function.
import type { ArgvParse } from '../argv/interpret';
import { givenOptions } from '../argv/query';
import type { CommandSpec, EachFile, IoUse } from '../argv/spec';
import { pick } from '../embedded/types';
import type { Lang } from '../i18n';
import { field, type SyntaxNode } from '../syntax/tree';

/** Where a command's standard input comes from. */
export type Stdin =
  /** The output of the command before it in a pipeline: its lines, when the stages before it are known to print them. */
  | { from: 'pipe'; lines?: string[] }
  /** A file, `< b.json` (`name` as its word gives it). */
  | { from: 'file'; name: string }
  /** A here-string (`<<<`) or a here-document (`doc`): its text, as lines, when it is known. */
  | { from: 'here'; doc: boolean; lines?: string[] }
  /** Whatever the script was given (the terminal, a file, a pipe into the script). */
  | { from: 'unknown' };

/** One thing the command reads, in the order it reads them. */
export type Stream =
  /** A file named on the line; `many`: a word that may name any number of files (a glob, a word not known: `"$@"`). */
  | { kind: 'file'; name: string; many?: 'glob' | 'unknown' }
  | { kind: 'stdin'; stdin: Stdin };

/** What a command reads. */
export interface InputSource {
  /** In order; empty when it reads nothing (`jq -n`, `awk 'BEGIN { … }'`). */
  streams: Stream[];
  /** A standard input set up for the command (a pipe, `< b.json`) that it does not read, since it reads the files it names. */
  unread?: Stdin;
  /**
   * The stream each read takes, in order, when the command names a file twice (`sort a a` reads `a` twice): a file is
   * one stream, with the same contents each time; `-1`, the standard input read again, gives nothing more.
   */
  reads?: number[];
  /** How the command works on several files, when not as one stream (`EachFile`, from its spec and options). */
  each?: EachFile;
  /** Its program can read the name of each file (`CommandSpec.fileName`: awk's `FILENAME`). */
  fileName?: boolean;
  /** The file the command writes its output to instead of its standard output (`uniq IN OUT`, `sort -o OUT`). */
  writes?: string;
}

/** A word of the command line as the source reads it: its value when known, as written, and whether it may be many files. */
export interface SourceWord { value?: string; text: string; many?: 'glob' | 'unknown' }

/** A command that reads nothing: its example has no input section. */
export const NO_INPUT: InputSource = { streams: [] };

/** A word that names an input file: its index, and where the name starts in it when an option's word holds it (`-afile`). */
export interface InputWord { word: number; at?: number }

/** The words that name the files the command uses so (`io` of operands and option values), in order. */
function ioWords(parse: ArgvParse, io: IoUse): InputWord[] {
  const out: InputWord[] = [];
  for (const { word, role } of parse.roles) {
    if (role.role === 'operand' && role.spec?.io === io && !role.assignment) out.push({ word });
    else if (role.role === 'value' && role.spec?.io === io) out.push({ word });
    else {
      // A value in the option's word (`-afile`, `--arg-file=f`).
      const v = (role.role === 'cluster' ? role.letters : [role]).map((r) => (r.role === 'option' ? r.value : undefined)).find((x) => x?.spec?.io === io);
      if (v) out.push({ word, at: v.attached });
    }
  }
  return out;
}

/** The words that name the command's input files (`io: 'input'` operands and option values), in order. */
export function inputWords(parse: ArgvParse): InputWord[] {
  return ioWords(parse, 'input');
}

/** Whether the command reads a file it names (not `-`): then it does not read its standard input. */
export function readsFiles(parse: ArgvParse, words: (string | undefined)[]): boolean {
  return inputWords(parse).some(({ word, at }) => words[word]?.slice(at ?? 0) !== '-');
}

/**
 * How the command works on its input files (`EachFile`), from its spec and the options given: an option that rewrites
 * them wins over one that reads them apart, and either over the command's own way.
 */
function eachFileOf(parse: ArgvParse, spec: CommandSpec | undefined): EachFile | undefined {
  const given = givenOptions(parse).map(({ role }) => (role.role === 'option' ? role.spec.eachFile : undefined));
  return given.includes('in-place') ? 'in-place' : given.find((x) => x) ?? spec?.eachFile;
}

/**
 * What the command reads: the files `parse` names as its input (`-` is the standard input), or else its standard
 * input; `spec`, the command's, says how it works on several files. A file named twice is one stream read twice.
 */
export function inputSource(parse: ArgvParse, words: SourceWord[], stdin: Stdin, spec?: CommandSpec): InputSource {
  const out = ioWords(parse, 'write')[0];
  const writes = out ? { writes: (words[out.word].value ?? words[out.word].text).slice(out.at ?? 0) } : {};
  const named = inputWords(parse);
  if (!named.length) return { streams: [{ kind: 'stdin', stdin }], ...writes };
  const each = eachFileOf(parse, spec);
  const streams: Stream[] = [];
  const reads: number[] = [];
  const seen = new Map<string, number>();
  for (const { word, at = 0 } of named) {
    const w = words[word];
    const value = w.value?.slice(at);
    const st: Stream = value === '-' ? { kind: 'stdin', stdin } : { kind: 'file', name: value ?? w.text.slice(at), ...(w.many ? { many: w.many } : {}) };
    const key = st.kind === 'stdin' ? '-' : `f:${st.name}`;
    const before = seen.get(key);
    // The standard input read again is at its end: it gives nothing more (`-1`).
    if (before !== undefined) reads.push(st.kind === 'stdin' ? -1 : before);
    else {
      seen.set(key, streams.length);
      reads.push(streams.length);
      streams.push(st);
    }
  }
  const readsStdin = streams.some((s) => s.kind === 'stdin');
  return {
    streams,
    ...(reads.length > streams.length ? { reads } : {}),
    ...(each ? { each } : {}),
    ...(spec?.fileName ? { fileName: true } : {}),
    ...(!readsStdin && stdin.from !== 'unknown' ? { unread: stdin } : {}),
    ...writes,
  };
}

/** The contents the command reads, in order, from the contents of each stream (`reads`: a file named twice is read twice). */
export function readOrder<T>(src: InputSource, contents: T[][]): T[][] {
  return src.reads ? src.reads.map((i) => (i < 0 ? [] : contents[i])) : contents;
}

/** What the command reads, as the example shows it: the first file alone, for a command that works on each apart or rewrites each. */
export function shownSource(src: InputSource): InputSource {
  if (src.each !== 'apart' && src.each !== 'in-place') return src;
  const { reads: _reads, ...rest } = src;
  return { ...rest, streams: src.streams.slice(0, 1) };
}

const REDIRECTS = new Set(['file_redirect', 'heredoc_redirect', 'herestring_redirect']);

/**
 * Where the standard input of `cmd`, a command node, comes from: the last redirection of fd 0 it has (`< f`, `<<<`,
 * `<<`), or the stage before it in a pipeline. `literal` gives a word's value when it is known; `piped`, what the
 * stages of a pipeline before the one at `index` print, when it is known.
 */
export function stdinOf(cmd: SyntaxNode, literal: (n: SyntaxNode) => string | undefined, piped?: (pipeline: SyntaxNode, index: number) => string[] | undefined): Stdin {
  const outer = cmd.parent?.type === 'redirected_statement' && field(cmd.parent, 'body') === cmd ? cmd.parent : cmd;
  const redirs = [...cmd.namedChildren, ...(outer === cmd ? [] : outer.namedChildren)]
    .filter((r) => REDIRECTS.has(r.type)).sort((a, b) => a.startIndex - b.startIndex);
  let stdin: Stdin | undefined;
  for (const r of redirs) {
    const fd = field(r, 'descriptor')?.text ?? '';
    if (fd !== '' && fd !== '0') continue;
    if (r.type === 'herestring_redirect') {
      const word = r.namedChildren.find((c) => c.type !== 'file_descriptor');
      const text = word && literal(word);
      // (The shell adds a newline at the end.)
      stdin = { from: 'here', doc: false, ...(text !== undefined ? { lines: text.split('\n') } : {}) };
    } else if (r.type === 'heredoc_redirect') {
      // (While typing `cat <<`, there is no delimiter yet, nor a body.)
      const start = r.namedChildren.find((c) => c.type === 'heredoc_start')?.text ?? '';
      const body = r.namedChildren.find((c) => c.type === 'heredoc_body');
      // The body is as written when the delimiter is quoted, or when nothing in it is expanded or escaped.
      const known = start && body && (/['"\\]/.test(start) || (body.namedChildren.every((c) => c.type === 'heredoc_content') && !/[\\$`]/.test(body.text)));
      stdin = { from: 'here', doc: true, ...(known ? { lines: body.text.replace(/\n$/, '').split('\n') } : {}) };
    } else {
      const op = r.children.find((c) => !c.named)!.type;
      if (fd === '' && !op.startsWith('<')) continue;
      const dest = field(r, 'destination');
      // `<& 3`, `0>&-` and the like: not a file the example can name.
      stdin = (op === '<' || op === '<>') && dest ? { from: 'file', name: literal(dest) ?? dest.text } : { from: 'unknown' };
    }
  }
  if (stdin) return stdin;
  const p = outer.parent;
  if (p?.type !== 'pipeline' || p.namedChildren[0] === outer) return { from: 'unknown' };
  const lines = piped?.(p, p.namedChildren.indexOf(outer));
  return { from: 'pipe', ...(lines ? { lines } : {}) };
}

/**
 * The label of an input section: what is read and from where (`入力: \`a.json\`（中身の例）`). `readBy`: the jq function
 * that reads it (`inputs` under `-n`).
 */
export function streamLabel(stream: Stream, lang: Lang, readBy?: string): string {
  const s = pick(lang);
  const head = readBy ? s(`\`${readBy}\` が読む入力: `, `Input read by \`${readBy}\`: `) : s('入力: ', 'Input: ');
  if (stream.kind === 'file') {
    const name = `\`${stream.name}\``;
    if (stream.many === 'glob') return head + s(`${name} に一致するファイル（中身の例）`, `files matching ${name} (sample contents)`);
    if (stream.many) return head + s(`${name} のファイル（中身の例）`, `the files ${name} names (sample contents)`);
    return head + s(`${name}（中身の例）`, `${name} (sample contents)`);
  }
  const stdin = stream.stdin;
  switch (stdin.from) {
    case 'pipe': return head + (stdin.lines ? s('標準入力（前のコマンドの出力）', 'stdin (output of the previous command)') : s('標準入力（前のコマンドの出力の例）', 'stdin (sample output of the previous command)'));
    case 'file': return head + s(`標準入力（\`${stdin.name}\`、中身の例）`, `stdin (\`${stdin.name}\`, sample contents)`);
    case 'here': {
      const what = stdin.doc ? s('ヒアドキュメント', 'here-document') : s('ヒアストリング', 'here-string');
      return head + (stdin.lines ? s(`標準入力（${what}）`, `stdin (${what})`) : s(`標準入力（${what}、中身の例）`, `stdin (${what}, sample contents)`));
    }
    case 'unknown': return head + s('標準入力（中身の例）', 'stdin (sample contents)');
  }
}

/** The text of a stream when the line gives it (a here-string or a here-document of known text, or what a pipe brings of it). */
export function knownLines(stream: Stream): string[] | undefined {
  return stream.kind === 'stdin' && (stream.stdin.from === 'here' || stream.stdin.from === 'pipe') ? stream.stdin.lines : undefined;
}

/**
 * The contents of each stream: its own text when the line gives it, or else a part of the sample lines, which are
 * shared out in order among the streams that have none (several files read as one stream). With fewer lines than
 * such streams, each holds them all.
 */
export function shareOut(src: InputSource, sample: string[]): string[][] {
  const open = src.streams.filter((st) => !knownLines(st)).length;
  if (sample.length < open) return src.streams.map((st) => knownLines(st) ?? sample);
  let k = 0;
  let from = 0;
  return src.streams.map((st) => {
    const known = knownLines(st);
    if (known) return known;
    const size = Math.ceil((sample.length - from) / (open - k++));
    const part = sample.slice(from, from + size);
    from += size;
    return part;
  });
}
