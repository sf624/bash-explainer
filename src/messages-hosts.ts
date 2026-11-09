// The wording of what a host replaces before the shell sees it (docs/design/sources.md, rows 14 and 17, SB3c): the facts
// `host-substitution` (`$(CC)` in make, `${{ … }}` in GitHub Actions) and `github-file`, and the explanation of a
// placeholder in the shell text that stands for host syntax. The hosts (src/hosts/) decide which kind a piece of syntax
// is and give its data; the words are here.
import { type Text, tx } from './i18n';

type Pair = readonly [ja: string, en: string];

/** Japanese text followed by more: a space after a closing backtick, so the code span ends. */
const spaced = (ja: string) => (ja.endsWith('`') ? `${ja} ` : ja);

/** The make automatic variables a recipe can use (`$@`), by their character. */
const MAKE_AUTOMATIC = {
  '@': tx('ターゲット名', 'the target name'),
  '<': tx('最初の依存ファイル', 'the first prerequisite'),
  '^': tx('すべての依存ファイル', 'all prerequisites'),
  '?': tx('ターゲットより新しい依存ファイル', 'the prerequisites newer than the target'),
  '*': tx('パターンルールの `%` に当たる部分', 'the stem matched by `%`'),
} satisfies Record<string, Text>;

/** The character of a make automatic variable. */
export type MakeAutomatic = keyof typeof MAKE_AUTOMATIC;

/** Whether `c` is the character of a make automatic variable (`$@`, `$<`, `$^`, `$?`, `$*`). */
export const isMakeAutomatic = (c: string): c is MakeAutomatic => Object.hasOwn(MAKE_AUTOMATIC, c);

/**
 * What a piece of host syntax in shell code stands for, as the host knows it: the kind, and the data its words are made
 * of. `what` is the meaning of a known name, from the dictionary of CI variables (src/dict/ciVariables.ts).
 */
export type HostMeaning =
  | { kind: 'make-automatic'; char: MakeAutomatic; /** The line runs with no shell (src/hosts/makerun.ts). */ direct?: true }
  | { kind: 'make-variable'; name: string }
  | { kind: 'make-function'; name: string }
  | { kind: 'azure-macro'; name: string; what?: Text }
  | { kind: 'azure-template'; expr: string }
  | { kind: 'github-expression'; expr: string; what?: Text }
  | { kind: 'jenkins-expression'; expr: string }
  | { kind: 'jenkins-variable'; expr: string; what: Text }
  | { kind: 'jenkins-parameter'; expr: string; name: string }
  | { kind: 'python-field'; expr: string }
  | { kind: 'python-argument'; expr: string }
  | { kind: 'python-char'; name: string }
  | { kind: 'python-newline' }
  | { kind: 'bats-test-function' }
  | { kind: 'bats-test-name'; name: string };

/** The words of a piece of host syntax (a sentence part, in English without a capital: `a make variable …`). */
export function hostMeaningText(m: HostMeaning): Text {
  switch (m.kind) {
    case 'make-automatic': {
      const what = MAKE_AUTOMATIC[m.char];
      return m.direct
        ? tx(`make の自動変数（${what.ja}）で、行が実行される前に make が展開します`, `make's automatic variable (${what.en}), expanded by make before the line runs`)
        : tx(`make の自動変数（${what.ja}）で、シェルが実行される前に make が展開します`, `make's automatic variable (${what.en}), expanded by make before the shell runs`);
    }
    case 'make-variable':
      return tx(`make の変数 \`${m.name}\` で、シェルが実行される前に make が展開します`, `the make variable \`${m.name}\`, expanded by make before the shell runs`);
    case 'make-function':
      return tx(`make の関数 \`${m.name}\` の呼び出しで、シェルが実行される前に make が結果に置き換えます`, `a call of the make function \`${m.name}\`, replaced by its result before the shell runs`);
    case 'azure-macro':
      return m.what
        ? tx(`${spaced(m.what.ja)}を表す Azure Pipelines の変数 \`${m.name}\` のマクロで、スクリプトが実行される前に値に置き換わります`, `the Azure Pipelines variable \`${m.name}\`: ${m.what.en}; the macro is replaced with its value before the script runs`)
        : tx(`Azure Pipelines の変数 \`${m.name}\` のマクロで、スクリプトが実行される前に値に置き換わります`, `an Azure Pipelines macro, replaced with the value of the variable \`${m.name}\` before the script runs`);
    case 'azure-template':
      return tx(`Azure Pipelines のテンプレート式で、パイプラインの展開時に \`${m.expr}\` の値に置き換わります`, `an Azure Pipelines template expression, replaced with the value of \`${m.expr}\` when the pipeline is expanded`);
    case 'github-expression':
      return m.what
        ? tx(`${spaced(m.what.ja)}を表す GitHub Actions の式 \`${m.expr}\` で、スクリプトが実行される前に値に置き換わります`, `the GitHub Actions expression \`${m.expr}\`: ${m.what.en}; replaced with its value before the script runs`)
        : tx(`GitHub Actions の式で、スクリプトが実行される前に \`${m.expr}\` の値に置き換わります`, `a GitHub Actions expression, replaced with the value of \`${m.expr}\` before the script runs`);
    case 'jenkins-expression':
      return tx(`Groovy の式 \`${m.expr}\` の値で、シェルが実行される前に Jenkins が埋め込みます`, `the value of the Groovy expression \`${m.expr}\`, filled in by Jenkins before the shell runs`);
    case 'jenkins-variable':
      return tx(`${spaced(m.what.ja)}を表す Groovy の式 \`${m.expr}\` で、シェルが実行される前に Jenkins が値を埋め込みます`, `the Groovy expression \`${m.expr}\`: ${m.what.en}; Jenkins fills in its value before the shell runs`);
    case 'jenkins-parameter':
      return hostMeaningText({ kind: 'jenkins-variable', expr: m.expr, what: tx(`ビルドパラメータ \`${m.name}\``, `the build parameter \`${m.name}\``) });
    case 'python-field':
      return tx(`Python の式 \`${m.expr}\` の値（実行前に文字列に埋め込まれる）`, `the value of the Python expression \`${m.expr}\`, pasted into the string before it runs`);
    case 'python-argument':
      return tx(`Python の式 \`${m.expr}\` の値（そのまま1つの引数として渡る）`, `the value of the Python expression \`${m.expr}\`, passed as one argument`);
    case 'python-newline':
      return tx('改行文字（Python で `\\n` と書いたもの）で、引用符の中の単語の1文字として残ります', 'a newline character (written `\\n` in Python), which stays in the quoted word as one character')
    case 'python-char':
      return tx(`Python のエスケープ \`\\N{${m.name}}\` が表す1文字（Unicode の名前が \`${m.name}\` の文字）`, `the one character of Python's escape \`\\N{${m.name}}\` (the Unicode character named \`${m.name}\`)`);
    case 'bats-test-function':
      return tx('bats がテストの関数に付ける名前（`# @test` のコメントがある関数の名前から作る）', 'the name bats gives the function of the test (made of the name of a function marked with `# @test`)');
    case 'bats-test-name':
      return tx(`テストの名前: bats はこの名前から関数名 \`${m.name}\` を作る`, `the name of the test: bats makes the function name \`${m.name}\` of it`);
  }
}

/** Files GitHub Actions provides to steps, by environment variable. */
const GITHUB_FILES = {
  GITHUB_ENV: tx('ここに `名前=値` を書くと、後のステップで環境変数として使えます', 'lines `NAME=value` written here become environment variables in later steps'),
  GITHUB_OUTPUT: tx('ここに `名前=値` を書くと、ステップの出力（`steps.<id>.outputs.名前`）になります', 'lines `name=value` written here become step outputs (`steps.<id>.outputs.name`)'),
  GITHUB_PATH: tx('ここに書いたディレクトリが、後のステップの PATH に追加されます', 'directories written here are added to PATH for later steps'),
  GITHUB_STEP_SUMMARY: tx('ここに書いた Markdown が、ジョブの実行結果のページに表示されます', 'Markdown written here is shown on the run\'s summary page'),
  GITHUB_STATE: tx('ここに書いた値を、同じアクションの pre/post の処理で読めます', 'values written here can be read by the action\'s pre and post steps'),
} satisfies Record<string, Text>;

/** The name of a variable that holds the path of a file GitHub Actions provides (`GITHUB_OUTPUT`). */
export type GithubFileName = keyof typeof GITHUB_FILES;

/** The names of those variables, in the order the notes are given. */
export const GITHUB_FILE_NAMES = Object.keys(GITHUB_FILES) as readonly GithubFileName[];

/** `host-substitution`: what a host's substitution in the shell code means (`$(CC)`, `${{ … }}`; src/hosts/). */
export const hostSubstitutionText = ({ text, meaning }: { text: string; meaning: HostMeaning }): Pair => {
  const m = hostMeaningText(meaning);
  return [`\`${text}\` は${/^[A-Za-z]/.test(m.ja) ? ' ' : ''}${m.ja}。`, `\`${text}\` is ${m.en}.`];
};

/** `github-file`: a variable that holds the path of a file GitHub Actions provides (`$GITHUB_OUTPUT`). */
export const githubFileText = ({ name }: { name: GithubFileName }): Pair => [
  `\`$${name}\` は GitHub Actions が用意するファイルのパスです。${GITHUB_FILES[name].ja}。`, `\`$${name}\` is the path of a file GitHub Actions provides: ${GITHUB_FILES[name].en}.`];
