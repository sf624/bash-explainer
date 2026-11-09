// Helpers of test/small-tools.test.ts and test/small-tools-real.test.ts: the option lines recorded in test/fixtures/small-tools/,
// and what the specs make of a word.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { lookupCommand } from '../../src/analyzer';
import { ArgRole, interpret } from '../../src/argv/interpret';
import { argWords } from './argwords';

export const fixture = (name: string): string[] => fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'small-tools', name), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));

/** What a spec makes of `tool WORDS`: the role of the first word, and whether the second is its value. */
export function reads(tool: string, words: string[]): { role: ArgRole['role']; takesValue: boolean } {
  const { name, words: ws } = argWords(`${tool} ${words.map((w) => `'${w}'`).join(' ')}`);
  const p = interpret(lookupCommand(name)!, ws, { name, lookup: lookupCommand });
  const first = p.roles.find((r) => r.word === 0)!.role;
  const second = p.roles.find((r) => r.word === 1)?.role;
  return { role: first.role, takesValue: second?.role === 'value' };
}

/** An option as a tool's text lists it: the words that write it, and whether a value follows as a word. */
export interface Entry { words: string[]; value: boolean }

/** The options each fixture lists. */
export const ENTRIES: Record<string, () => Entry[]> = {
  // `-e, --regexp=PATTERN`, `--pre=COMMAND`, `-., --hidden`, `--no-heading`.
  rg: () => fixture('rg.txt').map((l) => ({ words: l.replace(/=.*/, '').split(', '), value: l.includes('=') })),
  // `-s, --size SIZE`, `-p, --progress`.
  pv: () => fixture('pv.txt').map((l) => ({ words: l.replace(/ [A-Z][^,]*$/, '').split(', '), value: / [A-Z]/.test(l) })),
  // `   -f filename   Take password…`.
  sshpass: () => fixture('sshpass.txt').flatMap((l) => {
    const m = /^ {3}(-\w)(?: (\w+))? {2,}\S/.exec(l);
    return m ? [{ words: [m[1]], value: !!m[2] }] : [];
  }),
  sponge: () => [{ words: ['-a'], value: false }],
  expect: () => fixture('expect.txt').filter((l) => /^-\w/.test(l)).map((l) => ({ words: [l.split(' ')[0]], value: l.includes(' ') })),
  // `-h|-?`, `-d[ddd]`, `-d0|1|2|3|4`, `-ly[facility]`, `-lf<logfile>`, `-r <file>`, `--experimental`.
  socat: () => fixture('socat.txt').flatMap((l): Entry[] => {
    const head = l.trim().split(/ {2,}|\t| (?=[a-z])/)[0];
    if (head === '-d[ddd]') return [{ words: ['-d'], value: false }, { words: ['-dd'], value: false }, { words: ['-dddd'], value: false }];
    if (head === '-d0|1|2|3|4') return [0, 4].map((n) => ({ words: [`-d${n}`], value: false }));
    return head.split('|').map((h): Entry => {
      const m = /^(-[A-Za-z?0-9]+|--[a-z]+)(?:\[[a-z]+\]|<[a-z_]+>| <[a-z]+>)?$/.exec(h);
      assert.ok(m, `socat: cannot read ${h}`);
      // (`-b<size_t>`, `-lf<logfile>`, `-ly[facility]` are written with the value attached; `-r <file>` with it in the next word.)
      if (/^-[^-]\S*<|\[/.test(h)) return { words: [m[1], m[1] + 'x'], value: false };
      return { words: [m[1]], value: h.includes(' <') };
    });
  }),
};
