import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { findIdioms, simulateRedirects } from '../src/idioms';
import { Analyzer, Token } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants } from '../src/syntax/tree';

// The idioms of the statements of a source text (the kinds of statement the analyzer collects on a line).
const STATEMENTS = ['command', 'redirected_statement', 'list', 'pipeline', 'extended_test', 'while_statement'];
function idioms(sources: string[], lang: 'en' | 'ja'): string[] {
  const parser = createUnbashParser();
  return findIdioms(sources.flatMap((src) => descendants(parser.parse(src).root, STATEMENTS)), lang);
}
/** Whether the statements of `src` hold one `set` that turns on errexit, nounset and pipefail. */
const isStrictMode = (src: string): boolean => idioms([src], 'en').some((n) => /strict mode/.test(n));

describe('redirect order', () => {
  it('follows redirections left to right', () => {
    assert.match(simulateRedirects([{ op: '>', fd: '', dest: '/dev/null' }, { op: '>&', fd: '2', dest: '1' }], 'en')!,
      /In the end: stdout → \/dev\/null, stderr → \/dev\/null \(all output, including errors, is discarded\)/);
  });

  it('warns about 2>&1 before the file redirection', () => {
    const r = simulateRedirects([{ op: '>&', fd: '2', dest: '1' }, { op: '>', fd: '', dest: 'out.log' }], 'en')!;
    assert.match(r, /stdout → out\.log, stderr → the original stdout/);
    assert.match(r, /Note: `2>&1` comes before the file redirection/);
  });

  it('recognises a swap through a third descriptor', () => {
    const r = simulateRedirects([{ op: '>&', fd: '3', dest: '1' }, { op: '>&', fd: '1', dest: '2' }, { op: '>&', fd: '2', dest: '3' }], 'en')!;
    assert.match(r, /stdout and stderr are swapped/);
  });

  it('stays quiet when the order cannot matter', () => {
    assert.strictEqual(simulateRedirects([{ op: '>', fd: '', dest: 'a' }], 'en'), undefined);
    assert.strictEqual(simulateRedirects([{ op: '>', fd: '', dest: 'a' }, { op: '>', fd: '2', dest: 'b' }], 'en'), undefined);
  });
});

describe('idioms', () => {
  const has = (stmt: string, re: RegExp) => assert.ok(idioms([stmt], 'en').some((n) => re.test(n)), stmt);

  it('finds common patterns', () => {
    has('while IFS= read -r line', /reads a line exactly as is/);
    has('IFS= read -r -d "" item', /reads a line exactly as is/);
    has('cd "$(dirname "$0")"', /moves to the directory the script lives in/);
    has('command -v jq >/dev/null 2>&1', /checks quietly whether a command is installed/);
    has('set -euo pipefail', /strict mode/);
    has('set -Eeuo pipefail', /strict mode/);
    has(': "${API_KEY:?API_KEY is required}"', /checks that a required variable is set/);
    has('rm -f x || true', /turns a failure into success/);
    has("trap 'rm -rf \"$tmp\"' EXIT", /runs clean-up/);
    has('[[ "${BASH_SOURCE[0]}" == "$0" ]]', /run directly rather than sourced/);
  });

  it('reports the larger idiom only', () => {
    const notes = idioms(['SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)', 'cd "$(dirname "${BASH_SOURCE[0]}")"'], 'en');
    assert.strictEqual(notes.length, 1);
    assert.match(notes[0], /absolute path/);
  });

  it('ignores ordinary commands', () => {
    assert.deepStrictEqual(idioms(['echo hello', 'cd /tmp', 'read line'], 'en'), []);
  });
});

describe('set option bundles, compared with bash', () => {
  const bashOn = (cmd: string): string[] | undefined => {
    const r = spawnSync('bash', ['-c', `${cmd}; set -o`], { encoding: 'utf8' });
    if (r.error) return undefined;
    return r.stdout.split('\n').filter((l) => /\ton$/.test(l)).map((l) => l.split(/\s/)[0])
      .filter((n) => ['errexit', 'nounset', 'pipefail', 'noglob', 'xtrace'].includes(n)).sort();
  };
  const flat = (ts: Token[]): Token[] => ts.flatMap((t) => [t, ...flat(t.children)]);
  // The options the explanation names: the letters, and the word after each `-o`.
  const explained = (cmd: string): string[] => {
    const parser = createUnbashParser();
    const toks = flat(new Analyzer('en').explainLine(parser.parse(cmd), 0).items);
    const names = new Map([['-e', 'errexit'], ['-u', 'nounset'], ['-f', 'noglob'], ['-x', 'xtrace']]);
    const on: string[] = [];
    for (const t of toks) if (t.kind === 'option' && names.has(t.label)) on.push(names.get(t.label)!);
    // Values of -o: the argument tokens that are not letters of a bundle.
    for (const t of toks) if (t.kind === 'argument' && /^(errexit|nounset|pipefail|noglob|xtrace)$/.test(t.label)) on.push(t.label);
    return [...new Set(on)].sort();
  };
  const variants = [
    'set -euo pipefail', 'set -eou pipefail', 'set -oeu pipefail', 'set -o pipefail -eu', 'set -e -u -o pipefail',
    'set -Eeuo pipefail', 'set -o errexit -o nounset -o pipefail', 'set -oo pipefail errexit', 'set -eo pipefail -u',
    'set -xeuo pipefail', 'set -eu', 'set -o pipefail', 'set -fo pipefail',
  ];

  for (const cmd of variants) {
    it(`${cmd}`, function () {
      const on = bashOn(cmd);
      if (!on) return this.skip();
      assert.deepStrictEqual(explained(cmd), on);
      assert.strictEqual(isStrictMode(cmd), ['errexit', 'nounset', 'pipefail'].every((n) => on.includes(n)), cmd);
    });
  }

  it('turns options off with +', function () {
    const cmd = 'set -euo pipefail; set +eo pipefail';
    const on = bashOn(cmd);
    if (!on) return this.skip();
    assert.deepStrictEqual(on, ['nounset']);
    assert.strictEqual(isStrictMode('set -euo pipefail +e'), false);
    assert.strictEqual(isStrictMode('set -euo pipefail +o pipefail'), false);
    assert.strictEqual(isStrictMode('set +eo pipefail -eu'), false);
    const toks = flat(new Analyzer('en').explainLine(createUnbashParser().parse('set +eo pipefail'), 0).items);
    assert.ok(toks.some((t) => t.kind === 'argument' && t.label === 'pipefail' && /turn it off|disable|Undo/i.test(t.explanation)), toks.map((t) => t.explanation).join('\n'));
  });

  it('is not strict mode for other commands and positional parameters', () => {
    assert.strictEqual(isStrictMode('echo set -euo pipefail'), false);
    assert.strictEqual(isStrictMode('set -eu; set -o pipefail'), false);
    assert.strictEqual(isStrictMode('set -eu -- -o pipefail'), false);
    assert.strictEqual(isStrictMode('set -eu -o'), false);
    assert.strictEqual(isStrictMode('set -euo pipefail && echo ok'), true);
  });
});

describe('reading a file line by line', () => {
  const notes = (stmt: string) => idioms([stmt], 'en').filter((n) => /line by line/.test(n));

  it('knows a loop fed by a file and one fed by a command', () => {
    assert.match(notes('while read -r line; do echo "$line"; done < input.txt')[0], /^Idiom: `while read … done < file`.*unless the loop is `while read -r line \|\| \[ -n "\$line" \]`$/);
    assert.match(notes('while read -r line; do echo "$line"; done < "$f"')[0], /done < file/);
    assert.match(notes('while IFS= read -r line; do n=$((n+1)); done < <(ls)')[0], /done < <\(command\)`.*current shell/);
    assert.match(idioms(['while read -r l; do :; done < <(ls)'], 'ja').join(), /カレントシェル/);
    assert.match(idioms(['while read -r l; do :; done < f'], 'ja').join(), /1行ずつ/);
  });

  it('leaves other loops alone', () => {
    assert.deepStrictEqual(notes('while true; do sleep 1; done < f'), []);
    assert.deepStrictEqual(notes('while read -r line; do echo "$line"; done'), []);
    assert.deepStrictEqual(notes('for x in a; do read -r y; done < f'), []);
  });
});

describe('argument parsing, NUL-safe loops and other everyday idioms', () => {
  const en = (stmt: string) => idioms([stmt], 'en').join('\n');
  const ja = (stmt: string) => idioms([stmt], 'ja').join('\n');
  const yes = (stmt: string, re: RegExp, jaRe: RegExp) => {
    assert.match(en(stmt), re, stmt);
    assert.match(ja(stmt), jaRe, stmt);
  };

  it('knows getopts and the shift after it', () => {
    yes("while getopts 'ab:' opt; do", /`while getopts`.*\$OPTARG/, /\$OPTARG/);
    yes('shift $((OPTIND-1))', /local OPTIND=1/, /local OPTIND=1/);
    yes('shift "$(( OPTIND - 1 ))"', /drops the options/, /取り除き/);
    assert.strictEqual(en('shift $((OPTIND))'), '');
    assert.strictEqual(en('shift 2'), '');
    assert.strictEqual(en('getopts ab: opt'), '');
    yes('while getopt ab: "$@"; do', /no `s`/, /`s` なし/);
    assert.strictEqual(en('getopt ab: "$@"'), '');
  });

  it('knows GNU getopt with eval set --', () => {
    yes('args=$(getopt -o ab: --long all,bar: -- "$@")', /rewrites the arguments/, /書き直す/);
    yes('eval set -- "$args"', /Keep `"\$args"` in double quotes/, /ダブルクォート/);
    assert.strictEqual(en('args=$(date)'), '');
    assert.strictEqual(en('eval "$cmd"'), '');
    assert.strictEqual(en('set -- a b'), '');
  });

  it('knows the loop over the arguments', () => {
    for (const w of ['while [ $# -gt 0 ]; do', 'while [[ $# -gt 0 ]]; do', 'while [ "$#" -ne 0 ]; do', 'while (( $# )); do', 'while (( $# > 0 )); do', 'while [[ $# != 0 ]]; do']) {
      yes(w, /a loop over the arguments/, /引数を先頭から順に/);
    }
    assert.strictEqual(en('while [ $# -gt 1 ]; do'), '');
    assert.strictEqual(en('while [ $x -gt 0 ]; do'), '');
    assert.strictEqual(en('while (( n < 3 )); do'), '');
  });

  it('knows NUL-separated names', () => {
    yes("while IFS= read -r -d '' f; do", /`read -d ''`/, /NUL/);
    yes('read -rd "" f', /up to a NUL byte/, /NUL/);
    assert.strictEqual(en('read -d , f').includes('NUL'), false);
    assert.strictEqual(en('read -r f').includes('NUL'), false);
    yes("find . -type f -print0 | while IFS= read -r -d '' f", /`find -print0`/, /`find -print0`/);
    assert.strictEqual(en('find . -type f -print'), '');
    yes('find . -print0 | xargs -0 rm', /`xargs -0`/, /`xargs -0`/);
    yes('xargs -n 1 -0 echo', /`xargs -0`/, /`xargs -0`/);
    yes('xargs --null rm', /`xargs -0`/, /`xargs -0`/);
    assert.strictEqual(en('xargs rm'), '');
    assert.strictEqual(en('xargs -n 10 rm'), '');
    assert.strictEqual(en('xargs -I {} cp {} /tmp'), '');
  });

  it('knows until, mapfile, the glob guard and the yes/no prompt', () => {
    yes('until curl -sf localhost:8080; do', /`until command`/, /失敗する間/);
    assert.strictEqual(en('echo until x'), '');
    yes('mapfile -t lines < input.txt', /reads each line of the input into an array/, /配列の要素/);
    yes('readarray -t lines < <(ls)', /`mapfile` \(`readarray`\)/, /`mapfile`/);
    yes('ls | mapfile -t lines', /loses the array/, /配列が消える/);
    assert.strictEqual(en('echo mapfile'), '');
    yes('[ -e "$f" ] || continue', /skips a name that does not exist/, /存在しない名前/);
    yes('[[ -f $f ]] || continue', /\*\.txt/, /\*\.txt/);
    assert.strictEqual(en('[ -e "$f" ] || exit 1'), '');
    assert.strictEqual(en('[ -z "$f" ] || continue'), '');
    assert.strictEqual(en('[ -e x ] || continue'), '');
    for (const line of ['[ -e foo ] || continue', 'true || continue', '[ -e a b ] || continue']) assert.strictEqual(en(line), '', line);
    yes("read -r -p 'Continue? [y/N] ' ans", /a yes\/no question/, /はい／いいえ/);
    yes('read -rp "Sure (y/n)? " ans', /a yes\/no question/, /はい／いいえ/);
    assert.strictEqual(en("read -r -p 'Name: ' name"), '');
    assert.strictEqual(en('read -r ans'), '');
  });
});
