import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import type { CommandExampleKind } from '../src/argv/spec';
import { lookupCommand } from '../src/dict/aliases';
import { GetoptUnsupported } from '../src/examples/getopt';
import { GitFormatUnsupported } from '../src/examples/gitlog';
import { Unsupported as FilterUnsupported } from '../src/examples/textfilters';
import { Unsupported } from '../src/examples/unsupported';
import { YamlUnsupported } from '../src/examples/yaml';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

// The example of a command's run (src/examples/commands.ts) is chosen by its spec (`CommandSpec.example`), not by
// the text of its name.

const kinds = (src: string, line = 0): (string | undefined)[] =>
  new Analyzer('en').explainLine(createUnbashParser().parse(src), line).examples.map((e) => e.kind);

describe('command examples are chosen by the spec', () => {
  it('names the runner of each command that has one', () => {
    const expected: Record<string, CommandExampleKind> = {
      printf: 'printf', read: 'read', xargs: 'xargs', getopt: 'getopt', perl: 'perl', sort: 'sort', uniq: 'uniq', cut: 'cut',
      tr: 'tr', head: 'head', tail: 'tail', seq: 'seq', basename: 'basename', dirname: 'dirname',
    };
    for (const [name, kind] of Object.entries(expected)) assert.strictEqual(lookupCommand(name)?.example, kind, name);
    // The program of a builtin's name has it too (`/usr/bin/printf`).
    assert.strictEqual(lookupCommand('printf')?.program?.example, 'printf');
    assert.strictEqual(lookupCommand('echo')?.example, undefined);
  });

  it('gives the example for the command, however its name is written, and not for a function of that name', () => {
    assert.deepStrictEqual(kinds('/usr/bin/sort -r f'), ['textFilters']);
    assert.deepStrictEqual(kinds('"seq" 3'), ['textFilters']);
    assert.deepStrictEqual(kinds('/usr/bin/printf a'), ['printf']);
    assert.deepStrictEqual(kinds('sort() { tac; }\nsort -r f', 1), []);
    // A command a wrapper runs gets none.
    assert.deepStrictEqual(kinds('sudo sort -r f'), []);
    assert.deepStrictEqual(kinds('env seq 3'), []);
    assert.deepStrictEqual(kinds('IFS=, read -r a b <<< "x,,y"'), ['read']);
    // In backquotes bash removes the backslash of `\$` first (`'a\$b'` prints `a$b`): no example prints the text as written.
    assert.deepStrictEqual(kinds('x=`printf a \'b\\$c\'`'), []);
    assert.deepStrictEqual(kinds('x=`printf a \'b$c\'`'), ['printf']);
  });
});

describe('the runners share one Unsupported', () => {
  it('is the base of what each runner throws for an input it does not model', () => {
    assert.ok(new GetoptUnsupported() instanceof Unsupported);
    assert.ok(new GitFormatUnsupported() instanceof Unsupported);
    assert.ok(new YamlUnsupported() instanceof Unsupported);
    assert.ok(new FilterUnsupported() instanceof Unsupported);
    // (Each runner catches only its own.)
    assert.ok(!(new GetoptUnsupported() instanceof FilterUnsupported));
  });
});
