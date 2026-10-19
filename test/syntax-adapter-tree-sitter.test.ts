import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { extractShell, hostKind } from '../src/hosts';
import { descendants, field, fields, hasError, token } from '../src/syntax/tree';
import type { BashParser, SyntaxNode } from '../src/syntax/tree';
import { createRawParser, createTreeSitterParser, FIELD_NAMES, NODE_TYPES } from '../src/syntax/adapters/tree-sitter';
import type { Node } from 'web-tree-sitter';

const root = path.join(__dirname, '..');
const wasm = { runtimeDir: path.join(root, 'node_modules/web-tree-sitter'), bashWasm: path.join(root, 'grammar/tree-sitter-bash.wasm') };
let parser: BashParser;
/** The conversion without the rebuilding of shapes, to compare with tree-sitter's tree. */
let plain: BashParser;
let legacy: Awaited<ReturnType<typeof createRawParser>>;
before(async () => {
  parser = await createTreeSitterParser(wasm);
  plain = await createTreeSitterParser(wasm, { reshape: false });
  legacy = await createRawParser(wasm);
});

const types = (n: SyntaxNode, t: string): SyntaxNode[] => descendants(n, [t]);
const dump = (n: SyntaxNode): string => (n.named ? `(${n.type}${n.field ? ' ' + n.field : ''}${n.incomplete ? ' incomplete' : ''} ${n.children.map(dump).join(' ')})` : n.type);

/** The type the model gives a tree-sitter node, worked out apart from the adapter. */
function expectedType(n: Node): string {
  if (n.type === 'ERROR') return 'error';
  if (n.type === 'compound_statement' && n.text.startsWith('((')) return 'arithmetic_command';
  if (n.type === 'test_command' && n.text.startsWith('[[')) return 'extended_test';
  if (n.type === 'for_statement' && n.text.startsWith('select')) return 'select_statement';
  return n.type;
}

const sameSpan = (a: SyntaxNode, b: Node, where: string): void => {
  assert.equal(a.startIndex, b.startIndex, `${where} startIndex`);
  assert.equal(a.endIndex, b.endIndex, `${where} endIndex`);
  assert.deepEqual(a.startPosition, { row: b.startPosition.row, column: b.startPosition.column }, `${where} startPosition`);
  assert.deepEqual(a.endPosition, { row: b.endPosition.row, column: b.endPosition.column }, `${where} endPosition`);
};

/** Checks every converted node against the tree-sitter node it came from; returns how many it checked. */
function compare(a: SyntaxNode, b: Node, text: string, where: string): number {
  const here = `${where}/${a.type}@${a.startIndex}`;
  // A `time` command (or a pipeline led by one) is rebuilt: the timed command becomes its body.
  if (a.type === 'time_statement') {
    assert.ok(b.type === 'command' || b.type === 'pipeline', `${here} came from a command or a pipeline`);
    assert.equal(b.type === 'command' ? b.child(0)!.text : b.child(0)!.child(0)!.text, 'time');
  } else {
    assert.equal(a.type, expectedType(b), `${here} type`);
  }
  assert.equal(a.named, b.isNamed, `${here} named`);
  assert.equal(a.text, text.slice(b.startIndex, b.endIndex), `${here} text`);
  sameSpan(a, b, here);
  if (a.type === 'time_statement') return 1;
  const kids: { n: Node; field: string | null }[] = [];
  let missing = 0;
  // `[ ]` is a flat list of words: tree-sitter's groups are opened, and its operators are words.
  const gather = (x: Node, flat: boolean): void => {
    for (let i = 0; i < x.childCount; i++) {
      const c = x.child(i)!;
      if (c.isMissing) missing++;
      else if (flat && ['binary_expression', 'unary_expression', 'parenthesized_expression'].includes(c.type)) gather(c, flat);
      else kids.push({ n: c, field: flat ? null : x.fieldNameForChild(i) });
    }
  };
  const flat = a.type === 'test_command';
  gather(b, flat);
  assert.equal(a.children.length, kids.length, `${here} child count`);
  assert.equal(a.incomplete, missing > 0, `${here} incomplete`);
  let count = 1;
  a.children.forEach((c, i) => {
    assert.equal(c.parent, a, `${here} parent`);
    assert.equal(c.field, kids[i].field, `${here} field of child ${i}`);
    const k = kids[i].n;
    if (flat && (!k.isNamed || k.type === 'test_operator') && i > 0 && i < kids.length - 1) {
      assert.equal(c.type, 'word', `${here} operator word`);
      assert.equal(c.text, k.text);
    } else count += compare(c, k, text, here);
  });
  assert.deepEqual(a.namedChildren, a.children.filter((c) => c.named));
  return count;
}

describe('tree-sitter adapter: parity with web-tree-sitter', () => {
  const hosts = fs.readdirSync(path.join(root, 'test/fixtures/hosts')).flatMap((file) => {
    const kind = hostKind('', file);
    return kind ? [{ name: `hosts/${file}`, text: extractShell(kind, fs.readFileSync(path.join(root, 'test/fixtures/hosts', file), 'utf8')).text }] : [];
  });
  const scripts = ['sample.sh', 'coverage.sh', 'posix.sh', 'ksh.ksh'].map((f) => ({ name: f, text: fs.readFileSync(path.join(root, 'test/fixtures', f), 'utf8') }));
  for (const { name, text } of [...scripts, ...hosts]) {
    it(`converts ${name} node for node`, () => {
      const tree = plain.parse(text);
      const ts = legacy.parse(text);
      try {
        assert.equal(tree.text, text);
        assert.ok(compare(tree.root, ts.rootNode, text, '') > 10);
      } finally {
        ts.delete();
      }
    });
  }
  it('has hosts fixtures with shell in them', () => assert.ok(hosts.length >= 5));

  it('keeps the original text under masked extended globs', () => {
    const text = 'shopt -s extglob\nrm !(*.txt|a b) x\n';
    const ts = legacy.parse(text);
    try {
      assert.ok(compare(plain.parse(text).root, ts.rootNode, text, '') > 5);
    } finally {
      ts.delete();
    }
  });
});

describe('tree-sitter adapter: the vocabulary', () => {
  const nodeTypes = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/tree-sitter-bash/src/node-types.json'), 'utf8')) as {
    type: string; named: boolean; fields?: Record<string, unknown>;
  }[];
  it('maps every named tree-sitter type to a model type', () => {
    const named = nodeTypes.filter((t) => t.named && !t.type.startsWith('_') && t.type !== 'ERROR').map((t) => t.type);
    assert.ok(named.length > 50);
    assert.deepEqual(named.filter((t) => !(t in NODE_TYPES)), []);
  });
  it('maps every field name to a model field name', () => {
    const names = new Set(nodeTypes.flatMap((t) => Object.keys(t.fields ?? {})));
    assert.ok(names.size > 15);
    assert.deepEqual([...names].filter((f) => !(f in FIELD_NAMES)), []);
  });
});

describe('tree-sitter adapter: normalizations', () => {
  it('[ ] holds a flat list of words, between its brackets', () => {
    const t = parser.parse('[ ! -f "$a" -a x = y* ]');
    const test = t.root.namedChildren[0];
    assert.equal(test.type, 'test_command');
    assert.deepEqual(test.children.map((c) => `${c.type}:${c.text}`), ['[:[', 'word:!', 'word:-f', 'string:"$a"', 'word:-a', 'word:x', 'word:=', 'extglob_pattern:y*', ']:]']);
    assert.deepEqual(test.namedChildren, test.children.filter((c) => c.named));
    assert.deepEqual(types(test, 'binary_expression').concat(types(test, 'unary_expression')), []);
    const group = parser.parse('[ ( a ) ]').root.namedChildren[0];
    assert.deepEqual(group.namedChildren.map((c) => c.text), ['(', 'a', ')']);
    // [[ ]] keeps its expressions.
    assert.equal(types(parser.parse('[[ -f a && b = c ]]').root, 'binary_expression').length, 2);
  });
  it('tells missing tokens from text it could not read, and leaves out the empty error after a trailing backslash', () => {
    assert.deepEqual(parser.parse('if x; then').errors.map((e) => e.kind), ['missing']);
    assert.ok(parser.parse("ls @(a'b").errors.some((e) => e.kind === 'unreadable'));
    const trailing = parser.parse('%*d|\\\n');
    assert.deepEqual(trailing.errors.map((e) => [e.kind, e.startIndex, e.endIndex]), [['unreadable', 0, 6]]);
  });
  it('(( x++ )) is an arithmetic_command', () => {
    const t = parser.parse('(( x++ ))');
    const n = t.root.namedChildren[0];
    assert.equal(n.type, 'arithmetic_command');
    assert.equal(token(n, '((')?.text, '((');
    assert.equal(token(n, '))')?.text, '))');
    assert.deepEqual(types(t.root, 'compound_statement'), []);
    assert.equal(parser.parse('{ x; }').root.namedChildren[0].type, 'compound_statement');
  });
  it('[[ ]] is an extended_test, [ ] stays a test_command', () => {
    assert.equal(parser.parse('[[ -f a ]]').root.namedChildren[0].type, 'extended_test');
    const t = parser.parse('[ -f a ]');
    assert.equal(t.root.namedChildren[0].type, 'test_command');
    assert.deepEqual(types(t.root, 'extended_test'), []);
  });
  it('select is a select_statement, for stays a for_statement', () => {
    const t = parser.parse('select x in a; do :; done');
    assert.equal(t.root.namedChildren[0].type, 'select_statement');
    assert.equal(token(t.root.namedChildren[0], 'select')?.text, 'select');
    assert.equal(parser.parse('for x in a; do :; done').root.namedChildren[0].type, 'for_statement');
  });
  it('time -p ls | wc is a time_statement over the pipeline', () => {
    const t = parser.parse('time -p ls | wc');
    const n = t.root.namedChildren[0];
    assert.equal(dump(n), '(time_statement time (word option ) (pipeline body (command (command_name name (word )) ) | (command (command_name name (word )))))'.replace('(pipeline body (command (command_name name (word )) ) |', '(pipeline body (command (command_name name (word ))) |'));
    assert.equal(n.text, 'time -p ls | wc');
    assert.equal(token(n, 'time')?.text, 'time');
    assert.equal(field(n, 'option')?.text, '-p');
    const body = field(n, 'body')!;
    assert.equal(body.type, 'pipeline');
    assert.equal(body.text, 'ls | wc');
    assert.equal(body.parent, n);
    assert.equal(body.children[0].text, 'ls');
    assert.equal(body.children[0].children[0].children[0].text, 'ls');
    assert.equal(body.children[0].children[0].children[0].parent!.type, 'command_name');
  });
  it('time of one command, with arguments and a redirection', () => {
    const t = parser.parse('time ls -l /x >o');
    const n = t.root.namedChildren[0];
    assert.equal(n.type, 'time_statement');
    assert.equal(field(n, 'option'), undefined);
    assert.equal(n.text, 'time ls -l /x >o');
    // The redirection is the command's.
    const r = field(n, 'body')!;
    assert.equal(r.type, 'redirected_statement');
    assert.equal(r.namedChildren[1].type, 'file_redirect');
    const body = field(r, 'body')!;
    assert.equal(body.type, 'command');
    assert.equal(body.text, 'ls -l /x');
    assert.equal(field(body, 'name')?.text, 'ls');
    assert.deepEqual(fields(body, 'argument').map((a) => a.text), ['-l', '/x']);
  });
  it('time alone, with only -p, or with only a redirection has no body', () => {
    for (const text of ['time', 'time -p', 'time >o']) {
      const n = types(parser.parse(text).root, 'time_statement')[0];
      assert.ok(n, text);
      assert.equal(field(n, 'body'), undefined, text);
    }
    assert.equal(field(parser.parse('time -p').root.namedChildren[0], 'option')?.text, '-p');
    assert.equal(parser.parse('time -p').root.namedChildren[0].children.length, 2);
  });
  it('time in a list times its command only; after a pipe it is the program', () => {
    const l = parser.parse('time a && b').root.namedChildren[0];
    assert.equal(l.type, 'list');
    assert.equal(l.namedChildren[0].type, 'time_statement');
    // `time` is a keyword only at the start of a pipeline: here, after `&&` but not after `|`.
    assert.equal(parser.parse('a && time b').root.namedChildren[0].namedChildren[1].type, 'time_statement');
    for (const text of ['a | time b', 'a |& time b']) {
      const p = parser.parse(text).root.namedChildren[0];
      assert.equal(p.type, 'pipeline', text);
      assert.equal(p.namedChildren[1].type, 'command', text);
      assert.equal(field(p.namedChildren[1], 'name')?.text, 'time', text);
      assert.deepEqual(types(p, 'time_statement'), [], text);
    }
  });
  it('time with nothing to time before a pipe stays a command', () => {
    const p = parser.parse('time | wc').root.namedChildren[0];
    assert.equal(p.type, 'pipeline');
    assert.equal(p.namedChildren[0].type, 'command');
  });
  it('FOO=1 time, /usr/bin/time, \\time and "time" stay commands', () => {
    for (const text of ['FOO=1 time ls', '/usr/bin/time ls', '\\time ls', '"time" ls']) {
      const t = parser.parse(text);
      assert.deepEqual(types(t.root, 'time_statement'), [], text);
      assert.equal(t.root.namedChildren[0].type, 'command', text);
    }
  });
  it('coproc stays a command', () => {
    const t = parser.parse('coproc ls');
    assert.equal(t.root.namedChildren[0].type, 'command');
    assert.deepEqual(types(t.root, 'coproc_statement'), []);
  });
  it('an if with no fi is incomplete, with an error entry', () => {
    const t = parser.parse('if x; then');
    const n = t.root.namedChildren[0];
    assert.equal(n.type, 'if_statement');
    assert.equal(n.incomplete, true);
    assert.equal(token(n, 'fi'), undefined);
    assert.equal(t.root.incomplete, false);
    assert.deepEqual(t.errors, [{ kind: 'missing', message: 'Missing "fi"', startIndex: 10, endIndex: 10 }]);
    assert.equal(hasError(t.root), true);
  });
  it('unreadable text is an error node with an error entry', () => {
    const t = parser.parse('echo "a\nb');
    const errs = types(t.root, 'error');
    assert.ok(errs.length >= 1);
    assert.equal(t.errors.length >= 1, true);
    assert.deepEqual(t.errors.filter((e) => e.message === 'Syntax error').map((e) => e.startIndex), errs.map((e) => e.startIndex));
    assert.equal(parser.parse('echo ok').errors.length, 0);
  });
  it('rm !(*.txt) is one word', () => {
    const t = parser.parse('rm !(*.txt)');
    const cmd = t.root.namedChildren[0];
    assert.deepEqual(fields(cmd, 'argument').map((a) => [a.type, a.text]), [['word', '!(*.txt)']]);
    assert.deepEqual(types(t.root, 'subshell'), []);
    const piped = parser.parse('rm @(a|b) x').root.namedChildren[0];
    assert.deepEqual(fields(piped, 'argument').map((a) => a.text), ['@(a|b)', 'x']);
  });
});

/** Only the shape: the types of the nodes and their fields; commands and redirections as their text, a heredoc as its start. */
function shape(n: SyntaxNode): string {
  if (!n.named) return JSON.stringify(n.type);
  if (['command', 'declaration_command', 'file_redirect', 'herestring_redirect', 'word'].includes(n.type)) return JSON.stringify(n.text) + (n.field ? '@' + n.field : '');
  if (n.type === 'heredoc_redirect') return `<<${n.children.find((c) => c.type === 'heredoc_start')!.text}${n.field ? '@' + n.field : ''}`;
  return `(${n.type}${n.field ? ' @' + n.field : ''}${n.children.length ? ' ' : ''}${n.children.map(shape).join(' ')})`;
}
const shapeOf = (text: string): string => shape(parser.parse(text).root.namedChildren[0]);
const rawShapeOf = (text: string): string => shape(plain.parse(text).root.namedChildren[0]);

describe('tree-sitter adapter: the shapes of bash', () => {
  it('! negates the whole pipeline', () => {
    assert.equal(shapeOf('! a | b'), '(negated_command "!" (pipeline "a" "|" "b"))');
    assert.equal(shapeOf('! a | b | c'), '(negated_command "!" (pipeline "a" "|" "b" "|" "c"))');
    assert.equal(shapeOf('a | b'), '(pipeline "a" "|" "b")');
    // In a list, it negates the command after it only.
    assert.equal(shapeOf('! a && b'), '(list (negated_command "!" "a") "&&" "b")');
    const neg = parser.parse('! a | b').root.namedChildren[0];
    assert.equal(neg.text, '! a | b');
    assert.equal(neg.parent!.type, 'program');
    assert.equal(neg.namedChildren[0].parent, neg);
    assert.equal(neg.namedChildren[0].field, null);
    assert.equal(neg.namedChildren[0].startIndex, 2);
    // tree-sitter's own tree, for the record.
    assert.equal(rawShapeOf('! a | b'), '(pipeline (negated_command "!" "a") "|" "b")');
    // Nothing after the `!`: it stays where it is.
    assert.equal(types(parser.parse('! | b').root, 'negated_command').length, 1);
  });
  it('the redirections after the last command of a pipeline or list belong to that command', () => {
    assert.equal(shapeOf('echo A && echo B > f'), '(list "echo A" "&&" (redirected_statement "echo B"@body "> f"@redirect))');
    assert.equal(shapeOf('echo a | cat 2>/dev/null'), '(pipeline "echo a" "|" (redirected_statement "cat"@body "2>/dev/null"@redirect))');
    assert.equal(shapeOf('a | b && c 2>&1 > f'), '(list (pipeline "a" "|" "b") "&&" (redirected_statement "c"@body "2>&1"@redirect "> f"@redirect))');
    assert.equal(rawShapeOf('echo A && echo B > f'), '(redirected_statement (list @body "echo A" "&&" "echo B") "> f"@redirect)');
    // A compound command takes its own, alone or last in a list.
    assert.equal(shapeOf('{ a; } > f'), '(redirected_statement (compound_statement @body "{" "a" ";" "}") "> f"@redirect)');
    assert.equal(shapeOf('a && { b; } > f'), '(list "a" "&&" (redirected_statement (compound_statement @body "{" "b" ";" "}") "> f"@redirect))');
    // Also through `!` and `time`.
    assert.equal(shapeOf('! a | b > f'), '(negated_command "!" (pipeline "a" "|" (redirected_statement "b"@body "> f"@redirect)))');
    assert.equal(shapeOf('a && ! b > f'), '(list "a" "&&" (negated_command "!" (redirected_statement "b"@body "> f"@redirect)))');
    assert.equal(shapeOf('time a | b > f'), '(time_statement "time" (pipeline @body "a" "|" (redirected_statement "b"@body "> f"@redirect)))');
    // Nothing to redirect but the redirections: they stay.
    assert.equal(shapeOf('> f'), '(redirected_statement "> f"@redirect)');
    // The ranges follow.
    const t = parser.parse('echo A && echo B > f');
    const list = t.root.namedChildren[0];
    assert.deepEqual([list.startIndex, list.endIndex, list.namedChildren[1].startIndex, list.namedChildren[1].endIndex], [0, 20, 10, 20]);
    assert.equal(list.namedChildren[1].text, 'echo B > f');
  });
  it('what follows <<EOF on its line is not in the heredoc', () => {
    // More redirections stay among the redirections of the command.
    assert.equal(shapeOf('cat <<A 2>&1 >f\n1\nA'), '(redirected_statement "cat"@body <<A@redirect "2>&1"@redirect ">f"@redirect)');
    // Arguments go to the command, and the redirections before the last one with them.
    assert.equal(shapeOf('cat <<A x y\n1\nA'), '"cat <<A x y\\n1\\nA"');
    const cmd = parser.parse('cat <<A x\n1\nA').root.namedChildren[0];
    assert.deepEqual(cmd.children.map((c) => c.type), ['command_name', 'heredoc_redirect', 'word']);
    assert.equal(cmd.endIndex, 'cat <<A x\n1\nA'.length);
  });
  it('the rest of a heredoc line goes on with the pipeline or list', () => {
    assert.equal(shapeOf('cat <<E | wc -l\nx\nE'), '(pipeline (redirected_statement "cat"@body <<E@redirect) "|" "wc -l")');
    assert.equal(shapeOf('a <<E && b\nx\nE'), '(list (redirected_statement "a"@body <<E@redirect) "&&" "b")');
    // `|` binds tighter than `&&` and `||`, which group to the left.
    assert.equal(shapeOf('a <<E | b && c || d | e\nx\nE'), '(list (list (pipeline (redirected_statement "a"@body <<E@redirect) "|" "b") "&&" "c") "||" (pipeline "d" "|" "e"))');
    assert.equal(shapeOf('a | cat <<E | wc && b\nx\nE'), '(list (pipeline "a" "|" (redirected_statement "cat"@body <<E@redirect) "|" "wc") "&&" "b")');
    assert.equal(shapeOf('x && cat <<E | b\nx\nE'), '(list "x" "&&" (pipeline (redirected_statement "cat"@body <<E@redirect) "|" "b"))');
    // The compound command with the heredoc, and a redirection after the heredoc on a pipeline's last command.
    assert.equal(shapeOf('{ cat; } <<E | wc\nx\nE'), '(pipeline (redirected_statement (compound_statement @body "{" "cat" ";" "}") <<E@redirect) "|" "wc")');
    const t = parser.parse('cat <<E | wc -l && echo after\nbody\nE\nnext');
    const list = t.root.namedChildren[0];
    assert.equal(list.type, 'list');
    assert.equal(list.text, 'cat <<E | wc -l && echo after\nbody\nE');
    // (The first part of the list ends with the body, which comes after the rest of the line.)
    assert.deepEqual(list.namedChildren.map((c) => c.type), ['pipeline', 'command']);
    assert.equal(list.namedChildren[0].text, 'cat <<E | wc -l && echo after\nbody\nE');
    assert.equal(list.namedChildren[1].text, 'echo after');
    assert.equal(t.root.namedChildren[1].text, 'next');
    const h = types(t.root, 'heredoc_redirect')[0];
    assert.deepEqual(h.children.map((c) => c.type), ['<<', 'heredoc_start', 'heredoc_body', 'heredoc_end']);
    assert.equal(h.text, '<<E | wc -l && echo after\nbody\nE');
    // tree-sitter nests all of it in the heredoc node.
    assert.deepEqual(types(plain.parse('cat <<E | wc -l && echo after\nbody\nE').root, 'heredoc_redirect')[0].children.map((c) => c.type), ['<<', 'heredoc_start', 'pipeline', 'heredoc_body', 'heredoc_end']);
  });
});

describe('tree-sitter adapter: plain objects', () => {
  it('gives the same object going down and back up', () => {
    const t = parser.parse('if x; then echo a b; fi\n# c');
    const walk = (n: SyntaxNode): void => {
      for (const c of n.children) {
        assert.strictEqual(c.parent, n);
        assert.strictEqual(c.parent!.children[c.parent!.children.indexOf(c)], c);
        walk(c);
      }
    };
    assert.equal(t.root.parent, null);
    walk(t.root);
    const echo = types(t.root, 'command')[1];
    assert.strictEqual(echo.parent!.children.find((c) => c === echo), echo);
    assert.strictEqual(descendants(t.root, ['command'])[1], echo);
    assert.ok(Object.getPrototypeOf(echo) === Object.prototype);
  });
  it('uses UTF-16 positions', () => {
    const t = parser.parse('echo "日本😀" x');
    const x = fields(t.root.namedChildren[0], 'argument')[1];
    assert.equal(x.text, 'x');
    assert.equal(x.startIndex, 'echo "日本😀" '.length);
    assert.equal(x.startPosition.column, 'echo "日本😀" '.length);
  });
  it('starts from wasm binaries too', async () => {
    const p = await createTreeSitterParser({
      runtime: fs.readFileSync(path.join(root, 'node_modules/web-tree-sitter/web-tree-sitter.wasm')),
      bash: fs.readFileSync(path.join(root, 'grammar/tree-sitter-bash.wasm')),
    });
    assert.equal(p.parse('ls').root.type, 'program');
  });
});

describe('tree-sitter adapter: speed', () => {
  const file = '/usr/share/bash-completion/bash_completion';
  (fs.existsSync(file) ? it : it.skip)('converts bash_completion', () => {
    const text = fs.readFileSync(file, 'utf8');
    const t0 = performance.now();
    const ts = legacy.parse(text);
    ts.delete();
    const t1 = performance.now();
    const tree = parser.parse(text);
    const t2 = performance.now();
    console.log(`      bash_completion (${text.split('\n').length} lines): tree-sitter ${(t1 - t0).toFixed(1)} ms; parse + convert ${(t2 - t1).toFixed(1)} ms`);
    assert.ok(tree.root.children.length > 100);
  });
});
