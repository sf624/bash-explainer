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
}

/** Something the host replaces before the shell sees it (`$(CC)` in make, `${{ … }}` in GitHub Actions). */
export interface HostSubstitution {
  line: number;
  text: string;
  meaning: [string, string];
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
  region(start: number, end: number, label: [string, string], shell?: Shell): void {
    if (end >= start) this.regions.push({ start, end, label, shell });
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

function dockerfile(b: Builder): void {
  // `SHELL ["/bin/bash", "-c"]` changes the shell for later instructions.
  let shell: Shell = 'sh';
  for (let i = 0; i < b.lines.length; i++) {
    const line = b.lines[i];
    const shellInstr = /^\s*SHELL\s+\[\s*"([^"]+)"/i.exec(line);
    if (shellInstr) {
      const name = shellInstr[1].split('/').pop()!;
      shell = name === 'bash' ? 'bash' : name === 'sh' || name === 'dash' ? 'sh' : name === 'ash' ? 'ash' : shell;
      continue;
    }
    const m = /^(\s*)(RUN|CMD|ENTRYPOINT)(\s+(?:--[\w-]+(?:=\S*)?\s+)*)/i.exec(line);
    if (!m) continue;
    const at = m[0].length;
    const instr = m[2].toUpperCase();
    // The exec form `RUN ["cmd", "arg"]` does not use a shell.
    if (/^\[\s*"/.test(line.slice(at))) continue;
    const heredoc = /^<<-?\s*["']?(\w+)["']?/.exec(line.slice(at));
    if (heredoc) {
      // `RUN <<EOF` … `EOF`: the body is the script.
      const start = i + 1;
      let j = start;
      while (j < b.lines.length && b.lines[j].trim() !== heredoc[1]) b.plain(j++);
      b.region(start, j - 1, [`Dockerfile の ${instr}（ヒアドキュメント）`, `Dockerfile ${instr} (here-document)`], shell);
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
    b.region(start, i, [`Dockerfile の ${instr}`, `Dockerfile ${instr}`], shell);
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
    const shell = yamlShell(b, i, indent, key, githubLike);
    if (shell === null) continue;
    const label: [string, string] = [`YAML の \`${key}:\``, `YAML \`${key}:\``];
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
  return githubLike ? 'bash' : undefined;
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
    b.substitutions.push({ line: i, text: m[0], meaning });
    at = m.index + m[0].length;
  }
  o.copy(line, at, to);
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
    .map((s) => (lang === 'ja' ? `\`${s.text}\` は${s.meaning[0]}。` : `\`${s.text}\` is ${s.meaning[1]}.`));
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
  ex.notes.unshift(...substitutionNotes(extracted, line, lang));
  return remapExplanation(ex, extracted, original, lang);
}
