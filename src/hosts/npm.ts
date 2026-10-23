import { LineOut, Builder } from './builder';

export function npm(b: Builder): void {
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

