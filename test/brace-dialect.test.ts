// Brace expansion by shell: the word model (src/semantics/words.ts, src/semantics/brace.ts) applies it where the shell has it
// (src/dialect.ts: dash and POSIX sh none, mksh no ranges), and what we say of an argument, a command and an example follows
// the model. Compared with the real dash (and bash), where they are installed.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { Analyzer } from '../src/analyzer';
import { dialectNotes, type Shell } from '../src/dialect';
import { shellState } from '../src/semantics/state';
import { wordFields, wordMeaning } from '../src/semantics/words';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, type SyntaxNode } from '../src/syntax/tree';
import { allTokens } from './support/explain';

const parser = createUnbashParser();
const have = (sh: string): boolean => spawnSync(sh, ['-c', 'exit 0']).status === 0;
/** What `sh` prints for the unquoted words `words`, one per line. */
const printed = (sh: string, words: string): string[] =>
  spawnSync(sh, ['-c', `printf '%s\\n' ${words}`], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } }).stdout.split('\n').slice(0, -1);

/** The word `text` of `src`, read as a script for `shell`: its brace step, and the fields the model gives. */
function modelOf(src: string, text: string, shell: Shell | undefined): { applies: boolean | 'unknown'; why?: string; fields?: string[] } {
  const tree = parser.parse(src);
  const model = shellState(tree, shell);
  const found: SyntaxNode[] = [];
  const visit = (n: SyntaxNode): void => {
    if (n.named && n.text === text) found.push(n);
    n.children.forEach(visit);
  };
  visit(tree.root);
  const step = wordMeaning(found[0], model)!.steps.find((s) => s.kind === 'brace')!;
  return { applies: step.applies, ...(step.why ? { why: step.why } : {}), fields: wordFields(found[0], model).fields };
}

describe('the word model: brace expansion in the shell the script is for', () => {
  // [shell, text, the brace step]: dialect.ts says which shells have `{a,b}` (braceList) and `{1..3}` (braceRange).
  const ROWS: [Shell | undefined, string, boolean | 'unknown', string | undefined][] = [
    [undefined, '{a,b}', true, undefined], ['bash', '{1..3}', true, undefined],
    ['zsh', '{a,b}', true, undefined], ['zsh', '{1..3}', true, undefined], ['ksh', '{a,b}', true, undefined], ['ksh', '{1..3}', true, undefined],
    ['mksh', '{a,b}', true, undefined], ['mksh', '{1..3}', false, 'dialect'], ['mksh', 'x{a,b}{1..3}', 'unknown', undefined],
    ['dash', '{a,b}', false, 'dialect'], ['dash', '{1..3}', false, 'dialect'], ['dash', 'a{,.bak}', false, 'dialect'],
    ['sh', '{a,b}', false, 'dialect'], ['sh', '{1..3}', false, 'dialect'], ['ash', '{a,b}', false, 'dialect'], ['yash', '{a,b}', false, 'dialect'],
  ];
  it('applies the step where the shell has that kind of brace expansion', () => {
    for (const [shell, text, applies, why] of ROWS) {
      const m = modelOf(`echo ${text}`, text, shell);
      assert.deepStrictEqual([m.applies, m.why], [applies, why], `${shell} ${text}`);
    }
  });

  it('keeps a word as written where the shell has no brace expansion, as dash prints it', () => {
    const words = '{a,b} {1..3} a{,.bak} x{y,z}1 {a,b}{1,2}';
    for (const w of words.split(' ')) {
      assert.deepStrictEqual(modelOf(`echo ${w}`, w, 'dash').fields, [w], w);
      assert.deepStrictEqual(modelOf(`echo ${w}`, w, 'sh').fields, [w], w);
    }
    if (have('dash')) assert.deepStrictEqual(printed('dash', words), words.split(' '));
    if (have('bash')) {
      for (const w of words.split(' ')) assert.deepStrictEqual(modelOf(`echo ${w}`, w, 'bash').fields, printed('bash', w), w);
    }
  });

  it('is still bash\'s in bash --posix, which expands braces', () => {
    const m = modelOf('#!/bin/bash --posix\necho {a,b}', '{a,b}', 'bash');
    assert.deepStrictEqual([m.applies, m.fields], [true, ['a', 'b']]);
    if (have('bash')) assert.deepStrictEqual(spawnSync('bash', ['--posix', '-c', 'printf "%s\\n" {a,b}'], { encoding: 'utf8' }).stdout.split('\n').slice(0, -1), ['a', 'b']);
  });

  it('is left to the word\'s other states: set +B still turns it off in bash', () => {
    assert.deepStrictEqual([modelOf('set +B; echo {a,b}', '{a,b}', 'bash').applies, modelOf('set +B; echo {a,b}', '{a,b}', 'bash').why], [false, 'braceexpand-off']);
  });
});

describe('what we say of a word with braces in a shell without them', () => {
  const tokens = (src: string, shell: Shell | undefined, lang: 'en' | 'ja' = 'en') => allTokens(new Analyzer(lang).explainLine(parser.parse(src), 0, shell).items);
  const examples = (src: string, shell: Shell | undefined) => new Analyzer('en').explainLine(parser.parse(src), 0, shell).examples;

  it('says it stays as it is: a plain word, with no expansion and no example', () => {
    for (const shell of ['dash', 'sh'] as const) {
      for (const src of ['echo {a,b}', 'echo {1..3}', 'mkdir -p d/{x,y}']) {
        const t = tokens(src, shell);
        assert.ok(!t.some((x) => x.kind === 'expansion'), `${shell} ${src}`);
        assert.deepStrictEqual(examples(src, shell), [], `${shell} ${src}`);
      }
    }
    const t = tokens('echo {a,b}', 'dash').find((x) => x.label === '{a,b}')!;
    assert.deepStrictEqual([t.kind, t.explanation], ['argument', 'text to print']);
    // (bash and zsh: the expansion is there.)
    for (const shell of ['bash', 'zsh', 'ksh'] as const) {
      assert.match(tokens('echo {a,b}', shell).find((x) => x.kind === 'expansion')!.explanation, /^Brace expansion: `\{a,b\}` expands to 2 words/, shell);
      assert.strictEqual(examples('echo {a,b}', shell).length, 1, shell);
    }
  });

  it('reads the words of a command as one word, not several (`cp a{,.bak}` has a source only)', () => {
    assert.match(tokens('cp a{,.bak}', 'dash').find((x) => x.label === 'a{,.bak}')!.explanation, /^source$/);
    assert.match(tokens('cp a{,.bak}', 'bash').find((x) => x.label === 'a{,.bak}')!.explanation, /^expands to `a` \(source\) and `a\.bak` \(destination/);
    // A command name is not the first word of the expansion either: `{echo,hi}` is a word, so a file name.
    assert.ok(!/Brace expansion/.test(tokens('{echo,hi}', 'dash').map((x) => x.explanation).join('\n')));
    assert.match(tokens('{echo,hi}', 'bash').map((x) => x.explanation).join('\n'), /Brace expansion turns `\{echo,hi\}` into `echo hi`/);
  });

  it('reads braces that stay as text, with the quotes in them, and cites no brace expansion there', () => {
    // (The word model: dash prints `{a,b}` for `{a,"b"}`; with a substitution in it, the value is not known.)
    assert.deepStrictEqual(modelOf('echo {a,"b"}', '{a,"b"}', 'dash').fields, ['{a,b}']);
    assert.strictEqual(modelOf('echo {a,$(x)}', '{a,$(x)}', 'dash').fields, undefined);
    if (have('dash')) assert.deepStrictEqual(printed('dash', '{a,"b"}'), ['{a,b}']);
    // (A command named `{echo,hi}` is a file of that name; the words of a `for` are words, a glob a glob.)
    assert.match(tokens('{echo,hi}', 'dash')[0].explanation, /^Run the external command `\{echo,hi\}`/);
    const words = tokens('for i in {a,b} x{c,d} {*.c,*.h}; do :; done', 'dash');
    assert.deepStrictEqual(['{a,b}', 'x{c,d}'].map((w) => words.find((t) => t.label === w)!.refs), [undefined, undefined]);
    assert.deepStrictEqual(words.find((t) => t.label === '{*.c,*.h}')!.refs, ['3.5.8']);
  });

  it('says brace expansion is not POSIX only where bash would expand the braces', () => {
    const braceNote = (src: string) => dialectNotes(parser.parse(src), 0, 'sh', 'en').some((t) => /brace/.test(t));
    // (Not in an assignment's value, a here-string or the word of `case`: bash keeps those braces as they are too.)
    for (const src of ['x={1..3} y={a,b}', 'cat <<< {a,b}', 'case {a,b} in x) ;; esac']) assert.ok(!braceNote(src), src);
    for (const src of ['echo {a,b}', 'echo x{1..3}', 'declare x={a,b}', 'for i in {a,b}; do :; done']) assert.ok(braceNote(src), src);
    assert.deepStrictEqual(spawnSync('bash', ['-c', 'x={1..3}; cat <<< {a,b}; case {a,b} in "{a,b}") echo same;; esac; echo "$x"'], { encoding: 'utf8' }).stdout, '{a,b}\nsame\n{1..3}\n');
  });

  it('keeps the expansion of a range in mksh only for lists', () => {
    assert.ok(tokens('echo {a,b}', 'mksh').some((x) => x.kind === 'expansion'));
    assert.ok(!tokens('echo {1..3}', 'mksh').some((x) => x.kind === 'expansion'));
  });

  it('says so in the language of the page', () => {
    assert.ok(!tokens('echo {a,b}', 'dash', 'ja').some((x) => x.kind === 'expansion'));
  });
});
