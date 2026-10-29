import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as os from 'os';
import { Analyzer } from '../src/analyzer';
import { dialectIssues, featuresOnLine } from '../src/dialect';
import { explainPrintf } from '../src/embedded/format';
import { explainPerl } from '../src/embedded/perl';
import { judgeYq, yqSameAsJq } from '../src/embedded/yq';
import { relativeDate, runGitLog, sampleCommits } from '../src/examples/gitlog';
import { jqExample } from '../src/examples/jq';
import { pipelineExample } from '../src/examples/pipeline';
import { regexExamples } from '../src/examples/regex';
import { runAwk } from '../src/examples/awk';
import { perlExample, perlOptions, runPerl } from '../src/examples/perlrun';
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
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { TreeCache } from '../src/syntax/cache';
import type { BashParser } from '../src/syntax/tree';
import { panelUpdate } from '../src/ui/panelView';
import { partAt } from '../src/ui/hoverParts';
import { wholeLine } from '../src/ui/hoverView';
import { allTokens, explain } from './support/explain';

// Lines that the tests of each feature do not reach: the less common inputs, and the ways a
// helper gives up. Every line of src/ is to run in some test (see scripts/coverage-check.mjs).

const root = path.join(__dirname, '..');
let parser: BashParser;
before(async () => {
  parser = createUnbashParser();
});

const flat = (e: ReturnType<typeof explain>): string => {
  return [...e.notes, ...allTokens(e.items).map((t) => `${t.label}: ${t.explanation}`)].join('\n');
};

describe('lines no other test reaches', () => {
  it('parser: one tree per document, parsed again only for a new version', () => {
    const cache = new TreeCache(parser);
    let parses = 0;
    const text = (src: string) => () => { parses++; return src; };
    const a1 = cache.get('a', 1, text('echo 1'));
    assert.strictEqual(cache.get('a', 1, text('echo 1')), a1);
    assert.strictEqual(parses, 1);
    assert.strictEqual(cache.get('a', 2, text('echo 2')).root.text, 'echo 2');
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
    assert.match(table!, /^Redirections apply left to right\. In the end: stdin → the here-string, .*fd 3 → the here-string$/);
    assert.match(table!, /out\.log/);
    // A here-document on a descriptor goes to that descriptor (`cat 3<<EOF <&3` reads it).
    assert.match(simulateRedirects([{ op: '<<', fd: '3', dest: '' }, { op: '<&', fd: '', dest: '3' }], 'en')!, /stdin → the here-document, fd 3 → the here-document$/);
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
    const r = rerun({ kind: 'regex', regex: { source: 'a', flags: '' }, mode: 'inverted' }, [['abc', 'xyz']], 'en');
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
    assert.deepStrictEqual(partAt(e.items, { line: 0, character: 6 }).map((t) => t.label), ['echo', 'hi']);
    assert.match(wholeLine({ ex: { ...e, items: [], notes: [] }, lang: 'en', theme: 'dark', lineText: 'echo hi', placement: 'first', panelLink: 'command:x', lineLink: 'command:l', keys: 'K' }), /Nothing to explain/i);
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
    // (A lone set is refused by tr unless only one of -d and -s is given.)
    assert.throws(() => runTr(['-ds', 'a'], ['x']), /extra operand/);
    assert.throws(() => runTr(['a'], ['x']), /extra operand/);
  });

  it('awk and perl runners: what they leave to the real tools', () => {
    assert.strictEqual(runAwk('BEGIN { FS = "((" } { print $1 }', ['a((b']), undefined);
    const ex = (words: string[]) => { const p = perlOptions(words)!; return perlExample(p.code, p.opts); };
    assert.strictEqual(ex(['-ne', 'print "a']), undefined);
    assert.strictEqual(ex(['-pe', 's/\\Qa.b/x/']), undefined);
    assert.strictEqual(ex(['-ne', String.raw`print "\Q$_"`]), undefined);
    assert.strictEqual(perlOptions(['-Xe', 'print']), undefined);
    assert.ok(perlOptions(['-wne', 'print']));
    const tr = perlOptions(['-pe', 'tr/abc/x/'])!;
    assert.deepStrictEqual(runPerl(tr.code, tr.opts, ['abcd']), ['xxxd']);
  });

  it('dialects: bash features found for other shells', () => {
    const features = (src: string) => {
      const tree = parser.parse(src);
      return featuresOnLine(tree.root, 0);
    };
    const cases: [string, string][] = [
      ['diff <(a) <(b)', 'procSub'], ['shopt -s nullglob', 'shopt'], ['pushd /tmp', 'pushd'], ['coproc cat', 'coproc'], ['print hi', 'print'],
      ['whence ls', 'whence'], ['export -f f', 'exportF'], ['wait -n', 'waitN'], ['type -t ls', 'typeT'], ['printf -v x %s y', 'printfV'], ["printf '%q' \"$x\"", 'printfQ'],
    ];
    for (const [src, id] of cases) assert.ok(features(src).includes(id), `${src}: ${features(src)}`);
    const tree = parser.parse('case $x in\n  a) echo a ;&\n  b) echo b ;;&\nesac');
    assert.deepStrictEqual([1, 2].map((l) => featuresOnLine(tree.root, l)), [['caseFall'], ['caseCont']]);
    const zsh = parser.parse('if true; then\n  echo ${(f)x}\nfi');
    assert.ok(dialectIssues(zsh, 'zsh', 'en').some((i) => i.kind === 'parse'));
  });

  it('expansions: quoted patterns, classes in replacements, names by prefix, made-up samples', () => {
    const ex = (src: string) => JSON.stringify(explain(src).examples);
    assert.match(ex('echo "${x#"a"*}"'), /"a"|a/);
    assert.match(ex('echo "${x//[ab]/-}"'), /-/);
    assert.match(ex('echo "${!pre@}"'), /pre_A pre_B/);
    assert.match(ex('echo "${x#zq*}"'), /zq/);
  });

  it('panel: the message that shows a line', () => {
    const e = explain('yq .a f.yml');
    const msg = panelUpdate({ lang: 'ja', explanation: { ...e, shell: 'dash', notes: ['yq: mikefarah/yq v4'] }, file: 'a.sh', line: 0, lineText: 'yq .a f.yml', choice: {}, detected: 'zsh', placement: 'bottom', animations: false });
    assert.strictEqual(msg.dialect.shells[0][1], '自動（zsh）');
    assert.ok(msg.dialect.yqs!.length > 1);
    assert.match(msg.lineLabel, /dash/);
    const en = panelUpdate({ lang: 'en', explanation: explain('echo hi'), file: 'a.sh', line: 0, lineText: 'echo hi', choice: { shell: 'bash', yq: 'kislyuk' }, placement: 'first', animations: true });
    assert.deepStrictEqual([en.dialect.shell, en.dialect.yq, en.dialect.yqs, en.examplesFirst], ['bash', 'kislyuk', undefined, true]);
  });

  describe('the analyzer: constructs no other test explains', () => {
    const cases: [string, number, RegExp][] = [
      ['case $x in\n  a)\n    echo a\n    ;;\nesac', 2, /case branch `a\)`/],
      ['(\n  echo a\n)', 1, /\( \) subshell/],
      ['if then fi\necho ok )\n  more (\nx', 1, /syntax error region|./],
      ['( cd /tmp && ls )', 0, /Subshell: runs `\( \)` in a child process/],
      ['declare -i n', 0, /n: Variable `n`/],
      ['FOO=1 2>/dev/null', 0, /nor do they apply to the assignments `FOO=1`/],
      ['(( n > 1 )) 2>/dev/null', 0, /test \(\( n > 1 \)\)|Arithmetic/],
      ["grep -v 'foo[0-9]' f", 0, /Printed \(lines that do not match\)/],
      ["jq --argjson n '{bad' '.a' f", 0, /./],
      ["jq 'error(\"x\")' f", 0, /Error/],
      ["awk -vx=1 '{ print x }' f", 0, /./],
      ["printf 'a\\n' | xargs echo", 0, /Commands run by `xargs echo`/],
      ["perl -e 'print 1+1'", 0, /Output/],
      ['echo {1..1000}', 0, /Brace expansion/],
      ["git log --format='%G?'", 0, /./],
      ['getopt --options=ab --longoptions=help,file: -- "$@"', 0, /./],
      ['getopt -a -o x -l long -- "$@"', 0, /./],
      ['getopt -T', 0, /./],
      ['printf -v out "%s-%s" a b', 0, /Value stored in `out`/],
      ["printf '%(%F)T\\n' -1", 0, /./],
      ['echo ${s:i:2}', 0, /substring of `s` \(offset `i`, length `2`\)/],
      ['echo ${a[@]:1}', 0, /take the elements of array `a` from index `1` on/],
      ['echo "${@:2}"', 0, /Offset 2: from `\$2`/],
      ['x=$"hi"', 0, /`\$"…"` string: translated according to the locale/],
      ['a[1]=x', 0, /Assign to element `\[1\]` of array `a`/],
      ['declare a[1]', 0, /Declare the array `a` \(bash ignores the subscript `\[1\]`\)/],
      ['declare a[@]', 0, /Declare the array `a` \(bash ignores the subscript `\[@\]`\)/],
      ['f()\n{ echo; }', 1, /\{ \}/],
      ['read -z x', 0, /./],
      ['grep --regexp="$p" f', 0, /value: `"\$p"`/],
    ];
    for (const [src, line, re] of cases) it(src.split('\n')[0], () => assert.match(flat(explain(src, line)) + JSON.stringify(explain(src, line).examples) + explain(src, line).context.map((c) => c.label).join('\n'), re));
    it('yq -r with kislyuk/yq prints raw strings', () => {
      const tree = parser.parse("yq -r '.name' f.yml");
      const e = new Analyzer('en').explainLine(tree, 0, undefined, { yqFlavor: 'kislyuk' });
      assert.ok(e.examples.some((x) => x.kind === 'yq'));
    });
    it('a distribution alias in a README', () => {
      const tree = parser.parse('ll');
      const e = new Analyzer('en').explainLine(tree, 0, undefined, { host: { kind: 'markdown' } });
      assert.ok(e.notes.some((n) => /^ℹ System-dependent: `ll`/.test(n)));
    });
  });

  describe('languages inside arguments', () => {
    const cases: [string, RegExp[]][] = [
      [`awk 'BEGIN { while ((getline line) > 0) n++ } { print >> "log" } NR==3 { exit 1 } { for (i = 1; i <= NF; i++) s += $i; print $NF } END { if (s) { print s } }'`,
        [/read the next line/, /appended to the file "log"/, /exit awk with status 1/, /loop with init; condition; update/, /the last field/]],
      [`find . -mtime 3 -regex '.*\.sh' -atime +1 -empty -ls`,
        [/modified between 3 and 4 days ago/, /the whole path matches the regex/, /accessed at least 2 days ago/, /empty/, /list it in detail/]],
      [`sed -e '1c\\' -e 'new' -e 't done' -e ':done'`, [/if an `s` succeeded, branch to "done"/]],
      [`jq '.. | numbers, $ENV.HOME, (foreach .[] as $x (0; . + $x)), (def f: 1; f), (.a / ","), env.PATH' f.json`,
        [/the input and all of its descendants/, /Foreach/, /division \(splits strings\)/]],
      [`grep -P '(?i)foo(?<n>x)?a{2,}(b' f`, [/set matching options/, /2 or more times/, /missing closing parenthesis/]],
      [String.raw`sed 's/a\tb/x/' f`, [/(^|\n)\\t: /]],
      [`awk 'function f(a) { return a } { print | "sort"; if (x) continue; delete a[1]; getline; print $(NF-1), $(i+1) }'`,
        [/Defines the function `f`/, /return from the function/, /piped to the command "sort"/, /continue with the next iteration/, /delete the array element `a\[1\]`/, /read the next line/, /the second-to-last field/, /\$\(i\+1\)/]],
      [`find . -ctime -1 -cmin 5 -size +10k -size -1M -size 3 -group g -perm 644 -maxdepth 2 -mindepth 1 -readable -writable -executable -true -false -quit`,
        [/changed less than 1 days \(24 hours\) ago/, /size over 10 KiB/, /empty files only/, /group g/, /permissions exactly 644/, /at most 2 levels deep/, /at least 1 levels deep/, /readable/, /writable/, /executable/, /always true/, /always false/, /quit/]],
      [`jq '.a or .b, 5 % 2, .a.[0], .b?, @base64 "x\\(.)", -(.x), [], {(.k): 1}, (label $out | 1), (.a | def f: 1; f), (def g(x): x; g(1)), (foreach .[] as $x (0; . + $x; [$x]))' f`,
        [/true if either side is true/, /remainder/, /(^|\n)\?: ignore errors/, /applied to each `\\\(…\)` in the string/, /negation/, /An empty array/, /the computed key/, /Label `\$out`/]],
      [`yq '.[] as $x ireduce (0; . + $x)' f.yml`, [/Fold: start from `0`/]],
      [`yq 'env(HOME)' f.yml`, [/the environment variable name `HOME`/]],
      [`jq '.a, def f: 1; f' f`, [/Defines the function `f`/]],
      [`grep -P 'a*+b??c{2,}+' f`, [/possessive, no backtracking/, /as few as possible/, /2 or more times \(possessive/]],
      [`grep -P 'a+?b{,3}c{2,3}d{x}[\\d_]' f`, [/at most 3 times/, /2 to 3 times/, /a digit/]],
      [`sed -n -e '# note' -e '2,~4p' -e 'T end' -e 's/a/b/2w out.txt' -e 's/a/\\x/' -e 's/b/c' -e 's/b' f`,
        [/Comment/, /up to the next line that is a multiple of 4/, /if no `s` succeeded, branch to "end"/, /replace only the 2nd match/, /write changed lines to "out.txt"/, /Unterminated `s` command/]],
    ];
    for (const [src, res] of cases) {
      it(src.slice(0, 60), () => {
        const t = flat(explain(src));
        for (const re of res) assert.match(t, re);
      });
    }
  });
});
