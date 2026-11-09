import type { Lang } from '../i18n';
import { codeSpan } from '../label';
import { jaSpaced } from '../messages-sentence';
import { parseTargetPattern } from './bazel';
import { type EmbeddedToken, hasHole, holeToken, isHole, pick } from './types';

// buildozer's words (buildozer 10.2.0, bazel-contrib/buildtools; each fact checked with that release: test/buildozer.test.ts).
// An operand is a command when its first word, split at spaces and newlines as buildozer splits it (a `\ ` keeps a space),
// is the name of one of its commands (`add deps //x`); any other operand is a label, which names the rules a command
// works on (`//app:main`). Commands and labels may come in any order: buildozer runs every command on every label. A
// label is read as bazel writes a target (`parseTargetPattern`: `//pkg:name`, `pkg:name` from the current directory,
// `//pkg/...:name` in every package below), with buildozer's own names: `__pkg__` (the package itself), `*` and `all`
// (every rule), `%kind` (every rule of a kind), `%123` (the rule that starts on line 123), and the package `-` (the
// BUILD file on stdin, written back to stdout).

/** What an argument of a command is, by its place (`BuildozerCommand.roles`). */
type Role = 'attr' | 'value' | 'old-attr' | 'new-attr' | 'old-value' | 'new-value' | 'path' | 'symbol' | 'regexp' | 'template'
  | 'comment' | 'fix' | 'kind' | 'name' | 'position' | 'relative' | 'from' | 'key' | 'key-value' | 'print' | 'dev' | 'ext-file' | 'ext-name' | 'variable' | 'repo' | 'select';

/**
 * A command: the fewest and most arguments it takes (`max` absent: no limit; buildozer refuses the line otherwise, with
 * status 1), what it does, the role of each argument by how many there are, and whether it only prints (`print`: a run
 * of only such commands exits with 0 when nothing changed).
 */
interface BuildozerCommand { min: number; max?: number; text: readonly [string, string]; roles: (args: readonly string[]) => readonly Role[]; readOnly?: true }

/** The roles `fixed`, then `rest` for every argument after them. */
const then = (fixed: readonly Role[], rest?: Role) => (args: readonly string[]): Role[] =>
  args.map((_, i) => (i < fixed.length ? fixed[i] : rest ?? fixed[fixed.length - 1]));
/** `comment`, `print_comment`, `remove_comment`: an attribute and a value may come before the last (`<attr>? <value>? <comment>`). */
const optional = (last?: Role) => (args: readonly string[]): Role[] => {
  const before: Role[] = ['attr', 'value'];
  return last ? [...before.slice(0, args.length - 1), last] : before.slice(0, args.length);
};
/**
 * `use_repo_add` and `use_repo_remove`: a variable that holds a `use_extension` call, or a `.bzl` file and the extension's
 * name, with `dev` before them for the extensions used as `dev_dependency = True`; then the repositories. (buildozer
 * takes a word that starts with `@` or ends with `//` for the file of an extension.)
 */
const useRepo = (args: readonly string[]): Role[] => {
  const label = (w: string | undefined): boolean => w !== undefined && (w.startsWith('@') || w.endsWith('//'));
  const dev = args[0] === 'dev' && label(args[1]);
  const head: Role[] = [...(dev ? ['dev' as const] : []), ...(label(args[dev ? 1 : 0]) ? ['ext-file' as const, 'ext-name' as const] : ['variable' as const])];
  return then(head, 'repo')(args);
};

/** The commands of `edit.AllCommands` (buildozer 10.2.0), with their limits as buildozer checks them. */
export const BUILDOZER_COMMANDS: Readonly<Record<string, BuildozerCommand>> = {
  add: { min: 2, text: ['値をリストの属性に足す（すでにある値は足さない）', 'Adds the values to a list attribute (a value already in it is not added)'], roles: then(['attr'], 'value') },
  new_load: { min: 1, text: ['`load` 文を足して、記号を読み込む', 'Adds a `load` statement that imports the symbols'], roles: then(['path'], 'symbol') },
  replace_load: { min: 1, text: ['記号の `load` 文を、このファイルからの `load` に置き換える', 'Replaces the `load` statements of the symbols with one from this file'], roles: then(['path'], 'symbol') },
  substitute_load: { min: 2, max: 2, text: ['正規表現に一致する `load` のファイルを、置き換えの形に書き換える', 'Rewrites the files of the `load` statements the regex matches, by the template'], roles: then(['regexp', 'template']) },
  comment: { min: 1, max: 3, text: ['ルール・属性・リストの値にコメントを付ける', 'Adds a comment to the rule, an attribute, or a value of a list'], roles: optional('comment') },
  print_comment: { min: 0, max: 2, text: ['ルール・属性・リストの値のコメントを表示する', 'Prints the comment of the rule, an attribute, or a value of a list'], roles: optional(), readOnly: true },
  delete: { min: 0, max: 0, text: ['ルールを削除する', 'Deletes the rule'], roles: then([]) },
  fix: { min: 0, text: ['自動の修正を適用する（指定がなければ使えるものすべて）', 'Applies fixes (every one that applies, if none is named)'], roles: then(['fix']) },
  move: { min: 3, text: ['値をリストの属性から別のリストの属性へ移す（`*` はすべての値）', 'Moves the values from one list attribute to another (`*`: every value)'], roles: then(['old-attr', 'new-attr'], 'value') },
  new: { min: 2, max: 4, text: ['新しいルールを、ファイルの最後（または指定したルールの前か後ろ）に足す', 'Adds a new rule at the end of the file (or before or after the rule named)'], roles: then(['kind', 'name', 'position', 'relative']) },
  print: { min: 0, text: ['属性の値を表示する（ルールにない属性は標準エラー出力に警告）', 'Prints the values of the attributes (an attribute the rule lacks: a warning on stderr)'], roles: then(['print']), readOnly: true },
  print_all_lists: { min: 0, text: ['属性の値を表示する（`+` でつないだリストは1つのリストとして）', 'Prints the values of the attributes (lists joined with `+` as one list)'], roles: then(['print']), readOnly: true },
  remove: { min: 1, text: ['属性を削除する。値を書けば、その値をリストから削除する（`*` はすべての属性）', 'Removes the attribute, or, given values, removes them from the list (`*`: every attribute)'], roles: then(['attr'], 'value') },
  remove_comment: { min: 0, max: 2, text: ['ルール・属性・リストの値のコメントを削除する', 'Removes the comment of the rule, an attribute, or a value of a list'], roles: optional() },
  remove_if_equal: { min: 2, max: 2, text: ['属性の値が等しければ、その属性を削除する', 'Removes the attribute if its value is the one given'], roles: then(['attr', 'value']) },
  rename: { min: 2, max: 2, text: ['属性の名前を変える（新しい名前の属性はまだないこと）', 'Renames the attribute (no attribute may have the new name yet)'], roles: then(['old-attr', 'new-attr']) },
  replace: { min: 3, max: 3, text: ['リストの属性の値を置き換える（`*` はすべての属性）', 'Replaces a value in a list attribute (`*`: every attribute)'], roles: then(['attr', 'old-value', 'new-value']) },
  substitute: { min: 3, max: 3, text: ['リストの属性の、正規表現に一致する文字列を置き換えの形に書き換える（`*` はすべての属性）', 'Rewrites the strings of a list attribute the regex matches, by the template (`*`: every attribute)'], roles: then(['attr', 'regexp', 'template']) },
  set: { min: 1, text: ['属性の値を設定する（前の値は置き換わる。`set kind` はルールの種類を変える）', 'Sets the attribute\'s value, replacing the old one (`set kind`: changes the kind of the rule)'], roles: (args) => (args[0] === 'kind' ? ['attr', 'kind'] : then(['attr'], 'value')(args)) },
  set_if_absent: { min: 1, text: ['属性がなければ、その値を設定する', 'Sets the attribute\'s value if the rule does not have it yet'], roles: then(['attr'], 'value') },
  set_select: { min: 1, text: ['属性を `select()` にする（キーと値の組を並べる）', 'Sets the attribute to a `select()` of the keys and values given in pairs'], roles: then(['attr'], 'select') },
  copy: { min: 2, max: 2, text: ['属性の値を、同じパッケージの別のルールからこのルールに写す（ある値は置き換わる）', 'Copies the attribute from another rule of the package (overwriting it here)'], roles: then(['attr', 'from']) },
  copy_no_overwrite: { min: 2, max: 2, text: ['属性がなければ、その値を同じパッケージの別のルールから写す', 'Copies the attribute from another rule of the package, if this rule does not have it'], roles: then(['attr', 'from']) },
  dict_add: { min: 2, text: ['辞書の属性にキーと値を足す（あるキーは変えない）', 'Adds keys and values to a dict attribute (a key already there is kept)'], roles: then(['attr'], 'key-value') },
  dict_set: { min: 2, text: ['辞書の属性のキーの値を設定する（ある値は置き換わる）', 'Sets keys of a dict attribute (replacing their values)'], roles: then(['attr'], 'key-value') },
  dict_remove: { min: 2, text: ['辞書の属性からキーを削除する', 'Removes keys from a dict attribute'], roles: then(['attr'], 'key') },
  dict_replace_if_equal: { min: 4, max: 4, text: ['辞書の属性のキーの値が等しければ置き換える（`*` はすべてのキー）', 'Replaces the value of a key of a dict attribute if it is the one given (`*`: every key)'], roles: then(['attr', 'key', 'old-value', 'new-value']) },
  dict_list_add: { min: 3, text: ['辞書の属性の、キーのリストに値を足す', 'Adds values to the list of a key of a dict attribute'], roles: then(['attr', 'key'], 'value') },
  use_repo_add: { min: 2, text: ['拡張のリポジトリを `use_repo` で読み込む（`MODULE.bazel` だけ）', 'Imports the repositories of an extension with `use_repo` (`MODULE.bazel` only)'], roles: useRepo },
  use_repo_remove: { min: 2, text: ['拡張のリポジトリを `use_repo` から除く（`MODULE.bazel` だけ）', 'Removes the repositories of an extension from `use_repo` (`MODULE.bazel` only)'], roles: useRepo },
  format: { min: 0, max: 0, text: ['ほかのコマンドで変わらなくても、ファイルを整形する', 'Formats the file, even if no other command changed it'], roles: then([]) },
};

/** The special attributes of `print`, besides the rule's own. */
const PRINT_ATTRS: Readonly<Record<string, readonly [string, string]>> = {
  kind: ['ルールの種類（呼び出す関数の名前）', 'The kind of the rule (the name of the function called)'],
  attrs: ['ルールの属性の名前', 'The names of the rule\'s attributes'],
  label: ['ルールの完全なラベル', 'The rule\'s full label'],
  rule: ['ルールの定義全体', 'The whole definition of the rule'],
  startline: ['ルールが始まる行の番号', 'The line on which the rule starts'],
  endline: ['ルールが終わる行の番号', 'The line on which the rule ends'],
  path: ['ルールのある BUILD ファイルの絶対パス', 'The absolute path of the BUILD file of the rule'],
};

/**
 * An argument of a command, split as buildozer splits it: at spaces and newlines, where a `\` before one keeps it (`a\ b`
 * is one argument). Offsets into the text.
 */
interface Arg { start: number; end: number; text: string }

function splitArgs(text: string): Arg[] {
  const out: Arg[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === ' ' || text[i] === '\n') { i++; continue; }
    const start = i;
    while (i < text.length && text[i] !== ' ' && text[i] !== '\n') i += text[i] === '\\' && (text[i + 1] === ' ' || text[i + 1] === '\n') ? 2 : 1;
    out.push({ start, end: i, text: text.slice(start, i) });
  }
  return out;
}

/** The command a word of buildozer names, if it is one (its first argument is a command's name). */
export function buildozerCommand(text: string): string | undefined {
  const first = splitArgs(text)[0]?.text;
  return first !== undefined && Object.hasOwn(BUILDOZER_COMMANDS, first) ? first : undefined;
}

/** Whether an operand may be a command that changes a file (undefined: its text is not known), for the status 3. */
export function buildozerEdits(text: string | undefined): boolean {
  if (text === undefined) return true;
  const name = buildozerCommand(text);
  return !!name && !BUILDOZER_COMMANDS[name].readOnly;
}

/** The text of an argument by its role (`word`, as written). */
function roleText(role: Role, word: string, lang: Lang, command: string): string {
  const s = pick(lang);
  const w = codeSpan(word);
  switch (role) {
    case 'attr': {
      if (word === '*' && ['remove', 'replace', 'substitute'].includes(command)) return s('すべての属性（`*`）', 'Every attribute (`*`)');
      if (word === 'kind' && command === 'set') return s('属性ではない。`set kind` はルールの種類（呼び出す関数）を変える', 'Not an attribute: `set kind` changes the kind of the rule (the function it calls)');
      const typed = /^([^:]*):(.*)$/.exec(word);
      if (typed) {
        return typed[2] === 'expr'
          ? s(`属性 ${codeSpan(typed[1])}。\`:expr\` で、値を文字列にせず式のまま書く`, `The attribute ${codeSpan(typed[1])}; \`:expr\` writes the values as expressions, not as strings`)
          : s(`属性 ${codeSpan(typed[1])}。型 ${codeSpan(typed[2])} は buildozer が知らないので、「unknown attr type」で失敗する（\`expr\` だけ）`, `The attribute ${codeSpan(typed[1])}; buildozer knows no type ${codeSpan(typed[2])} and fails with "unknown attr type" (only \`expr\` is one)`);
      }
      return s(`属性 ${w}`, `The attribute ${w}`);
    }
    case 'value': return word === '*' && command === 'move' ? s('すべての値（`*`）', 'Every value (`*`)') : s(`値 ${w}`, `The value ${w}`);
    case 'old-attr': return s(`元の属性 ${w}`, `The attribute ${w} it comes from`);
    case 'new-attr': return s(`先の属性 ${w}`, `The attribute ${w} it goes to`);
    case 'old-value': return s(`元の値 ${w}`, `The old value ${w}`);
    case 'new-value': return s(`新しい値 ${w}`, `The new value ${w}`);
    case 'path': return s(`読み込む \`.bzl\` ファイル ${w}`, `The \`.bzl\` file to load, ${w}`);
    case 'symbol': return s(`読み込む記号 ${w}（\`別名=記号\` で名前を変える）`, `A symbol to import, ${w} (\`alias=symbol\` renames it)`);
    case 'regexp': return s(`正規表現（RE2）${w}`, `The regex (RE2) ${w}`);
    case 'template': return s(`置き換えの形 ${w}（\`$1\`・\`\${name}\` はグループ）`, `The template ${w} (\`$1\`, \`\${name}\`: groups)`);
    case 'comment': return s(`コメント ${w}（空白は \`\\ \` と書く）`, `The comment ${w} (a space is written \`\\ \`)`);
    case 'fix': return s(`適用する修正 ${w}`, `A fix to apply, ${w}`);
    case 'kind': return s(`ルールの種類 ${w}`, `The kind of the rule, ${w}`);
    case 'name': return s(`ルールの名前 ${w}`, `The name of the rule, ${w}`);
    case 'position': return word === 'before' || word === 'after' ? s(`次のルールの${word === 'before' ? '前' : '後ろ'}に置く`, `Put it ${word} the rule that follows`) : s(`置く位置 ${w}（\`before\` か \`after\`）`, `Where to put it, ${w} (\`before\` or \`after\`)`);
    case 'relative': return s(`このルールを基準に置く: ${w}（\`__pkg__\` は \`package()\`）`, `The rule it is put next to, ${w} (\`__pkg__\`: \`package()\`)`);
    case 'from': return s(`写す元のルール ${w}`, `The rule to copy from, ${w}`);
    case 'key': return word === '*' ? s('すべてのキー（`*`）', 'Every key (`*`)') : s(`キー ${w}`, `The key ${w}`);
    case 'key-value': return s(`キーと値 ${w}（\`キー:値\`。中の \`:\` は \`\\:\` と書く）`, `A key and value, ${w} (\`key:value\`; a \`:\` in them is written \`\\:\`)`);
    case 'print': {
      const special = Object.hasOwn(PRINT_ATTRS, word) ? PRINT_ATTRS[word] : undefined;
      return special ? s(special[0], special[1]) : s(`属性 ${w} の値`, `The value of the attribute ${w}`);
    }
    case 'dev': return s('`dev_dependency = True` の拡張の使い方を対象にする', 'The uses of the extension with `dev_dependency = True`');
    case 'ext-file': return s(`拡張を定義する \`.bzl\` ファイル ${w}`, `The \`.bzl\` file that defines the extension, ${w}`);
    case 'ext-name': return s(`拡張の名前 ${w}`, `The name of the extension, ${w}`);
    case 'variable': return s(`\`use_extension\` の結果を持つ変数 ${w}`, `The variable that holds a \`use_extension\` call, ${w}`);
    case 'repo': return s(`リポジトリ ${w}`, `The repository ${w}`);
    case 'select': return s(`\`select()\` のキーか値 ${w}（キー・値の順に交互に）`, `A key or a value of the \`select()\`, ${w} (keys and values in turn)`);
  }
}

/** Explain a word that is a command: its name, and each argument by its role; an error where buildozer refuses it. */
function explainCommand(text: string, name: string, lang: Lang): { tokens: EmbeddedToken[]; note?: string } {
  const s = pick(lang);
  const c = BUILDOZER_COMMANDS[name];
  const [head, ...args] = splitArgs(text);
  const tokens: EmbeddedToken[] = [];
  // (A hole may give no argument, or several: buildozer splits its value at spaces. The arguments after one are not placed.)
  const holed = args.findIndex((a) => hasHole(a.text));
  const placed = holed < 0 ? args : args.slice(0, holed);
  const count = args.length;
  const few = holed < 0 && count < c.min;
  const many = holed < 0 && c.max !== undefined && count > c.max;
  const limit = few ? s(`引数を少なくとも ${c.min} 個取る`, `takes at least ${c.min} arguments`) : c.max ? s(`引数を多くて ${c.max} 個取る`, `takes at most ${c.max} arguments`) : s('引数を取らない', 'takes no arguments');
  tokens.push(few || many
    ? { start: head.start, end: head.end, kind: 'error', children: [], explanation: s(`\`${name}\` は${limit}。buildozer は「Too ${few ? 'few' : 'many'} arguments for command '${name}'」で、ファイルを変えずに止まる（終了ステータス 1）`, `\`${name}\` ${limit}: buildozer stops with "Too ${few ? 'few' : 'many'} arguments for command '${name}'", changing no file (status 1)`) }
    : { start: head.start, end: head.end, kind: 'keyword', children: [], explanation: s(`buildozer のコマンド: ${c.text[0]}`, `buildozer's command: ${c.text[1]}`) });
  const roles = c.roles(placed.map((a) => a.text));
  for (const [i, a] of placed.entries()) {
    const role = roles[i];
    // (An argument past the most a command takes has no role: the line is refused.)
    if (c.max !== undefined && i >= c.max) break;
    // (`set_if_absent` cannot set the kind: buildozer fails on each rule.)
    const refused = name === 'set_if_absent' && i === 0 && a.text === 'kind';
    tokens.push({ start: a.start, end: a.end, kind: refused ? 'error' : role === 'regexp' ? 'pattern' : /attr|print|key$/.test(role) ? 'variable' : 'string', children: [],
      explanation: refused ? s('`set_if_absent` ではルールの種類は設定できない。buildozer は「setting \'kind\' is not allowed for set_if_absent」で失敗する', '`set_if_absent` cannot set the kind: buildozer fails with "setting \'kind\' is not allowed for set_if_absent"') : roleText(role, a.text, lang, name) });
  }
  for (const a of args.slice(placed.length)) {
    for (let k = a.start; k < a.end; k++) if (isHole(text[k])) tokens.push(holeToken(k, 'buildozer'));
  }
  return { tokens };
}

/** The name of a label after `:`, as buildozer reads it (`expandTargets`). */
export type LabelName = { kind: 'pkg' } | { kind: 'all'; written: string } | { kind: 'type'; type: string } | { kind: 'line'; line: number } | { kind: 'rule'; name: string; implied?: true };

function nameOf(name: string): LabelName {
  if (name === '__pkg__') return { kind: 'pkg' };
  // (`%` alone is a kind of no name: every rule.)
  if (name === '*' || name === 'all' || name === '%') return { kind: 'all', written: name };
  if (name.startsWith('%')) return /^%\d+$/.test(name) ? { kind: 'line', line: Number(name.slice(1)) } : { kind: 'type', type: name.slice(1) };
  return { kind: 'rule', name };
}

/** The file names buildozer takes for a package's BUILD file (`BuildFileNames`): a label that ends with one names the file itself. */
const BUILD_FILES = ['BUILD.bazel', 'BUILD'];

/**
 * A label as buildozer reads it. `from`: where the file is, `stdin` (the package `-`), from the top of the workspace (`//`,
 * or `@//`), or from the current directory. `dir`: the package's directory (or a file named as the package:
 * `//MODULE.bazel:all`, which buildozer reads when the directory has no BUILD file). `file`: the package's BUILD file,
 * every one in `dir` and below (`/...`), or the BUILD file named (`//app/BUILD`, which is `//app:__pkg__`). `name`: the
 * rules it selects. `refused`: what fails on every file (another repository: no file is found; `//lib/...` with no name,
 * which looks for a rule named `...`). The offsets: the `-` or the repository, the package, the name (from its `:`).
 */
export interface BuildozerLabel {
  from: 'stdin' | 'top' | 'here';
  dir: string;
  file: 'package' | 'recursive' | 'named';
  name: LabelName;
  headAt?: [number, number];
  pkgAt?: [number, number];
  nameAt?: [number, number];
  refused?: { why: 'repo' | 'dots-no-name'; at: [number, number] };
}

/**
 * Read a label of buildozer; undefined where the text is none (blanks in it, a `-` before a pattern, `@repo` alone), or
 * one it reads otherwise than its form says (an empty name after `-:` or a relative package, `app:`, which names the rule
 * `app` of the current directory).
 */
export function parseBuildozerLabel(text: string): BuildozerLabel | undefined {
  if (text.startsWith('-:')) return text.length > 2 ? { from: 'stdin', dir: '', file: 'package', name: nameOf(text.slice(2)), headAt: [0, 1], nameAt: [1, text.length] } : undefined;
  const p = parseTargetPattern(text);
  if (!p || p.negative) return undefined;
  const from = p.absolute ? 'top' : 'here';
  // (Only the main repository: buildozer reads no other's files.)
  if (p.repo && (p.repo.name || p.repo.canonical)) return { from, dir: p.pkg, file: 'package', name: { kind: 'all', written: '*' }, refused: { why: 'repo', at: p.repo.at } };
  const headAt = p.repo?.at;
  // (A path that ends with a BUILD file's name, `app/BUILD`, names that file: buildozer reads it as `app:__pkg__`.)
  const last = p.pkg.slice(p.pkg.lastIndexOf('/') + 1);
  const pkgAt: [number, number] = [p.pkgAt[0], p.dotsAt?.[1] ?? p.pkgAt[1]];
  if (!p.nameAt && !p.recursive && p.pkg.includes('/') && BUILD_FILES.includes(last)) return { from, dir: p.pkg.slice(0, p.pkg.length - last.length - 1), file: 'named', name: { kind: 'pkg' }, headAt, pkgAt };
  // (No `:`, not from the top: the name of a rule of the current directory's package, `/` and all: `main`, `a/b`.)
  if (p.ambiguous) return { from, dir: '', file: 'package', name: nameOf(text), nameAt: [0, text.length] };
  if (p.recursive) {
    // (`//lib/...` and `//lib/...:` look for a rule named `...`: the refusal is on `/...` and the `:`, the package before it.)
    if (!p.name) return { from, dir: p.pkg, file: 'recursive', name: { kind: 'rule', name: '...' }, headAt, pkgAt: p.pkgAt, refused: { why: 'dots-no-name', at: [p.dotsAt![0], text.length] } };
    return { from, dir: p.pkg, file: 'recursive', name: nameOf(p.name), headAt, pkgAt, nameAt: p.nameAt };
  }
  // (No name, or none after `:` (`//app:`): the rule named like the package's last directory, as bazel's `//app`.)
  if (!p.name) return p.absolute ? { from, dir: p.pkg, file: 'package', name: { kind: 'rule', name: last, implied: true }, headAt, pkgAt, nameAt: p.nameAt } : undefined;
  return { from, dir: p.pkg, file: 'package', name: p.nameAt ? nameOf(p.name) : { kind: 'rule', name: p.name, implied: true }, headAt, pkgAt, nameAt: p.nameAt };
}

/** Explain a word that is a label: the file it names, the rules it selects. */
function explainLabel(text: string, lang: Lang): { tokens: EmbeddedToken[]; note?: string } | undefined {
  // (The Japanese texts join code spans and words: `jaSpaced` puts the blanks between them.)
  const s = (ja: string, en: string): string => (lang === 'ja' ? jaSpaced(ja) : en);
  const l = parseBuildozerLabel(text);
  if (!l) return undefined;
  const tokens: EmbeddedToken[] = [];
  const push = ([start, end]: [number, number], kind: EmbeddedToken['kind'], explanation: string): void => {
    if (end > start) tokens.push({ start, end, kind, explanation, children: [] });
  };
  const up = (t: string): string => t[0].toUpperCase() + t.slice(1);
  const refused = l.refused?.why;
  if (refused === 'repo') {
    push(l.refused!.at, 'error', s('buildozer はメインのワークスペースのファイルだけを読む。ほかのリポジトリは「file not found」で失敗する', 'buildozer reads only the files of the main workspace: another repository fails with "file not found"'));
    return { tokens };
  }
  if (l.headAt) push(l.headAt, 'keyword', l.from === 'stdin' ? s('標準入力から読む BUILD ファイル（変えた結果は標準出力へ）', 'The BUILD file read from stdin (the result goes to stdout)') : s('メインのリポジトリ', 'The main repository'));
  const where = l.from === 'top' ? ['ワークスペースの最上位からの', 'from the top of the workspace'] : ['今のディレクトリからの', 'from the current directory'];
  const at = (d: string): string => s(`${where[0]} ${codeSpan(d || '.')}`, `${codeSpan(d || '.')} (${where[1]})`);
  const last = l.dir.slice(l.dir.lastIndexOf('/') + 1);
  // (A file named as the package, where it looks like one: buildozer reads `pkg/BUILD.bazel` or `pkg/BUILD` when there is one, else `pkg` itself.)
  const asFile = l.file === 'package' && (last.includes('.') || last === 'WORKSPACE');
  const file = l.from === 'stdin' ? s('標準入力の BUILD ファイル', 'the BUILD file on stdin')
    : !l.pkgAt ? s('今のディレクトリの BUILD ファイル', 'the BUILD file of the current directory')
      : l.file === 'named' ? s(`${where[0]} BUILD ファイル ${codeSpan(text.slice(...l.pkgAt).replace(/^\/\//, ''))}`, `the BUILD file ${codeSpan(text.slice(...l.pkgAt).replace(/^\/\//, ''))} (${where[1]})`)
        : l.file === 'recursive' ? s(`${at(l.dir)}とその下のすべての BUILD ファイル`, `every BUILD file in ${at(l.dir)} and below`)
          : asFile ? s(`${where[0]}ファイル ${codeSpan(l.dir)}（BUILD ファイルとして読む）`, `the file ${codeSpan(l.dir)} (${where[1]}), read as a BUILD file`)
            : s(`${at(l.dir)}の BUILD ファイル`, `the BUILD file of ${at(l.dir)}`);
  if (l.pkgAt) push(l.pkgAt, 'string', up(file));
  if (refused === 'dots-no-name') {
    push(l.refused!.at, 'error', s('`...` の後には `:` と名前を書く（`//lib/...:*`）。buildozer は各パッケージで `...` という名前のルールを探して失敗する', 'After `...`, write `:` and a name (`//lib/...:*`): buildozer looks for a rule named `...` in each package, and fails'));
    return { tokens };
  }
  const name = l.name;
  const what = name.kind === 'pkg' ? s('パッケージそのもの（`package()` の呼び出し。ファイル全体に働くコマンドでは、そのファイル）', 'the package itself (its `package()` call; for the commands that work on the whole file, the file)')
    : name.kind === 'all' ? s(`すべてのルール${name.written === 'all' ? '（`all` という名前のルールがなければ）' : ''}`, `every rule${name.written === 'all' ? ' (unless a rule is named `all`)' : ''}`)
      : name.kind === 'type' ? s(`種類が ${codeSpan(name.type)} のすべてのルール`, `every rule of the kind ${codeSpan(name.type)}`)
        : name.kind === 'line' ? s(`行 ${name.line} で始まるルール`, `the rule that starts on line ${name.line}`)
          : name.implied ? s(`パッケージと同じ名前のルール ${codeSpan(name.name)}`, `the rule named like the package, ${codeSpan(name.name)}`)
            : s(`ルール ${codeSpan(name.name)}`, `the rule ${codeSpan(name.name)}`);
  if (l.nameAt) push(l.nameAt, name.kind === 'rule' ? 'string' : 'operator', up(what));
  const note = s(`${file}の${what}`, `${up(what)}${name.kind === 'rule' && name.implied ? ',' : ''} in ${file}`);
  // (A word that is one part says it on the word.)
  return tokens.length === 1 && tokens[0].start === 0 && tokens[0].end === text.length ? { tokens: [], note } : { tokens, note };
}

/** Explain an operand of buildozer: a command (`add deps //x`), or a label (`//app:main`). */
export function explainBuildozerWord(text: string, lang: Lang): { tokens: EmbeddedToken[]; note?: string } | undefined {
  const args = splitArgs(text);
  const s = pick(lang);
  // (Blanks only: buildozer stops with "empty command list", status 1.)
  if (!args.length) return text ? { tokens: [{ start: 0, end: text.length, kind: 'error', children: [], explanation: s('空のコマンド。buildozer は「empty command list」で、ファイルを変えずに止まる（終了ステータス 1）', 'An empty command: buildozer stops with "empty command list", changing no file (status 1)') }] } : undefined;
  // (A hole in the first argument decides what the word is.)
  if (hasHole(args[0].text)) return { tokens: [] };
  const name = buildozerCommand(text);
  if (name) return explainCommand(text, name, lang);
  // (A label has no blanks: a word of several arguments meant a command, `ad deps x`.)
  if (args.length > 1) {
    const w = codeSpan(args[0].text);
    return { tokens: [{ start: args[0].start, end: args[0].end, kind: 'error', children: [], explanation: s(`${w} は buildozer のコマンドではないので、buildozer はこの語全体をラベルとして読み、そのルールか BUILD ファイルが見つからずに失敗する（終了ステータス 2）`, `${w} is no command of buildozer: it reads the whole word as a label, finds no such rule or BUILD file, and fails (status 2)`) }] };
  }
  return explainLabel(text, lang);
}
