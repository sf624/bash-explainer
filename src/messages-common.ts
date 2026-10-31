// Fragments shared by several facts of the catalog (src/messages.ts and its parts), so that each case is said in one
// way: code the model does not read (`unread`), a file with no shebang that something else may read (`sourced`).

/**
 * The clause of a fact whose param `unread` says that a path before here ran code the model does not read
 * (`unlessUnread`, src/semantics/shellstate.ts), which may undo what the fact says; `does`, what that code would do,
 * [ja, en]: ja is the verb phrase before いなければ (`\`expand_aliases\` を有効にして`), en a verb (`turns \`expand_aliases\` on`).
 * An empty clause when not `unread`. Also the token's text (src/explain/commands.ts) takes it from here.
 */
export function unreadClause(unread: boolean | undefined, does: readonly [string, string]): readonly [string, string] {
  const code = unreadCode(does);
  return unread ? [`（${code[0]}いなければ）`, `, unless ${code[1]}`] : ['', ''];
}

/**
 * The code a path before ran and the model does not read, with what it would do, [ja, en]: ja before いなければ or
 * いるときを除く, en the end of an "unless". For a fact that has another condition of its own (`variable-not-exported`:
 * the environment), so that one "unless" holds both.
 */
export function unreadCode([ja, en]: readonly [string, string]): readonly [string, string] {
  return [
    `この前に実行される、\`source\` で読み込むファイルや \`eval\` のようにここでは読まないコードが${ja.startsWith('`') ? ' ' : ''}${ja}`,
    `code that runs before it and is not read here, such as a file read with \`source\` or an \`eval\`, ${en}`];
}

/**
 * One "unless" for the conditions a fact has, [ja, en] each (ja ends with とき): `（A と B を除く）`, `(unless A, or B)`;
 * empty when none holds (a condition left out is `undefined`).
 */
export function unlessAny(...conditions: (readonly [string, string] | undefined)[]): readonly [string, string] {
  const held = conditions.filter((c): c is readonly [string, string] => c !== undefined);
  return held.length ? [`（${held.map((c) => c[0]).join('と、')}を除く）`, ` (unless ${held.map((c) => c[1]).join(', or ')})`] : ['', ''];
}

/** What code not read would do for a variable or a function another shell lacks: set or define it there. */
export const SETS_IT: readonly [string, string] = ['そこで設定して', 'sets it there'];
export const DEFINES_IT: readonly [string, string] = ['そこで定義して', 'defines it there'];
/**
 * ... or for a variable the new shell lacks because it is not exported: leave it set there, whether the code before
 * exports it (`source`, `eval`) or the string's own code sets it (`. ./f.sh` in `bash -c`).
 */
export const leavesSet = (v: string): readonly [string, string] => [`\`${v}\` をそこで使えるようにして`, `leaves \`${v}\` set there`];

/**
 * The sentence added to a fact said in a file with no shebang (`readAs`: `unknown`), which something else than a run
 * of it as a script may read: `how` says who and what then happens, [ja, en] (ja ends with its own 。 or not).
 */
export function noShebang(sourced: boolean | undefined, [ja, en]: readonly [string, string], how: readonly [string, string]): readonly [string, string] {
  return sourced ? [`${ja}。ただし、このファイルにはシバンがないので、${how[0]}`, `${en}. But this file has no shebang: ${how[1]}`] : [ja, en];
}

/** Who reads a file with no shebang interactively, the start of `noShebang`'s `how`. */
export const READ_INTERACTIVELY: readonly [string, string] = ['`.bashrc` のように対話シェルが読むなら', 'read by an interactive shell, as `.bashrc` is,'];

/**
 * The sentence added to a fact where `~/.bashrc` may have run first (`bashrcReader`, src/semantics/env.ts): `sourced`,
 * an interactive shell may read this file with no shebang; `interactive`, the shell is started with `-i`. `then`, what
 * `.bashrc` then gives, [ja, en] (ja after 「…なら、」 or 「…ので、」, en after a colon).
 */
export function readByBashrc(reader: 'sourced' | 'interactive' | undefined, base: readonly [string, string], then: readonly [string, string]): readonly [string, string] {
  return reader === 'interactive' ? [`${base[0]}。ただし、このシェルは対話シェル（\`-i\`）で、先に \`.bashrc\` を読むので、${then[0]}`, `${base[1]}. But this shell is interactive (\`-i\`) and reads \`.bashrc\` first: ${then[1]}`]
    : noShebang(reader === 'sourced', base, [`${READ_INTERACTIVELY[0]}、${then[0]}`, `${READ_INTERACTIVELY[1]} ${then[1]}`]);
}

/** `local-outside-function` in a trap's action (`trap`): it runs where the trap fires, which may be in a function. */
export function inTrap(trap: boolean | undefined, [ja, en]: readonly [string, string]): readonly [string, string] {
  return trap ? [
    `${ja}。ここはトラップの動作で、トラップが起きた場所で実行されるので、関数の中のこともあれば、関数の外のこともあります`,
    `${en}. This is a trap's action: it runs where the trap fires, which may be inside a function or outside one`] : [ja, en];
}

/** `local-outside-function` in a file with no shebang (`sourced`): a function may read it with `source`, and `local` then works. */
export const LOCAL_SOURCED: readonly [string, string] = ['関数の中から `source` で読み込まれたときは、`local` はその関数のローカル変数を宣言します', 'when a function reads it with `source`, `local` works there, and declares a variable of that function'];
