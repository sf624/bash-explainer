// The words of a command, read by its spec (docs/design/analyzer.md, step 7; docs/design/semantics.md, A): the
// argument interpreter (src/argv/interpret.ts) gives each word a role, and each role becomes a token. Options (one,
// short ones together, `--name=value`, old-style letters) and their values, `--`, operands (numbered, a job, a
// variable for the command, a name that a declaration builtin declares or `unset` removes), subcommands (`git stash
// push`), the command that a wrapper runs (sudo, xargs, `find -exec`), find's expression, the expression of `test`
// and `[`, and the strings run as scripts (src/explain/scripts.ts).
import type { ExplainOptions, Kind, Span, Token } from '../analyzer-types';
import { type ArgRole, type ArgvParse, type CommandRole, interpret, type RoleAt, type ValueRole } from '../argv/interpret';
import { declaresNames, namespaceOf } from '../argv/query';
import { DEFAULT_BASH_VERSION } from '../bashversion';
import { validName } from '../semantics/posixexits';
import type { CommandSpec, OperandSpec, VariableAct } from '../argv/spec';
import { argWordFor, countOf } from '../argv/words';
import { builtins, SHELL_OPTION_TABLES } from '../dict/builtins';
import { OPTION_SECTIONS } from '../manual';
import { describeFind, findWords, type FindNode, parseFind } from '../embedded/find';
import { globIntro, hasGlob } from '../embedded/glob';
import type { EmbeddedLang } from '../embedded/types';
import { braceTexts } from '../semantics/brace';
import type { Text } from '../i18n';
import { shorten } from '../label';
import { fact } from '../messages';
import { nameInfo } from '../namefacts';
import { spanOf } from '../noteanchors';
import { builtinSections, nodeSections, programSections } from '../refs';
import { shellEffectOf, type SlotLink, slotEnvs } from '../semantics/env';
import { type Missed, testSpecOf } from '../semantics/names';
import { attribute, docLine } from '../semantics/state';
import { readDeclarationWords, unsetEndsSpecial } from '../semantics/vars';
import { isPlainWord, type Literal, literalContent, staticWordText, staticWordValue, surelyHasSlash } from '../staticword';
import { replaceNode } from '../rewrite';
import { field, fields, inStrayHead, prefixAssignments, type SyntaxNode } from '../syntax/tree';
import { bracketShape, type CommandTest, commandTest, type TestRules } from '../testexpr';
import { readByCommand } from '../tokenmarks';
import { assignment } from './assignments';
import type { Explainer } from './context';
import { embedded, embeddedText } from './embedded';
import { testExample } from './examples';
import { skeletal, sortTokens } from './nodes';
import { type ExpansionStep, type StepKind, wordFields } from '../semantics/words';
import { argWordIn, untilWords } from '../semantics/argwords';
import { arrayKind, globOff, inEnvironment, NO_SPEC, programBasis, resolve, restrictedAt, restrictedCall, shellVariant, shoptAt, soleOff, specFor, wordAt } from './reads';
import { findRefusal } from './find-refusal';
import { joinedScript, scriptTokens, slotNotes, trapNote, withScript } from './scripts';
import { testTokens } from './tests';
import { inSubshell } from './where';
import { braceWord, elementWord, globChildren, globNotes, plainText, tilde, tildeNote, valueNote, word } from './words';

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

/** The entry of a table of a spec for a word of the script (`set -o constructor` finds none). */
const own = <T>(table: Readonly<Record<string, T>> | undefined, word: string): T | undefined => (table && Object.hasOwn(table, word) ? table[word] : undefined);

/**
 * The section of chapter 6 that describes the shell option `word`, when `values` are the names of shell options
 * (`set -o posix`: 6.11; `SHELL_OPTION_TABLES`, `OPTION_SECTIONS`).
 */
function optionRefs(values: object | undefined, word: string): { refs?: string[] } {
  // (Only a name the table has: `shopt -s posix` is no `shopt` option.)
  const section = values && SHELL_OPTION_TABLES.has(values) && Object.hasOwn(values, word) ? own(OPTION_SECTIONS, word) : undefined;
  return section ? { refs: [section] } : {};
}

/** `+x` (an option turned off) is written as `-x` in texts. */
const dash = (flag: string): string => flag.replace(/^\+/, '-');

/**
 * Explain the argument words of a command: the argument interpreter (src/argv/interpret.ts) reads them
 * with the command's spec, and each word's role becomes a token.
 */
export function readArgs(cx: Explainer, known: CommandSpec | undefined, args: SyntaxNode[], cmdName: string, isFn: boolean | 'maybe' = false): { tokens: Token[]; parse: ArgvParse } {
  // (A function's words are read with no spec: its options are unknown, and its operands are `$1`, `$2`….)
  const spec = known && !isFn ? known : NO_SPEC;
  const lookup = (name: string): CommandSpec | undefined => specFor(cx, name);
  const words = args.map(argWordFor(cx.state.shell));
  let parse = interpret(spec, words, { name: cmdName, lookup });
  if (args.length) for (const [w, env] of slotEnvs(cx.state.env(args[0].parent!), parse, spec, args, cx.state.shell, lookup)) cx.slotEnvs.set(w, env);
  // (`POSIXLY_CORRECT=1 /bin/echo --version`: the words the program reads as options only alone are text.)
  const off = args.length ? soleOff(cx, parse, spec, args) : undefined;
  if (off?.size) parse = interpret(spec, words, { name: cmdName, lookup, noSole: off });
  return { tokens: render(cx, parse, spec, args, args, isFn), parse };
}

/**
 * The tokens of the words `nodes` (indexed as the interpreter's words) that `parse` reads with `spec`.
 * `words` are the words of this command, which the explanations of embedded languages look at.
 */
function render(cx: Explainer, parse: ArgvParse, spec: CommandSpec, nodes: SyntaxNode[], words: SyntaxNode[], isFn: boolean | 'maybe' = false): Token[] {
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
  cx.withCommand({ cmd: parse.command, args: words, parse, nodes, spec }, () => {
    for (const { word, role } of parse.roles) {
      const a = nodes[word];
      switch (role.role) {
        case 'end-of-options':
          out.push(endOfOptions(cx, a, spec));
          break;
        case 'option':
        case 'unknown-option':
        case 'cluster':
          disables = (role.role === 'cluster' ? role.letters[0] as { flag: string } : role).flag.startsWith('+');
          // (A declaration builtin's options are explained by the attributes they give; one it does not have, as any builtin's.)
          out.push(declaresNames(spec) && role.role !== 'unknown-option' ? declarationOption(cx, a, role) : optionToken(cx, a, role, spec, parse));
          break;
        case 'pattern-option':
          out.push(cx.tok(a, 'option', cx.t(role.text), wordParts(cx, a)));
          break;
        case 'open-option':
          out.push(cx.tok(a, 'option', cx.s(
            '実行時に決まるオプション（展開した結果を、コマンドがオプションとして読む）',
            'Options known only at run time (the command reads what the expansion gives as options)'), wordParts(cx, a)));
          break;
        case 'value':
          out.push(expanded(cx, a, valueToken(cx, a, role, disables)));
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
            ? cx.s(`\`${role.of}\` の終わり: 見つかったファイルをまとめて1回のコマンドに渡す`, `End of \`${role.of}\`: pass all matches to one command invocation`)
            : cx.s(`\`${role.of}\` の終わり: 見つかったファイル1件ごとにコマンドを実行（\`;\` はシェルに解釈されないようエスケープが必要）`, `End of \`${role.of}\`: run once per match (\`;\` must be escaped from the shell)`)));
          break;
        case 'operand': {
          // (A word that expands to another number of words, `$x` or `{a,b}`, shifts the numbers: from it on, they are not sure.)
          const before = (role.spec && ordinals.get(role.spec)) || { n: 0, sure: true };
          const count = countOf(a, cx.state.shell);
          const gives = !count ? 1 : count.min === count.max ? count.min : undefined;
          if (role.spec) ordinals.set(role.spec, { n: before.n + (gives ?? 1), sure: before.sure && gives !== undefined });
          out.push(expanded(cx, a, operandToken(cx, nodes, word, role, parse, spec, { n: before.n + 1, sure: before.sure && !count }, assigned, isFn)));
          break;
        }
        case 'subcommand': {
          const note = cx.s(`（シェルから見れば \`${parse.command}\` への引数で、\`${parse.command}\` 自身が解釈する）`, ` (to the shell it is an argument to \`${parse.command}\`, which interprets it itself)`);
          out.push(cx.tok(a, 'subcommand', cx.s(`サブコマンド \`${role.parse.command}\`: `, `Subcommand \`${role.parse.command}\`: `) + cx.t(role.spec.summary) + note));
          out.push(...render(cx, role.parse, role.spec, nodes, nodes.slice(word + 1, role.parse.end)));
          break;
        }
        case 'command':
          if (role.slot.later) {
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
          } else out.push(wrapped(cx, nodes, word, role, assigned, parse.refusal));
          break;
        case 'joined':
          if (!joinedWhole) out.push(a === joinedNote?.at ? withScript(positional(cx, a, joined), { tokens: [], note: joinedNote.note }) : positional(cx, a, joined));
          break;
        case 'expression':
          // find's expression, read as a whole from its first word.
          if (word === parse.expression) out.push(...findExpression(cx, nodes.slice(word, parse.end), spec.expressionSpec!));
          break;
      }
    }
  });
  return readByCommand(out);
}

/**
 * Marks the token of a word the command reads as an argument with how bash changes the word before the command gets
 * it (`Token.expands`), from the word's meaning: a glob that applies, an unquoted expansion that splits, a brace expansion.
 */
function expanded(cx: Explainer, a: SyntaxNode, t: Token): Token {
  if (t.kind !== 'argument') return t;
  const steps = wordAt(cx, a)!.steps;
  const on = (k: StepKind): boolean => steps.some((x) => x.kind === k && x.applies === true);
  const kind = on('split') ? 'split' : on('glob') ? 'glob' : on('brace') ? 'brace' : undefined;
  return kind ? { ...t, expands: kind } : t;
}

/**
 * An option of a declaration builtin: what each letter gives, from the builtin's spec. `declare +x v` turns an
 * attribute off (its `offText`); `export` and `readonly` have no `+` form and their own letters. (A letter with no
 * text, or `+g`, says nothing.)
 */
function declarationOption(cx: Explainer, a: SyntaxNode, role: Extract<ArgRole, { role: 'option' | 'unknown-option' | 'cluster' }>): Token {
  const flags = (role.role === 'cluster' ? role.letters : [role]).flatMap((l) => (l.role !== 'option' ? [] : l.disables ? (l.spec.offText ? [l.spec.offText] : []) : [l.text]));
  return cx.tok(a, 'option', flags.length ? flags.map((f) => cx.t(f)).join(cx.s('、', ', ')) : cx.s('オプション', 'Option'));
}

/** The token of `--`, which ends the options of a builtin; what else it does, when the spec says (`set --` sets the positional parameters). */
function endOfOptions(cx: Explainer, n: SyntaxNode, spec: CommandSpec): Token {
  const own = spec.options?.find((o) => o.names.includes('--'));
  if (own) return cx.tok(n, 'option', cx.t(own.text));
  return cx.tok(n, 'option', cx.s('オプションの終わり: 以降は `-` で始まっていても通常の引数として扱う', 'End of options: everything after is a plain argument'));
}

/** The tokens of an expansion in a word read as an option (`-$opts`), if any. */
function wordParts(cx: Explainer, a: SyntaxNode): Token[] {
  return isPlainWord(a) ? [] : cx.sub(a);
}

/** The text of an option not in the dictionary. */
function unknownOption(cx: Explainer, command: string, spec: CommandSpec, ambiguous?: string[], late?: boolean): string {
  // (`bash -x --posix`: long options only before the others, the parser rule `longFirst`.)
  if (late) return cx.t(spec.lateOption!);
  if (spec.unknownOption) return cx.t(spec.unknownOption);
  if (ambiguous) {
    const names = ambiguous.map((n) => `\`${n}\``).join(cx.s('、', ', '));
    return cx.s(`あいまいなオプション（先頭が同じ長いオプションが複数ある: ${names}）。${command.split(' ')[0]} は受け付けない`, `Ambiguous option (it starts several long options: ${names}); ${command.split(' ')[0]} refuses it`);
  }
  // (A builtin's spec has every option bash's builtin takes: any other is one it refuses before doing anything.)
  if (spec.builtin) {
    return cx.s(`bash の \`${command}\` にないオプション: bash は \`invalid option\` と表示し、\`${command}\` は何もせずに失敗する（終了ステータス 2。オプションは \`help ${command}\` にある）`,
      `An option bash's \`${command}\` does not have: bash says \`invalid option\`, and \`${command}\` fails with status 2, doing nothing (\`help ${command}\` lists its options)`);
  }
  return cx.s(`オプション（辞書に未登録。\`man ${command.split(' ')[0]}\` を参照）`, `Option (not in the dictionary; see \`man ${command.split(' ')[0]}\`)`);
}

/**
 * `set +x` is the opposite of `set -x`: what turning the option (or the option named by a value) off does; `off`
 * is what the spec says it does (`set +f`: globbing is on again), when that is more than undoing it.
 */
function turnedOff(cx: Explainer, flag: string, what: string, value = false, off?: Text): string {
  const on = off ? cx.t(off)
    : cx.s(`元に戻す（${value ? '' : `\`${flag}\` は「`}${what}${value ? '' : '」'}）`, `turn it off again (${value ? '' : `\`${flag}\` is "`}${what}${value ? '' : '"'})`);
  return value ? on : cx.s(`\`${flag}\` を解除: ${on}`, `Undo \`${flag}\`: ${on}`);
}

/**
 * What a program reads in a word that no word of the shell holds, as tokens over its characters: the argument of a
 * shebang, which the kernel passes as one word, before the script's path (`#!/bin/bash -eu`: `-e` and `-u`). `role` is
 * the word's role in a parse of the word and the path; `at` places its characters `from` to `to`. A value the option
 * takes from the next word is the script's path, which the text says. Nothing for a word that is not options.
 */
export function shebangOptionTokens(cx: Explainer, role: ArgRole, spec: CommandSpec, command: string, text: string, at: (from: number, to: number) => Span): Token[] {
  const tok = (from: number, to: number, label: string, explanation: string, children: Token[] = []): Token => ({ kind: 'option', label, explanation, span: at(from, to), children, origin: 'argv' });
  const path = cx.s('（値は次の引数のスクリプトのパス）', ' (its value is the next argument, the script\'s path)');
  /** One option, over the characters `from` to `to` (a letter of a cluster, with a value written after it). */
  const one = (l: Extract<ArgRole, { role: 'option' | 'unknown-option' }>, from: number, to: number): Token => {
    const label = l.part ? dash(l.flag) : text;
    if (l.role === 'unknown-option') return tok(from, to, label, unknownOption(cx, command, spec, l.ambiguous, l.late));
    const said = l.disables ? turnedOff(cx, dash(l.flag), cx.t(l.text), false, l.spec.offText) : cx.t(l.text);
    // (`#!/usr/bin/awk -f`: the value is the next word, the script's path, unless a letter before took it (`-oO`); one
    // written in the word is its rest, `-i.bak`.)
    const value = l.value ? cx.s(`（値は \`${text.slice(l.value.attached)}\`）`, ` (value: \`${text.slice(l.value.attached)}\`)`) : l.spec.value && !l.missing ? path : '';
    return tok(from, to, label, said + value);
  };
  switch (role.role) {
    case 'option': case 'unknown-option': return [one(role, 0, text.length)];
    case 'end-of-options': return [tok(0, text.length, text, cx.s('オプションの終わり', 'End of options'))];
    case 'cluster': {
      const letters = role.letters.map((l) => {
        const o = l as Extract<ArgRole, { role: 'option' | 'unknown-option' }>;
        return one(o, o.part![0], o.role === 'option' && o.value ? text.length : o.part![1]);
      });
      const names = letters.map((p) => `\`${p.label}\``).join(' ');
      return [tok(0, text.length, text, cx.s(`短いオプション ${names} をまとめて指定`, `Combined short options ${names}`), letters)];
    }
    default: return [];
  }
}

/** The token of an option word: one option, `--name=value`, or short options together (`-rn`, `-n5`, `-F'|'`). */
function optionToken(cx: Explainer, a: SyntaxNode, role: Extract<ArgRole, { role: 'option' | 'unknown-option' | 'cluster' }>, spec: CommandSpec, parse: ArgvParse): Token {
  if (role.role !== 'cluster' && role.value && !role.part) return equalsToken(cx, a, role, spec, parse);
  if (role.role === 'cluster' || role.part) {
    const parts = (role.role === 'cluster' ? role.letters : [role]).flatMap((l) => letterParts(cx, a, l, spec, parse));
    const flags = parts.filter((p) => p.kind === 'option');
    // `-F,` / `-n5`: one option with its value attached is not a combination.
    return cx.tok(a, 'option', flags.length > 1
      ? cx.s(`短いオプション ${flags.map((p) => `\`${p.label}\``).join(' ')} をまとめて指定`, `Combined short options ${flags.map((p) => `\`${p.label}\``).join(' ')}`)
      : flags[0].explanation, flags.length > 1 ? parts : parts.filter((p) => p.kind === 'argument'));
  }
  if (role.role === 'unknown-option') return cx.tok(a, 'option', unknownOption(cx, parse.command, spec, role.ambiguous, role.late));
  const flag = dash(role.flag);
  // `set -o` with no name lists the settings; `set +o` prints commands that restore them.
  const alone = role.missing ? role.spec.noValue : undefined;
  return cx.tok(a, 'option', alone
    ? cx.t(role.disables ? alone.offText : alone.text)
    : role.disables ? turnedOff(cx, flag, cx.t(role.text), false, role.spec.offText) : cx.t(role.text), wordParts(cx, a));
}

/** `--name=value` (and `-name=value` for single-dash options): the option, with its value in the text. */
function equalsToken(cx: Explainer, a: SyntaxNode, role: Extract<ArgRole, { role: 'option' | 'unknown-option' }>, spec: CommandSpec, parse: ArgvParse): Token {
  const value = role.value!;
  const whole = literalContent(a);
  const litEq = whole?.text.indexOf('=') ?? -1;
  const val = whole && litEq >= 0 ? whole.text.slice(litEq + 1) : a.text.slice(a.text.indexOf('=') + 1);
  const known = own(value.spec?.values, val);
  const valueLit: Literal | undefined = whole && litEq >= 0
    ? (whole.offsets ? { text: val, offsets: whole.offsets.slice(litEq + 1) } : { text: val, base: whole.base! + litEq + 1 })
    : undefined;
  const emb = value.spec?.lang && valueLit ? embeddedText(cx, valueLit, value.spec.lang, a) : undefined;
  const extra = emb?.note ? ` — ${emb.note}` : '';
  const text = role.role === 'option' ? cx.t(role.text) : unknownOption(cx, parse.command, spec, role.ambiguous);
  return cx.tok(a, 'option', text + cx.s(`（値: \`${val}\`${known ? ' — ' + cx.t(known) : ''}）`, ` (value: \`${val}\`${known ? ' — ' + cx.t(known) : ''})`) + extra + splicedNote(cx, value), emb?.tokens ?? []);
}

/** A letter of an option word (`-e` of `-euo`, `c` of `tar cf`), as a token over its character. */
function part(a: SyntaxNode, role: Extract<ArgRole, { role: 'option' | 'unknown-option' }>, label: string, explanation: string): Token {
  const [from, to] = role.part!;
  return span(a, from, to, 'option', explanation, label);
}

/** A token over the characters `from` to `to` of the value of the word `a`. */
function span(a: SyntaxNode, from: number, to: number, kind: Kind, explanation: string, label: string): Token {
  const lit = literalContent(a);
  const at = (i: number): number => (lit?.offsets ? lit.offsets[i] : (lit?.base ?? 0) + i);
  const col = a.startPosition.column;
  const row = a.startPosition.row;
  return { kind, label, explanation, children: [], span: { start: { line: row, character: col + at(from) }, end: { line: row, character: to < 0 ? col + a.text.length : col + at(to - 1) + 1 } } };
}

/** The tokens of one letter of a cluster: the option, and the value written after it (`-n5`, `-i.bak`, `-F'|'`). */
function letterParts(cx: Explainer, a: SyntaxNode, l: ArgRole, spec: CommandSpec, parse: ArgvParse): Token[] {
  const letter = l as Extract<ArgRole, { role: 'option' | 'unknown-option' }>;
  const flag = dash(letter.flag);
  if (letter.role === 'unknown-option') return [part(a, letter, flag, unknownOption(cx, parse.command, spec))];
  const parts = [part(a, letter, flag, letter.disables ? turnedOff(cx, flag, cx.t(letter.text), false, letter.spec.offText) : cx.t(letter.text))];
  const value = letter.value;
  if (!value) return parts;
  // In `-F'|'` the value is what is left after quote removal.
  const lit = literalContent(a);
  const val = lit ? lit.text.slice(value.attached) : a.text.slice(value.attached);
  // The value ends where its text ends, not at the closing quote (`-f='X${Package}'`: the label is `X${Package}`).
  const raw = span(a, value.attached!, lit && val ? lit.text.length : -1, 'argument', '', '');
  raw.label = lit && val ? val : a.text.slice(raw.span.start.character - a.startPosition.column);
  raw.valueFor = flag;
  if (value.spec?.how === 'attached-only') {
    // `-i.bak`: the rest of the word is the value. In `-pie` that makes `e` the value, not `-e`.
    const trap = /^[a-zA-Z]/.test(val) && spec.options?.some((o) => o.names.includes('-' + val[0]))
      && cx.s(`。注意: \`${val}\` は別のオプションではなく \`${flag}\` の値として扱われる`, `. Note: \`${val}\` is taken as the value of \`${flag}\`, not as more options`);
    raw.label = val;
    raw.explanation = cx.s(`\`${flag}\` の値 \`${val}\``, `Value \`${val}\` for \`${flag}\``) + (trap || '');
    return [...parts, raw];
  }
  const known = own(value.spec?.values, val);
  const glued = lit && !isPlainWord(a);
  raw.explanation = (known ? `${val}: ${cx.t(known)}` : cx.s(`\`${flag}\` の値`, `Value for \`${flag}\``) + (glued ? cx.s(`（クォートを外すと \`${val}\`）`, ` (\`${val}\` after quote removal)`) : '')) + splicedNote(cx, value);
  // `-k3,3nr`, `-f2-4`: the attached value can be broken down like a separate one.
  const lang = value.spec?.lang;
  const emb = lang && lit ? embeddedText(cx, lit.offsets ? { text: val, offsets: lit.offsets.slice(value.attached) } : { text: val, base: lit.base! + value.attached! }, lang, a) : undefined;
  if (emb) {
    raw.children = emb.tokens;
    if (emb.note) raw.explanation += ` — ${emb.note}`;
  }
  return [...parts, raw];
}

/** The token of an option's value in a word of its own (`-o pipefail`, `-e 's/a/b/'`, `--arg name value`). */
function valueToken(cx: Explainer, v: SyntaxNode, role: ValueRole, disables: boolean): Token {
  const flag = dash(role.of);
  const spec = role.spec;
  let t: Token;
  // (`tar cf a.tar`: the value of the letter `f`.)
  const valueFor = /^-/.test(flag) ? cx.s(`\`${flag}\` オプションの値`, `Value for \`${flag}\``) : cx.s(`\`${flag}\` の値`, `Value for \`${flag}\``);
  if (spec?.lang) t = positional(cx, v, valueFor + ': ' + cx.t(role.option!.text), spec.lang);
  else {
    const known = own(spec?.values, v.text);
    t = cx.tok(v, 'argument', known
      ? `${v.text}: ${disables ? turnedOff(cx, v.text, cx.t(known), true, own(spec!.offValues, v.text)) : cx.t(known)}`
      : valueFor, wordParts(cx, v));
    if (known) Object.assign(t, optionRefs(spec!.values, v.text));
  }
  // `jq --arg NAME VALUE`: two words follow; the first is the name.
  if (Array.isArray(role.option?.value) && role.option.value.length === 2) {
    const names = [cx.s('名前', 'name'), cx.s('値', 'value')];
    const name = names[role.index];
    t.explanation = cx.s(`\`${flag}\` の${name}`, `${name[0].toUpperCase()}${name.slice(1)} for \`${flag}\``) + (role.index === 0 ? cx.s('（フィルタでは `$` を付けて使う）', ' (use it as `$name` in the filter)') : '');
  }
  t.explanation += splicedNote(cx, role);
  t.valueFor = flag;
  return t;
}

/**
 * A value whose words the program reads in its place (`env -S'-i bash -e'`): the words and what each is, or
 * why the program refuses it.
 */
function splicedNote(cx: Explainer, v: ValueRole): string {
  const program = cx.command!.cmd.split(' ')[0].split('/').pop()!;
  if (v.refused) {
    const at = v.refused.at;
    const why: Record<typeof v.refused.error, string> = {
      quote: cx.s('閉じるクォートがない', 'a quote is not closed'),
      'backslash-end': cx.s('最後がバックスラッシュ', 'it ends in a backslash'),
      sequence: cx.s(`\`${at}\` は使えないエスケープ`, `\`${at}\` is not an escape it knows`),
      'c-in-quotes': cx.s('ダブルクォートの中に `\\c` がある', '`\\c` is inside double quotes'),
      dollar: cx.s('`$` は `${名前}` の形でしか使えない', '`$` is only allowed as `${NAME}`'),
    };
    return cx.s(`。⚠ ${program} はこの文字列を受け付けず、何も実行せずに終了ステータス 125 で終わる（${why[v.refused.error]}）`,
      `. ⚠ ${program} refuses this string and exits with status 125, running nothing (${why[v.refused.error]})`);
  }
  if (!v.split) return '';
  const { words, roles } = v.split;
  const shown = (k: number): string => {
    const w = words[k];
    return w.value !== undefined ? `\`${w.value}\`` : cx.s(`\`${w.prefix}…\`（\`\${…}\` の値は実行時に決まる）`, `\`${w.prefix}…\` (the value of \`\${…}\` is known at run time)`);
  };
  const what = (role: ArgRole): string => {
    switch (role.role) {
      case 'option': case 'pattern-option': return cx.t(role.text);
      case 'cluster': return role.letters.map(what).join(cx.s('、', ', '));
      case 'value': return cx.s(`\`${dash(role.of)}\` の値`, `value for \`${dash(role.of)}\``);
      case 'operand':
        if (role.spec?.assignment) return cx.s('コマンドの環境に入れる変数', 'variable for the command');
        return role.spec ? cx.t(role.spec.text) : cx.s('引数', 'argument');
      case 'command': return cx.s('実行するコマンド', 'the command to run') + (role.spec ? `: ${cx.t(role.spec.summary)}` : '');
      case 'subcommand': return cx.s('サブコマンド', 'subcommand') + `: ${cx.t(role.spec.summary)}`;
      case 'end-of-options': return cx.s('オプションの終わり', 'end of options');
      default: return cx.s('辞書にないオプション', 'an option not in the dictionary');
    }
  };
  const items: string[] = [];
  const walk = (list: RoleAt[]): void => {
    for (const { word, role } of list) {
      items.push(`${shown(word)}${cx.s(`（${what(role)}）`, ` (${what(role)})`)}`);
      if ((role.role === 'command' || role.role === 'subcommand') && role.parse) walk(role.parse.roles);
    }
  };
  walk(roles);
  if (!items.length) return cx.s(`。${program} はこれを単語に分けるが、何も残らない`, `. ${program} splits it into no words`);
  return cx.s(`。${program} はこれを単語に分けて、この位置で自分の引数として読む: ${items.join('、')}`, `. ${program} splits it into words and reads them here as its own arguments: ${items.join(', ')}`);
}

/** The token of an operand: what the spec says it is, numbered (`$1`), or as a job spec, a shell option, an assignment. */
function operandToken(cx: Explainer, nodes: SyntaxNode[], word: number, role: Extract<ArgRole, { role: 'operand' }>, parse: ArgvParse, spec: CommandSpec, at: { n: number; sure: boolean }, assigned: string[], isFn: boolean | 'maybe'): Token {
  const a = nodes[word];
  const item = role.spec;
  // `unset NAME`, `declare NAME=value`: what the name stands for, as bash decides it here.
  if (item?.acts === 'unsets') return unsetOperand(cx, nodes, word, item, namespaceOf(parse, item), parse);
  if (item?.acts === 'declares') return declaredOperand(cx, a, namespaceOf(parse, item), parse.command);
  // `env FOO=1 cmd`: an assignment for the command, not the command.
  if (item?.assignment) {
    const name = a.text.slice(0, a.text.indexOf('='));
    assigned.push(name);
    return cx.tok(a, 'argument', cx.s(`環境変数 \`${name}\` の設定（実行するコマンドの環境にだけ入る）`, `Sets the variable \`${name}\` for the command to run`), wordParts(cx, a));
  }
  // `%1`, `%%`, `%name`: a job, not a file or a PID.
  const job = item?.type === 'job' && isPlainWord(a) ? jobSpec(a.text) : undefined;
  if (job) return cx.tok(a, 'argument', cx.s(`ジョブ指定: ${job.ja}`, `Job spec: ${job.en}`));
  let desc: string | undefined;
  // (A function gets every word, also those that look like options: `f -g b` gives `b` as $2.)
  if (isFn) desc = cx.s(`関数への引数 $${word + 1}`, `Argument $${word + 1} to the function`);
  else if (item?.values && Object.hasOwn(item.values, a.text)) desc = cx.t(item.values[a.text]);
  else if (role.assignment) desc = cx.t(item!.assignmentText!);
  else if (role.each) desc = eachText(cx, a, role.each);
  else if (item) {
    const text = cx.t(item.text);
    desc = text.replace('`$N`', `\`$${at.n}\``);
    if (desc !== text && !at.sure) desc += cx.s('（この語か前の語が展開で 1 語以外になると、番号もずれる）', ' (if this word or one before it expands to more or fewer words, the number shifts)');
  }
  if (desc && role.several) {
    const roles = role.several.map((o) => cx.t(o.text)).join(cx.s('、', ', then '));
    desc = cx.s(`\`${a.text}\` が1語に展開されるなら${desc}、2語以上なら順に${roles}`, `${desc} when \`${a.text}\` expands to a single word; when it expands to more, they are ${roles}`);
  } else if (desc && role.otherwise) desc = uncertainText(cx, desc, cx.t(role.otherwise.text), parse, nodes);
  // (A function named like a declaration builtin, or `alias`, given `a=…`: bash's parser marked the word.)
  // (Not the operand's meaning when bash assigns an array and passes only the name: `alias b=(1 2)`.)
  const named = isFn || field(a, 'value')?.type !== 'array' ? desc : undefined;
  if (a.type === 'variable_assignment') return markedAssignment(cx, a, named ?? cx.s(`引数 \`${a.text}\``, `Argument \`${a.text}\``), parse.command, isFn);
  const t = positional(cx, a, desc, isFn ? undefined : item?.lang);
  return isFn ? t : { ...t, ...optionRefs(item?.values, a.text) };
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
  return cx.tok(a, 'argument', [desc, ...sentences].join(cx.s('。', '. ')), cx.sub(value));
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
  if (!names.length) return noWord(cx);
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
  const written = staticWordValue(a);
  if (space !== 'function' && !element && written !== undefined && !validName(/^[^=]*?(?=\+?=|$)/.exec(written)![0]) && !(written === '-' && builtins[command].localOptions)
    && !(builtins[command].locals && readDeclarationWords(command, fields(a.parent!, 'argument'), cx.state.shell).on.includes('p'))) {
    return cx.tok(a, 'variable', cx.s('bash はこの語を受け付けない: 変数の名前として正しくない（「not a valid identifier」で終了ステータス 1）', 'Bash refuses this word: it is not a valid variable name ("not a valid identifier", status 1)'));
  }
  if (space === 'function' || !element) {
    return cx.tok(a, 'variable', space === 'function' ? cx.s(`関数 \`${a.text}\` を対象にする`, `Function \`${a.text}\``) : cx.s(`変数 \`${a.text}\` を対象にする`, `Variable \`${a.text}\``));
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
    return cx.tok(a, 'assignment', cx.s(
      `${what}（\`${command}\` がこの語を代入として読む）。POSIX モードの bash は、\`command\` の後でもこの語を代入として展開する（単語分割もグロブ展開もしない）`,
      `${what} (\`${command}\` reads the word as an assignment). In POSIX mode, bash expands it as an assignment after \`command\` too (no word splitting or globbing)`,
    ), a.type === 'concatenation' ? cx.sub(a).flatMap((t) => t.children) : []);
  }
  return cx.tok(a, 'assignment', cx.s(
    `${what}（\`${command}\` がこの語を代入として読む）。ただし bash にとっては普通の引数で、代入ではない（コマンド名が \`${command}\` そのものではないため）${split ? '。クォートしない展開は単語分割とグロブ展開を受ける' : ''}`,
    `${what} (\`${command}\` reads the word as an assignment). To bash it is an ordinary argument, not an assignment, since the command name is not \`${command}\` itself${split ? ': an unquoted expansion in it is split and globbed' : ''}`,
  ), a.type === 'concatenation' ? cx.sub(a).flatMap((t) => t.children) : []);
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
  if (!names.length) return noWord(cx);
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
  if (['sh', 'dash', 'ash'].includes(cx.shell ?? '')) {
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

/**
 * The roles an operand may have, which depend on how many words the expansions among the operands give
 * (`cp *.txt dir`): `desc` when they give one word each, `other` when they give more.
 */
function uncertainText(cx: Explainer, desc: string, other: string, parse: ArgvParse, nodes: SyntaxNode[]): string {
  // (Any word may be the one: `bash -c $cmd _ a`, where the string is unquoted.)
  const many = parse.roles.filter((r) => countOf(nodes[r.word], cx.state.shell)?.max !== countOf(nodes[r.word], cx.state.shell)?.min);
  const list = many.map((r) => `\`${nodes[r.word].text}\``).join(cx.s('・', ', '));
  return cx.s(`${list} が1語に展開されるなら${desc}、2語以上なら${other}`, `${desc} when ${list} expands to a single word; ${other} when it expands to more`);
}

/** The words a brace expansion gives, each with its role (`cp a{,.bak}`: the source, then the destination). */
function eachText(cx: Explainer, a: SyntaxNode, each: OperandSpec[]): string {
  // `destination (the new name…)` reads `destination: the new name…` in the parentheses.
  const parts = braceTexts([a])!.map((w, k) => `\`${w}\`${cx.s(`（${cx.t(each[k].text).replace(/（(.*)）$/, ': $1')}）`, ` (${cx.t(each[k].text).replace(/ \((.*)\)$/, ': $1')})`)}`);
  const list = `${parts.slice(0, -1).join(cx.s('、', ', '))}${cx.s('と ', ' and ')}${parts[parts.length - 1]}`;
  return cx.s(`${list}に展開される`, `expands to ${list}`);
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
  const known = after.findIndex((w) => { const c = countOf(w, cx.state.shell); return c !== undefined && c.max !== 1; });
  const via = (cx.slotEnvs.get(nodes[word])!.links.at(-1) as SlotLink).via;
  return { via, words: (known < 0 ? after : after.slice(0, known)).map((w) => w.text), more: known >= 0 };
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
      explanation = res.disabled ? cx.s(`行 ${docLine(res.disabled.at) + 1} の \`enable -n\` で組み込みの \`${name}\` は無効なので、\`builtin\` はエラーになる`, `\`enable -n\` on line ${docLine(res.disabled.at) + 1} turned the builtin \`${name}\` off, so \`builtin\` fails`)
        : cx.s(`\`${name}\` は組み込みコマンドではないので、\`builtin\` はエラーになる`, `\`${name}\` is not a builtin, so \`builtin\` fails`);
    } else if (res.kind === 'file' && res.disabled) {
      // (`enable -n echo; command echo`: the program.)
      kind = 'command';
      const program = role.spec?.program;
      const line = (docLine(res.disabled.at) + 1);
      explanation = cx.s(`外部コマンド \`${name}\`（行 ${line} の \`enable -n\` で組み込みは無効）${program ? `: ${cx.t(program.summary)}` : ''}`,
        `the external command \`${name}\` (\`enable -n\` on line ${line} turned the builtin off)${program ? `: ${cx.t(program.summary)}` : ''}`);
    }
    if (missed?.kind === 'function' && (missed.why === 'command' || missed.why === 'builtin')) {
      explanation += cx.s(`（行 ${(docLine(missed.def) + 1)} の同じ名前の関数は使わない）`, ` (not the function of that name, defined on line ${(docLine(missed.def) + 1)})`);
    }
  }
  // `command [ -f x ]`, `env test -f x`: `test` and `[` read their words as an expression, when the name runs one of them.
  const value = staticWordValue(first);
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
  const programOff = offProgram?.soleUnlessEnv && inEnvironment(cx, offProgram.soleUnlessEnv, first.parent!, cx.slotEnvs.get(first)) ? new Set([-1]) : undefined;
  const children = test ? testArgs(cx, first.parent!, commandTest(test, words.slice(1), bashTest(cx, test)), test.closingOperand !== undefined, !!test.builtin)
    : vspec ? render(cx, interpret(vspec, words.slice(1).map(argWordFor(cx.state.shell)), { name, lookup: (x) => specFor(cx, x) }), vspec, words.slice(1), words.slice(1))
      : offProgram ? render(cx, interpret(offProgram, words.slice(1).map(argWordFor(cx.state.shell)), { name, lookup: (x) => specFor(cx, x), ...(role.appended ? { appended: true } : {}), ...(programOff ? { noSole: programOff } : {}) }), offProgram, words.slice(1), words.slice(1))
      : render(cx, refusal ? { ...parse, refusal } : parse, role.spec ?? NO_SPEC, nodes, words.slice(1));
  if (role.of) {
    // `{}` is replaced by find (and `xargs -I{}`) with each path.
    const mark = (ts: Token[]) => ts.forEach((t) => {
      if (t.label === '{}') {
        t.explanation = cx.s('`{}`: 見つかったファイルのパスに置き換わる', '`{}`: replaced with the path that was found');
        t.children = [];
      } else mark(t.children);
    });
    mark(children);
  }
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
    kind, ...(res ? { name: nameInfo(cx.lang, res, cx, first, cx.slotEnvs.get(first)) } : {}), ...(direct ? { refs: builtinSections(res.name, res.special) } : program.length ? { refs: program } : {}), ...(basis ? { basis } : {}),
    label: shorten(name),
    explanation: (role.of ? cx.s('実行するコマンド: ', 'Command to run: ') : '') + (direct ? '' : cx.s(`\`${name}\` を実行: `, `runs \`${name}\`: `)) + explanation,
    span, children, summary: `${name}: ${explanation}`,
  };
}

function positional(cx: Explainer, a: SyntaxNode, desc: string | undefined, lang?: EmbeddedLang): Token {
  const emb = lang && embedded(cx, a, lang);
  if (emb && desc && emb.note) desc += ` — ${emb.note}`;
  // (A word of plain text with braces, `x{a,b}`, is read as one: its brace expansion, or its text where it has none.)
  if (plainText(a)) {
    // Arguments in another language are positional ones the dictionary describes.
    if (emb) return cx.tok(a, 'argument', desc!, emb.tokens);
    const brace = braceWord(cx, a);
    const base = brace ?? word(cx, a);
    // (A word that is only a tilde expansion is still an operand the command reads: bash's token is under it.)
    if (!desc) return base.kind === 'expansion' && !brace ? cx.tok(a, 'argument', cx.s(`文字列 \`${a.text}\``, `Word \`${a.text}\``), [base]) : base;
    if (brace) return cx.tok(a, 'argument', desc, [brace]);
    const tl = tilde(cx, a);
    // (Tildes after `=` and `:` come as a word with them as its children.)
    if (tl) return tl.kind === 'expansion' ? cx.tok(a, 'argument', desc, [tl]) : cx.tok(a, 'argument', desc + tildeNote(cx, a), tl.children);
    const off = hasGlob(a.text) && globOff(cx, a);
    if (off) return cx.tok(a, 'argument', desc + off);
    const glob = hasGlob(a.text) ? ` — ${globIntro(cx.lang, 'file')}` + globNotes(cx, a.text, a) : '';
    const t = cx.tok(a, 'argument', desc + glob + valueNote(cx, a), hasGlob(a.text) ? globChildren(cx, a, a.text, 0) : []);
    if (glob) t.refs = ['3.5.8'];
    return t;
  }
  const inner = cx.sub(a);
  // The embedded tokens sit inside the quotes, so they become children of the string token.
  if (emb && inner[0]) inner[0].children = sortTokens([...inner[0].children, ...emb.tokens]);
  if (!desc) return inner[0];
  // Describe the role, then what the quoting/expansion does.
  return cx.tok(a, 'argument', desc, inner);
}

/**
 * find's expression, explained as a whole (`-o`, implicit `-a`, `!` and `\( \)` grouping) with the tokens
 * of each primary inside. When it cannot be parsed, its words are read as options of find.
 */
function findExpression(cx: Explainer, nodes: SyntaxNode[], spec: CommandSpec): Token[] {
  const words = findWords(nodes);
  const lookup = (name: string) => specFor(cx, name);
  // find refuses all its arguments when one of its actions is wrong (`-exec f {} ;`): none of them runs. (Its words as find
  // gets them, where the model knows them: `x=';'; find . -exec echo {} $x` ends at `$x`.)
  const argWords = nodes.map(argWordIn(cx.state));
  const { refusal } = interpret(spec, argWords, { name: 'find', lookup });
  if (refusal) findRefusal(cx, nodes, spec, refusal);
  const read = (from: number, to: number): Token[] => {
    const part = nodes.slice(from, to);
    return render(cx, { ...interpret(spec, argWords.slice(from, to), { name: 'find', lookup }), refusal }, spec, part, cx.command!.args);
  };
  // (No option of find has an optional value.)
  const tree = parseFind(words, (w) => {
    const o = spec.options!.find((x) => x.names.includes(w));
    return o?.until ?? (o?.value ? 1 : 0);
  }, untilWords(argWords));
  if (!tree) return read(0, nodes.length);
  const exprArgs = nodes;

  const opTok = (idx: number, ja: string, en: string): Token[] => [cx.tok(exprArgs[idx], 'operator', cx.s(ja, en))];
  const build = (n: FindNode): Token[] => {
    switch (n.type) {
      case 'primary':
        return read(n.from, n.to + 1);
      case 'not':
        return [...opTok(n.op, '`!`: 直後の条件を否定する', '`!`: negates what follows'), ...build(n.child)];
      case 'group': {
        const inner = [
          ...opTok(n.open, '`\\(`: グループの開始（シェルに解釈されないよう `\\` でエスケープする）', '`\\(`: start of a group (escaped so the shell leaves it alone)'),
          ...build(n.child),
          ...opTok(n.close, '`\\)`: グループの終わり', '`\\)`: end of the group'),
        ];
        const span: Span = { start: spanOf(exprArgs[n.open]).start, end: spanOf(exprArgs[n.close]).end };
        return [{ kind: 'block', label: shorten(words.slice(n.open, n.close + 1).join(' ')), span, children: inner, explanation: cx.s('グループ: 括弧の中を先にまとめて評価する', 'Group: evaluated as one condition') }];
      }
      case 'and':
      case 'or': {
        const ops = new Set(n.ops);
        const toks = n.children.flatMap(build);
        for (const o of ops) {
          toks.push(...(n.type === 'or'
            ? opTok(o, '`-o`: または（左右どちらかが真なら真。`-a` より優先順位が低い）', '`-o`: or (lower precedence than `-a`)')
            : opTok(o, '`-a`: かつ（省略しても同じ）', '`-a`: and (the default when omitted)')));
        }
        return sortTokens(toks);
      }
    }
  };
  const first = exprArgs[0];
  const last = exprArgs[exprArgs.length - 1];
  return [{
    kind: 'test', label: shorten(words.join(' ')), explanation: describeFind(tree, cx.lang),
    span: { start: spanOf(first).start, end: spanOf(last).end }, children: build(tree),
  }];
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
  return [...inner, cx.tok(test.close, 'argument', cx.s('`[` に渡す最後の引数。`[` はこれで式の終わりを確かめる（ないとエラー）', 'The last argument passed to `[`. `[` checks it to find the end of the expression (without it, an error)'))];
}

/**
 * The bash release whose builtin `test` (its spec, `testSpecOf`) reads its words by bash's rules (`commandTest`), or
 * false when it is not bash's builtin.
 */
export function bashTest(cx: Explainer, test: CommandSpec): TestRules | false {
  return !!test.builtin && (!cx.shell || cx.shell === 'bash') && (cx.opts.bashVersion ?? DEFAULT_BASH_VERSION);
}
