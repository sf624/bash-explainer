import { interpret } from './argv/interpret';
import { type BashVersion, DEFAULT_BASH_VERSION, lacks, SINCE, unclosedBrace } from './bashversion';
import { has, operands, values } from './argv/query';
import { argWord } from './argv/words';
import { builtins } from './dict/builtins';
import { pick } from './embedded/types';
import { parseExpansion } from './expansion';
import { Lang } from './i18n';
import { type NoteLevel, notePrefix, PORTABILITY } from './messages';
import { ancestor, braceTakenAsWord, descendants, field, fields, prefixAssignments, substitutionForm } from './syntax/tree';
import { networkPath, networkTarget } from './dict/syntax';
import { staticWordValue } from './staticword';
import type { Point, SyntaxNode, SyntaxTree } from './syntax/tree';
import { bracketWords, writtenAsBracket } from './testexpr';

/** Shells a script can be written for. `sh` means "any POSIX sh" (dash, busybox ash, …). */
export type Shell = 'bash' | 'sh' | 'dash' | 'ash' | 'yash' | 'ksh' | 'mksh' | 'zsh';
type RealShell = Exclude<Shell, 'sh'>;

export const SHELL_NAMES: Record<Shell, string> = {
  bash: 'bash', sh: 'POSIX sh', dash: 'dash', ash: 'busybox ash', yash: 'yash', ksh: 'ksh93', mksh: 'mksh', zsh: 'zsh',
};

/** The shell a script is written for, from its shebang, a ShellCheck directive or its file name. */
export function detectShell(text: string, fileName = ''): Shell | undefined {
  const head = text.slice(0, 2000);
  const directive = /^#\s*shellcheck\s+shell=(\w+)/m.exec(head)?.[1];
  if (directive) return shellFromName(directive);
  const shebang = /^#!\s*(.*)/.exec(head);
  if (shebang) {
    const words = shebang[1].trim().split(/\s+/);
    const prog = words[0].split('/').pop()!;
    // `#!/bin/busybox sh`, `#!/usr/bin/env bash`, `#!/usr/bin/env -S ksh93 -e`.
    if (prog === 'env') {
      const arg = words.slice(1).find((w) => !w.startsWith('-') && !w.includes('='));
      return arg ? shellFromName(arg.split('/').pop()!) : undefined;
    }
    return shellFromName(prog);
  }
  const base = fileName.split(/[\\/]/).pop()!;
  if (/\.zsh$|^\.?z(shrc|profile|login|logout|shenv)$/.test(base)) return 'zsh';
  if (/\.ksh$|^\.?mkshrc$/.test(base)) return base.includes('mksh') ? 'mksh' : 'ksh';
  if (/\.bash$|^\.?bash(rc|_profile|_login|_logout|_aliases)$/.test(base)) return 'bash';
  return undefined;
}

/** The shell a program name stands for (`dash`, `ksh93`, `lksh`, `busybox`, `posh`…); the one mapping every reader uses. */
export function shellFromName(name: string): Shell | undefined {
  const n = name.replace(/\d+(\.\d+)*$/, '');
  if (n === 'bash') return 'bash';
  if (n === 'sh' || n === 'posh') return 'sh';
  if (n === 'dash') return 'dash';
  if (n === 'ash' || n === 'busybox') return 'ash';
  if (n === 'yash') return 'yash';
  if (n === 'ksh') return 'ksh';
  if (n === 'mksh' || n === 'lksh' || n === 'pdksh' || n === 'oksh') return 'mksh';
  if (n === 'zsh') return 'zsh';
  return undefined;
}

/**
 * Where each bash feature works, measured with bash 5.2, dash 0.5.12, busybox 1.36 ash, yash 2.55,
 * ksh93u+m 1.0.8, mksh R59 and zsh 5.9 (see test/dialect.test.ts, which re-checks the installed ones).
 * The letters are b d a y k m z; none of them is in POSIX sh. A feature of a later bash (`SINCE` in src/bashversion.ts)
 * has no `b`: bash's own check is by its version (`dialectIssues`).
 */
interface Feature { works: string; ja: string; en: string; altJa?: string; altEn?: string }

export const FEATURES: Record<string, Feature> = {
  dbracket: { works: 'bayk mz', ja: '`[[ ]]`', en: '`[[ ]]`', altJa: '`[ ]` を使う', altEn: 'use `[ ]`' },
  regex: { works: 'b  yk z', ja: '`[[ =~ ]]` の正規表現マッチ', en: '`[[ =~ ]]` regex matching', altJa: '`expr` や `grep -E` を使う', altEn: 'use `expr` or `grep -E`' },
  array: { works: 'b  ykmz', ja: '配列', en: 'arrays', altJa: '位置パラメータ（`set -- …`）を使う', altEn: 'use the positional parameters (`set -- …`)' },
  assoc: { works: 'b   kmz', ja: '連想配列', en: 'associative arrays' },
  plusAssign: { works: 'b   kmz', ja: '`+=` による追加', en: 'appending with `+=`', altJa: '`v="${v}…"` と書く', altEn: 'write `v="${v}…"`' },
  replace: { works: 'b ayk mz', ja: '`${var/pattern/string}` の置換', en: '`${var/pattern/string}` replacement', altJa: '`sed` などを使う', altEn: 'use `sed` or similar' },
  replaceAnchor: { works: 'b  ykmz', ja: '`${var/#…}` / `${var/%…}` の置換', en: '`${var/#…}` / `${var/%…}` replacement' },
  caseMod: { works: 'b', ja: '`${var^^}` などの大文字・小文字変換', en: '`${var^^}`-style case conversion', altJa: '`tr` を使う', altEn: 'use `tr`' },
  substr: { works: 'b a kmz', ja: '`${var:offset:length}` の部分文字列', en: '`${var:offset:length}` substrings', altJa: '`cut` や `expr substr` を使う', altEn: 'use `cut` or `expr substr`' },
  indirect: { works: 'b', ja: '`${!var}` の間接参照', en: '`${!var}` indirection', altJa: '`eval` を使う', altEn: 'use `eval`' },
  prefixNames: { works: 'b   k', ja: '`${!prefix*}` の変数名一覧', en: '`${!prefix*}` name lists' },
  arrayKeys: { works: 'b   km', ja: '`${!array[@]}` のインデックス一覧', en: '`${!array[@]}` index lists' },
  transform: { works: 'b', ja: '`${var@Q}` などの変換', en: '`${var@Q}`-style transformations' },
  negIndex: { works: 'b  yk z', ja: '負の添字 `${a[-1]}`', en: 'negative subscripts `${a[-1]}`' },
  funcKeyword: { works: 'b aykmz', ja: '`function` キーワードによる関数定義', en: 'the `function` keyword', altJa: '`name() { … }` と書く', altEn: 'write `name() { … }`' },
  herestring: { works: 'b  ykmz', ja: 'ヒアストリング `<<<`', en: 'here-strings `<<<`', altJa: '`printf \'%s\\n\' … |` やヒアドキュメントを使う', altEn: 'use `printf \'%s\\n\' … |` or a here-document' },
  ansiC: { works: 'b a kmz', ja: '`$\'…\'` の文字列', en: '`$\'…\'` strings', altJa: '`printf` を使う', altEn: 'use `printf`' },
  procSub: { works: 'b ayk z', ja: 'プロセス置換 `<(…)` / `>(…)`', en: 'process substitution `<(…)` / `>(…)`', altJa: '一時ファイルや名前付きパイプを使う', altEn: 'use a temporary file or a named pipe' },
  ampRedirect: { works: 'b a kmz', ja: '`&>`（標準出力と標準エラー出力をまとめてリダイレクト）', en: '`&>` (redirect stdout and stderr together)', altJa: '`>file 2>&1` と書く（dash では `cmd &> file` が「バックグラウンド実行 + 空のリダイレクト」と解釈される）', altEn: 'write `>file 2>&1` (dash reads `cmd &> file` as "run in the background, then an empty redirection")' },
  ampAppend: { works: 'b    mz', ja: '`&>>`', en: '`&>>`', altJa: '`>>file 2>&1` と書く', altEn: 'write `>>file 2>&1`' },
  // (Measured by the probe in test/dialect.test.ts: bash and yash connect, dash does not (yash in CI, where it is
  // installed). The others are from their documentation: ksh93 connects for `/dev/tcp` and `/dev/udp`; busybox
  // ash, mksh and zsh have no such names.)
  netRedirect: { works: 'b  yk', ja: '`/dev/tcp/ホスト/ポート` へのリダイレクトによるネットワーク接続', en: 'network connections by redirecting to `/dev/tcp/host/port`', altJa: '`nc` などのコマンドを使う', altEn: 'use a command such as `nc`' },
  pipeAmp: { works: 'b     z', ja: '`|&`（標準エラー出力もパイプに流す）', en: '`|&` (pipe stderr too)', altJa: '`2>&1 |` と書く', altEn: 'write `2>&1 |`' },
  eqeqTest: { works: 'b ayk m', ja: '`[ a == b ]` の `==`', en: '`==` in `[ ]`', altJa: '`=` を使う', altEn: 'use `=`' },
  arithCommand: { works: 'b   kmz', ja: '算術コマンド `(( ))`', en: 'the arithmetic command `(( ))`', altJa: '`[ "$((式))" -ne 0 ]` と書く', altEn: 'write `[ "$((expr))" -ne 0 ]`' },
  cFor: { works: 'b   k z', ja: 'C 言語風の `for (( ; ; ))`', en: 'C-style `for (( ; ; ))`', altJa: '`while` と `$(( ))` で書く', altEn: 'use `while` with `$(( ))`' },
  braceRange: { works: 'b   k z', ja: 'ブレース展開 `{1..3}`', en: 'brace ranges `{1..3}`', altJa: '`seq` を使う', altEn: 'use `seq`' },
  braceList: { works: 'b   kmz', ja: 'ブレース展開 `{a,b}`', en: 'brace expansion `{a,b}`' },
  caseFall: { works: 'b   kmz', ja: '`case` の `;&`（次の分岐へ続ける）', en: '`;&` in `case` (fall through)' },
  caseCont: { works: 'b    m', ja: '`case` の `;;&`（続けて次のパターンも調べる）', en: '`;;&` in `case` (test the next patterns too)' },
  extglob: { works: 'b   km', ja: '拡張グロブ `@(…)` など', en: 'extended globs like `@(…)`' },
  select: { works: 'b   kmz', ja: '`select` ループ', en: '`select` loops' },
  local: { works: 'bday mz', ja: '`local`', en: '`local`' },
  declare: { works: 'b     z', ja: '`declare`', en: '`declare`' },
  typeset: { works: 'b  ykmz', ja: '`typeset`', en: '`typeset`' },
  readarray: { works: 'b', ja: '`readarray` / `mapfile`', en: '`readarray` / `mapfile`', altJa: '`while read` で1行ずつ読む', altEn: 'read lines with `while read`' },
  source: { works: 'b a kmz', ja: '`source`', en: '`source`', altJa: '`.` を使う', altEn: 'use `.`' },
  let: { works: 'b a kmz', ja: '`let`', en: '`let`', altJa: '`$(( ))` を使う', altEn: 'use `$(( ))`' },
  shopt: { works: 'b', ja: '`shopt`', en: '`shopt`' },
  pushd: { works: 'b  y  z', ja: '`pushd` / `popd`', en: '`pushd` / `popd`', altJa: '`cd` と変数で戻り先を覚える', altEn: 'remember the directory in a variable and `cd`' },
  exportF: { works: 'b', ja: '`export -f`', en: '`export -f`' },
  waitN: { works: 'b a', ja: '`wait -n`', en: '`wait -n`' },
  coproc: { works: 'b     z', ja: '`coproc`', en: '`coproc`' },
  print: { works: '    kmz', ja: '`print`', en: '`print`', altJa: '`printf \'%s\\n\'` を使う', altEn: 'use `printf \'%s\\n\'`' },
  whence: { works: '    kmz', ja: '`whence`', en: '`whence`', altJa: '`command -v` を使う', altEn: 'use `command -v`' },
  typeT: { works: 'b   k', ja: '`type -t`', en: '`type -t`', altJa: '`command -v` を使う', altEn: 'use `command -v`' },
  printfV: { works: 'b   k z', ja: '`printf -v`', en: '`printf -v`', altJa: '`v=$(printf …)` と書く', altEn: 'write `v=$(printf …)`' },
  printfQ: { works: 'b     z', ja: '`printf %q`', en: '`printf %q`' },
  echoE: { works: 'b a kmz', ja: '`echo -e`', en: '`echo -e`', altJa: '`printf` を使う（dash の echo は `-e` を文字として表示し、`\\t` などは常に解釈する）', altEn: 'use `printf` (dash prints `-e` literally and always interprets `\\t` and friends)' },
  echoN: { works: 'bda kmz', ja: '`echo -n`', en: '`echo -n`', altJa: '`printf` を使う', altEn: 'use `printf`' },
  readA: { works: 'b   k', ja: '`read -a`', en: '`read -a`' },
  readP: { works: 'bday', ja: '`read -p`（プロンプト）', en: '`read -p` (prompt)', altJa: '`printf` でプロンプトを出してから `read` する（ksh/mksh/zsh の `-p` は別の意味）', altEn: 'print the prompt with `printf`, then `read` (`-p` means something else in ksh, mksh and zsh)' },
  readOpts: { works: 'b a kmz', ja: '`read` の `-n` / `-s` / `-t` / `-d`', en: '`read -n` / `-s` / `-t` / `-d`' },
  pipefail: { works: 'b aykmz', ja: '`set -o pipefail`', en: '`set -o pipefail`' },
  trapErr: { works: 'b a kmz', ja: '`trap … ERR`', en: '`trap … ERR`' },
  errtrace: { works: 'bda   z', ja: '`set -E`', en: '`set -E`' },
  random: { works: 'b aykmz', ja: '`$RANDOM`', en: '`$RANDOM`', altJa: '`awk \'BEGIN{srand(); print int(rand()*32768)}\'` などを使う', altEn: 'use e.g. `awk \'BEGIN{srand(); print int(rand()*32768)}\'`' },
  seconds: { works: 'b   kmz', ja: '`$SECONDS`', en: '`$SECONDS`' },
  pipestatus: { works: 'b    m', ja: '`$PIPESTATUS`', en: '`$PIPESTATUS`' },
  bashVar: { works: 'b', ja: 'bash 専用の変数', en: 'bash-only variables' },
  funcname: { works: 'b a', ja: '`$FUNCNAME`', en: '`$FUNCNAME`' },
  uid: { works: 'b     z', ja: '`$UID` / `$EUID`', en: '`$UID` / `$EUID`', altJa: '`$(id -u)` を使う', altEn: 'use `$(id -u)`' },
  hostname: { works: 'b a', ja: '`$HOSTNAME`', en: '`$HOSTNAME`', altJa: '`$(hostname)` を使う', altEn: 'use `$(hostname)`' },
  funsub: { works: '    km', ja: '`${ …; }`（現在のシェルで実行するコマンド置換）', en: '`${ …; }` (command substitution in the current shell)', altJa: '`$(…)` を使う（サブシェルで実行される）', altEn: 'use `$(…)` (it runs in a subshell)' },
  valsub: { works: '     m', ja: '`${| …; }`（`REPLY` の値になるコマンド置換）', en: '`${| …; }` (command substitution that gives the value of `REPLY`)', altJa: '関数の中で `REPLY` を設定し、呼び出したあとで `$REPLY` を読む', altEn: 'set `REPLY` in a function, call it, then read `$REPLY`' },
};

/**
 * Constructs that work everywhere but behave differently from bash in some shells (the letters
 * in `differs`, measured like FEATURES).
 */
interface Behaviour { differs: string; ja: (shell: string) => string; en: (shell: string) => string }

export const BEHAVIOURS: Record<string, Behaviour> = {
  echoEscape: {
    differs: 'dymz',
    ja: (sh) => `${sh} の \`echo\` は引数の \`\\t\` や \`\\n\` などを解釈します（bash は文字のまま表示）。どちらでも同じにするには \`printf\` を使います。`,
    en: (sh) => `${sh}'s \`echo\` interprets \`\\t\`, \`\\n\` and the like in its arguments (bash prints them as they are). Use \`printf\` to get the same result everywhere.`,
  },
  wordSplit: {
    differs: 'z',
    ja: (sh) => `${sh} ではクォートしない \`$変数\` も単語分割・グロブ展開されません（bash では空白で分かれます）。`,
    en: (sh) => `In ${sh} an unquoted \`$var\` is not split into words or globbed (bash splits it on spaces).`,
  },
  typesetScope: {
    differs: 'k',
    ja: (sh) => `${sh} では \`name() { … }\` の形の関数の中の \`typeset\` はローカル変数になりません（グローバル変数を変更します）。ローカルにするには \`function name { … }\` の形で定義します。`,
    en: (sh) => `In ${sh}, \`typeset\` inside a function written \`name() { … }\` does not make a local variable (it changes the global one); define the function as \`function name { … }\` for local scope.`,
  },
  arrayBase: {
    differs: 'yz',
    ja: (sh) => `${sh} の配列の添字は 1 から始まります（bash は 0 から）。この解説は bash の数え方です。`,
    en: (sh) => `Array subscripts start at 1 in ${sh} (bash starts at 0); this explanation counts the bash way.`,
  },
};

/** A construct found in the tree: what it is, and the node where it starts. */
export interface Found { id: string; node: SyntaxNode }

/** Calls `check` for every node starting on lines [from, to]. */
function walk(root: SyntaxNode, from: number, to: number, check: (n: SyntaxNode) => void): void {
  const visit = (n: SyntaxNode) => {
    if (n.startPosition.row > to || n.endPosition.row < from) return;
    if (n.startPosition.row >= from) check(n);
    n.children.forEach(visit);
  };
  visit(root);
}

/** Behaviours used on lines [from, to] (see BEHAVIOURS). */
export function collectBehaviours(root: SyntaxNode, from: number, to: number): Found[] {
  const found: Found[] = [];
  walk(root, from, to, (n) => {
    const add = (id: string) => found.push({ id, node: n });
    if (n.type === 'command' && field(n, 'name')?.text === 'echo'
      && n.namedChildren.slice(1).some((a) => /\\[abcefnrtv\\0]/.test(a.type === 'raw_string' ? a.text : a.type === 'string' ? a.text.replace(/\\\\/g, '\\') : ''))) add('echoEscape');
    // An unquoted `$var` used as a word of a command.
    if (n.type === 'simple_expansion' && (n.parent?.type === 'command' || n.parent?.type === 'concatenation' && n.parent.parent?.type === 'command')) add('wordSplit');
    if (n.type === 'command' && field(n, 'name')?.text === 'typeset') {
      const f = ancestor(n, (a) => a.type === 'function_definition');
      if (f && f.children[0].type !== 'function') add('typesetScope');
    }
    if (n.type === 'expansion') {
      const p = parseExpansion(n.text);
      if (p?.subscript && /^\d+$/.test(p.subscript)) add('arrayBase');
    }
  });
  return found;
}

const ids = (found: Found[]) => [...new Set(found.map((f) => f.id))];

/** Behaviours used on the line (see BEHAVIOURS). */
export function behavioursOnLine(root: SyntaxNode, line: number): string[] {
  return ids(collectBehaviours(root, line, line));
}

const LETTER: Record<RealShell, string> = { bash: 'b', dash: 'd', ash: 'a', yash: 'y', ksh: 'k', mksh: 'm', zsh: 'z' };

function works(f: Feature, shell: RealShell): boolean {
  return f.works.includes(LETTER[shell]);
}

/** Whether feature `id` of FEATURES works in `shell` (bash when absent; POSIX sh has none of them). */
export function featureWorks(id: string, shell?: Shell): boolean {
  return !shell || (shell !== 'sh' && works(FEATURES[id], shell as RealShell));
}

/**
 * Whether the shell brace-expands the word of plain text `text` (one that has a brace expansion): every kind in it must
 * work there. (dash and POSIX sh have no brace expansion, mksh no ranges: `echo {a,b}` prints `{a,b}` in dash.)
 */
export function bracesWork(text: string, shell?: Shell): boolean {
  return (!/\{[^{}]*,[^{}]*\}/.test(text) || featureWorks('braceList', shell)) && (!/\{[^{}]*\.\.[^{}]*\}/.test(text) || featureWorks('braceRange', shell));
}

/** Features used by the constructs starting on lines [from, to]. */
export function collectFeatures(root: SyntaxNode, from: number, to: number): Found[] {
  const found: Found[] = [];
  walk(root, from, to, (n) => classify(n, n.children.map((c) => c.type), (id) => found.push({ id, node: n })));
  return found;
}

/** Features used by the parts of `root` on `line` (a construct counts on the line where it starts). */
export function featuresOnLine(root: SyntaxNode, line: number): string[] {
  return ids(collectFeatures(root, line, line));
}

/** A redirection to `/dev/tcp/host/port` (or `/dev/udp/…`), as the value of its word: quoted, it connects too. */
function redirectsToNetwork(n: SyntaxNode): boolean {
  const dests = fields(n, 'destination');
  const target = (dests.length === 1 ? staticWordValue(dests[0]) : undefined) ?? dests.map((d) => d.text).join(' ');
  // (With a target, the redirection has its operator.)
  return !!networkPath(target) && !!networkTarget(n.children.find((c) => !c.named)!.type, field(n, 'descriptor')?.text ?? '', target);
}

function classify(n: SyntaxNode, kids: string[], add: (id: string) => void): void {
  switch (n.type) {
    case 'arithmetic_command': add('arithCommand'); return;
    case 'extended_test':
      add('dbracket');
      if (descendants(n, ['=~']).length) add('regex');
      return;
    case 'command': {
      // (`[ a == b ]`, by its spelling.)
      if (writtenAsBracket(n) && bracketWords(n).words.some((w) => w.text === '==')) add('eqeqTest');
      const name = field(n, 'name');
      // (A command with no name has only assignments: their own case.)
      if (!name) return;
      const prefix = prefixAssignments(n);
      commandFeatures(name.text, n.namedChildren.filter((c) => c !== name && !prefix.includes(c)), add);
      return;
    }
    case 'brace_expression': add('braceRange'); return;
    case 'coproc_statement': add('coproc'); return;
    case 'command_substitution': {
      const form = substitutionForm(n);
      if (form === '${') add('funsub');
      else if (form === '${|') add('valsub');
      return;
    }
    case 'c_style_for_statement': add('cFor'); return;
    case 'select_statement': add('select'); return;
    case 'function_definition': if (kids[0] === 'function') add('funcKeyword'); return;
    case 'herestring_redirect': add('herestring'); return;
    case 'ansi_c_string': add('ansiC'); return;
    case 'process_substitution': add('procSub'); return;
    case 'file_redirect':
      if (kids.includes('&>')) add('ampRedirect');
      if (kids.includes('&>>')) add('ampAppend');
      if (redirectsToNetwork(n)) add('netRedirect');
      return;
    case 'pipeline': if (kids.includes('|&')) add('pipeAmp'); return;
    case 'case_item':
      if (kids.includes(';&')) add('caseFall');
      if (kids.includes(';;&')) add('caseCont');
      return;
    case 'extglob_pattern': if (/[@!?*+]\(/.test(n.text)) add('extglob'); return;
    case 'variable_assignment': {
      const value = field(n, 'value');
      if (value?.type === 'array') add('array');
      if (kids.includes('+=')) add('plusAssign');
      return;
    }
    case 'expansion': {
      const p = parseExpansion(n.text);
      if (!p) return;
      if (p.subscript !== undefined) add(/^-\d/.test(p.subscript) ? 'negIndex' : 'array');
      if (p.prefix === '!') add(p.op === '*' || p.op === '@' ? 'prefixNames' : p.subscript === '@' || p.subscript === '*' ? 'arrayKeys' : 'indirect');
      if (p.op === '/' || p.op === '//') add('replace');
      if (p.op === '/#' || p.op === '/%') add('replaceAnchor');
      if (p.op && /^[\^,]{1,2}$/.test(p.op)) add('caseMod');
      if (p.op === ':') add('substr');
      if (p.op === '@') add('transform');
      variableFeature(p.name, add);
      return;
    }
    case 'simple_expansion': variableFeature(n.text.slice(1), add); return;
    case 'word': case 'concatenation': {
      // Only unquoted words brace-expand; `{` in a quoted string is plain text.
      if (n.parent?.type === 'string' || n.parent?.type === 'concatenation') return;
      const t = n.type === 'word' ? n.text : n.children.filter((c) => c.type === 'word').map((c) => c.text).join('');
      // (A range, `{1..3}`, is a `brace_expression`.)
      if (/\{[^{}\s'"]*,[^{}\s'"]*\}/.test(t)) add('braceList');
      if (/[@!?+]\([^)]*\)/.test(t)) add('extglob');
      return;
    }
  }
}

function variableFeature(name: string, add: (id: string) => void): void {
  if (name === 'RANDOM') add('random');
  else if (name === 'SECONDS') add('seconds');
  else if (name === 'PIPESTATUS') add('pipestatus');
  else if (name === 'FUNCNAME') add('funcname');
  else if (name === 'UID' || name === 'EUID') add('uid');
  else if (name === 'HOSTNAME') add('hostname');
  else if (/^BASH_|^BASHPID$|^BASHOPTS$|^EPOCH(SECONDS|REALTIME)$/.test(name)) add('bashVar');
}

/** The features of a builtin's options and operands, read from the parse of its words with the builtin's spec. */
function commandFeatures(name: string, nodes: SyntaxNode[], add: (id: string) => void): void {
  // (Every name below is a builtin's.)
  if (!Object.hasOwn(builtins, name)) return;
  const parse = interpret(builtins[name], nodes.map(argWord), { name });
  const on = (...names: string[]): boolean => has(parse, ...names);
  // The values of `set -o NAME` (not `set +o NAME`), also bundled as in `set -euo pipefail`.
  const setOption = (option: string): boolean => values(parse, '-o').some(({ word, role }) => role.of.startsWith('-') && argWord(nodes[word]).value === option);
  switch (name) {
    case 'declare': add(on('-A') ? 'assoc' : 'declare'); break;
    case 'typeset': add(on('-A') ? 'assoc' : 'typeset'); break;
    case 'local': add('local'); break;
    case 'readarray': case 'mapfile': add('readarray'); break;
    case 'source': add('source'); break;
    case 'let': add('let'); break;
    case 'shopt': add('shopt'); break;
    case 'pushd': case 'popd': case 'dirs': add('pushd'); break;
    case 'print': add('print'); break;
    case 'whence': add('whence'); break;
    case 'export': if (on('-f')) add('exportF'); break;
    case 'wait': if (on('-n')) add('waitN'); break;
    case 'type': if (on('-t')) add('typeT'); break;
    case 'printf':
      if (on('-v')) add('printfV');
      if (nodes.some((w) => /%q/.test(w.text))) add('printfQ');
      break;
    case 'echo':
      if (on('-e')) add('echoE');
      if (on('-n')) add('echoN');
      break;
    case 'read':
      if (on('-a')) add('readA');
      if (on('-p')) add('readP');
      if (on('-n', '-s', '-t', '-d')) add('readOpts');
      break;
    case 'set':
      if (setOption('pipefail')) add('pipefail');
      if (on('-E') || setOption('errtrace')) add('errtrace');
      break;
    case 'trap': if (operands(parse, 'SIGNAL').some(({ word }) => argWord(nodes[word]).value === 'ERR')) add('trapErr'); break;
  }
}

/** The level of a dialect issue (src/messages.ts, `NoteLevel`): what fails in the shell is a warning, the rest information. */
export function issueLevel(kind: Issue['kind']): NoteLevel {
  return kind === 'unsupported' ? 'warning' : kind === 'behaviour' ? 'info' : 'note';
}

/** A problem in a script for its target shell, with where it is. */
export interface Issue {
  id: string;
  /** `unsupported`: fails in the shell; `behaviour`: works differently; `parse`: zsh-only syntax. */
  kind: 'unsupported' | 'behaviour' | 'parse';
  message: string;
  /** Where it is: the lines and columns the construct, or the syntax error, covers. */
  place: Place;
  /** The construct, for the issues about one (not `parse`). */
  node?: SyntaxNode;
}

export interface Place { startPosition: Point; endPosition: Point }

function featureMessage(id: string, shell: Shell, lang: Lang): string | undefined {
  const s = pick(lang);
  const f = FEATURES[id];
  const label = s(f.ja, f.en);
  const alt = f.altJa ? s(`代わりに ${f.altJa}。`, ` Instead, ${f.altEn}.`) : '';
  if (shell === 'sh') {
    // Name the common /bin/sh implementations it breaks on.
    const fails = (['dash', 'ash'] as RealShell[]).filter((sh) => !works(f, sh)).map((sh) => SHELL_NAMES[sh]);
    return s(
      `⚠ ${label}は POSIX sh にない書き方です${fails.length ? `（${fails.join('・')} では動きません）` : '（dash・busybox ash では動きますが、POSIX にはありません）'}。${alt}`,
      `⚠ ${label} is not POSIX sh${fails.length ? ` (it fails in ${fails.join(' and ')})` : ' (dash and busybox ash accept it, but POSIX does not have it)'}.${alt}`,
    );
  }
  if (shell === 'bash' || works(f, shell)) return undefined;
  return s(`⚠ ${label}は ${SHELL_NAMES[shell]} では使えません。${alt}`, `⚠ ${label} is not available in ${SHELL_NAMES[shell]}.${alt}`);
}

/** What bash `version` does with feature `id`, which came in a later release (SINCE). */
function versionMessage(id: string, version: BashVersion, lang: Lang): string {
  const s = pick(lang);
  const f = FEATURES[id];
  const { version: since, before } = SINCE[id];
  const alt = s(`代わりに ${f.altJa}。`, ` Instead, ${f.altEn}.`);
  return s(`⚠ ${f.ja}は bash ${since} からの書き方です。bash ${version} では${before[0]}。${alt}`, `⚠ ${f.en} is bash ${since} syntax: bash ${version} ${before[1]}.${alt}`);
}

function behaviourMessage(id: string, shell: Shell, lang: Lang): string | undefined {
  const s = pick(lang);
  const b = BEHAVIOURS[id];
  // For POSIX sh, name the common /bin/sh implementations that differ.
  const differ = shell === 'sh' ? (['dash', 'ash'] as RealShell[]).filter((sh) => b.differs.includes(LETTER[sh])) : shell !== 'bash' && b.differs.includes(LETTER[shell]) ? [shell] : [];
  return differ.length ? notePrefix(lang, 'info', 'note', PORTABILITY) + s(b.ja(differ.map((x) => SHELL_NAMES[x]).join('・')), b.en(differ.map((x) => SHELL_NAMES[x]).join(' and '))) : undefined;
}

/** The line and column of an offset in the text. */
function pointAt(text: string, index: number): Point {
  const before = text.slice(0, index);
  return { row: before.split('\n').length - 1, column: index - (before.lastIndexOf('\n') + 1) };
}

/**
 * Where zsh-only syntax may be, in lines [from, to], the first on each line: text the parser could not
 * read, where it left out a token it expected (a place of no width), and words with `*(…)` and the like,
 * which the parser reads as ksh's extended globs but zsh takes as glob qualifiers (`*(.)`, `*(/om)`).
 */
function zshSyntaxPlaces(tree: SyntaxTree, from: number, to: number): Place[] {
  const places: (Place & { index: number })[] = tree.errors.map((e) => ({
    index: e.startIndex, startPosition: pointAt(tree.text, e.startIndex), endPosition: pointAt(tree.text, e.endIndex),
  })).sort((a, b) => a.index - b.index);
  const out: Place[] = [];
  const add = (p: Place): void => {
    if (p.startPosition.row >= from && p.startPosition.row <= to && !out.some((e) => e.startPosition.row === p.startPosition.row)) out.push(p);
  };
  places.forEach(add);
  for (const w of descendants(tree.root, ['word'], { from, to })) if (/(^|[^\\])[?*+@!]\(/.test(w.text)) add(w);
  // Parameter flags, `${(f)var}`: bash reads them as an expansion and reports "bad substitution" only when it runs.
  for (const e of descendants(tree.root, ['expansion'], { from, to })) if (e.text.startsWith('${(')) add(e);
  return out;
}

const ZSH_SYNTAX: [string, string] = [
  'この行には解析できない部分があります。zsh 独自の書き方（グロブ修飾子 `*(.)`、パラメータフラグ `${(f)var}` など）は解説できません。',
  'Part of this line could not be parsed. zsh-only syntax (glob qualifiers like `*(.)`, parameter flags like `${(f)var}`…) is not explained.',
];

/**
 * Problems on lines [from, to] of a script written for `shell`; for bash, the constructs that bash `version` lacks
 * (src/bashversion.ts), and in a version that has `${ …; }`, the ones it does not close (`braceTakenAsWord`).
 */
export function dialectIssues(tree: SyntaxTree, shell: Shell, lang: Lang, from = 0, to = tree.root.endPosition.row, version: BashVersion = DEFAULT_BASH_VERSION): Issue[] {
  if (shell === 'bash') {
    const lacking = collectFeatures(tree.root, from, to).filter((f) => lacks(f.id, version))
      .map((f): Issue => ({ id: f.id, kind: 'unsupported', message: versionMessage(f.id, version, lang), node: f.node, place: f.node }));
    // (Where bash lacks `${ …; }`, the issue above says what it does.)
    const unclosed = lacks('funsub', version) ? [] : descendants(tree.root, ['command_substitution'], { from, to }).flatMap((n): Issue[] => {
      const how = braceTakenAsWord(n);
      const text = how && unclosedBrace(how, substitutionForm(n) === '${' ? '${ …; }' : '${| …; }', true)[lang === 'ja' ? 0 : 1];
      return text ? [{ id: 'funsubBrace', kind: 'unsupported', message: `⚠ ${text}${lang === 'ja' ? '。' : '.'}`, node: n, place: n.children[n.children.length - 1] }] : [];
    });
    return [...lacking, ...unclosed];
  }
  const issues: Issue[] = [];
  if (shell === 'zsh') {
    for (const place of zshSyntaxPlaces(tree, from, to)) {
      issues.push({
        id: 'zshSyntax', kind: 'parse', place, message: ZSH_SYNTAX[lang === 'ja' ? 0 : 1],
      });
    }
  }
  for (const f of collectBehaviours(tree.root, from, to)) {
    const message = behaviourMessage(f.id, shell, lang);
    if (message) issues.push({ id: f.id, kind: 'behaviour', message, node: f.node, place: f.node });
  }
  for (const f of collectFeatures(tree.root, from, to)) {
    const message = featureMessage(f.id, shell, lang);
    if (message) issues.push({ id: f.id, kind: 'unsupported', message, node: f.node, place: f.node });
  }
  return issues;
}

/** Notes for the line: features the target shell lacks, and behaviour that differs. */
export function dialectNotes(tree: SyntaxTree, line: number, shell: Shell, lang: Lang, version?: BashVersion): string[] {
  return [...new Set(dialectFound(tree, line, shell, lang, version).map((f) => f.text))];
}

/** The notes of `dialectNotes`, each with the place of its construct and its issue's id (the note on zsh syntax is about the line: none). */
export function dialectFound(tree: SyntaxTree, line: number, shell: Shell, lang: Lang, version?: BashVersion): { text: string; node?: Place; code?: string }[] {
  const issues = dialectIssues(tree, shell, lang, line, line, version).filter((i) => i.kind !== 'parse');
  // On every line a zsh parse error covers, not only where it starts.
  const parse = shell === 'zsh' && zshSyntaxPlaces(tree, 0, tree.root.endPosition.row).some((e) => e.startPosition.row <= line && e.endPosition.row >= line)
    ? [{ text: ZSH_SYNTAX[lang === 'ja' ? 0 : 1] }] : [];
  return [...parse, ...issues.map((i) => ({ text: i.message, node: i.place, code: i.id }))];
}
