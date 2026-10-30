// The explanation of redirections (docs/design/analyzer.md, step 5): each operator with its descriptor and target
// (`>`, `>>`, `>|`, `<`, `<>`, `&>`, `>&`, `<&`, their `-` and `{fd}` forms), here-documents and here-strings, and
// the redirections that apply to a compound command, `time` or assignments as a whole. What a list of
// redirections does to the descriptors comes from `simulateRedirects` (src/idioms.ts); the words of a target are
// words (src/explain/words.ts). A simple command with redirections before or after its words (`splitCommand`) is
// the commands' (src/explain/commands.ts).
import type { Token } from '../analyzer-types';
import { SHELL_NAMES, featureWorks, type Shell } from '../dialect';
import { fdName, networkPathAsFile, networkRedirect, networkTarget, redirects, specialDestinations } from '../dict/syntax';
import { hasGlob } from '../embedded/glob';
import { type Redirect, simulateRedirects } from '../idioms';
import { shorten } from '../label';
import { fact } from '../messages';
import { spanOf } from '../noteanchors';
import { isPlainWord, staticWordValue } from '../staticword';
import { field, fields, fileContentsOf, redirectionsOf, type SyntaxNode } from '../syntax/tree';
import type { Explainer } from './context';
import { isBlockLike, same, skeletal, sortTokens, summaryOf } from './nodes';
import { globOff, restrictedAt, unquotedWord, wordAt } from './reads';
import { braceExpansion, tilde } from './words';

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
  const w = cx.tok(n, 'redirect', n.type === 'command' && (cx.shell ?? 'bash') === 'bash' ? nameless(cx, n, text) : cx.s(
    `入出力のリダイレクト: ${text !== undefined ? `\`${shorten(text, 30)}\` 全体` : 'コマンド'}の入出力を切り替える${ofFunction ? '。関数に付けたリダイレクトは関数と一緒に保存され、関数を呼ぶたびに適用される' : ''}`,
    `Redirection applied to ${text !== undefined ? `\`${shorten(text, 30)}\` as a whole` : 'the command'}${ofFunction ? '. A redirection on a function is stored with it and applied each time the function is called' : ''}`,
  ), sortTokens([...bodyToks, ...redirToks]));
  w.summary = [...bodyToks.map(summaryOf), ...redirToks.map((r) => r.label)].join(' ');
  return skeletal(w, n);
}

/**
 * The redirections of a command with no name in bash (3.7.1): it opens the files and closes them again, and they apply
 * to nothing, not even to the command substitutions of the assignments (`x=$(ls) 2>/dev/null` still shows the errors
 * of `ls`; checked with bash 5.2 and 5.3). The one command of `$(< f)` is read by the substitution: bash puts the file
 * there. `text`: the assignments.
 */
function nameless(cx: Explainer, n: SyntaxNode, text: string | undefined): string {
  const sub = n.parent!;
  if (fileContentsOf(sub)) return cx.s('`$(< ファイル)` のリダイレクト: bash がファイルを読み、その中身でコマンド置換を置き換える', 'The redirection of `$(< file)`: bash reads the file and puts its contents in place of the command substitution');
  return cx.s(
    `コマンド名のないコマンドのリダイレクト: bash はファイルを開き（\`>\` なら作るか空にし）、すぐに閉じる。シェル自身の入出力は変わらない${text !== undefined ? `。\`${shorten(text, 30)}\` の代入にも効かない（その中のコマンド置換のコマンドは、シェルの標準入力と標準エラー出力をそのまま使う。\`x=$(ls) 2>/dev/null\` でも \`ls\` のエラーは表示される）` : ''}`,
    `Redirections of a command with no name: bash opens the files (creating or emptying one for \`>\`) and closes them again. The shell's own input and output do not change${text !== undefined ? `, nor do they apply to the assignments \`${shorten(text, 30)}\` (the commands of a command substitution there keep the shell's standard input and standard error: in \`x=$(ls) 2>/dev/null\`, the errors of \`ls\` are still shown)` : ''}`,
  );
}

/** Operator, descriptor and target of a redirection node, for `simulateRedirects`. */
export function redirectInfo(r: SyntaxNode): Redirect {
  if (r.type === 'file_redirect') {
    const { op, dest } = redirectParts(r);
    return { op, fd: field(r, 'descriptor')?.text ?? '', dest };
  }
  // The only others: heredoc_redirect and herestring_redirect (`3<<EOF`, `3<<< x`: to descriptor 3); a here-document
  // is named by its delimiter.
  const start = r.namedChildren.find((c) => c.type === 'heredoc_start');
  return { op: r.type === 'heredoc_redirect' ? '<<' : '<<<', fd: field(r, 'descriptor')?.text ?? '', dest: start ? delimiter(start.text) : '' };
}

export function fileRedirect(cx: Explainer, n: SyntaxNode): Token {
  const fd = field(n, 'descriptor')?.text ?? '';
  const { op, dest } = redirectParts(n);
  const dests = fields(n, 'destination');
  // `> {a,}` writes `a`: the one word brace expansion makes of the target.
  const braced = dests.length === 1 ? bracedTarget(cx, dests[0]) : undefined;
  // The word after quote removal, when known: `>&"2"` duplicates, `> "/dev/tcp/h/80"` connects.
  const target = braced ?? (dests.length === 1 ? staticWordValue(dests[0], false, cx.shell) : undefined) ?? dest;
  // Every operator the grammar has is in the dictionary.
  let expl = cx.t(redirects[op](fd, braced ?? (op === '>&' || op === '<&' ? target : dest)));
  if (braced) expl += cx.s(`。ブレース展開で \`${dest}\` は1つの単語 \`${braced}\` になる`, `. Brace expansion makes \`${dest}\` the one word \`${braced}\``);
  // `/dev/tcp/host/port`: bash connects to the network, where other shells see a path.
  const net = networkTarget(op, fd, target);
  if (net && featureWorks('netRedirect', cx.shell)) return { ...cx.tok(n, 'redirect', cx.t(networkRedirect(op, fd, net, target)), dests.filter((d) => !isPlainWord(d)).flatMap((d) => cx.sub(d))), refs: ['3.6'] };
  if (net) expl += cx.s('。', '. ') + cx.t(networkPathAsFile(cx.shell === 'sh' ? undefined : SHELL_NAMES[cx.shell!]));
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
  // A restricted shell refuses to open a file for output (6.10); duplicating or closing a descriptor is fine (`>&2`, `>&-`).
  // (Not said of a function's own redirection, which applies, and fails, at each call: `f() { …; } > g`.)
  if (OUTPUT.has(op) && !(op === '>&' && /^(\d+-?|-)$/.test(target)) && !/^>&[$`]/.test(op + dest) && !(n.parent!.type === 'redirected_statement' && n.parent!.parent!.type === 'function_definition') && restrictedAt(cx, n)) {
    cx.note(fact(cx.lang, 'restricted-refused', { kind: 'redirect', name: op, word: target }), n);
  }
  if (dests.length === 1 && unquotedWord(dests[0]) !== undefined && /[*?[{]/.test(dests[0].text)) expl += redirectTargetNote(cx, dests[0]);
  const later = OPENS_FILE.has(op) ? replacedBy(n) : undefined;
  if (later) expl += replacedFile(cx, op, fd, n, dests, later);
  return cx.tok(n, 'redirect', expl, children);
}

/** The operators that redirect output, which a restricted shell refuses when they open a file (Bash manual 6.10). */
const OUTPUT: ReadonlySet<string> = new Set(['>', '>|', '<>', '>&', '&>', '>>', '&>>']);

/** The file redirections that open a file on one descriptor, which a later redirection of that descriptor can replace. */
const OPENS_FILE: ReadonlySet<string> = new Set(['<', '>', '>>', '>|', '<>']);

/**
 * The files that stand for a descriptor: `/dev/stdout` is 1. Where the system has them, bash opens them as files (3.6):
 * on Linux, `/proc/self/fd/N` opened anew (`>` empties a regular file, which gets an offset of its own); elsewhere
 * bash copies the descriptor. Either way the redirection gets what that descriptor has.
 */
function deviceDescriptor(path: string): number | undefined {
  const m = /^\/dev\/(?:(stdin)|(stdout)|(stderr)|fd\/(\d+))$/.exec(path);
  return !m ? undefined : m[1] ? 0 : m[2] ? 1 : m[3] ? 2 : Number(m[4]);
}

/**
 * The descriptors a redirection sets, and the one it copies, if any. `{name}>…` takes a new descriptor of its own,
 * left out, but copies one all the same (`{v}>&1`). A file that stands for a descriptor (`>/dev/stdout`) copies it.
 */
function descriptors(r: Redirect): { sets: number[]; copies?: number | 'unknown' } {
  const named = /^\{.*\}$/.test(r.fd);
  const fd = r.fd !== '' && !named ? Number(r.fd) : r.op.startsWith('<') ? 0 : 1;
  const own = named ? [] : [fd];
  if (r.op === '&>' || r.op === '&>>') return { sets: [1, 2] };
  const device = OPENS_FILE.has(r.op) ? deviceDescriptor(r.dest) : undefined;
  if (r.op !== '>&' && r.op !== '<&') return device === undefined ? { sets: own } : { sets: own, copies: device };
  if (r.dest === '-') return { sets: own };
  const from = /^(\d+)(-?)$/.exec(r.dest);
  if (from) return { sets: from[2] ? [...own, Number(from[1])] : own, copies: Number(from[1]) };
  // `>&file` is `&>file`; `<&$fd`, `2>&$fd`: a descriptor not known here, or a file.
  return r.op === '>&' && fd === 1 && !named && !/[$`]/.test(r.dest) ? { sets: [1, 2] } : { sets: own, copies: 'unknown' };
}

/**
 * The path a redirection opens as a file (`>a`, `&>a`, `>&a`), when its word is known here (undefined: not known, as
 * `"$f"` or an unquoted glob), in a script for `shell`; null when it opens none (a here-document, a copy, a close).
 */
function openedPath(r: SyntaxNode, shell: Shell | undefined): string | undefined | null {
  if (r.type !== 'file_redirect') return null;
  const info = redirectInfo(r);
  const d = descriptors(info);
  if (!OPENS_FILE.has(info.op) && info.op !== '&>' && info.op !== '&>>' && (d.copies !== undefined || info.dest === '-')) return null;
  const words = fields(r, 'destination');
  if (words.length !== 1 || (isPlainWord(words[0]) && /[*?[]/.test(words[0].text))) return undefined;
  return staticWordValue(words[0], false, shell);
}

/** Whether two paths name the same file as written (`a`, `./a`, `.//a`). */
function samePath(a: string, b: string): boolean {
  const norm = (p: string): string => (p.startsWith('/') ? '/' : '') + p.split('/').filter((s) => !/^\.?$/.test(s)).join('/');
  return norm(a) === norm(b);
}

/**
 * Whether two paths that differ as written may still name the same file: one with a `..` part (`b/../a` is `a` when `b`
 * is a directory), or an absolute one and a relative one (`/tmp/a` is `a` in /tmp). A device (`isDevice`) is only the
 * same as a relative path from /dev, which is left out. Links (symbolic or hard) are not seen here: two plain paths
 * (`a`, `b`) are taken for two files.
 */
function maySamePath(a: string, b: string): boolean {
  const up = (p: string): boolean => p.split('/').includes('..');
  if (up(a) || up(b)) return true;
  return a.startsWith('/') !== b.startsWith('/') && !isDevice(a) && !isDevice(b);
}

/**
 * The devices a redirection opens with nothing to create or empty: `/dev/null`, `/dev/zero`, `/dev/full`, `/dev/random`,
 * `/dev/urandom`, `/dev/tty`, and the files of a descriptor (`deviceDescriptor`). Any other path under /dev is a file
 * (`/dev/shm/data`). (`/dev/tcp/…` and `/dev/udp/…` connect, where the shell does that: `networkTarget`.)
 */
function isDevice(path: string): boolean {
  return /^\/dev\/(?:null|zero|full|u?random|tty)$/.test(path) || deviceDescriptor(path) !== undefined;
}

/**
 * The later redirection of the same command that sets again the one descriptor `n` opens, before the command starts, with
 * none between that copies it (`>a 2>&1 >b` keeps `a` for stderr): bash opens `n` first, and the command never reads or
 * writes it (`cat <<A <<B` reads `B` only).
 */
function replacedBy(n: SyntaxNode): SyntaxNode | undefined {
  const all = redirectionsOf(n.parent!);
  const own = descriptors(redirectInfo(n)).sets;
  if (own.length !== 1) return undefined;
  for (const r of all.slice(all.findIndex((x) => same(x, n)) + 1)) {
    const d = descriptors(redirectInfo(r));
    if (d.copies === own[0] || d.copies === 'unknown') return undefined;
    if (d.sets.includes(own[0])) return r;
  }
  return undefined;
}

/** A redirection as its line has it: a here-document without its body (`<<EOF`). */
function written(r: SyntaxNode): string {
  const start = r.namedChildren.find((c) => c.type === 'heredoc_start');
  return start ? `${field(r, 'descriptor')?.text ?? ''}${r.children.find((c) => !c.named)!.type}${start.text}` : r.text;
}

/**
 * `cat <a <b`, `echo >a >b`: what bash still does with the file of a redirection that a later one replaces. Nothing
 * when the later one opens the same file (`>s >>s` writes to `s`); when either word is not known here (`>a >"$f"`), or
 * the paths may name the same file (`maySamePath`: `>a >b/../a`), it says that the same file would be used. A device
 * (`/dev/null`) is only opened.
 */
function replacedFile(cx: Explainer, op: string, fd: string, n: SyntaxNode, dests: SyntaxNode[], later: SyntaxNode): string {
  const own = openedPath(n, cx.shell);
  const other = openedPath(later, cx.shell);
  if (own && other && samePath(own, other)) return '';
  const dest = dests.map((d) => d.text).join(' ');
  const name = op.startsWith('<') ? fdName(fd, '0') : fdName(fd, '1');
  const device = !!own && isDevice(own);
  const what = op === '<' ? cx.s(`\`${dest}\` は開かれる（存在しなければエラー）が、読まれない`, `\`${dest}\` is opened (it must exist) but not read`)
    : op === '<>' ? (device ? cx.s(`\`${dest}\` は開かれるが、使われない`, `\`${dest}\` is opened but not used`)
      : cx.s(`\`${dest}\` は開かれる（なければ作られる）が、使われない`, `\`${dest}\` is opened (and created if missing) but not used`))
    : device ? cx.s(`\`${dest}\` は開かれるが、何も書き込まれない`, `\`${dest}\` is opened, but nothing is written to it`)
    : op === '>>' ? cx.s(`\`${dest}\` はなければ作られるが、何も書き込まれない`, `\`${dest}\` is created if missing, but nothing is written to it`)
    : cx.s(`\`${dest}\` は作られる（中身は空になる）が、何も書き込まれない`, `\`${dest}\` is created or emptied, but nothing is written to it`);
  // (A word not known here, or a path with `..` or another root, may name the same file: then that file is used.)
  const unknown = other !== null && (typeof own !== 'string' || other === undefined || maySamePath(own, other));
  const unless = !unknown ? '' : cx.s(`（\`${written(later)}\` が同じファイルを指すなら、このファイルが使われる）`, ` (unless \`${written(later)}\` names the same file, which is then used)`);
  return cx.s(`。ただし後の \`${written(later)}\` が続けて${name.ja}を置き換えるので、${what}${unless}`, `. But the later \`${written(later)}\` then replaces ${name.en}: ${what}${unless}`);
}

/** The one word brace expansion makes of a redirection target that differs from it (`{a,}` is `a`: an empty word is dropped). */
function bracedTarget(cx: Explainer, d: SyntaxNode): string | undefined {
  if (unquotedWord(d) === undefined || !d.text.includes('{')) return undefined;
  if (!braceWorks(cx, d)) return undefined;
  const words = braceExpansion(d);
  return words?.length === 1 && words[0] !== d.text ? words[0] : undefined;
}

/** Whether the shell brace-expands the target here (the word model says: not in dash, nor with `set +B`; `> {a,}` writes `{a,}` in dash). */
function braceWorks(cx: Explainer, d: SyntaxNode): boolean {
  return wordAt(cx, d)!.steps.find((s) => s.kind === 'brace')!.applies === true;
}

/**
 * A redirection target that brace expansion or a glob can turn into other words (`> *.log`, `> {a,b}`): it must
 * become exactly one word, else bash reports an ambiguous redirect. In POSIX mode it is not globbed.
 */
function redirectTargetNote(cx: Explainer, d: SyntaxNode): string {
  const w = wordAt(cx, d);
  const step = (kind: string) => w?.steps.find((s) => s.kind === kind);
  if (braceWorks(cx, d)) {
    const words = braceExpansion(d);
    if (words?.length === 0) return cx.s('。ブレース展開で空の単語だけになって単語が残らないので、bash は「ambiguous redirect」のエラーにする', '. Brace expansion leaves no word of it (empty words are dropped), so bash reports "ambiguous redirect"');
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

/** The delimiter of a here-document as its line has it: `'EOF'`, `"EOF"` and `\EOF` end at `EOF`. */
function delimiter(start: string): string {
  return start.replace(/^['"\\]|['"]$/g, '');
}

/** Where a here-document or a here-string goes: stdin, or the descriptor written before the operator (`3<<EOF`). */
function hereTarget(cx: Explainer, n: SyntaxNode): string {
  const fd = field(n, 'descriptor')?.text ?? '';
  const name = fdName(fd, '0');
  const variable = /^\{(.+)\}$/.exec(fd)?.[1];
  if (variable) return cx.s(`空いているファイルディスクリプタ（10 以上。番号は変数 \`${variable}\` に入る）の入力`, `the input of a free file descriptor (10 or higher, its number stored in variable \`${variable}\`)`);
  return fd === '' || fd === '0' ? cx.s('標準入力', 'stdin') : cx.s(name.ja, name.en);
}

export function heredoc(cx: Explainer, n: SyntaxNode): Token {
  const op = n.children.find((c) => !c.named)!.type;
  const startNode = n.namedChildren.find((c) => c.type === 'heredoc_start');
  const to = hereTarget(cx, n);
  // `cat <<` while typing: the delimiter is not there yet.
  if (!startNode) {
    return cx.tok(n, 'redirect', cx.s(
      `ヒアドキュメント \`${op}\`: 区切り語がまだない。次の行から区切り語だけの行までを${to}として渡す`,
      `Here-document \`${op}\`: the delimiter is not written yet. The following lines up to a line containing only the delimiter become ${to}`));
  }
  const start = startNode.text;
  const body = n.namedChildren.find((c) => c.type === 'heredoc_body');
  const delim = delimiter(start);
  const quoted = start !== delim;
  const later = replacedBy(n);
  let expl = later
    ? cx.s(`ヒアドキュメント: 次の行から \`${delim}\` だけの行まで。${to}として開かれるが、後の \`${written(later)}\` が続けて${to}を置き換えるので、コマンドはこれを読まない`,
      `Here-document: the following lines up to a line containing only \`${delim}\`, opened as ${to}; but the later \`${written(later)}\` then replaces ${to}, so the command does not read them`)
    : cx.s(
      `ヒアドキュメント: 次の行から \`${delim}\` だけの行までを${to}として渡す`,
      `Here-document: the following lines up to a line containing only \`${delim}\` become ${to}`,
    );
  if (op === '<<-') expl += cx.s('。`<<-` なので各行先頭のタブは取り除かれる', '. With `<<-`, leading tabs are stripped');
  expl += quoted
    ? cx.s('。区切り語がクォートされているので本文中の変数やコマンド置換は展開されない', '. The delimiter is quoted, so nothing in the body is expanded')
    : cx.s('。本文中の `$変数` や `$(…)` は展開される', '. `$vars` and `$(…)` in the body are expanded');
  // (Its own lines: the body and the end, after those of the here-documents before it on the line; the end alone when
  // the body is empty, but not on the operator's line, where one that is never ended starts.)
  expl += cx.lineRef(body!, n, body!.startPosition.row > n.startPosition.row);
  const label = written(n);
  // An empty here-document still has a (empty) body.
  const children = cx.subs(body!.namedChildren.filter((c) => c.type !== 'heredoc_content'));
  // Keep the token span on the operator so highlighting does not swallow the whole body.
  return {
    kind: 'redirect', label, explanation: expl, children,
    span: { start: spanOf(n).start, end: spanOf(startNode).end },
  };
}

export function herestring(cx: Explainer, n: SyntaxNode): Token {
  const to = hereTarget(cx, n);
  const later = replacedBy(n);
  return cx.tok(n, 'redirect', later
    ? cx.s(`ヒアストリング \`<<<\`: 続く文字列（末尾に改行が付く）。${to}として開かれるが、後の \`${written(later)}\` が続けて${to}を置き換えるので、コマンドはこれを読まない`,
      `Here-string \`<<<\`: the following word (plus a newline), opened as ${to}; but the later \`${written(later)}\` then replaces ${to}, so the command does not read it`)
    : cx.s(
      `ヒアストリング \`<<<\`: 続く文字列（末尾に改行が付く）を${to}として渡す`,
      `Here-string \`<<<\`: the following word (plus a newline) becomes ${to}`,
    // (A plain word says nothing more, but its tildes: `<<< ~/x`, `<<< x:~`.)
    ), [...cx.subs(n.namedChildren.filter((c) => !isPlainWord(c) && c.type !== 'file_descriptor')), ...n.namedChildren.filter(isPlainWord).flatMap((c) => tilde(cx, c) ?? [])]);
}
