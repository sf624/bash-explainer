// The options of a command and their values (src/explain/argv.ts calls these from `render`): a word that is an option, a cluster
// of short ones, `--name=value`, `--`, and the token of a value an option takes.

import type { Span, Token } from '../analyzer-types';
import { type ArgRole, type ArgvParse, type ValueRole } from '../argv/interpret';
import type { CommandSpec } from '../argv/spec';
import { attribute } from '../semantics/state';
import { attachedWritten } from '../argv/words';
import { isPlainWord, type Literal, literalContent, literalFrom } from '../staticword';
import { type SyntaxNode } from '../syntax/tree';
import type { Explainer } from './context';
import { embeddedText } from './embedded';
import { notForEarlier } from './reads';
import { wordItems } from './operand-texts';
import { turnedOff, unknownOption } from './option-texts';
import { word } from './words';
import { dash, optionRefs, own, part, positional, span, wordParts } from './argv-shared';

/**
 * An option of a declaration builtin: what each letter gives, from the builtin's spec. `declare +x v` turns an
 * attribute off (its `offText`); `export` and `readonly` have no `+` form and their own letters. (A letter with no
 * text, or `+g`, says nothing.)
 */
export function declarationOption(cx: Explainer, a: SyntaxNode, role: Extract<ArgRole, { role: 'option' | 'unknown-option' | 'cluster' }>): Token {
  const flags = (role.role === 'cluster' ? role.letters : [role]).flatMap((l) => (l.role !== 'option' ? [] : l.disables ? (l.spec.offText ? [l.spec.offText] : []) : [l.text]));
  return cx.tok(a, 'option', flags.length ? flags.map((f) => cx.t(f)).join(cx.comma()) : cx.text('option-plain'));
}

/** The token of `--`, which ends the options of a builtin; what else it does, when the spec says (`set --` sets the positional parameters). */
export function endOfOptions(cx: Explainer, n: SyntaxNode, spec: CommandSpec): Token {
  const own = spec.options?.find((o) => o.names.includes('--'));
  if (own) return cx.tok(n, 'option', cx.t(own.text));
  return cx.tok(n, 'option', cx.text('option-end-of-options'));
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
    if (l.role === 'unknown-option') return tok(from, to, label, unknownOption(cx, { command }, spec, l.ambiguous, l.late));
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
export function optionToken(cx: Explainer, a: SyntaxNode, role: Extract<ArgRole, { role: 'option' | 'unknown-option' | 'cluster' }>, spec: CommandSpec, parse: ArgvParse, word: number): Token {
  if (role.role !== 'cluster' && role.value && !role.part) return equalsToken(cx, a, role, spec, parse);
  if (role.role === 'cluster' || role.part) {
    const parts = (role.role === 'cluster' ? role.letters : [role]).flatMap((l) => letterParts(cx, a, l, spec, parse, word));
    const flags = parts.filter((p) => p.kind === 'option');
    // `-F,` / `-n5`: one option with its value attached is not a combination.
    return cx.tok(a, 'option', flags.length > 1
      ? cx.text('option-combined-short', { labels: flags.map((p) => `\`${p.label}\``).join(' ') })
      : flags[0].explanation, flags.length > 1 ? parts : parts.filter((p) => p.kind === 'argument'));
  }
  if (role.role === 'unknown-option') return cx.tok(a, 'option', role.refused && !role.ambiguous ? cx.t(role.refused) : unknownOption(cx, parse, spec, role.ambiguous, role.late));
  const flag = dash(role.flag);
  // `set -o` with no name lists the settings; `set +o` prints commands that restore them.
  // (An optional value that is not in the word has it too: `mysql -p` asks for the password.)
  const alone = role.missing || (role.spec.value && (role.spec.value as { optional?: boolean }).optional && !role.value) ? role.spec.noValue : undefined;
  return cx.tok(a, 'option', alone
    ? cx.t(role.disables ? alone.offText : alone.text)
    : (role.disables && !role.negated ? turnedOff(cx, flag, cx.t(role.text), false, role.spec.offText) : onOrOff(cx, role)) + notForEarlier(cx, parse, word, role), wordParts(cx, a));
}

/** What an option does, or with the parser rule `negation` what turning it off does (`--nostamp`, `--keep_going=false`). */
function onOrOff(cx: Explainer, role: Extract<ArgRole, { role: 'option' }>): string {
  return role.negated ? cx.text('option-negated', { name: role.negated, on: cx.t(role.text) }) : cx.t(role.text);
}

/** `--name=value` (and `-name=value` for single-dash options): the option, with its value in the text. */
function equalsToken(cx: Explainer, a: SyntaxNode, role: Extract<ArgRole, { role: 'option' | 'unknown-option' }>, spec: CommandSpec, parse: ArgvParse): Token {
  const value = role.value!;
  const whole = literalContent(a);
  const litEq = whole?.text.indexOf('=') ?? -1;
  const written = whole ? undefined : attachedWritten(a, value.attached!);
  const val = written ? written.text : whole!.text.slice(litEq + 1);
  const known = own(value.spec?.values, val);
  const valueLit: Literal | undefined = whole && litEq >= 0 ? literalFrom(whole, litEq + 1) : undefined;
  const emb = value.spec?.lang && valueLit ? embeddedText(cx, valueLit, value.spec.lang, a) : undefined;
  const extra = emb?.note ? ` — ${emb.note}` : '';
  const text = role.role === 'option' ? onOrOff(cx, role) : unknownOption(cx, parse, spec, role.ambiguous);
  // (`--jobs=$(nproc)`: what bash expands in the value has its row, as in a separate value: a command runs there.)
  return cx.tok(a, 'option', text + cx.text('option-equals-value', { val, ...(known ? { known: cx.t(known) } : {}) }) + extra + splicedNote(cx, value), emb?.tokens ?? cx.subs(written?.nodes ?? []));
}

/** The tokens of one letter of a cluster: the option, and the value written after it (`-n5`, `-i.bak`, `-F'|'`). */
function letterParts(cx: Explainer, a: SyntaxNode, l: ArgRole, spec: CommandSpec, parse: ArgvParse, word: number): Token[] {
  const letter = l as Extract<ArgRole, { role: 'option' | 'unknown-option' }>;
  const flag = dash(letter.flag);
  if (letter.role === 'unknown-option') return [part(a, letter, flag, unknownOption(cx, parse, spec))];
  const parts = [part(a, letter, flag, (letter.disables ? turnedOff(cx, flag, cx.t(letter.text), false, letter.spec.offText) : cx.t(letter.text)) + notForEarlier(cx, parse, word, letter))];
  const value = letter.value;
  if (!value) return parts;
  // In `-F'|'` the value is what is left after quote removal.
  const lit = literalContent(a);
  const written = lit ? undefined : attachedWritten(a, value.attached!);
  const val = written ? written.text : lit!.text.slice(value.attached);
  // The value ends where its text ends, not at the closing quote (`-f='X${Package}'`: the label is `X${Package}`).
  const raw = span(a, value.attached!, lit && val ? lit.text.length : -1, 'argument', '', '');
  if (written) {
    raw.span.start.character = a.startPosition.column + written.from;
    raw.span.end.character = a.startPosition.column + written.to;
    // (`-j"$(nproc)"`: what bash expands in the value has its row, as in a separate value: a command runs there.)
    raw.children = cx.subs(written.nodes);
  }
  raw.label = val || a.text.slice(raw.span.start.character - a.startPosition.column);
  raw.valueFor = flag;
  if (value.spec?.how === 'attached-only') {
    // `-i.bak`: the rest of the word is the value. In `-pie` that makes `e` the value, not `-e`.
    const trap = /^[a-zA-Z]/.test(val) && spec.options?.some((o) => o.names.includes('-' + val[0]))
      && cx.text('option-attached-value-trap', { val, flag });
    raw.label = val;
    raw.explanation = cx.text('option-attached-value', { flag, val }) + (trap || '');
    return [...parts, raw];
  }
  const known = own(value.spec?.values, val);
  const glued = lit && !isPlainWord(a);
  raw.explanation = (known ? `${val}: ${cx.t(known)}` : cx.text('option-value-for', { flag }) + (glued ? cx.text('option-value-unquoted', { val }) : '')) + splicedNote(cx, value);
  // `-k3,3nr`, `-f2-4`: the attached value can be broken down like a separate one.
  const lang = value.spec?.lang;
  const emb = lang && lit ? embeddedText(cx, literalFrom(lit, value.attached!), lang, a) : undefined;
  if (emb) {
    raw.children = emb.tokens;
    if (emb.note) raw.explanation += ` — ${emb.note}`;
  }
  return [...parts, raw];
}

/** The token of an option's value in a word of its own (`-o pipefail`, `-e 's/a/b/'`, `--arg name value`). */
export function valueToken(cx: Explainer, v: SyntaxNode, role: ValueRole, disables: boolean): Token {
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
    t.explanation = (role.index === 0 ? cx.text('option-name-for', { flag }) + cx.text('option-name-filter-hint') : cx.text('option-value-for', { flag }));
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
    return cx.sep() + cx.text(cx.reachedAt(cx.command!.nodes[0]) ? 'splice-refused' : 'splice-refused-if-reached', { program, why: why[v.refused.error] });
  }
  if (!v.split) return '';
  const items = wordItems(cx, v.split.words, v.split.roles, false);
  if (!items.length) return cx.s(`。${program} はこれを単語に分けるが、何も残らない`, `. ${program} splits it into no words`);
  return cx.s(`。${program} はこれを単語に分けて、この位置で自分の引数として読む: ${items.join('、')}`, `. ${program} splits it into words and reads them here as its own arguments: ${items.join(', ')}`);
}
