// Where a command reads the data its worked example shows: the files it names as its input, or its standard input,
// which a pipe, a redirection or a here-document gives. Decided here once, from the parse of the command's words
// (the operands and option values its spec marks with `io: 'input'`, src/argv/spec.ts) and from the syntax around the
// command, for every example that has an input (sed, awk, jq, yq, the text filters, xargs, a pipeline); and the
// labels of their input sections, made by one function.
import type { ArgvParse } from '../argv/interpret';
import { pick } from '../embedded/types';
import type { Lang } from '../i18n';
import { field, type SyntaxNode } from '../syntax/tree';

/** Where a command's standard input comes from. */
export type Stdin =
  /** The output of the command before it in a pipeline. */
  | { from: 'pipe' }
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
}

/** A word of the command line as the source reads it: its value when known, as written, and whether it may be many files. */
export interface SourceWord { value?: string; text: string; many?: 'glob' | 'unknown' }

/** A command that reads nothing: its example has no input section. */
export const NO_INPUT: InputSource = { streams: [] };

/** A word that names an input file: its index, and where the name starts in it when an option's word holds it (`-afile`). */
export interface InputWord { word: number; at?: number }

/** The words that name the command's input files (`io: 'input'` operands and option values), in order. */
export function inputWords(parse: ArgvParse): InputWord[] {
  const out: InputWord[] = [];
  for (const { word, role } of parse.roles) {
    if (role.role === 'operand' && role.spec?.io === 'input' && !role.assignment) out.push({ word });
    else if (role.role === 'value' && role.spec?.io === 'input') out.push({ word });
    else {
      // A value in the option's word (`-afile`, `--arg-file=f`).
      const v = (role.role === 'cluster' ? role.letters : [role]).map((r) => (r.role === 'option' ? r.value : undefined)).find((x) => x?.spec?.io === 'input');
      if (v) out.push({ word, at: v.attached });
    }
  }
  return out;
}

/** Whether the command reads a file it names (not `-`): then it does not read its standard input. */
export function readsFiles(parse: ArgvParse, words: (string | undefined)[]): boolean {
  return inputWords(parse).some(({ word, at }) => words[word]?.slice(at ?? 0) !== '-');
}

/** What the command reads: the files `parse` names as its input (`-` is the standard input), or else its standard input. */
export function inputSource(parse: ArgvParse, words: SourceWord[], stdin: Stdin): InputSource {
  const named = inputWords(parse);
  if (!named.length) return { streams: [{ kind: 'stdin', stdin }] };
  const streams: Stream[] = named.map(({ word, at = 0 }) => {
    const w = words[word];
    const value = w.value?.slice(at);
    if (value === '-') return { kind: 'stdin', stdin };
    return { kind: 'file', name: value ?? w.text.slice(at), ...(w.many ? { many: w.many } : {}) };
  });
  const readsStdin = streams.some((s) => s.kind === 'stdin');
  return { streams, ...(!readsStdin && stdin.from !== 'unknown' ? { unread: stdin } : {}) };
}

const REDIRECTS = new Set(['file_redirect', 'heredoc_redirect', 'herestring_redirect']);

/**
 * Where the standard input of `cmd`, a command node, comes from: the last redirection of fd 0 it has (`< f`, `<<<`,
 * `<<`), or the stage before it in a pipeline. `literal` gives a word's value when it is known.
 */
export function stdinOf(cmd: SyntaxNode, literal: (n: SyntaxNode) => string | undefined): Stdin {
  const outer = cmd.parent?.type === 'redirected_statement' && field(cmd.parent, 'body') === cmd ? cmd.parent : cmd;
  const redirs = [...cmd.namedChildren, ...(outer === cmd ? [] : outer.namedChildren)]
    .filter((r) => REDIRECTS.has(r.type)).sort((a, b) => a.startIndex - b.startIndex);
  let stdin: Stdin | undefined;
  for (const r of redirs) {
    const fd = field(r, 'descriptor')?.text ?? '';
    if (fd !== '' && fd !== '0') continue;
    if (r.type === 'herestring_redirect') {
      const word = r.namedChildren[0];
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
  return p?.type === 'pipeline' && p.namedChildren[0] !== outer ? { from: 'pipe' } : { from: 'unknown' };
}

/** The label of an input section: what is read and from where (`入力: \`a.json\`（中身の例）`). */
export function streamLabel(stream: Stream, lang: Lang): string {
  const s = pick(lang);
  const head = s('入力: ', 'Input: ');
  if (stream.kind === 'file') {
    const name = `\`${stream.name}\``;
    if (stream.many === 'glob') return head + s(`${name} に一致するファイル（中身の例）`, `files matching ${name} (sample contents)`);
    if (stream.many) return head + s(`${name} のファイル（中身の例）`, `the files ${name} names (sample contents)`);
    return head + s(`${name}（中身の例）`, `${name} (sample contents)`);
  }
  const stdin = stream.stdin;
  switch (stdin.from) {
    case 'pipe': return head + s('標準入力（前のコマンドの出力の例）', 'stdin (sample output of the previous command)');
    case 'file': return head + s(`標準入力（\`${stdin.name}\`、中身の例）`, `stdin (\`${stdin.name}\`, sample contents)`);
    case 'here': {
      const what = stdin.doc ? s('ヒアドキュメント', 'here-document') : s('ヒアストリング', 'here-string');
      return head + (stdin.lines ? s(`標準入力（${what}）`, `stdin (${what})`) : s(`標準入力（${what}、中身の例）`, `stdin (${what}, sample contents)`));
    }
    case 'unknown': return head + s('標準入力（中身の例）', 'stdin (sample contents)');
  }
}

/** The text of a stream when the line gives it (a here-string or a here-document of known text). */
export function knownLines(stream: Stream): string[] | undefined {
  return stream.kind === 'stdin' && stream.stdin.from === 'here' ? stream.stdin.lines : undefined;
}

/**
 * The contents of each stream: its own text when the line gives it, or else a part of the sample lines, which are
 * shared out in order among the streams that have none (several files read as one stream).
 */
export function shareOut(src: InputSource, sample: string[]): string[][] {
  const open = src.streams.filter((st) => !knownLines(st)).length;
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
