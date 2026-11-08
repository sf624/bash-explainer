import { broken, type Catalog, caveat, NO_HEADING, note, pitfall, saying, withConvention } from './messages-entry';
import { HOST_NOTES } from './messages-lines';
import { type GithubFileName, githubFileText, type HostMeaning, hostSubstitutionText } from './messages-hosts';

// The catalog's facts on host files (src/hosts.ts): the pitfalls of the code a host runs, and the host's notes on how it
// runs it. Spread into `MESSAGES` (src/messages.ts).

export const HOST_MESSAGES = {
  'dockerfile-pipefail-missing': saying(withConvention(caveat<Record<string, never>>(['3.2.3', '4.3.1'], () => [
    'パイプの途中のコマンドが失敗しても、RUN は最後のコマンドの結果だけで成功扱いになり、ビルドは止まりません。先に `SHELL ["/bin/bash", "-o", "pipefail", "-c"]` と書くと失敗を検出できます。',
    'If a command in the middle of the pipe fails, RUN still succeeds with the status of the last command, and the build goes on. Put `SHELL ["/bin/bash", "-o", "pipefail", "-c"]` first to catch such failures.'],
    () => ['パイプの途中のコマンドが失敗しても、RUN は成功してビルドが続く。', 'If a command in the middle of the pipe fails, RUN still succeeds and the build goes on.'], NO_HEADING), 'pipefail'), 'pipeStatus', 'errexit'),
  'python-string-without-shell': broken<Record<string, never>>(['3.7.2'], () => [
    'shell=True なしで文字列を渡すと、文字列全体が1つのプログラム名として扱われます（引数やパイプは使えず、多くの場合 FileNotFoundError）。`["cmd", "arg"]` のようなリストで渡すか、shell=True を付けます。',
    'Without shell=True the whole string is taken as one program name (no arguments or pipes; usually FileNotFoundError). Pass a list like `["cmd", "arg"]`, or add shell=True.'],
    () => ['shell=True がないと、文字列全体が1つのプログラム名になる。', 'Without shell=True the whole string is one program name.'], NO_HEADING),
  'python-shell-injection': withConvention(pitfall<Record<string, never>>(['3.1.1', '3.1.2'], () => [
    'Python の値を埋め込んだ文字列をシェルが実行します。値に `;` や `$(…)` が含まれると任意のコマンドが実行されます。`shlex.quote()` でクォートするか、shell=True をやめてリストで渡してください。',
    'the shell runs a string with Python values pasted in, so a value containing `;` or `$(…)` runs arbitrary commands. Quote it with `shlex.quote()`, or drop shell=True and pass a list.'],
    () => ['Python の値を埋め込んだ文字列をシェルが実行するので、値によって任意のコマンドが実行される。', 'The shell runs a string with Python values pasted in, so a value can run arbitrary commands.'], { ja: 'シェルインジェクションの危険: ', en: 'Shell injection risk: ' }), 'quote-for-shell-in-python'),
  'actions-script-injection': withConvention(pitfall<{ expr: string }>(['3.1.1', '3.1.2'], ({ expr }) => [
    `\`${expr}\` は外部の人が自由に書ける値で、そのままスクリプトに埋め込まれます（\`"; curl … | sh #\` のような値で任意のコマンドが実行される）。\`env:\` で環境変数に渡し、\`"$変数"\` として使ってください。`,
    `\`${expr}\` can be set by anyone and is pasted into the script as it is (a value like \`"; curl … | sh #\` runs arbitrary commands). Pass it through \`env:\` and use it as \`"$VAR"\`.`],
    ({ expr }) => [`外部の人が書ける \`${expr}\` がスクリプトに埋め込まれ、値によって任意のコマンドが実行される。`, `\`${expr}\`, which anyone can set, is pasted into the script, so a value can run arbitrary commands.`], { ja: 'スクリプトインジェクションの危険: ', en: 'Script injection risk: ' }), 'actions-expression-through-env'),
  // (A host replaces its substitutions before the shell reads the line, 3.1.1; a variable of the environment GitHub
  // Actions gives, 3.7.4; the host's notes on how its code is run, 6.1, and on a status, 3.7.5.)
  'host-substitution': note<{ text: string; meaning: HostMeaning }>(['3.1.1'], hostSubstitutionText),
  'github-file': note<{ name: GithubFileName }>(['3.7.4'], githubFileText),
  'dockerfile-onbuild': note<Record<string, never>>(['6.1'], () => HOST_NOTES['dockerfile-onbuild']),
  'dockerfile-healthcheck': note<Record<string, never>>(['3.7.5'], () => HOST_NOTES['dockerfile-healthcheck']),
  'dockerfile-exec-form': note<Record<string, never>>(['3.7.2'], () => HOST_NOTES['dockerfile-exec-form']),
  'makefile-no-shell': note<Record<string, never>>(['3.7.2'], () => HOST_NOTES['makefile-no-shell']),
  'makefile-maybe-no-shell': note<Record<string, never>>(['3.7.2'], () => HOST_NOTES['makefile-maybe-no-shell']),
  'yaml-folded-block': note<Record<string, never>>(['3.1.2.1'], () => HOST_NOTES['yaml-folded-block']),
  'dockerfile-shell': note<Record<string, never>>(['6.1'], () => HOST_NOTES['dockerfile-shell']),
  'jenkinsfile-groovy-interpolation': note<Record<string, never>>(['3.5.3'], () => HOST_NOTES['jenkinsfile-groovy-interpolation']),
  'python-shell-list': note<Record<string, never>>(['6.1'], () => HOST_NOTES['python-shell-list']),
  'python-exec-list': note<Record<string, never>>(['3.7.2'], () => HOST_NOTES['python-exec-list']),
  'python-shell-expression': note<Record<string, never>>(['6.1'], () => HOST_NOTES['python-shell-expression']),
  'python-string-partial': note<Record<string, never>>(['3.1.1'], () => HOST_NOTES['python-string-partial']),
} satisfies Catalog;
