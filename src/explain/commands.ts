// Simple commands (docs/design/analyzer.md, step 8): what the name runs (src/semantics/names.ts: an alias, a function
// of the script, a builtin, a program of the dictionary or of the customCommands setting, a path), with the notes on
// definitions that do not apply here; the assignments before the name, and what each does (`assignmentsOf`); the
// words, read by the spec of the command run (src/explain/argv.ts), or as the expression of `test` and `[`; the
// examples of the command; a command with redirections before or after its words, as the shell runs it (the
// redirections set up first, the command inside); and the keyword `time`.
import type { Kind, Span, Token } from '../analyzer-types';
import type { ArgRole, ArgvParse } from '../argv/interpret';
import { onlyInFunction, readsFields } from '../argv/query';
import type { CommandSpec } from '../argv/spec';
import type { Basis } from '../basis';
import { argWord } from '../argv/words';
import { lookupCommand } from '../dict/aliases';
import { customCommandSpec } from '../dict/custom';
import { distroAliases } from '../dict/distroAliases';
import { fdName, keywords } from '../dict/syntax';
import { yqSpecsOf } from '../dict/yq';
import { judgeYq } from '../embedded/yq';
import { lineLabel, lineListLabel, type Text, tx } from '../i18n';
import { bracket as bracketLabel, labelText, shorten } from '../label';
import { plainOf } from '../messages-levels';
import { fact } from '../messages';
import { TURNS_ALIASES_ON } from '../messages-alias';
import { unreadClause } from '../messages-common';
import { nameInfo } from '../namefacts';
import { builtinSections, programSections } from '../refs';
import { bashrcReader, inFunction, processOf, readAs, shellEffectOf } from '../semantics/env';
import { aliasExpandsNext } from '../semantics/effects';
import { type AliasResolution, aliasesAfter, assignmentsOf, type MaybeHashed, type Missed, type NameResolution, testSpecOf } from '../semantics/names';
import { docLine, option, type ShellState } from '../semantics/state';
import { wordMeaning } from '../semantics/words';
import { isPlainWord, literalContent, staticWordValue, surelyHasSlash } from '../staticword';
import { returnInSubstitution, scopeOf } from '../substitution-tokens';
import { field, fields, redirectionsOf, type SyntaxNode, token, wordsText } from '../syntax/tree';
import { commandTest } from '../testexpr';
import { readByCommand } from '../tokenmarks';
import { bashTest, readArgs, testArgs } from './argv';
import { type Explainer, memoKey } from './context';
import { commandExampleFor, unreadStdin, wordExample } from './examples';
import { same, skeletal, sortTokens, summaryOf } from './nodes';
import { redirectionNotes, redirectParts } from './redirections';
import { hostCommand, NO_SPEC, programBasis, resolve, restrictedAt, restrictedCall, shellVariant, specFor, unquotedWord } from './reads';
import { exitRefusedNote, posixExitNote, statusRangeNote } from './status';
import { shellEffectNote } from './where';
import { bracesHere, braceWord, braceWords, bracesMaybeOff, plainText, shown, tilde } from './words';

interface CommandHead {
  /** `res`: what bash runs for the name (src/semantics/names.ts), whose facts the badge shows (src/namefacts.ts). */
  name: string; res?: NameResolution; spec?: CommandSpec; kind: Kind; explanation: string; nameTokens: Token[];
  /** A call of a function defined in the script (`maybe`: on some paths only). */
  fn?: true | 'maybe';
  /** The name is an expansion the model does not read: no name for the argument reader (`$cmd -x`). */
  unnamed?: true;
  /** The sections of the manual on what the name runs: a builtin's, a function's (3.3), an alias's (6.6). */
  refs?: readonly string[];
  /** The spec of `test` or `[`, when the name runs one of them (src/semantics/names.ts, `testSpecOf`). */
  test?: CommandSpec;
  /** The command whose spec reads the words, when it is not `name`: what an alias runs (`alias g=grep`). */
  runs?: string;
  /** What the command's token rests on: the spec of the program it runs, from the dictionary or the host (`programBasis`). */
  basis?: Basis;
}

/** An alias whose text is one plain word: the alias runs that command with the same words. */
function alias1(value: string): boolean {
  return /^[^\s;|&<>()'"`$\\=]+$/.test(value);
}

/** The subcommand a parse names, if any (`git stash push`: `stash`, whose parse names `push`). */
const subcommandOf = (p: ArgvParse) => p.roles.find((r): r is { word: number; role: Extract<ArgRole, { role: 'subcommand' }> } => r.role.role === 'subcommand');

/** What `redirectLayout` found: the redirections in source order, and the range and text of the command's words. */
interface Layout { redirs: SyntaxNode[]; span: Span; text: string }

export function command(cx: Explainer, n: SyntaxNode): Token {
  // (What the status says, also of a command with redirections: `exit 256 2>/dev/null`, `export 1x 2>/dev/null`.)
  statusRangeNote(cx, n);
  exitRefusedNote(cx, n);
  posixExitNote(cx, n);
  // `>f echo x`, `<<<'1 2' read a b`: redirections before the words.
  const split = redirectLayoutOf(cx, n);
  if (split) return split;
  // (`echo a > f b 2>&1`: a redirection among the words, and more of them.)
  redirectionNotes(cx, n, redirectionsOf(n));
  return cx.examplesOf(n, () => {
    return commandToken(cx, n);
  });
}

/**
 * The words of a simple command and its redirections, when the words are one range with no redirection
 * among them: the redirections are all before or after them (`tr -d x < a > b`, `>f echo x`). Undefined when
 * there are none, or one stands in the middle (`echo a > f b`).
 */
function redirectLayout(n: SyntaxNode): Layout | undefined {
  const redirs = redirectionsOf(n);
  const words = n.children.filter((c) => c.field !== 'redirect');
  const first = words[0];
  const last = words[words.length - 1];
  if (!redirs.length || redirs.some((r) => r.startIndex > first.startIndex && r.startIndex < last.endIndex)) return undefined;
  const text = n.text.slice(first.startIndex - n.startIndex, last.endIndex - n.startIndex);
  return {
    redirs, text,
    span: { start: { line: first.startPosition.row, character: first.startPosition.column }, end: { line: last.endPosition.row, character: last.endPosition.column } },
  };
}

/** `splitCommand` of a command whose redirections are all before or after its words, if there are any. */
function redirectLayoutOf(cx: Explainer, n: SyntaxNode): Token | undefined {
  const layout = redirectLayout(n);
  return layout && splitCommand(cx, n, n, layout);
}

/**
 * A command with redirections, as the shell runs it: it sets the redirections up, then starts the command, which
 * never sees them. So the redirections are one token (`whole`) with two kinds of children: the command (the
 * words only, with its description and examples) and each redirection.
 */
function splitCommand(cx: Explainer, whole: SyntaxNode, body: SyntaxNode, layout: Layout): Token {
  redirectionNotes(cx, whole, layout.redirs);
  const tail: Tail = {};
  const inner = cx.examplesOf(body, () => commandToken(cx, body, tail), layout);
  inner.span = layout.span;
  const redirToks = cx.subs(layout.redirs);
  const fds = new Set<string>();
  for (const r of layout.redirs) {
    const { op, dest } = r.type === 'file_redirect' ? redirectParts(r) : { op: r.type === 'heredoc_redirect' ? '<<' : '<<<', dest: '' };
    const fd = field(r, 'descriptor')?.text ?? '';
    // `>& file` (no number, no `$`) is the same as `&> file`.
    if (op === '&>' || op === '&>>' || (op === '>&' && fd === '' && !/^\d*-?$|[$`]/.test(dest))) { fds.add('1'); fds.add('2'); } else if (!/^\{/.test(fd)) fds.add(fd || (op.startsWith('<') ? '0' : '1'));
  }
  const names = [...fds].sort().map((fd) => fdName(fd, fd));
  const cmd = shorten(layout.text, 30);
  // (`exec >log 2>&1`: with no command to run, `exec` applies them to this shell, for every command after it: 4.1.)
  const w = cx.tok(whole, 'redirect', cx.text(tail.toShell ? 'cmd-redirect-no-command' : 'cmd-redirect-around', { cmd, names }), sortTokens([inner, ...redirToks]));
  w.summary = summaryOf(inner);
  w.around = 'redirections';
  return skeletal(w, whole);
}

/**
 * What the token of a command whose redirections are explained around it (`splitCommand`) tells them: `toShell`, it
 * is a builtin whose command would replace the shell, given none (`exec >log`), so they apply to this shell (4.1).
 */
interface Tail { toShell?: boolean }

/** A slot of `spec` that would replace the shell (`exec cmd`). */
const replacesShell = (spec: CommandSpec): boolean => !!spec.operands?.some((alt) => alt.pattern.some((o) => o.command?.replacesShell));

/** The token of a simple command; with `tail`, its redirections are explained around it, and left out here. */
function commandToken(cx: Explainer, n: SyntaxNode, tail?: Tail): Token {
  const nameNode = field(n, 'name')!;
  const { prefix, args, redirs } = commandParts(cx, n, nameNode);
  // `time` is a keyword at the start of a pipeline (a `time_statement`); `FOO=1 time x` and `a | time x` run the program.
  return commandTail(cx, n, nameNode, args, prefix, tail ? [] : redirs, tail);
}

/**
 * `toks`, the tokens of the words of the command `n`, with those of the words after the alias `res` that bash reads as
 * aliases too (6.6: `alias s='sudo '`, `s ll`) saying so.
 */
function aliasArguments(cx: Explainer, n: SyntaxNode, res: AliasResolution, toks: Token[]): Token[] {
  const after = aliasesAfter(n, res, (name, w) => resolve(cx, name, w));
  return toks.map((t) => {
    const a = after.find((x) => x.word.startPosition.row === t.span.start.line && x.word.startPosition.column === t.span.start.character && x.word.text === t.label);
    if (!a) return t;
    const { name, alias, target } = a.res;
    const line = docLine(alias.at) + 1;
    // (The first word of its text is checked too: `alias a2='b2 ' b2='c2 '`.)
    const chain = target?.kind === 'alias' ? cx.s(`（\`${target.name}\` もエイリアスで、\`${target.alias.value}\` に置き換わる）`, ` (\`${target.name}\` is an alias too, for \`${target.alias.value}\`)`) : '';
    return {
      ...cx.tok(a.word, 'alias', cx.text('cmd-alias-next-word', { line, name, value: alias.value, chain })),
      refs: ['6.6'],
    };
  });
}

/** The assignments before the command name (as tokens), the arguments, and the redirections of a command. */
function commandParts(cx: Explainer, n: SyntaxNode, nameNode: SyntaxNode): { prefix: Token[]; args: SyntaxNode[]; redirs: SyntaxNode[] } {
  const prefix: Token[] = [];
  const args: SyntaxNode[] = [];
  const redirs: SyntaxNode[] = [];
  let seenName = false;
  // What each assignment before the name does (src/semantics/names.ts): in POSIX mode (sh, dash, `set -o posix`)
  // one before a special builtin stays after it.
  const word = nameNode.namedChildren[0];
  // (An unquoted expansion alone may give no word: `x=1 $cmd`.)
  const spelled = staticWordValue(word, false, cx.shell);
  const dynamic = spelled === undefined && ['simple_expansion', 'expansion', 'command_substitution'].includes(word.type);
  const meanings = n.children.some((c) => c.type === 'variable_assignment')
    ? assignmentsOf(cx.state, n, dynamic ? 'dynamic' : resolve(cx, spelled ?? nameNode.text, nameNode))
    : [];
  for (const c of n.children) {
    if (same(c, nameNode)) { seenName = true; continue; }
    if (c.type.endsWith('redirect')) { redirs.push(c); continue; }
    if (!seenName && c.type === 'variable_assignment') {
      const meaning = meanings.find((m) => m.node === c)!;
      const stays = meaning.scope === 'persists';
      for (const t of cx.sub(c)) {
        t.refs = meaning.named ? ['3.7.4', '4.1'] : stays ? ['3.7.4', '4.4'] : ['3.7.4'];
        t.explanation = meaning.named
          ? cx.text('cmd-prefix-assignment-named', { named: meaning.named, what: t.explanation })
          : stays && !meaning.sure
          ? cx.text('cmd-prefix-assignment-posix-maybe', { name: nameNode.text, what: t.explanation })
          : stays
          ? cx.text('cmd-prefix-assignment-posix', { name: nameNode.text, what: t.explanation })
          : !meaning.sure && !fields(n, 'argument').length
          ? cx.text('cmd-prefix-assignment-env-maybe-alone', { name: nameNode.text, what: t.explanation })
          : !meaning.sure
          ? cx.text('cmd-prefix-assignment-env-maybe', { name: nameNode.text, what: t.explanation })
          : cx.text('cmd-prefix-assignment-env', { what: t.explanation });
        prefix.push(t);
      }
      continue;
    }
    if (c.named) args.push(c);
  }
  return { prefix, args, redirs };
}

/**
 * What `local` outside a function stops in `cx.shell`: nothing in bash (it fails, status 1); in dash and busybox ash,
 * the shell that runs it (`processOf`): the script, a subshell, or one not known to be either.
 */
function localStops(cx: Explainer, n: SyntaxNode): false | 'script' | 'subshell' | 'shell' {
  if (!cx.shell || cx.shell === 'bash') return false;
  const p = processOf(cx.state.env(n));
  return p.kind === 'main' ? 'script' : p.kind === 'subshell' && p.sure ? 'subshell' : 'shell';
}

function commandTail(cx: Explainer, n: SyntaxNode, nameNode: SyntaxNode, args: SyntaxNode[], prefix: Token[], redirs: SyntaxNode[], tail?: Tail, word?: SyntaxNode): Token {
  const head = commandHead(cx, nameNode, word);
  const yq = yqSpecsOf(head.name);
  if (yq) {
    // Three tools are called yq; explain the arguments as the one this command is for.
    const verdict = judgeYq(args.map((a) => literalContent(a)?.text), { doc: cx.source, host: cx.opts.host, setting: cx.opts.yqFlavor });
    head.spec = yq[verdict.flavor];
    head.explanation = cx.t(head.spec.summary);
    // A command over several lines is explained whole, so it always starts on the line explained.
    cx.note(fact(cx.lang, 'yq-flavour', { verdict }), n);
    cx.note(fact(cx.lang, 'yq-compat', { verdict }), n);
  }
  const where = head.kind === 'builtin' && onlyInFunction(head.spec!, cx.shell) && scopeOf(n) !== 'substitution' ? inFunction(cx.state.env(n)) : undefined;
  if (where === 'no' || where === 'trap') {
    // (A trap's action runs where the trap fires, which may be in a function; a file with no shebang may be read with
    // `source` by a function, where `local` works: a caveat.)
    const sourced = readAs(cx.state.env(n), cx.state.read) === 'unknown';
    cx.note(fact(cx.lang, 'local-outside-function', { stops: localStops(cx, n), ...(where === 'trap' ? { trap: true } : sourced ? { sourced } : {}) }), n);
  }
  if (head.kind === 'builtin' && head.spec!.ends === 'function') head.explanation = returnInSubstitution(cx, n) ?? head.explanation;
  // (A builtin that reads its words otherwise in the shell options on here: `kill` in POSIX mode, 6.11.)
  const variant = head.kind === 'builtin' ? shellVariant(cx, n, head.spec!) : undefined;
  if (variant) {
    head.spec = { ...head.spec!, ...variant.spec };
    head.explanation += cx.sep() + cx.t(variant.text);
  }
  // (A function of the script is not the command its name suggests: no example of that command. Nor is a name that
  // may run a path `hash -p` gave it (also through an alias), or that runs one of a program the dictionary does not
  // know: its words are read with the name's spec, but give no example of it.)
  const other = !!head.fn || !!maybeHashedOf(head.res) || (head.res?.kind === 'file' && head.res.path === 'hashed' && !head.res.known);
  const reading = () => readArgs(cx, head.spec, args, head.unnamed ? '' : head.runs ?? head.name, head.fn);
  // (Nor do the words give examples of the command when one is read as fields that are options or values, which the
  // examples would read as written: `x='-n 3'; head $x f`. A glob's or a brace expansion's stay.)
  const read = cx.examplesDropped(reading, (r, e) => (other && !!head.spec) || (readsFields(r.parse) && e.kind !== 'glob' && e.kind !== 'expansion'));
  // A restricted shell refuses some calls of builtins, and command names with a `/` (6.10).
  // (A name with a `/` only inside an expansion may have none: `"${tool##*/}"`.)
  const refused = head.kind === 'builtin' ? restrictedCall(cx, n, head.spec!, read.parse, args)
    : head.kind === 'command' && surelyHasSlash(word ?? nameNode.namedChildren[0]!) && restrictedAt(cx, n) ? {} : undefined;
  if (refused) cx.note(fact(cx.lang, 'restricted-refused', { kind: head.kind === 'command' ? 'slash' : 'builtin', name: head.name, ...refused }), n);
  if (tail && head.kind === 'builtin' && replacesShell(head.spec!) && !read.parse.roles.some((r) => r.role.role === 'command')) tail.toShell = true;
  let argToks = read.tokens;
  // (After an alias whose text ends with a blank, bash reads the next word as an alias too: 6.6.)
  if (head.res?.kind === 'alias') argToks = aliasArguments(cx, n, head.res, argToks);
  // `test` and `[` read their words as an expression (src/testexpr.ts), when the name runs one of them.
  const bracket = head.test?.closingOperand !== undefined;
  if (head.test) argToks = readByCommand(testArgs(cx, n, commandTest(head.test, args, bashTest(cx, head.test)), bracket, !!head.test.builtin));
  if (!other) {
    unreadStdin(cx, n, read.parse, args, head.name);
    commandExampleFor(cx, n, head.spec, args, read.parse);
  }
  for (const a of args) {
    cx.examplesAt(a, () => wordExample(cx, a, { name: head.name, node: n, args, ...(other ? {} : { spec: head.spec }) }));
  }
  // `[` is a command and `]` its last argument: they get tokens of their own, around the condition.
  const nameToks = bracket ? [cx.tok(word ?? nameNode, head.kind, head.kind === 'builtin'
    ? cx.text('cmd-bracket-builtin-name')
    : cx.text('cmd-bracket-program-name'), head.nameTokens)] : head.nameTokens;
  const t = cx.tok(n, bracket ? 'test' : head.kind, head.explanation, sortTokens([
    ...prefix, ...nameToks, ...argToks, ...cx.subs(redirs),
  ]), bracket ? shorten(wordsText(n)) : shorten((word ?? nameNode).text));
  const name = head.res && nameInfo(cx.lang, head.res, cx, nameNode);
  if (name) (bracket ? nameToks[0] : t).name = name;
  // (A program's token rests on its spec, and the tokens it reads on the token: `tokenBasisFor`. The analyzer drops it
  // with `notes.basis` off.)
  if (head.basis) t.basis = head.basis;
  t.summary = bracket ? cx.s(`条件判定 ${shorten(wordsText(n), 40)}`, `test ${shorten(wordsText(n), 40)}`) : `${head.name}: ${head.explanation}${name?.runs === 'builtin' ? name.said.short : ''}`;
  if (head.refs?.length) t.refs = bracket ? [...head.refs, '6.4'] : head.refs;
  // (The name `[` is the builtin's, as `test` is: its section, 4.1.)
  if (bracket && head.refs?.length) nameToks[0].refs = head.refs;
  // (The test itself: `[ a = b ]` of `[ a = b ] >o`.)
  const parts = bracket ? bracketLabel(n) : undefined;
  if (parts?.some((p) => p.placeholder)) {
    t.labelParts = parts;
    t.label = labelText(parts);
  }
  if (head.kind === 'builtin') t.explanation += shellEffectNote(cx, n, shellEffectOf(head.spec, read.parse.roles.map((r) => [args[r.word], r.role] as const)));
  // The deepest subcommand gives the summary (`git stash push`, `docker compose -f x run`). (The names are the
  // words' values: `yq 'e'` names `e`.)
  const path: string[] = [];
  let summary: Text | undefined;
  for (let p = read.parse, r = subcommandOf(p); r; p = r.role.parse, r = subcommandOf(p)) {
    path.push(argWord(args[r.word]).value!);
    summary = r.role.spec.summary;
  }
  // (The sentence of the line says the command with the same summary as its token, src/linesentence.ts.)
  const said: CommandSaid = { names: [head.name, ...path], kind: head.kind, options: optionsSaid(argToks), ...(bracket ? { test: true as const } : {}) };
  if (summary) said.what = plainOf(cx.t(summary));
  else if (head.spec) said.what = plainOf(head.explanation);
  cx.memo(COMMAND_SAID).set(n, said);
  if (summary) t.summary = `${said.names.join(' ')}: ${said.what}`;
  return t;
}

/**
 * What the sentence of the line (src/linesentence.ts) says of a simple command: its name and the subcommands it runs,
 * what it is (`Kind`), what it does (its spec's summary, as its token's), whether it is `test` or `[`, and the options
 * given, each with what it does (the tokens' texts: a group of letters, `-rn`, gives its letters).
 */
export interface CommandSaid { names: string[]; kind: Kind; what?: string; test?: true; options: { name: string; what: string }[] }
export const COMMAND_SAID = memoKey<CommandSaid>('commandSaid');

function optionsSaid(toks: readonly Token[]): CommandSaid['options'] {
  return toks.flatMap((t) => (t.kind !== 'option' ? [] : t.children.some((c) => c.kind === 'option') ? optionsSaid(t.children) : [{ name: t.label, what: plainOf(t.explanation) }]));
}

function commandHead(cx: Explainer, nameNode: SyntaxNode, word = nameNode.namedChildren[0]!): CommandHead {
  // `{echo,hi}` is a brace expansion first: the command is the first word it gives (`echo`), with the others as arguments.
  const braced = unquotedWord(word) !== undefined ? braceWords(cx, word) : undefined;
  if (braced?.length) {
    const head = commandHeadFor(cx, nameNode, word, braced[0]);
    head.explanation = cx.text('cmd-brace-expansion-command', { word: word.text, expanded: braced.join(' '), command: braced[0], off: bracesMaybeOff(cx, word), what: head.explanation });
    head.nameTokens = [braceWord(cx, word)!];
    return head;
  }
  const head = commandHeadFor(cx, nameNode, word);
  const spelled = staticWordValue(word, false, cx.shell);
  // (With no shell, the quotes are the host's string, which the name's token says: `hostString`.)
  if (spelled && spelled !== word.text && !cx.state.noShell) {
    head.explanation = cx.text('cmd-name-unquoted', { word: word.text, spelled: shown(spelled), what: head.explanation });
    if (!isPlainWord(word) && !head.nameTokens.length) head.nameTokens = cx.sub(word);
  }
  // `~/bin/foo`: bash expands the tilde of the name before it looks the command up.
  if (isPlainWord(word) && !head.nameTokens.length) head.nameTokens = [tilde(cx, word) ?? []].flat();
  return head;
}

/** The lines of `nodes`, in words: "line 1", "lines 1 and 3" (ja: 行 1、3). */
function linesOf(cx: Explainer, nodes: readonly SyntaxNode[]): string {
  const lines = [...new Set(nodes.map((x) => docLine(x) + 1))].sort((x, y) => x - y);
  return cx.s(lineListLabel('ja', lines), lineListLabel('en', lines));
}

/**
 * The program a file name runs when `hash -p` gave it a path or `enable -n` turned the builtin of its name off: the
 * path (when hashed by an absolute one), the spec of the program, from the dictionary (a builtin's `program`), what
 * runs and why, in words. A relative path runs from the current directory (`hash -p tac sort`: `./tac`, `res.relative`),
 * an empty one runs nothing, and one not known is known only at run time (`hash -p "$p" sort`): no program the
 * dictionary knows; its words are read with `words`, which names no manual. Where bash checks that it can run the path
 * (`res.checked`: checkhash, POSIX mode), it may search PATH instead.
 */
function offBuiltinOrHashed(cx: Explainer, res: Extract<NameResolution, { kind: 'file' }>): { path: string | undefined; program: CommandSpec | undefined; words?: CommandSpec; runs: string; why: string } {
  const name = res.name;
  if (!res.hashed) {
    const by = docLine(res.disabled!.at) + 1;
    // (Only a builtin is turned off: the program its entry describes.)
    return {
      path: undefined, program: lookupCommand(name)!.program, runs: cx.s(`外部コマンド \`${name}\` を実行する`, `Run the external command \`${name}\``),
      why: cx.s(`${lineLabel('ja', by)} の \`enable -n\` で組み込みの \`${name}\` は無効になっている`, `\`enable -n\` on ${lineLabel('en', by, 'inline')} turned the builtin \`${name}\` off`),
    };
  }
  const { value } = res.hashed;
  // (The commands that gave it, when several did: `hash -p /x a; [ c ] && hash -p /x a`.)
  const at = linesOf(cx, res.hashed.may ? res.hashed.may.map((o) => o.at!) : [res.hashed.at]);
  const checked = !res.checked ? ''
    : res.checked === 'on'
      ? cx.s(`。\`shopt -s checkhash\` か POSIX モードなので、実行できないパスなら忘れて PATH から \`${name}\` を探す`, `; with \`shopt -s checkhash\` or in POSIX mode, bash forgets a path it cannot run and searches PATH for \`${name}\``)
      : cx.s(`。\`shopt -s checkhash\` か POSIX モードが有効なら、実行できないパスは忘れて PATH から \`${name}\` を探す`, `; if \`shopt -s checkhash\` or POSIX mode is on, bash forgets a path it cannot run and searches PATH for \`${name}\``);
  const none = { path: undefined, program: undefined, words: hashedWords(at, name) };
  if (value === undefined) {
    return {
      ...none, runs: cx.s('外部コマンドを実行する', 'Run an external command'),
      why: cx.s(`${at} の \`hash -p\` で \`${name}\` は実行時に決まるパスを指す${checked}`, `\`hash -p\` on ${at} gave \`${name}\` a path known only when it runs${checked}`),
    };
  }
  if (value === '') {
    return {
      ...none, runs: cx.s('何も実行できない', 'Run nothing'),
      why: cx.s(`${at} の \`hash -p\` で \`${name}\` は空のパスを指す。bash は "No such file or directory" で失敗する（終了ステータス 127）${checked}`,
        `\`hash -p\` on ${at} gave \`${name}\` an empty path: bash fails with "No such file or directory" (status 127)${checked}`),
    };
  }
  const gave = cx.s(`${at} の \`hash -p\` で \`${name}\` は \`${value}\` を指す`, `\`hash -p\` on ${at} gave \`${name}\` the path \`${value}\``);
  if (res.relative) {
    // (bash runs `./PATH` when it is a file it can run; else `./x` is forgotten and PATH searched, and `x` run as it is, failing.)
    const dot = value.startsWith('./');
    return {
      ...none, runs: cx.s(`現在のディレクトリの \`${value}\` を実行する`, `Run \`${value}\` from the current directory`),
      why: dot
        ? cx.s(`${gave}。\`/\` で始まらないパスは現在のディレクトリから実行し、\`./\` で始まるパスは、そこに実行できるファイルがなければ忘れて PATH から \`${name}\` を探す`,
          `${gave}; a path that does not start with \`/\` is run from the current directory, and one that starts with \`./\` is forgotten when no file there can run, and PATH searched for \`${name}\``)
        : cx.s(`${gave}。\`/\` で始まらないパスは PATH から探さず、現在のディレクトリから実行する${checked}`, `${gave}; a path that does not start with \`/\` is not searched in PATH, but run from the current directory${checked}`),
    };
  }
  // (A path is never a builtin's entry: `/bin/echo` is the program.)
  return { path: value, program: lookupCommand(value), runs: cx.s(`外部コマンド \`${value}\` を実行する`, `Run the external command \`${value}\``), why: `${gave}${checked}` };
}

/** The spec the words of a program `hash -p` gave `name` are read with (on the lines `at`), which the dictionary does not describe: no manual. */
function hashedWords(at: string, name: string): CommandSpec {
  return { ...NO_SPEC, unknownOption: { ja: `${at} の \`hash -p\` で \`${name}\` が指すプログラムに渡す単語（辞書にない）`, en: `A word passed to the program \`hash -p\` on ${at} gave \`${name}\`, which the dictionary does not describe` } };
}

/** Spaces around code next to Japanese punctuation, and doubled ones, taken out (docs/japanese-style.md). */
const jaTidy = (t: string): string => t.replace(/ {2,}/g, ' ').replace(/([、。（「]) /g, '$1').replace(/ ([、。）」])/g, '$1');

/** A path a name may run from the table of `hash -p`, in words: `ja` with spaces around code, for `jaTidy`. */
function hashedPath(v: string | undefined): { ja: string; en: string } {
  if (v === undefined) return { ja: '実行時に決まるパス', en: 'a path known only at run time' };
  if (v === '') return { ja: '空のパス', en: 'an empty path' };
  return { ja: `パス \`${v}\` `, en: `the path \`${v}\`` };
}

/**
 * What a name may run from the table of `hash -p` where it differs with the path taken, or hashing may be off
 * (`MaybeHashed`), in words: one plain sentence when there is one (`plain`), else the alternatives and the lines that
 * make the table differ. With `search` false, every path runs one of them.
 */
function maybeHashedText(cx: Explainer, name: string, m: MaybeHashed): string {
  const line = docLine(m.by[0]) + 1;
  const p = m.paths.map(hashedPath);
  if (m.plain === 'ran') {
    return cx.s(jaTidy(`${lineLabel('ja', line)} の \`hash -p\` が実行されていれば、\`${name}\` は代わりに${p[0].ja}を実行する`), `if the \`hash -p\` on ${lineLabel('en', line, 'inline')} ran, \`${name}\` runs ${p[0].en} instead`);
  }
  if (m.plain === 'hashing') {
    return cx.s(jaTidy(`コマンドのハッシュが有効なら、\`${name}\` は${lineLabel('ja', line)} の \`hash -p\` で指定した${p[0].ja}を実行する。\`set +h\` で無効にする経路がある`),
      `if hashing is on here, \`${name}\` runs ${p[0].en} that \`hash -p\` on ${lineLabel('en', line, 'inline')} gave it; \`set +h\` turns hashing off on some paths`);
  }
  const at = linesOf(cx, m.by);
  const ja = p.map((x) => x.ja).join('か');
  const en = p.length === 1 ? p[0].en : `${p.slice(0, -1).map((x) => x.en).join(', ')} or ${p.at(-1)!.en}`;
  const off = m.hashall ? cx.s('。`set +h` でハッシュを無効にする経路もある', '; `set +h` turns hashing off on some paths') : '';
  return m.search
    ? cx.s(jaTidy(`ここでのコマンドのパスのキャッシュは一通りに決まらず（${at}）、\`${name}\` は代わりに${ja}を実行することもある${off}`), `the command path cache may differ here (${at}), so \`${name}\` may run ${en} instead${off}`)
    : cx.s(jaTidy(`ここでのコマンドのパスのキャッシュは一通りに決まらず（${at}）、\`${name}\` は${ja}を実行する`), `the command path cache may differ here (${at}), so \`${name}\` runs ${en}`);
}

/**
 * The table of `hash -p` that a name resolved to `res` may run from where it differs with the path taken, also through
 * the aliases it runs, and the name it is for: what makes it no plain command of its name (no example of it).
 */
export function maybeHashedOf(res: NameResolution | undefined): { name: string; m: MaybeHashed } | undefined {
  if (res?.kind === 'file' && res.maybeHashed) return { name: res.name, m: res.maybeHashed };
  if (res?.kind === 'alias') return maybeHashedOf(res.target) ?? maybeHashedOf(res.otherwise);
  return undefined;
}

function commandHeadFor(cx: Explainer, nameNode: SyntaxNode, word: SyntaxNode, as?: string): CommandHead {
  const head = headOf(cx, nameNode, word, as);
  // (A path `hash -p` gave the name on some paths only, or where hashing may be off: it may run that instead. An
  // alias says so itself, `headOf`.)
  const res = head.res?.kind === 'file' ? head.res : undefined;
  if (res?.maybeHashed?.search) {
    const t = maybeHashedText(cx, res.name, res.maybeHashed);
    // (One bracket with the explanation's own last one: `tr`'s "(stdin only)".)
    head.explanation = cx.text('cmd-hashed-clause', { what: head.explanation, clause: t });
  }
  return head;
}

function headOf(cx: Explainer, nameNode: SyntaxNode, word: SyntaxNode, as?: string): CommandHead {
  // Commands with an empty name (`FOO=1 2>/dev/null`) do not get here.
  // A name made of quotes, escapes or empty `$(:)` is the command it spells once they are removed (`e\c'h'"o"` is `echo`).
  const spelled = staticWordValue(word, false, cx.shell);
  const sv = spelled && spelled !== word.text ? spelled : undefined;
  const name = as ?? sv ?? (isPlainWord(word) ? word.text : nameNode.text);
  // (A word of plain text with braces is the first word they give, `as`; where they do not expand, `{echo,hi}` in dash, it is a name as written.)
  const plain = isPlainWord(word) || (plainText(word) && (as !== undefined || !bracesHere(cx, word)));
  // (A glob is read from the files, `f* -x`: the first match is the command and the others its words, as an expansion's.
  // But an alias is expanded before the glob, and a function of that name runs when no file matches: both are read as they are.)
  const globs = sv === undefined && as === undefined && plain && word.type !== 'raw_string' && !!wordMeaning(word, cx.state)?.steps.some((st) => st.kind === 'glob' && st.applies !== false && st.parts.length > 0);
  const globbed = globs && !['alias', 'function'].includes(resolve(cx, name, nameNode, { quoted: false }).kind);
  if (sv === undefined && (!plain || globbed) && word.type !== 'raw_string') {
    return {
      name, kind: 'command', nameTokens: cx.sub(word), refs: ['3.7.1'], unnamed: true,
      explanation: cx.text('cmd-run-expanded'),
    };
  }
  // What bash runs (src/semantics/names.ts). An alias over a known command that runs that command with more words
  // (`alias grep='grep --color=auto'`) is still explained as that command; one that runs something else (`alias
  // echo=printf`, `alias [=echo`) is the alias. (A quoted name is never an alias.)
  const ran = resolve(cx, name, nameNode, { quoted: sv !== undefined });
  const known = !!lookupCommand(name);
  // (Not `test` or `[` with more words, `alias [='[ -n x'`: they change the expression.)
  const same = ran.kind === 'alias' && ran.target?.name === name && (alias1(ran.alias.value) || !testSpecOf(ran.target));
  const res = same && known ? resolve(cx, name, nameNode, { quoted: true }) : ran;
  if (res.kind === 'alias') {
    const { alias } = res;
    // The words after the name are read with the spec of the command the alias runs, when its text is that name
    // alone at each step (`alias g=grep`: `g -n x f`). With more words (`alias ll='ls -l'`), they go after those.
    let runs: NameResolution | undefined = res;
    while (runs?.kind === 'alias' && alias1(runs.alias.value)) runs = runs.target;
    // (What `hash -p` or `enable -n` makes of the name it runs: the program of that path or name, as when the name is not an alias.)
    const other = runs?.kind === 'file' && (runs.disabled || runs.hashed) ? offBuiltinOrHashed(cx, runs) : undefined;
    // (A name that may run a path of `hash -p` has no one spec.)
    const maybe = maybeHashedOf(runs);
    const target = runs && runs.kind !== 'alias' && res.sure && !maybe && (runs.kind === 'builtin' || runs.kind === 'file') && !testSpecOf(runs) ? (other ? other.program : specFor(cx, runs.name)) : undefined;
    const spec: CommandSpec = target ?? { ...NO_SPEC, unknownOption: { ja: `エイリアスの置き換え先 \`${alias.value}\` に渡す単語`, en: `A word passed on to \`${alias.value}\`, the text of the alias` } };
    const line = (docLine(alias.at) + 1);
    // (`alias a=b b='echo B'`: `a` runs the alias `b`.)
    // (When that one's text ends with a blank and this one's does not, bash 5.3 checks the next word, 5.2 does not.)
    const later = res.target?.kind === 'alias' && aliasExpandsNext(res.target.alias.value) && !aliasExpandsNext(alias.value)
      ? cx.rests(cx.s(`。その置き換え先は空白で終わるが、次の単語がエイリアスか調べるのは bash 5.3 だけで、bash 5.2 は調べない`, `; its text ends with a blank, but only bash 5.3 then checks the next word for an alias, not bash 5.2`), 'alias-in-alias-blank') : '';
    const chainIn = res.target?.kind === 'alias'
      ? cx.s(`\`${res.target.name}\` もエイリアスで、\`${res.target.alias.value}\` に置き換わる${later}`, `\`${res.target.name}\` is an alias too, for \`${res.target.alias.value}\`${later}`)
      : '';
    const chain = chainIn ? cx.s(`（${chainIn}）`, ` (${chainIn})`) : '';
    // (A file with no shebang: aliases are expanded only when an interactive shell reads it, `.bashrc`; the model
    // starts it with expand_aliases not known, src/semantics/state.ts.)
    const maybeSourced = !res.sure && alias.state === 'on' && readAs(cx.state.env(nameNode), cx.state.read) === 'unknown';
    if (maybeSourced) cx.note(fact(cx.lang, 'alias-maybe-not-expanded', { name, value: alias.value }), nameNode);
    // (The words after the alias are read with that command's spec, so they rest on it; with no spec, the alias's text.)
    const basis = target ? programBasis(cx, other?.path || runs!.name, target) : undefined;
    // (What `hash -p` or `enable -n` made of the command it runs, as for a name that is no alias.)
    // (One bracket with the alias chain's, when that is there too: "(`b` is an alias too, …; `hash -p` on line 3 …)".)
    const offIn = !res.sure ? '' : other ? other.why : maybe ? maybeHashedText(cx, maybe.name, maybe.m) : '';
    const sureNote = [chainIn, offIn].filter(Boolean).join(cx.s('。', '; '));
    const sure = sureNote ? cx.s(`（${sureNote}）`, ` (${sureNote})`) : '';
    return {
      name, res: ran, kind: 'alias', nameTokens: [], refs: ['6.6'], spec, ...(target ? { runs: runs!.name } : {}), ...(basis ? { basis } : {}),
      explanation: res.sure
        ? cx.text('cmd-alias-defined-script', { line, name, value: alias.value, sure })
        : maybeSourced
          ? cx.text('cmd-alias-defined-file', { line, name, value: alias.value, chain })
        : alias.state === 'on'
          ? cx.text('cmd-alias-defined-expand-partial', { line, name, value: alias.value, chain })
          : cx.text('cmd-alias-defined-partial', { line, name, value: alias.value, chain }),
    };
  }
  // (The parser has read it as a command name: not a keyword.)
  const missed = (res as { missed?: Missed }).missed;
  if (missed?.kind === 'alias' && !known) {
    const first = missed.def.startPosition.row;
    // (Not where a function of that name surely runs instead, `ll() { …; }`. Where one may, or code not read may turn
    // expand_aliases on, the model says the miss may not happen: `Missed.maybe`, a caveat.)
    if (missed.why === 'expand_aliases' && !(res.kind === 'function' && res.sure)) {
      const value = cx.state.at(nameNode).expand.aliases.get(name)!.value;
      // (Turned off by the script, `shopt -u expand_aliases`: also in an interactive shell.)
      const off = option(cx.state.at(nameNode).expand, 'shopt', 'expand_aliases') === 'off';
      cx.note(fact(cx.lang, 'alias-not-expanded-in-script', { name, value, ...(off ? { off } : {}), ...(missed.maybe === 'unread' ? { unread: true } : missed.maybe ? { fn: true } : {}) }), nameNode);
      // (A function that may run instead: its own text, below, says where it is defined.)
      if (res.kind !== 'function') {
        const unless = cx.s(...unreadClause(missed.maybe === 'unread', TURNS_ALIASES_ON));
        if (off) {
          return {
            name, res: ran, kind: 'alias', nameTokens: [], refs: ['6.6'],
            explanation: cx.text('cmd-alias-expansion-off', { line: first + 1, name, value, unless }),
          };
        }
        return {
          name, res: ran, kind: 'alias', nameTokens: [], refs: ['6.6'],
          explanation: cx.text('cmd-alias-not-expanded-in-script', { line: first + 1, name, value, unless }),
        };
      }
    }
    if (missed.why === 'later' || missed.why === 'same-unit') {
      cx.note(fact(cx.lang, missed.why === 'same-unit' ? 'alias-defined-same-unit' : 'alias-defined-later', { name, line: first + 1 }), nameNode);
      if (res.kind === 'file') return { name, res: ran, kind: 'command', nameTokens: [], refs: ['6.6'], explanation: cx.text('cmd-alias-defined-later', { name, line: first + 1 }) };
    }
  }
  if (res.kind === 'function') return { name, res: ran, kind: 'function', fn: res.sure || 'maybe', nameTokens: [], refs: ['3.3'], explanation: functionCall(cx, res) + (globs ? globOver(cx) : '') };
  missedNote(cx, name, missed, nameNode);
  // After `source`, a name the dictionary does not know may be a function of the file read.
  if (res.kind === 'file' && res.sourced) {
    const line = (docLine(res.sourced) + 1);
    return {
      name, res: ran, kind: 'command', nameTokens: [], refs: ['3.7.2'],
      explanation: cx.text('cmd-maybe-sourced-function', { name, line }),
    };
  }
  // Where every path runs a path of `hash -p`, but not the same one, it runs one of them.
  if (res.kind === 'file' && res.maybeHashed && !res.maybeHashed.search) {
    const t = maybeHashedText(cx, name, res.maybeHashed);
    return {
      name, res: ran, kind: 'command', nameTokens: [], refs: ['3.7.2'], spec: hashedWords(linesOf(cx, res.maybeHashed.by), name),
      explanation: cx.text('cmd-external-hashed-maybe', { why: t }),
    };
  }
  // A builtin turned off with `enable -n` runs the program of its name; `hash -p` gives a name a path.
  if (res.kind === 'file' && (res.disabled || res.hashed)) {
    const { path, program, words, runs, why } = offBuiltinOrHashed(cx, res);
    const basis = programBasis(cx, path || name, program);
    const spec = program ?? words;
    return {
      // (The words are read as when the path is written out: the program is that file, so a word the dictionary lacks does not point to the manual of the name.)
      name, res: ran, ...(spec ? { spec } : {}), ...(path ? { runs: path } : {}), ...testOf(res), kind: 'command', nameTokens: [], refs: ['3.7.2'], ...(basis ? { basis } : {}),
      explanation: cx.text('cmd-off-builtin-or-hashed', { runs, why, ...(program ? { summary: cx.t(program.summary) } : {}) }),
    };
  }
  // A command described in the customCommands setting wins over the built-in dictionary.
  const custom = customCommandSpec(cx.opts.customCommands?.[name.split('/').pop()!]);
  if (custom) {
    return { name, res: ran, spec: custom, kind: 'command', nameTokens: [], explanation: cx.t(custom.summary) + cx.text('cmd-custom-setting') };
  }
  // (No shell reads the words, Docker's exec form: a builtin's name runs the program of its name.)
  if (res.kind === 'file' && res.noShell?.skips) return noShellHead(cx, name, ran, res.noShell.skips);
  const spec = hostCommand(cx, name) ?? lookupCommand(name);
  if (spec) {
    const builtin = !!spec.builtin;
    // (A builtin's section, or that of a program the manual describes: `bash`, 6.1.)
    const own = builtin ? builtinSections(name, spec.builtin === 'special') : programSections(name);
    const basis = programBasis(cx, name, spec);
    return {
      name, res: ran, spec, ...testOf(res), kind: builtin ? 'builtin' : 'command', nameTokens: [], ...(own.length ? { refs: own } : {}), ...(basis ? { basis } : {}),
      explanation: builtin && spec.closingOperand // (zsh splits and globs no unquoted variable, but drops one that is empty all the same.)
        ? cx.text('cmd-bracket-builtin', { zsh: cx.shell === 'zsh' })
        : cx.t(spec.summary),
    };
  }
  // (A quoted name is never an alias: bash looks up no alias for `"ll"` or `\ll`, so only a function of a system stays.)
  const distro = Object.hasOwn(distroAliases, name) ? distroAliases[name] : undefined;
  if (distro && (sv === undefined || distro.kind === 'function')) {
    const where = distro.definitions.map(([os]) => os).join(cx.s('・', ', '));
    const defs = distro.definitions.map(([os, v]) => `${os}: \`${v}\``).join(cx.s('、', ', '));
    const whatText = distro.kind === 'alias' ? tx('エイリアス', 'an alias') : tx('関数', 'a function');
    const what = cx.t(whatText);
    // In a README the commands are typed into a terminal, where the alias may exist; where `.bashrc` may have run first
    // (a file with no shebang, `bash -i -c`: `bashrcReader`), it may too: a caveat.
    const interactive = readAs(cx.state.env(nameNode), cx.state.read) === 'terminal';
    const reader = bashrcReader(cx.state.env(nameNode), cx.state.read, cx.state.interactiveStart);
    const many = distro.definitions.length > 1;
    cx.note(interactive
      ? fact(cx.lang, 'distro-alias-interactive', { name, where, what: whatText, many, portable: distro.portable })
      : fact(cx.lang, 'distro-alias-in-script', { name, where, what: whatText, many, instead: distro.portable ? tx(`\`${distro.portable}\` と書きます`, `Write \`${distro.portable}\``) : tx('したいことに合ったコマンドをそのまま書きます', 'Write the command you mean'), ...(reader ? { reader } : {}) }), nameNode);
    return {
      name, ...(interactive ? {} : { res: ran }), spec: distro.command ? lookupCommand(distro.command) : undefined, kind: 'command', nameTokens: [],
      explanation: cx.text('cmd-distro-alias', { what, alias: distro.kind === 'alias', name, meaning: cx.t(distro.meaning), defs }),
    };
  }
  if (name.includes('/')) {
    // (With no shell, Docker's exec form, the path is run as it is: no section of bash's command search.)
    return cx.state.noShell
      ? { name, res: ran, kind: 'command', nameTokens: [], explanation: cx.text('cmd-path-no-shell', { name }) }
      : { name, res: ran, kind: 'command', nameTokens: [], refs: ['3.7.2'], explanation: cx.text('cmd-path', { name }) };
  }
  return { name, res: ran, kind: 'command', nameTokens: [], explanation: cx.text('cmd-external-unknown', { name }) };
}

/**
 * The name of a builtin or a reserved word that no shell reads (`NameResolution` `noShell`, Docker's exec form): it is
 * looked up in PATH, and runs the program of its name (`echo`, `time`), or is not found (`cd`, `if`). The words after
 * a name not found are words of no command.
 */
function noShellHead(cx: Explainer, name: string, res: NameResolution, skips: 'builtin' | 'keyword'): CommandHead {
  const spec = lookupCommand(name);
  const program = !spec ? undefined : spec.builtin ? spec.program : spec;
  // (A program of the dictionary, which the manual does not describe: its token rests on its spec.)
  if (program) return { name, res, spec: program, ...testOf(res), kind: 'command', nameTokens: [], basis: programBasis(cx, name, program)!, explanation: cx.t(program.summary) };
  return {
    name, res, kind: 'command', nameTokens: [],
    explanation: skips === 'builtin'
      ? cx.text('cmd-no-shell-builtin', { name, summary: cx.t(spec!.summary) })
      : cx.text('cmd-no-shell-keyword', { name }),
  };
}

/** `test` or `[`, when `res` runs one of them (src/semantics/names.ts): its spec, for `CommandHead.test`. */
function testOf(res: NameResolution): { test?: CommandSpec } {
  const test = testSpecOf(res);
  return test ? { test } : {};
}

/** A note on a definition of `name` that does not run here (a function defined later, in a subshell, removed). */
function missedNote(cx: Explainer, name: string, missed: Missed | undefined, at: SyntaxNode): void {
  if (missed?.kind !== 'function') return;
  const line = (docLine(missed.def) + 1);
  const runs = tx(`組み込みコマンドや外部コマンドの \`${name}\` が動きます`, `the builtin or program \`${name}\` runs`);
  switch (missed.why) {
    case 'later':
      cx.note(fact(cx.lang, 'function-defined-later', { name, line, runs }), at);
      return;
    case 'subshell':
      cx.note(fact(cx.lang, 'function-defined-in-subshell', { name, line, runs }), at);
      return;
    case 'in-function':
      cx.note(fact(cx.lang, 'function-defined-in-uncalled-function', { name, line, by: field(missed.by!, 'name')!.text, runs }), at);
      return;
    case 'never-runs':
      cx.note(fact(cx.lang, 'function-defined-in-dead-branch', { name, line, runs }), at);
      return;
    case 'unset':
      cx.note(fact(cx.lang, 'function-removed-by-unset', { name, line: (docLine(missed.by!) + 1), runs }), at);
      return;
    case 'posix-special':
      cx.note(fact(cx.lang, 'special-builtin-before-function', { name, line }), at);
      return;
  }
}

/** A function named like a glob: a file that matches the name is the command instead (`f*() { :; }; f* -x` runs the first `f…` file). */
function globOver(cx: Explainer): string {
  return cx.s('。ただし、名前に一致するファイルがあれば、その最初のファイル名のコマンドが代わりに実行される', '. But if a file matches the name, the command of the first matching file name runs instead');
}

/** "Call the function `f` defined on line N", with what it hides and whether it is sure. */
function functionCall(cx: Explainer, res: Extract<NameResolution, { kind: 'function' }>): string {
  const { name } = res;
  const line = (docLine(res.fn.def) + 1);
  const shadows = res.shadows === 'builtin'
    ? cx.s(`（同じ名前の組み込みコマンドの代わりに動く。組み込みは \`builtin ${name}\` で呼べる）`, ` (it runs instead of the builtin of that name; \`builtin ${name}\` runs the builtin)`)
    : res.shadows === 'program'
      ? cx.s(`（同じ名前のコマンドの代わりに動く。コマンドは \`command ${name}\` で呼べる）`, ` (it runs instead of the command of that name; \`command ${name}\` runs the command)`)
      : '';
  const may = res.sure ? '' : res.maybe === 'import'
    ? cx.s('。ただし、`sh` は Debian や Ubuntu では dash で、dash は bash がエクスポートした関数を読まないので、そこでは同じ名前のコマンドが動く',
      '. But `sh` is dash on Debian and Ubuntu, and dash does not read the functions bash exports: there the command of that name runs')
    : res.maybe === 'startup'
    ? cx.s(`。ただし、この関数は新しいシェルに渡されないので、定義されているのは起動時に読むファイル（\`-l\`、\`-i\`、\`BASH_ENV\`）${res.sourced ? `か、${lineLabel('ja', docLine(res.sourced) + 1)} で読み込むファイル` : ''}が定義する場合だけで、そうでなければ同じ名前のコマンドが動く`,
      `. But this function is not passed to the new shell: it is defined there only if the files it reads at startup (\`-l\`, \`-i\`, \`BASH_ENV\`)${res.sourced ? `, or the file it reads on ${lineLabel('en', docLine(res.sourced) + 1, 'inline')},` : ''} define it; otherwise the command of that name runs`)
    : res.maybe === 'branch'
    ? cx.s('。ただし、ここまでに定義されているのは一部の経路（分岐など）だけで、そうでなければ同じ名前のコマンドが動く',
      '. But only some paths before here (a branch…) define it; on the others the command of that name runs')
    : cx.s('。ただし、それはこれが動くときに定義されていればで、定義はスクリプトのあとの部分の一部の経路にしかない',
      '. That is, if it is defined when this runs: it is defined later in the script, on some paths only');
  return cx.s(`このスクリプトの${lineLabel('ja', line)} で定義された関数 \`${name}\` を呼び出す${shadows}${may}`, `Call the function \`${name}\` defined on ${lineLabel('en', line, 'inline')}${shadows}${may}`);
}

export function timeStatement(cx: Explainer, n: SyntaxNode): Token {
  return cx.examplesOf(n, () => timed(cx, n));
}

/** `time [-p] command …`: the keyword, and the rest explained as the command it times. */
function timed(cx: Explainer, n: SyntaxNode): Token {
  const lead = timeLead(cx, token(n, 'time')!, fields(n, 'option'));
  const cmd = field(n, 'body');
  const bash = !cx.shell || cx.shell === 'bash';
  // In POSIX mode, `time` before a word that starts with `-` is not the reserved word: bash reads `time -p cmd`, `time -- cmd`
  // and `time -x cmd` as the command `time`, the program (6.11; not at compatibility level 41 or below). The mode is the one
  // bash read the line in. (The `-` must follow `time`, its line continuations and blanks; one after a blank leaves the keyword.)
  if (bash && /^(?:\\\n)*[ \t]*-/.test(n.text.slice(token(n, 'time')!.endIndex - n.startIndex)) && timeIsProgram(cx.state.at(n).parse)) return timeProgram(cx, n, cmd);
  if (!cmd && !bash) return skeletal(cx.tok(n, 'keyword', lead[0].explanation, lead), n);
  if (!cmd) {
    // `time` alone: an empty pipeline, timed; in POSIX mode, the times of the shell and its children so far (6.11).
    const posix = option(cx.state.at(n).run, 'set', 'posix') === 'on';
    const t = cx.tok(n, 'keyword', cx.rests(cx.text(posix ? 'cmd-time-alone-posix' : 'cmd-time-alone'), 'time-alone'), lead);
    return skeletal(posix ? { ...t, refs: ['3.2.3', '6.11'] } : t, n);
  }
  // What `time` times, a command or a whole pipeline, is explained as it would be on its own.
  const inner = cx.sub(cmd);
  const text = shorten(n.text.slice(cmd.startIndex - n.startIndex).replace(/\s*\\\n\s*/g, ' '), 40);
  const explanation = cx.s(
    `\`${text}\` の実行時間を計測する（実時間・ユーザー時間・システム時間を stderr に表示。パイプラインなら全体の時間）`,
    `Time \`${text}\`: run it and report how long it took (real, user and sys time, on stderr; a pipeline is timed as a whole)`,
  );
  const t = cx.tok(n, 'keyword', explanation, sortTokens([...lead, ...inner]));
  t.summary = `time ${inner.map(summaryOf).join(' ')}`;
  t.around = 'pipeline';
  return skeletal(t, n);
}

/**
 * Whether bash, reading a line in the state `st`, takes `time -p` for the program `time`: in POSIX mode, unless the
 * compatibility level may be 41 or below (`shopt -s compat41`, `BASH_COMPAT`), where it is the reserved word (6.12).
 */
function timeIsProgram(st: ShellState): boolean {
  return option(st, 'set', 'posix') === 'on' && ['compat31', 'compat32', 'compat40', 'compat41'].every((o) => option(st, 'shopt', o) !== 'on' && option(st, 'shopt', o) !== 'unknown')
    && !st.variables.has('BASH_COMPAT');
}

/** `time -p cmd`, `time -- cmd`, `time -x cmd` in POSIX mode: the program `time`, with its options and the command it runs (as a program). */
function timeProgram(cx: Explainer, n: SyntaxNode, cmd: SyntaxNode | undefined): Token {
  const time = token(n, 'time')!;
  const words = [...fields(n, 'option'), ...(cmd?.type === 'command' ? [...(field(cmd, 'name') ? [field(cmd, 'name')!.namedChildren[0]!] : []), ...fields(cmd, 'argument')] : [])];
  const kw = cx.tok(time, 'keyword', cx.text('cmd-time-program') + (cmd ? '' : cx.sep() + cx.text('cmd-time-program-no-command')));
  // (The program named as the word is: bash looks it up in PATH.)
  const read = readArgs(cx, specFor(cx, time.text), words, time.text);
  // (A body that is not one simple command, `time -p a | b`, is explained as it is.)
  const rest = cmd && cmd.type !== 'command' ? cx.sub(cmd) : [];
  return skeletal({ ...cx.tok(n, 'command', kw.explanation, sortTokens([kw, ...read.tokens, ...rest])), refs: ['3.2.3', '6.11'] }, n);
}

/** The keyword `time`, and its `-p` and `--` if there are: the start of every explanation of it. */
function timeLead(cx: Explainer, time: SyntaxNode, options: readonly SyntaxNode[]): Token[] {
  const kw = Object.assign(cx.tok(time, 'keyword', cx.t(keywords.time)), { name: nameInfo(cx.lang, { kind: 'keyword', name: 'time' }, cx, time) });
  return [kw, ...options.map((o) => cx.tok(o, 'option', cx.text(o.text === '-p' ? 'cmd-time-posix-format' : 'cmd-time-end-of-options')))];
}
