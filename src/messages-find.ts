// The text of the catalog's fact about an action that find refuses (src/messages.ts: `find-action-refused`), apart, to keep
// src/messages.ts short.
import { codeSpan } from './label';
import type { Rewrite } from './rewrite';

/** `find-action-refused`: the action (`-exec`…) and why find refuses it (src/argv/until.ts, `UntilRefusal`). */
export interface FindRefusalParams {
  option: string;
  why: 'missing' | 'empty' | 'alone' | 'once';
  /** With `alone`: the word before the `+`. */
  word?: string;
  /** The option can be ended by a `+` after a `{}` (`-exec`, `-execdir`), not only by `\;`. */
  plus: boolean;
  /** The line ends with a bare `;` (the shell's list operator). */
  bare: boolean;
  rewrite: readonly Rewrite[];
}

export function findRefusalText({ option, why, word, plus, bare, rewrite: [fix] }: FindRefusalParams): readonly [string, string] {
  const o = `\`${option}\``;
  const stops = (said: string) => [`find は行全体を受け付けず（${codeSpan(said)}）、何も実行しない。`, `find refuses the whole line (${codeSpan(said)}) and runs nothing.`] as const;
  if (why === 'missing') {
    const [sj, se] = stops(`find: missing argument to \`${option}'`);
    return [
      `${o} のコマンドを終わらせる \`\\;\`${plus ? '（または \`{}\` の直後の \`+\`）' : ''}がない${bare ? '。末尾の \`;\` はシェルのコマンドリストの区切りなので、find には渡らない' : plus ? '' : '。\`+\` で終わらせられるのは \`-exec\` と \`-execdir\` だけ'}。${sj}${fix ? `\`${fix.code}\` と書く（\`';'\` でもよい）` : '\`\\;\` か \`\';\'\` で終わらせる'}`,
      `${o} has no \`\\;\`${plus ? ' (or \`+\` right after a \`{}\`)' : ''} to end its command${bare ? ": the \`;\` at the end is the shell's list separator, so find never gets it" : plus ? '' : '; only \`-exec\` and \`-execdir\` can be ended by a \`+\`'}. ${se} ${fix ? `Write \`${fix.code}\` (or \`';'\`)` : 'End it with \`\\;\` or \`\';\'\`'}`];
  }
  if (why === 'empty') {
    const [sj, se] = stops(`find: invalid argument \`;' to \`${option}'`);
    return [`${o} の直後がすぐ \`\\;\` で、実行するコマンドがない。${sj}`, `${o} is followed at once by \`\\;\`, so it has no command to run. ${se}`];
  }
  if (why === 'alone') {
    const [sj, se] = stops(`find: In '${option} ... {} +' the '{}' must appear by itself, but you specified '${word}'`);
    return [`\`+\` が ${o} のコマンドを終わらせるのは、直前の語が \`{}\` だけのときに限る。ここでは \`${word}\` なので、\`{}\` だけの語にするか、\`\\;\` で1件ずつ実行する。${sj}`,
      `a \`+\` ends the command of ${o} only after a \`{}\` that stands alone, and here the word before it is \`${word}\`. Put \`{}\` alone before the \`+\`, or end it with \`\\;\` to run it once per file. ${se}`];
  }
  const [sj, se] = stops(`find: Only one instance of {} is supported with ${option} ... +`);
  return [`\`+\` で終わらせる ${o} のコマンドに書ける \`{}\` は1つだけ。2つ以上必要なら \`\\;\` で1件ずつ実行する。${sj}`,
    `the command of ${o} that a \`+\` ends takes only one \`{}\`. Use \`\\;\` to run it once per file if it needs more. ${se}`];
}
