// Compound commands (docs/design/analyzer.md, step 8): `if`, the loops (`for`, `select`, `while`, `until`), `case`
// and its branches, function definitions, `coproc`, groups and subshells, pipelines and lists, with the keywords and
// operators between their parts; a keyword missing for want of a `;` before it (`if a then`); and comments, with the
// shebang and the directives. Their parts are explained through the walk (`cx.sub`), on the line explained only.
import type { Kind, Token } from '../analyzer-types';
import { interpret } from '../argv/interpret';
import { keywords, listOps } from '../dict/syntax';
import { DIRECTIVE } from '../directives';
import { fact } from '../messages';
import { spanOf } from '../noteanchors';
import { anonSections } from '../refs';
import { definitionFails } from '../semantics/names';
import { descendants, field, fields, isShebang, strayKeyword, type SyntaxNode } from '../syntax/tree';
import { detectShell, SHELL_NAMES } from '../dialect';
import type { Explainer } from './context';
import { caseExample, pipelineExample } from './examples';
import { has, intersects, isBlockLike, same, skeletal, sortTokens, summaryOf } from './nodes';
import { specFor } from './reads';
import { groupSubshell } from './where';
import { casePattern } from './words';

/** Children (keywords and named nodes) in source order, filtered to the current line. */
function ordered(cx: Explainer, n: SyntaxNode, skip: (c: SyntaxNode) => boolean = () => false): Token[] {
  const out: Token[] = [];
  for (const c of n.children) {
    if (skip(c)) continue;
    if (c.named) out.push(...cx.sub(c));
    else out.push(...anonOnLine(cx, [c]));
  }
  return out;
}

/** Token for an anonymous node (keyword or operator), or undefined for plain punctuation. */
export function anon(cx: Explainer, n: SyntaxNode): Token | undefined {
  if (n.type === '{' && n.parent?.type === 'compound_statement' && groupSubshell(cx, n.parent)) {
    return { ...cx.tok(n, 'keyword', cx.s('コマンドグループの開始（ここではサブシェルで実行される）', 'Start of a command group (here it runs in a subshell)')), refs: ['3.2.5.3', '3.7.3'] };
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
    .map((c) => (c.type === ';' ? undefined : anon(cx, c)))
    .filter((t): t is Token => !!t);
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
      ? cx.s(`Bash Explainer への指示コメント: このファイル全体で警告 ${codes} を出さない`, `Bash Explainer directive: no ${codes} warnings in this file`)
      : cx.s(`Bash Explainer への指示コメント: ${n.startPosition.column ? 'この行' : '次の行'}で警告 ${codes} を出さない`, `Bash Explainer directive: no ${codes} warnings on ${n.startPosition.column ? 'this' : 'the next'} line`));
  }
  if (/^#\s*shellcheck\s/.test(n.text)) {
    return cx.tok(n, 'comment', cx.s('ShellCheck への指示コメント（警告の抑制など）', 'ShellCheck directive (e.g. disable a warning)'));
  }
  return cx.tok(n, 'comment', cx.s('コメント: `#` から行末までは実行されない', 'Comment: everything after `#` is ignored'));
}

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
    return cx.tok(n, 'shebang', cx.s(
      'シバン（shebang）だがインタープリタがない: ファイルをプログラムとして実行すると、カーネルはそれを実行できず、実行しようとしたシェル（bash など）が自分でシェルスクリプトとして読む。bash にとってこの行はコメント',
      'Shebang with no interpreter: run as a program, the kernel cannot start the file, and the shell that runs it reads it as a shell script itself. To bash this line is a comment'));
  }
  // (`#!/usr/bin/env` alone: env runs the script's path, as with an assignment.)
  const notes = arg ? shebangEnv(cx, `${interp} ${arg}`) : /\/env$/.test(interp) ? envLoop(cx) : '';
  const blanks = /\s/.test(arg);
  // (The rest as one word of the shell, quoted.)
  const shown = blanks ? `${interp} '${arg.replace(/'/g, "'\\''")}'` : `${interp}${arg ? ` ${arg}` : ''}`;
  // (Said by the ⚠ of env without `-S`.)
  const oneArg = blanks && !notes.includes('⚠');
  const env = /\/env$/.test(interp) && /^[^-\s=][^\s=]*$/.test(arg);
  // `#!bash`: the kernel opens the interpreter as a path, from the current directory.
  const relative = interp.includes('/') ? ['', ''] : [
    `。⚠ カーネルはインタープリタを PATH から探さず、カレントディレクトリからの相対パスとして \`${interp}\` を探すので、実行はたいてい失敗する（required file not found）`,
    `. ⚠ The kernel does not search PATH for the interpreter: it looks for \`${interp}\` from the current directory, so running the file mostly fails ("required file not found")`];
  const said = detectShell(n.text);
  const used = cx.shell ?? 'bash';
  const dialect = !said ? ['', '']
    : said === used ? [`。Bash Explainer はこの行から、スクリプトを ${SHELL_NAMES[said]} のものとして解説する`, `. Bash Explainer explains the script as ${SHELL_NAMES[said]}, from this line`]
      : [`。Bash Explainer はここではスクリプトを ${SHELL_NAMES[said]} ではなく ${SHELL_NAMES[used]} のものとして解説する（ShellCheck の指示コメントか設定で選ばれている）`,
        `. Bash Explainer explains the script as ${SHELL_NAMES[used]} here, not as ${SHELL_NAMES[said]} (a ShellCheck directive or a setting chooses it)`];
  return cx.tok(n, 'shebang', cx.s(
    `シバン（shebang）: ファイルをプログラムとして実行すると（\`./script.sh\`、または PATH から見つかるコマンドとして）、カーネル（それをしないシステムでは bash）が \`${shown} ./script.sh 引数…\` を実行する`
      + `${oneArg ? `（Linux では行の残りの \`${arg}\` 全体が1つの引数になる）` : ''}${relative[0]}${env ? `。\`env\` は PATH から \`${arg}\` を探して実行する` : ''}${notes}`
      + `。bash にとってこの行はコメントで、\`bash script.sh\`・\`sh script.sh\`・\`source script.sh\`・\`. script.sh\` では無視される${dialect[0]}`,
    `Shebang: when the file is run as a program (\`./script.sh\`, or a command found on PATH), the kernel (or bash, on a system whose kernel does not) runs \`${shown} ./script.sh args…\``
      + `${oneArg ? ` (on Linux the whole rest of the line, \`${arg}\`, is one argument)` : ''}${relative[1]}${env ? `, and \`env\` finds \`${arg}\` on PATH and runs it` : ''}${notes}`
      + `. To bash this line is a comment: \`bash script.sh\`, \`sh script.sh\`, \`source script.sh\` and \`. script.sh\` ignore it${dialect[1]}`,
  ));
}

/**
 * `#!/usr/bin/env -S bash -e`: Linux gives the interpreter the rest of the line as one argument, which
 * `env -S` splits; without `-S`, env looks for a program named with the whole rest (`bash -e`).
 */
function shebangEnv(cx: Explainer, interp: string): string {
  const rest = /^(?:\S*\/)?env[ \t]+(.*\S)$/.exec(interp)?.[1];
  if (!rest) return '';
  const env = specFor(cx, 'env')!;
  // (One word: `rest` is not empty.)
  const role = interpret(env, [{ value: rest }], { name: 'env', lookup: (name) => specFor(cx, name) }).roles[0].role;
  const letters = role.role === 'cluster' ? role.letters : [role];
  const value = letters.map((l) => (l.role === 'option' ? l.value : undefined)).find((v) => v?.split || v?.refused);
  if (value?.refused) {
    return cx.s('。⚠ env はこの文字列を分けられず、何も実行せずに終了ステータス 125 で終わる', '. ⚠ env cannot split this string and exits with status 125, running nothing');
  }
  if (!value) {
    // `#!/usr/bin/env FOO=1 bash`: env takes the whole word as a variable to set (`FOO` is `1 bash`).
    if (!rest.startsWith('-') && rest.includes('=')) return envLoop(cx, rest);
    if (!/\s/.test(rest)) return '';
    // `#!/usr/bin/env -i bash`: env reads the whole word as options (`-i`, then ` `: an invalid option).
    if (rest.startsWith('-')) {
      return cx.s(
        `。⚠ Linux ではインタープリタの後ろの \`${rest}\` 全体が env への1つの引数になり、env はそれを1つのオプションの並びとして読むので、\`${rest.split(/\s+/).pop()}\` をコマンドとして実行しない（多くは不正なオプションとして終了ステータス 125 で終わる）。分けるには \`env -S\` と書く`,
        `. ⚠ On Linux the whole \`${rest}\` after the interpreter is one argument to env, which reads it as one run of options, so it does not run \`${rest.split(/\s+/).pop()}\` (it mostly fails with an invalid option and status 125); write \`env -S\` to split it`);
    }
    return cx.s(
      `。⚠ Linux ではインタープリタの後ろの \`${rest}\` 全体が env への1つの引数になるので、env はその名前のプログラムを探して失敗する。分けるには \`env -S\` と書く`,
      `. ⚠ On Linux the whole \`${rest}\` after the interpreter is one argument to env, which looks for a program of that name and fails; write \`env -S\` to split it`);
  }
  const { words, roles } = value.split!;
  const cmd = roles.find((r) => r.role.role === 'command');
  const shown = (k: number): string => `\`${words[k].value ?? `${words[k].prefix}…`}\``;
  if (!cmd) return cx.s('。env -S の文字列にコマンドがないので、スクリプトのパスをコマンドとして実行する', '. The `env -S` string names no command, so env runs the script\'s path as the command');
  const args = words.slice(cmd.word + 1).map((_, k) => shown(cmd.word + 1 + k));
  return cx.s(
    `。\`env -S\` が残りを単語に分け、${shown(cmd.word)} を${args.length ? ` ${args.join(' ')} と` : ''}スクリプトのパスを引数にして実行する`,
    `. \`env -S\` splits the rest into words and runs ${shown(cmd.word)} with ${args.length ? `${args.join(' ')} and ` : ''}the script's path as arguments`);
}

/** env given no command (`#!/usr/bin/env`, or only an assignment): it runs the script's path, whose shebang runs env again. */
function envLoop(cx: Explainer, assignment?: string): string {
  return cx.s(
    `。⚠ env はスクリプトのパスをコマンドとして実行する${assignment ? `（\`${assignment}\` は設定する変数として読む）` : ''}ので、スクリプトが自分自身を終わりなく起動し直す`,
    `. ⚠ env runs the script's path as the command${assignment ? ` (it takes \`${assignment}\` as a variable to set)` : ''}, so the script starts itself again, without end`);
}

export function functionDef(cx: Explainer, n: SyntaxNode): Token {
  const nameNode = field(n, 'name')!;
  const name = nameNode.text;
  // A definition is explained on the line it starts on, where its name is.
  const nameTok = [cx.tok(nameNode, 'function', cx.s('関数名', 'Function name'))];
  // A redirection after the body is part of the function: it is applied on every call.
  const redirected = n.namedChildren.some((c) => c.type === 'file_redirect' || c.type === 'heredoc_redirect' || c.type === 'herestring_redirect' || c.type === 'redirected_statement');
  const stored = redirected ? cx.s('。本体のあとのリダイレクトは、定義した時ではなく関数を呼ぶたびに適用される', '. The redirection after the body is applied each time the function is called, not when it is defined') : '';
  // In POSIX mode a function cannot have the name of a special builtin.
  const fails = definitionFails(cx.state, n);
  if (fails !== 'off') {
    cx.note(fact(cx.lang, fails === 'on' ? 'posix-special-function-name' : 'posix-special-function-name-maybe'), nameNode);
  }
  return skeletal(cx.tok(n, 'function', cx.s(
    `関数 \`${name}\` の定義: 以後 \`${name}\` をコマンドのように呼び出せる（引数は関数内で $1, $2… になる）${stored}${cx.lineRef(n)}`,
    `Defines function \`${name}\`; call it like a command (arguments become $1, $2…)${stored}${cx.lineRef(n)}`,
  ), sortTokens([...nameTok, ...ordered(cx, n, (c) => same(c, nameNode) || c.type === '(' || c.type === ')')])), n);
}

/** `coproc [NAME] command`: runs the command in the background, with two pipes to it kept in an array. */
export function coprocStatement(cx: Explainer, n: SyntaxNode): Token {
  const nameNode = field(n, 'name');
  const arr = nameNode?.text ?? 'COPROC';
  const nameTok = nameNode ? [cx.tok(nameNode, 'variable', cx.s(`コプロセスの名前: 配列 \`${arr}\` と変数 \`${arr}_PID\` の名前になる`, `Name of the co-process: names the array \`${arr}\` and the variable \`${arr}_PID\``))] : [];
  return skeletal(cx.tok(n, 'keyword', cx.s(
    `\`coproc\`: コマンドをバックグラウンドのコプロセスとして実行し、その出力と入力につながるファイルディスクリプタを配列 \`${arr}\` に入れる（\`\${${arr}[0]}\` はコプロセスの出力を読む側、\`\${${arr}[1]}\` はその入力に書く側）。プロセス ID は \`${arr}_PID\`${cx.lineRef(n)}`,
    `\`coproc\`: runs the command in the background as a co-process and puts the descriptors connected to its output and input in the array \`${arr}\` (\`\${${arr}[0]}\` reads its output, \`\${${arr}[1]}\` writes to its input). Its process ID is \`${arr}_PID\`${cx.lineRef(n)}`,
  ), sortTokens([...nameTok, ...ordered(cx, n, (c) => same(c, nameNode))])), n);
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
  if (v && cx.onLine(v)) extra.push(cx.tok(v, 'variable', cx.s('ループ変数: 繰り返しごとに次の値が入る', 'Loop variable: receives the next value on each iteration')));
  for (const val of values) {
    for (const t of cx.sub(val)) {
      t.explanation = cx.s('繰り返す値: ', 'Value to iterate: ') + t.explanation;
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
  const vt = v.text ? cx.sub(v).map((t) => ({ ...t, explanation: cx.s('照合する値: ', 'Value to match: ') + t.explanation })) : []; // (`case` alone: no value yet.)
  for (const c of children) {
    if (c.kind === 'keyword' && c.label === 'in') c.explanation = cx.s('値の後に、パターンごとの分岐を並べる', 'Introduces the list of pattern branches');
  }
  // `;&` and `;;&` change what happens after a match.
  const enders = n.namedChildren.flatMap((c) => c.children.filter((t) => t.type === ';&' || t.type === ';;&')).map((t) => t.type);
  const fall = !enders.length ? '' : cx.s(
    `。ただしこの文には \`${[...new Set(enders)].join('\` と \`')}\` があり、分岐の終わりが \`;;\` なら終了、\`;&\` なら次の分岐の中身をパターンを調べずに実行、\`;;&\` なら次以降のパターンの照合を続ける`,
    `. This one has \`${[...new Set(enders)].join('\` and \`')}\`: a branch ending in \`;;\` stops the \`case\`, \`;&\` runs the next branch's commands without testing its pattern, and \`;;&\` goes on testing the patterns after it`);
  return skeletal(cx.tok(n, 'keyword', cx.s(
    `case 文: ${v.text ? `\`${v.text}\` ` : '値（まだ書かれていない）'}を各パターンと上から順に照合し、最初に一致した分岐を実行`,
    `case statement: match ${v.text ? `\`${v.text}\`` : 'the value (not written yet)'} against each pattern in order and run the first match`,
  ) + fall + cx.lineRef(n), sortTokens([...children, ...vt])), n);
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
    : cx.s(`分岐: 値がパターン \`${ptext}\` に一致した場合に実行（\`|\` は「または」）`, `Branch: runs when the value matches \`${ptext}\` (\`|\` means "or")`);
  const patToks = pats
    .filter((p) => cx.onLine(p))
    .map((p) => casePattern(cx, p));
  const rest = ordered(cx, n, (c) => has(pats, c) || c.type === '|' || c.type === ')' || c.type === '(');
  if (!isDefault && (cx.line === null || pats.some((p) => intersects(p, cx.line!)))) {
    cx.examplesAt(n, () => caseExample(cx, n, pats));
  }
  return skeletal(cx.tok(n, 'pattern', expl + (prev && !isDefault ? cx.s('。', '. ') + viaPrev : '') + cx.lineRef(n), sortTokens([...patToks, ...rest])), n);
}

/**
 * `if [ -f a ] then …` and `for x in a b do …`: with no `;` or newline before it, `then` / `do` is an ordinary
 * word, the construct lacks its keyword and bash stops with a syntax error. Marks the token and adds a note.
 */
export function missingKeyword(cx: Explainer, n: SyntaxNode, t: Token): Token {
  const kw = strayKeyword(n);
  if (!kw) return t;
  const msg = cx.s(
    `構文エラー: \`${kw}\` の前に \`;\` か改行が要る。無いと \`${kw}\` はただの引数として読まれ、この構文に \`${kw}\` が無いので、bash は「syntax error near unexpected token」で止まる`,
    `Syntax error: a \`;\` or a newline is needed before \`${kw}\`. Without it \`${kw}\` is read as an ordinary argument, so this construct has no \`${kw}\` and bash stops with "syntax error near unexpected token"`);
  t.kind = 'error';
  t.explanation = `${msg}. ${t.explanation}`;
  cx.note(`⚠ ${msg}`, n);
  return t;
}

export function pipeline(cx: Explainer, n: SyntaxNode): Token {
  // One example for the whole pipeline replaces the examples of its stages.
  const children = cx.examplesReplaced(() => ordered(cx, n), () => {
    const whole = pipelineExample(cx, n);
    return whole && { ...whole, anchor: spanOf(n), kind: 'pipeline' };
  });
  const cmds = children.filter((c) => c.kind !== 'operator' && c.kind !== 'keyword');
  const t = cx.tok(n, 'operator', cx.s(
    `パイプライン: 各コマンドの標準出力を次のコマンドの標準入力につないで、同時に実行する`,
    `Pipeline: each command's stdout feeds the next command's stdin; they run concurrently`,
  ), children);
  t.summary = cmds.map(summaryOf).join(' | ');
  return skeletal(t, n);
}

export function list(cx: Explainer, n: SyntaxNode): Token {
  // Flatten left-nested lists (`a && b || c`) into one sequence.
  const parts: SyntaxNode[] = [];
  const walk = (x: SyntaxNode) => {
    for (const c of x.children) {
      if (c.type === 'list' && !isBlockLike(c)) walk(c);
      else parts.push(c);
    }
  };
  walk(n);
  const children: Token[] = [];
  for (const c of parts) {
    if (c.named) children.push(...cx.sub(c));
    else children.push(...anonOnLine(cx, [c]));
  }
  const t = cx.tok(n, 'operator', cx.s(
    'コマンドリスト: `&&`（成功したら次へ）や `||`（失敗したら次へ）で条件付きにつないだコマンド列',
    'Command list joined by `&&` (run next on success) or `||` (run next on failure)',
  ), children);
  t.summary = children.map((c) => (c.kind === 'operator' && !c.children.length ? c.label : summaryOf(c))).join(' ');
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
  return block(cx, n, 'block', cx.s('ループ本体: `do` から `done` までを繰り返し実行する', 'Loop body: the commands between `do` and `done`'));
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
      return cx.s(`関数 \`${field(n, 'name')?.text}\``, `function \`${field(n, 'name')?.text}\``);
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
