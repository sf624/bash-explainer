// The operands of a command (src/explain/argv.ts calls these from `render`): numbered operands, a job, the variable of an assignment,
// the names that a declaration builtin declares and `unset` removes.

import type { Token } from '../analyzer-types';
import { type ArgRole, type ArgvParse, type FieldsRole } from '../argv/interpret';
import { namespaceOf } from '../argv/query';
import { OPTION_ROLES } from '../argv/regroup';
import { asBash } from '../shellfeatures';
import { validName } from '../semantics/posixexits';
import type { CommandSpec, OperandSpec, VariableAct } from '../argv/spec';
import { builtins } from '../dict/builtins';
import { hasGlob } from '../embedded/glob';
import { braceTexts } from '../semantics/brace';
import { fact } from '../messages';
import { nodeSections } from '../refs';
import { attribute } from '../semantics/state';
import { readDeclarationWords, unsetEndsSpecial } from '../semantics/vars';
import { isPlainWord, plainText, staticWordValue } from '../staticword';
import { field, fields, prefixAssignments, type SyntaxNode } from '../syntax/tree';
import { assignment } from './assignments';
import type { Explainer } from './context';
import { skeletal } from './nodes';
import { type ExpansionStep, wordFields } from '../semantics/words';
import { fieldsIn } from '../semantics/argwords';
import { arrayKind, shoptAt, wordAt } from './reads';
import { eachText, fieldsText, functionArgs, listed, numbered, readingsParts, SHIFTS } from './operand-texts';
import { inSubshell } from './where';
import { elementWord, word } from './words';
import { dash, expanded, optionRefs, own, positional, wordParts } from './argv-shared';

/** What a job spec such as `%1`, `%%`, `%-`, `%vim` or `%?foo` means; undefined for other words. */
function jobSpec(text: string): { ja: string; en: string } | undefined {
  if (!text.startsWith('%') || text.length < 2) return undefined;
  const rest = text.slice(1);
  if (/^\d+$/.test(rest)) return { ja: `ジョブ番号 ${rest}（\`jobs\` の \`[${rest}]\`）`, en: `job number ${rest} (\`[${rest}]\` in \`jobs\`)` };
  if (rest === '%' || rest === '+') return { ja: '現在のジョブ（最後にバックグラウンドへ送った、または停止したジョブ）', en: 'the current job (the last one sent to the background or stopped)' };
  if (rest === '-') return { ja: '1つ前のジョブ', en: 'the previous job' };
  if (rest.startsWith('?')) return { ja: `コマンドに \`${rest.slice(1)}\` を含むジョブ`, en: `the job whose command contains \`${rest.slice(1)}\`` };
  return { ja: `コマンドが \`${rest}\` で始まるジョブ`, en: `the job whose command starts with \`${rest}\`` };
}

/**
 * The token of a word read as the fields the model knows it gives (`FieldsRole`): what each is to `command` (`x='-r a';
 * cp $x d`: "expands to `-r` (option: …) and `a` (source)"), or that no word is left, so the command does not get it
 * (`z=; cp $z c`); to a function (`isFn`), its arguments. An option's token where every field is one.
 */
export function fieldsToken(cx: Explainer, a: SyntaxNode, role: FieldsRole, command: string, isFn: boolean | 'maybe', nodes: SyntaxNode[], numbers: ReadonlyMap<ArgRole, { n: number }> = new Map()): Token {
  const program = command.split(' ')[0].split('/').pop()!;
  // (A function gets every word as an argument, also one that looks like an option.)
  if (isFn && role.words.length) return positional(cx, a, functionArgs(cx, nodes, nodes.indexOf(a)));
  // (`unset {,}`: the braces say so.)
  if (!role.words.length) return positional(cx, a, braceTexts([a], false, cx.bashVersion)?.every((w) => !w) ? noWord(cx) : cx.s(`展開すると語が残らないので、\`${program}\` には渡らない`, `expands to no word, so \`${program}\` does not get it`));
  // (A field's role may depend on how many words the others give: `p='a b'; cp $p $u`, `b` is the destination when `$u` gives none.)
  const t = positional(cx, a, fieldsText(cx, role, a, nodes, (desc, r) => numbered(desc, numbers.get(r))));
  const options = role.roles.every(({ role: r }) => OPTION_ROLES.has(r.role));
  return options ? { ...t, kind: 'option' } : t;
}

/** The token of an operand: what the spec says it is, numbered (`$1`), or as a job spec, a shell option, an assignment. */
export function operandToken(cx: Explainer, nodes: SyntaxNode[], word: number, role: Extract<ArgRole, { role: 'operand' }>, parse: ArgvParse, spec: CommandSpec, at: { n: number; sure: boolean; each?: { n: number; sure: boolean }[] }, assigned: string[], isFn: boolean | 'maybe'): Token {
  const a = nodes[word];
  const item = role.spec;
  // `unset NAME`, `declare NAME=value`: what the name stands for, as bash decides it here.
  if (item?.acts === 'unsets') return unsetOperand(cx, nodes, word, item, namespaceOf(parse, item), parse);
  if (item?.acts === 'declares') return declaredOperand(cx, a, namespaceOf(parse, item), parse.command);
  // `env FOO=1 cmd`: an assignment for the command, not the command.
  if (item?.assignment) {
    const name = a.text.slice(0, a.text.indexOf('='));
    assigned.push(name);
    return cx.tok(a, 'argument', cx.text('operand-env-assignment', { name }), wordParts(cx, a));
  }
  // `%1`, `%%`, `%name`: a job, not a file or a PID.
  const job = item?.type === 'job' && isPlainWord(a) ? jobSpec(a.text) : undefined;
  if (job) return cx.tok(a, 'argument', cx.text('operand-job-spec', { job }));
  let desc: string | undefined;
  // (A function gets every word, also those that look like options: `f -g b` gives `b` as $2.)
  if (isFn) desc = functionArgs(cx, nodes, word);
  else if (item?.values && Object.hasOwn(item.values, a.text)) desc = cx.t(item.values[a.text]);
  else if (role.assignment) desc = cx.t(item!.assignmentText!);
  else if (role.each) desc = eachText(cx, a, role.each, at.each!, fieldsIn(a, cx.state));
  else if (item) {
    const text = cx.t(item.text);
    desc = text.replace('`$N`', `\`$${at.n}\``);
    // (`p='a b'; set -- $p`: `$1` and `$2`, one for each field the model knows.)
    const fields = desc !== text ? fieldsIn(a, cx.state) : undefined;
    if (fields && fields.length > 1) desc = listed(cx, fields.map((f, k) => `\`${f}\`${cx.s(`（${text.replace('`$N`', `\`$${at.n + k}\``)}）`, ` (${text.replace('`$N`', `\`$${at.n + k}\``)})`)}`));
    if (desc !== text && !at.sure) desc += SHIFTS(cx);
  }
  // (Its readings: `cp -t $d $a b`, the value of `-t` when `$d` and `$a` give none; `tar -cf $a b`, a word the spec does not
  // describe. The clauses come after the note on its language, of the reading as written: `grep -d $v a b`.)
  const [own, lang] = [desc ?? cx.s(`文字列 \`${a.text}\``, `Word \`${a.text}\``), isFn ? undefined : item?.lang];
  const parts = isFn ? undefined : readingsParts(cx, own, role.readings, word, nodes);
  if (parts && (parts.rest || parts.base !== own)) desc = parts.base + (lang ? '' : parts.rest);
  // (A function named like a declaration builtin, or `alias`, given `a=…`: bash's parser marked the word.)
  // (Not the operand's meaning when bash assigns an array and passes only the name: `alias b=(1 2)`.)
  const named = isFn || field(a, 'value')?.type !== 'array' ? desc : undefined;
  if (a.type === 'variable_assignment') return markedAssignment(cx, a, named ?? cx.s(`引数 \`${a.text}\``, `Argument \`${a.text}\``), parse.command, isFn);
  const t = positional(cx, a, desc, lang);
  const late = lang && parts?.rest ? { ...t, explanation: t.explanation + parts.rest } : t;
  return isFn ? late : { ...late, ...optionRefs(item?.values, a.text) };
}

/**
 * `a=…` passed to a command that does not declare it, after a name written as a declaration builtin or `alias`:
 * a function of that name (`isFn`; `maybe`: defined on some paths only) or `alias`. bash expands it as an assignment
 * (not split), and gives it whole: nothing is assigned. `a=(…)` is assigned as an array, and the command gets the
 * name `a` only (`alias` then fails on it: `alias: a: not found`). `declare`, `local` and `typeset` assign it as the
 * builtin would, with its options (`-g`: global; else local in a function); `export`, `readonly` and `alias`, to the
 * variable visible here. Checked with bash 5.2.
 */
function markedAssignment(cx: Explainer, a: SyntaxNode, desc: string, command: string, isFn: boolean | 'maybe'): Token {
  const name = field(a, 'name')!.text;
  const value = field(a, 'value');
  const sentences: string[] = [];
  if (value?.type === 'array') {
    // (`declare -g b=(…)`: the options count, as for the builtin.)
    const global = readDeclarationWords('declare', fields(a.parent!, 'argument'), cx.state.shell).on.includes('g');
    const assigns = !builtins[command]?.locals
      ? cx.s(`bash は配列 \`${name}\` を代入する。代入先はここで見える変数（関数のローカル変数があればそれ、なければグローバル変数）で、属性は付かない`,
        `bash assigns the array \`${name}\`. It is the variable visible here: a local one if there is one, else the global one, with no attribute`)
      : global ? cx.s(`bash は \`${command} -g\` と同じく、配列 \`${name}\` をグローバル変数として代入する`, `bash assigns the array \`${name}\` as \`${command} -g\` would: a global variable`)
        : cx.s(`bash は \`${command}\` と同じく配列 \`${name}\` を代入する。関数の中ならそのローカル変数になる`, `bash assigns the array \`${name}\` as \`${command}\` would. In a function, it is a local variable`);
    if (!isFn) {
      sentences.push(assigns, cx.s(`\`alias\` には名前 \`${name}\` だけが渡り、\`alias: ${name}: not found\` で失敗する`, `\`alias\` gets only the name \`${name}\`, and fails: \`alias: ${name}: not found\``));
    } else {
      sentences.push(isFn === 'maybe' ? cx.s(`関数が動く場合、${assigns}`, `If the function runs, ${assigns}`) : assigns, cx.s(`関数には名前 \`${name}\` だけが渡る`, `The function gets only the name \`${name}\``));
      if (isFn === 'maybe') sentences.push(cx.s('動かなければビルトインが代入する', 'Otherwise the builtin assigns it'));
    }
  } else {
    sentences.push(cx.s('コマンド名が宣言ビルトインの綴りなので、この語は代入と同じく展開される。単語分割もグロブ展開もされない', 'The command name is spelled as a declaration builtin, so this word is expanded as an assignment would be: no word splitting, no globbing'));
    sentences.push(isFn === 'maybe' ? cx.s('関数が動くなら代入はされず、動かなければビルトインが代入する', 'If the function runs, nothing is assigned; otherwise the builtin assigns it')
      : cx.s('代入はされない', 'Nothing is assigned'));
  }
  return cx.tok(a, 'argument', [desc, ...sentences].join(cx.sep()), cx.sub(value));
}

/** What a declaration builtin `command` does with its word `a`, whose braces bash expands or may expand (`local {a,b}`, see `bracedUnset`). */
function bracedDeclare(cx: Explainer, a: SyntaxNode, step: ExpansionStep, command: string): string {
  if (step.applies === 'unknown') {
    return step.why === 'braceexpand-off'
      ? cx.s(`ブレース展開が行われれば、展開後の各語を \`${command}\` が受け取る。${OFF_JA}、そのときは \`${a.text}\` を1語のまま受け取る`,
        `If brace expansion takes place here, \`${command}\` takes each word it gives. ${OFF_EN}, and then it takes \`${a.text}\` as one word`)
      : cx.s(`ブレース展開後の各語を \`${command}\` が受け取る（${WHICH_JA}）`, `\`${command}\` takes each word the braces give (${WHICH_EN})`);
  }
  const names = wordFields(a, cx.state).fields;
  if (!names) return cx.s(`ブレース展開のあと、各語を \`${command}\` が受け取る（ここでは語が決まらない）`, `The braces expand first, and \`${command}\` takes each word (the words are not known here)`);
  return cx.s(`ブレース展開のあと、各語を \`${command}\` が受け取る: ${names.map((n) => `\`${n}\``).join('・')}`, `The braces expand first, and \`${command}\` takes each word: ${names.map((n) => `\`${n}\``).join(', ')}`);
}

/** A word whose braces give only empty words, which are dropped (`{,}`). */
const noWord = (cx: Explainer): string => cx.s('ブレース展開で空の語だけになり、取り除かれるので、何も渡らない', 'The braces give only empty words, which are dropped: nothing is passed');

// Why brace expansion may not take place (`step.applies` unknown): `set +B` on some paths, or a word of kinds this shell
// expands only some of (mksh: `{a,b}`, not `{1..2}`).
const OFF_JA = '行われないこともあり（この前の一部の経路で `set +B` によって無効になっている）';
const OFF_EN = 'It may not (`set +B` turns it off on some paths before)';
const WHICH_JA = 'このシェルがどのブレースを展開するかは、ここでは分からない';
const WHICH_EN = 'which of them this shell expands is not known here';

/**
 * A name that a declaration builtin declares (`OperandSpec.acts`): `declare a=1` assigns it (a nameref's target with
 * `-n`), `declare x` names the variable, `declare -f f` the function. A word that is not a plain name is explained
 * as its word (`\declare "a"=$v`: an argument, split as any other).
 */
function declaredOperand(cx: Explainer, a: SyntaxNode, space: ReturnType<typeof namespaceOf>, command: string): Token {
  if (a.type === 'variable_assignment') {
    const t = skeletal(assignment(cx, a, space === 'nameref'), a, true);
    t.refs = nodeSections(a);
    return t;
  }
  const assigned = space === 'function' ? undefined : argumentAssignment(cx, a, command);
  if (assigned) return assigned;
  // `local {a,b}`, `local a{1..3}`: bash expands the braces first, and the builtin takes each word.
  const braces = wordAt(cx, a)?.steps.find((g) => g.kind === 'brace');
  if (braces && braces.applies !== false) return positional(cx, a, bracedDeclare(cx, a, braces, command));
  if (a.type !== 'word' && !elementWord(a)) return cx.explain(a);
  const element = /^([A-Za-z_]\w*)\[(.+)\]$/s.exec(a.text);
  // (`export 1x=2`, `readonly -p a-b`: no variable's name, as bash reads the word (`export x\=1` exports `x`); `declare
  // -p 1x` says "not found", as below; `local -` makes the options local (`localOptions`). Checked with bash 5.2 and 5.3;
  // in POSIX mode bash 5.3 exits, as a note says.)
  const written = staticWordValue(a, false, cx.shell);
  if (space !== 'function' && !element && written !== undefined && !validName(/^[^=]*?(?=\+?=|$)/.exec(written)![0]) && !(written === '-' && builtins[command].localOptions)
    && !(builtins[command].locals && readDeclarationWords(command, fields(a.parent!, 'argument'), cx.state.shell).on.includes('p'))) {
    return cx.tok(a, 'variable', cx.text('declare-invalid-name'));
  }
  if (space === 'function' || !element) {
    return cx.tok(a, 'variable', space === 'function' ? cx.text('declare-function-target', { name: a.text }) : cx.text('declare-variable-target', { name: a.text }));
  }
  // `declare x[3]` declares the array `x`, and bash ignores the subscript (6.7); `export` and `readonly` refuse the word,
  // and `declare -p` finds no such name. Checked with bash 5.2 and 5.3.
  const text = readDeclarationWords(command, fields(a.parent!, 'argument'), cx.state.shell).on.includes('p')
    ? cx.rests(cx.s(`\`${a.text}\` という名前の変数はないので、何も表示しない（「not found」で終了ステータス 1）`, `No variable is named \`${a.text}\`: nothing is printed ("not found", status 1)`), 'declare-p-subscript')
    : builtins[command].locals ? cx.s(`配列 \`${element[1]}\` を宣言する（bash は添字 \`[${element[2]}]\` を無視する）`, `Declare the array \`${element[1]}\` (bash ignores the subscript \`[${element[2]}]\`)`)
    : cx.rests(cx.s('bash はこの語を受け付けない: 変数の名前として正しくない（「not a valid identifier」で終了ステータス 1）', 'Bash refuses this word: it is not a valid variable name ("not a valid identifier", status 1)'), 'export-subscript-refused');
  // (Unquoted, it is a glob first: `declare a[1]` with a file `a1` here declares the variable `a1`.)
  return wordAt(cx, a)?.steps.find((g) => g.kind === 'glob')?.applies !== false ? positional(cx, a, nameGlob(cx, a, a.text, text, 'declares')) : cx.tok(a, 'variable', text);
}

/**
 * `NAME=VALUE` that bash passes as an ordinary argument, since the command name is not a declaration builtin as
 * written (`command declare k=1`, `builtin export x=$v`): the builtin reads it as an assignment, but bash expanded it
 * as any other word, so an unquoted expansion in it was split and globbed. Checked with bash 5.2: with `y='1 2'`,
 * `command declare z=$y` sets `z` to `1` and fails on `2`.
 */
function argumentAssignment(cx: Explainer, a: SyntaxNode, command: string): Token | undefined {
  const first = a.type === 'concatenation' ? a.namedChildren[0] : a;
  const m = first?.type === 'word' ? /^([A-Za-z_]\w*)(\+?=)/.exec(first.text) : null;
  if (!m) return undefined;
  const [, name, op] = m;
  const value = a.text.slice(m[0].length);
  const word = wordAt(cx, a);
  const split = word?.steps.find((g) => g.kind === 'split')?.applies;
  const what = op === '+=' ? cx.s(`変数 \`${name}\` に \`${value}\` を追記する`, `Append \`${value}\` to the variable \`${name}\``)
    : cx.s(`変数 \`${name}\` に \`${value}\` を代入する`, `Assign \`${value}\` to the variable \`${name}\``);
  // (In POSIX mode, after `command`, bash expands it as an assignment: the word model's context, `assignmentAfterCommand`.)
  if (word?.context === 'declaration-assignment') {
    return cx.tok(a, 'assignment', cx.text('declare-assignment-posix', { what, command }), a.type === 'concatenation' ? cx.sub(a).flatMap((t) => t.children) : []);
  }
  return cx.tok(a, 'assignment', cx.text('declare-assignment-argument', { what, command, split: !!split }), a.type === 'concatenation' ? cx.sub(a).flatMap((t) => t.children) : []);
}

/**
 * What `unset` does with its word `a`, whose braces bash expands (`applies`: true) or may expand (`'unknown'`: `set +B` on
 * some paths before): each word they give is a name (`unset {a,b}` unsets `a` and `b`), listed when the word model knows them.
 */
function bracedUnset(cx: Explainer, a: SyntaxNode, step: ExpansionStep, space: ReturnType<typeof namespaceOf>): string {
  if (step.applies === 'unknown') {
    return step.why === 'braceexpand-off'
      ? cx.s(`ブレース展開が行われれば、展開後の各語を名前として削除する。${OFF_JA}、そのときは \`${a.text}\` が1つの名前になる`,
        `If brace expansion takes place here, each word it gives is a name to unset. ${OFF_EN}, and then \`${a.text}\` is one name`)
      : cx.s(`ブレース展開後の各語を名前として削除する（${WHICH_JA}）`, `Each word the braces give is a name to unset (${WHICH_EN})`);
  }
  const names = wordFields(a, cx.state).fields;
  if (!names) return cx.s('ブレース展開のあと、各語を名前として削除する（ここでは語が決まらない）', 'The braces expand first, and each word is a name to unset (the words are not known here)');
  const ja = names.map((n) => `\`${n}\``).join('・');
  const en = names.map((n) => `\`${n}\``).join(', ');
  const many = names.length > 1;
  return space === 'function'
    ? cx.s(`ブレース展開のあと、関数 ${ja} を削除する`, `The braces expand first: remove the function${many ? 's' : ''} ${en}`)
    : space === 'nameref'
      ? cx.s(`ブレース展開のあと、名前参照 ${ja} そのものを削除する（参照先の変数は残る。名前参照でない変数は削除されない）`,
        `The braces expand first: unset the name reference${many ? 's' : ''} ${en} ${many ? 'themselves' : 'itself'} (${many ? 'the variables they point to stay' : 'the variable it points to stays'}; a variable that is not a name reference is not unset)`)
      : cx.s(`ブレース展開のあと、変数 ${ja} を削除する（未定義の状態に戻す）`, `The braces expand first: unset the variable${many ? 's' : ''} ${en} (${many ? 'they become' : 'it becomes'} undefined)`);
}

/** `unset` of a name no variable can have (`{a,b}` with no brace expansion, `1a`), in the namespace `space`. */
function badName(cx: Explainer, name: string, space: ReturnType<typeof namespaceOf>): string {
  // (dash and POSIX sh: an error of a special builtin, which ends the shell.)
  if (asBash('badNameStops', cx.shell) !== 'yes') {
    return cx.s(`\`${name}\` は変数名にならないので、エラーになりシェルが終了する（dash では \`bad variable name\`）`, `\`${name}\` is not a valid variable name: an error, and the shell exits (dash: "bad variable name")`);
  }
  if (space === 'variable') return cx.s(`\`${name}\` は変数名にならないので、何も削除しない（エラー、終了ステータス 1）`, `\`${name}\` is not a valid variable name, so nothing is unset (an error, status 1)`);
  return space === 'either'
    ? cx.s(`\`${name}\` は変数名にならないので、変数は削除しない（その名前の関数があれば、それを削除する）`, `No variable can have the name \`${name}\`, so no variable is unset (a function of that name, if any, is removed)`)
    : cx.s(`\`${name}\` は変数名にならないので、何も削除しない`, `No variable can have the name \`${name}\`, so nothing is unset`);
}

/**
 * An operand of `unset` (`item`, its spec, with `acts: 'unsets'`): what its name stands for comes from the spec's options (`space`: a
 * function with `-f`, a variable with `-v`, the name reference itself with `-n`), else the variable if there is one
 * here, or the function (src/semantics/state.ts). `a[1]` is an element of an array, and a glob pattern too when it
 * is not quoted. A variable that a prefix assignment of the command sets (`x=1 unset x`) is that temporary one: the
 * variable from before stays.
 */
function unsetOperand(cx: Explainer, nodes: SyntaxNode[], word: number, item: OperandSpec, space: ReturnType<typeof namespaceOf>, parse: ArgvParse): Token {
  const a = nodes[word];
  const fn = space === 'function';
  if (space === 'none') {
    // (Once for the command, at its first name.)
    if (parse.roles.find((r) => r.role.role === 'operand')!.word === word) cx.note(fact(cx.lang, 'unset-function-and-variable'), a.parent!);
    return positional(cx, a, cx.s('削除する名前（`-f` と `-v` を同時に指定しているので、何も削除されない）', 'Name to unset (with both `-f` and `-v`, nothing is unset)'));
  }
  // `unset {a,b}`: bash expands the braces first, and unsets each word (dash does not: the name is `{a,b}`).
  const braces = wordAt(cx, a)?.steps.find((g) => g.kind === 'brace');
  if (braces && braces.applies !== false) return positional(cx, a, bracedUnset(cx, a, braces, space));
  const plain = plainText(a);
  // (An unquoted glob has no value known here: its text, which bash uses when no file matches; so for `a[$i]`.)
  const asElement = elementWord(a);
  const name = staticWordValue(a, false, cx.shell) ?? (plain || asElement ? a.text : undefined);
  if (name === undefined) return positional(cx, a, cx.t(item.text));
  const element = /^([A-Za-z_]\w*)\[(.+)\]$/s.exec(name);
  let text: string;
  if (fn) text = cx.s(`関数 \`${name}\` を削除する`, `Remove the function \`${name}\``);
  else if (element) {
    // (`@` and `*` are all the elements of an indexed array, but keys of an associative one: 6.7. A negative index counts
    // back from the end.)
    const kind = arrayKind(cx, element[1], a.parent!);
    const all = element[2] === '@' || element[2] === '*';
    text = all && kind === 'assoc'
      ? cx.s(`連想配列 \`${element[1]}\` のキー \`${element[2]}\` の要素を削除する（全要素ではない）`, `Unset the element of the associative array \`${element[1]}\` with the key \`${element[2]}\` (not all the elements)`)
      : all ? cx.s(`配列 \`${element[1]}\` の要素をすべて削除する（配列は空で残る${kind === 'unknown' ? `。連想配列ならキー \`${element[2]}\` の要素だけ` : ''}）`,
        `Remove all the elements of the array \`${element[1]}\` (it stays, empty${kind === 'unknown' ? `; if it is associative, only the element with the key \`${element[2]}\`` : ''})`)
      : cx.s(`配列 \`${element[1]}\` の要素 \`${name}\` を削除する（ほかの要素の添字はそのまま${kind === 'indexed' && /^-\d+$/.test(element[2]) ? '。負の添字は末尾から数える' : ''}）`,
        `Unset the element \`${name}\` of the array \`${element[1]}\` (the other elements keep their indices${kind === 'indexed' && /^-\d+$/.test(element[2]) ? '; a negative index counts back from the end' : ''})`);
    // (Unquoted, it is a glob first: `unset a[1]` with a file `a1` here unsets the variable `a1`.)
    if (((plain && hasGlob(a.text)) || asElement) && wordAt(cx, a)?.steps.find((g) => g.kind === 'glob')?.applies !== false) text = nameGlob(cx, a, name, text, 'unsets');
  } else {
    const temp = space !== 'nameref' && prefixAssignments(a.parent!).find((c) => field(c, 'name')?.text === name);
    if (temp) {
      text = cx.s(`\`${temp.text}\` がこのコマンドのためだけに設定した変数 \`${name}\` を削除する（コマンドの前から \`${name}\` があれば、それはそのまま残る）`,
        `Unset the variable \`${name}\` that \`${temp.text}\` set for this command only (a \`${name}\` set before the command, if any, stays as it was)`);
    } else {
      // `unset` removes a variable if there is one, else a function (`-v`: a variable; with `-n`, bash keeps the function).
      const st = cx.state.at(a.parent!).run;
      const declared = st.variables.get(name)?.declared ?? 'off';
      const kind = space !== 'either' || (st.functions.get(name)?.state ?? 'off') === 'off' ? 'variable'
        : declared === 'off' ? 'function' : declared === 'unknown' ? 'maybe' : 'variable';
      if (kind !== 'function' && !/^[A-Za-z_]\w*$/.test(name)) return positional(cx, a, badName(cx, name, space));
      // (`unset -n a` unsets only a name reference: a variable that is not one stays.)
      const ref = space === 'nameref' ? attribute(st, name, 'n') : 'on';
      text = kind === 'function' ? cx.s(`関数 \`${name}\` を削除する`, `Remove the function \`${name}\``)
        : ref === 'off' ? cx.s(`\`${name}\` は名前参照ではないので、何も削除しない（\`-n\` は名前参照だけを削除する）`, `\`${name}\` is not a name reference, so nothing is unset (\`-n\` unsets only a name reference)`)
          : space === 'nameref' ? cx.s(`名前参照 \`${name}\` そのものを削除する（参照先の変数は残る${ref === 'unknown' ? '。名前参照でなければ何も削除しない' : ''}）`, `Unset the name reference \`${name}\` itself (the variable it points to stays${ref === 'unknown' ? '; if it is not a name reference, nothing is unset' : ''})`)
            : cx.s(`変数 \`${name}\` を削除する（未定義の状態に戻す）`, `Unset the variable \`${name}\` (it becomes undefined)`);
      if (kind === 'maybe') text += cx.s(`。変数がなければ、代わりに関数 \`${name}\` を削除する`, `. If there is no such variable, the function \`${name}\` is removed instead`);
      // A read-only variable stays: bash refuses (status 1).
      const readonly = kind === 'function' ? 'off' : attribute(st, name, 'r');
      if (readonly === 'on') {
        cx.note(fact(cx.lang, 'unset-readonly', { name }), a);
        text = cx.s(`変数 \`${name}\` は読み取り専用なので削除されない（エラー、終了ステータス 1）`, `The variable \`${name}\` is read-only, so it is not unset (an error, status 1)`);
      } else if (readonly === 'unknown') {
        text += cx.s(`。ただし、この前の一部の経路では読み取り専用になっていて、そこでは削除されずエラーになる（終了ステータス 1）`, `. But some paths before here make it read-only, and there it is not unset (an error, status 1)`);
      } else if (kind !== 'function' && space !== 'nameref' && unsetEndsSpecial(name) && !cx.state.local(a, name)) {
        // (`RANDOM`, `SECONDS`…: bash's own behaviour ends with it, src/semantics/vars.ts; in a subshell, there only.
        // Not a local of a function, `local RANDOM`, which is a plain variable: the one outside keeps it.)
        const sub = inSubshell(cx, a);
        const subshell = sub?.sure ? sub.why : undefined;
        cx.note(fact(cx.lang, 'unset-ends-special', { name, subshell }), a);
        text += subshell
          ? cx.s(`。このサブシェルでは \`${name}\` の bash の特別な働きもなくなる（そこであとで代入しても普通の変数）`, `. In this subshell, \`${name}\` also loses what bash does with it (set again there, it is a plain variable)`)
          : cx.s(`。\`${name}\` の bash の特別な働きもなくなる（あとで代入しても普通の変数）`, `. \`${name}\` also loses what bash does with it (set again, it is a plain variable)`);
      }
    }
  }
  // (A plain name is the variable or function itself; a quoted one or a pattern keeps the explanation of its word.)
  return plain && !hasGlob(a.text) ? cx.tok(a, 'variable', text) : positional(cx, a, text);
}

/**
 * `unset a[1]`, `declare a[1]`, unquoted: a glob pattern first, as the glob options in effect say. A file that
 * matches is unset (declared) instead of the element (`text`); with nullglob, a word that matches nothing goes away;
 * with failglob, it is an error.
 */
function nameGlob(cx: Explainer, a: SyntaxNode, name: string, text: string, acts: VariableAct): string {
  const shopt = shoptAt(cx, a);
  const quoted = `\`'${name}'\``;
  const [ja, en, enDo] = acts === 'unsets' ? ['削除', 'unset', 'unset'] : ['宣言', 'declared', 'declare'];
  if (shopt.failglob === 'on') {
    return cx.s(`クォートしていないのでグロブとして展開される。一致するファイルがあればその名前を${ja}し、なければ failglob が有効なので \`no match\` のエラーになり何も${ja}されない。要素 \`${name}\` を${ja}するなら ${quoted} と書く`,
      `Unquoted, this is a glob pattern: a file that matches it has its name ${en}, and when none matches, failglob makes it an error (\`no match\`) and nothing is ${en}. To ${enDo} the element \`${name}\`, write ${quoted}`);
  }
  if (shopt.nullglob === 'on') {
    return cx.s(`クォートしていないのでグロブとして展開される。一致するファイルがあればその名前を${ja}し、なければ nullglob が有効なのでこの単語はなくなり何も${ja}されない。要素 \`${name}\` を${ja}するなら ${quoted} と書く`,
      `Unquoted, this is a glob pattern: a file that matches it has its name ${en}, and when none matches, nullglob makes the word go away and nothing is ${en}. To ${enDo} the element \`${name}\`, write ${quoted}`);
  }
  const sometimes = shopt.failglob === 'unknown' || shopt.nullglob === 'unknown'
    ? cx.s(`（nullglob や failglob が有効な経路では、一致しなければ何も${ja}されない）`, ` (on the paths where nullglob or failglob is on, nothing is ${en} when none matches)`) : '';
  return text + cx.s(`。ただしクォートしていないので先にグロブとして展開され、一致するファイルがあればその名前を${ja}する${sometimes}（${quoted} と書く）`,
    `. Unquoted, it is a glob pattern first: if a file matches it, that file's name is ${en} instead${sometimes} (write ${quoted})`);
}
