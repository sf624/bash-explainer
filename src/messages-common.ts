// Fragments shared by several facts of the catalog (src/messages.ts and its parts), so that each case is said in one
// way: code the model does not read (`unread`), a file with no shebang that something else may read (`sourced`).

/**
 * The clause of a fact whose param `unread` says that a path before here ran code the model does not read
 * (`unlessUnread`, src/semantics/shellstate.ts), which may undo what the fact says; `does`, what that code would do,
 * [ja, en]: ja is the verb phrase before いなければ (`\`expand_aliases\` を有効にして`), en a verb (`turns \`expand_aliases\` on`).
 * An empty clause when not `unread`. Also the token's text (src/explain/commands.ts) takes it from here.
 */
export function unreadClause(unread: boolean | undefined, [ja, en]: readonly [string, string]): readonly [string, string] {
  return unread ? [
    `（この前に実行される、\`source\` で読み込むファイルや \`eval\` のようにここでは読まないコードが${ja.startsWith('`') ? ' ' : ''}${ja}いなければ）`,
    `, unless code that runs before it and is not read here, such as a file read with \`source\` or an \`eval\`, ${en}`] : ['', ''];
}

/** What code not read would do for a variable or a function another shell lacks: set or define it there. */
export const SETS_IT: readonly [string, string] = ['そこで設定して', 'sets it there'];
export const DEFINES_IT: readonly [string, string] = ['そこで定義して', 'defines it there'];

/**
 * The sentence added to a fact said in a file with no shebang (`readAs`: `unknown`), which something else than a run
 * of it as a script may read: `how` says who and what then happens, [ja, en] (ja ends with its own 。 or not).
 */
export function noShebang(sourced: boolean | undefined, [ja, en]: readonly [string, string], how: readonly [string, string]): readonly [string, string] {
  return sourced ? [`${ja}。ただし、このファイルにはシバンがないので、${how[0]}`, `${en}. But this file has no shebang: ${how[1]}`] : [ja, en];
}

/** Who reads a file with no shebang interactively, the start of `noShebang`'s `how`. */
export const READ_INTERACTIVELY: readonly [string, string] = ['`.bashrc` のように対話シェルが読むなら', 'read by an interactive shell, as `.bashrc` is,'];

/** `local-outside-function` in a trap's action (`trap`): it runs where the trap fires, which may be in a function. */
export function inTrap(trap: boolean | undefined, [ja, en]: readonly [string, string]): readonly [string, string] {
  return trap ? [
    `${ja}。ここはトラップの動作で、トラップが起きた場所で実行されるので、関数の中のこともあれば、関数の外のこともあります`,
    `${en}. This is a trap's action: it runs where the trap fires, which may be inside a function or outside one`] : [ja, en];
}
