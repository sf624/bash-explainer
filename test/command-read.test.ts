// The reading of a simple command on the model (docs/design/known-values.md, section 3; a slice of `commandRead`,
// docs/design/sources.md, SC2): what its name runs, the spec, and the parse of its words, kept for the document, and the
// context a reader of a word's language is given from it (`embeddedContext`). Until SC2, the style checks keep their own
// lookup (`specRuns`, src/pitfalls.ts): the last test holds it to the same spec and parse on every command of the tests.
import * as assert from 'assert';
import type { ArgvParse } from '../src/argv/interpret';
import { detectShell } from '../src/dialect';
import { BATS_COMMANDS } from '../src/dict/bats';
import { embeddedContext } from '../src/explain/embedded';
import { specRuns } from '../src/pitfalls';
import type { CommandLookup } from '../src/semantics/commandhead';
import { commandReading, type CommandReading } from '../src/semantics/commandread';
import { shellState } from '../src/semantics/state';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, field, type SyntaxNode } from '../src/syntax/tree';
import { corpus } from './support/corpus';

const parser = createUnbashParser();
const NONE: CommandLookup = { yq: { doc: '' } };

/** The reading of the first simple command of `text`, with `lookup`. */
function readFirst(text: string, lookup: CommandLookup = { yq: { doc: text } }): { reading: CommandReading; cmd: SyntaxNode } {
  const tree = parser.parse(text);
  const model = shellState(tree, undefined, lookup.hostCommands ? { host: lookup.hostCommands } : {});
  const cmd = descendants(tree.root, ['command'])[0];
  return { reading: commandReading(cmd, model, lookup), cmd };
}

/** A parse as roles: each word's index and role, with the flag of an option. */
const rolesOf = (p: ArgvParse): string[] => p.roles.map(({ word, role }) => `${word} ${role.role}${'flag' in role ? ` ${role.flag}` : ''}`);

describe('command reading on the model (docs/design/known-values.md, 3)', () => {
  it('reads a command by its spec, and keeps the reading for the model and the lookup', () => {
    const tree = parser.parse('grep -E "a+" f');
    const model = shellState(tree, undefined);
    const cmd = descendants(tree.root, ['command'])[0];
    const r = commandReading(cmd, model, NONE);
    assert.strictEqual(r.head.name, 'grep');
    assert.strictEqual(r.head.how.case, 'spec');
    assert.deepStrictEqual(rolesOf(r.parse), ['0 option -E', '1 operand', '2 operand']);
    // (One reading for the document, whichever line asks; another setting is another reading.)
    assert.strictEqual(commandReading(cmd, model, { yq: { doc: 'other text' } }), r);
    assert.notStrictEqual(commandReading(cmd, model, { customCommands: {}, yq: { doc: '' } }), r);
  });

  it('reads a command of the customCommands setting with its spec', () => {
    const { reading } = readFirst('deploy -n x', { customCommands: { deploy: { summary: 'Deploy', options: { '-n': 'dry run' } } }, yq: { doc: '' } });
    assert.strictEqual(reading.head.how.case, 'custom');
    assert.deepStrictEqual(rolesOf(reading.parse), ['0 option -n', '1 operand']);
  });

  it("reads a host's command (bats' `run`) with the host's spec, and the command it runs", () => {
    const { reading } = readFirst('run grep -E "a+" f', { hostCommands: BATS_COMMANDS, yq: { doc: '' } });
    assert.strictEqual(reading.head.how.case, 'spec');
    assert.strictEqual(reading.spec, BATS_COMMANDS.run);
    assert.deepStrictEqual(rolesOf(reading.parse), ['0 command']);
  });

  it('gives a reader of a word the context of the command reading, and the document part of where the word is', () => {
    const { reading } = readFirst("sed -E -n 's/a+/b/p' f");
    const word = reading.args[2];
    const read = { cmd: reading.parse.command, parse: reading.parse, nodes: [...reading.args], spec: reading.spec };
    const ecx = embeddedContext(read, word, { lang: 'en', shell: undefined }, { evidence: () => 'unsure', stop: () => 'sure' });
    assert.strictEqual(ecx.flavor(), 'ere');
    assert.ok(ecx.given('-n') && ecx.given('--quiet') && !ecx.given('-z'));
    assert.deepStrictEqual([...ecx.letters()].sort(), ['E', 'n']);
    assert.strictEqual(ecx.bash(), undefined);
    // (With no line to ask, the document's part as it is: a word after a sure stop is not reached.)
    assert.strictEqual(ecx.reached(), false);
    assert.strictEqual(ecx.invalid(), embeddedContext(read, word, { lang: 'en', shell: undefined }, { evidence: () => 'unsure', stop: () => undefined }).invalid());
  });

  it('gives the spec and the parse the style checks give (`specRuns`), on every command of the tests', function () {
    this.timeout(120000);
    const { files, snippets } = corpus();
    let same = 0;
    const apart = new Map<string, number>();
    const unexplained: string[] = [];
    for (const input of [...files, ...snippets]) {
      const tree = parser.parse(input.text);
      const shell = detectShell(input.text, input.name.startsWith('snippet') ? '' : input.name);
      const model = shellState(tree, shell);
      for (const cmd of descendants(tree.root, ['command'])) {
        if (!field(cmd, 'name')) continue;
        const run = specRuns(cmd, model, shell).find((r) => r.run.nameWord === field(cmd, 'name'));
        if (!run) continue;
        const reading = commandReading(cmd, model, { yq: { doc: input.text } });
        const why = reading.head.variant ? 'variant' : reading.head.yq ? 'yq' : ['off', 'no-shell'].includes(reading.head.how.case) ? reading.head.how.case
          : reading.parse.roles.some(({ role }) => 'text' in role && /environment/.test(typeof role.text === 'string' ? role.text : role.text.en)) ? 'sole'
          // (The checks read a path by the last part of its name, `pathCommand`: `/bin/kill` with the builtin's spec.)
          : reading.head.name.includes('/') && run.spec.builtin && !reading.spec.builtin ? 'path' : undefined;
        if (reading.spec === run.spec && rolesOf(reading.parse).join() === rolesOf(run.parse).join()) {
          same++;
          continue;
        }
        // Where they differ, the reading knows more than the checks' own lookup: a builtin's variant for the shell
        // options, yq's flavour, a builtin turned off or a path `hash -p` gave, a name no shell reads, a word a program
        // reads as an option only alone, the program a path runs. Nothing else may differ.
        if (why) apart.set(why, (apart.get(why) ?? 0) + 1);
        else unexplained.push(`${input.name}: ${cmd.text}: ${rolesOf(reading.parse).join()} / ${rolesOf(run.parse).join()}`);
      }
    }
    if (process.env.PRINT_APART) console.log(same, [...apart]);
    assert.deepStrictEqual(unexplained, []);
    assert.ok(same > 2000, `${same} commands`);
    assert.ok([...apart.values()].reduce((a, b) => a + b, 0) < same / 50, JSON.stringify([...apart]));
  });
});
