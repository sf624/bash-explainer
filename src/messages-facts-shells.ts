import {
  broken, byCase, type Catalog, caveat, note, notProblem, pitfall, suggests, SYSTEM_DEPENDENT, withBasis, withConvention, type Words,
} from './messages-entry';
import { aliasDefinedText, aliasMaybeText, aliasNotExpandedText } from './messages-alias';
import { readByBashrc } from './messages-common';
import { extglobText, globstarText } from './messages-glob';
import {
  builtinOrFunctionAsProgramText, functionNotImportedShText, functionNotImportedText, functionNotInContainerText,
  functionNotInNewShellBlockedText, functionNotInNewShellExportText, functionNotInNewShellText, functionNotOnRemoteText,
  functionShadowedText, placeholderInShellStringText, sshLocalExpansionText, variableNotExportedText, variableNotInRemoteText,
  variableNotPassedText,
} from './messages-wrappers';
import type { PlaceholderWith } from './argv/spec';
import type { Rewrite } from './rewrite';

// The catalog's facts on what the shell that runs a line has: aliases (and a distribution's), the options of extended
// globs and globstar, and what a wrapper or a new shell does not get. Spread into `MESSAGES` (src/messages.ts).

export const SHELL_MESSAGES = {
  // ---------------------------------------------------------------- aliases (6.6)
  // (`off`: the script turned it off, `shopt -u expand_aliases`, which counts in an interactive shell too. `unread` and
  // `fn`: `Missed.maybe` of src/semantics/names.ts, a caveat.)
  'alias-not-expanded-in-script': pitfall<{ name: string; value: string; off?: boolean; unread?: boolean; fn?: boolean }>(['6.6', '4.3.2'], aliasNotExpandedText,
    ({ name, off, unread, fn }) => {
      const [ja, en] = unread || fn ? ['になることがある', 'may be'] : ['になる', 'is'];
      return off
        ? [`エイリアスの展開が無効なので、\`${name}\` は command not found ${ja}。`, `Alias expansion is off, so \`${name}\` ${en} "command not found".`]
        : [`スクリプトではエイリアスを展開しないので、\`${name}\` は command not found ${ja}。`, `bash does not expand aliases in scripts, so \`${name}\` ${en} "command not found".`];
    }, undefined, ({ unread, fn }) => (unread || fn ? 'info' : 'error')),
  // (A file with no shebang, which bash may run as a script or an interactive shell may read: src/semantics/state.ts.)
  'alias-maybe-not-expanded': caveat<{ name: string; value: string }>(['6.6', '4.3.2'], aliasMaybeText,
    ({ name }) => [`スクリプトとして実行すると、\`${name}\` は command not found になる。`, `Run as a script, \`${name}\` is "command not found".`]),
  'alias-defined-same-unit': note<{ name: string; line: number }>(['6.6'], aliasDefinedText('same-unit')),
  'unbraced-element': suggests(pitfall<{ name: string; sub: string; glob?: boolean; rewrite: readonly Rewrite[] }>(['6.7'], ({ name, sub, glob, rewrite: [fix] }) => [
    `\`$${name}${sub}\` は配列の要素ではありません: \`$${name}\`（\`\${${name}[0]}\` と同じ）の後に文字列 \`${sub}\` が続きます${glob ? '（ここではグロブにもなります）' : ''}。要素は \`${fix.code}\` と波かっこで囲んで書きます`,
    `\`$${name}${sub}\` is not an element of the array: it is \`$${name}\` (that is \`\${${name}[0]}\`) followed by the text \`${sub}\`${glob ? ' (a glob too, here)' : ''}. For the element, write \`${fix.code}\` with braces`],
    ({ name, sub }) => [`\`$${name}${sub}\` は配列の要素ではない。`, `\`$${name}${sub}\` is not an element of the array.`])),
  'alias-defined-later': note<{ name: string; line: number }>(['6.6'], aliasDefinedText('later')),

  // (`reader`: `.bashrc` may have run first, `bashrcReader` of src/semantics/env.ts: a caveat.)
  'distro-alias-in-script': pitfall<{ name: string; where: string; what: Words; many: boolean; instead: Words; reader?: 'sourced' | 'interactive' }>(['6.6'], ({ name, where, what, many, instead, reader }) => {
    const [ja, en] = readByBashrc(reader, [
      `\`${name}\` は ${where} が対話シェル用に定義する${what.ja}で、コマンドではありません。ほかの環境にはなく、スクリプトの中では${many ? 'これらの' : 'その'}環境でも使えません（command not found）`,
      `\`${name}\` is ${what.en} ${where} define${many ? '' : 's'} for interactive shells, not a command. Other systems lack it, and scripts do not have it even there ("command not found")`], ['使えることがあります', 'it may have it']);
    return [`${ja}。${instead.ja}`, `${en}. ${instead.en}`];
  },
    ({ name, what }) => [`\`${name}\` は対話シェル用の${what.ja}で、コマンドではない。`, `\`${name}\` is ${what.en} for interactive shells, not a command.`], SYSTEM_DEPENDENT, byCase),
  'distro-alias-interactive': note<{ name: string; where: string; what: Words; many: boolean; portable?: string }>(['6.6'], ({ name, where, what, many, portable }) => [
    `環境依存: \`${name}\` は ${where} が対話シェル用に定義する${what.ja}で、ほかの環境にはありません。どこでも動かすには${portable ? ` \`${portable}\` と書きます` : '、したいことに合ったコマンドをそのまま書きます'}`,
    `System-dependent: \`${name}\` is ${what.en} ${where} define${many ? '' : 's'} for interactive shells; other systems lack it. ${portable ? `Write \`${portable}\` to work everywhere` : 'To work everywhere, write the command you mean'}`]),
  // ---------------------------------------------------------------- extended globs and globstar (3.5.8.1, 3.5.8, 4.3.2)
  // (3.5.8.1: extglob "changes the behavior of the parser", so it must be on "before parsing constructs containing the
  // patterns, including shell functions". That a pattern read without it is a syntax error, which stops the script,
  // the manual does not say: checked. A new shell starts with its own options (3.7.3 lists what a command run apart
  // gets, and `shopt` options are not among them); the try-it shows it.)
  // (3.5.8.1: with globstar, `**` matches "zero or more directories"; without it, two `*`, each of which matches no `/`.)
  // (`reader`: `.bashrc` may have run first, with extglob on: messages-glob.ts, a caveat.)
  'extglob-in-same-block': withBasis(pitfall<{ use: string; reader?: 'sourced' | 'interactive' }>(['3.5.8.1', '4.3.2'], extglobText('in-same-block'),
    ({ use, reader }) => (reader
      ? [`\`${use}\` は構文エラーになることがある（同じブロックの \`shopt -s extglob\` では間に合わない）。`, `\`${use}\` may be a syntax error: \`shopt -s extglob\` in the same block comes too late.`]
      : [`\`${use}\` は構文エラーになる（同じブロックの \`shopt -s extglob\` では間に合わない）。`, `\`${use}\` is a syntax error: \`shopt -s extglob\` in the same block comes too late.`]), undefined, byCase), { kind: 'checked', probe: 'state#extglob-off' }),
  'extglob-maybe-on': withBasis(caveat<{ use: string }>(['3.5.8.1', '4.3.2'], extglobText('maybe-on'),
    ({ use }) => [`\`extglob\` を有効にしない経路では、\`${use}\` は構文エラーになる。`, `\`${use}\` is a syntax error on the paths that do not turn \`extglob\` on.`]), { kind: 'checked', probe: 'state#extglob-off' }),
  'extglob-turned-off': withBasis(broken<{ use: string }>(['3.5.8.1', '4.3.2'], extglobText('turned-off'),
    ({ use }) => [`\`shopt -u extglob\` で無効にしたので、\`${use}\` は構文エラーになる。`, `\`${use}\` is a syntax error: \`shopt -u extglob\` turned it off.`]), { kind: 'checked', probe: 'state#extglob-off' }),
  'extglob-not-found': withBasis(notProblem(caveat<{ use: string }>(['3.5.8.1', '4.3.2'], extglobText('not-found'),
    ({ use }) => [`\`extglob\` をほかの場所で有効にしていなければ、\`${use}\` は構文エラーになる。`, `\`${use}\` is a syntax error unless \`extglob\` is turned on elsewhere.`])), { kind: 'checked', probe: 'state#extglob-off' }),
  'extglob-maybe-on-trap': withBasis(caveat<{ use: string }>(['3.5.8.1', '4.3.2', '4.1'], extglobText('maybe-on-trap'),
    ({ use }) => [`\`extglob\` が有効になる前にシグナルが来ると、トラップの \`${use}\` は構文エラーになる。`, `\`${use}\` in a trap is a syntax error if its signal comes before \`extglob\` is on.`]), { kind: 'checked', probe: 'state#extglob-off' }),
  'extglob-not-in-new-shell': withBasis(pitfall<{ use: string; reader?: 'interactive' }>(['3.5.8.1', '4.3.2', '3.7.3'], extglobText('not-in-new-shell'),
    ({ use, reader }) => (reader
      ? [`新しいシェルでは、\`${use}\` は構文エラーになることがある。`, `\`${use}\` may be a syntax error in the new shell.`]
      : [`新しいシェルは \`extglob\` が無効で始まるので、\`${use}\` は構文エラーになる。`, `\`${use}\` is a syntax error in the new shell, which starts with \`extglob\` off.`]), undefined, byCase), { kind: 'checked', probe: 'state#extglob-new-shell', also: ['state#extglob-off'] }),
  'globstar-maybe-on': caveat<{ on: string }>(['3.5.8', '4.3.2'], globstarText('maybe-on'),
    ({ on }) => [`\`${on}\` を通らない経路では、\`**\` は1階層しか一致しない。`, `On the paths that do not run \`${on}\`, \`**\` matches one level only.`]),
  'globstar-not-found': notProblem(caveat<{ on: string }>(['3.5.8', '4.3.2'], globstarText('not-found'),
    ({ on }) => [`\`${on}\` をほかの場所で実行していなければ、\`**\` は1階層しか一致しない。`, `\`**\` matches one level only unless \`${on}\` runs elsewhere.`])),
  'globstar-unsupported': pitfall<{ shell: string }>(['3.5.8'], ({ shell }) => [
    `${shell} には globstar がなく、\`**\` は \`*\` と同じく1階層分にしか一致しません。サブディレクトリまでたどるには \`find\` を使います`,
    `${shell} has no globstar, so \`**\` is the same as \`*\` and matches one level only. To reach into subdirectories, use \`find\``],
    ({ shell }) => [`${shell} には globstar がないので、\`**\` は1階層しか一致しない。`, `${shell} has no globstar, so \`**\` matches one level only.`]),

  // ---------------------------------------------------------------- what a wrapper or a new shell does not get (3.7.3, 3.7.4, 3.3)
  // (The texts, and what each param means: src/messages-wrappers.ts.)
  'variable-not-in-remote-shell': pitfall<{ v: string; unread?: boolean; sent?: boolean }>(['3.7.3', '3.7.4'], variableNotInRemoteText,
    ({ v, unread, sent }) => (unread || sent
      ? [`リモートのシェルには \`${v}\` がないことがある。`, `The remote shell may not have \`${v}\`.`]
      : [`リモートのシェルには \`${v}\` がない。`, `The remote shell does not have \`${v}\`.`]), undefined, byCase),
  'variable-not-passed-by-wrapper': pitfall<{ v: string; via: string; keeps?: readonly string[]; unread?: boolean }>(['3.7.3', '3.7.4'], variableNotPassedText,
    ({ v, via }) => [`\`${via}\` は \`${v}\` を新しいシェルに渡さない。`, `\`${via}\` does not pass \`${v}\` to the new shell.`], undefined, byCase),
  // (A name in lower case may come from the environment too, though it seldom does: a warning, with a clause.)
  'variable-not-exported': withBasis(pitfall<{ v: string; environment?: 'maybe' | 'unlikely'; array?: boolean; unread?: boolean }>(['3.7.3', '3.7.4'], variableNotExportedText,
    ({ v, environment, array, unread }) => (array
      ? [`\`${v}\` は配列で、配列はエクスポートできないので、新しいシェルでは空になる。`, `\`${v}\` is an array, which bash cannot export, so it is empty in the new shell.`]
      : environment === 'maybe'
        ? [`\`${v}\` は、もともと環境変数にあるときだけ新しいシェルに届く。`, `\`${v}\` reaches the new shell only if it was in the environment already.`]
        : environment || unread
          ? [`\`${v}\` はエクスポートされていないので、新しいシェルでは空になることがある。`, `\`${v}\` is not exported, so it may be empty in the new shell.`]
          : [`\`${v}\` はエクスポートされていないので、新しいシェルでは空になる。`, `\`${v}\` is not exported, so it is empty in the new shell.`]), undefined,
    ({ environment, unread }) => (environment === 'maybe' || unread ? 'info' : environment ? 'warning' : 'error')),
  ({ array }) => (array ? { kind: 'checked', probe: 'state#export-array' } : undefined)),
  'function-not-in-container': broken<{ via: string; name: string }>(['3.3', '3.7.3'], functionNotInContainerText,
    ({ name }) => [`コンテナの中には、このスクリプトの関数 \`${name}\` がない。`, `The container does not have this script's function \`${name}\`.`]),
  'builtin-or-function-as-program': broken<{ via: string; name: string; isFn: boolean; fix: Words }>(['3.7.3', '3.3'], builtinOrFunctionAsProgramText,
    ({ via, name, isFn }) => (isFn
      ? [`\`${via}\` は \`${name}\` を別のプログラムとして起動するので、シェルの関数は実行できない。`, `\`${via}\` starts \`${name}\` as a program, so it cannot run a shell function.`]
      : [`\`${via}\` は \`${name}\` を別のプログラムとして起動するので、シェルの組み込みコマンドは実行できない。`, `\`${via}\` starts \`${name}\` as a program, so it cannot run a shell builtin.`])),
  'ssh-local-expansion': notProblem(caveat<{ risky: string }>(['3.7.1', '3.7.3'], sshLocalExpansionText,
    ({ risky }) => [`\`ssh\` に渡す前に、手元のシェルが \`${risky}\` を展開する。`, `The local shell expands \`${risky}\` before \`ssh\` sends the command.`])),
  // (Code that nobody chose runs, with some names: a warning, docs/design/three-levels.md, question 2.)
  'placeholder-in-shell-string': withConvention(pitfall<{ by: string; text: string; what: PlaceholderWith; via?: string }>(['3.1.1', '6.1'], placeholderInShellStringText,
    ({ by, what }) => (what === 'path'
      ? [`\`${by}\` が見つけたパスをシェルのコードに埋め込むので、ファイル名によっては任意のコマンドが実行される。`, `\`${by}\` pastes each path it finds into the shell's code, so a file name can run arbitrary commands.`]
      : [`\`${by}\` が入力の1件をシェルのコードに埋め込むので、その中身によっては任意のコマンドが実行される。`, `\`${by}\` pastes each input item into the shell's code, so an item can run arbitrary commands.`]), { ja: 'シェルインジェクションの危険: ', en: 'Shell injection risk: ' }), 'placeholder-as-argument'),
  'function-not-on-remote': broken<{ name: string }>(['3.3', '3.7.3'], functionNotOnRemoteText,
    ({ name }) => [`リモートのシェルには、このスクリプトの関数 \`${name}\` がない。`, `The remote shell does not have this script's function \`${name}\`.`]),
  'function-not-in-new-shell-blocked': broken<{ via: string; fn: string; blocker: string }>(['3.3', '3.7.3'], functionNotInNewShellBlockedText,
    ({ via, fn }) => [`\`${via}\` の新しいシェルには、\`export -f\` をしても関数 \`${fn}\` がない。`, `The new shell of \`${via}\` does not have the function \`${fn}\`, even with \`export -f\`.`]),
  'function-not-in-new-shell': broken<{ via: string; fn: string }>(['3.3', '3.7.3'], functionNotInNewShellText,
    ({ via, fn }) => [`\`${via}\` の新しいシェルには、このスクリプトの関数 \`${fn}\` がない。`, `The new shell of \`${via}\` does not have this script's function \`${fn}\`.`]),
  'function-not-imported': broken<{ via: string; shell: string; fn: string }>(['3.3', '3.7.3'], functionNotImportedText,
    ({ shell, fn }) => [`${shell} は bash がエクスポートした関数を読まないので、\`${fn}\` がない。`, `${shell} does not read the functions bash exports, so \`${fn}\` is not there.`]),
  'function-not-in-new-shell-export': pitfall<{ via: string; fn: string; unread?: boolean }>(['3.3', '3.7.3'], functionNotInNewShellExportText,
    ({ via, fn }) => [`\`export -f\` がないと、\`${via}\` の新しいシェルには関数 \`${fn}\` がない。`, `Without \`export -f\`, the new shell of \`${via}\` does not have the function \`${fn}\`.`], undefined, byCase),
  'function-not-imported-sh': caveat<{ via: string; fn: string }>(['3.3', '3.7.3'], functionNotImportedShText,
    ({ fn }) => [`sh はエクスポートした関数を読まないことがあるので、\`${fn}\` がないことがある。`, `sh may not read exported functions, so \`${fn}\` may not be there.`]),
  // (The function is also the name of a program, which runs there instead: often meant, `sudo ls`.)
  // (A caveat when the function runs that program itself, `wraps`; a warning when another program of its name runs.)
  'function-shadowed-by-program': pitfall<{ via: string; name: string; where: 'program' | 'shell' | 'remote' | 'container'; wraps: boolean }>(['3.3', '3.7.3'], functionShadowedText,
    ({ name }) => [`このスクリプトの関数ではなく、プログラム \`${name}\` が実行される。`, `The program \`${name}\` runs, not this script's function.`], undefined,
    ({ wraps }) => (wraps ? 'info' : 'warning')),
  'wrapper-assignment-expanded-first': suggests(broken<{ use: string; via: string; v: string; rewrite: readonly Rewrite[] }>(['3.7.1', '3.7.4'], ({ use, via, v, rewrite: [fix] }) => [
    `\`${use}\` は、\`${via}\` が \`${v}\` を設定する前に今のシェルが展開します（今の値で、なければ空）。設定した値を使うなら \`${via} ${v}=… ${fix.code}\` のようにシェル経由にします`,
    `the current shell expands \`${use}\` before \`${via}\` sets \`${v}\` (to its present value, or nothing). To use the value it sets, go through a shell: \`${via} ${v}=… ${fix.code}\``],
    ({ use, via, v }) => [`\`${via}\` が \`${v}\` を設定する前に、今のシェルが \`${use}\` を展開する。`, `The current shell expands \`${use}\` before \`${via}\` sets \`${v}\`.`])),

} satisfies Catalog;
