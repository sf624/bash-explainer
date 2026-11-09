import * as assert from 'assert';
import { extractShell } from '../src/hosts';
import { pyLex } from '../src/hosts/pylex';
import { argValue } from '../src/hosts/pyvalue';
import { run } from './support/run';

// The shell text the Python host writes for a command string (src/hosts/python.ts, `pyScript`) runs as the string does: the
// value of the literals (`argValue`, held against Python in test/python-lexer.test.ts) and our text, each run by the shell
// with `-c`, print the same. The newlines that escapes give are what the shell reads there: the end of a command, a line
// continuation after a backslash, a newline of a quoted word.

/** Python lines, each with the shell that runs the string. */
const CASES: [string, 'sh' | 'bash'][] = [
  ['os.system("echo a\\necho b")', 'sh'],
  ['os.system("echo a\\012echo \\101")', 'sh'],
  ['os.system("echo a \\\\\\nb")', 'sh'],
  ['os.system("echo \\"a\\\\\\nb\\"")', 'sh'],
  ['os.system("echo \'a\\\\b\' \\"c\\\\\\"d\\"")', 'sh'],
  ['os.system("""echo a\necho b""")', 'sh'],
  ['os.system("echo a "\n          "b")', 'sh'],
  ['os.system("echo a\\\nb")', 'sh'],
  // (In sh, which has no `$'…'`, a newline in quotes is a placeholder, run with the newline as its value: one word still.)
  ['os.system("printf \'%s|\' \'a\\nb\' c")', 'sh'],
  ['os.system("printf \'%s|\' \\"a\\nb\\" c")', 'sh'],
  ['os.system("printf \'hello\\n\'")', 'sh'],
  ['os.system("printf \'%s|\' \\N{BULLET}x \'\\N{BULLET}\' \\"\\N{BULLET}\\"")', 'sh'],
  ['subprocess.run("echo \'x\\ny\'", shell=True, executable="/bin/bash")', 'bash'],
  ['subprocess.run("echo \\"x\\ny\\" \\\\\\n z", shell=True, executable="/bin/bash")', 'bash'],
];

/** The values of the placeholders of characters we do not write: a newline in quotes, and the `\N{…}` of the cases. */
const PLACEHOLDERS = { py_newline: '\n', py_N_BULLET: '\u2022' };

describe('Python command strings, run by the shell as written and as we write them', () => {
  for (const [line, shell] of CASES) {
    it(`${line.replace(/\n/g, '⏎')} (${shell})`, () => {
      const src = `import os, subprocess\n${line}\n`;
      const e = extractShell('python', src);
      assert.strictEqual(e.regions.length, 1);
      const ours = e.text.split('\n').slice(e.regions[0].start, e.regions[0].end + 1).join('\n');
      const { tokens } = pyLex(src);
      const arg = argValue(src, tokens.slice(tokens.findIndex((t) => t.lit)))!;
      // (Python's value: the characters of the `\N{…}` escapes put in.)
      let value = arg.value;
      for (const h of [...arg.holes].reverse()) value = value.slice(0, h.at) + PLACEHOLDERS.py_N_BULLET + value.slice(h.at);
      const out = (script: string) => {
        const r = run(shell, ['-c', script], { timeout: 10000, env: { ...process.env, ...PLACEHOLDERS } });
        return { status: r.status, stdout: r.stdout.toString() };
      };
      assert.deepStrictEqual(out(ours), out(value), `${JSON.stringify(ours)} for ${JSON.stringify(value)}`);
    });
  }
});
