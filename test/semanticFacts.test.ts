// The colours the models decide (src/semanticFacts.ts, painted by src/highlight.ts), against bash and the tools:
// what a command name runs (`type -t` at that place), which words a command reads as options (what the tool does with
// them), and which variables are readonly or exported where they are used (`declare -p`).
import * as assert from 'assert';
import { execFileSync } from 'child_process';
import { documentHighlight, highlight, HighlightKind } from '../src/highlight';
import { extractShell } from '../src/hosts';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

const parser = createUnbashParser();

const bash = (script: string): string | undefined => {
  try {
    return execFileSync('bash', ['--norc', '--noprofile', '-c', script], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
  } catch {
    return undefined;
  }
};

/** The kind and modifiers of the span whose text is `part`, the `nth` one (from 0). */
function spanOf(text: string, part: string, nth = 0, shell?: 'sh'): string | undefined {
  const s = highlight(parser.parse(text), { shell }).filter((x) => text.slice(x.from, x.to) === part)[nth];
  return s && [s.kind, ...(s.modifiers ?? [])].join('.');
}

describe('the colours of command names (the names model)', () => {
  // [script, the line of the command, its name, which span of that text it is, the colour]: bash runs the lines before
  // that one, then `type -t NAME`.
  const cases: [string, number, string, number, HighlightKind][] = [
    ['shopt -s expand_aliases\nalias ll="ls -l"\nll /tmp', 2, 'll', 0, 'alias'],
    ['f() { :; }\nf a', 1, 'f', 1, 'function'],
    ['cd /', 0, 'cd', 0, 'builtin'],
    ['ls /', 0, 'ls', 0, 'command'],
    ['cd() { :; }\ncd /', 1, 'cd', 1, 'function'],
    ['enable -n echo\necho a', 1, 'echo', 0, 'command'],
    ['g\ng() { :; }', 0, 'g', 0, 'command'],
    ['f() { :; }\nunset -f f\nf', 2, 'f', 2, 'command'],
  ];
  for (const [script, line, name, nth, kind] of cases) {
    it(`colours \`${name}\` as ${kind} in ${JSON.stringify(script)} (checked with bash)`, function () {
      const said = bash([...script.split('\n').slice(0, line), `type -t ${name} || echo none`].join('\n'));
      if (said === undefined) return this.skip();
      const expected = { alias: 'alias', function: 'function', builtin: 'builtin', file: 'command', none: 'command' }[said.trim()];
      assert.strictEqual(kind, expected, `bash: ${said}`);
      assert.strictEqual(spanOf(script, name, nth), kind);
    });
  }

  it('reads a quoted name with no alias, and a name in sh with no bash-only builtin', () => {
    assert.strictEqual(spanOf('shopt -s expand_aliases\nalias ls="ls -F"\n\\ls; ls', '\\ls'), 'command');
    assert.strictEqual(spanOf('shopt -s expand_aliases\nalias ls="ls -F"\n\\ls; ls', 'ls'), 'alias');
    assert.strictEqual(spanOf('mapfile a', 'mapfile'), 'builtin');
    assert.strictEqual(spanOf('mapfile a', 'mapfile', 0, 'sh'), 'command');
  });

  it('colours the command another one runs as what runs there (checked with bash)', function () {
    // `sudo echo` runs the program, `command echo` and `builtin cd` the builtins.
    assert.strictEqual(spanOf('sudo echo a', 'echo'), 'command');
    assert.strictEqual(spanOf('xargs -0 rm -f', 'rm'), 'command');
    assert.strictEqual(spanOf('f() { :; }; command f', 'f', 1), 'command');
    assert.strictEqual(spanOf('builtin cd /', 'cd'), 'builtin');
    const said = bash('f() { echo function; }; command f 2>/dev/null || echo none');
    if (said === undefined) return this.skip();
    assert.strictEqual(said, 'none\n');
  });
});

describe('the colours of options (the specs)', () => {
  it('colours a word a command reads as data as a plain argument (checked with grep and sort)', function () {
    // grep -e -v searches for `-v`; after `--`, `-x` is a file name.
    assert.strictEqual(spanOf('grep -e -v file', '-e'), 'option');
    assert.strictEqual(spanOf('grep -e -v file', '-v'), 'argument');
    assert.strictEqual(spanOf('ls -- -x', '-x'), 'argument');
    assert.strictEqual(spanOf('sort -k2 -t, f', '-k2'), 'option');
    assert.strictEqual(spanOf('git log --date=short', '--date'), 'option');
    assert.strictEqual(spanOf('grep --nosuch=1 x', '--nosuch'), 'option');
    const said = bash("printf 'a\\n-v\\n' | grep -e -v");
    if (said === undefined) return this.skip();
    assert.strictEqual(said, '-v\n');
  });

  it("keeps test's operators, and a function's words, as the tree reads them", () => {
    assert.strictEqual(spanOf('[ "$a" -eq 1 ]', '-eq'), 'option');
    assert.strictEqual(spanOf('test -f x', '-f'), 'option');
    assert.strictEqual(spanOf('grep() { :; }; grep -e -v', '-v'), 'option');
  });
});

describe('the colours of variables (the state)', () => {
  it('marks a variable readonly or exported where the state says so (checked with declare -p)', function () {
    const script = 'readonly R=1\nexport E=2\nP=3\necho "$R" ${E} $P';
    assert.strictEqual(spanOf(script, '$R'), 'variable.readonly');
    assert.strictEqual(spanOf(script, 'E', 1), 'variable.exported');
    assert.strictEqual(spanOf(script, '$P'), 'variable');
    assert.strictEqual(spanOf(script, 'R'), 'assignment.readonly');
    // (The name of an element is the array's; the model's trust does not cover arrays, so nothing is said of it.)
    assert.strictEqual(spanOf('readonly -a A=(1)\necho "${A[0]}"', '${A['), 'variable');
    const said = bash(`${script.split('\n').slice(0, 3).join('\n')}\ndeclare -p R E P`);
    if (said === undefined) return this.skip();
    assert.deepStrictEqual(said.split('\n').filter(Boolean).map((l) => l.split(' ')[1]), ['-r', '-x', '--']);
  });

  it('says nothing of a variable where the model trusts nothing', () => {
    // (`eval` can set anything.)
    assert.strictEqual(spanOf('readonly R=1\neval "$x"\necho $R', '$R'), 'variable');
  });
});

describe('the colours of host files, one shell per step', () => {
  const kinds = (kind: Parameters<typeof extractShell>[0], text: string) => {
    const extracted = extractShell(kind, text);
    const lines = text.split('\n');
    return documentHighlight({ lines, extracted, tree: parser.parse(extracted.text) }).map((s) => `${s.line}:${s.kind}:${lines[s.line].slice(s.from, s.to)}`);
  };

  it('reads a function of one workflow step as nothing in the next', () => {
    const workflow = 'jobs:\n  a:\n    runs-on: x\n    steps:\n      - run: |\n          f() { :; }\n          f\n      - run: f\n';
    const got = kinds('yaml', workflow);
    assert.ok(got.includes('6:function:f'), got.join(' '));
    assert.ok(got.includes('7:command:f'), got.join(' '));
  });

  it('reads the lines of a Makefile recipe in shells of their own, and a recipe with .ONESHELL in one', () => {
    assert.ok(kinds('makefile', 'all:\n\tf() { :; }\n\tf\n').includes('2:command:f'));
    assert.ok(kinds('makefile', '.ONESHELL:\nall:\n\tf() { :; }\n\tf\n').includes('3:function:f'));
  });

  it("reads names with the shell the explanations use: the one forced, else the file's, or the step's", () => {
    const kindOf = (text: string, shells: { forced?: 'sh'; detected?: 'sh' | 'bash' }, kind?: Parameters<typeof extractShell>[0]) => {
      const lines = text.split('\n');
      const extracted = kind && extractShell(kind, text);
      const doc = { lines, ...(extracted ? { extracted } : {}), tree: parser.parse(extracted ? extracted.text : text) };
      return documentHighlight(doc, { shells }).filter((s) => lines[s.line].slice(s.from, s.to) === 'mapfile').map((s) => s.kind);
    };
    assert.deepStrictEqual(kindOf('mapfile a', {}), ['builtin']);
    assert.deepStrictEqual(kindOf('mapfile a', { detected: 'sh' }), ['command']);
    assert.deepStrictEqual(kindOf('mapfile a', { forced: 'sh', detected: 'bash' }), ['command']);
    const workflow = 'jobs:\n  a:\n    runs-on: x\n    steps:\n      - run: mapfile a\n';
    assert.deepStrictEqual(kindOf(workflow, {}, 'yaml'), ['builtin']);
    assert.deepStrictEqual(kindOf(workflow, { forced: 'sh' }, 'yaml'), ['command']);
  });

  it('reads a bats file with the commands bats defines', () => {
    const text = '#!/usr/bin/env bats\n@test "a" {\n  run echo hi\n}\n';
    const extracted = extractShell('bats', text);
    const lines = text.split('\n');
    const got = documentHighlight({ lines, extracted, tree: parser.parse(extracted.text) }).map((s) => `${s.line}:${s.kind}:${lines[s.line].slice(s.from, s.to)}`);
    assert.ok(got.includes('2:command:run'), got.join(' '));
  });

  it('gives only the lines asked for, read by the shell of each step', () => {
    const text = 'FROM x\nRUN f() { :; }; f\nRUN ls -l\n';
    const extracted = extractShell('dockerfile', text);
    const doc = { lines: text.split('\n'), extracted, tree: parser.parse(extracted.text) };
    const all = documentHighlight(doc);
    assert.deepStrictEqual(documentHighlight(doc, { lines: { from: 2, to: 2 } }), all.filter((s) => s.line === 2));
    assert.deepStrictEqual(documentHighlight(doc, { lines: { from: 5, to: 9 } }), []);
  });
});
