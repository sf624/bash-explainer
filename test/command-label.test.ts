// A command is labelled with its name (`grep`), because its explanation describes the program;
// its range, which highlights it, stays the whole command.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type { BashParser as Parser } from '../src/syntax/tree';
import { Analyzer, Token } from '../src/analyzer';
import { explainHostedLine, extractShell, hostKind } from '../src/hosts';
import { partAt } from '../src/ui/hoverParts';
import { partHover } from '../src/ui/hoverView';
import { toPlainMarkdown } from '../src/ui/render';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { allTokens, explain } from './support/explain';

let parser: Parser;
before(async () => {
  parser = createUnbashParser();
});

const covered = (src: string, t: Token): string => {
  const lines = src.split('\n');
  const { start, end } = t.span;
  return start.line === end.line
    ? lines[start.line].slice(start.character, end.character)
    : [lines[start.line].slice(start.character), ...lines.slice(start.line + 1, end.line), lines[end.line].slice(0, end.character)].join('\n');
};
/** The label and the range text of the first token. */
const first = (src: string) => {
  const t = explain(src).items[0];
  return { label: t.label, range: covered(src, t), kind: t.kind, children: t.children.map((c) => c.label) };
};

describe('the label of a command', () => {
  it('is the name of a plain command, with the whole command as its range', () => {
    assert.deepStrictEqual(first("grep -E '^[A-Z]{3}-[0-9]+$' ids.txt"), {
      label: 'grep', range: "grep -E '^[A-Z]{3}-[0-9]+$' ids.txt", kind: 'command', children: ['-E', "'^[A-Z]{3}-[0-9]+$'", 'ids.txt'],
    });
  });

  it('is the name of a builtin, a function call and a declaration', () => {
    assert.deepStrictEqual(first('read -r a b'), { label: 'read', range: 'read -r a b', kind: 'builtin', children: ['-r', 'a', 'b'] });
    assert.deepStrictEqual(first('echo hi'), { label: 'echo', range: 'echo hi', kind: 'builtin', children: ['hi'] });
    const call = explain('f() { :; }\nf x y', 1).items[0];
    assert.strictEqual(call.kind, 'function');
    assert.strictEqual(call.label, 'f');
    assert.strictEqual(covered('f() { :; }\nf x y', call), 'f x y');
    for (const src of ['declare -i n=1', 'local x=1', 'export A=1 B', 'readonly -a z', 'unset -f f']) {
      const t = explain(src).items[0];
      assert.strictEqual(t.label, src.split(' ')[0], src);
      assert.strictEqual(covered(src, t), src);
    }
  });

  it('is the command word as written: a path, quotes, or an expansion', () => {
    assert.deepStrictEqual([first('/usr/bin/env FOO=1 sh').label, first('/usr/bin/env FOO=1 sh').range], ['/usr/bin/env', '/usr/bin/env FOO=1 sh']);
    assert.strictEqual(first('./build.sh --fast').label, './build.sh');
    assert.strictEqual(first('"$cmd" a b').label, '"$cmd"');
    assert.strictEqual(first('"$cmd" a b').range, '"$cmd" a b');
    assert.strictEqual(first("$(:)e\\c'h'\"o\" hi").label, "$(:)e\\c'h'\"o\"");
    assert.strictEqual(first("$(:)e\\c'h'\"o\" hi").kind, 'builtin');
  });

  it('keeps the subcommand as a child, and only renames the root', () => {
    const src = 'git commit -m x';
    const t = explain(src).items[0];
    assert.strictEqual(t.label, 'git');
    assert.deepStrictEqual(t.children.map((c) => [c.kind, c.label]), [['subcommand', 'commit'], ['option', '-m'], ['argument', 'x']]);
    assert.strictEqual(covered(src, t), src);
    assert.match(t.summary!, /^git commit: /);
  });

  it('keeps the assignments before it as its children', () => {
    const src = 'FOO=1 BAR=2 make -j4';
    const t = explain(src).items[0];
    assert.strictEqual(t.label, 'make');
    assert.strictEqual(covered(src, t), src);
    assert.deepStrictEqual(t.children.map((c) => c.label), ['FOO=1', 'BAR=2', '-j4']);
  });

  it('names the stages of a pipeline and the commands of a list, but not the pipeline', () => {
    const src = 'cat f | sort -u | uniq -c';
    const pipe = explain(src).items[0];
    assert.strictEqual(pipe.label, 'cat | sort | uniq');
    assert.deepStrictEqual(pipe.children.map((c) => c.label), ['cat', '|', 'sort', '|', 'uniq']);
    assert.deepStrictEqual(pipe.children.filter((c) => c.kind === 'command').map((c) => covered(src, c)), ['cat f', 'sort -u', 'uniq -c']);
  });

  it('names the command under a redirect wrapper, which keeps the redirections', () => {
    const src = "tr -d '\\r' < a > b";
    const w = explain(src).items[0];
    assert.strictEqual(w.kind, 'redirect');
    assert.strictEqual(w.label, 'tr < a > b');
    const [cmd] = w.children;
    assert.strictEqual(cmd.label, 'tr');
    assert.strictEqual(covered(src, cmd), "tr -d '\\r'");
    const middle = explain('echo a > f b').items[0];
    assert.deepStrictEqual([middle.label, covered('echo a > f b', middle)], ['echo', 'echo a > f b']);
  });

  it('names the command run by another one', () => {
    const src = 'sudo -u bob rm -rf /tmp/x';
    const wrapped = allTokens(explain(src).items).find((t) => t.label === 'rm')!;
    assert.strictEqual(covered(src, wrapped), 'rm -rf /tmp/x');
  });

  it('leaves the labels of constructs to their skeletons (see skeleton-label.test.ts)', () => {
    for (const [src, label] of [['[ -f x ]', '[ -f x ]'], ['x=1', 'x=1'], ['time ls -a', 'time ls'], ['a && b', 'a && b']]) {
      assert.strictEqual(explain(src).items[0].label, label, src);
    }
  });

  it('is shown by a line of a host file, with the range at the original columns', () => {
    const src = fs.readFileSync(path.join(__dirname, 'fixtures/hosts/Dockerfile'), 'utf8');
    const lines = src.split('\n');
    const n = lines.findIndex((l) => l.startsWith('RUN apk add'));
    const extracted = extractShell(hostKind('', 'Dockerfile')!, src);
    const ex = explainHostedLine(new Analyzer('en'), parser.parse(extracted.text), extracted, lines, n, 'en')!;
    const apk = allTokens(ex.items).find((t) => t.label === 'apk')!;
    assert.strictEqual(apk.label, 'apk');
    assert.ok(covered(src, apk).startsWith('apk add --no-cache curl jq'));
    assert.strictEqual(apk.span.start.character, lines[n].indexOf('apk'));
    // A name that is host syntax is shown as written in the host file.
    const make = 'all:\n\t$(CC) -o $@ $^\n';
    const mk = extractShell('makefile', make);
    const mex = explainHostedLine(new Analyzer('en'), parser.parse(mk.text), mk, make.split('\n'), 1, 'en')!;
    assert.strictEqual(mex.items[0].label, '$(CC)');
  });

  it('is shown by the Markdown of the hover and of "copy as Markdown", over the whole range', () => {
    const src = 'grep -E x f';
    const ex = explain(src);
    const plain = toPlainMarkdown(ex, src, 'a.sh:1');
    assert.match(plain, /\n- `grep` — Print lines/);
    assert.match(plain, /\n {2}- `-E` — /);
    assert.ok(!plain.includes('- `grep -E x f`'));
    // The hover at `x` (an argument of grep) names the command it belongs to by its name.
    const chain = partAt(ex.items, { line: 0, character: 8 });
    const hover = partHover({ ex, lang: 'en', theme: 'dark', lineText: src, placement: 'first', panelLink: 'command:x', lineLink: 'command:l', keys: 'K' }, chain);
    assert.match(hover, /Command: <\/span><span[^>]*>grep<\/span> <span title[^\n]* — Print lines/);
  });
});
