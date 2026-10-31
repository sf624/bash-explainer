// The bash releases the explanations can follow (docs/design/bash-versions.md): 5.2, the reference of the manual
// citations and the default, and 5.3. A construct the version set lacks is explained as it is, and the dialect check
// says that this version does not run it (src/dialect.ts, `dialectIssues`), as it does for the other shells.

export type BashVersion = '5.2' | '5.3';

export const BASH_VERSIONS: readonly BashVersion[] = ['5.2', '5.3'];

export const DEFAULT_BASH_VERSION: BashVersion = '5.2';

interface Since {
  /** The first release that has it. */
  version: BashVersion;
  /** What an earlier release does with it, [Japanese, English]. */
  before: [string, string];
}

// (An expansion error stops the command bash is running, which it read at once: a line, or a compound command. Checked
// with bash 5.2.21 in test/bash53.test.ts.)
const BAD_SUBSTITUTION: [string, string] = [
  '「bad substitution」のエラーになり、そこで止まります。その行の残りと、囲んでいる `if`・ループ・関数の残りは実行されません（終了ステータス 1）。`set -e` のときと POSIX モードではシェルが終了し、サブシェルの中ではそのサブシェルだけが止まります',
  'reports "bad substitution" and stops there: the rest of the line, and the rest of the `if`, loop or function around it, do not run (status 1). Under `set -e`, and in POSIX mode, the shell exits; in a subshell, only the subshell stops',
];

/**
 * When the constructs of FEATURES (src/dialect.ts) that bash 5.2 lacks came, and what bash 5.2 does with them
 * (checked with bash 5.2.21 and 5.3, test/bash53.test.ts).
 */
export const SINCE: Readonly<Record<string, Since>> = {
  funsub: { version: '5.3', before: BAD_SUBSTITUTION },
  valsub: { version: '5.3', before: BAD_SUBSTITUTION },
};

/**
 * What a `}` that does not end a `${ …; }` (`form`) is (`braceTakenAsWord` in src/syntax/tree.ts), [Japanese,
 * English]; in a bash script (`bash`), what bash 5.3 does then (checked: test/bash53.test.ts). It starts with "Syntax
 * error:", as the token says it; the dialect issue `funsubBrace` says it without (`unclosedBraceBody`), after its
 * level's word "Error:".
 */
export function unclosedBrace(how: 'argument' | 'misplaced', form: string, bash: boolean): [string, string] {
  const [ja, en] = unclosedBraceBody(how, form, bash);
  const tag: [string, string] = bash ? ['（bash 5.3）', ' (bash 5.3)'] : ['', ''];
  return [`構文エラー${tag[0]}: ${ja}`, `Syntax error${tag[1]}: ${en[0].toLowerCase()}${en.slice(1)}`];
}

/** `unclosedBrace` without its "Syntax error:", for the dialect issue (src/dialect.ts). */
export function unclosedBraceBody(how: 'argument' | 'misplaced', form: string, bash: boolean): [string, string] {
  const what: [string, string] = how === 'argument'
    ? [`この \`}\` は直前のコマンドの引数になり、\`${form}\` を閉じない`, `This \`}\` is one more argument of the command before it, so it does not end \`${form}\``]
    : [`この位置の \`}\` は \`${form}\` を閉じられない`, `This \`}\` cannot end \`${form}\` where it is`];
  const then: [string, string] = !bash ? ['（`}` が予約語になるのはコマンドの先頭だけ）', ' (`}` is a reserved word only where a command can start)']
    : how === 'argument'
      ? ['。bash 5.3 は閉じる `}` を探して先を読み、なければ「unexpected EOF while looking for matching `}\'」のエラーになる（終了ステータス 2）', '. bash 5.3 reads on for a `}` that does, or reports "unexpected EOF while looking for matching `}\'" (status 2)']
      : ['。bash 5.3 は「syntax error near unexpected token `}\'」のエラーになる', '. bash 5.3 reports "syntax error near unexpected token `}\'"'];
  return [`${what[0]}${then[0]}。\`}\` の前に \`;\` か改行を書く`, `${what[1]}${then[1]}. Write \`;\` or a newline before the \`}\``];
}

/** Whether release `version` comes before release `than`. */
export function earlier(version: BashVersion, than: BashVersion): boolean {
  return BASH_VERSIONS.indexOf(version) < BASH_VERSIONS.indexOf(than);
}

/** Whether bash `version` lacks feature `id` (one of SINCE). */
export function lacks(id: string, version: BashVersion): boolean {
  const since = SINCE[id];
  return !!since && earlier(version, since.version);
}

/**
 * In POSIX mode, a function name that is not a valid name (`a-b() { :; }`): bash 5.2 refuses it ("not a valid
 * identifier") and exits; from this release, bash accepts it (src/semantics/posixexits.ts; probes/status.json).
 */
export const POSIX_FUNCTION_NAMES_SINCE: BashVersion = '5.3';

/**
 * The errors of special builtins (`PosixExitWhy` in src/semantics/posixexits.ts) that end the shell in POSIX mode only
 * from a release on; bash 5.2 goes on there, with status 1 (checked: probes/status.json).
 */
export const POSIX_EXITS_SINCE: Readonly<Record<string, BashVersion>> = { identifier: '5.3', readonly: '5.3', numeric: '5.3' };

/** The `shopt` options that came in a later release (checked: test/bash53.test.ts). */
export const SHELL_OPTIONS_SINCE: Readonly<Record<string, BashVersion>> = { array_expand_once: '5.3', bash_source_fullpath: '5.3' };

/** What bash `version` does with the `shopt` option `name`, which came in release `since`, [Japanese, English]. */
export function laterShellOption(name: string, since: BashVersion, version: BashVersion): [string, string] {
  return [
    `\`${name}\` は bash ${since} からの \`shopt\` のオプションです。bash ${version} では「invalid shell option name」のエラーになります（終了ステータス 1。ほかの名前は設定されます）`,
    `\`${name}\` is a bash ${since} \`shopt\` option: bash ${version} reports "invalid shell option name" for it (status 1; the other names are still set)`,
  ];
}

/**
 * What bash `version` does with the option `flag` of builtin `command`, which came in release `since`, [Japanese,
 * English]; for a special builtin (`special`), also that POSIX mode exits there (checked with bash 5.2.21:
 * test/bash53.test.ts).
 */
export function laterOption(command: string, flag: string, since: BashVersion, version: BashVersion, special = false): [string, string] {
  return [
    `\`${command} ${flag}\` は bash ${since} からのオプションです。bash ${version} では「invalid option」のエラーになり、\`${command}\` は何もしません（終了ステータス 2${special ? '。特殊ビルトインのエラーなので、POSIX モードではシェルが終了する' : ''}）`,
    `\`${command} ${flag}\` is a bash ${since} option: bash ${version} reports "invalid option", and \`${command}\` does nothing (status 2${special ? '; an error of a special builtin, so in POSIX mode the shell exits' : ''})`,
  ];
}
