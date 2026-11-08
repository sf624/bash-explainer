import { broken, type Catalog, failure, note, saying } from './messages-entry';

// The catalog's facts on bats test files (src/bats.ts): bash's side of what bats does. Spread into `MESSAGES`
// (src/messages.ts).

export const BATS_MESSAGES = {
  'bats-test': note(['3.3', '4.3.1'], () => [
    'bats はテストを1つずつ別のプロセスで、`set -e` を有効にして実行する。途中のコマンドが失敗するとそこでテストは失敗し（`set -e` が無視される所、つまり条件・`&&` や `||` の左側・`!` のあとを除く）、最後のコマンドが失敗しても失敗する。テストで設定した変数は、ほかのテストには届かない。各プロセスはまずファイル全体を読み込むので、テストの外のコードはテストごとに実行される',
    'bats runs each test in a process of its own, with `set -e` on: a command that fails stops the test and fails it (except where `set -e` is ignored: in a condition, on the left of `&&` or `||`, after `!`), and so does a last command that fails. What a test sets does not reach the other tests. Each process first reads the whole file, so the code outside the tests runs again for each test']),
  // (`text`: the line is in a string or a here-document, where bash reads it as text; bats reads every line.)
  'bats-tags': note<{ scope: 'test' | 'file'; tags: readonly string[]; text?: 'string' | 'heredoc' }>(['3.1.3'], ({ scope, tags, text }) => {
    const list = tags.map((t) => `\`${t}\``).join(', ');
    const focus = tags.includes('bats:focus');
    return [
      (text === 'string' ? 'bash にとっては文字列の中の文字で、コマンドではない' : text === 'heredoc' ? 'bash にとってはヒアドキュメントの中の文字で、コマンドではない' : 'bash にとってはコメントで、無視される')
        + `。bats がこの行を読み、${scope === 'file' ? 'このファイルのこれ以降のすべてのテスト' : tags.length ? '次のテストだけ' : '次のテスト'}に${tags.length ? `タグ ${list} を付ける` : 'タグを付けない（空のリスト）'}`
        + (scope === 'file' ? (tags.length ? '（あとの `# bats file_tags=` が置き換える）' : '（前の `file_tags` を無効にする）')
          : tags.length ? '（同じテストの前にあとの `# bats test_tags=` の行があると、そちらが置き換える。そのあとのテストには付かない）' : '（同じテストの前の `test_tags` を無効にする）')
        + (tags.length ? '。`bats --filter-tags タグ` で、タグでテストを選んで実行できる' : '')
        + (focus ? '。`bats:focus` が付いたテストがあると、bats はそのテストだけを実行し、成功しても終了ステータスを 1 にする（`BATS_NO_FAIL_FOCUS_RUN=1` で 0 にできる）' : ''),
      (text === 'string' ? 'to bash this line is text of a string, not a command' : text === 'heredoc' ? 'to bash this line is text of a here-document, not a command' : 'to bash this is a comment, and it is ignored')
        + `. bats reads the line and gives ${scope === 'file' ? 'every later test of the file' : tags.length ? 'the next test only' : 'the next test'} ${tags.length ? `the ${tags.length > 1 ? 'tags' : 'tag'} ${list}` : 'no tags (an empty list)'}`
        + (scope === 'file' ? (tags.length ? ' (a later `# bats file_tags=` replaces them)' : ' (it cancels an earlier `file_tags`)')
          : tags.length ? ' (a later `# bats test_tags=` line before the same test replaces them; the tests after it do not get them)' : ' (it cancels an earlier `test_tags` before the same test)')
        + (tags.length ? '; `bats --filter-tags TAGS` runs only the tests with the tags given' : '')
        + (focus ? '. When a test has `bats:focus`, bats runs only the focused tests, and exits with status 1 even if they pass (`BATS_NO_FAIL_FOCUS_RUN=1` keeps 0)' : '')];
  }),
  'bats-tags-invalid': failure<{ scope: 'test' | 'file'; why: 'empty' | 'syntax' }>(['3.1.3'], ({ scope, why }) => [
    `\`${scope}_tags\` の書き方が正しくないので、bats はこのファイルのテストを1つも実行せずに失敗する。タグは英数字・\`-\`・\`_\`・\`:\` だけで書き、コンマ（前後の空白は可）で区切る。`
      + (why === 'empty' ? '先頭のコンマや、空白だけのリストで、空のタグができている（タグを付けないなら、`=` のあとに何も書かない）' : '空のタグ（`a,,b` や末尾のコンマ）や、空白や記号を含むタグは書けない'),
    `The \`${scope}_tags\` list is not valid, so bats runs none of the tests of this file and fails. Tags are letters, digits, \`-\`, \`_\` and \`:\`, separated by commas (spaces around them are fine). `
      + (why === 'empty' ? 'A leading comma, or a list of only spaces, makes an empty tag (for no tags, nothing follows the `=`)' : 'An empty tag (`a,,b`, a trailing comma) and a tag with a space or another character are errors')],
    ({ scope }) => [`\`${scope}_tags\` の書き方が正しくないので、bats はこのファイルのテストを1つも実行しない。`, `The \`${scope}_tags\` list is not valid, so bats runs none of the tests of this file.`]),
  // (bats-preprocess matches `name() { # @test` anywhere on the line, and replaces the whole line.)
  'bats-test-line-dropped': broken<{ dropped: string }>(['3.3'], ({ dropped }) => [
    `bats はこの行全体をテストの関数の定義に置き換えるので、関数名の前の \`${dropped}\` は実行されません。別の行に書きます`,
    `bats replaces this whole line with the definition of the test, so \`${dropped}\` before the function's name never runs. Put it on a line of its own`],
    ({ dropped }) => [`関数名より前の \`${dropped}\` は実行されない。`, `\`${dropped}\` before the function's name never runs.`]),
  'bats-negation-ignored': saying(broken<{ cmd: string; form: 'command' | 'pipeline' | 'other' }>(['4.3.1', '3.2.3'], ({ cmd, form }) => [
    `\`set -e\` は \`!\` のあとのコマンドの結果を無視するので、\`! ${cmd}\` はテストの最後のコマンドでない限り、\`${cmd}\` が成功してもテストを失敗させません。`
      + (form === 'command' ? `\`run ! ${cmd}\`（bats 1.5.0 から。\`bats_require_minimum_version 1.5.0\` と書く）か \`! ${cmd} || false\` と書きます`
        : form === 'pipeline' ? `\`! ${cmd} || false\` と書くか、パイプラインを \`run ! bats_pipe …\` で実行します（\`|\` は \`\\|\` と書く。bats 1.10.0 から）`
        : `\`! ${cmd} || false\` と書きます`),
    `\`set -e\` ignores the status of a command after \`!\`, so unless it is the last command of the test, \`! ${cmd}\` does not fail the test when \`${cmd}\` succeeds. `
      + (form === 'command' ? `Write \`run ! ${cmd}\` (since bats 1.5.0, with \`bats_require_minimum_version 1.5.0\`) or \`! ${cmd} || false\``
        : form === 'pipeline' ? `Write \`! ${cmd} || false\`, or run the pipeline with \`run ! bats_pipe …\`, each \`|\` written \`\\|\` (since bats 1.10.0)`
        : `Write \`! ${cmd} || false\``)],
    ({ cmd }) => [`テストの最後でない限り、\`${cmd}\` が成功しても \`! ${cmd}\` はテストを失敗させない。`, `Unless it is the last command, \`! ${cmd}\` does not fail the test when \`${cmd}\` succeeds.`]), 'errexit'),
  'bats-run-in-pipeline-stage': broken<{ cmd: string }>(['3.2.3', '3.7.3'], ({ cmd }) => [
    `パイプラインのコマンドはサブシェルで実行されるので、\`run ${cmd}\` が設定した \`$status\` と \`$output\` はパイプラインが終わると消えます。パイプライン全体を \`run\` で実行するには \`run bats_pipe … \\| ${cmd}\` か \`run bash -c '… | …'\` と書きます`,
    `the commands of a pipeline run in subshells, so the \`$status\` and \`$output\` that \`run ${cmd}\` sets are gone when the pipeline ends. To run the whole pipeline under \`run\`, write \`run bats_pipe … \\| ${cmd}\` or \`run bash -c '… | …'\``],
    ({ cmd }) => [`\`run ${cmd}\` が設定した \`$status\` と \`$output\` は、パイプラインが終わると消える。`, `The \`$status\` and \`$output\` of \`run ${cmd}\` are gone when the pipeline ends.`]),
  'bats-run-in-pipeline': broken<{ cmd: string }>(['3.2.3'], ({ cmd }) => [
    `パイプは \`run\` の出力を受け取りますが、\`run\` は \`${cmd}\` の出力を \`$output\` に入れるだけで何も出力しません。また、パイプラインのコマンドはサブシェルで実行されるので、\`run\` が設定した \`$status\` と \`$output\` はパイプラインが終わると消えます。パイプライン全体を \`run\` で実行するには \`run bats_pipe ${cmd} \\| …\` か \`run bash -c '… | …'\` と書きます`,
    `the pipe gets the output of \`run\`, but \`run\` writes nothing: it keeps the output of \`${cmd}\` in \`$output\`. And the commands of a pipeline run in subshells, so the \`$status\` and \`$output\` that \`run\` sets are gone when the pipeline ends. To run the whole pipeline under \`run\`, write \`run bats_pipe ${cmd} \\| …\` or \`run bash -c '… | …'\``],
    ({ cmd }) => [`\`run\` は \`${cmd}\` の出力を \`$output\` に入れるので、パイプには何も流れない。`, `\`run\` keeps the output of \`${cmd}\` in \`$output\`, so the pipe gets nothing.`]),
  // (The hooks bats calls: libexec/bats-core/bats-exec-test and bats-exec-file of bats-core 1.13.)
  'bats-hook': note<{ name: string; when: 'before' | 'after' | 'file-before' | 'file-after' }>(['3.3', '4.3.1'], ({ name, when }) => (when === 'before' ? [
    `bats は \`${name}\` を各テストの前に、そのテストのプロセスで呼ぶ。ここで設定した変数はテストに届く。\`set -e\` が有効なので、失敗したコマンドがあるとそこで止まり、テストは実行されずに失敗する`,
    `bats calls \`${name}\` before each test, in the test's own process: what it sets, the test sees. \`set -e\` is on, so a command that fails stops it there, and the test fails without running`]
    : when === 'after' ? [
      `bats は \`${name}\` を各テストの後に、そのテストのプロセスで呼ぶ（テストが失敗したときも）。\`${name} || …\` の形で呼ぶので、中では \`set -e\` が無視され、途中のコマンドが失敗しても止まらない。テストが失敗するのは、\`${name}\` が 0 以外の終了ステータス（最後のコマンドのもの）を返したときだけ`,
      `bats calls \`${name}\` after each test, in the test's process (also when the test fails). It calls it as \`${name} || …\`, so \`set -e\` is ignored in it: a command that fails in the middle does not stop it, and the test fails only when \`${name}\` returns a status that is not 0 (that of its last command)`]
    : when === 'file-before' ? [
      `bats は \`${name}\` をこのファイルの最初のテストの前に1回だけ、別のプロセスで呼ぶ。テストに届くのは、ここで \`export\` した変数だけ。失敗したコマンドがあると（\`set -e\`）、ファイルのテストはどれも実行されない`,
      `bats calls \`${name}\` once, before the first test of the file, in a process of its own: only the variables it exports (\`export\`) reach the tests. If a command in it fails (\`set -e\`), no test of the file runs`]
    : [
      `bats は \`${name}\` をこのファイルの最後のテストの後に1回だけ、\`setup_file\` と同じプロセスで呼ぶ。\`${name} || …\` の形で呼ぶので、中では \`set -e\` が無視され、途中のコマンドが失敗しても止まらない`,
      `bats calls \`${name}\` once, after the last test of the file, in the process of \`setup_file\`. It calls it as \`${name} || …\`, so \`set -e\` is ignored in it: a command that fails in the middle does not stop it`])),
  'bats-setup-suite-in-test-file': broken(['3.3'], () => [
    'bats はテストファイルの `setup_suite` を呼ばず、警告(BW03)を出します。`setup_suite` は、テストと同じディレクトリのファイル `setup_suite.bash` に書きます',
    'bats does not call a `setup_suite` of a test file, and warns (BW03). Put `setup_suite` in the file `setup_suite.bash`, next to the tests'],
    () => ['bats はテストファイルの `setup_suite` を呼ばない。', 'bats does not call a `setup_suite` of a test file.']),
} satisfies Catalog;
