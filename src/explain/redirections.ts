// The explanation of redirections (docs/design/analyzer.md, step 5): each operator with its descriptor and target
// (`>`, `>>`, `>|`, `<`, `<>`, `&>`, `>&`, `<&`, their `-` and `{fd}` forms), here-documents and here-strings, and
// the redirections that apply to a compound command, `time` or assignments as a whole. What a list of
// redirections does to the descriptors comes from `simulateRedirects` (src/idioms.ts); the words of a target are
// words (src/explain/words.ts). A simple command with redirections before or after its words (`splitCommand`) is
// the commands' (step 8).
import type { Token } from '../analyzer-types';
import { fdName, redirects, specialDestinations } from '../dict/syntax';
import { hasGlob } from '../embedded/glob';
import { type Redirect, simulateRedirects } from '../idioms';
import { shorten } from '../label';
import { spanOf } from '../noteanchors';
import { isPlainWord } from '../staticword';
import { field, fields, redirectionsOf, type SyntaxNode } from '../syntax/tree';
import type { Explainer } from './context';
import { isBlockLike, skeletal, sortTokens, summaryOf } from './nodes';
import { globOff, wordAt } from './reads';
import { braceExpansion } from './words';

/** The operator and destination of a file redirection (`>&-` and `<&-`, which close a descriptor, are `>&` and `<&` to `-`). */
export function redirectParts(n: SyntaxNode): { op: string; dest: string } {
  const op = n.children.find((c) => !c.named)!.type;
  return { op, dest: fields(n, 'destination').map((d) => d.text).join(' ') };
}

/** A compound command (or `time`) with the redirections after it. */
export function redirected(cx: Explainer, n: SyntaxNode): Token {
  const body = field(n, 'body')!;
  // (A redirection the parser left without its operator and target is nothing to explain.)
  const redirs = redirectionsOf(n).filter((c) => c.children.length);
  return redirectedWhole(cx, n, body, body.text, cx.sub(body), redirs);
}

/**
 * `body` with redirections that apply to it as a whole: a compound command or `time` (`n` a `redirected_statement`),
 * or the assignments of a command with no name (`body` the first, `text` all of them), none when there are none
 * (`>f`). `bodyToks` explain it.
 */
export function redirectedWhole(cx: Explainer, n: SyntaxNode, body: SyntaxNode | undefined, text: string | undefined, bodyToks: Token[], redirs: SyntaxNode[]): Token {
  const effect = simulateRedirects(redirs.map((r) => redirectInfo(r)), cx.lang);
  if (effect) cx.note(effect, redirs);
  const redirToks = cx.subs(redirs);
  // `time >o`: the keyword carries its redirections.
  if (bodyToks.length === 1 && n.type === 'redirected_statement' && field(n, 'body')!.type === 'time_statement') {
    const t = bodyToks[0];
    return { ...t, span: spanOf(n), children: sortTokens([...t.children, ...redirToks]) };
  }
  // On a line where none of the redirections appear (e.g. a loop header), show the body alone.
  // The label still shows them: `while` *condition* `do` *commands* `done` `< input.txt`.
  if (cx.line !== null && redirToks.length === 0 && bodyToks.length === 1) {
    // On the first line of the construct, the redirections (on a later line) are children of the header: they apply to all of it.
    const header = body!.startPosition.row === cx.line && isBlockLike(body!);
    const t = { ...bodyToks[0] };
    if (header) t.children = sortTokens([...t.children, ...redirs.map((r) => wholeRedirect(cx, r, body!))]);
    return skeletal(t, n);
  }
  // `f() { …; } >&2`: the redirection belongs to the function, not to its definition.
  const ofFunction = n.parent?.type === 'function_definition';
  const w = cx.tok(n, 'redirect', cx.s(
    `入出力のリダイレクト: ${text !== undefined ? `\`${shorten(text, 30)}\` 全体` : 'コマンド'}の入出力を切り替える${ofFunction ? '。関数に付けたリダイレクトは関数と一緒に保存され、関数を呼ぶたびに適用される' : ''}`,
    `Redirection applied to ${text !== undefined ? `\`${shorten(text, 30)}\` as a whole` : 'the command'}${ofFunction ? '. A redirection on a function is stored with it and applied each time the function is called' : ''}`,
  ), sortTokens([...bodyToks, ...redirToks]));
  w.summary = [...bodyToks.map(summaryOf), ...redirToks.map((r) => r.label)].join(' ');
  return skeletal(w, n);
}

/** Operator, descriptor and target of a redirection node, for `simulateRedirects`. */
export function redirectInfo(r: SyntaxNode): Redirect {
  if (r.type === 'file_redirect') {
    const { op, dest } = redirectParts(r);
    return { op, fd: field(r, 'descriptor')?.text ?? '', dest };
  }
  // The only others: heredoc_redirect and herestring_redirect.
  return { op: r.type === 'heredoc_redirect' ? '<<' : '<<<', fd: '', dest: '' };
}

export function fileRedirect(cx: Explainer, n: SyntaxNode): Token {
  const fd = field(n, 'descriptor')?.text ?? '';
  const { op, dest } = redirectParts(n);
  const dests = fields(n, 'destination');
  // Every operator the grammar has is in the dictionary.
  let expl = cx.t(redirects[op](fd, dest));
  const special = specialDestinations[dest];
  if (special) expl += cx.s('。', '. ') + cx.t(special);
  // `>&$fd` and `<&$fd`: the word is expanded first, and what it gives decides whether this duplicates a descriptor.
  if ((op === '>&' || op === '<&') && /[$`]/.test(dest)) expl = fdExpansion(cx, op, fd, dest);
  if (fd === '2' && op === '>&' && dest === '1') {
    expl = cx.s('標準エラー出力(fd 2)を標準出力(fd 1)と同じ出力先に向ける（エラーも一緒に出力・パイプする定番の書き方）',
      'Send stderr (fd 2) to wherever stdout (fd 1) goes (the classic way to capture errors too)');
  }
  if ((fd === '' || fd === '1') && op === '>&' && dest === '2') {
    expl = cx.s('標準出力を標準エラー出力(fd 2)に向ける（メッセージをエラー出力に出す定番の書き方）',
      'Send stdout to stderr (the usual way to print an error message)');
  }
  const children = dests.filter((d) => !isPlainWord(d)).flatMap((d) => cx.sub(d));
  if (dests.length === 1 && (isPlainWord(dests[0]) || dests[0].type === 'brace_expression') && /[*?[{]/.test(dests[0].text)) expl += redirectTargetNote(cx, dests[0]);
  return cx.tok(n, 'redirect', expl, children);
}

/**
 * A redirection target that brace expansion or a glob can turn into other words (`> *.log`, `> {a,b}`): it must
 * become exactly one word, else bash reports an ambiguous redirect. In POSIX mode it is not globbed.
 */
function redirectTargetNote(cx: Explainer, d: SyntaxNode): string {
  const w = wordAt(cx, d);
  const step = (kind: string) => w?.steps.find((s) => s.kind === kind);
  if (step('brace')!.applies === true) {
    const words = braceExpansion(d.text);
    if (!words || words.length !== 1) return cx.s('。ブレース展開で複数の単語になるので、bash は「ambiguous redirect」のエラーにする', '. Brace expansion makes several words of it, so bash reports "ambiguous redirect"');
  }
  const glob = step('glob')!;
  if (!hasGlob(d.text)) return '';
  if (glob.why === 'posix-mode') return globOff(cx, d);
  return glob.applies === true
    ? cx.s(`。\`${d.text}\` はグロブなので、一致するファイルがちょうど1つならその名前になり、2つ以上なら「ambiguous redirect」のエラーになる（なければこの名前のまま）`,
      `. \`${d.text}\` is a glob: it becomes the one file it matches; matching two or more is an error ("ambiguous redirect"), and matching none leaves the name as it is`)
    : '';
}

/** A redirection after the closing word of a compound command, explained on the line where the construct starts: it applies to the whole construct. */
function wholeRedirect(cx: Explainer, r: SyntaxNode, body: SyntaxNode): Token {
  const t = cx.full(r);
  const kind = constructName(body);
  const { op, fd } = redirectInfo(r);
  const num = fd !== '' ? Number(fd) : op.startsWith('<') ? 0 : 1;
  const reads = op.startsWith('<') && num === 0;
  const writes = !op.startsWith('<') && (num === 1 || num === 2);
  t.explanation += cx.s(
    `。${kind.ja}全体に付いている: 中のコマンドすべてに働く${reads ? '（標準入力を読むコマンド、たとえば `read` は、ここから読む。同じ入力を分け合うので、1つが読んだ分は次のコマンドには届かない）' : writes ? `（中のコマンドが${num === 1 ? '標準出力' : '標準エラー出力'}に出すものはここに出る）` : ''}`,
    `. It applies to the whole ${kind.en}: every command in it${reads ? ' that reads stdin, such as `read`, reads from here; they share this one input, so what one reads is not left for the next' : writes ? ` has its ${num === 1 ? 'stdout' : 'stderr'} sent here` : ' is affected'}`,
  );
  return t;
}

function constructName(body: SyntaxNode): { ja: string; en: string } {
  switch (body.type) {
    case 'while_statement': case 'for_statement': case 'c_style_for_statement': case 'select_statement': return { ja: 'ループ', en: 'loop' };
    case 'if_statement': return { ja: '`if` 文', en: '`if` statement' };
    case 'case_statement': return { ja: '`case` 文', en: '`case` statement' };
    case 'subshell': return { ja: 'サブシェル', en: 'subshell' };
    case 'compound_statement': return { ja: 'コマンドグループ', en: 'command group' };
    default: return { ja: 'コマンド', en: 'command' };
  }
}

/** `>&${COPROC[1]}`, `<&$fd`: a word that expands to a number is a descriptor to duplicate, not a file. */
function fdExpansion(cx: Explainer, op: string, fd: string, dest: string): string {
  const coproc = /\bCOPROC\b/.test(dest)
    ? cx.s('。`COPROC` は `coproc` が作る配列で、`[0]` がコプロセスの出力を読む側、`[1]` がコプロセスの入力に書く側のファイルディスクリプタ', '. `COPROC` is the array `coproc` fills in: `[0]` is the descriptor to read the co-process output from, `[1]` the one to write its input to')
    : '';
  if (op === '<&') {
    return cx.s(
      `\`${dest}\` を展開した結果がファイルディスクリプタの番号なら、${fdName(fd, '0').ja}をそのディスクリプタの複製にする（入力元を共有）。数字でなければエラー（ambiguous redirect や Bad file descriptor）${coproc}`,
      `If \`${dest}\` expands to a file descriptor number, make ${fdName(fd, '0').en} a copy of it (sharing the input); anything else is an error (ambiguous redirect or Bad file descriptor)${coproc}`);
  }
  const file = fd && fd !== '1'
    ? cx.s('数字でなければエラー（ambiguous redirect）', 'anything else is an error (ambiguous redirect)')
    : cx.s('数字でなければファイル名とみなし、標準出力と標準エラー出力の両方をそのファイルに書き込む', 'anything else is taken as a file name, and both stdout and stderr are written to that file');
  return cx.s(
    `\`${dest}\` を展開した結果がファイルディスクリプタの番号なら、${fdName(fd, '1').ja}をそのディスクリプタと同じ出力先に向ける。${file}${coproc}`,
    `If \`${dest}\` expands to a file descriptor number, send ${fdName(fd, '1').en} to the same place as that descriptor; ${file}${coproc}`);
}

export function heredoc(cx: Explainer, n: SyntaxNode): Token {
  const op = n.children.find((c) => !c.named)!.type;
  const startNode = n.namedChildren.find((c) => c.type === 'heredoc_start');
  // `cat <<` while typing: the delimiter is not there yet.
  if (!startNode) {
    return cx.tok(n, 'redirect', cx.s(
      `ヒアドキュメント \`${op}\`: 区切り語がまだない。次の行から区切り語だけの行までを標準入力として渡す`,
      `Here-document \`${op}\`: the delimiter is not written yet. The following lines up to a line containing only the delimiter become stdin`));
  }
  const start = startNode.text;
  const body = n.namedChildren.find((c) => c.type === 'heredoc_body');
  const delim = start.replace(/^['"\\]|['"]$/g, '');
  const quoted = start !== delim;
  let expl = cx.s(
    `ヒアドキュメント: 次の行から \`${delim}\` だけの行までを標準入力として渡す`,
    `Here-document: the following lines up to a line containing only \`${delim}\` become stdin`,
  );
  if (op === '<<-') expl += cx.s('。`<<-` なので各行先頭のタブは取り除かれる', '. With `<<-`, leading tabs are stripped');
  expl += quoted
    ? cx.s('。区切り語がクォートされているので本文中の変数やコマンド置換は展開されない', '. The delimiter is quoted, so nothing in the body is expanded')
    : cx.s('。本文中の `$変数` や `$(…)` は展開される', '. `$vars` and `$(…)` in the body are expanded');
  expl += cx.lineRef(n);
  const label = `${op}${start}`;
  // An empty here-document still has a (empty) body.
  const children = cx.subs(body!.namedChildren.filter((c) => c.type !== 'heredoc_content'));
  // Keep the token span on the operator so highlighting does not swallow the whole body.
  return {
    kind: 'redirect', label, explanation: expl, children,
    span: { start: spanOf(n).start, end: spanOf(startNode).end },
  };
}

export function herestring(cx: Explainer, n: SyntaxNode): Token {
  return cx.tok(n, 'redirect', cx.s(
    'ヒアストリング `<<<`: 続く文字列（末尾に改行が付く）を標準入力として渡す',
    'Here-string `<<<`: the following word (plus a newline) becomes stdin',
  ), cx.subs(n.namedChildren.filter((c) => !isPlainWord(c))));
}
