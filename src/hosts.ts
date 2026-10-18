import { azureVariables as AZURE_VARIABLES, ciVariables, githubContext } from './dict/ciVariables';
import type { ExplainOptions, LineExplanation, Pos, Token } from './analyzer';
import { dialectIssues, Shell } from './dialect';
import type { SyntaxNode, SyntaxTree } from './syntax/tree';

/** Kinds of files whose shell snippets are explained. */
export type HostKind = 'dockerfile' | 'makefile' | 'yaml' | 'npm' | 'markdown' | 'python' | 'jenkinsfile';

/** A run of lines holding shell code inside another kind of file. */
export interface ShellRegion {
  start: number;
  end: number;
  /** What the snippet is, e.g. "Dockerfile RUN" (ja, en). */
  label: [string, string];
  shell?: Shell;
  /** Notes shown on every line of the region. */
  /** [ja, en, code]: a code makes the note a warning in the Problems panel. */
  notes?: [string, string, string?][];
  /** A Docker RUN without `pipefail`: a failure inside a pipe does not fail the build. */
  warnPipefail?: boolean;
}

/** Something the host replaces before the shell sees it (`$(CC)` in make, `${{ … }}` in GitHub Actions). */
export interface HostSubstitution {
  line: number;
  text: string;
  meaning: [string, string];
  /** A warning about the substitution (e.g. untrusted input pasted into a script). */
  warning?: [string, string];
}

/**
 * The shell code of a document, line for line: lines outside the snippets are empty, and host
 * syntax is rewritten into plain shell. `maps[line][col]` gives the original column of each
 * character (with one extra entry for the end of the line).
 */
export interface Extracted {
  text: string;
  maps: number[][];
  /** Per line, the ranges of the shell text that replace host syntax (`${CC}` for `$(CC)`). */
  inserted: [number, number, [string, string]?][][];
  regions: ShellRegion[];
  substitutions: HostSubstitution[];
}

/** Japanese text followed by more: a space after a closing backtick, so the code span ends. */
const spaced = (ja: string) => (ja.endsWith('`') ? `${ja} ` : ja);

/** Which kind of host a document is, from its language id and file name. */
export function hostKind(languageId: string, fileName: string): HostKind | undefined {
  const base = fileName.split(/[\\/]/).pop()!;
  if (languageId === 'dockerfile' || /^(Dockerfile|Containerfile)(\..*)?$|\.(dockerfile|containerfile)$/i.test(base)) return 'dockerfile';
  if (languageId === 'makefile' || /^(GNU)?makefile$|\.mk$/i.test(base)) return 'makefile';
  if (base === 'package.json') return 'npm';
  if (languageId === 'yaml' || languageId === 'github-actions-workflow' || /\.ya?ml$/i.test(base)) return 'yaml';
  if (languageId === 'markdown' || /\.md$/i.test(base)) return 'markdown';
  if (languageId === 'python' || /\.py$/i.test(base)) return 'python';
  if (languageId === 'jenkinsfile' || /^Jenkinsfile(\..*)?$|\.jenkinsfile$/i.test(base)) return 'jenkinsfile';
  return undefined;
}

/** Builds the shell text of one line from pieces of the original line and inserted text. */
class LineOut {
  text = '';
  map: number[] = [];
  /** Original end (exclusive) of each character. */
  ends: number[] = [];
  /** Ranges [start, end) of the shell text that stand in for host syntax, with what it means. */
  inserted: [number, number, [string, string]?][] = [];
  /** Copy original columns [from, to). */
  copy(line: string, from: number, to: number): void {
    for (let i = from; i < to; i++) {
      this.text += line[i];
      this.map.push(i);
      this.ends.push(i + 1);
    }
  }
  /** Insert `text` standing for original columns [from, to). */
  insert(text: string, from: number, to: number, meaning?: [string, string]): void {
    if (text.length > 1) this.inserted.push([this.text.length, this.text.length + text.length, meaning]);
    for (let i = 0; i < text.length; i++) {
      this.text += text[i];
      this.map.push(from);
      this.ends.push(to);
    }
  }
  finish(end: number): number[] {
    // The end of the shell text is just after the last character it came from.
    return [...this.map, this.ends.length ? this.ends[this.ends.length - 1] : end];
  }
}

class Builder {
  lines: string[];
  outs: (LineOut | undefined)[];
  regions: ShellRegion[] = [];
  substitutions: HostSubstitution[] = [];
  /** Azure Pipelines: variables whose `$(name)` macros the pipeline replaces before the script runs. */
  azure?: { vars: Set<string> };
  constructor(text: string) {
    this.lines = text.split(/\r?\n/);
    this.outs = this.lines.map(() => undefined);
  }
  /** Use original columns [from, to) of `line` as shell code, unchanged. */
  plain(line: number, from = 0, to = this.lines[line].length): LineOut {
    const o = (this.outs[line] ??= new LineOut());
    o.copy(this.lines[line], from, to);
    return o;
  }
  region(start: number, end: number, label: [string, string], shell?: Shell, notes?: [string, string, string?][], warnPipefail?: boolean): void {
    if (end >= start) this.regions.push({ start, end, label, shell, notes, warnPipefail });
  }
  build(): Extracted {
    const maps = this.lines.map((l, i) => this.outs[i]?.finish(l.length) ?? [l.length]);
    return { text: this.outs.map((o) => o?.text ?? '').join('\n'), maps, inserted: this.outs.map((o) => o?.inserted ?? []), regions: this.regions, substitutions: this.substitutions };
  }
}

export function extractShell(kind: HostKind, text: string): Extracted {
  const b = new Builder(text);
  switch (kind) {
    case 'dockerfile': dockerfile(b); break;
    case 'makefile': makefile(b); break;
    case 'yaml': yaml(b); break;
    case 'npm': npm(b); break;
    case 'markdown': markdown(b); break;
    case 'python': python(b); break;
    case 'jenkinsfile': jenkinsfile(b); break;
  }
  return b.build();
}

// ---------------------------------------------------------------- Dockerfile

/** One string of a JSON array (the exec form), with the original column of each character. */
interface JsonWord {
  line: number; start: number; end: number; value: string; cols: number[];
  /** Not a literal: shell text standing for the value of a host expression, and what it means. */
  placeholder?: [string, [string, string]];
}

/** Parse a JSON array of strings starting at `[` on `line`, possibly continued with `\`. */
function jsonWords(lines: string[], line: number, at: number): { words: JsonWord[]; last: number } | undefined {
  const words: JsonWord[] = [];
  let i = line;
  let k = at + 1;
  for (;;) {
    const l = lines[i];
    while (k < l.length && /[\s,]/.test(l[k])) k++;
    if (k >= l.length || (l[k] === '\\' && !l.slice(k + 1).trim())) {
      if (++i >= lines.length) return undefined;
      k = 0;
      continue;
    }
    if (l[k] === ']') return { words, last: i };
    if (l[k] !== '"') return undefined;
    const w: JsonWord = { line: i, start: k, end: k, value: '', cols: [] };
    for (k++; k < l.length && l[k] !== '"'; k++) {
      if (l[k] === '\\') {
        const e = l[++k];
        w.value += e === 'n' ? '\n' : e === 't' ? '\t' : e;
        w.cols.push(k - 1);
      } else {
        w.value += l[k];
        w.cols.push(k);
      }
    }
    if (l[k] !== '"') return undefined;
    w.end = ++k;
    words.push(w);
  }
}

/** Write exec-form words as shell words, each at its own columns. */
function execWords(b: Builder, words: JsonWord[]): void {
  words.forEach((w, n) => {
    const o = (b.outs[w.line] ??= new LineOut());
    const next = words[n + 1];
    const char = (c: number) => o.insert(w.value[c], w.cols[c], w.cols[c] + 1);
    if (w.placeholder) {
      o.insert(w.placeholder[0], w.start, w.end, w.placeholder[1]);
    } else if (/^[\w@%+=:,./-]+$/.test(w.value)) {
      // A plain word reads the same to the shell, so commands and options are recognised.
      // The first and last characters stand for the quotes too, so the word covers `"echo"`.
      const last = w.value.length - 1;
      for (let c = 0; c <= last; c++) o.insert(w.value[c], c === 0 ? w.start : w.cols[c], c === last ? w.end : w.cols[c] + 1);
    } else if (/[\n\r\t]/.test(w.value)) {
      // Control characters as `$'…'` escapes: a newline must not start a new line of shell text.
      const esc: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t', "'": "\\'", '\\': '\\\\' };
      o.insert("$'", w.start, w.start + 1);
      for (let c = 0; c < w.value.length; c++) o.insert(esc[w.value[c]] ?? w.value[c], w.cols[c], w.cols[c] + 1);
      o.insert("'", w.end - 1, w.end);
    } else {
      // Single quotes keep every character literal, as the exec form does; `'` becomes `'\''`.
      o.insert("'", w.start, w.start + 1);
      for (let c = 0; c < w.value.length; c++) {
        if (w.value[c] === "'") o.insert("'\\''", w.cols[c], w.cols[c] + 1);
        else char(c);
      }
      o.insert("'", w.end - 1, w.end);
    }
    if (next && next.line === w.line) o.insert(' ', w.end, next.start);
    else if (next) o.insert(' \\', w.end, w.end);
  });
}

const SHELLS = /^(sh|bash|dash|ash|zsh|ksh|ksh93|mksh|yash|busybox)$/;

function dockerfile(b: Builder): void {
  // `SHELL ["/bin/bash", "-o", "pipefail", "-c"]` changes the shell of later shell-form instructions.
  // Each stage (`FROM`) starts again with the default: `/bin/sh -c`, or `cmd /S /C` on Windows images.
  let shell: Shell = 'sh';
  let pipefail = false;
  /** Shell-form instructions run with PowerShell or cmd, not a POSIX shell: they are not explained. */
  let notShell = false;
  for (let i = 0; i < b.lines.length; i++) {
    const line = b.lines[i];
    const from = /^\s*FROM\s+(?:--[\w-]+(?:=\S*)?\s+)*(\S+)/i.exec(line);
    if (from) {
      shell = 'sh';
      pipefail = false;
      notShell = /mcr\.microsoft\.com\/(windows|powershell)|\b(windowsservercore|nanoserver|servercore|ltsc\d{4})\b/i.test(from[1]);
      continue;
    }
    const m = /^(\s*)(RUN|CMD|ENTRYPOINT|SHELL)(\s+(?:--[\w-]+(?:=\S*)?\s+)*)/i.exec(line);
    if (!m) continue;
    const at = m[0].length;
    const instr = m[2].toUpperCase();
    if (/^\[\s*"/.test(line.slice(at))) {
      // Starting with `[ "`, a list that parses has a word.
      const parsed = jsonWords(b.lines, i, at);
      if (!parsed) continue;
      const { words, last } = parsed;
      const prog = words[0].value.split('/').pop()!;
      if (instr === 'SHELL') {
        notShell = /^(powershell|pwsh|cmd)(\.exe)?$/i.test(prog);
        if (notShell) { i = last; continue; }
        shell = prog === 'bash' ? 'bash' : prog === 'zsh' ? 'zsh' : prog === 'ash' || prog === 'busybox' ? 'ash' : 'sh';
        pipefail = words.some((w, n) => w.value === 'pipefail' && /^-\w*o$/.test(words[n - 1]?.value ?? ''));
        execWords(b, words);
        b.region(i, last, ['Dockerfile の SHELL', 'Dockerfile SHELL'], 'bash', [[
          '以降の RUN・CMD・ENTRYPOINT のシェル形式は、このコマンドの最後に命令の内容を付けて実行されます（例: `/bin/bash -o pipefail -c "<RUN の内容>"`）。',
          'Later shell-form RUN, CMD and ENTRYPOINT instructions run with this command, followed by their text (e.g. `/bin/bash -o pipefail -c "<RUN text>"`).',
        ]]);
        i = last;
        continue;
      }
      // `RUN ["sh", "-c", "script"]`: the string after `-c` is a shell script.
      const c = words.findIndex((w, n) => n > 0 && /^-\w*c$/.test(w.value));
      if (SHELLS.test(prog) && c > 0 && words[c + 1]) {
        const script = words[c + 1];
        const o = (b.outs[script.line] ??= new LineOut());
        for (let k = 0; k < script.value.length; k++) o.insert(script.value[k], script.cols[k], script.cols[k] + 1);
        const target: Shell = prog === 'bash' ? 'bash' : prog === 'zsh' ? 'zsh' : prog === 'dash' ? 'dash' : prog === 'ash' || prog === 'busybox' ? 'ash' : prog === 'mksh' ? 'mksh' : /^ksh/.test(prog) ? 'ksh' : prog === 'yash' ? 'yash' : 'sh';
        b.region(script.line, script.line, [`Dockerfile の ${instr}（exec 形式で \`${words[0].value} ${words[c].value}\` に渡すスクリプト）`, `Dockerfile ${instr} (a script passed to \`${words[0].value} ${words[c].value}\` in exec form)`], target);
        i = last;
        continue;
      }
      execWords(b, words);
      b.region(i, last, [`Dockerfile の ${instr}（exec 形式）`, `Dockerfile ${instr} (exec form)`], 'bash', [[
        'exec 形式（`[...]`）はシェルを通さずにコマンドを直接実行します。`$VAR` の展開・パイプ・リダイレクト・`&&` などは働かず、各要素がそのまま引数になります。',
        'The exec form (`[...]`) runs the command directly, without a shell: `$VAR`, pipes, redirections and `&&` do not work, and each element is passed as it is.',
      ]]);
      i = last;
      continue;
    }
    if (instr === 'SHELL') continue;
    if (notShell) {
      // Skip the instruction and its continuation lines (PowerShell continues with a backtick).
      while (/[\\`]\s*$/.test(b.lines[i]) && i + 1 < b.lines.length) i++;
      continue;
    }
    const heredoc = /^<<-?\s*["']?(\w+)["']?/.exec(line.slice(at));
    if (heredoc) {
      // `RUN <<EOF` … `EOF`: the body is the script.
      const start = i + 1;
      let j = start;
      while (j < b.lines.length && b.lines[j].trim() !== heredoc[1]) b.plain(j++);
      b.region(start, j - 1, [`Dockerfile の ${instr}（ヒアドキュメント）`, `Dockerfile ${instr} (here-document)`], shell, undefined, instr === 'RUN' && !pipefail);
      i = j;
      continue;
    }
    const start = i;
    b.plain(i, at);
    // Continued with a trailing backslash; Docker drops comment lines inside the continuation.
    while (/\\\s*$/.test(b.lines[i]) && i + 1 < b.lines.length) {
      i++;
      // Keep the continuation going over a comment line, which Docker removes.
      while (/^\s*#/.test(b.lines[i]) && i + 1 < b.lines.length) (b.outs[i] ??= new LineOut()).insert('\\', 0, 0), i++;
      b.plain(i);
    }
    b.region(start, i, [`Dockerfile の ${instr}`, `Dockerfile ${instr}`], shell, undefined, instr === 'RUN' && !pipefail);
  }
}

// ---------------------------------------------------------------- Makefile

const MAKE_AUTO: Record<string, [string, string, string]> = {
  '@': ['make_target', 'ターゲット名', 'the target name'],
  '<': ['make_first_prerequisite', '最初の依存ファイル', 'the first prerequisite'],
  '^': ['make_prerequisites', 'すべての依存ファイル', 'all prerequisites'],
  '?': ['make_newer_prerequisites', 'ターゲットより新しい依存ファイル', 'the prerequisites newer than the target'],
  '*': ['make_stem', 'パターンルールの `%` に当たる部分', 'the stem matched by `%`'],
};

function makefile(b: Builder): void {
  let shell: Shell = 'sh';
  let inRecipe = false;
  for (let i = 0; i < b.lines.length; i++) {
    const line = b.lines[i];
    const shellVar = /^\s*SHELL\s*:?=\s*(\S+)/.exec(line);
    if (shellVar) {
      const name = shellVar[1].split('/').pop()!;
      shell = name === 'bash' ? 'bash' : name === 'zsh' ? 'zsh' : 'sh';
    }
    if (!line.startsWith('\t')) {
      // A rule line (`target: deps`) starts a recipe; other lines end it.
      if (/^[^\s#=][^=]*:(?!=)/.test(line) && !/^\s*(ifeq|ifneq|ifdef|ifndef|else|endif|define|endef|include|export)\b/.test(line)) inRecipe = true;
      else if (line.trim() && !line.trimStart().startsWith('#')) inRecipe = false;
      continue;
    }
    if (!inRecipe) continue;
    const start = i;
    makeRecipeLine(b, i, true);
    while (/\\$/.test(b.lines[i]) && i + 1 < b.lines.length) makeRecipeLine(b, ++i, false);
    b.region(start, i, ['Makefile のレシピ', 'Makefile recipe'], shell);
  }
}

/** Copy one recipe line, turning make's syntax into plain shell. */
function makeRecipeLine(b: Builder, i: number, first: boolean): void {
  const line = b.lines[i];
  const o = (b.outs[i] ??= new LineOut());
  let k = line.startsWith('\t') ? 1 : 0;
  // `@` (do not echo), `-` (ignore errors) and `+` prefixes are for make.
  if (first) while (/[@+\-\s]/.test(line[k] ?? '') && k < line.length) k++;
  while (k < line.length) {
    if (line[k] !== '$') { o.copy(line, k, k + 1); k++; continue; }
    const next = line[k + 1];
    if (next === '$') {
      // `$$` is a literal `$` for the shell.
      o.insert('$', k, k + 2);
      k += 2;
      continue;
    }
    if (next && MAKE_AUTO[next]) {
      const [name, ja, en] = MAKE_AUTO[next];
      const meaning: [string, string] = [`make の自動変数（${ja}）で、シェルが実行される前に make が展開します`, `make's automatic variable (${en}), expanded by make before the shell runs`];
      o.insert(`\${${name}}`, k, k + 2, meaning);
      b.substitutions.push({ line: i, text: `$${next}`, meaning });
      k += 2;
      continue;
    }
    if (next === '(' || next === '{') {
      const close = matching(line, k + 1);
      if (close < 0) { o.copy(line, k, line.length); break; }
      const inner = line.slice(k + 2, close);
      const simple = /^[\w.]+$/.test(inner);
      const name = simple ? inner.replace(/\./g, '_') : `make_${inner.split(/\s/)[0].replace(/\W/g, '_')}`;
      const meaning: [string, string] = simple
          ? [`make の変数 \`${inner}\` で、シェルが実行される前に make が展開します`, `the make variable \`${inner}\`, expanded by make before the shell runs`]
          : [`make の関数 \`${inner.split(/\s/)[0]}\` の呼び出しで、シェルが実行される前に make が結果に置き換えます`, `a call of the make function \`${inner.split(/\s/)[0]}\`, replaced by its result before the shell runs`];
      o.insert(`\${${name}}`, k, close + 1, meaning);
      b.substitutions.push({ line: i, text: line.slice(k, close + 1), meaning });
      k = close + 1;
      continue;
    }
    // `$X`: a one-letter make variable.
    if (next && /\w/.test(next)) {
      const meaning: [string, string] = [`make の変数 \`${next}\` で、シェルが実行される前に make が展開します`, `the make variable \`${next}\`, expanded by make before the shell runs`];
      o.insert(`\${${next}}`, k, k + 2, meaning);
      b.substitutions.push({ line: i, text: `$${next}`, meaning });
      k += 2;
      continue;
    }
    o.copy(line, k, k + 1);
    k++;
  }
}

/** Index of the bracket closing the one at `open`. */
function matching(s: string, open: number): number {
  const close = s[open] === '(' ? ')' : '}';
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === s[open]) depth++;
    else if (s[i] === close && --depth === 0) return i;
  }
  return -1;
}

// ---------------------------------------------------------------- Jenkinsfile

/**
 * The scripts of `sh` steps in a Jenkins pipeline: `sh 'cmd'`, `sh "…"`, `sh '''…'''`, `sh """…"""`,
 * `sh(script: '…', returnStdout: true)`, `sh label: 'x', script: '…'`. Jenkins runs them with
 * `/bin/sh -xe` unless the script starts with a shebang.
 */
function jenkinsfile(b: Builder): void {
  const start = /\bsh\s*\(?\s*(?:(?:label|returnStdout|returnStatus|encoding)\s*:\s*(?:'[^']*'|"[^"]*"|true|false)\s*,\s*)*(?:script\s*:\s*)?('''|"""|'|")/g;
  for (let i = 0; i < b.lines.length; i++) {
    const line = b.lines[i];
    if (/^\s*\/\//.test(line)) continue;
    start.lastIndex = 0;
    const m = start.exec(line);
    if (!m) continue;
    const quote = m[1];
    const interpolate = quote.startsWith('"');
    const from = m.index + m[0].length;
    // Where the string ends: on this line, or (triple quotes) on a later one.
    let endLine = i;
    let endCol = closingQuote(line, from, quote);
    if (endCol < 0 && quote.length === 3) {
      for (endLine = i + 1; endLine < b.lines.length && (endCol = closingQuote(b.lines[endLine], 0, quote)) < 0; endLine++);
    }
    if (endCol < 0) continue;
    // A triple-quoted script usually starts on the next line.
    const first = quote.length === 3 && !line.slice(from).trim() ? i + 1 : i;
    for (let k = first; k <= endLine; k++) {
      groovyText(b, k, k === i ? from : 0, k === endLine ? endCol : b.lines[k].length, interpolate);
    }
    // A closing triple quote on a line of its own is not part of the script.
    const last = endLine > first && !b.lines[endLine].slice(0, endCol).trim() ? endLine - 1 : endLine;
    // From just after the opening quote: `sh '''#!/bin/bash` starts with its shebang.
    const script = [b.lines[first].slice(first === i ? from : 0), ...b.lines.slice(first + 1, last + 1)].join('\n');
    // `#!/bin/bash`, `#!/usr/bin/env bash`: the last part of the path, or the word after env.
    const shebang = /^\s*#!\s*(?:\S*\/)?(\w+)(?:[ \t]+(\w+))?/.exec(script);
    const shell = shebang ? (shellFromShebang(shebang[2] && shebang[1] === 'env' ? shebang[2] : shebang[1]) ?? 'sh') : 'sh';
    const notes: [string, string, string?][] = [];
    if (interpolate && /(^|[^\\])\$[A-Za-z_{]/.test(script)) {
      notes.push([
        '二重引用符の文字列では、`$名前` や `${…}` をシェルより先に Groovy が埋め込みます。シェルの変数として使うには `\\$HOME` のようにエスケープするか、単一引用符（`\'…\'`、`\'\'\'…\'\'\'`）にします。',
        'In a double-quoted string, Groovy fills in `$name` and `${…}` before the shell runs. To use a shell variable, escape it (`\\$HOME`) or use single quotes (`\'…\'`, `\'\'\'…\'\'\'`).',
      ]);
    }
    b.region(first, last, ['Jenkinsfile の `sh` ステップ', 'Jenkinsfile `sh` step'], shell, notes.length ? notes : undefined);
    i = endLine;
  }
}

function shellFromShebang(name: string): Shell | undefined {
  return ({ bash: 'bash', sh: 'sh', dash: 'dash', zsh: 'zsh', ksh: 'ksh', mksh: 'mksh', ash: 'ash', yash: 'yash' } as Record<string, Shell>)[name];
}

/** The column of the closing `quote` from `from` on, skipping backslash escapes; -1 if none. */
function closingQuote(line: string, from: number, quote: string): number {
  for (let k = from; k < line.length; k++) {
    if (line[k] === '\\') { k++; continue; }
    if (line.startsWith(quote, k)) return k;
  }
  return -1;
}

/** Copy part of a Groovy string as shell text: undo escapes, and stand in for `${…}` and `$name`. */
function groovyText(b: Builder, i: number, from: number, to: number, interpolate: boolean): void {
  const line = b.lines[i];
  const o = (b.outs[i] ??= new LineOut());
  let k = from;
  while (k < to) {
    const ch = line[k];
    if (ch === '\\' && k + 1 < to && /[\\'"$]/.test(line[k + 1])) {
      o.insert(line[k + 1], k, k + 2);
      k += 2;
      continue;
    }
    if (interpolate && ch === '$') {
      const braced = line[k + 1] === '{' ? line.indexOf('}', k + 2) : -1;
      const bare = /^\$([A-Za-z_][\w.]*)/.exec(line.slice(k, to));
      const end = braced >= 0 && braced < to ? braced + 1 : bare ? k + bare[0].length : -1;
      if (end > 0) {
        const expr = braced >= 0 && braced < to ? line.slice(k + 2, braced).trim() : bare![1];
        // `env.BRANCH_NAME`, `params.TARGET`.
        const envVar = /^env\.(\w+)$/.exec(expr)?.[1];
        const known = envVar && Object.hasOwn(ciVariables, envVar) ? ciVariables[envVar].meaning : /^params\.\w+$/.test(expr) ? { ja: `ビルドパラメータ \`${expr.slice(7)}\``, en: `the build parameter \`${expr.slice(7)}\`` } : undefined;
        const meaning: [string, string] = known
          ? [`${spaced(known.ja)}を表す Groovy の式 \`${expr}\` で、シェルが実行される前に Jenkins が値を埋め込みます`, `the Groovy expression \`${expr}\`: ${known.en}; Jenkins fills in its value before the shell runs`]
          : [`Groovy の式 \`${expr}\` の値で、シェルが実行される前に Jenkins が埋め込みます`, `the value of the Groovy expression \`${expr}\`, filled in by Jenkins before the shell runs`];
        o.insert(`\${${expr.replace(/\W+/g, '_').replace(/^_|_$/g, '').toUpperCase() || 'EXPR'}}`, k, end, meaning);
        b.substitutions.push({ line: i, text: line.slice(k, end), meaning });
        k = end;
        continue;
      }
    }
    o.copy(line, k, k + 1);
    k++;
  }
}

// ---------------------------------------------------------------- YAML (CI workflows)

/** Keys whose value is a shell script in common CI systems. */
const YAML_KEYS = /^(run|script|before_script|after_script|bash|sh|cmds?|command)$/;

function yaml(b: Builder): void {
  const githubLike = b.lines.some((l) => /^\s*(runs-on|steps|jobs)\s*:/.test(l));
  const circleci = !b.lines.some((l) => /^\s*runs-on\s*:/.test(l)) && b.lines.some((l) => /^version\s*:\s*['"]?2(\.\d)?['"]?\s*$/.test(l));
  if (b.lines.some((l) => /^\s*(pool|trigger)\s*:|^\s*-\s+task\s*:|vmImage\s*:/.test(l))) b.azure = { vars: azureVariables(b.lines) };
  // Azure Pipelines runs `script:` with cmd.exe on Windows agents.
  const azureWindows = !!b.azure && b.lines.some((l) => /vmImage\s*:\s*['"]?windows/i.test(l));
  for (let i = 0; i < b.lines.length; i++) {
    const line = b.lines[i];
    const m = /^(\s*(?:-\s+)?)([\w-]+)\s*:(?:\s+(.*))?$/.exec(line);
    if (!m || !YAML_KEYS.test(m[2])) continue;
    const key = m[2];
    const indent = m[1].length;
    const rest = (m[3] ?? '').replace(/\s+#.*$/, '');
    // `defaults: run: shell:` holds no script.
    if (key === 'run' && !rest && /^\s*defaults\s*:/.test(b.lines[i - 1] ?? '')) continue;
    // An action's input (`with: script:` of actions/github-script is JavaScript), not a shell script.
    if (githubLike && key !== 'run' && /^\s*with\s*:\s*$/.test(parentLine(b, i, indent) ?? '')) continue;
    // CircleCI's `run:` with `name:` and `command:` under it: the command is found as its own key.
    if (key === 'run' && !rest) {
      const next = b.lines.slice(i + 1).find((l) => l.trim());
      if (next && indentOf(next) > indent && !/^\s*-\s/.test(next)) continue;
    }
    if (key === 'script' && azureWindows) continue;
    const shell = yamlShell(b, i, indent, key, githubLike);
    if (shell === null) continue;
    const label: [string, string] = b.azure && (key === 'script' || key === 'bash')
      ? [`Azure Pipelines の \`${key}:\` ステップ`, `Azure Pipelines \`${key}:\` step`]
      : key === 'command' && /^\s*(-\s+)?run\s*:\s*$/.test(parentLine(b, i, indent) ?? '')
        ? ['CircleCI の `run` ステップ', 'CircleCI `run` step']
        : circleci && key === 'run'
          ? ['CircleCI の `run` ステップ', 'CircleCI `run` step']
          : githubLike && key === 'run'
          ? ['GitHub Actions の `run:` ステップ', 'GitHub Actions `run:` step']
          : [`YAML の \`${key}:\``, `YAML \`${key}:\``];
    const valueAt = line.length - (m[3] ?? '').length;
    if (/^[|>][-+]?\d*$/.test(rest)) {
      i = yamlBlock(b, i, indent, label, shell);
    } else if (rest) {
      yamlScalar(b, i, valueAt, rest, label, shell);
    } else {
      // A list of commands: `script:` followed by `- cmd` items.
      let j = i + 1;
      while (j < b.lines.length && (!b.lines[j].trim() || indentOf(b.lines[j]) > indent || (indentOf(b.lines[j]) === indent && /^\s*-\s/.test(b.lines[j]) && !/^\s*-\s+[\w-]+\s*:/.test(b.lines[j])))) {
        const item = /^(\s*-\s+)(.*)$/.exec(b.lines[j]);
        if (item) {
          const value = item[2].replace(/\s+#.*$/, '');
          if (/^[|>][-+]?\d*$/.test(value)) { j = yamlBlock(b, j, indentOf(b.lines[j]), label, shell) + 1; continue; }
          yamlScalar(b, j, item[1].length, value, label, shell);
        }
        j++;
      }
      i = j - 1;
    }
  }
}

/** Names defined under `variables:` (`name: value` or `- name: x`), for `$(name)` macros. */
function azureVariables(lines: string[]): Set<string> {
  const vars = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)variables\s*:\s*$/.exec(lines[i]);
    if (!m) continue;
    for (let j = i + 1; j < lines.length && (!lines[j].trim() || indentOf(lines[j]) > m[1].length); j++) {
      const v = /^\s*(?:-\s+name\s*:\s*['"]?([\w.]+)|([\w.]+)\s*:)/.exec(lines[j]);
      if (v && v[2] !== 'value' && v[2] !== 'group' && v[2] !== 'readonly') vars.add(v[1] ?? v[2]);
    }
  }
  return vars;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** The shell of a step: `shell:` next to `run:` in GitHub Actions (bash by default), null if not a shell. */
function yamlShell(b: Builder, at: number, indent: number, key: string, githubLike: boolean): Shell | undefined | null {
  if (key === 'command' && !githubLike) return null;
  if (key === 'bash') return 'bash';
  if (key === 'sh') return 'sh';
  if (key !== 'run') return undefined;
  // Look at the sibling keys of the same step. `indent` is the column of the key, after any `- `.
  const level = indent;
  // Above, up to the line that starts the step (`- name: …`); none when `run:` starts it.
  const startsItem = (j: number) => /^\s*-\s/.test(b.lines[j]) && indentOf(b.lines[j].replace(/-\s+/, (d) => ' '.repeat(d.length))) === level;
  if (!startsItem(at)) {
    for (let j = at - 1; j >= 0 && (indentOf(b.lines[j]) >= level || !b.lines[j].trim()); j--) {
      const m = /^\s*(?:-\s+)?shell:\s*(\S+)/.exec(b.lines[j]);
      if (m && indentOf(b.lines[j].replace(/-\s+/, (d) => ' '.repeat(d.length))) === level) return shellName(m[1]);
    }
  }
  for (let j = at + 1; j < b.lines.length && (indentOf(b.lines[j]) >= level || !b.lines[j].trim()); j++) {
    const m = /^\s*shell:\s*(\S+)/.exec(b.lines[j]);
    if (m && indentOf(b.lines[j]) === level) return shellName(m[1]);
  }
  if (!githubLike) return undefined;
  // `defaults: run: shell:` for the workflow, or for the job that holds this step.
  for (let d = at - 1; d >= 2; d--) {
    const m = /^(\s*)shell:\s*(\S+)/.exec(b.lines[d]);
    if (!m || !/^\s*run\s*:\s*$/.test(b.lines[d - 1]) || !/^\s*defaults\s*:\s*$/.test(b.lines[d - 2])) continue;
    const k = indentOf(b.lines[d - 2]);
    // A job's defaults apply only until the job ends.
    if (b.lines.slice(d + 1, at).some((l) => l.trim() && indentOf(l) < k)) continue;
    return shellName(m[2]);
  }
  // A job on a Windows runner runs `run:` with PowerShell unless told otherwise.
  if (/windows/i.test(runsOn(b, at) ?? '')) return null;
  return 'bash';
}

/** The nearest line above `at` that is less indented than `indent`: the key `at` belongs to. */
function parentLine(b: Builder, at: number, indent: number): string | undefined {
  for (let j = at - 1; j >= 0; j--) {
    if (b.lines[j].trim() && indentOf(b.lines[j]) < indent) return b.lines[j];
  }
  return undefined;
}

/** `runs-on:` of the job holding line `at`, when it names a runner (not a matrix expression). */
function runsOn(b: Builder, at: number): string | undefined {
  for (let j = at - 1; j >= 0; j--) {
    const m = /^(\s*)runs-on\s*:\s*(.*)$/.exec(b.lines[j]);
    if (!m) continue;
    // The job ended between there and here.
    if (b.lines.slice(j + 1, at).some((l) => l.trim() && !l.trim().startsWith('#') && indentOf(l) < m[1].length)) return undefined;
    return m[2].includes('${{') ? undefined : m[2];
  }
  return undefined;
}

function shellName(s: string): Shell | null {
  const n = s.replace(/['"]/g, '').split(/[\s{]/)[0];
  if (n === 'bash') return 'bash';
  if (n === 'sh') return 'sh';
  return null;
}

/** A `|` / `>` block scalar: the more-indented lines after `at`. Returns the last line of the block. */
function yamlBlock(b: Builder, at: number, indent: number, label: [string, string], shell: Shell | undefined): number {
  let j = at + 1;
  let last = at;
  while (j < b.lines.length && (!b.lines[j].trim() || indentOf(b.lines[j]) > indent)) {
    if (b.lines[j].trim()) {
      githubLine(b, j, 0, b.lines[j].length);
      last = j;
    }
    j++;
  }
  b.region(at + 1, last, label, shell);
  return last;
}

/** A one-line value, plain or quoted. */
function yamlScalar(b: Builder, i: number, from: number, value: string, label: [string, string], shell: Shell | undefined): void {
  const q = value[0];
  if ((q === '"' || q === "'") && value.endsWith(q) && value.length > 1) githubLine(b, i, from + 1, from + value.length - 1);
  else githubLine(b, i, from, from + value.length);
  b.region(i, i, label, shell);
}

/** Copy part of a line, replacing GitHub Actions `${{ … }}` expressions with a variable. */
function githubLine(b: Builder, i: number, from: number, to: number): void {
  const line = b.lines[i];
  const o = (b.outs[i] ??= new LineOut());
  const re = b.azure ? /\$\{\{\s*(.*?)\s*\}\}|\$\(([A-Za-z_][\w.]*)\)/g : /\$\{\{\s*(.*?)\s*\}\}/g;
  re.lastIndex = from;
  let at = from;
  for (let m: RegExpExecArray | null; (m = re.exec(line)) && m.index < to;) {
    if (m[2] !== undefined) {
      // `$(name)`: an Azure Pipelines macro when it names a pipeline variable; otherwise bash's `$(command)`.
      if (!(m[2].includes('.') || b.azure!.vars.has(m[2]))) continue;
      o.copy(line, at, m.index);
      const known = Object.hasOwn(AZURE_VARIABLES, m[2]) ? AZURE_VARIABLES[m[2]] : undefined;
      const meaning: [string, string] = known
        ? [`${spaced(known.ja)}を表す Azure Pipelines の変数 \`${m[2]}\` のマクロで、スクリプトが実行される前に値に置き換わります`, `the Azure Pipelines variable \`${m[2]}\`: ${known.en}; the macro is replaced with its value before the script runs`]
        : [`Azure Pipelines の変数 \`${m[2]}\` のマクロで、スクリプトが実行される前に値に置き換わります`, `an Azure Pipelines macro, replaced with the value of the variable \`${m[2]}\` before the script runs`];
      o.insert(`\${${m[2].replace(/\W+/g, '_').toUpperCase()}}`, m.index, m.index + m[0].length, meaning);
      b.substitutions.push({ line: i, text: m[0], meaning });
      at = m.index + m[0].length;
      continue;
    }
    o.copy(line, at, m.index);
    const name = m[1].replace(/\W+/g, '_').replace(/^_|_$/g, '').toUpperCase() || 'EXPR';
    const meaning: [string, string] = b.azure
      ? [`Azure Pipelines のテンプレート式で、パイプラインの展開時に \`${m[1]}\` の値に置き換わります`, `an Azure Pipelines template expression, replaced with the value of \`${m[1]}\` when the pipeline is expanded`]
      : githubMeaning(m[1]);
    o.insert(`\${${name}}`, m.index, m.index + m[0].length, meaning);
    b.substitutions.push({ line: i, text: m[0], meaning, warning: !b.azure && UNTRUSTED.test(m[1]) ? [
      `⚠ スクリプトインジェクションの危険: \`${m[1]}\` は外部の人が自由に書ける値で、そのままスクリプトに埋め込まれます（\`"; curl … | sh #\` のような値で任意のコマンドが実行される）。\`env:\` で環境変数に渡し、\`"$変数"\` として使ってください。`,
      `⚠ Script injection risk: \`${m[1]}\` can be set by anyone and is pasted into the script as it is (a value like \`"; curl … | sh #\` runs arbitrary commands). Pass it through \`env:\` and use it as \`"$VAR"\`.`,
    ] : undefined });
    at = m.index + m[0].length;
  }
  o.copy(line, at, to);
}

/** What a GitHub Actions expression in a script stands for: `${{ github.head_ref }}` → its branch. */
function githubMeaning(expr: string): [string, string] {
  const known = githubContext(expr);
  return known
    ? [`${spaced(known.ja)}を表す GitHub Actions の式 \`${expr}\` で、スクリプトが実行される前に値に置き換わります`, `the GitHub Actions expression \`${expr}\`: ${known.en}; replaced with its value before the script runs`]
    : [`GitHub Actions の式で、スクリプトが実行される前に \`${expr}\` の値に置き換わります`, `a GitHub Actions expression, replaced with the value of \`${expr}\` before the script runs`];
}

/** Contexts an outside contributor controls (GitHub's security hardening guide). */
const UNTRUSTED = /^github\.(head_ref|event\.(issue\.(title|body)|pull_request\.(title|body|head\.(ref|label|repo\.default_branch))|comment\.body|review\.body|review_comment\.body|discussion\.(title|body)|pages\.[^.]+\.page_name|commits\.[^.]+\.(message|author\.(email|name))|head_commit\.(message|author\.(email|name))|workflow_run\.(head_branch|display_title|head_commit\.(message|author\.(email|name)))))$/;

/** Files GitHub Actions provides to steps, by environment variable. */
const GITHUB_FILES: Record<string, [string, string]> = {
  GITHUB_ENV: ['ここに `名前=値` を書くと、後のステップで環境変数として使えます', 'lines `NAME=value` written here become environment variables in later steps'],
  GITHUB_OUTPUT: ['ここに `名前=値` を書くと、ステップの出力（`steps.<id>.outputs.名前`）になります', 'lines `name=value` written here become step outputs (`steps.<id>.outputs.name`)'],
  GITHUB_PATH: ['ここに書いたディレクトリが、後のステップの PATH に追加されます', 'directories written here are added to PATH for later steps'],
  GITHUB_STEP_SUMMARY: ['ここに書いた Markdown が、ジョブの実行結果のページに表示されます', 'Markdown written here is shown on the run\'s summary page'],
  GITHUB_STATE: ['ここに書いた値を、同じアクションの pre/post の処理で読めます', 'values written here can be read by the action\'s pre and post steps'],
};

/** Notes for GitHub's special files used on a line of a GitHub Actions step. */
function githubFileNotes(text: string, lang: 'ja' | 'en'): string[] {
  const out: string[] = [];
  for (const [name, [ja, en]] of Object.entries(GITHUB_FILES)) {
    if (new RegExp(`\\$\\{?${name}\\b`).test(text)) out.push(lang === 'ja' ? `\`$${name}\` は GitHub Actions が用意するファイルのパスです。${ja}。` : `\`$${name}\` is the path of a file GitHub Actions provides: ${en}.`);
  }
  return out;
}

// ---------------------------------------------------------------- package.json

function npm(b: Builder): void {
  let inScripts = false;
  for (let i = 0; i < b.lines.length; i++) {
    const line = b.lines[i];
    if (/^\s*"scripts"\s*:\s*\{/.test(line)) { inScripts = !/\}/.test(line.slice(line.indexOf('{'))); continue; }
    if (!inScripts) continue;
    if (/^\s*\}/.test(line)) { inScripts = false; continue; }
    const m = /^(\s*"(?:[^"\\]|\\.)*"\s*:\s*")((?:[^"\\]|\\.)*)"/.exec(line);
    if (!m) continue;
    const o = (b.outs[i] ??= new LineOut());
    // Undo JSON escapes: `\"` → `"`, `\\` → `\`.
    for (let k = m[1].length; k < m[1].length + m[2].length; k++) {
      if (line[k] === '\\' && k + 1 < line.length) {
        const e = line[k + 1];
        o.insert(e === 'n' ? ' ' : e === 't' ? '\t' : e, k, k + 2);
        k++;
      } else o.copy(line, k, k + 1);
    }
    const name = /"((?:[^"\\]|\\.)*)"/.exec(line)![1];
    b.region(i, i, [`npm スクリプト \`${name}\``, `npm script \`${name}\``], 'sh');
  }
}

// ---------------------------------------------------------------- Markdown

function markdown(b: Builder): void {
  for (let i = 0; i < b.lines.length; i++) {
    const open = /^(\s*)(`{3,}|~{3,})\s*([\w-]+)?/.exec(b.lines[i]);
    if (!open) continue;
    const fence = open[2];
    const lang = (open[3] ?? '').toLowerCase();
    let j = i + 1;
    const close = (l: string) => l.trim().startsWith(fence[0].repeat(fence.length)) && !l.trim().slice(fence.length).trim();
    const shell: Shell | undefined | null = ['sh', 'posix'].includes(lang) ? 'sh' : ['bash', 'shell', 'shellscript', 'console', 'shellsession', 'terminal'].includes(lang) ? 'bash' : lang === 'zsh' ? 'zsh' : lang === 'ksh' ? 'ksh' : lang === 'dash' ? 'dash' : null;
    const prompts = ['console', 'shellsession', 'terminal'].includes(lang);
    while (j < b.lines.length && !close(b.lines[j])) {
      if (shell !== null) {
        if (prompts) {
          // Only lines after a `$ ` prompt are commands; the rest is output.
          const p = /^(\s*[$#%]\s)/.exec(b.lines[j]);
          if (p) b.plain(j, p[1].length);
        } else b.plain(j);
      }
      j++;
    }
    if (shell !== null && j > i + 1) b.region(i + 1, j - 1, [`Markdown のコードブロック（${lang}）`, `Markdown code block (${lang})`], shell === 'bash' ? undefined : shell);
    i = j;
  }
}

// ---------------------------------------------------------------- Python

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

/** A Python string literal: where its text is, and how to read it. */
interface PyString { prefix: string; quote: string; start: number; contentStart: number; contentEnd: number; end: number }

/** The string literal starting at `at`, if any. */
function pyString(src: string, at: number): PyString | undefined {
  const m = /^([rRbBuUfF]{0,2})('''|"""|'|")/.exec(src.slice(at, at + 5));
  if (!m || (at > 0 && /\w/.test(src[at - 1]))) return undefined;
  const quote = m[2];
  const contentStart = at + m[0].length;
  for (let k = contentStart; k < src.length; k++) {
    if (src[k] === '\\') { k++; continue; }
    if (quote.length === 1 && src[k] === '\n') return undefined;
    if (src.startsWith(quote, k)) return { prefix: m[1].toLowerCase(), quote, start: at, contentStart, contentEnd: k, end: k + quote.length };
  }
  return undefined;
}

/** Index after the bracket matching the one at `open`, skipping strings and comments. */
function pyClose(src: string, open: number): number {
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    const str = pyString(src, k);
    if (str) { k = str.end - 1; continue; }
    const c = src[k];
    if (c === '#') { while (k < src.length && src[k] !== '\n') k++; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c) && --depth === 0) return k + 1;
  }
  return -1;
}

/** The top-level comma-separated parts inside the brackets [open, close), trimmed. */
function pySplit(src: string, open: number, close: number): [number, number][] {
  const parts: [number, number][] = [];
  let from = open + 1;
  for (let k = open + 1; k < close - 1; k++) {
    const str = pyString(src, k);
    if (str) { k = str.end - 1; continue; }
    if (src[k] === '#') { while (k < close && src[k] !== '\n') k++; continue; }
    if ('([{'.includes(src[k])) { k = pyClose(src, k) - 1; continue; }
    if (src[k] === ',') { parts.push([from, k]); from = k + 1; }
  }
  parts.push([from, close - 1]);
  // Without the blanks and comments around each part; empty ones (after a last comma) dropped.
  return parts.map(([a, z]) => {
    for (;;) {
      while (a < z && /\s/.test(src[a])) a++;
      if (src[a] !== '#') break;
      while (a < z && src[a] !== '\n') a++;
    }
    const trim = () => { while (z > a && /\s/.test(src[z - 1])) z--; };
    trim();
    const comment = /#[^'"\n]*$/.exec(src.slice(a, z));
    if (comment) z = a + comment.index;
    trim();
    return [a, z] as [number, number];
  }).filter(([a, z]) => z > a);
}

type PyPos = (off: number) => { line: number; col: number };

function python(b: Builder): void {
  const src = b.lines.join('\n');
  const lineStarts: number[] = [];
  b.lines.reduce((at, l) => (lineStarts.push(at), at + l.length + 1), 0);
  const pos: PyPos = (off) => {
    let line = lineStarts.length - 1;
    while (lineStarts[line] > off) line--;
    return { line, col: off - lineStarts[line] };
  };
  // Names the calls go by: `import subprocess as sp`, `from subprocess import run as r`.
  const names = new Map<string, string>();
  for (const m of src.matchAll(/^[ \t]*import[ \t]+([\w.]+(?:[ \t]+as[ \t]+\w+)?(?:[ \t]*,[ \t]*[\w.]+(?:[ \t]+as[ \t]+\w+)?)*)/gm)) {
    for (const part of m[1].split(',')) {
      const [mod, alias] = part.trim().split(/\s+as\s+/);
      for (const full of Object.keys(PY_CALLS)) if (full.startsWith(`${mod}.`)) names.set(`${alias ?? mod}.${full.slice(mod.length + 1)}`, full);
    }
  }
  // `from subprocess import run, check_output` or `from subprocess import (\n run,\n check_output\n)`.
  for (const m of src.matchAll(/^[ \t]*from[ \t]+([\w.]+)[ \t]+import[ \t]+(?:\(([^)]*)\)|([\w \t,]+))/gm)) {
    for (const part of (m[2] ?? m[3]).split(',')) {
      const [fn, alias] = part.trim().split(/\s+as\s+/);
      if (PY_CALLS[`${m[1]}.${fn}`]) names.set(alias ?? fn, `${m[1]}.${fn}`);
    }
  }
  if (!names.size) return;
  const callRe = new RegExp(`(?<![\\w.])(${[...names.keys()].map((n) => n.replace(/\./g, '\\.')).join('|')})\\s*\\(`, 'g');
  for (const m of src.matchAll(callRe)) {
    const at = m.index!;
    // Not inside a comment or a string on the same line.
    const before = src.slice(lineStarts[pos(at).line], at);
    if (before.includes('#') || (before.match(/["']/g) ?? []).length % 2) continue;
    const full = names.get(m[1])!;
    const spec = PY_CALLS[full];
    const open = at + m[0].length - 1;
    const close = pyClose(src, open);
    if (close < 0) continue;
    const parts = pySplit(src, open, close);
    const keyword = (k: string) => parts.map(([a, z]) => new RegExp(`^${k}\\s*=\\s*([\\s\\S]*)$`).exec(src.slice(a, z))?.[1]).find((v) => v !== undefined);
    const positional = parts.filter(([a, z]) => !/^\w+\s*=(?!=)/.test(src.slice(a, z)) && !src.slice(a, z).startsWith('**'));
    if (!positional.length) continue;
    const shellArg = keyword('shell');
    const usesShell = spec.shell === 'always' || (spec.shell === 'kwarg' && shellArg === 'True');
    const exe = keyword('executable')?.replace(/^["']|["']$/g, '').split('/').pop();
    const target: Shell = exe === 'bash' ? 'bash' : exe === 'zsh' ? 'zsh' : 'sh';
    const label = (what: [string, string]): [string, string] => [`Python の \`${m[1]}\`（${what[0]}）`, `Python \`${m[1]}\` (${what[1]})`];
    const [a0, z0] = positional[0];
    const isList = /^[[(]/.test(src[a0]) && pyClose(src, a0) === z0;
    if (spec.args === 'all' || isList) {
      // A list of arguments: run directly, like Docker's exec form.
      const items = spec.args === 'all' ? positional.filter(([a, z]) => !src.slice(a, z).startsWith('*')) : pySplit(src, a0, z0);
      if (!items.length) continue;
      if (usesShell && spec.shell === 'kwarg') {
        // shell=True with a list: the first item is the script, the rest become $0, $1…
        const script = pyScript(b, src, items[0][0], items[0][1], pos);
        if (!script) continue;
        b.region(script.first, script.last, label(['shell=True のリストの最初の要素をシェルが実行', 'shell=True: the shell runs the first item of the list']), target, [[
          'shell=True にリストを渡すと、最初の要素だけがシェルのコマンドになり、残りの要素はシェルへの引数（$0, $1…）になります。',
          'With shell=True and a list, only the first item is the shell command; the other items become arguments of the shell ($0, $1…).',
        ]]);
        continue;
      }
      const words = items.map(([a, z]) => pyWord(src, a, z, pos));
      if (words.some((w) => !w)) continue;
      const ws = words as JsonWord[];
      execWords(b, ws);
      b.region(ws[0].line, ws[ws.length - 1].line, label(['シェルを通さずに実行する引数のリスト', 'arguments run without a shell']), 'bash', [[
        'リストで渡した引数はシェルを通さずにそのまま実行されます。`$VAR` の展開・パイプ・リダイレクト・`&&` などは働きません（値を安全に渡せる書き方です）。',
        'A list of arguments is run directly, without a shell: `$VAR`, pipes, redirections and `&&` do not work (the safe way to pass values).',
      ]]);
      continue;
    }
    const script = pyScript(b, src, a0, z0, pos);
    if (!script) continue;
    const notes: [string, string, string?][] = [];
    if (!usesShell && /\s/.test(script.text.trim())) {
      notes.push(shellArg === undefined || shellArg === 'False' ? [
        '⚠ shell=True なしで文字列を渡すと、文字列全体が1つのプログラム名として扱われます（引数やパイプは使えず、多くの場合 FileNotFoundError）。`["cmd", "arg"]` のようなリストで渡すか、shell=True を付けます。',
        '⚠ Without shell=True the whole string is taken as one program name (no arguments or pipes; usually FileNotFoundError). Pass a list like `["cmd", "arg"]`, or add shell=True.',
        'pythonNoShell',
      ] : ['shell= の値が式なので、この文字列をシェルが実行するかは実行時に決まります。', 'shell= is an expression, so whether a shell runs this string is decided at run time.']);
    }
    if (usesShell && script.interpolated) {
      notes.push([
        '⚠ シェルインジェクションの危険: Python の値を埋め込んだ文字列をシェルが実行します。値に `;` や `$(…)` が含まれると任意のコマンドが実行されます。`shlex.quote()` でクォートするか、shell=True をやめてリストで渡してください。',
        '⚠ Shell injection risk: the shell runs a string with Python values pasted in, so a value containing `;` or `$(…)` runs arbitrary commands. Quote it with `shlex.quote()`, or drop shell=True and pass a list.',
        'pythonInjection',
      ]);
    }
    if (script.partial) notes.push(['文字列の後ろは Python のコードで組み立てられるため、解説しているのは文字列リテラルの部分だけです。', 'The rest of the string is built by Python code; only the string literal is explained.']);
    const sh = target === 'sh' ? '/bin/sh' : target;
    const what: [string, string] = usesShell ? [`シェル（${sh}）が実行する文字列`, `a string the shell (${sh}) runs`] : ['シェルを通さないコマンド文字列', 'a command string run without a shell'];
    b.region(script.first, script.last, label(what), usesShell ? target : 'bash', notes);
  }
}

/** Shell variable name standing for a Python expression. */
function pyName(expr: string): string {
  return `py_${expr.replace(/\W+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'expr'}`;
}

/** An item of an argument list: a string literal as a word, or a Python expression as a placeholder. */
function pyWord(src: string, a: number, z: number, pos: PyPos): JsonWord | undefined {
  const p = pos(a);
  if (pos(z - 1).line !== p.line) return undefined;
  const str = pyString(src, a);
  if (str && str.end === z && !str.prefix.includes('f') && str.quote.length === 1) {
    const { value, offs } = pyUnescape(src, str);
    return { line: p.line, start: p.col, end: pos(z - 1).col + 1, value, cols: offs.map((o) => pos(o).col) };
  }
  const expr = src.slice(a, z);
  return {
    line: p.line, start: p.col, end: pos(z - 1).col + 1, value: '', cols: [],
    placeholder: [`"\${${pyName(expr)}}"`, [`Python の式 \`${expr}\` の値（そのまま1つの引数として渡る）`, `the value of the Python expression \`${expr}\`, passed as one argument`]],
  };
}

/** Undo the escapes of a (non-f) string literal, keeping the offset of each character. */
function pyUnescape(src: string, s: PyString): { value: string; offs: number[] } {
  let value = '';
  const offs: number[] = [];
  const raw = s.prefix.includes('r');
  const simple: Record<string, string> = { n: '\n', t: '\t', '\\': '\\', "'": "'", '"': '"', r: '\r', '0': '\0' };
  for (let k = s.contentStart; k < s.contentEnd; k++) {
    if (src[k] === '\\' && !raw) {
      const e = src[k + 1];
      if (e in simple) { value += simple[e]; offs.push(k); k++; continue; }
      const hex = /^x([0-9a-fA-F]{2})|^u([0-9a-fA-F]{4})/.exec(src.slice(k + 1, k + 6));
      if (hex) { value += String.fromCharCode(parseInt(hex[1] ?? hex[2], 16)); offs.push(k); k += hex[0].length; continue; }
    }
    value += src[k];
    offs.push(k);
  }
  return { value, offs };
}

/**
 * Write the string literal(s) at [a, z) as shell code: adjacent literals are joined (as Python
 * does), escapes undone, and f-string fields replaced by placeholders. `partial` is set when
 * Python code follows the literals (`"…" + x`, `"…".format(…)`).
 */
function pyScript(b: Builder, src: string, a: number, z: number, pos: PyPos):
  { first: number; last: number; text: string; interpolated: boolean; partial: boolean } | undefined {
  let k = a;
  let text = '';
  let interpolated = false;
  let first = -1;
  let last = -1;
  let prevEnd = -1;
  const out = (line: number) => (b.outs[line] ??= new LineOut());
  const insert = (s: string, from: number, to: number, meaning?: [string, string]) => {
    const p = pos(from);
    // Literals on different lines are joined with nothing between: continue the shell line with `\`.
    if (prevEnd >= 0 && pos(prevEnd).line < p.line) out(pos(prevEnd).line).insert('\\', pos(prevEnd).col, pos(prevEnd).col);
    prevEnd = -1;
    if (first < 0) first = p.line;
    last = Math.max(last, p.line);
    out(p.line).insert(s, p.col, pos(to - 1).col + 1, meaning);
    text += s;
  };
  for (;;) {
    while (k < z && /\s/.test(src[k])) k++;
    const str = k < z ? pyString(src, k) : undefined;
    if (!str || str.end > z) break;
    const raw = str.prefix.includes('r');
    const fmt = str.prefix.includes('f');
    for (let c = str.contentStart; c < str.contentEnd; c++) {
      const ch = src[c];
      // A newline inside a triple-quoted string is a real one.
      if (ch === '\n') { text += '\n'; continue; }
      if (fmt && (ch === '{' || ch === '}') && src[c + 1] === ch) { insert(ch, c, c + 2); c++; continue; }
      if (fmt && ch === '{') {
        let depth = 0;
        let e = c;
        for (; e < str.contentEnd; e++) { if (src[e] === '{') depth++; else if (src[e] === '}' && --depth === 0) break; }
        const expr = src.slice(c + 1, e).replace(/[!:][^}]*$/, '').trim();
        insert(`\${${pyName(expr)}}`, c, e + 1, [`Python の式 \`${expr}\` の値（実行前に文字列に埋め込まれる）`, `the value of the Python expression \`${expr}\`, pasted into the string before it runs`]);
        interpolated = true;
        c = e;
        continue;
      }
      if (ch === '\\' && !raw) {
        const e = src[c + 1];
        // A backslash-newline joins the lines, as `\` does in the shell.
        if (e === '\n') { insert('\\', c, c + 1); continue; }
        const simple: Record<string, string> = { n: ';', t: '\t', '\\': '\\', "'": "'", '"': '"' };
        if (e in simple) { insert(simple[e], c, c + 2); c++; continue; }
        const hex = /^x([0-9a-fA-F]{2})|^u([0-9a-fA-F]{4})/.exec(src.slice(c + 1, c + 6));
        if (hex) { insert(String.fromCharCode(parseInt(hex[1] ?? hex[2], 16)), c, c + 1 + hex[0].length); c += hex[0].length; continue; }
      }
      insert(ch, c, c + 1);
    }
    prevEnd = str.end;
    k = str.end;
  }
  if (first < 0) return undefined;
  const rest = src.slice(k, z).trim();
  if (/^\.format\s*\(|^%/.test(rest)) interpolated = true;
  return { first, last, text, interpolated, partial: rest.length > 0 };
}

// ---------------------------------------------------------------- mapping back

/**
 * Move every position in an explanation of the extracted shell text back to the original
 * document, and relabel tokens with the original text (`$(CC)` rather than `${CC}`).
 */
export function remapExplanation(ex: LineExplanation, extracted: Extracted, original: string[], lang: 'ja' | 'en' = 'en'): LineExplanation {
  // Positions in the explanation are in the extracted text, which every map covers.
  const pos = (p: Pos): Pos => ({ line: p.line, character: extracted.maps[p.line][p.character] });
  const span = (sp: Token['span']) => ({ start: pos(sp.start), end: pos(sp.end) });
  // A part of a placeholder (the name inside `${make_target}`) has no counterpart in the original.
  const insidePlaceholder = (t: Token) => t.span.start.line === t.span.end.line
    && extracted.inserted[t.span.start.line].some(([a, b]) => t.span.start.character >= a && t.span.end.character <= b && (t.span.start.character > a || t.span.end.character < b));
  const token = (t: Token): Token => {
    const sp = span(t.span);
    let label = t.label;
    if (sp.start.line === sp.end.line) {
      const text = original[sp.start.line]?.slice(sp.start.character, sp.end.character);
      if (text) label = text.length > 60 ? text.slice(0, 59) + '…' : text;
    }
    // A token that is exactly a placeholder is the host syntax it stands for.
    const whole = t.span.start.line === t.span.end.line
      ? extracted.inserted[t.span.start.line].find(([a, b]) => a === t.span.start.character && b === t.span.end.character)
      : undefined;
    if (whole?.[2]) {
      const m = whole[2][lang === 'ja' ? 0 : 1];
      return { ...t, label, span: sp, explanation: lang === 'en' ? m[0].toUpperCase() + m.slice(1) : m, children: [] };
    }
    return { ...t, label, span: sp, children: t.children.filter((c) => !insidePlaceholder(c)).map(token) };
  };
  return {
    ...ex,
    items: ex.items.map(token),
    examples: ex.examples.map((e) => (e.anchor ? { ...e, anchor: span(e.anchor) } : e)),
  };
}

/** Notes for host syntax on a line (`$(CC)` is a make variable…). */
export function substitutionNotes(extracted: Extracted, line: number, lang: 'ja' | 'en'): string[] {
  const seen = new Set<string>();
  return extracted.substitutions
    .filter((s) => s.line === line && !seen.has(s.text) && seen.add(s.text))
    .flatMap((s) => [
      ...(s.warning ? [lang === 'ja' ? s.warning[0] : s.warning[1]] : []),
      lang === 'ja' ? `\`${s.text}\` は${/^[A-Za-z]/.test(s.meaning[0]) ? ' ' : ''}${s.meaning[0]}。` : `\`${s.text}\` is ${s.meaning[1]}.`,
    ]);
}

const PIPEFAIL: [string, string] = [
  '⚠ パイプの途中のコマンドが失敗しても、RUN は最後のコマンドの結果だけで成功扱いになり、ビルドは止まりません。先に `SHELL ["/bin/bash", "-o", "pipefail", "-c"]` と書くと失敗を検出できます。',
  '⚠ If a command in the middle of the pipe fails, RUN still succeeds with the status of the last command, and the build goes on. Put `SHELL ["/bin/bash", "-o", "pipefail", "-c"]` first to catch such failures.',
];

/** Whether a pipe `|` starts on the line. */
function pipesOn(n: SyntaxNode, line: number): boolean {
  if (n.startPosition.row > line || n.endPosition.row < line) return false;
  if (n.type === 'pipeline' && n.children.some((c) => c.type === '|' && c.startPosition.row === line)) return true;
  return n.children.some((c) => pipesOn(c, line));
}

/** Explain `line` of a host document whose shell parts were extracted and parsed into `tree`. */
export function explainHostedLine(
  analyzer: { explainLine(tree: SyntaxTree, line: number, shell?: Shell, opts?: ExplainOptions): LineExplanation },
  tree: SyntaxTree, extracted: Extracted, original: string[], line: number, lang: 'ja' | 'en', shell?: Shell, opts: ExplainOptions = {},
): LineExplanation | undefined {
  const region = extracted.regions.find((r) => r.start <= line && line <= r.end);
  if (!region) return undefined;
  const ex = analyzer.explainLine(tree, line, shell ?? region.shell, { ...opts, host: region.label[1] });
  ex.context.unshift({ label: lang === 'ja' ? region.label[0] : region.label[1], line: region.start });
  const pick = (m: [string, string, string?]) => (lang === 'ja' ? m[0] : m[1]);
  const notes = [...(region.notes ?? []).map(pick), ...substitutionNotes(extracted, line, lang)];
  if (region.label[1].startsWith('GitHub Actions')) notes.push(...githubFileNotes(original[line], lang));
  if (region.warnPipefail && pipesOn(tree.root, line) && !/pipefail/.test(extracted.text.split('\n').slice(region.start, region.end + 1).join('\n'))) {
    notes.push(pick(PIPEFAIL));
  }
  ex.notes.unshift(...notes);
  return remapExplanation(ex, extracted, original, lang);
}

/** A problem to show in the Problems panel, at original document positions. */
export interface DocIssue {
  code: string;
  severity: 'warning' | 'info';
  message: string;
  startLine: number; startCol: number; endLine: number; endCol: number;
}

/** All problems in the shell parts of a host document (one pass, for diagnostics). */
export function hostIssues(tree: SyntaxTree, extracted: Extracted, original: string[], lang: 'ja' | 'en', shell?: Shell): DocIssue[] {
  const out: DocIssue[] = [];
  const col = (line: number, c: number) => extracted.maps[line][c];
  const at = (n: { startPosition: { row: number; column: number }; endPosition: { row: number; column: number } }) => {
    const sameLine = n.startPosition.row === n.endPosition.row;
    return {
      startLine: n.startPosition.row, startCol: col(n.startPosition.row, n.startPosition.column),
      endLine: n.startPosition.row, endCol: sameLine ? col(n.endPosition.row, n.endPosition.column) : original[n.startPosition.row].length,
    };
  };
  const pick = (m: [string, string, string?]) => (lang === 'ja' ? m[0] : m[1]);
  for (const region of extracted.regions) {
    for (const issue of dialectIssues(tree, shell ?? region.shell ?? 'bash', lang, region.start, region.end)) {
      out.push({ code: issue.id, severity: issue.kind === 'unsupported' ? 'warning' : 'info', message: issue.message, ...at(issue.node) });
    }
    if (region.warnPipefail && !/pipefail/.test(extracted.text.split('\n').slice(region.start, region.end + 1).join('\n'))) {
      for (let line = region.start; line <= region.end; line++) {
        if (!pipesOn(tree.root, line)) continue;
        const pipe = original[line].search(/(?<!\|)\|(?!\|)/);
        out.push({ code: 'dockerPipefail', severity: 'warning', message: pick(PIPEFAIL), startLine: line, startCol: Math.max(0, pipe), endLine: line, endCol: Math.max(0, pipe) + 1 });
      }
    }
    for (const n of region.notes ?? []) {
      if (!n[2]) continue;
      const first = extracted.maps[region.start];
      out.push({ code: n[2], severity: 'warning', message: pick(n), startLine: region.start, startCol: first[0], endLine: region.start, endCol: first[first.length - 1] });
    }
  }
  for (const sub of extracted.substitutions) {
    if (!sub.warning) continue;
    const c = Math.max(0, original[sub.line].indexOf(sub.text));
    out.push({ code: 'injection', severity: 'warning', message: pick(sub.warning), startLine: sub.line, startCol: c, endLine: sub.line, endCol: c + sub.text.length });
  }
  return out;
}
