// The texts of the catalog's facts that were plain notes before (docs/design/sources.md, row 14, SB3a): the order of a
// command's redirections (`redirections-in-order`, `stderr-to-original-stdout`), where a line is (`heredoc-end-line`,
// `heredoc-body-line`, `statement-continued`), and the facts whose words come from a table of their own (an idiom, a
// host's notes, yq's flavour), apart, to keep src/messages.ts short.
import type { Text } from './i18n';
import type { FdTarget, RedirectOrder } from './idioms';
import { codeSpan, shorten } from './label';
import type { Rewrite } from './rewrite';

type Pair = readonly [ja: string, en: string];

const STD: readonly Text[] = [{ ja: '標準入力', en: 'stdin' }, { ja: '標準出力', en: 'stdout' }, { ja: '標準エラー出力', en: 'stderr' }];

/** A descriptor's name: stdin, stdout, stderr, `fd 3`. */
const fdName = (fd: number): Pair => (STD[fd] ? [STD[fd].ja, STD[fd].en] : [`fd ${fd}`, `fd ${fd}`]);

/** Where a descriptor points, in words. */
function targetText(t: FdTarget): Pair {
  switch (t.kind) {
    case 'original': return STD[t.fd] ? [`元の${STD[t.fd].ja}`, `the original ${STD[t.fd].en}`] : [`元の fd ${t.fd}`, `the original fd ${t.fd}`];
    case 'closed': return ['閉じた状態', 'closed'];
    case 'file': return [t.name, t.name];
    case 'heredoc': return t.delimiter ? [`ヒアドキュメント \`${t.delimiter}\``, `the here-document \`${t.delimiter}\``] : ['ヒアドキュメント', 'the here-document'];
    case 'herestring': return ['ヒアストリング', 'the here-string'];
  }
}

const isFile = (t: FdTarget | undefined, name: string): boolean => t?.kind === 'file' && t.name === name;
const isOriginal = (t: FdTarget | undefined, fd: number): boolean => t?.kind === 'original' && t.fd === fd;

/**
 * `redirections-in-order`: where each descriptor points in the end. `piped`: the command writes into a pipe and stderr
 * goes to it while stdout goes elsewhere (`cmd 2>&1 >/dev/null | grep …`): only its error messages go into the pipe.
 */
export function redirectOrderText({ table, piped }: RedirectOrder & { piped?: boolean }): Pair {
  const at = (fd: number) => table.find((e) => e.fd === fd)?.to;
  const result = (i: 0 | 1) => table.map((e) => `${fdName(e.fd)[i]} → ${targetText(e.to)[i]}`).join(i ? ', ' : '、');
  const discarded = isFile(at(1), '/dev/null') && isFile(at(2), '/dev/null');
  const swapped = isOriginal(at(1), 2) && isOriginal(at(2), 1);
  return [
    `リダイレクトは左から順に適用される。最終的に: ${result(0)}${discarded ? '（通常の出力もエラー出力もすべて捨てる）' : ''}${swapped ? '（標準出力と標準エラー出力が入れ替わる）' : ''}${piped ? '（パイプに流れるのはエラー出力だけ）' : ''}`,
    `Redirections apply left to right. In the end: ${result(1)}${discarded ? ' (all output, including errors, is discarded)' : ''}${swapped ? ' (stdout and stderr are swapped)' : ''}${piped ? ' (only the error messages go into the pipe)' : ''}`];
}

/** `stderr-to-original-stdout`: `2>&1` before the redirection of stdout to a file (`dup`, `file`: as written), and the rewrite that swaps them. */
export function stderrFirstText({ dup, file, rewrite: [r] }: { dup: string; file: string; rewrite: readonly Rewrite[] }): Pair {
  return [
    `\`${dup}\` が \`${file}\` より先にあるので、標準エラー出力はファイルではなく元の標準出力に出る。両方をファイルに送るなら ${codeSpan(shorten(r.code, Infinity))} の順に書く`,
    `\`${dup}\` comes before \`${file}\`, so stderr goes to the original stdout, not to the file. To send both to the file, write ${codeSpan(shorten(r.code, Infinity))}`];
}

/** `heredoc-end-line`, `heredoc-body-line`: the line ends a here-document, or is in its body (`operator`: `<<END` as written; `line`: where it starts). */
export const heredocEndText = ({ end, operator, line }: { end: string; operator: string; line: number }): Pair => [
  `\`${end}\` はヒアドキュメント（行 ${line} の \`${operator}\`）の終わりを示す行です。`,
  `\`${end}\` marks the end of the here-document started by \`${operator}\` on line ${line}.`];
export const heredocBodyText = ({ operator, line }: { operator: string; line: number }): Pair => [
  `この行はヒアドキュメント（行 ${line} の \`${operator}\`）の本文です。`,
  `This line is part of the here-document started by \`${operator}\` on line ${line}.`];
/** `statement-continued`: the statement started on an earlier line. */
export const continuedText = ({ line }: { line: number }): Pair => [
  `この文は行 ${line} から続いています（行末の \`\\\` による行継続など）。`,
  `This statement starts on line ${line} (e.g. continued with a trailing \`\\\`).`];

/** `idiom`: an idiom of src/idioms.ts (`IDIOMS`), its words from there. */
export const idiomText = ({ idiom }: { idiom: Text }): Pair => [`定番の書き方: ${idiom.ja}`, `Idiom: ${idiom.en}`];

/** `host-substitution`: what a host's substitution in the shell code means (`$(CC)`, `${{ … }}`; src/hosts/). */
export const hostSubstitutionText = ({ text, meaning }: { text: string; meaning: Text }): Pair => [
  `\`${text}\` は${/^[A-Za-z]/.test(meaning.ja) ? ' ' : ''}${meaning.ja}。`, `\`${text}\` is ${meaning.en}.`];

/** `github-file`: a variable that holds the path of a file GitHub Actions provides (`$GITHUB_OUTPUT`). */
export const githubFileText = ({ name, what }: { name: string; what: Text }): Pair => [
  `\`$${name}\` は GitHub Actions が用意するファイルのパスです。${what.ja}。`, `\`$${name}\` is the path of a file GitHub Actions provides: ${what.en}.`];

/** `read-ifs-separators`: `read` with an IFS of separators that are not whitespace (`ifs`, `seps`: as bash reads them, `$'\x1b'`). */
export const readSeparatorsText = ({ ifs, seps }: { ifs: string; seps: readonly string[] }): Pair => {
  const shown = (sep: string) => seps.map((c) => `\`${c}\``).join(sep);
  return [
    `\`IFS=${ifs}\` の \`read\`: 空白以外の区切り文字（${shown('、')}）が続くと、間の空のフィールドもそのまま残る（空白の区切りは続いても1つにまとまる）。末尾の区切り文字の後ろには空のフィールドはできない`,
    `\`read\` with \`IFS=${ifs}\`: a separator that is not whitespace (${shown(', ')}) keeps the empty field between two of them (whitespace separators merge into one); a separator at the end of the line adds no empty field after it`];
};

/** The notes a host file's region carries (src/hosts/): the code of a Dockerfile, a Jenkinsfile, a Python call. */
export const HOST_NOTES = {
  'dockerfile-onbuild': [
    'ONBUILD の命令は、このイメージをもとにする別のイメージのビルドで（その FROM の直後に）実行されます。',
    'An ONBUILD instruction runs later, in the build of another image FROM this one (just after its FROM).'],
  'dockerfile-healthcheck': [
    'HEALTHCHECK は、動いているコンテナの中でこのコマンドを実行して状態を調べます。終了ステータス 0 は正常（healthy）、1 は異常（unhealthy）です（2 は予約されていて使いません）。',
    'HEALTHCHECK runs this command in the running container to check its health: exit status 0 is healthy, 1 unhealthy (2 is reserved).'],
  'dockerfile-shell': [
    '以降の RUN・CMD・ENTRYPOINT・HEALTHCHECK のシェル形式は、このコマンドの最後に命令の内容を付けて実行されます（例: `/bin/bash -o pipefail -c "<RUN の内容>"`）。',
    'Later shell-form RUN, CMD, ENTRYPOINT and HEALTHCHECK instructions run with this command, followed by their text (e.g. `/bin/bash -o pipefail -c "<RUN text>"`).'],
  'jenkinsfile-groovy-interpolation': [
    '二重引用符の文字列では、`$名前` や `${…}` をシェルより先に Groovy が埋め込みます。シェルの変数として使うには `\\$HOME` のようにエスケープするか、単一引用符（`\'…\'`、`\'\'\'…\'\'\'`）にします。',
    'In a double-quoted string, Groovy fills in `$name` and `${…}` before the shell runs. To use a shell variable, escape it (`\\$HOME`) or use single quotes (`\'…\'`, `\'\'\'…\'\'\'`).'],
  'python-shell-list': [
    'shell=True にリストを渡すと、最初の要素だけがシェルのコマンドになり、残りの要素はシェルへの引数（$0, $1…）になります。',
    'With shell=True and a list, only the first item is the shell command; the other items become arguments of the shell ($0, $1…).'],
  'python-exec-list': [
    'リストで渡した引数はシェルを通さずにそのまま実行されます。`$VAR` の展開・パイプ・リダイレクト・`&&` などは働きません（値を安全に渡せる書き方です）。',
    'A list of arguments is run directly, without a shell: `$VAR`, pipes, redirections and `&&` do not work (the safe way to pass values).'],
  'python-shell-expression': [
    'shell= の値が式なので、この文字列をシェルが実行するかは実行時に決まります。', 'shell= is an expression, so whether a shell runs this string is decided at run time.'],
  'python-string-partial': [
    '文字列の後ろは Python のコードで組み立てられるため、解説しているのは文字列リテラルの部分だけです。', 'The rest of the string is built by Python code; only the string literal is explained.'],
  'dockerfile-exec-form': [
    'exec 形式（`[...]`）はシェルを通さずにコマンドを直接実行します。`$VAR` の展開・パイプ・リダイレクト・`&&` などは働かず、各要素がそのまま引数になります。',
    'The exec form (`[...]`) runs the command directly, without a shell: `$VAR`, pipes, redirections and `&&` do not work, and each element is passed as it is.'],
  'yaml-folded-block': [
    'YAML の折り畳みブロック（`>`）は、同じ字下げで隣り合う行をスペースでつなぎます。シェルはつながった 1 行を受け取ります。ここではつなぎ目を ` \\` と改行として読むので、単一引用符の中と `#` のコメントの後では YAML と読み方が違います（YAML はつないだ次の行も文字列やコメントに含めます）。',
    'A YAML folded block (`>`) joins lines next to each other at the same indentation with a space: the shell gets them as one line. Here each join is read as ` \\` and a line break, which differs from YAML inside single quotes and after a `#` comment (YAML takes the joined line into the string or the comment).'],
} as const satisfies Record<string, Pair>;
