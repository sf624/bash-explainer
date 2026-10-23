import { type Shell, shellFromName } from '../dialect';
import { LineOut, Builder } from './builder';

/** One string of a JSON array (the exec form), with the original column of each character. */
export interface JsonWord {
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
export function execWords(b: Builder, words: JsonWord[]): void {
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
        shell = shellFromName(prog) ?? 'sh';
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
      // (`busybox` runs a shell only as the applet `sh` or `ash`: `busybox -c` is "applet not found".)
      const target = prog.replace(/\d+(\.\d+)*$/, '') === 'busybox' && !/^a?sh$/.test(words[1]?.value ?? '') ? undefined : shellFromName(prog);
      if (target && c > 0 && words[c + 1]) {
        const script = words[c + 1];
        const o = (b.outs[script.line] ??= new LineOut());
        for (let k = 0; k < script.value.length; k++) o.insert(script.value[k], script.cols[k], script.cols[k] + 1);
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

