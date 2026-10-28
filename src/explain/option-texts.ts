// The texts of options the argument reader does not describe: one not in the dictionary, the undoing of a `+` option
// (src/explain/argv.ts), and an option a program reads only alone, where the environment may make it text.
import { type ArgRole, type ArgvParse, swapRoles } from '../argv/interpret';
import type { CommandSpec } from '../argv/spec';
import type { Text } from '../i18n';
import { type ExecEnv, variableIn } from '../semantics/env';
import type { SyntaxNode } from '../syntax/tree';
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

/**
 * `parse` (of the command `cmd`) with each word read as one of `soleOptions` (coreutils `echo --version`) as the
 * model knows it where its command runs (`envs`, from `slotEnvs`): with the variable of `soleUnlessEnv` surely in
 * that environment, text, which says why; surely not, the option; else the option, with the caveat.
 */
export function soleRead(cx: Explainer, parse: ArgvParse, envs: ReadonlyMap<ArgvParse, ExecEnv>, cmd: SyntaxNode): ArgvParse {
  const swap = new Map<ArgRole, ArgRole>();
  for (const [p, env] of envs) {
    if (!p.sole) continue;
    const { option, env: name } = p.sole;
    const { state } = variableIn(cx.state, cmd, name, env);
    if (state === 'off') continue;
    if (state === 'unknown') {
      swap.set(option, { ...option, text: { ja: `${option.text.ja}（環境に \`${name}\` があると、ただの文字列）`, en: `${option.text.en} (plain text if \`${name}\` is in the environment)` } });
      continue;
    }
    // (echo's words are operands of its spec.)
    const text = p.sole.text as Extract<ArgRole, { role: 'operand' }>;
    const t = text.spec!.text;
    swap.set(option, { ...text, spec: { ...text.spec!, text: { ja: `${t.ja}（環境に \`${name}\` があるので、\`${option.flag}\` はオプションではない）`, en: `${t.en} (\`${name}\` is in its environment, so \`${option.flag}\` is no option)` } } });
  }
  return swap.size ? swapRoles(parse, swap) : parse;
}
