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

// (bash reads a line, or a compound command, at once; an expansion error drops what it read with the failing command.)
const BAD_SUBSTITUTION: [string, string] = [
  '「bad substitution」のエラーになり、一緒に読み込んだコマンド（その行の残りと、囲んでいる `if` やループ全体）を実行しません（終了ステータス 1）',
  'reports "bad substitution" and drops the commands it read with it (the rest of the line, and the whole `if` or loop around it), with status 1',
];

/**
 * When the constructs of FEATURES (src/dialect.ts) that bash 5.2 lacks came, and what bash 5.2 does with them
 * (checked with bash 5.2.21 and 5.3, test/bash53.test.ts).
 */
export const SINCE: Readonly<Record<string, Since>> = {
  funsub: { version: '5.3', before: BAD_SUBSTITUTION },
  valsub: { version: '5.3', before: BAD_SUBSTITUTION },
};

/** Whether bash `version` lacks feature `id` (one of SINCE). */
export function lacks(id: string, version: BashVersion): boolean {
  const since = SINCE[id];
  return !!since && BASH_VERSIONS.indexOf(version) < BASH_VERSIONS.indexOf(since.version);
}
