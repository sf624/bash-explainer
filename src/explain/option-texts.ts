// The texts of options the argument reader does not describe: one not in the dictionary, and the undoing of a `+` option
// (src/explain/argv.ts).
import type { CommandSpec } from '../argv/spec';
import type { Text } from '../i18n';
import type { Explainer } from './context';

/** The text of an option not in the dictionary. */
export function unknownOption(cx: Explainer, command: string, spec: CommandSpec, ambiguous?: string[], late?: boolean): string {
  // (`bash -x --posix`: long options only before the others, the parser rule `longFirst`.)
  if (late) return cx.t(spec.lateOption!);
  if (spec.unknownOption) return cx.t(spec.unknownOption);
  if (ambiguous) {
    const names = ambiguous.map((n) => `\`${n}\``).join(cx.s('、', ', '));
    return cx.s(`あいまいなオプション（先頭が同じ長いオプションが複数ある: ${names}）。${command.split(' ')[0]} は受け付けない`, `Ambiguous option (it starts several long options: ${names}); ${command.split(' ')[0]} refuses it`);
  }
  // (A builtin's spec has every option bash's builtin takes: any other is one it refuses before doing anything.)
  if (spec.builtin) {
    return cx.s(`bash の \`${command}\` にないオプション: bash は \`invalid option\` と表示し、\`${command}\` は何もせずに失敗する（終了ステータス 2。オプションは \`help ${command}\` にある）`,
      `An option bash's \`${command}\` does not have: bash says \`invalid option\`, and \`${command}\` fails with status 2, doing nothing (\`help ${command}\` lists its options)`);
  }
  return cx.s(`オプション（辞書に未登録。\`man ${command.split(' ')[0]}\` を参照）`, `Option (not in the dictionary; see \`man ${command.split(' ')[0]}\`)`);
}

/**
 * `set +x` is the opposite of `set -x`: what turning the option (or the option named by a value) off does; `off`
 * is what the spec says it does (`set +f`: globbing is on again), when that is more than undoing it.
 */
export function turnedOff(cx: Explainer, flag: string, what: string, value = false, off?: Text): string {
  const on = off ? cx.t(off)
    : cx.s(`元に戻す（${value ? '' : `\`${flag}\` は「`}${what}${value ? '' : '」'}）`, `turn it off again (${value ? '' : `\`${flag}\` is "`}${what}${value ? '' : '"'})`);
  return value ? on : cx.s(`\`${flag}\` を解除: ${on}`, `Undo \`${flag}\`: ${on}`);
}
