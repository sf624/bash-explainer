import type { CommandSpec, OperandSpec } from '../argv/spec';
import { tx } from '../i18n';

/**
 * A word in find's expression that no test, action or operator takes (`find . -name a.txt b.txt`, where the shell turned
 * `*.txt` into two words): find reads the starting points before the expression only, and refuses the line.
 */
const FIND_LATE_PATH: OperandSpec = {
  name: 'LATE', repeat: '*', extra: { says: 'paths must precede expression', status: 1 },
  text: tx('式の後ろに書かれたパス（find は受け付けず、`paths must precede expression` と表示して何もせずに終了ステータス 1 で終わる。開始ディレクトリは式より前に書き、シェルが展開するワイルドカードは引用符で囲む）',
    'a path after the expression, which find refuses (it prints `paths must precede expression` and exits with status 1, running nothing: starting points come before it, and a wildcard the shell expands is quoted)'),
};

/**
 * find reads only `-H`, `-L` and `-P` as options, before the starting points; the words from the first test or
 * action on are an expression (`operandParser`), whose words are read with all of its options (`expressionSpec`), and
 * whose operands are the late paths find refuses.
 */
export const findSpec = (spec: CommandSpec): CommandSpec => ({
  ...spec, options: spec.options!.filter((o) => o.names.some((n) => /^-[HLP]$/.test(n))), operandParser: 'find-expression',
  expressionSpec: { ...spec, operands: [{ pattern: [FIND_LATE_PATH] }] },
});
