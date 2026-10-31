import { type Shell, shellFromName } from '../dialect';
import { LineOut, Builder } from './builder';
import type { RegionNote } from './index';
import { DECLARATIONS } from '../semantics/effects';
import { RESERVED } from '../semantics/names';

/** One string of a JSON array (the exec form), with the original column of each character. */
export interface JsonWord {
  line: number; start: number; end: number; value: string; cols: number[];
  /** Not a literal: shell text standing for the value of a host expression, and what it means. */
  placeholder?: [string, [string, string]];
}

/** The escapes of a JSON string, but `\uXXXX`: what each stands for. */
const JSON_ESCAPES: Readonly<Record<string, string>> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

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
        // JSON's escapes (RFC 8259, 7): Docker reads the array as JSON, and one it cannot read is no exec form.
        const e = l[k + 1];
        const hex = e === 'u' ? /^[0-9a-fA-F]{4}/.exec(l.slice(k + 2))?.[0] : undefined;
        const c = hex ? String.fromCharCode(parseInt(hex, 16)) : JSON_ESCAPES[e];
        if (c === undefined) return undefined;
        w.value += c;
        w.cols.push(k);
        k += hex ? 5 : 1;
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

/**
 * Whether bash reads the plain word `value`, the `n`th of `words`, as more than a word of text: a reserved word or an
 * assignment as the command name (`if`, `A=1`), or an assignment after a builtin that declares names (`export A=1`).
 * Each word of the exec form is text, so such a word is quoted.
 */
function readAsSyntax(value: string, n: number, words: JsonWord[]): boolean {
  const assignment = /^[A-Za-z_]\w*\+?=/.test(value);
  return n === 0 ? RESERVED.has(value) || assignment : assignment && DECLARATIONS.has(words[0].value);
}

/** Write exec-form words as shell words, each at its own columns. */
export function execWords(b: Builder, words: JsonWord[]): void {
  words.forEach((w, n) => {
    const o = (b.outs[w.line] ??= new LineOut());
    const next = words[n + 1];
    const char = (c: number) => o.insert(w.value[c], w.cols[c], w.cols[c] + 1);
    if (w.placeholder) {
      o.insert(w.placeholder[0], w.start, w.end, w.placeholder[1]);
    } else if (/^[\w@%+=:,./-]+$/.test(w.value) && w.value.length === w.end - w.start - 2 && !readAsSyntax(w.value, n, words)) {
      // A plain word reads the same to the shell, so commands and options are recognised. (Not one written with
      // escapes, `"\u0041"`, nor with a prefix, Python's `r"x"`: quoted, its token says what it is, `A`.)
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


const ONBUILD_NOTE: RegionNote = [
  'ONBUILD の命令は、このイメージをもとにする別のイメージのビルドで（その FROM の直後に）実行されます。',
  'An ONBUILD instruction runs later, in the build of another image FROM this one (just after its FROM).',
];

const HEALTHCHECK_NOTE: RegionNote = [
  'HEALTHCHECK は、動いているコンテナの中でこのコマンドを実行して状態を調べます。終了ステータス 0 は正常（healthy）、1 は異常（unhealthy）です（2 は予約されていて使いません）。',
  'HEALTHCHECK runs this command in the running container to check its health: exit status 0 is healthy, 1 unhealthy (2 is reserved).',
];

/**
 * The instructions whose text is a command, each also after `ONBUILD` (a trigger, run in a build FROM this image):
 * RUN, CMD, ENTRYPOINT and SHELL, after their flags (`RUN --mount=…`), and HEALTHCHECK after its options and `CMD`
 * (`HEALTHCHECK NONE` has no command).
 */
const INSTRUCTION = /^\s*(ONBUILD\s+)?(RUN|CMD|ENTRYPOINT|SHELL|HEALTHCHECK)(\s+(?:--[\w-]+(?:=\S*)?\s+)*)/i;

/**
 * Where the command of the instruction on line `i` starts (`line`, `at`), if the line starts one. HEALTHCHECK's options
 * may go on over lines continued with `\` before its `CMD`.
 */
function commandHead(b: Builder, i: number): { instr: string; onbuild: boolean; line: number; at: number } | undefined {
  const m = INSTRUCTION.exec(b.lines[i]);
  if (!m) return undefined;
  const instr = m[2].toUpperCase();
  const head = { instr, onbuild: !!m[1], line: i, at: m[0].length };
  if (instr !== 'HEALTHCHECK') return head;
  for (;;) {
    const rest = b.lines[head.line].slice(head.at);
    const cmd = /^CMD\s+/i.exec(rest);
    if (cmd) return { ...head, at: head.at + cmd[0].length };
    if (!/^\\\s*$/.test(rest) || head.line + 1 >= b.lines.length) return undefined;
    // (Docker drops the comment lines in a continuation.)
    do head.line++; while (/^\s*#/.test(b.lines[head.line]) && head.line + 1 < b.lines.length);
    head.at = /^\s*(?:--[\w-]+(?:=\S*)?\s+)*/.exec(b.lines[head.line])![0].length;
  }
}

export function dockerfile(b: Builder): void {
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
    // (`ARG V=1`, `ENV A=1 B=2`, `ENV A 1`: variables the instructions after it run with.)
    const declared = /^\s*(ARG|ENV)\s+(.*)$/i.exec(line);
    if (declared) {
      const words = declared[2].trim().split(/\s+/);
      b.provided.push(...(declared[1].toUpperCase() === 'ARG' || words[0].includes('=') ? words.map((w) => /^([A-Za-z_]\w*)/.exec(w)?.[1]).filter((n): n is string => !!n) : [words[0]]));
      continue;
    }
    const head = commandHead(b, i);
    if (!head) continue;
    const { at, instr, onbuild } = head;
    // (A trigger's SHELL sets the shell of the build that runs it, not of this one: it is left out.)
    if (onbuild && instr === 'SHELL') continue;
    i = head.line;
    const label = (ja: string, en: string): [string, string] => [`Dockerfile の ${onbuild ? 'ONBUILD ' : ''}${instr}${ja}`, `Dockerfile ${onbuild ? 'ONBUILD ' : ''}${instr}${en}`];
    const notes = [...(onbuild ? [ONBUILD_NOTE] : []), ...(instr === 'HEALTHCHECK' ? [HEALTHCHECK_NOTE] : [])];
    const regionNotes = notes.length ? notes : undefined;
    if (/^\[\s*"/.test(b.lines[i].slice(at))) {
      // Starting with `[ "`, a list that parses has a word.
      const parsed = jsonWords(b.lines, i, at);
      if (!parsed) continue;
      const { words, last } = parsed;
      const prog = words[0].value.split('/').pop()!;
      if (instr === 'SHELL') {
        notShell = /^(powershell|pwsh|cmd)(\.exe)?$/i.test(prog);
        if (notShell) { i = last; continue; }
        shell = shellFromName(prog) ?? 'sh';
        pipefail = words.some((w, n) => w.value === 'pipefail' && /^-\w*o$/.test(words[n - 1]?.value ?? ''));
        execWords(b, words);
        b.region(i, last, ['Dockerfile の SHELL', 'Dockerfile SHELL'], 'bash', [[
          '以降の RUN・CMD・ENTRYPOINT・HEALTHCHECK のシェル形式は、このコマンドの最後に命令の内容を付けて実行されます（例: `/bin/bash -o pipefail -c "<RUN の内容>"`）。',
          'Later shell-form RUN, CMD, ENTRYPOINT and HEALTHCHECK instructions run with this command, followed by their text (e.g. `/bin/bash -o pipefail -c "<RUN text>"`).',
        ]]);
        i = last;
        continue;
      }
      // `RUN ["sh", "-c", "script"]`: the string after `-c` is a shell script.
      const c = words.findIndex((w, n) => n > 0 && /^-\w*c$/.test(w.value));
      // (`busybox` runs a shell only as the applet `sh` or `ash`: `busybox -c` is "applet not found".)
      const target = prog.replace(/\d+(\.\d+)*$/, '') === 'busybox' && !/^a?sh$/.test(words[1]?.value ?? '') ? undefined : shellFromName(prog);
      if (target && c > 0 && words[c + 1]) {
        const script = words[c + 1];
        const o = (b.outs[script.line] ??= new LineOut());
        for (let k = 0; k < script.value.length; k++) o.insert(script.value[k], script.cols[k], script.cols[k] + 1);
        b.region(script.line, script.line, label(`（exec 形式で \`${words[0].value} ${words[c].value}\` に渡すスクリプト）`, ` (a script passed to \`${words[0].value} ${words[c].value}\` in exec form)`), target, regionNotes);
        i = last;
        continue;
      }
      execWords(b, words);
      b.execRegion(i, last, label('（exec 形式）', ' (exec form)'), [...notes, [
        'exec 形式（`[...]`）はシェルを通さずにコマンドを直接実行します。`$VAR` の展開・パイプ・リダイレクト・`&&` などは働かず、各要素がそのまま引数になります。',
        'The exec form (`[...]`) runs the command directly, without a shell: `$VAR`, pipes, redirections and `&&` do not work, and each element is passed as it is.',
      ]], ['JSON の文字列', 'JSON string']);
      i = last;
      continue;
    }
    if (instr === 'SHELL') continue;
    if (notShell) {
      // Skip the instruction and its continuation lines (PowerShell continues with a backtick).
      while (/[\\`]\s*$/.test(b.lines[i]) && i + 1 < b.lines.length) i++;
      continue;
    }
    const heredoc = /^<<-?\s*["']?(\w+)["']?/.exec(b.lines[i].slice(at));
    if (heredoc) {
      // `RUN <<EOF` … `EOF`: the body is the script.
      const start = i + 1;
      let j = start;
      while (j < b.lines.length && b.lines[j].trim() !== heredoc[1]) b.plain(j++);
      b.region(start, j - 1, label('（ヒアドキュメント）', ' (here-document)'), shell, regionNotes, instr === 'RUN' && !pipefail);
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
    b.region(start, i, label('', ''), shell, regionNotes, instr === 'RUN' && !pipefail);
  }
}

