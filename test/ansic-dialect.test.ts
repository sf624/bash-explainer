// `$'…'` by shell: bash, ksh, zsh and busybox ash decode its escapes; dash (0.5.12) has no such string, and reads a `$`
// that is text followed by a single-quoted string (`$'a\tb'` is `$a\tb`). POSIX sh may be either, so the value is not
// known there. The static value (src/staticword.ts), the word model (src/semantics/words.ts) and what we say of the
// word follow the shell (src/shellfeatures.ts: `ansiC`). Compared with the real dash and bash, where they are installed.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { Analyzer } from '../src/analyzer';
import type { Shell } from '../src/dialect';
import { shellState } from '../src/semantics/state';
import { wordFields } from '../src/semantics/words';
import { staticWordText, staticWordValue } from '../src/staticword';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { field, fields, type SyntaxNode } from '../src/syntax/tree';
import { allTokens } from './support/explain';

const parser = createUnbashParser();
const have = (sh: string): boolean => spawnSync(sh, ['-c', 'exit 0']).status === 0;
/** What `argv` (a shell and its options) prints for the words `words`, each ended by a NUL. */
const printed = (argv: string[], words: string): string[] =>
  spawnSync(argv[0], [...argv.slice(1), '-c', `x=; printf '%s\\0' ${words}`], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } })
    .stdout.split('\0').slice(0, -1);

/** The arguments of the last command of `src`. */
function argsOf(src: string): SyntaxNode[] {
  const tree = parser.parse(src);
  const cmds: SyntaxNode[] = [];
  const visit = (n: SyntaxNode): void => {
    if (n.type === 'command') cmds.push(n);
    n.namedChildren.forEach(visit);
  };
  visit(tree.root);
  return fields(cmds[cmds.length - 1], 'argument');
}

// (`a$'\n'c` is three parts; `$'a b'` is one word with a space.)
const WORDS = ["$'a\\tb'", "a$'\\n'c", "$'--'", "$'a b'", "$'q'"];
const DECODED = ['a\tb', 'a\nc', '--', 'a b', 'q'];
const DASH = ['$a\\tb', 'a$\\nc', '$--', '$a b', '$q'];

describe('`$\'…\'` in the shell the script is for', () => {
  it('has the decoded value where the shell decodes it, dash\'s where it does not, and none in POSIX sh', () => {
    const values = (shell: Shell | undefined) => argsOf(`printf x ${WORDS.join(' ')}`).slice(1).map((w) => staticWordValue(w, false, shell));
    for (const shell of [undefined, 'bash', 'ash', 'ksh', 'mksh', 'zsh'] as const) assert.deepStrictEqual(values(shell), DECODED, shell);
    assert.deepStrictEqual(values('dash'), DASH);
    assert.deepStrictEqual(values('sh'), WORDS.map(() => undefined));
    assert.deepStrictEqual(values('yash'), WORDS.map(() => undefined));
    // (`$'it\'s'` is one string to bash; dash's quote ends at the `\'`, which the tree does not show.)
    assert.strictEqual(staticWordValue(argsOf("echo $'it\\'s'")[0], false, 'dash'), undefined);
    assert.strictEqual(staticWordValue(argsOf("echo $'it\\'s'")[0], false, 'bash'), "it's");
    if (have('dash')) assert.deepStrictEqual(printed(['dash'], WORDS.join(' ')), DASH);
    if (have('bash')) {
      assert.deepStrictEqual(printed(['bash'], WORDS.join(' ')), DECODED);
      // (bash in POSIX mode decodes it too: `#!/bin/bash --posix` is read as bash.)
      assert.deepStrictEqual(printed(['bash', '--posix'], WORDS.join(' ')), DECODED);
    }
  });

  it('maps each character of dash\'s value to its source: the `$`, then the quoted text', () => {
    const w = argsOf("echo a$'\\t'")[0];
    assert.deepStrictEqual(staticWordText(w, 'dash'), { text: 'a$\\t', starts: [5, 6, 8, 9], ends: [6, 7, 9, 10] });
    assert.strictEqual(staticWordText(w, 'sh'), undefined);
    assert.strictEqual(staticWordText(w, 'bash')!.text, 'a\t');
  });

  it('gives the fields dash gives, also in a default value of `${…}`', () => {
    const words = [...WORDS, "${x:-$'a\\tb'}"];
    const fieldsIn = (shell: Shell) => {
      const tree = parser.parse(`x=; printf x ${words.join(' ')}`);
      const model = shellState(tree, shell);
      const cmd = tree.root.namedChildren.find((c) => c.type === 'command' && field(c, 'name')?.text === 'printf')!;
      return fields(cmd, 'argument').slice(1).map((w) => wordFields(w, model).fields);
    };
    const dash = [...DASH, '$a\\tb'].map((v) => [v]);
    assert.deepStrictEqual(fieldsIn('dash'), dash);
    assert.deepStrictEqual(fieldsIn('bash'), [...DECODED, 'a\tb'].map((v) => [v]));
    assert.deepStrictEqual(fieldsIn('sh'), words.map(() => undefined));
    if (have('dash')) assert.deepStrictEqual(printed(['dash'], words.join(' ')).map((v) => [v]), dash);
    // (A variable set from it holds dash's text.)
    const tree = parser.parse("x=$'q'\necho \"$x\"");
    const echo = tree.root.namedChildren[1];
    assert.deepStrictEqual(wordFields(fields(echo, 'argument')[0], shellState(tree, 'dash')).fields, ['$q']);
    if (have('dash')) assert.strictEqual(spawnSync('dash', ['-c', "x=$'q'; echo \"$x\""], { encoding: 'utf8' }).stdout, '$q\n');
  });

  describe('what we say of it', () => {
    const tokens = (src: string, shell: Shell | undefined, lang: 'en' | 'ja' = 'en') => allTokens(new Analyzer(lang).explainLine(parser.parse(src), 0, shell).items);
    const token = (src: string, shell: Shell | undefined, label: string, lang: 'en' | 'ja' = 'en') => tokens(src, shell, lang).find((t) => t.label === label && t.kind === 'string')!;

    it('reads `env $\'--\'` as the end of options only where the shell decodes it', () => {
      const role = (shell: Shell | undefined) => tokens("env $'--' | cat", shell).find((t) => t.label === "$'--'")!;
      assert.match(role('bash').explanation, /^End of options/);
      // (dash runs a command named `$--`; POSIX sh may do either.)
      for (const shell of ['dash', 'sh'] as const) assert.doesNotMatch(role(shell).explanation, /End of options/, shell);
      if (have('dash')) assert.match(spawnSync('dash', ['-c', "env $'--'"], { encoding: 'utf8' }).stderr, /\$--/);
    });

    it('says the escapes are decoded where the shell does it, and dash\'s text in dash', () => {
      const bash = token("printf %s $'a\\tb'", 'bash', "$'a\\tb'");
      assert.match(bash.explanation, /^`\$'…'` string: backslash escapes such as `\\n` are interpreted\. After quote removal it is the string `a⇥b`/);
      assert.strictEqual(bash.children.length, 3);
      const dash = token("printf %s $'a\\tb'", 'dash', "$'a\\tb'");
      assert.match(dash.explanation, /which dash does not have: in dash, `\$` is plain text and `'…'` a single-quoted string, so the escapes stay as written\. After quote removal it is the string `\$a\\tb` \(this `\$` is plain text/);
      assert.deepStrictEqual(dash.children, []);
      assert.doesNotMatch(token("echo $'q'", 'dash', "$'q'").explanation, /escapes stay/);
      const sh = token("printf %s $'a\\tb'", 'sh', "$'a\\tb'");
      assert.match(sh.explanation, /which not every POSIX sh has: in dash, `\$` is plain text and `'…'` a single-quoted string$/);
      assert.deepStrictEqual(sh.children, []);
      // (A word of several parts: its value as the shell reads it.)
      assert.match(tokens("echo a$'\\n'c", 'dash').find((t) => t.label === "a$'\\n'c" && /Concatenation/.test(t.explanation))!.explanation, /it is the string `a\$\\nc`/);
      assert.match(token("printf %s $'a\\tb'", 'dash', "$'a\\tb'", 'ja').explanation, /^bash・ksh・zsh の `\$'…'` 文字列だが、dash にはこの書き方がない。.*`\$a\\tb` という文字列になる/);
    });
  });
});
