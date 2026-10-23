import { Lang } from './i18n';
import { pick } from './embedded/types';
import { descendants, field } from './syntax/tree';
import type { SyntaxNode } from './syntax/tree';

export interface Redirect {
  op: string;
  /** Explicit file descriptor, or '' for the operator's default. */
  fd: string;
  dest: string;
}

/**
 * Apply redirections left to right, as bash does, and describe where each file descriptor ends
 * up. Only returned when the order matters (several redirections including a duplication).
 */
export function simulateRedirects(redirs: Redirect[], lang: Lang): string | undefined {
  const s = pick(lang);
  if (redirs.length < 2 || !redirs.some((r) => r.op === '>&' || r.op === '<&')) return undefined;
  const orig = (fd: number) => [s('元の標準入力', 'the original stdin'), s('元の標準出力', 'the original stdout'), s('元の標準エラー出力', 'the original stderr')][fd] ?? s(`元の fd ${fd}`, `the original fd ${fd}`);
  const table = new Map<number, string>([[0, orig(0)], [1, orig(1)], [2, orig(2)]]);
  const touched: number[] = [];
  const set = (fd: number, to: string) => {
    table.set(fd, to);
    if (!touched.includes(fd)) touched.push(fd);
  };
  let pitfall = false;
  redirs.forEach((r, idx) => {
    // `{name}>…` takes a free descriptor of its own (10 or higher), which this table of the first ones leaves out.
    if (/^\{.*\}$/.test(r.fd)) return;
    const fd = r.fd !== '' ? Number(r.fd) : r.op.startsWith('<') ? 0 : 1;
    switch (r.op) {
      case '>&': case '<&':
        if (r.dest === '-') set(fd, s('閉じた状態', 'closed'));
        else if (/^\d+-$/.test(r.dest)) {
          // `n>&m-` moves m to n: a copy, then m is closed.
          const from = Number(r.dest.slice(0, -1));
          set(fd, table.get(from) ?? orig(from));
          set(from, s('閉じた状態', 'closed'));
        } else if (/^\d+$/.test(r.dest)) {
          set(fd, table.get(Number(r.dest)) ?? orig(Number(r.dest)));
          // `2>&1 >file`: stderr copied stdout before stdout was redirected.
          if (fd === 2 && r.dest === '1' && redirs.slice(idx + 1).some((later) => (later.fd === '' || later.fd === '1') && /^>>?$|^>\|$/.test(later.op))) pitfall = true;
        } else {
          set(1, r.dest);
          set(2, r.dest);
        }
        break;
      case '&>': case '&>>':
        set(1, r.dest);
        set(2, r.dest);
        break;
      case '<<': case '<<-': case '<<<':
        set(0, s('ヒアドキュメント／文字列', 'the here-document/string'));
        break;
      default:
        set(fd, r.dest);
    }
  });
  if (!touched.length) return undefined;
  const name = (fd: number) => [s('標準入力', 'stdin'), s('標準出力', 'stdout'), s('標準エラー出力', 'stderr')][fd] ?? `fd ${fd}`;
  const result = touched.sort((a, b) => a - b).map((fd) => `${name(fd)} → ${table.get(fd)}`).join(s('、', ', '));
  let text = s(`リダイレクトは左から順に適用される。最終的に: ${result}`, `Redirections apply left to right. In the end: ${result}`);
  if (table.get(1) === '/dev/null' && table.get(2) === '/dev/null') {
    text += s('（通常の出力もエラー出力もすべて捨てる）', ' (all output, including errors, is discarded)');
  }
  if (table.get(1) === orig(2) && table.get(2) === orig(1)) {
    text += s('（標準出力と標準エラー出力が入れ替わる）', ' (stdout and stderr are swapped)');
  }
  if (pitfall) {
    text += s(
      '。注意: `2>&1` がファイルへのリダイレクトより先にあるので、標準エラー出力はファイルではなく元の標準出力に出る（両方をファイルに送るなら `>file 2>&1` の順にする）',
      '. Note: `2>&1` comes before the file redirection, so stderr goes to the original stdout, not the file (write `>file 2>&1` to send both)',
    );
  }
  return text;
}

/** Whether one `set` command turns errexit, nounset and pipefail all on, however the options are written (`-euo`, `-eou`, `-o pipefail -eu`, `-e -u -o pipefail`, `-o errexit -o nounset -o pipefail`…). */
export function isStrictMode(text: string): boolean {
  const words = text.split(/[;&|]/)[0].trim().split(' ');
  if (words[0] !== 'set') return false;
  const on = new Set<string>();
  const short: Record<string, string> = { e: 'errexit', u: 'nounset' };
  const set = (name: string, sign: string) => { if (sign === '-') on.add(name); else on.delete(name); };
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (!/^[-+][a-zA-Z]+$/.test(w)) break;
    // As in bash, each `o` of a bundle takes the next word as an option name, and the other letters still apply.
    for (const letter of w.slice(1)) {
      if (letter === 'o') {
        if (i + 1 < words.length) set(words[++i], w[0]);
      } else if (short[letter]) set(short[letter], w[0]);
    }
  }
  return on.has('errexit') && on.has('nounset') && on.has('pipefail');
}

/** A statement's shape in the tree, for the idioms that are not a matter of its spelling (`while  true ; do`). */
interface Shape { node: (n: SyntaxNode) => boolean }

const nameOf = (c: SyntaxNode | null | undefined): string | undefined => (c?.type === 'command' ? field(c, 'name')?.text : undefined);
// (`until` is a `while_statement` too, with that keyword first.)
const whileOf = (n: SyntaxNode): SyntaxNode | undefined => (n.type === 'while_statement' && n.children[0].type === 'while' ? n : undefined);
/** `while true`, `while :`: a loop whose only condition is that command. */
const endless = (n: SyntaxNode): boolean => {
  const w = whileOf(n);
  const c = w && field(w, 'condition');
  return !!c && c.type === 'command' && ['true', ':'].includes(nameOf(c)!) && c.namedChildren.length === 1;
};
/** `while … read … done < file` (`process`: `< <(command)`): the loop is redirected, and a command in it reads. */
const readLoop = (process: boolean) => (n: SyntaxNode): boolean => {
  const body = n.type === 'redirected_statement' ? field(n, 'body') : undefined;
  if (body?.type !== 'while_statement') return false;
  const redirects = n.namedChildren.filter((c) => c.type === 'file_redirect');
  const r = redirects.length === 1 ? redirects[0] : undefined;
  if (!r || !/^<(?!<)/.test(r.text) || (field(r, 'destination')?.type === 'process_substitution') !== process) return false;
  return descendants(body, ['command']).some((c) => nameOf(c) === 'read');
};
const loopCommand = (name: string) => (n: SyntaxNode): boolean => {
  const w = whileOf(n);
  return nameOf(w && field(w, 'condition')) === name;
};
/** `while [ $# -gt 0 ]`, `while (( $# ))`: a loop over the arguments. */
const argsLoop = (n: SyntaxNode): boolean => {
  const c = whileOf(n) && field(n, 'condition');
  return !!c && /^(\[\[? "?\$#"? (-gt 0|-ne 0|!= 0|> 0) \]\]?|\(\( ?\$# ?(> ?0)? ?\)\))$/.test(c.text.replace(/\s+/g, ' ').trim());
};

interface Idiom {
  test: RegExp | ((text: string) => boolean) | Shape;
  ja: string;
  en: string;
  /** Not reported when this other idiom (by index) is found, e.g. a `cd` that is part of a larger idiom. */
  unless?: number;
}

/** Well-known patterns, matched against a statement's text with whitespace collapsed. */
const IDIOMS: Idiom[] = [
  {
    test: /\bIFS=(''|"")? read (-[a-zA-Z]* )*-[a-zA-Z]*r/,
    ja: '`IFS= read -r`: 1行を加工せずそのまま読む（`IFS=` で前後の空白を取り除かせず、`-r` でバックスラッシュをそのまま残す）',
    en: '`IFS= read -r`: reads a line exactly as is (`IFS=` keeps surrounding spaces, `-r` keeps backslashes)',
  },
  {
    test: /\$\(cd "?\$\(dirname "?\$(\{BASH_SOURCE(\[0\])?\}|BASH_SOURCE|0|\{0\})"?\)"? (&&|;) pwd( -P)?\)/,
    ja: 'スクリプトが置かれているディレクトリの絶対パスを得る（どこから実行しても同じ場所を指せる）',
    en: 'gets the absolute path of the directory the script lives in (the same wherever it is run from)',
  },
  {
    test: /^cd "?\$\(dirname "?\$(\{BASH_SOURCE(\[0\])?\}|BASH_SOURCE|0|\{0\})"?\)"?/,
    unless: 1,
    ja: 'スクリプトが置かれているディレクトリに移動する（どこから実行しても相対パスが同じように使える）',
    en: 'moves to the directory the script lives in (so relative paths work wherever it is run from)',
  },
  {
    test: /\b(command -v|type -P|which|hash) \S+ (>\s*\/dev\/null 2>&1|&>\s*\/dev\/null|>\/dev\/null 2>&1)/,
    ja: 'コマンドがインストールされているかを、出力を出さずに確かめる',
    en: 'checks quietly whether a command is installed',
  },
  {
    test: /\[\[? "?\$\{?BASH_SOURCE(\[0\])?\}?"? (==?|-ef) "?\$\{?0\}?"? \]\]?/,
    ja: 'スクリプトが直接実行されたか（`source` で読み込まれたのではないか）を判定する（Python の `if __name__ == "__main__"` に相当）',
    en: 'checks whether the script is run directly rather than sourced (like Python\'s `if __name__ == "__main__"`)',
  },
  {
    test: isStrictMode,
    ja: '安全なスクリプトのための定番設定（strict mode）: エラーで止まる、未定義の変数をエラーにする、パイプの途中の失敗も見逃さない',
    en: 'the usual "strict mode": stop on errors, treat unset variables as errors, and catch failures inside pipelines',
  },
  {
    test: /^: "?\$\{\w+:?\?/,
    ja: '`: "${VAR:?…}"`: 必須の変数が設定されているか確かめる（未設定ならメッセージを出して終了。`:` は何もしないコマンド）',
    en: '`: "${VAR:?…}"`: checks that a required variable is set (exits with the message if not; `:` does nothing itself)',
  },
  {
    test: /^: "?\$\{\w+:?=/,
    ja: '`: "${VAR:=…}"`: 変数が未設定か空なら既定値を代入する（`:=` の場合。`=` だけなら未設定のときだけ。`:` は何もしないコマンドで、展開だけを行わせる）',
    en: '`: "${VAR:=…}"`: assigns a default if the variable is unset or empty (with `:=`; plain `=` only when unset; `:` does nothing, only the expansion matters)',
  },
  {
    test: /\|\| (true|:)$/,
    ja: '`|| true`: 失敗しても終了ステータスを成功にする（`set -e` でスクリプトが止まらないようにする）',
    en: '`|| true`: turns a failure into success (so `set -e` does not stop the script)',
  },
  {
    test: /^trap .+ EXIT\b/,
    ja: '`trap … EXIT`: スクリプトがどう終わっても（エラーでも）最後に後片付けを実行する',
    en: '`trap … EXIT`: runs clean-up when the script exits, however it exits',
  },
  {
    test: /^exec (> >\(tee|&> >\(tee|> >\(logger)/,
    ja: '以降のすべての出力を画面に出しつつ、ログにも保存する',
    en: 'from here on, everything printed also goes to a log',
  },
  {
    test: { node: endless },
    ja: '無限ループ（`break` や `exit` で抜ける）',
    en: 'an endless loop (left with `break` or `exit`)',
  },
  {
    test: /\$\(mktemp( -d)?( [^)]*)?\)/,
    ja: '`mktemp`: 他と重ならない一時ファイル（-d ならディレクトリ）を安全に作る',
    en: '`mktemp`: safely creates a unique temporary file (or directory with -d)',
  },
  {
    test: { node: readLoop(false) },
    ja: '`while read … done < ファイル`: ファイルを1行ずつ読んで処理する（ループ全体の標準入力がそのファイルになる）。最後の行の末尾に改行がないと、その行は読まれずに終わる（`while read -r line || [ -n "$line" ]` とすれば読める）',
    en: '`while read … done < file`: reads a file line by line (the file is the stdin of the whole loop). A last line with no newline at its end is skipped, unless the loop is `while read -r line || [ -n "$line" ]`',
  },
  {
    test: { node: readLoop(true) },
    ja: '`while read … done < <(コマンド)`: コマンドの出力を1行ずつ読んで処理する。`コマンド | while read …` と違い、ループがカレントシェルで動くので、中で代入した変数がループのあとも残る。最後の行の末尾に改行がないと、その行は読まれずに終わる（`|| [ -n "$line" ]` を足せば読める）',
    en: '`while read … done < <(command)`: reads the output of a command line by line. Unlike `command | while read …`, the loop runs in the current shell, so variables set in it are still there after the loop. A last line with no newline at its end is skipped, unless `|| [ -n "$line" ]` is added',
  },
  {
    test: { node: loopCommand('getopts') },
    ja: '`while getopts`: 短いオプション（`-a`、値つきの `-b 値`）を1つずつ読む。オプションの文字は変数に、値は `$OPTARG` に入る。最初のオプションでない語で読み取りが止まるので、オプションは引数より前に置く',
    en: '`while getopts`: reads short options (`-a`, `-b value`) one at a time: the letter goes to the variable, the value to `$OPTARG`. It stops at the first word that is not an option, so options must come before the operands',
  },
  {
    test: /^shift "?\$\(\( ?OPTIND ?- ?1 ?\)\)"?/,
    ja: '`shift $((OPTIND-1))`: `getopts` で読み終えたオプションを取り除き、`$1` を最初の引数にする。関数の中で `getopts` を使うなら、先に `local OPTIND=1` としておく（さもないと2回目の呼び出しが前回の続きから始まり、何も読まない）',
    en: '`shift $((OPTIND-1))`: drops the options `getopts` has read, so `$1` is the first operand. In a function that uses `getopts`, set `local OPTIND=1` first, or a second call starts where the first stopped and reads nothing',
  },
  {
    test: { node: loopCommand('getopt') },
    ja: '`getopt`（`s` なし）は組み込みの `getopts` とは別の外部コマンドで、整えた引数を表示して終わる。1つずつ読むループにはならない（組み込みは `getopts`）',
    en: '`getopt` (no `s`) is an external program, not the builtin `getopts`: it prints the rewritten arguments and exits, so it cannot drive a loop that reads one option at a time (the builtin is `getopts`)',
  },
  {
    test: /\$\(getopt .*"\$@"\)/,
    ja: '`getopt`（GNU/util-linux）: 引数を整えた形に書き直す（`-ab` は `-a -b` に、`--long=値` は `--long 値` に分け、最後に `--` を付ける）。あとの `case` が `$1` だけ見ればよくなる。終了ステータスを見ること（不正なオプションなら失敗する）。`local args=$(getopt …)` では失敗が隠れる',
    en: '`getopt` (GNU/util-linux): rewrites the arguments into a fixed form (`-ab` becomes `-a -b`, `--long=v` becomes `--long v`, and `--` ends them), so a `case` only has to look at `$1`. Check its exit status (it fails on a bad option); `local args=$(getopt …)` hides the failure',
  },
  {
    test: /^eval set -- /,
    ja: '`eval set -- "$args"`: `getopt` が整えた引数（クォート済み）を、このスクリプトの位置パラメータ `$1 $2 …` に入れ直す。`"$args"` は必ずダブルクォートで囲む',
    en: '`eval set -- "$args"`: puts the arguments that `getopt` rewrote (and quoted) back into `$1 $2 …`. Keep `"$args"` in double quotes',
  },
  {
    test: { node: argsLoop },
    ja: '引数を先頭から順に読むループ（ふつうは `case` で `$1` を調べ、最後に `shift` で1つ進める）。値をとるオプションは `shift 2` が要る。`shift` を忘れると、ループが終わらない',
    en: 'a loop over the arguments (usually a `case` on `$1`, then `shift` to move on). An option that takes a value needs `shift 2`; without any `shift` the loop never ends',
  },
  {
    test: /\bread (-\w+ )*-\w*d ?(''|"")/,
    ja: '`read -d \'\'`: NUL（バイト 0）までを1項目として読む。`find -print0` と組み合わせると、空白や改行を含む名前も安全に扱える。区切りは `-d \'\'` と書く（`-d \'\\0\'` では区切りが `\\` になり、何も読めない）',
    en: '`read -d \'\'`: reads up to a NUL byte as one item. With `find -print0`, names containing spaces or newlines are safe. Write the delimiter as `-d \'\'` (`-d \'\\0\'` makes `\\` the delimiter, and nothing is read)',
  },
  {
    test: /\bfind .* -print0\b/,
    ja: '`find -print0`: 名前を改行でなく NUL で区切って出力する。受け取る側も NUL を読むこと（`xargs -0`、`read -d \'\'`）。改行区切りのままだと、空白や改行を含む名前が壊れる',
    en: '`find -print0`: separates the names with a NUL byte instead of a newline. The reader must read NUL too (`xargs -0`, `read -d \'\'`); with newlines, names containing spaces or newlines break',
  },
  {
    test: /\bxargs (-[^\s0]\S*( [^-\s]\S*)? )*(-0\S*|--null)( |$)/,
    ja: '`xargs -0`: 入力を NUL 区切りで読む（`find -print0` と組み合わせる）。付けないと、空白やクォートを含む名前が分割されたり壊れたりする',
    en: '`xargs -0`: reads its input separated by NUL bytes (pair it with `find -print0`). Without it, names with spaces or quotes are split or mangled',
  },
  {
    test: /^until /,
    ja: '`until コマンド`: コマンドが失敗する間、くり返す（成功したら止まる。`while` の逆）。何かの準備ができるのを待つときに使う。回数や時間の上限がないと、永久に終わらないことがある',
    en: '`until command`: repeats while the command fails and stops when it succeeds (the opposite of `while`). Used to wait for something to be ready. With no limit on tries or time, it can run forever',
  },
  {
    test: /(^|[|&;] ?)(mapfile|readarray)( |$)/,
    ja: '`mapfile`（`readarray`）: 入力の各行を配列の要素に入れる。`-t` で行末の改行を取り除く（付けないと各要素が改行で終わる）。`コマンド | mapfile` は配列が消える（サブシェルで動く）ので、`mapfile -t 配列 < <(コマンド)` と書く',
    en: '`mapfile` (`readarray`): reads each line of the input into an array element. `-t` strips the trailing newline (without it, each element ends with one). `command | mapfile` loses the array (it runs in a subshell); write `mapfile -t arr < <(command)`',
  },
  {
    test: /^\[\[? -[ef] "?\$\{?\w+\}?"? \]\]? \|\| continue$/,
    ja: '存在しない名前を飛ばす。`for f in *.txt` で何にも一致しないと、bash は `*.txt` をそのまま残し、ループが存在しない名前で1回まわる。その対策（`shopt -s nullglob` でも防げる）',
    en: 'skips a name that does not exist. When `for f in *.txt` matches nothing, bash keeps `*.txt` as it is and the loop runs once with that text. This guards against it (`shopt -s nullglob` does too)',
  },
  {
    test: /\bread (-\w+ )*-\w*p ?(['"]).*\b[yY](es)?\/[nN](o)?\b/,
    ja: 'はい／いいえの確認。`[y/N]` の大文字は、Enter だけのときの既定値という慣習で、空の答えをその既定値として扱うのは続くコードの役目。`-p` の表示は、標準入力が端末のときだけ出る',
    en: 'a yes/no question. The capital letter in `[y/N]` is only a convention for the default on a bare Enter: the code after it must treat an empty answer that way. The `-p` prompt is shown only when stdin is a terminal',
  },
];

/** Notes for the idioms found in the given statements, without duplicates. */
export function findIdioms(statements: readonly SyntaxNode[], lang: Lang): string[] {
  const s = pick(lang);
  // (A loop's text is its first line: its body is other statements.)
  const texts = statements.map((n) => (n.type === 'while_statement' ? n.text.split('\n')[0] : n.text).replace(/\\\n/g, ' ').replace(/\s+/g, ' ').trim());
  const found = IDIOMS.map((idiom) => statements.some((n, i) => (typeof idiom.test === 'function' ? idiom.test(texts[i]) : 'node' in idiom.test ? idiom.test.node(n) : idiom.test.test(texts[i]))));
  return IDIOMS.filter((idiom, i) => found[i] && !(idiom.unless !== undefined && found[idiom.unless]))
    .map((idiom) => s(`定番の書き方: ${idiom.ja}`, `Idiom: ${idiom.en}`));
}
