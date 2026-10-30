// The texts of an operand's readings (src/explain/operand-texts.ts, `readingsParts`; docs/design/count-hedges.md step 4):
// each role a reading may give a word, named as the explanation says it, and the command that reads it where another
// command reads its role as written. The readings are written out by hand, one clause for each kind of role, so that
// each is said once; the lines of test/count-hedges-real.test.ts check the readings of real lines against the tools.
import * as assert from 'assert';
import type { ArgRole } from '../src/argv/interpret';
import type { Profile, Role, WordReadings } from '../src/argv/profiles';
import type { Explainer } from '../src/explain/context';
import { readingsParts } from '../src/explain/operand-texts';
import { tx } from '../src/i18n';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, field } from '../src/syntax/tree';

/** The words of the first command of `line`, its name left out. */
function nodesOf(line: string) {
  const c = descendants(createUnbashParser().parse(line).root, ['command'])[0];
  const name = field(c, 'name')!;
  return c.namedChildren.filter((x) => x !== name);
}

/** An explainer in one language: only its texts are read. */
const cxOf = (lang: 'ja' | 'en'): Explainer => ({ lang, s: (ja: string, en: string) => (lang === 'ja' ? ja : en), t: (x: { ja: string; en: string }) => x[lang] }) as unknown as Explainer;

const role = (r: ArgRole, by: (number | undefined)[] = []): Role => ({ key: `${by.join()}\0${JSON.stringify(r).slice(0, 60)}`, role: r, by });
const profile = (roles: Role[]): Profile => ({ key: roles.map((r) => r.key).join(), counts: [1], entries: [{ outcome: 'read', roles }], places: roles, groups: [{ from: 1, to: 1, roles }], orMore: false });

describe('the readings of an operand, as the explanation says them (count-hedges.md, step 4)', () => {
  const option = { names: ['-v'], text: tx('一致しない行', 'invert') };
  const kinds: [ArgRole, (number | undefined)[]][] = [
    [{ role: 'operand', index: 0 }, []],
    [{ role: 'value', of: '-n', index: 0 }, [0]],
    [{ role: 'option', flag: '-v', spec: option, text: option.text }, []],
    [{ role: 'unknown-option', flag: '-z' }, []],
    [{ role: 'cluster', letters: [{ role: 'option', flag: '-d', spec: option, text: option.text }, { role: 'unknown-option', flag: '-s' }] }, []],
    [{ role: 'end-of-options' }, []],
    [{ role: 'command', slot: { run: 'exec' } }, [undefined]],
    [{ role: 'subcommand', name: 'log', spec: { summary: tx('', '') }, parse: { command: 'x', roles: [], end: 0, unmatched: [] } }, []],
    [{ role: 'terminator', text: ';', of: '-exec' }, []],
    [{ role: 'expression' }, []],
    [{ role: 'joined' }, []],
    [{ role: 'open-option', prefix: '-' }, []],
  ];
  const base = role({ role: 'operand', index: 0, spec: { name: 'F', text: tx('ファイル', 'file') } }, [0]);
  const clauses = kinds.map(([r, by], n) => ({ profile: profile([role(r, by)]), conditions: [[{ place: 0, from: n + 1, to: n + 1 }]] }));
  const readings: WordReadings = {
    kind: 'read', places: [{ words: [0], one: true, counted: true, values: [{ n: 0 }] }], contexts: [[0]], profiles: [profile([base])], base: profile([base]), clauses,
  };
  const nodes = nodesOf('nice $a -n 5 ls');

  it('names each role, and the command that reads it where another reads its role as written', () => {
    const { base: said, rest } = readingsParts(cxOf('en'), 'Word `5`', readings, 2, nodes);
    assert.strictEqual(said, 'Word `5`');
    assert.deepStrictEqual(rest.split('. ').slice(1).map((c) => c.replace(/^When `\$a` expands to (a single word|\d+ words), it is /, '')), [
      'argument of `nice`', 'value for `-n`', 'option `-v` (invert) of `nice`', 'option `-z` (not in the dictionary) of `nice`', 'options `-d`, `-s` of `nice`', 'end of options of `nice`',
      'the command to run of the command it runs', 'subcommand `log` of `nice`', 'end of `-exec` of `nice`', 'a word of the expression of `nice`', 'a word of the command string of `nice`', 'argument of `nice`',
    ]);
  });

  it('says them in Japanese, with a space before code', () => {
    const { rest } = readingsParts(cxOf('ja'), '文字列 `5`', readings, 2, nodes);
    assert.deepStrictEqual(rest.split('。').slice(1, 4), ['`$a` が1語なら `nice` の引数', '`$a` が2語なら `-n` オプションの値', '`$a` が3語なら `nice` のオプション `-v`（一致しない行）']);
    assert.match(rest, /`\$a` が7語なら実行されるコマンドの実行するコマンド/);
  });

  it('says only that the role may depend on the counts past the cap', () => {
    assert.deepStrictEqual(readingsParts(cxOf('en'), 'source', { kind: 'depends', words: [0] }, 2, nodes), { base: 'source', rest: '. Its role may depend on how many words `$a` gives' });
    assert.deepStrictEqual(readingsParts(cxOf('en'), 'source', undefined, 2, nodes), { base: 'source', rest: '' });
  });
});
