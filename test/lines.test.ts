import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as os from 'os';
import { Analyzer } from '../src/analyzer';
import { explainPrintf } from '../src/embedded/format';
import { explainPerl } from '../src/embedded/perl';
import { judgeYq, yqSameAsJq } from '../src/embedded/yq';
import { relativeDate, runGitLog, sampleCommits } from '../src/examples/gitlog';
import { jqExample } from '../src/examples/jq';
import { pipelineExample } from '../src/examples/pipeline';
import { regexExamples } from '../src/examples/regex';
import { runSed } from '../src/examples/sed';
import { runCut, runTr } from '../src/examples/textfilters';
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

  it('printf formats: \\x and \\u escapes, a bad conversion, a precision on integers', () => {
    const t = explainPrintf('\\x41 \\u00e9 %.3d 100%', 'en').map((x) => x.explanation).join('\n');
    assert.match(t, /the character with hex code 41/);
    assert.match(t, /Unicode character U\+00E9/);
    assert.match(t, /at least 3 digits/);
    assert.match(t, /Invalid conversion after `%`/);
  });

  it('perl: BEGIN and END blocks, tr///, <STDIN>, %ENV', () => {
    const t = JSON.stringify([explainPerl('BEGIN { $n = 0 } tr/a-z/A-Z/; $l = <STDIN>; print $ENV{HOME}', 'en'), explainPerl('y/a/b', 'en')]);
    assert.match(t, /`BEGIN \{ \}`: runs once before any input/);
    assert.match(JSON.stringify(explainPerl('END { print $n } $n++', 'en')), /`END \{ \}`: runs once after all input.*"start":17/);
    assert.match(t, /Transliterate: each character of `a-z`/);
    assert.match(t, /Transliterate \(tr\)/);
    assert.match(t, /read a line of input/);
    assert.match(t, /an environment variable/);
  });

  it('yq: expressions that cannot be read are not taken for jq', () => {
    assert.strictEqual(yqSameAsJq('.a | "x'), false);
    assert.strictEqual(judgeYq(['.a | "x', 'f.yml']).flavor, 'mikefarah4');
  });

  it('git log: relative dates over a year agree with git', function () {
    const now = Date.now();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reldate-'));
    try {
      execFileSync('git', ['init', '-q', dir]);
      for (const days of [400, 500, 730, 800, 1500, 2000, 4000]) {
        const when = Math.floor(now / 1000) - days * 86400;
        const env = { ...process.env, GIT_AUTHOR_DATE: `${when} +0000`, GIT_COMMITTER_DATE: `${when} +0000`, GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@b', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@b' };
        execFileSync('git', ['-C', dir, 'commit', '-q', '--allow-empty', '-m', String(days)], { env });
        const real = execFileSync('git', ['-C', dir, 'log', '-1', '--date=relative', '--format=%ad']).toString().trim();
        assert.strictEqual(relativeDate(when, now), real, `${days} days`);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('git log: %N and %e are empty, %x41 is a byte', () => {
    assert.deepStrictEqual(runGitLog(sampleCommits().slice(0, 1), 'format:[%N%e]%x41'), ['[]A']);
  });

  it('jq: shapes of input for as-bindings and tonumber', () => {
    assert.ok(jqExample('.a as $x | $x + 1'));
    assert.ok(jqExample('.n | tonumber'));
  });

  it('regex: examples give up on patterns their parser does not follow', () => {
    assert.strictEqual(regexExamples({ source: '(?<n>a)\\k<n>', flags: '' }), undefined);
  });

  it('pipelines: sed -nE -e and awk -v in a stage', () => {
    const stages = [
      { cmd: 'printf', words: ['a\\nb\\n'], text: "printf 'a\\nb\\n'" },
      { cmd: 'sed', words: ['-nEe', 's/a/x/p'], text: "sed -nEe 's/a/x/p'" },
      { cmd: 'awk', words: ['-vy=1', '{ print $0 y }'], text: "awk -vy=1 '{ print $0 y }'" },
    ];
    const ex = pipelineExample(stages, false);
    assert.ok(ex, 'has an example');
    assert.deepStrictEqual(ex.steps[ex.steps.length - 1].output, ['x1']);
    assert.strictEqual(pipelineExample([stages[0], { cmd: 'awk', words: ['-v', 'y', '{ print }'], text: 'awk -v y' }], false), undefined);
  });

  it('sed: comments, the I flag on an address, a range ending on an earlier line', () => {
    assert.deepStrictEqual(runSed('# drop A lines\n/a/I d', ['A', 'b'], { quiet: false, extended: false }), ['b']);
    assert.deepStrictEqual(runSed('2,1d', ['a', 'b', 'c'], { quiet: false, extended: false }), ['a', 'c']);
  });

  it('cut and tr: --output-delimiter on characters, tr -ds, and tr without a second set', () => {
    assert.deepStrictEqual(runCut(['-c', '1-2,4', '--output-delimiter=:'], ['abcde']), ['ab:d']);
    assert.deepStrictEqual(runTr(['-ds', 'a', 'b'], ['aabbbc']), ['bc']);
    assert.throws(() => runTr(['-ds', 'a'], ['x']), /two sets/);
    assert.throws(() => runTr(['a'], ['x']), /two sets/);
  });
});
