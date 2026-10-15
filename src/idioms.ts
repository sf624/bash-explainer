import { Lang } from './i18n';
import { pick } from './embedded/types';

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
    const fd = r.fd !== '' ? Number(r.fd) : r.op.startsWith('<') ? 0 : 1;
    switch (r.op) {
      case '>&': case '<&':
        if (r.dest === '-') set(fd, s('閉じた状態', 'closed'));
        else if (/^\d+$/.test(r.dest)) {
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

interface Idiom {
  test: RegExp;
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
    test: /^set -[a-zA-Z]*e[a-zA-Z]*u[a-zA-Z]*o pipefail\b|^set -[a-zA-Z]*u[a-zA-Z]*e[a-zA-Z]*o pipefail\b/,
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
    ja: '`: "${VAR:=…}"`: 変数が未設定なら既定値を代入する（`:` は何もしないコマンドで、展開だけを行わせる）',
    en: '`: "${VAR:=…}"`: assigns a default if the variable is unset (`:` does nothing; only the expansion matters)',
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
    test: /^while (true|:); do|^while (true|:)$/,
    ja: '無限ループ（`break` や `exit` で抜ける）',
    en: 'an endless loop (left with `break` or `exit`)',
  },
  {
    test: /\$\(mktemp( -d)?( [^)]*)?\)/,
    ja: '`mktemp`: 他と重ならない一時ファイル（-d ならディレクトリ）を安全に作る',
    en: '`mktemp`: safely creates a unique temporary file (or directory with -d)',
  },
];

/** Notes for the idioms found in the given statements, without duplicates. */
export function findIdioms(statements: string[], lang: Lang): string[] {
  const s = pick(lang);
  const texts = statements.map((stmt) => stmt.replace(/\\\n/g, ' ').replace(/\s+/g, ' ').trim());
  const found = IDIOMS.map((idiom) => texts.some((t) => idiom.test.test(t)));
  return IDIOMS.filter((idiom, i) => found[i] && !(idiom.unless !== undefined && found[idiom.unless]))
    .map((idiom) => s(`定番の書き方: ${idiom.ja}`, `Idiom: ${idiom.en}`));
}
