// Compound commands (docs/design/analyzer.md, step 8): `if`, the loops (`for`, `select`, `while`, `until`), `case`
// and its branches, function definitions, `coproc`, groups and subshells, pipelines and lists, with the keywords and
// operators between their parts; a keyword missing for want of a `;` before it (`if a then`); and comments, with the
// shebang and the directives. Their parts are explained through the walk (`cx.sub`), on the line explained only.
import type { ExampleKind, Kind, Token } from '../analyzer-types';
import { interpret } from '../argv/interpret';
import { keywords, listOps } from '../dict/syntax';
import { DIRECTIVE } from '../directives';
import { fact } from '../messages';
import { spanOf } from '../noteanchors';
import { anonSections, programSections } from '../refs';
import { definitionFails } from '../semantics/names';
import { coprocName, field, fields, isShebang, nameText, strayKeyword, type SyntaxNode, withLists } from '../syntax/tree';
import { detectShell, SHELL_NAMES } from '../dialect';
import { shebangOptionTokens } from './argv';
import type { Explainer } from './context';
import { caseExample, pipelineExample } from './examples';
import { listOperatorToken } from './lists';
import { has, intersects, same, skeletal, sortTokens, summaryOf } from './nodes';
import { specFor } from './reads';
import { groupSubshell } from './where';
import { casePattern } from './words';
import type { Text } from '../i18n';
import type { TokenTextArgs, TokenTextId } from '../messages-tokens';
import { pushAll } from '../lists';

/** Children (keywords and named nodes, the lists of commands of a body as one) in source order, filtered to the current line. */
function ordered(cx: Explainer, n: SyntaxNode, skip: (c: SyntaxNode) => boolean = () => false): Token[] {
  const out: Token[] = [];
  for (const c of withLists(n)) {
    if (skip(c)) continue;
    if (c.named) pushAll(out, cx.sub(c));
    else pushAll(out, anonOnLine(cx, [c]));
  }
  return out;
}

/** Token for an anonymous node (keyword or operator), or undefined for plain punctuation. */
export function anon(cx: Explainer, n: SyntaxNode): Token | undefined {
  if (n.type === '{' && n.parent?.type === 'compound_statement' && groupSubshell(cx, n.parent)) {
    return { ...cx.tok(n, 'keyword', cx.text('group-start-subshell')), refs: ['3.2.5.3', '3.7.3'] };
  }
  if (n.type === ';' || n.type === '&') {
    // (Of a list, or of the head of a `for`; else the operator's own text, as after text the parser could not read.)
    const t = listOperatorToken(cx, n) ?? headSemicolon(cx, n);
    if (t) return t;
  }
  const k = keywords[n.type];
  const op = listOps[n.type];
  const t = k ? cx.tok(n, 'keyword', cx.t(k)) : op ? cx.tok(n, 'operator', cx.t(op)) : undefined;
  const refs = t && anonSections(n);
  if (refs) t.refs = refs;
  return t;
}

function anonOnLine(cx: Explainer, nodes: SyntaxNode[]): Token[] {
  return nodes
    .filter((c) => cx.onLine(c))
    .map((c) => anon(cx, c))
    .filter((t): t is Token => !!t);
}

/**
 * A `;` in the head of a `for` (3.2.5.1): between the expressions of `(( ))`, or before `do`, which needs a `;` or a
 * newline after the words (`for x in a b; do`; after `))` it may be left out). Undefined for any other `;`.
 */
function headSemicolon(cx: Explainer, n: SyntaxNode): Token | undefined {
  const p = n.parent!;
  if (p.type !== 'for_statement' && p.type !== 'select_statement' && p.type !== 'c_style_for_statement') return undefined;
  const kids = p.children;
  const inArith = p.type === 'c_style_for_statement' && kids.findIndex((c) => c.type === '))') > kids.indexOf(n);
  // (The body may be a group: `for x in a; { …; }`.)
  const body = kids.slice(kids.indexOf(n) + 1).find((c) => c.named)?.type === 'compound_statement' ? '{' : 'do';
  const text = inArith
    ? cx.s('`(( ))` の3つの式（初期化・条件・更新）の区切り', 'Separates the three expressions of `(( ))`: start, test and step')
    : p.type === 'c_style_for_statement'
      ? cx.s(`\`${body}\` の前で \`(( ))\` を終える（\`))\` の後では省いてもよい）`, `Ends the \`(( ))\` before \`${body}\` (it may be left out after \`))\`)`)
      // (`for x in a do echo; done`: `do` is one of the words, and the note says why bash stops.)
      : strayKeyword(p)
        ? cx.s(`\`${kids[0].type}\` の単語の並びを終える。その前の \`do\` も単語の1つ`, `Ends the words of \`${kids[0].type}\`; the \`do\` before it is one of the words`)
      : kids.some((c) => c.type === 'in')
        ? cx.s(`\`${body}\` の前で \`${kids[0].type}\` の単語の並びを終える（ここには \`;\` か改行が必要）`, `Ends the words of \`${kids[0].type}\` before \`${body}\` (a \`;\` or a newline is needed there)`)
        : cx.s(`\`${body}\` の前で \`${kids[0].type}\` の名前を終える`, `Ends the name of \`${kids[0].type}\` before \`${body}\``);
  return { ...cx.tok(n, 'operator', text), refs: anonSections(n)! };
}

export function block(cx: Explainer, n: SyntaxNode, kind: Kind, explanation: string): Token {
  return skeletal(cx.tok(n, kind, explanation, ordered(cx, n)), n);
}

export function comment(cx: Explainer, n: SyntaxNode): Token {
  if (isShebang(n)) return shebang(cx, n);
  const own = DIRECTIVE.exec(n.text);
  if (own) {
    const codes = own[2].split(',').map((c) => `\`${c}\``).join(own[2].includes(',') ? cx.s('・', ', ') : '');
    return cx.tok(n, 'comment', own[1] === 'disable-file'
      ? cx.text('comment-directive-file', { codes })
      : cx.text('comment-directive-line', { codes, inline: n.startPosition.column > 0 }));
  }
  if (/^#\s*shellcheck\s/.test(n.text)) {
    return cx.tok(n, 'comment', cx.text('comment-shellcheck'));
  }
  return cx.tok(n, 'comment', cx.text('comment-plain'));
}

/** What the shebang's text says of env, and whether that is a warning. */
interface EnvSaid { text: string; warns?: true }

/** A sentence of the catalog after the text before it. */
const sentence = <K extends TokenTextId>(cx: Explainer, id: K, ...params: TokenTextArgs<K>): string => cx.sep() + cx.text(id, ...params);

/** A warning of the catalog, as a sentence of the shebang's text. */
const warning = <K extends TokenTextId>(cx: Explainer, id: K, ...params: TokenTextArgs<K>): EnvSaid => ({ text: sentence(cx, id, ...params), warns: true });

/**
 * The shebang (3.8; execve(2), "Interpreter scripts"): the kernel reads it when the file is run as a program, and starts
 * the interpreter with the rest of the line (one argument on Linux, blanks and all) and the script's path; bash does
 * the same where the kernel does not. To bash, and to `bash script`, `source script`, it is a comment. Last, the shell
 * we explain the script as, when the line names one (`detectShell`: the file's dialect comes from this line, unless a
 * ShellCheck directive or a setting chooses another).
 */
function shebang(cx: Explainer, n: SyntaxNode): Token {
  const [, interp, arg] = /^#![ \t]*(\S*)\s*([^]*?)\s*$/.exec(n.text)!;
  if (!interp) {
    return cx.tok(n, 'shebang', cx.text('shebang-no-interpreter'));
  }
  // (`#!/usr/bin/env` alone: env runs the script's path, as with an assignment.)
  const env0 = arg ? shebangEnv(cx, `${interp} ${arg}`) : /\/env$/.test(interp) ? envLoop(cx) : { text: '' };
  const notes = env0.text;
  const blanks = /\s/.test(arg);
  // (The rest as one word of the shell, quoted.)
  const shown = blanks ? `${interp} '${arg.replace(/'/g, "'\\''")}'` : `${interp}${arg ? ` ${arg}` : ''}`;
  // (Said by the warning of env without `-S`.)
  const oneArg = blanks && !env0.warns;
  const env = /\/env$/.test(interp) && /^[^-\s=][^\s=]*$/.test(arg);
  // `#!bash`: the kernel opens the interpreter as a path, from the current directory.
  const relative = interp.includes('/') ? '' : sentence(cx, 'shebang-relative-interpreter', { interp });
  const said = detectShell(n.text);
  const used = cx.shell ?? 'bash';
  const dialect: Text = !said ? { ja: '', en: '' }
    : said === used ? { ja: `。Bash Explainer はこの行から、スクリプトを ${SHELL_NAMES[said]} のものとして解説する`, en: `. Bash Explainer explains the script as ${SHELL_NAMES[said]}, from this line` }
      : { ja: `。Bash Explainer はここではスクリプトを ${SHELL_NAMES[said]} ではなく ${SHELL_NAMES[used]} のものとして解説する（ShellCheck の指示コメントか設定で選ばれている）`,
        en: `. Bash Explainer explains the script as ${SHELL_NAMES[used]} here, not as ${SHELL_NAMES[said]} (a ShellCheck directive or a setting chooses it)` };
  return cx.tok(n, 'shebang', cx.text('shebang-line', { shown, oneArg, arg, relative, env, notes, dialect }), shebangParts(cx, n, interp, arg));
}

/**
 * What the interpreter reads the one word after it as, from its spec (`#!/bin/bash -eu`: `-e` and `-u`, Bash manual
 * 6.1; `#!/usr/bin/awk -f`: `-f`, whose value is the script's path): the kernel passes that word, then the script's
 * path. Nothing when the rest has blanks (one argument all the same: the text and `shebang-refused` say what then).
 */
function shebangParts(cx: Explainer, n: SyntaxNode, interp: string, arg: string): Token[] {
  const name = interp.slice(interp.lastIndexOf('/') + 1);
  const spec = arg && !/\s/.test(arg) ? specFor(cx, name) : undefined;
  if (!spec) return [];
  const parse = interpret(spec, [{ value: arg }, { value: './script.sh' }], { name, lookup: (x) => specFor(cx, x) });
  const role = parse.roles.find((r) => r.word === 0)!.role;
  const start = n.text.indexOf(arg, n.text.indexOf(interp) + interp.length);
  const { row, column } = n.startPosition;
  const refs = programSections(name);
  const parts = shebangOptionTokens(cx, role, spec, name, arg, (from, to) => ({ start: { line: row, character: column + start + from }, end: { line: row, character: column + start + to } }));
  if (refs.length) for (const t of parts) t.refs = refs;
  return parts;
}

/**
 * `#!/usr/bin/env -S bash -e`: Linux gives the interpreter the rest of the line as one argument, which
 * `env -S` splits; without `-S`, env looks for a program named with the whole rest (`bash -e`).
 */
function shebangEnv(cx: Explainer, interp: string): EnvSaid {
  const rest = /^(?:\S*\/)?env[ \t]+(.*\S)$/.exec(interp)?.[1];
  if (!rest) return { text: '' };
  const env = specFor(cx, 'env')!;
  // (One word: `rest` is not empty.)
  const role = interpret(env, [{ value: rest }], { name: 'env', lookup: (name) => specFor(cx, name) }).roles[0].role;
  const letters = role.role === 'cluster' ? role.letters : [role];
  const value = letters.map((l) => (l.role === 'option' ? l.value : undefined)).find((v) => v?.split || v?.refused);
  if (value?.refused) {
    return warning(cx, 'shebang-env-string-refused');
  }
  if (!value) {
    // `#!/usr/bin/env FOO=1 bash`: env takes the whole word as a variable to set (`FOO` is `1 bash`).
    if (!rest.startsWith('-') && rest.includes('=')) return envLoop(cx, rest);
    if (!/\s/.test(rest)) return { text: '' };
    // `#!/usr/bin/env -i bash`: env reads the whole word as options (`-i`, then ` `: an invalid option).
    if (rest.startsWith('-')) {
      return warning(cx, 'shebang-env-reads-options', { rest, last: rest.split(/\s+/).pop()! });
    }
    return warning(cx, 'shebang-env-one-argument', { rest });
  }
  const { words, roles } = value.split!;
  const cmd = roles.find((r) => r.role.role === 'command');
  const shown = (k: number): string => `\`${words[k].value ?? `${words[k].prefix}…`}\``;
  if (!cmd) return { text: cx.s('。env -S の文字列にコマンドがないので、スクリプトのパスをコマンドとして実行する', '. The `env -S` string names no command, so env runs the script\'s path as the command') };
  const args = words.slice(cmd.word + 1).map((_, k) => shown(cmd.word + 1 + k));
  return { text: cx.s(
    `。\`env -S\` が残りを単語に分け、${shown(cmd.word)} を${args.length ? ` ${args.join(' ')} と` : ''}スクリプトのパスを引数にして実行する`,
    `. \`env -S\` splits the rest into words and runs ${shown(cmd.word)} with ${args.length ? `${args.join(' ')} and ` : ''}the script's path as arguments`) };
}

/** env given no command (`#!/usr/bin/env`, or only an assignment): it runs the script's path, whose shebang runs env again. */
function envLoop(cx: Explainer, assignment?: string): EnvSaid {
  return warning(cx, 'shebang-env-loop', { assignment });
}

export function functionDef(cx: Explainer, n: SyntaxNode): Token {
  const nameNode = field(n, 'name')!;
  const name = nameText(nameNode);
  // A definition is explained on the line it starts on, where its name is.
  const nameTok = [cx.tok(nameNode, 'function', cx.text('function-name'))];
  // A redirection after the body is part of the function: it is applied on every call.
  const redirected = n.namedChildren.some((c) => c.type === 'file_redirect' || c.type === 'heredoc_redirect' || c.type === 'herestring_redirect' || c.type === 'redirected_statement');
  // In POSIX mode a function cannot have the name of a special builtin, nor in bash 5.2 a name that is not valid (the
  // status model; in another shell, a special builtin's name: `definitionFails`).
  const exit = cx.status.posixExit(n);
  const fails = exit ? exit.active : definitionFails(cx.state, n);
  if (fails !== 'off') {
    const id = exit?.exit.why === 'function-name' ? 'posix-function-name' : 'posix-special-function-name';
    cx.note(fact(cx.lang, fails === 'on' ? id : `${id}-maybe`, exit ? { stops: exit.stops } : {}), nameNode);
  }
  return skeletal(cx.tok(n, 'function', cx.text('function-definition', { name, redirected, lineRef: cx.lineRef(n) }),
    sortTokens([...nameTok, ...ordered(cx, n, (c) => same(c, nameNode) || c.type === '(' || c.type === ')')])), n);
}

/** `coproc [NAME] command`: runs the command in the background, with two pipes to it kept in an array. */
export function coprocStatement(cx: Explainer, n: SyntaxNode): Token {
  const nameNode = field(n, 'name');
  const arr = coprocName(n);
  const nameTok = nameNode ? [cx.tok(nameNode, 'variable', cx.text('coproc-name', { arr }))] : [];
  return skeletal(cx.tok(n, 'keyword', cx.text('coproc-statement', { arr, lineRef: cx.lineRef(n) }),
    sortTokens([...nameTok, ...ordered(cx, n, (c) => same(c, nameNode))])), n);
}

export function forStatement(cx: Explainer, n: SyntaxNode): Token {
  const v = field(n, 'variable');
  const values = fields(n, 'value');
  const list = values.map((c) => c.text).join(' ');
  const select = n.type === 'select_statement';
  // `for i in; …` has an empty list, and its body never runs; only with no `in` at all does the loop take `"$@"`.
  const hasIn = n.children.some((c) => c.type === 'in');
  const name = v?.text;
  const expl = values.length
    ? select
      ? cx.s(`select ループ: \`${list}\` を番号付きのメニューに出し、選ばれた値を変数 \`${name}\` に入れて本体を実行する（\`break\` するまで繰り返す）`,
        `select loop: show \`${list}\` as a numbered menu, assign the chosen one to \`${name}\` and run the body (until \`break\`)`)
      : cx.s(`for ループ: \`${list}\` の各値を順に変数 \`${name}\` に入れて本体を繰り返す`, `for loop: assign each of \`${list}\` to \`${name}\` and run the body`)
    : hasIn
      ? cx.s(`${select ? 'select' : 'for'} ループ: \`in\` のあとの一覧が空なので、本体は一度も実行されない（\`"$@"\` を回すのは \`in\` を省いたときだけ）`,
        `${select ? 'select' : 'for'} loop: the list after \`in\` is empty, so the body never runs (only a loop with no \`in\` goes over \`"$@"\`)`)
      : select
        ? cx.s(`select ループ: 位置パラメータ（"$@"）を番号付きのメニューに出し、選ばれた値を \`${name}\` に入れて本体を実行する（\`in\` を省略したとき）`,
          `select loop over the positional parameters ("$@"; there is no \`in\`): show them as a numbered menu and assign the chosen one to \`${name}\``)
        : cx.s(`for ループ: 位置パラメータ（"$@"）の各値を順に \`${name}\` に入れて繰り返す（\`in\` を省略したとき）`, `for loop over the positional parameters ("$@") as \`${name}\` (what a loop with no \`in\` does)`);
  const children = ordered(cx, n, (c) => same(c, v) || has(values, c));
  const extra: Token[] = [];
  // (`select` sets it to the word whose number is read, and to an empty string after any other line: 3.2.5.2.)
  if (v && cx.onLine(v)) extra.push(cx.tok(v, 'variable', select
    ? cx.text('select-variable')
    : cx.text('for-variable')));
  for (const val of values) {
    for (const t of cx.sub(val)) {
      t.explanation = cx.text('for-value', { what: t.explanation });
      extra.push(t);
    }
  }
  return skeletal(cx.tok(n, 'keyword', expl + cx.lineRef(n), sortTokens([...children, ...extra])), n);
}

export function whileStatement(cx: Explainer, n: SyntaxNode): Token {
  const until = n.children[0].type === 'until';
  const expl = until
    ? cx.s('until ループ: 条件コマンドが成功（終了ステータス 0）するまで本体を繰り返す', 'until loop: repeat the body until the condition succeeds')
    : cx.s('while ループ: 条件コマンドが成功（終了ステータス 0）する間、本体を繰り返す', 'while loop: repeat the body while the condition succeeds');
  return skeletal(cx.tok(n, 'keyword', expl + cx.lineRef(n), ordered(cx, n)), n);
}

export function caseStatement(cx: Explainer, n: SyntaxNode): Token {
  const v = field(n, 'value')!;
  const children = ordered(cx, n, (c) => same(c, v));
  const vt = v.text ? cx.sub(v).map((t) => ({ ...t, explanation: cx.text('case-value', { what: t.explanation }) })) : []; // (`case` alone: no value yet.)
  for (const c of children) {
    if (c.kind === 'keyword' && c.label === 'in') c.explanation = cx.text('case-in');
  }
  // `;&` and `;;&` change what happens after a match.
  const enders = n.namedChildren.flatMap((c) => c.children.filter((t) => t.type === ';&' || t.type === ';;&')).map((t) => t.type);
  const fall = !enders.length ? '' : cx.s(
    `。ただしこの文には \`${[...new Set(enders)].join('\` と \`')}\` があり、分岐の終わりが \`;;\` なら終了、\`;&\` なら次の分岐の中身をパターンを調べずに実行、\`;;&\` なら次以降のパターンの照合を続ける`,
    `. This one has \`${[...new Set(enders)].join('\` and \`')}\`: a branch ending in \`;;\` stops the \`case\`, \`;&\` runs the next branch's commands without testing its pattern, and \`;;&\` goes on testing the patterns after it`);
  return skeletal(cx.tok(n, 'keyword', cx.text('case-statement', { value: v.text }) + fall + cx.lineRef(n), sortTokens([...children, ...vt])), n);
}

export function caseItem(cx: Explainer, n: SyntaxNode): Token {
  const pats = fields(n, 'value');
  const ptext = pats.map((p) => p.text).join(' | ');
  const isDefault = pats.length === 1 && pats[0].text === '*';
  // The branch before it may have sent the flow here (`;&` runs this body, `;;&` tests this pattern too).
  const siblings = n.parent!.namedChildren;
  const before = siblings[siblings.findIndex((x) => same(x, n)) - 1];
  const prev = before?.type === 'case_item' ? before.children.find((t) => t.type === ';&' || t.type === ';;&')?.type : undefined;
  const viaPrev = prev === ';&'
    ? cx.s('前の分岐が `;&` で終わっているので、パターンを調べずにここも実行される', 'The branch above ends in `;&`, so this one runs without its pattern being tested')
    : cx.s('前の分岐が `;;&` で終わっているので、一致した後でもこのパターンも照合される', 'The branch above ends in `;;&`, so this pattern is tested too after that match');
  const expl = prev && isDefault ? cx.s('分岐: `*` は何にでも一致する。', 'Branch: `*` matches anything. ') + viaPrev
    : isDefault
    ? cx.s('既定の分岐: どのパターンにも一致しなかった場合に実行（`*` は何にでも一致）', 'Default branch: runs when nothing else matched (`*` matches anything)')
    // (What `|` means, where there is one: `a|b)`.)
    : cx.s(`分岐: 値がパターン \`${ptext}\` に一致した場合に実行${pats.length > 1 ? '（`|` は「または」）' : ''}`, `Branch: runs when the value matches \`${ptext}\`${pats.length > 1 ? ' (`|` means "or")' : ''}`);
  const patToks = pats
    .filter((p) => cx.onLine(p))
    .map((p) => casePattern(cx, p));
  const rest = ordered(cx, n, (c) => has(pats, c) || c.type === '|' || c.type === ')' || c.type === '(');
  if (!isDefault && (cx.line === null || pats.some((p) => intersects(p, cx.line!)))) {
    cx.examplesAt(n, () => caseExample(cx, n, pats));
  }
  return skeletal(cx.tok(n, 'pattern', expl + (prev && !isDefault ? cx.sep() + viaPrev : '') + cx.lineRef(n), sortTokens([...patToks, ...rest])), n);
}

/**
 * `if [ -f a ] then …` and `for x in a b do …`: with no `;` or newline before it, `then` / `do` is an ordinary
 * word, the construct lacks its keyword and bash stops with a syntax error. Marks the token and adds a note, which says it (once).
 */
export function missingKeyword(cx: Explainer, n: SyntaxNode, t: Token): Token {
  const kw = strayKeyword(n);
  if (!kw) return t;
  const f = fact(cx.lang, 'keyword-needs-separator', { kw });
  t.kind = 'error';
  // (A short form of the row says it too: the note is not always beside it.)
  t.summary = f.body + cx.s('。', '. ') + t.explanation;
  cx.note(f, n);
  return t;
}

/**
 * The kinds of examples of what bash makes of a word (manual 3.5), which a pipeline's example keeps beside it:
 * `expansion`, the values a parameter expansion gives (`${x%%.*}`); `glob`, the words of a brace expansion and the
 * names a pattern matches. The others are of what a command does with its words (grep's regex, sed, `printf`, `[ ]`,
 * `read`), which the pipeline's example shows run.
 */
const BASH_WORD_EXAMPLES: ReadonlySet<ExampleKind> = new Set(['expansion', 'glob']);

export function pipeline(cx: Explainer, n: SyntaxNode): Token {
  // One example for the whole pipeline replaces the examples of what its stages do. Those of what bash makes of a word
  // of a stage stay beside it, as bash's reading of the line, which the run of the commands does not show (CLAUDE.md,
  // "Explanations"): `BASH_WORD_EXAMPLES`.
  const children = cx.examplesReplaced(() => ordered(cx, n), () => {
    const whole = pipelineExample(cx, n);
    return whole && { ...whole, anchor: spanOf(n), kind: 'pipeline' };
  }, (e) => !!e.kind && BASH_WORD_EXAMPLES.has(e.kind));
  const cmds = children.filter((c) => c.kind !== 'operator' && c.kind !== 'keyword');
  const t = cx.tok(n, 'operator', cx.text('pipeline'), children);
  t.summary = cmds.map(summaryOf).join(' | ');
  t.grammar = 'pipeline';
  return skeletal(t, n);
}

/** `!` before a pipeline: its status, negated. */
export function negated(cx: Explainer, n: SyntaxNode): Token {
  return skeletal(cx.tok(n, 'operator', cx.t(keywords[n.namedChildren[0]?.type === 'pipeline' ? '! pipeline' : '!']), cx.subs(n.namedChildren)), n);
}

/** `( … )`: the list in a subshell. */
export function subshell(cx: Explainer, n: SyntaxNode): Token {
  return block(cx, n, 'block', cx.s('サブシェル: `( )` 内を別プロセスで実行する。中での変数変更や cd は外に影響しない', 'Subshell: runs `( )` in a child process; variable changes and cd do not leak out'));
}

/** `{ …; }`: the list in the current shell, or in a subshell where the group stands in one (src/explain/where.ts). */
export function group(cx: Explainer, n: SyntaxNode): Token {
  const why = groupSubshell(cx, n);
  return block(cx, n, 'block', why
    ? cx.s(`コマンドグループ: \`{ }\` 内のコマンドをまとめて実行する。${why.ja}ので、グループはサブシェルで実行され、中で変えた変数は外に残らない`, `Command group: runs the commands in \`{ }\` together. ${why.en}, so the group is a subshell: variables set inside are gone afterwards`)
    : cx.s('コマンドグループ: `{ }` 内のコマンドを現在のシェルでまとめて実行する', 'Command group: runs the commands in `{ }` in the current shell'));
}

/** `do … done`: the body of a loop. */
export function doGroup(cx: Explainer, n: SyntaxNode): Token {
  return { ...block(cx, n, 'block', cx.text('loop-body')), plain: true };
}

/** `for (( init; condition; update ))`. */
export function cStyleFor(cx: Explainer, n: SyntaxNode): Token {
  return block(cx, n, 'keyword', cx.s('C 言語風 for ループ: `((初期化; 条件; 更新))` で回数を制御して繰り返す', 'C-style for loop: `((init; condition; update))`') + cx.lineRef(n));
}

/** `if … then … fi`. */
export function ifStatement(cx: Explainer, n: SyntaxNode): Token {
  return block(cx, n, 'keyword', cx.s('if 文: 条件コマンドの終了ステータスが 0（成功）なら then 以下を実行', 'if statement: runs the `then` branch if the condition exits 0') + cx.lineRef(n));
}

/** An `elif` branch. */
export function elifClause(cx: Explainer, n: SyntaxNode): Token {
  return block(cx, n, 'keyword', cx.t(keywords.elif));
}

/** The `else` branch. */
export function elseClause(cx: Explainer, n: SyntaxNode): Token {
  return block(cx, n, 'keyword', cx.t(keywords.else));
}

/** The label of a construct around the line (the context `flatten` records), or undefined for a node that is not one. */
export function contextLabel(cx: Explainer, n: SyntaxNode): string | undefined {
  switch (n.type) {
    case 'for_statement':
    case 'select_statement':
    case 'c_style_for_statement':
      return cx.s('for ループ', 'for loop');
    case 'while_statement':
      return n.children[0].type === 'until' ? cx.s('until ループ', 'until loop') : cx.s('while ループ', 'while loop');
    case 'if_statement':
      return cx.s('if 文', 'if statement');
    case 'elif_clause':
      return 'elif';
    case 'else_clause':
      return 'else';
    case 'case_statement':
      return cx.s('case 文', 'case statement');
    case 'case_item': {
      const pats = fields(n, 'value').map((c) => c.text);
      return cx.s(`case 分岐 \`${pats.join('|')})\``, `case branch \`${pats.join('|')})\``);
    }
    case 'function_definition':
      return cx.s(`関数 \`${nameText(field(n, 'name')!)}\``, `function \`${nameText(field(n, 'name')!)}\``);
    case 'arithmetic_command':
      return cx.s('(( )) 算術評価', '(( )) arithmetic');
    case 'compound_statement':
      return cx.s('{ } グループ', '{ } group');
    case 'subshell':
      return cx.s('( ) サブシェル', '( ) subshell');
    default:
      return undefined;
  }
}
