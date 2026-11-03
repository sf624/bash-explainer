import { type Shell, shellFromName } from '../dialect';
import type { RegionNote } from './index';
import { type JsonWord, execWords } from './dockerfile';
import { LineOut, Builder } from './builder';

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

export function python(b: Builder): void {
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
    const target: Shell = (exe && shellFromName(exe)) || 'sh';
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
        b.region(script.first, script.last, label(['shell=True のリストの最初の要素をシェルが実行', 'shell=True: the shell runs the first item of the list']), target, [{ spec: { id: 'python-shell-list', params: {} } }]);
        continue;
      }
      const words = items.map(([a, z]) => pyWord(src, a, z, pos));
      if (words.some((w) => !w)) continue;
      const ws = words as JsonWord[];
      execWords(b, ws);
      b.execRegion(ws[0].line, ws[ws.length - 1].line, label(['シェルを通さずに実行する引数のリスト', 'arguments run without a shell']), [{ spec: { id: 'python-exec-list', params: {} } }], ['Python の文字列', 'Python string']);
      continue;
    }
    const script = pyScript(b, src, a0, z0, pos);
    if (!script) continue;
    const notes: RegionNote[] = [];
    if (!usesShell && /\s/.test(script.text.trim())) {
      notes.push(shellArg === undefined || shellArg === 'False' ? { spec: { id: 'python-string-without-shell', params: {} }, code: 'pythonNoShell' } : { spec: { id: 'python-shell-expression', params: {} } });
    }
    if (usesShell && script.interpolated) {
      notes.push({ spec: { id: 'python-shell-injection', params: {} }, code: 'pythonInjection' });
    }
    if (script.partial) notes.push({ spec: { id: 'python-string-partial', params: {} } });
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

