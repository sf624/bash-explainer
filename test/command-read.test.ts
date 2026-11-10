// The reading of a simple command on the model (docs/design/known-values.md, section 3; a slice of `commandRead`,
// docs/design/sources.md, SC2): what its name runs, the spec, and the parse of its words, kept for the document, and the
// context a reader of a word's language is given from it (`embeddedContext`). Until SC2, the style checks keep their own
// lookup (`specRuns`, src/pitfalls.ts): a test holds it to the same spec and parse on every command of the tests. And the
// decision of the spec stays on the model: src/explain/ imports none of the lookups it reads (src/semantics/commandhead.ts).
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import type { ArgvParse } from '../src/argv/interpret';
import { detectShell } from '../src/dialect';
import { BATS_COMMANDS } from '../src/dict/bats';
import { embeddedContext, type LinePart } from '../src/explain/embedded';
import { specRuns } from '../src/pitfalls';
import type { CommandLookup } from '../src/semantics/commandhead';
import { commandReading, type CommandReading } from '../src/semantics/commandread';
import { shellState } from '../src/semantics/state';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, field, type SyntaxNode } from '../src/syntax/tree';
import { corpus } from './support/corpus';
import { base, parseSource, sourceFiles } from './support/scan';
import * as ts from 'typescript';

const parser = createUnbashParser();
const NONE: CommandLookup = { yq: {} };

/** The reading of the first simple command of `text`, with `lookup`. */
function readFirst(text: string, lookup: CommandLookup = NONE): { reading: CommandReading; cmd: SyntaxNode } {
  const tree = parser.parse(text);
  const model = shellState(tree, undefined, lookup.hostCommands ? { host: lookup.hostCommands } : {});
  const cmd = descendants(tree.root, ['command'])[0];
  return { reading: commandReading(cmd, model, lookup), cmd };
}

/** A parse as roles: each word's index and role, with the flag of an option. */
const rolesOf = (p: ArgvParse): string[] => p.roles.map(({ word, role }) => `${word} ${role.role}${'flag' in role ? ` ${role.flag}` : ''}`);

/**
 * Where `specRuns` and the reading differ on the commands of the tests, by reason: the reading knows more than the checks'
 * own lookup. `off`: a builtin turned off with `enable -n`, or a name `hash -p` gave a path; `variant`: a builtin's variant
 * for the shell options (`kill` in POSIX mode); `path`: the checks read a path by the last part of its name (`pathCommand`),
 * `/bin/kill` with the builtin's spec. Each count is exact: a change of the corpus or of either reading updates it here.
 */
const APART: Readonly<Record<string, number>> = { off: 10, path: 2, variant: 2 };

/** The lookups that decide a command's spec, which only the model reads (src/semantics/commandhead.ts). */
const SPEC_LOOKUPS = ['lookupCommand', 'customCommandSpec', 'distroAliases', 'yqSpecsOf', 'judgeYq'];
/** Files of src/explain/ that import one of `SPEC_LOOKUPS`, with the name: none, and none may come back. */
const SPEC_LOOKUPS_KNOWN: readonly string[] = [];

describe('command reading on the model (docs/design/known-values.md, 3)', () => {
  it('reads a command by its spec, and keeps the reading for the model and the lookup, by content', () => {
    const tree = parser.parse('grep -E "a+" f');
    const model = shellState(tree, undefined);
    const cmd = descendants(tree.root, ['command'])[0];
    const r = commandReading(cmd, model, NONE);
    assert.strictEqual(r.head.name, 'grep');
    assert.strictEqual(r.head.how.case, 'spec');
    assert.deepStrictEqual(rolesOf(r.parse), ['0 option -E', '1 operand', '2 operand']);
    // (One reading for the document, whichever line asks, also with the settings made afresh; another setting is another reading.)
    assert.strictEqual(commandReading(cmd, model, { yq: {} }), r);
    const custom = (): CommandLookup => ({ customCommands: { deploy: { summary: 'Deploy' } }, yq: {} });
    const other = commandReading(cmd, model, custom());
    assert.notStrictEqual(other, r);
    assert.strictEqual(commandReading(cmd, model, custom()), other);
  });

  it('reads a command of the customCommands setting with its spec', () => {
    const { reading } = readFirst('deploy -n x', { customCommands: { deploy: { summary: 'Deploy', options: { '-n': 'dry run' } } }, yq: {} });
    assert.strictEqual(reading.head.how.case, 'custom');
    assert.deepStrictEqual(rolesOf(reading.parse), ['0 option -n', '1 operand']);
  });

  it("reads a host's command (bats' `run`) with the host's spec, and the command it runs", () => {
    const { reading } = readFirst('run grep -E "a+" f', { hostCommands: BATS_COMMANDS, yq: {} });
    assert.strictEqual(reading.head.how.case, 'spec');
    assert.strictEqual(reading.spec, BATS_COMMANDS.run);
    assert.deepStrictEqual(rolesOf(reading.parse), ['0 command']);
  });

  it("tells the three yq apart by the text of the command's tree", () => {
    assert.strictEqual(readFirst("yq '.a' f.yml").reading.head.yq?.flavor, 'mikefarah4');
    assert.strictEqual(readFirst("# mikefarah/yq v3\nyq r f.yml a").reading.head.yq?.flavor, 'mikefarah3');
    // (A string read as a script, by its own text: the explanation reads it there.)
    const line = new Analyzer('en').explainLine(parser.parse("# mikefarah/yq v3\nbash -c \"yq r f.yml a\""), 1, 'bash', {});
    assert.ok(JSON.stringify(line).includes('yq'));
  });

  it('gives a reader of a word the context of the command reading, and where the word is', () => {
    const { reading } = readFirst("sed -E -n 's/a+/b/p' f");
    const word = reading.args[2];
    const read = { cmd: reading.parse.command, parse: reading.parse, nodes: [...reading.args], spec: reading.spec };
    const asIs: LinePart = { lineEvidence: (known) => known(), lineReached: (reached) => reached };
    const ecx = embeddedContext(read, word, { lang: 'en', shell: undefined }, { evidence: () => 'unsure', stop: () => 'sure' }, asIs);
    assert.strictEqual(ecx.flavor(), 'ere');
    assert.ok(ecx.given('-n') && ecx.given('--quiet') && !ecx.given('-z'));
    assert.deepStrictEqual([...ecx.letters()].sort(), ['E', 'n']);
    assert.strictEqual(ecx.bash(), undefined);
    assert.strictEqual(ecx.reached(), false);
    // (A line that reads the word in a string not surely read, `unread`, says no fault of it.)
    const unread: LinePart = { lineEvidence: () => undefined, lineReached: () => true };
    assert.notStrictEqual(ecx.invalid(), embeddedContext(read, word, { lang: 'en', shell: undefined }, { evidence: () => 'unsure', stop: () => 'sure' }, unread).invalid());
  });

  it('gives the spec and the parse the style checks give (`specRuns`), on every command of the tests, but where `APART` says', function () {
    this.timeout(120000);
    const { files, snippets } = corpus();
    let same = 0;
    const apart: Record<string, number> = {};
    const unexplained: string[] = [];
    for (const input of [...files, ...snippets]) {
      const tree = parser.parse(input.text);
      const shell = detectShell(input.text, input.name.startsWith('snippet') ? '' : input.name);
      const model = shellState(tree, shell);
      for (const cmd of descendants(tree.root, ['command'])) {
        if (!field(cmd, 'name')) continue;
        const run = specRuns(cmd, model, shell).find((r) => r.run.nameWord === field(cmd, 'name'));
        if (!run) continue;
        const reading = commandReading(cmd, model, NONE);
        if (reading.spec === run.spec && rolesOf(reading.parse).join() === rolesOf(run.parse).join()) {
          same++;
          continue;
        }
        const why = reading.head.variant ? 'variant' : reading.head.how.case === 'off' ? 'off'
          : reading.head.name.includes('/') && run.spec.builtin && !reading.spec.builtin ? 'path' : undefined;
        if (why) apart[why] = (apart[why] ?? 0) + 1;
        else unexplained.push(`${input.name}: ${cmd.text}: ${rolesOf(reading.parse).join()} / ${rolesOf(run.parse).join()}`);
      }
    }
    assert.deepStrictEqual(unexplained, []);
    assert.deepStrictEqual(apart, APART);
    assert.ok(same > 2000, `${same} commands`);
  });

  it('leaves the decision of the spec to the model: src/explain/ imports none of its lookups', () => {
    const found: string[] = [];
    for (const f of sourceFiles('src/explain')) {
      const rel = path.relative(base, f).split(path.sep).join('/');
      const src = parseSource(rel, fs.readFileSync(f, 'utf8'));
      for (const st of src.statements) {
        if (!ts.isImportDeclaration(st) || !st.importClause) continue;
        const names = st.importClause.namedBindings && ts.isNamedImports(st.importClause.namedBindings) ? st.importClause.namedBindings.elements.map((e) => (e.propertyName ?? e.name).text) : [];
        for (const name of names) if (SPEC_LOOKUPS.includes(name)) found.push(`${rel} ${name}`);
      }
    }
    assert.deepStrictEqual(found, SPEC_LOOKUPS_KNOWN);
  });
});
