// Worked examples run for real: the files and the standard input an example shows, given to the tool on the line.
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Example } from '../../src/analyzer';
import { explain } from './explain';
import { run } from './run';

/** Whether a tool runs (`tool --version`). */
export const has = (tool: string): boolean => spawnSync(tool, ['--version']).status === 0;

/** The example of the command on line 0: the whole pipeline's, or else the first that has an output. */
export function exampleOf(src: string, lang: 'en' | 'ja' = 'en'): Example | undefined {
  const all = explain(src, 0, lang).examples;
  return all.find((e) => /whole pipeline|パイプライン全体/.test(e.title))
    ?? all.find((e) => e.sections.some((s) => /^(Output|出力|Error|After|`[^`]+` after|書き換え後|Commands|Written to)/.test(s.label)));
}

/**
 * Runs `line` with bash in a directory holding the files its example shows, with the standard input it shows (its
 * last section is the output, or a file written); `bin`: programs put first on PATH, by name. What it printed (or
 * wrote), and what the example says.
 */
export function realOutput(line: string, ex: Example, bin: Record<string, string> = {}): { got: string; want: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-examples-'));
  try {
    let stdin = '';
    // A file given as stdin that the command does not read, and so has no section.
    for (const m of line.matchAll(/< (\w[\w.]*)/g)) fs.writeFileSync(path.join(dir, m[1]), 'not read\n');
    const out = ex.sections[ex.sections.length - 1];
    for (const sec of ex.sections.slice(0, -1)) {
      const text = sec.lines.map((l) => l + '\n').join('');
      const file = /^Input(?: read by `\w+`)?: (?:stdin \()?`([^`]+)`/.exec(sec.label)?.[1];
      if (file) fs.writeFileSync(path.join(dir, file), text);
      else if (/^Input(?: read by `\w+`)?: stdin \(sample contents\)$/.test(sec.label)) stdin = text;
    }
    const binDir = path.join(dir, '.bin');
    fs.mkdirSync(binDir);
    for (const [name, target] of Object.entries(bin)) fs.symlinkSync(target, path.join(binDir, name));
    const r = run('bash', ['-c', line], { cwd: dir, input: stdin, env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` } });
    // What a file gets: one the output is written to, or the file rewritten in place (the first input file).
    const firstFile = ex.sections.map((sec) => /^Input: `([^`]+)`/.exec(sec.label)?.[1]).find((f) => f);
    const written = /^Written to `([^`]+)`$|^`([^`]+)` after$/.exec(out.label)?.slice(1).find((f) => f) ?? (out.label === 'After' ? firstFile : undefined);
    const stdout = r.stdout.toString();
    const got = written ? (stdout === '' ? fs.readFileSync(path.join(dir, written), 'utf8') : `stdout: ${stdout}`) : stdout;
    return { got: got.replace(/\n$/, ''), want: out.lines.join('\n') };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
