import type { LineExplanation, Pos, Token } from './analyzer';
import type { Shell } from './dialect';

/** Kinds of files whose shell snippets are explained. */
export type HostKind = 'dockerfile' | 'makefile' | 'yaml' | 'npm' | 'markdown';

/** A run of lines holding shell code inside another kind of file. */
export interface ShellRegion {
  start: number;
  end: number;
  /** What the snippet is, e.g. "Dockerfile RUN" (ja, en). */
  label: [string, string];
  shell?: Shell;
  /** Notes shown on every line of the region. */
  notes?: [string, string][];
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

/** Which kind of host a document is, from its language id and file name. */
export function hostKind(languageId: string, fileName: string): HostKind | undefined {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  if (languageId === 'dockerfile' || /^(Dockerfile|Containerfile)(\..*)?$|\.(dockerfile|containerfile)$/i.test(base)) return 'dockerfile';
  if (languageId === 'makefile' || /^(GNU)?makefile$|\.mk$/i.test(base)) return 'makefile';
  if (base === 'package.json') return 'npm';
  if (languageId === 'yaml' || languageId === 'github-actions-workflow' || /\.ya?ml$/i.test(base)) return 'yaml';
  if (languageId === 'markdown' || /\.md$/i.test(base)) return 'markdown';
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
  region(start: number, end: number, label: [string, string], shell?: Shell, notes?: [string, string][], warnPipefail?: boolean): void {
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
  }
  return b.build();
}

// ---------------------------------------------------------------- Dockerfile

/** One string of a JSON array (the exec form), with the original column of each character. */
interface JsonWord { line: number; start: number; end: number; value: string; cols: number[] }

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
    if (/^[\w@%+=:,./-]+$/.test(w.value)) {
      // A plain word reads the same to the shell, so commands and options are recognised.
      // The first and last characters stand for the quotes too, so the word covers `"echo"`.
      const last = w.value.length - 1;
      for (let c = 0; c <= last; c++) o.insert(w.value[c], c === 0 ? w.start : w.cols[c], c === last ? w.end : w.cols[c] + 1);
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
  let shell: Shell = 'sh';
  let pipefail = false;
  for (let i = 0; i < b.lines.length; i++) {
    const line = b.lines[i];
    const m = /^(\s*)(RUN|CMD|ENTRYPOINT|SHELL)(\s+(?:--[\w-]+(?:=\S*)?\s+)*)/i.exec(line);
    if (!m) continue;
    const at = m[0].length;
    const instr = m[2].toUpperCase();
    if (/^\[\s*"/.test(line.slice(at))) {
      const parsed = jsonWords(b.lines, i, at);
      if (!parsed || !parsed.words.length) continue;
      const { words, last } = parsed;
      const prog = words[0].value.split('/').pop()!;
      if (instr === 'SHELL') {
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

// ---------------------------------------------------------------- YAML (CI workflows)

/** Keys whose value is a shell script in common CI systems. */
const YAML_KEYS = /^(run|script|before_script|after_script|bash|sh|cmds?|command)$/;

function yaml(b: Builder): void {
  const githubLike = b.lines.some((l) => /^\s*(runs-on|steps|jobs)\s*:/.test(l));
  for (let i = 0; i < b.lines.length; i++) {
    const line = b.lines[i];
    const m = /^(\s*(?:-\s+)?)([\w-]+)\s*:(?:\s+(.*))?$/.exec(line);
    if (!m || !YAML_KEYS.test(m[2])) continue;
    const key = m[2];
    const indent = m[1].length;
    const rest = (m[3] ?? '').replace(/\s+#.*$/, '');
    // `defaults: run: shell:` holds no script.
    if (key === 'run' && !rest && /^\s*defaults\s*:/.test(b.lines[i - 1] ?? '')) continue;
    const shell = yamlShell(b, i, indent, key, githubLike);
    if (shell === null) continue;
    const label: [string, string] = githubLike && key === 'run'
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

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** The shell of a step: `shell:` next to `run:` in GitHub Actions (bash by default), null if not a shell. */
function yamlShell(b: Builder, at: number, indent: number, key: string, githubLike: boolean): Shell | undefined | null {
  if (key === 'command' && !githubLike) return null;
  if (key === 'bash') return 'bash';
  if (key === 'sh') return 'sh';
  if (key !== 'run') return undefined;
  // Look at the sibling keys of the same step.
  const level = indent + (/^\s*-\s/.test(b.lines[at]) ? 2 : 0);
  for (let j = at - 1; j >= 0 && (indentOf(b.lines[j]) >= level || !b.lines[j].trim()); j--) {
    const m = /^\s*(?:-\s+)?shell:\s*(\S+)/.exec(b.lines[j]);
    if (m && indentOf(b.lines[j].replace(/-\s+/, '  ')) === level) return shellName(m[1]);
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
  return 'bash';
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
  const re = /\$\{\{\s*(.*?)\s*\}\}/g;
  re.lastIndex = from;
  let at = from;
  for (let m: RegExpExecArray | null; (m = re.exec(line)) && m.index < to;) {
    o.copy(line, at, m.index);
    const name = m[1].replace(/\W+/g, '_').replace(/^_|_$/g, '').toUpperCase() || 'EXPR';
    const meaning: [string, string] = [`GitHub Actions の式で、スクリプトが実行される前に \`${m[1]}\` の値に置き換わります`, `a GitHub Actions expression, replaced with the value of \`${m[1]}\` before the script runs`];
    o.insert(`\${${name}}`, m.index, m.index + m[0].length, meaning);
    b.substitutions.push({ line: i, text: m[0], meaning, warning: UNTRUSTED.test(m[1]) ? [
      `⚠ スクリプトインジェクションの危険: \`${m[1]}\` は外部の人が自由に書ける値で、そのままスクリプトに埋め込まれます（\`"; curl … | sh #\` のような値で任意のコマンドが実行される）。\`env:\` で環境変数に渡し、\`"$変数"\` として使ってください。`,
      `⚠ Script injection risk: \`${m[1]}\` can be set by anyone and is pasted into the script as it is (a value like \`"; curl … | sh #\` runs arbitrary commands). Pass it through \`env:\` and use it as \`"$VAR"\`.`,
    ] : undefined });
    at = m.index + m[0].length;
  }
  o.copy(line, at, to);
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

// ---------------------------------------------------------------- mapping back

/**
 * Move every position in an explanation of the extracted shell text back to the original
 * document, and relabel tokens with the original text (`$(CC)` rather than `${CC}`).
 */
export function remapExplanation(ex: LineExplanation, extracted: Extracted, original: string[], lang: 'ja' | 'en' = 'en'): LineExplanation {
  const pos = (p: Pos): Pos => ({ line: p.line, character: extracted.maps[p.line]?.[p.character] ?? p.character });
  const span = (sp: Token['span']) => ({ start: pos(sp.start), end: pos(sp.end) });
  // A part of a placeholder (the name inside `${make_target}`) has no counterpart in the original.
  const insidePlaceholder = (t: Token) => t.span.start.line === t.span.end.line
    && (extracted.inserted[t.span.start.line] ?? []).some(([a, b]) => t.span.start.character >= a && t.span.end.character <= b && (t.span.start.character > a || t.span.end.character < b));
  const token = (t: Token): Token => {
    const sp = span(t.span);
    let label = t.label;
    if (sp.start.line === sp.end.line) {
      const text = original[sp.start.line]?.slice(sp.start.character, sp.end.character);
      if (text) label = text.length > 60 ? text.slice(0, 59) + '…' : text;
    }
    // A token that is exactly a placeholder is the host syntax it stands for.
    const whole = t.span.start.line === t.span.end.line
      ? (extracted.inserted[t.span.start.line] ?? []).find(([a, b]) => a === t.span.start.character && b === t.span.end.character)
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

/** Whether a pipe `|` starts on the line. */
function pipesOn(n: import('web-tree-sitter').SyntaxNode, line: number): boolean {
  if (n.startPosition.row > line || n.endPosition.row < line) return false;
  if (n.type === 'pipeline' && n.children.some((c) => c.type === '|' && c.startPosition.row === line)) return true;
  return n.children.some((c) => pipesOn(c, line));
}

/** Explain `line` of a host document whose shell parts were extracted and parsed into `tree`. */
export function explainHostedLine(
  analyzer: { explainLine(tree: import('web-tree-sitter').Tree, line: number, shell?: Shell): LineExplanation },
  tree: import('web-tree-sitter').Tree, extracted: Extracted, original: string[], line: number, lang: 'ja' | 'en', shell?: Shell,
): LineExplanation | undefined {
  const region = extracted.regions.find((r) => r.start <= line && line <= r.end);
  if (!region) return undefined;
  const ex = analyzer.explainLine(tree, line, shell ?? region.shell);
  ex.context.unshift({ label: lang === 'ja' ? region.label[0] : region.label[1], line: region.start });
  const pick = (m: [string, string]) => (lang === 'ja' ? m[0] : m[1]);
  const notes = [...(region.notes ?? []).map(pick), ...substitutionNotes(extracted, line, lang)];
  if (region.label[1].startsWith('GitHub Actions')) notes.push(...githubFileNotes(original[line] ?? '', lang));
  if (region.warnPipefail && pipesOn(tree.rootNode, line) && !/pipefail/.test(extracted.text.split('\n').slice(region.start, region.end + 1).join('\n'))) {
    notes.push(pick([
      '⚠ パイプの途中のコマンドが失敗しても、RUN は最後のコマンドの結果だけで成功扱いになり、ビルドは止まりません。先に `SHELL ["/bin/bash", "-o", "pipefail", "-c"]` と書くと失敗を検出できます。',
      '⚠ If a command in the middle of the pipe fails, RUN still succeeds with the status of the last command, and the build goes on. Put `SHELL ["/bin/bash", "-o", "pipefail", "-c"]` first to catch such failures.',
    ]));
  }
  ex.notes.unshift(...notes);
  return remapExplanation(ex, extracted, original, lang);
}
