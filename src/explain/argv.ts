// The words of a command, read by its spec (docs/design/analyzer.md, step 7; docs/design/semantics.md, A): the
// argument interpreter (src/argv/interpret.ts) gives each word a role, and each role becomes a token. Options (one,
// short ones together, `--name=value`, old-style letters) and their values, `--`, operands (numbered, a job, a
// variable for the command, a name that a declaration builtin declares or `unset` removes), subcommands (`git stash
// push`), the command that a wrapper runs (sudo, xargs, `find -exec`), find's expression, the expression of `test`
// and `[`, and the strings run as scripts (src/explain/scripts.ts).
import type { ExplainOptions, Kind, Span, Token } from '../analyzer-types';
import { type ArgRole, type ArgvParse, type CommandRole, interpret } from '../argv/interpret';
import { declaresNames } from '../argv/query';
import { DEFAULT_BASH_VERSION } from '../bashversion';
import type { CommandSpec, OperandSpec } from '../argv/spec';
import { builtins } from '../dict/builtins';
import { describeFind, findWords, type FindNode, operatorTexts, parseFind, strayWords } from '../embedded/find';
import { lineLabel } from '../i18n';
import { shorten } from '../label';
import { fact } from '../messages';
import { nameInfo } from '../namefacts';
import { spanOf } from '../noteanchors';
import { builtinSections, programSections } from '../refs';
import { type ExecEnv, shellEffectOf, type SlotLink, slotEnvs } from '../semantics/env';
import { type Missed, testSpecOf } from '../semantics/names';
import { docLine } from '../semantics/state';
import { isPlainWord, literalContent, staticWordText, staticWordValue, surelyHasSlash } from '../staticword';
import { replaceNode } from '../rewrite';
import { field, fields, inStrayHead, type SyntaxNode } from '../syntax/tree';
import { bracketShape, type CommandTest, commandTest, type TestRules } from '../testexpr';
import { readByCommand } from '../tokenmarks';
import type { Explainer } from './context';
import { embedded } from './embedded';
import { testExample } from './examples';
import { nested, sortTokens } from './nodes';
import { markPlaceholders, placeholderWords } from './placeholders';
import { argWordIn, countIn, fieldsIn, untilWords } from '../semantics/argwords';
import { type ArgsReading, soleRead } from '../semantics/commandread';
import { NO_SPEC, programBasis, resolve, restrictedAt, restrictedCall, shellVariant, specFor } from './reads';
import { findRefusal } from './find-refusal';
import { eachText, withReadings } from './operand-texts';
import { joinedScript, scriptTokens, slotNotes, trapNote, withScript } from './scripts';
import { testTokens } from './tests';
import { word } from './words';
import { pushAll } from '../lists';
import { isBash } from '../shellfeatures';
import { dash, expanded, own, part, positional, span, wordParts } from './argv-shared';
import { declarationOption, endOfOptions, optionToken, valueToken } from './argv-options';
import { fieldsToken, operandToken } from './argv-operands';

/**
 * Explain the argument words of a command, as the model reads them (`read`: src/semantics/commandread.ts, where the
 * argument interpreter, src/argv/interpret.ts, gives each word a role): each word's role becomes a token.
 */
export function readArgs(cx: Explainer, read: ArgsReading, args: SyntaxNode[], isFn: boolean | 'maybe' = false): { tokens: Token[]; parse: ArgvParse } {
  for (const [w, env] of read.envs) cx.slotEnvs.set(w, env);
  return { tokens: render(cx, read.parse, read.spec, args, args, true, isFn), parse: read.parse };
}

/**
 * The tokens of the words `nodes` (indexed as the interpreter's words) that `parse` reads with `spec`.
 * `words` are the words of this command, which the explanations of embedded languages look at. `onModel`: `parse` is the model's
 * reading of the command (`commandReading`, or a subcommand of it), which a known value of its words is read with
 * (docs/design/known-values.md, 3); not a command a slot runs, nor find's expression, which this line reads again.
 */
function render(cx: Explainer, parse: ArgvParse, spec: CommandSpec, nodes: SyntaxNode[], words: SyntaxNode[], onModel: boolean, isFn: boolean | 'maybe' = false): Token[] {
  const out: Token[] = [];
  // The names set by `NAME=value` words before the wrapped command (`env FOO=1 cmd`).
  const assigned: string[] = [];
  // `set +o pipefail`: the values of an option turned off say so.
  let disables = false;
  // ssh: the words joined into the remote command have the text of its first word (eval's have none).
  let joined: string | undefined;
  // The joined words are one token, when they are read as a script.
  let joinedWhole = false;
  // Joined words not read as a script: the word that holds an expansion says why (`eval set -- "$args"`).
  let joinedNote: { at: SyntaxNode; note: string } | undefined;
  // The number of the next word of each operand (`$N`: `set -- a b`), and whether the words before it each gave one.
  const ordinals = new Map<OperandSpec, { n: number; sure: boolean }>();
  /** The number of the next word of operand `o` (and whether it is sure), its words then `by` words on. */
  const next = (o: OperandSpec, by: number, sure: boolean): { n: number; sure: boolean } => {
    const b = ordinals.get(o) ?? { n: 0, sure: true };
    ordinals.set(o, { n: b.n + by, sure: b.sure && sure });
    return { n: b.n + 1, sure: b.sure };
  };
  // (The words an option of the command around replaces, find's `{}`, stay known to the commands it runs.)
  cx.withCommand({ cmd: parse.command, args: words, parse, nodes, spec, ...(cx.command?.placeholders ? { placeholders: cx.command.placeholders } : {}), ...(onModel ? { onModel } : {}) }, () => {
    for (const { word, role } of parse.roles) {
      const a = nodes[word];
      switch (role.role) {
        case 'end-of-options':
          out.push(withReadings(cx, endOfOptions(cx, a, spec), role.readings, word, nodes));
          break;
        case 'option':
        case 'unknown-option':
        case 'cluster':
          disables = (role.role === 'cluster' ? role.letters[0] as { flag: string } : role).flag.startsWith('+');
          // (A declaration builtin's options are explained by the attributes they give; one it does not have, as any builtin's.)
          out.push(withReadings(cx, declaresNames(spec) && role.role !== 'unknown-option' ? declarationOption(cx, a, role) : optionToken(cx, a, role, spec, parse, word), role.readings, word, nodes));
          break;
        case 'pattern-option':
          out.push(withReadings(cx, cx.tok(a, 'option', cx.t(role.text), wordParts(cx, a)), role.readings, word, nodes));
          break;
        case 'open-option':
          out.push(cx.tok(a, 'option', cx.text('option-open'), wordParts(cx, a)));
          break;
        case 'value':
          out.push(withReadings(cx, expanded(cx, a, valueToken(cx, a, role, disables)), role.readings, word, nodes));
          break;
        case 'old-style': {
          const parts = role.letters.flatMap((l) => {
            const letter = l as Extract<ArgRole, { role: 'option' }>;
            const own = part(a, letter, letter.flag, cx.t(letter.text));
            // `ps t1`: the number is the value of the last letter, a token of its own.
            if (!letter.value) return [own];
            const lit = literalContent(a);
            const text = (lit ? lit.text : a.text).slice(letter.value.attached);
            return [own, { ...span(a, letter.value.attached!, -1, 'argument', cx.s(`\`${letter.flag}\` の値`, `Value for \`${letter.flag}\``), text), valueFor: letter.flag }];
          });
          const letterTokens = parts.filter((p) => p.kind === 'option');
          const style = spec.oldStyle!.style ? cx.t(spec.oldStyle!.style) : cx.s('旧式のオプション（ハイフンなし）', 'Old-style options (no dash)');
          out.push(cx.tok(a, 'option', `${style}: ${letterTokens.map((p) => `\`${p.label}\``).join(' ')}`, parts));
          break;
        }
        case 'terminator':
          out.push(cx.tok(a, 'operator', role.text === '+'
            ? cx.text('find-exec-end-batch', { of: role.of })
            // (No shell to escape it from where no shell reads the words, Docker's exec form.)
            : cx.text('find-exec-end-each', { of: role.of, escaped: !cx.state.noShell })));
          break;
        case 'operand': {
          // (A word that expands to another number of words, `$x` or `{a,b}`, shifts the numbers: from it on, they are not
          // sure. Each word of one that gives several counts for its own role: `p='s.sh a'; bash $p d`, `d` is `$2`.)
          const count = countIn(a, cx.state);
          const gives = !count ? 1 : count.min === count.max ? count.min : undefined;
          const numbers = role.each?.map((o) => next(o, 1, true));
          const before = numbers?.[0] ?? (role.spec ? next(role.spec, gives ?? 1, gives !== undefined) : { n: 1, sure: true });
          out.push(expanded(cx, a, operandToken(cx, nodes, word, role, parse, spec, { n: before.n, sure: before.sure && gives !== undefined, ...(numbers ? { each: numbers } : {}) }, assigned, isFn)));
          break;
        }
        case 'subcommand': {
          // (Where no shell reads the words, Docker's exec form, the program gets them as they are.)
          const note = cx.state.noShell
            ? cx.text('subcommand-argument-no-shell', { command: parse.command })
            : cx.text('subcommand-argument-shell', { command: parse.command });
          out.push(withReadings(cx, cx.tok(a, 'subcommand', cx.text('subcommand-label', { command: role.parse.command }) + cx.t(role.spec.summary) + note), role.readings, word, nodes));
          pushAll(out, render(cx, role.parse, role.spec, nodes, nodes.slice(word + 1, role.parse.end), onModel));
          break;
        }
        case 'command':
          // `trap {x,EXIT}`, `bash -c {x,y}`: the words of the braces, each with its role; the string is not read as a script.
          if (role.each) out.push(expanded(cx, a, positional(cx, a, eachText(cx, a, role.each, role.each.map((o) => next(o, 1, true)), fieldsIn(a, cx.state)))));
          else if (role.slot.later) {
            // A trap's action: a string this shell runs later, with its expansions then.
            out.push(withScript(positional(cx, a, cx.t(role.item!.text) + trapNote(cx, a)), scriptTokens(cx, [a], cx.slotEnvs.get(a)!)));
          } else if (role.slot.joinsWords && !role.slot.escapesWords) {
            // ssh sends the words joined to the remote shell; eval joins them and reads them again here, so they are plain words.
            joined = role.slot.run === 'current-shell' ? undefined : cx.t(role.item!.text);
            if (role.slot.run === 'current-shell') cx.command!.rereads = true;
            const words = nodes.slice(word, parse.end);
            if (!parse.refusal) slotNotes(cx, role, cx.slotEnvs.get(a)!, words, assigned);
            const script = scriptTokens(cx, words, cx.slotEnvs.get(a)!, undefined, !parse.refusal);
            joinedWhole = words.length > 1 && !!script.tokens.length;
            const at = script.note && !script.tokens.length ? words.find((w) => !staticWordText(w, cx.shell)) ?? a : a;
            if (at !== a) joinedNote = { at, note: script.note! };
            out.push(joinedWhole ? joinedScript(cx, words, joined, script) : withScript(positional(cx, a, joined), at === a ? script : { tokens: [] }));
          } else if (!role.parse) {
            // A command string: the value of an option (`su -c 'cmd'`), or an operand (`bash -c 'cmd'`, `watch 'cmd'`).
            if (!parse.refusal) slotNotes(cx, role, cx.slotEnvs.get(a)!, [a], assigned);
            const string = role.of ? valueToken(cx, a, { role: 'value', of: role.of, index: 0 }, false) : cx.tok(a, 'argument', cx.t(role.item!.text), wordParts(cx, a));
            out.push(withScript(string, scriptTokens(cx, [a], cx.slotEnvs.get(a)!, shellParams(cx, role, parse, nodes, word), !parse.refusal)));
          } else out.push(withReadings(cx, wrapped(cx, nodes, word, role, assigned, parse.refusal), role.readings, word, nodes));
          break;
        case 'joined':
          if (!joinedWhole) out.push(a === joinedNote?.at ? withScript(positional(cx, a, joined), { tokens: [], note: joinedNote.note }) : positional(cx, a, joined));
          break;
        case 'expression':
          // find's expression, read as a whole from its first word.
          if (word === parse.expression) pushAll(out, findExpression(cx, nodes.slice(word, parse.end), spec.expressionSpec!));
          break;
        case 'fields': {
          // (Each field that is an operand has its number: `p='-- a'; set $p d`, `a` is `$1` and `d` `$2`.)
          const numbers = new Map(role.roles.flatMap(({ role: r }) => (r.role === 'operand' && r.spec ? [[r, next(r.spec, 1, true)] as const] : [])));
          out.push(expanded(cx, a, fieldsToken(cx, a, role, parse.command, isFn, nodes, numbers)));
          break;
        }
      }
    }
  });
  return readByCommand(out);
}

/**
 * The words the `$0`, `$1`… of the shell that runs the command string at `word` start as (`sh -c '…' sh "$msg"`: `sh`,
 * `"$msg"`), when its slot says the operands after it are those (`CommandSlot.params`): up to a word whose number of
 * words is known only when it runs (`"$@"`, an unquoted `$x`).
 */
function shellParams(cx: Explainer, role: CommandRole, parse: ArgvParse, nodes: SyntaxNode[], word: number): ExplainOptions['positional'] {
  if (!role.slot.params) return undefined;
  const after = parse.roles.filter((r) => r.word > word && r.role.role === 'operand').map((r) => nodes[r.word]);
  // (`countOf` gives nothing for a word that stays one word.)
  const known = after.findIndex((w) => { const c = countIn(w, cx.state); return c !== undefined && c.max !== 1; });
  const via = (cx.slotEnvs.get(nodes[word])!.links.at(-1) as SlotLink).via;
  const given = known < 0 ? after : after.slice(0, known);
  return { via, words: given.map((w) => w.text), replacedBy: given.map((w) => cx.command?.placeholders?.get(w)), more: known >= 0 };
}

/**
 * The tokens of the words of a command a slot runs (its first word `first`, read in `parse` over `nodes`), or read again
 * with `respec`: the variant of a builtin for the shell options (`command kill`), or the program of a builtin turned off
 * (`command echo` after `enable -n echo`). A word read as an option only alone is read as its environment makes it
 * (`soleRead`): find's actions are read apart from the line, and `respec` reads the words afresh.
 */
function ownWords(cx: Explainer, respec: CommandSpec | undefined, name: string, first: SyntaxNode, parse: ArgvParse, spec: CommandSpec | undefined, nodes: SyntaxNode[], args: SyntaxNode[], refusal?: ArgvParse['refusal']): Token[] {
  const lookup = (x: string): CommandSpec | undefined => specFor(cx, x);
  const read = respec ? { parse: interpret(respec, args.map(argWordIn(cx.state)), { name, lookup }), spec: respec, nodes: args }
    : { parse: refusal ? { ...parse, refusal } : parse, spec: spec ?? NO_SPEC, nodes };
  const envs = new Map<ArgvParse, ExecEnv>();
  slotEnvs(cx.slotEnvs.get(first)!, read.parse, read.spec, read.nodes, cx.state.shell, lookup, undefined, envs);
  return render(cx, soleRead(cx.state, read.parse, envs, first.parent!), read.spec, read.nodes, args, false);
}

/** Words forming a command run by another command (sudo, xargs, find -exec…): the command, with its words read by its spec. */
function wrapped(cx: Explainer, nodes: SyntaxNode[], word: number, role: CommandRole, assigned: string[], refusal?: ArgvParse['refusal']): Token {
  const parse = role.parse!;
  const words = nodes.slice(word, parse.end);
  const first = nodes[word];
  // `find -exec cmd {} ;`: the words up to the terminator.
  // (What the builtin it names would do to a shell: `sudo cd /x` cannot change this one.)
  const effect = shellEffectOf(role.spec, parse.roles.map((r) => [nodes[r.word], r.role] as const));
  // (Not when find refuses the line, `find . -exec f {} ;`: it runs nothing, so nothing is wrong with how it would.)
  if (!refusal) slotNotes(cx, role, cx.slotEnvs.get(first)!, words, assigned, effect);
  const name = first.text;
  let explanation = role.spec ? cx.t(role.spec.summary) : cx.s(`コマンド \`${name}\``, `Command \`${name}\``);
  let kind: Kind = role.spec?.builtin ? 'builtin' : 'command';
  // `command` skips functions, `builtin` looks at the builtins only (src/semantics/names.ts).
  if (role.slot.lookup && isPlainWord(first)) {
    const res = resolve(cx, name, first, { env: cx.slotEnvs.get(first) });
    // (A builtin, a file or nothing: `command` and `builtin` skip aliases and functions.)
    const missed = (res as { missed?: Missed }).missed;
    if (res.kind === 'none') {
      kind = 'command';
      explanation = res.disabled ? cx.s(`${lineLabel('ja', docLine(res.disabled.at) + 1)} の \`enable -n\` で組み込みの \`${name}\` は無効なので、\`builtin\` はエラーになる`, `\`enable -n\` on ${lineLabel('en', docLine(res.disabled.at) + 1, 'inline')} turned the builtin \`${name}\` off, so \`builtin\` fails`)
        : cx.s(`\`${name}\` は組み込みコマンドではないので、\`builtin\` はエラーになる`, `\`${name}\` is not a builtin, so \`builtin\` fails`);
    } else if (res.kind === 'file' && res.disabled) {
      // (`enable -n echo; command echo`: the program.)
      kind = 'command';
      const program = role.spec?.program;
      const line = (docLine(res.disabled.at) + 1);
      explanation = cx.s(`外部コマンド \`${name}\`（${lineLabel('ja', line)} の \`enable -n\` で組み込みは無効）${program ? `: ${cx.t(program.summary)}` : ''}`,
        `the external command \`${name}\` (\`enable -n\` on ${lineLabel('en', line, 'inline')} turned the builtin off)${program ? `: ${cx.t(program.summary)}` : ''}`);
    }
    if (missed?.kind === 'function' && (missed.why === 'command' || missed.why === 'builtin')) {
      explanation += cx.s(`（${lineLabel('ja', (docLine(missed.def) + 1))} の同じ名前の関数は使わない）`, ` (not the function of that name, defined on ${lineLabel('en', (docLine(missed.def) + 1), 'inline')})`);
    }
  }
  // `command [ -f x ]`, `env test -f x`: `test` and `[` read their words as an expression, when the name runs one of them.
  const value = staticWordValue(first, false, cx.shell);
  const res = value === undefined ? undefined : resolve(cx, value, first, { env: cx.slotEnvs.get(first) });
  const test = res && testSpecOf(res);
  // (The builtin run in this shell, `command kill`, `builtin echo`, reads its words as it would on its own in the shell
  // options there (`CommandSpec.inShell`, 6.11); behind `command`, not a variant of a special builtin's errors.)
  const own = role.slot.run === 'current-shell' && res?.kind === 'builtin' && role.spec ? shellVariant(cx, first.parent!, role.spec) : undefined;
  const variant = own && !(own.special && role.slot.lookup === 'no-functions') ? own : undefined;
  if (variant) explanation += cx.s(`。${cx.t(variant.text)}`, `. ${cx.t(variant.text)}`);
  const vspec = variant ? { ...role.spec!, ...variant.spec } : undefined;
  // (`enable -n echo; command echo --version`: `command` runs the program, and its words are the program's.)
  const offProgram = role.slot.run === 'current-shell' && res?.kind === 'file' && res.disabled ? role.spec?.program : undefined;
  const notReached = role.slot.run === 'exec' && isPlainWord(first) && !!role.spec?.builtin && !role.spec.program; // (`nohup let x=09`: no program has that name, so nothing reads its words: `builtin-or-function-as-program`.)
  const placeholders = placeholderWords(cx, role, nodes);
  const children = test ? testArgs(cx, first.parent!, commandTest(test, words.slice(1), bashTest(cx, test)), test.closingOperand !== undefined, !!test.builtin)
    : ownWords(cx, vspec ?? offProgram ?? (notReached ? NO_SPEC : undefined), name, first, parse, role.spec, nodes, words.slice(1), refusal);
  markPlaceholders(cx, placeholders, children);
  const span: Span = { start: spanOf(first).start, end: spanOf(words[words.length - 1]).end };
  // (`builtin cd`, `command echo`: the builtin runs in this shell, as if bash ran it: no other command runs it.)
  const direct = role.slot.run === 'current-shell' && res?.kind === 'builtin';
  // (`command /bin/ls`: this shell runs the name, which a restricted one refuses with a `/`; `builtin cd /`: what it
  // refuses of the builtin, 6.10.)
  const refused = direct ? restrictedCall(cx, first, role.spec!, parse, words.slice(1))
    : role.slot.run === 'current-shell' && res?.kind === 'file' && surelyHasSlash(first) && restrictedAt(cx, first) ? {} : undefined;
  if (refused) cx.note(fact(cx.lang, 'restricted-refused', { kind: direct ? 'builtin' : 'slash', name, ...refused }), first);
  // (A program the manual describes: `sudo bash -c`, `exec bash --login`, 6.1.)
  const program = res?.kind === 'file' ? programSections(res.name) : [];
  // (A program it runs rests on its spec, as one bash runs does (src/explain/commands.ts): `rm` of `sudo rm -rf x`, and
  // what it reads; not a builtin `builtin` does not find.)
  const basis = kind === 'command' && res?.kind !== 'none' ? programBasis(cx, value ?? name, role.spec) : undefined;
  return {
    kind, ...(placeholders ? { placeholders: true as const } : {}), ...(res ? { name: nameInfo(cx.lang, res, cx, first, cx.slotEnvs.get(first)) } : {}), ...(direct ? { refs: builtinSections(res.name, res.special) } : program.length ? { refs: program } : {}), ...(basis ? { basis } : {}),
    label: shorten(name),
    explanation: (role.of ? cx.text('wrapped-command-to-run') : '') + (direct ? '' : cx.text('wrapped-runs', { name })) + explanation,
    span, children, summary: `${name}: ${explanation}`,
  };
}

/**
 * find's expression, explained as a whole (`-o`, implicit `-a`, `!` and `\( \)` grouping) with the tokens
 * of each primary inside. When it cannot be parsed, its words are read as options of find.
 */
function findExpression(cx: Explainer, all: SyntaxNode[], spec: CommandSpec): Token[] {
  // (A word that gives none is not find's: `z=; find . -name x $z -print`. Nor is a summary of words as written given.)
  const none = all.filter((n) => fieldsIn(n, cx.state)?.length === 0);
  const nodes = all.filter((n) => !none.includes(n));
  const empty = none.map((n) => fieldsToken(cx, n, { role: 'fields', words: [], roles: [] }, 'find', false, all));
  const words = findWords(nodes, cx.shell, cx.state);
  const lookup = (name: string) => specFor(cx, name);
  // find refuses all its arguments when one of its actions is wrong (`-exec f {} ;`): none of them runs. (Its words as find
  // gets them, where the model knows them: `x=';'; find . -exec echo {} $x` ends at `$x`.)
  const argWords = nodes.map(argWordIn(cx.state));
  const { refusal } = interpret(spec, argWords, { name: 'find', lookup });
  if (refusal) findRefusal(cx, nodes, spec, refusal);
  const read = (from: number, to: number): Token[] => {
    const part = nodes.slice(from, to);
    return render(cx, { ...interpret(spec, argWords.slice(from, to), { name: 'find', lookup }), refusal }, spec, part, cx.command!.args, false);
  };
  // (No option of find has an optional value.)
  const tree = parseFind(words, (w) => {
    const o = spec.options!.find((x) => x.names.includes(w));
    return o?.until ?? (o?.value ? 1 : 0);
  }, untilWords(argWords));
  // (A field find may read as an option or an operator, or several: the summary of the words as written would miss it.)
  const apart = nodes.some((n) => {
    const f = staticWordValue(n, false, cx.shell) === undefined ? fieldsIn(n, cx.state) : undefined;
    return !!f && (f.length !== 1 || /^(-|[()!,;+]$)/.test(f[0]));
  });
  if (!tree || apart) return [...read(0, nodes.length), ...empty];
  const exprArgs = nodes;

  const opTok = (idx: number, text: string): Token[] => [cx.tok(exprArgs[idx], 'operator', text)];
  const build = (n: FindNode): Token[] => {
    switch (n.type) {
      case 'primary':
        return read(n.from, n.to + 1);
      case 'not':
        return [...opTok(n.op, cx.text('find-not')), ...build(n.child)];
      case 'group': {
        const inner = [
          ...opTok(n.open, cx.text('find-group-open')),
          ...build(n.child),
          ...opTok(n.close, cx.text('find-group-close')),
        ];
        const span: Span = { start: spanOf(exprArgs[n.open]).start, end: spanOf(exprArgs[n.close]).end };
        return [{ kind: 'block', label: shorten(words.slice(n.open, n.close + 1).join(' ')), span, children: inner, explanation: cx.text('find-group') }];
      }
      case 'and':
      case 'or':
      case 'list': {
        const ops = new Set(n.ops);
        const toks = n.children.flatMap(build);
        for (const o of ops) pushAll(toks, opTok(o, cx.s(...operatorTexts(n.type))));
        return sortTokens(toks);
      }
    }
  };
  const first = exprArgs[0];
  const last = exprArgs[exprArgs.length - 1];
  const inside = (k: number): boolean => all.indexOf(none[k]) > all.indexOf(first) && all.indexOf(none[k]) < all.indexOf(last);
  return [{
    kind: 'test', label: shorten(words.join(' ')), explanation: describeFind(tree, cx.lang, strayWords(tree).some((i) => staticWordValue(nodes[i], false, cx.shell) !== undefined)),
    span: { start: spanOf(first).start, end: spanOf(last).end }, children: nested(build(tree), empty.filter((_, k) => inside(k))),
  }, ...empty.filter((_, k) => !inside(k))];
}

/**
 * The tokens of the arguments of `test` or `[` (`test`, from src/testexpr.ts): the expression, and the last `]` of `[`
 * (`bracket`). Where the expression is not known to be read (bash fails on it, or a word is not known), the words
 * are plain arguments: no condition is explained that may never be evaluated.
 */
export function testArgs(cx: Explainer, n: SyntaxNode, test: CommandTest, bracket: boolean, builtin: boolean): Token[] {
  const last = test.words[test.words.length - 1];
  // (`[ -f x]`, `[ -f $x]`: the `]` is glued to the last word. With a word not known, the pitfall says it.)
  const glued = bracket && !test.close && !!last && /\S\]$/.test(last.text);
  // (In the condition of `if [ -f a ] then`, bash stops at the syntax error: the command never runs, and the syntax error is what is said.)
  if (!inStrayHead(n)) {
    // (The rewrite puts a space before the `]`; none when the `]` is escaped, `b\]`, which a space leaves a character.)
    if (test.unclosed && glued) cx.note(fact(cx.lang, 'bracket-close-glued', { word: last.text, rewrite: /(^|[^\\])(\\\\)*\\\]$/.test(last.text) ? [] : [replaceNode(last, `${last.text.slice(0, -1)} ]`)] }), last);
    else if (test.unclosed) cx.note(fact(cx.lang, 'bracket-missing-close'), n);
    if (test.malformed) cx.note(fact(cx.lang, 'test-malformed', { name: bracket ? '[' : 'test' }), n);
  }
  let inner: Token[];
  if (test.test && !test.unclosed && !glued) {
    testExample(cx, n, bracketShape(test.test), '[');
    // (bash's builtin reads the words as 4.1 says, and its primaries are those of 6.4.)
    inner = testTokens(cx, n, test.test, test.test.expr, builtin ? ['4.1', '6.4'] : undefined);
  } else inner = cx.subs(test.words);
  if (!test.close) return inner;
  return [...inner, cx.tok(test.close, 'argument', cx.text('test-last-bracket'))];
}

/**
 * The bash release whose builtin `test` (its spec, `testSpecOf`) reads its words by bash's rules (`commandTest`), or
 * false when it is not bash's builtin.
 */
export const bashTest = (cx: Explainer, test: CommandSpec): TestRules | false => !!test.builtin && isBash(cx.shell) === 'yes' && (cx.opts.bashVersion ?? DEFAULT_BASH_VERSION);
