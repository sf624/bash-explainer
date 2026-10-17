import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import { explainGetoptShort } from '../src/embedded/getopt';
import { explainGitFormat } from '../src/embedded/gitformat';
import { explainMode, explainUmask } from '../src/embedded/mode';
import { explainTrSet } from '../src/embedded/textutils';
import { runGetopt } from '../src/examples/getopt';
import { rerun } from '../src/examples/rerun';
import { xargsExample } from '../src/examples/runtime';
import { globToRegex } from '../src/examples/shellwords';
import { yamlLines } from '../src/examples/yaml';
import { extractShell } from '../src/hosts';
import { resolveLang } from '../src/i18n';
import { simulateRedirects } from '../src/idioms';
import { BashParser, createBashParser, TreeCache } from '../src/parser';
import { toMarkdown } from '../src/ui/render';

// Lines that the tests of each feature do not reach: the less common inputs, and the ways a
// helper gives up. Every line of src/ is to run in some test (see scripts/coverage-check.mjs).

const root = path.join(__dirname, '..');
const wasm = {
  runtimeDir: path.join(root, 'node_modules/web-tree-sitter'),
  bashWasm: path.join(root, 'node_modules/tree-sitter-bash/tree-sitter-bash.wasm'),
};
let parser: BashParser;
before(async () => {
  parser = await createBashParser(wasm);
});

const explain = (src: string, line = 0) => {
  const tree = parser.parse(src);
  try {
    return new Analyzer('en').explainLine(tree, line);
  } finally {
    tree.delete();
  }
};
const flat = (e: ReturnType<typeof explain>): string => {
  const all = (ts: typeof e.items): typeof e.items => ts.flatMap((t) => [t, ...all(t.children)]);
  return [...e.notes, ...all(e.items).map((t) => `${t.label}: ${t.explanation}`)].join('\n');
};

describe('lines no other test reaches', () => {
  it('parser: made from the wasm files themselves, as in VS Code', async () => {
    const binaries = { runtime: fs.readFileSync(path.join(wasm.runtimeDir, 'web-tree-sitter.wasm')), bash: fs.readFileSync(wasm.bashWasm) };
    const p = await createBashParser(binaries);
    const tree = p.parse('echo hi');
    assert.strictEqual(tree.rootNode.type, 'program');
    tree.delete();
  });

  it('parser: one tree per document, parsed again only for a new version', () => {
    const cache = new TreeCache(parser);
    let parses = 0;
    const text = (src: string) => () => { parses++; return src; };
    const a1 = cache.get('a', 1, text('echo 1'));
    assert.strictEqual(cache.get('a', 1, text('echo 1')), a1);
    assert.strictEqual(parses, 1);
    assert.strictEqual(cache.get('a', 2, text('echo 2')).rootNode.text, 'echo 2');
    cache.get('b', 1, text('echo b'));
    assert.strictEqual(parses, 3);
    cache.evict('a');
    cache.get('a', 2, text('echo 2'));
    assert.strictEqual(parses, 4);
    cache.dispose();
    cache.get('b', 1, text('echo b'));
    assert.strictEqual(parses, 5);
    cache.dispose();
  });

  it('i18n: the language setting, then the UI language', () => {
    assert.deepStrictEqual([resolveLang('ja', 'en'), resolveLang('en', 'ja'), resolveLang('auto', 'ja-JP'), resolveLang(undefined, 'de')], ['ja', 'en', 'ja', 'en']);
  });

  it('globs: a negated extended glob inside another gives up', () => {
    assert.strictEqual(globToRegex('@(!(x)|y)', 'value'), undefined);
  });

  it('redirections: closing and copying stdin', () => {
    assert.match(flat(explain('exec 3<&-')), /3<&-: Close file descriptor 3/);
    assert.match(flat(explain('exec 3>&-')), /3>&-: Close file descriptor 3/);
    assert.match(flat(explain('cat <&3')), /Make stdin \(fd 0\) a copy of file descriptor 3/);
  });

  it('redirections: the table of where each stream goes, with >&file, &> and here-strings', () => {
    const table = simulateRedirects([{ op: '<<<', fd: '', dest: 'x' }, { op: '&>', fd: '', dest: 'all.log' }, { op: '>&', fd: '', dest: 'out.log' }, { op: '<&', fd: '3', dest: '0' }], 'en');
    assert.match(table!, /the here-document\/string/);
    assert.match(table!, /out\.log/);
  });

  it('getopt: a leading - in the short options, and the arguments it rejects', () => {
    assert.match(explainGetoptShort('-ab:', 'en')!.tokens[0].explanation, /Leading `-`/);
    assert.throws(() => runGetopt({ short: 'ab:', long: ['file:'] }, ['--file']), /missing value/);
    assert.throws(() => runGetopt({ short: 'ab:', long: ['help'] }, ['--help=x']), /unexpected value/);
    assert.throws(() => runGetopt({ short: 'ab:', long: [] }, ['-b']), /missing value/);
  });

  it('git log formats: tformat:', () => {
    assert.match(explainGitFormat('tformat:%h', 'en')!.tokens[0].explanation, /`tformat:`: show each commit with the template \(newline after each\)/);
  });

  it('modes: symbolic umask, and a leading 0', () => {
    assert.match(explainUmask('u=rwx,g=rx,o=', 'en')!.note!, /permissions that new files may have/);
    assert.match(explainMode('0755', 'en')!.tokens[0].explanation, /no special bits/);
  });

  it('tr: octal escapes', () => {
    assert.match(JSON.stringify(explainTrSet('\\101', 'from', 'en')), /the character with octal code 101/);
  });

  it('grep -v: the panel reruns the inverted match', () => {
    const r = rerun({ kind: 'regex', regex: { source: 'a', flags: '' }, mode: 'inverted' }, ['abc', 'xyz'], 'en');
    assert.deepStrictEqual(r.sections[0].lines, ['xyz']);
  });

  it('xargs: options it cannot run give no example', () => {
    assert.strictEqual(xargsExample(['--no-such-option']), undefined);
  });

  it('YAML output: quoting for PyYAML, and multi-line strings', () => {
    assert.deepStrictEqual(yamlLines("a: it's", 'kislyuk'), ["'a: it''s'"]);
    assert.deepStrictEqual(yamlLines('a\nb', 'mikefarah'), ['|-', '  a', '  b']);
    assert.throws(() => yamlLines('a\nb', 'kislyuk'), /multi-line string/);
  });

  it('hover: the token under the cursor, and a line with nothing to explain', () => {
    const e = explain('echo hi');
    assert.match(toMarkdown(e, 'en', { line: 0, character: 6 }), /<strong><code><span[^>]*>hi<\/span><\/code><\/strong>/);
    assert.match(toMarkdown({ ...e, items: [], notes: [] }, 'en'), /Nothing to explain/i);
  });

  it('host files: a trailing $ in a Makefile recipe, a Jenkinsfile shebang, a Python list item with \\x41', () => {
    assert.match(extractShell('makefile', 'all:\n\techo cost: $\n').text, /echo cost: \$$/m);
    const jk = extractShell('jenkinsfile', "node {\n  sh '''#!/usr/bin/env bash\n    echo hi\n  '''\n}\n");
    assert.strictEqual(jk.regions[0].shell, 'bash');
    assert.strictEqual(extractShell('jenkinsfile', "node {\n  sh '''\n    #!/bin/zsh\n    echo hi\n  '''\n}\n").regions[0].shell, 'zsh');
    assert.match(extractShell('python', 'import subprocess\nsubprocess.run(["ls", "-l\\x41"])\n').text, /ls -lA/);
  });
});
