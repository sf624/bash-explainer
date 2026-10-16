import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type Parser = require('web-tree-sitter');
import { BEHAVIOURS, behavioursOnLine, detectShell, dialectNotes, featuresOnLine, FEATURES } from '../src/dialect';
import { createBashParser } from '../src/parser';

const root = path.join(__dirname, '..');
let parser: Parser;
before(async () => {
  parser = await createBashParser({
    runtimeDir: path.join(root, 'node_modules/web-tree-sitter'),
    bashWasm: path.join(root, 'node_modules/tree-sitter-bash/tree-sitter-bash.wasm'),
  });
});

// A snippet per feature that prints "ok" only where the feature works.
const PROBES: Record<string, string> = {
  dbracket: '[[ a == a ]] && echo ok',
  regex: '[[ abc =~ ^a(b) ]] && echo ok',
  array: 'a=(x y z); [ "$(echo ${a[@]})" = "x y z" ] && echo ok',
  assoc: 'declare -A m 2>/dev/null || typeset -A m; m[k]=v; [ "${m[k]}" = v ] && echo ok',
  plusAssign: 'v=a; v+=b; [ "$v" = ab ] && echo ok',
  replace: 'v=aXbX; [ "${v//X/-}" = a-b- ] && echo ok',
  replaceAnchor: 'v=XaX; [ "${v/#X/-}" = -aX ] && echo ok',
  caseMod: 'v=ab; [ "${v^^}" = AB ] && echo ok',
  substr: 'v=abcdef; [ "${v:1:3}" = bcd ] && echo ok',
  indirect: 'x=y; y=ok; echo "${!x}"',
  prefixNames: 'ab1=1; ab2=2; [ "${!ab*}" = "ab1 ab2" ] && echo ok',
  arrayKeys: 'a=(x y); [ "$(echo ${!a[@]})" = "0 1" ] && echo ok',
  transform: 'v=a; [ "${v@Q}" = "\'a\'" ] && echo ok',
  negIndex: 'a=(x y z); [ "${a[-1]}" = z ] && echo ok',
  funcKeyword: 'function f { echo ok; }; f',
  herestring: 'cat <<< ok',
  ansiC: 'v=$\'a\\tb\'; [ "$v" = "$(printf \'a\\tb\')" ] && echo ok',
  procSub: 'cat <(echo ok)',
  ampRedirect: 'x=$( { echo bad; } &>/dev/null ); sleep 0.1; [ -z "$x" ] && echo ok',
  ampAppend: 'x=$( { echo bad; } &>>/dev/null ); sleep 0.1; [ -z "$x" ] && echo ok',
  pipeAmp: '{ echo ok >&2; } |& cat',
  eqeqTest: '[ a == a ] && echo ok',
  arithCommand: '(( 1 + 1 == 2 )) && echo ok',
  cFor: 'for ((i=0;i<1;i++)); do echo ok; done',
  braceRange: '[ "$(echo {1..3})" = "1 2 3" ] && echo ok',
  braceList: '[ "$(echo a{b,c})" = "ab ac" ] && echo ok',
  caseFall: 'case a in a) echo ok;& b) ;; esac',
  caseCont: 'case a in a) echo ok;;& b) ;; esac',
  select: 'echo 1 | { select x in ok; do echo $x; break; done; } 2>/dev/null',
  local: 'f() { local v=ok; echo $v; }; f',
  declare: 'declare v=ok; echo $v',
  typeset: 'typeset v=ok; echo $v',
  readarray: "printf 'x\\n' | { readarray -t a && echo ok; }",
  source: "echo 'echo ok' > \"${TMPDIR:-/tmp}/.probe_src\"; source \"${TMPDIR:-/tmp}/.probe_src\"",
  let: 'let x=1+1; [ $x = 2 ] && echo ok',
  shopt: 'shopt -s nullglob && echo ok',
  pushd: 'pushd / >/dev/null && echo ok',
  exportF: 'f() { :; }; export -f f && echo ok',
  waitN: 'sleep 0 & wait -n && echo ok',
  coproc: 'coproc cat </dev/null && echo ok',
  typeT: '[ "$(type -t echo)" = builtin ] && echo ok',
  print: 'print ok',
  whence: 'whence echo >/dev/null && echo ok',
  printfV: 'printf -v v %s ok; echo $v',
  printfQ: '[ "$(printf %q \'a b\')" = \'a\\ b\' ] && echo ok',
  echoE: '[ "$(echo -e \'a\\tb\')" = "$(printf \'a\\tb\')" ] && echo ok',
  echoN: '[ "$(echo -n x; echo y)" = xy ] && echo ok',
  readA: "echo 'a b' | { read -a arr; [ \"${arr[1]}\" = b ] && echo ok; }",
  readP: "echo ok | { read -p '' v; echo $v; }",
  readOpts: 'echo ok | { read -s v; echo $v; }',
  pipefail: 'set -o pipefail && echo ok',
  trapErr: "trap 'true' ERR 2>/dev/null && echo ok",
  errtrace: 'set -E 2>/dev/null && echo ok',
  random: '[ -n "$RANDOM" ] && [ "$RANDOM" != "$RANDOM" ] && echo ok',
  seconds: '[ -n "$SECONDS" ] && echo ok',
  pipestatus: 'false | true; [ "${PIPESTATUS[0]}" = 1 ] && echo ok',
  funcname: 'f() { [ "$FUNCNAME" = f ] && echo ok; }; f',
  uid: '[ -n "$UID" ] && echo ok',
  hostname: '[ -n "$HOSTNAME" ] && echo ok',
};
// A snippet per behaviour that prints "ok" only where it differs from bash.
const BEHAVIOUR_PROBES: Record<string, string> = {
  echoEscape: '[ "$(echo \'a\\tb\')" = "$(printf \'a\\tb\')" ] && echo ok',
  wordSplit: 'v="a b"; set -- $v; [ $# = 1 ] && echo ok',
  arrayBase: 'a=(x y); [ "${a[1]}" = x ] && echo ok',
  typesetScope: 'f() { typeset v=in; }; v=out; f; [ "$v" = in ] && echo ok',
};
// Probes that cannot be checked with `sh -c` (bash needs `shopt -s extglob` before parsing).
const UNPROBED = ['extglob', 'bashVar'];

/** Find a shell in $BASH_EXPLAIN_SHELLS (a directory) or on PATH. */
function locate(names: string[]): string | undefined {
  const dirs = [process.env.BASH_EXPLAIN_SHELLS, ...(process.env.PATH ?? '').split(':')].filter(Boolean) as string[];
  for (const n of names) for (const d of dirs) if (fs.existsSync(path.join(d, n))) return path.join(d, n);
  return undefined;
}

describe('the dialect table agrees with the installed shells', () => {
  const shells: [string, string[], string][] = [
    ['b', ['bash'], '--norc'], ['d', ['dash'], ''], ['a', ['busybox'], 'sh'], ['y', ['yash'], ''], ['k', ['ksh93', 'ksh'], ''], ['m', ['mksh'], ''], ['z', ['zsh'], '-f'],
  ];
  it('has a probe for every feature', () => {
    assert.deepStrictEqual(Object.keys(FEATURES).filter((id) => !PROBES[id] && !UNPROBED.includes(id)), []);
  });
  for (const [letter, names, flag] of shells) {
    const bin = locate(names);
    (bin ? describe : describe.skip)(names[0], () => {
      for (const [id, code] of Object.entries(PROBES)) {
        it(id, () => {
          const r = spawnSync(bin!, [...(flag ? [flag] : []), '-c', code], { timeout: 5000, input: '' });
          assert.strictEqual(r.stdout.toString().trim() === 'ok', FEATURES[id].works.includes(letter), `${id} in ${names[0]}`);
        });
      }
      for (const [id, code] of Object.entries(BEHAVIOUR_PROBES)) {
        it(`behaviour ${id}`, () => {
          const r = spawnSync(bin!, [...(flag ? [flag] : []), '-c', code], { timeout: 5000, input: '' });
          assert.strictEqual(r.stdout.toString().trim() === 'ok', BEHAVIOURS[id].differs.includes(letter), `${id} in ${names[0]}`);
        });
      }
    });
  }
});

describe('detectShell', () => {
  const cases: [string, string, string | undefined][] = [
    ['#!/bin/sh\n', 'x.sh', 'sh'], ['#!/usr/bin/env bash\n', '', 'bash'], ['#!/bin/dash -e\n', '', 'dash'], ['#!/bin/busybox sh\n', '', 'ash'],
    ['#!/usr/bin/env -S ksh93\n', '', 'ksh'], ['#!/bin/mksh\n', '', 'mksh'], ['#!/bin/zsh\n', '', 'zsh'], ['echo\n', '.zshrc', 'zsh'],
    ['# shellcheck shell=dash\necho\n', 'a.sh', 'dash'], ['echo\n', 'a.sh', undefined], ['#!/usr/bin/python3\n', 'a.sh', undefined],
  ];
  for (const [text, file, expected] of cases) {
    it(`${JSON.stringify(text.split('\n')[0])} ${file}`, () => assert.strictEqual(detectShell(text, file), expected));
  }
});

describe('dialect notes', () => {
  const features = (src: string, line = 0) => featuresOnLine(parser.parse(src).rootNode, line);
  it('finds bash-only constructs', () => {
    assert.deepStrictEqual(features('[[ -f $f ]] && echo "${f//x/y}" &> log'), ['dbracket', 'replace', 'ampRedirect']);
    assert.deepStrictEqual(features('a=(x y); echo "${a[1]}" {1..3} a{b,c} $RANDOM <<< x'), ['array', 'braceRange', 'braceList', 'random', 'herestring']);
    assert.deepStrictEqual(features('function f { local v; read -rp "x" v; }'), ['funcKeyword', 'local', 'readP']);
    assert.deepStrictEqual(features("echo '{a,b}' \"x{1..2}\""), []);
    assert.deepStrictEqual(features('(( i++ )); for ((i=0;i<3;i++)); do :; done'), ['arithCommand', 'cFor']);
  });
  it('reports each block once, on the line it starts', () => {
    const src = 'function f {\n  [[ -n $1 ]]\n}';
    assert.deepStrictEqual([0, 1, 2].map((l) => features(src, l)), [['funcKeyword'], ['dbracket'], []]);
  });
  it('words the note for POSIX sh and for a specific shell', () => {
    const notes = (src: string, shell: Parameters<typeof dialectNotes>[2]) => dialectNotes(parser.parse(src).rootNode, 0, shell, 'en');
    assert.deepStrictEqual(notes('[[ -f x ]]', 'sh'), ['⚠ `[[ ]]` is not POSIX sh (it fails in dash). Instead, use `[ ]`.']);
    assert.deepStrictEqual(notes('f() { local v; }', 'sh'), ['⚠ `local` is not POSIX sh (dash and busybox ash accept it, but POSIX does not have it).']);
    assert.deepStrictEqual(notes('cmd &> log', 'dash')[0], '⚠ `&>` (redirect stdout and stderr together) is not available in dash. Instead, write `>file 2>&1` (dash reads `cmd &> file` as "run in the background, then an empty redirection").');
    assert.deepStrictEqual(notes('[[ -f x ]]', 'ksh'), []);
    assert.deepStrictEqual(notes('[[ -f x ]]', 'bash'), []);
  });

  it('notes behaviour that differs from bash', () => {
    const notes = (src: string, shell: Parameters<typeof dialectNotes>[2]) => dialectNotes(parser.parse(src).rootNode, 0, shell, 'en');
    assert.deepStrictEqual(behavioursOnLine(parser.parse("echo 'a\\tb' $v ${a[0]} \"$q\"").rootNode, 0), ['echoEscape', 'wordSplit', 'arrayBase']);
    assert.match(notes("echo 'a\\tb'", 'sh')[0], /^ℹ dash's `echo` interprets/);
    assert.deepStrictEqual(notes("echo 'a\\tb'", 'ksh'), []);
    assert.match(notes('echo $v', 'zsh')[0], /In zsh an unquoted `\$var` is not split/);
    assert.deepStrictEqual(notes('echo "$v"', 'zsh'), []);
    assert.match(notes('ls *(.)', 'zsh')[0], /zsh-only syntax/);
    const scope = (src: string) => dialectNotes(parser.parse(src).rootNode, 1, 'ksh', 'en');
    assert.match(scope('f() {\n  typeset v=1\n}')[0], /does not make a local variable/);
    assert.deepStrictEqual(scope('function f {\n  typeset v=1\n}'), []);
  });
});
