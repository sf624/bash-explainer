// The field domain (src/semantics/fieldshape.ts, docs/design/trust-fields.md, step 1) against bash. Generated words
// (test/support/fieldshape-gen.ts) run in bash, each case in a subshell of its own, in a directory with its files; every
// script in a cgroup, FUNCNEST set, killed as a process group on a timeout (test/support/contained.ts). The fields bash
// gives must lie in the shapes the domain gives, read with every part a hole (shape first) and with the values the case
// assigns where the model sees them; where a field lies in a description, the questions that answer "no" must hold for
// it. Bash failing on a word (failglob, `set -u`, `${x:?}`) must be a failure the domain allows. Precision is printed:
// how often the shapes are exact, and how often, with the values, they are bash's fields themselves.
// FIELDSHAPE_CASES and FIELDSHAPE_SEED change the count (CI runs a modest one) and the seed.
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fieldHolds, mayBeAssignment, mayBeName, mayGiveNone, mayNameFunction, TUPLES, mayStartWith, shapesHold, wordShapes, type Field, type Shape, type Values, type WordShapes } from '../src/semantics/fieldshape';
import { shellState } from '../src/semantics/state';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, field, fields } from '../src/syntax/tree';
import { runContained } from './support/contained';
import { fieldCases, type FieldCase } from './support/fieldshape-gen';

const parser = createUnbashParser();

/** The shapes of the argument of the last `show` of `text`. */
function shapesOf(text: string, values?: Values, opts?: { glob?: boolean }, shell: 'bash' | 'sh' = 'bash'): WordShapes | undefined {
  const tree = parser.parse(text);
  const c = descendants(tree.root, ['command']).filter((x) => field(x, 'name')?.text === 'show').pop()!;
  return wordShapes(fields(c, 'argument')[0], shellState(tree, shell), values, opts);
}

const exact = (ws: WordShapes): boolean => ws.cases.length === 1 && ws.cases[0].every((s) => 'fields' in s);
/** The fields of a word whose shapes are exact and known in full. */
const texts = (ws: WordShapes): string[] | undefined => (exact(ws) && ws.cases[0].every((s) => (s as { fields: Field[] }).fields.every((f) => f.text !== undefined))
  ? ws.cases[0].flatMap((s) => (s as { fields: Field[] }).fields.map((f) => f.text!)) : undefined);

const NAME = /^[A-Za-z_]\w*(?:\[.*\])?$/s;
const ASSIGNMENT = /^[A-Za-z_]\w*(?:\[.*\])?\+?=/s;
/** `fieldHolds`, and where it holds, that every question answered "no" holds for `t` (else `wrong` gets the question). */
function checked(wrong: string[]): (f: Field, t: string) => boolean {
  return (f, t) => {
    if (!fieldHolds(f, t)) return false;
    const say = (q: string): void => { wrong.push(`${q} of ${JSON.stringify(f)} for ${JSON.stringify(t)}`); };
    for (const c of ['-', '+', '--']) if (t.startsWith(c) && !mayStartWith(f, c)) say(`starts with ${c}`);
    if (NAME.test(t) && !mayBeName(f)) say('name');
    if (ASSIGNMENT.test(t) && !mayBeAssignment(f)) say('assignment');
    if (t !== '' && !mayNameFunction(f)) say('function');
    return true;
  };
}

/**
 * A shell word that bash reads as the glob pattern `p` (quoted characters escaped, as `Field.pattern`): each character
 * but the special ones of a pattern escaped, an extglob group kept as it is; and whether bash globs it always (`*`,
 * `?`, `[`), only with extglob (a group alone), or never. Undefined where `p` has a newline or a group not closed.
 */
function patternWord(p: string): { word: string; globs: 'always' | 'extglob' | 'never' } | undefined {
  let out = '';
  let depth = 0;
  let globs: 'always' | 'extglob' | 'never' = 'never';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '\n') return undefined;
    if (c === '\\') {
      if (i + 1 >= p.length || p[i + 1] === '\n') return undefined;
      out += c + p[++i];
    } else if ('*?['.includes(c)) {
      globs = 'always';
      out += c;
    } else if (c === ']' || (c === '(' && /(?:^|[^\\])[?*+@!]$/.test(out)) || (depth > 0 && (c === ')' || c === '|'))) {
      if (c === '(') {
        depth++;
        if (globs === 'never') globs = 'extglob';
      }
      if (c === ')') depth--;
      out += c;
    } else out += /[\w.,:/+%^@!=-]/.test(c) ? c : `\\${c}`;
  }
  return depth === 0 ? { word: out, globs } : undefined;
}

const quote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * The fields the domain knows in full before pathname expansion, with the values of the case, where one of them is a
 * pattern; with the word that gives each pattern (`patternWord`), or text.
 */
function probeOf(c: FieldCase): { fields: Field[]; words: string[]; globs: ('always' | 'extglob' | 'never')[] } | undefined {
  const pre = shapesOf(c.text, c.values, { glob: false });
  if (!pre || !exact(pre) || pre.mayFail) return undefined;
  const fs = pre.cases[0].flatMap((s) => (s as { fields: Field[] }).fields);
  if (fs.some((f) => f.text === undefined) || !fs.some((f) => typeof f.pattern === 'string')) return undefined;
  const words = fs.map((f) => (typeof f.pattern === 'string' ? patternWord(f.pattern) : { word: quote(f.text!), globs: 'never' as const }));
  if (words.includes(undefined)) return undefined;
  const ws = words as NonNullable<typeof words[number]>[];
  return { fields: fs, words: ws.map((w, i) => (w.globs === 'never' ? quote(fs[i].text!) : w.word)), globs: ws.map((w) => w.globs) };
}

describe('the field domain (fieldshape.ts)', () => {
  describe('shapes', () => {
    const one = (text: string, values?: Values): Shape[] => {
      const ws = shapesOf(`show ${text}`, values)!;
      assert.strictEqual(ws.cases.length, 1, JSON.stringify(ws));
      return ws.cases[0];
    };
    it('keeps the literal end of a quoted word: one field', () => {
      assert.deepStrictEqual(one('"$x\\n"'), [{ fields: [{ start: '', end: '\\n', head: { kind: 'text', quoted: true, empty: true } }] }]);
      assert.deepStrictEqual(one('"\\\n-v$x"'), [{ fields: [{ start: '-v', end: '', tail: { kind: 'text', quoted: true, empty: true } }] }]);
    });
    it('gives the kinds of holes', () => {
      const kinds = (text: string): string[] => one(text).map((s) => ('fields' in s ? s.fields[0] : s.first).head!.kind);
      assert.deepStrictEqual(['$#', '${#x}', '"$((x))"', '"$@"', '<(:)', '$"a"', '~'].map(kinds), [['digits'], ['digits'], ['integer'], ['text'], ['text'], ['text'], ['text']]);
    });
    it('reads `$!` alone as no field or one of digits (F62)', () => {
      assert.deepStrictEqual(one('$!'), [{ min: 0, max: 1, ...Object.fromEntries(['first', 'middle', 'last'].map((k) => [k, { start: '', end: '', head: { kind: 'digits', quoted: false, empty: false }, tail: { kind: 'digits', quoted: false, empty: false } }])) }]);
    });
    it('splits a known value by the IFS, and joins it to the text around', () => {
      assert.deepStrictEqual(one('-v$x', new Map([['x', ['a b']]])), [{ fields: [{ text: '-va', start: '-va', end: '-va' }, { text: 'b', start: 'b', end: 'b' }] }]);
      assert.deepStrictEqual(one('$x', new Map([['x', [' ']]])), [{ fields: [] }]);
      assert.deepStrictEqual(shapesOf('IFS=:; show $x', new Map([['x', ['a::']]]))!.cases[0], [{ fields: [{ text: 'a', start: 'a', end: 'a' }, { text: '', start: '', end: '' }] }]);
      assert.deepStrictEqual(shapesOf("IFS=' :'; show $x", new Map([['x', ['a : b']]]))!.cases[0], [{ fields: [{ text: 'a', start: 'a', end: 'a' }, { text: 'b', start: 'b', end: 'b' }] }]);
      assert.deepStrictEqual(shapesOf('IFS=:; show "$y"$x', new Map([['x', [':']]]))!.cases[0], [{ fields: [{ start: '', end: '', head: { kind: 'text', quoted: true, empty: true }, tail: { kind: 'text', quoted: true, empty: true } }] }]);
    });
    it('reads each tuple of values, and `${x:+w}` over a hole as `w` or nothing', () => {
      assert.deepStrictEqual(shapesOf('show ${x:+-v}')!.cases, [[{ fields: [{ text: '-v', start: '-v', end: '-v' }] }], [{ fields: [] }]]);
      assert.strictEqual(shapesOf('show $x$y', new Map([['x', ['a', 'b']], ['y', ['c', null]]]))!.cases.length, 4);
      // (Past the cap, a parameter is a hole.)
      const many = new Map(['a', 'b', 'c', 'd', 'e'].map((n) => [n, ['1', '2']]));
      assert.strictEqual(shapesOf('show $a$b$c$d$e', many)!.cases.length, TUPLES);
      // (An indirection with an operator is not read: a hole.)
      assert.strictEqual(shapesOf('show ${!x:-y}', new Map([['x', ['a']]]))!.cases.length, 1);
    });
    it('reads a word with braces on some paths only both ways', () => {
      const ws = shapesOf('if [ "$F" = 1 ]; then set +B; fi; show {a,b}')!;
      assert.deepStrictEqual(ws.cases.map((c) => c.map((s) => (s as { fields: Field[] }).fields[0].text)), [['{a,b}'], ['a', 'b']]);
    });
    it('reads a pattern as the names it may match: their known start and end', () => {
      // (A pattern stays itself where no name matches it, or gives the names it matches: what both have in common.)
      assert.deepStrictEqual(one('-v*.c'), [{ min: 1, ...Object.fromEntries(['first', 'middle', 'last'].map((k) => [k, { start: '-v', end: '.c' }])) }]);
      const start = (text: string, values?: Values, pre = ''): string => ((s) => ('fields' in s ? s.fields[0] : s.first).start)(shapesOf(`${pre}show ${text}`, values)!.cases[0][0]);
      const x = (v: string): Values => new Map([['x', [v]]]);
      assert.deepStrictEqual([
        start('$x', x('\\-v*')), start('$x', x('-V*'), 'shopt -s nocaseglob; '), start('$x', x('-@(v)*'), 'shopt -s extglob; '), start('a[b]c'),
        start('$x', x('a\\')), start('$x"*"', x('a\\')), start('$x', x('a+(b')), start('$x', x('a+(b'), 'shopt -s extglob; '), start('$x', x('a[\\]b]*')),
      ], ['', '-', '-', 'a', 'a\\', 'a\\', 'a+(b', 'a', 'a']);
      // (`\-v*` matches `-vu`, F63; `-V*` with nocaseglob, F64; `!(zz)` with extglob, F65; a `\` at the end of a value quotes what follows.)
      const holds = (text: string, fields: string[], values?: Values, pre = ''): boolean => shapesHold(shapesOf(`${pre}show ${text}`, values)!, fields);
      assert.deepStrictEqual([
        holds('$x', ['-vu'], x('\\-v*')), holds('$x', ['\\-v*'], x('\\-v*')), holds('$x', ['-vu'], x('-V*'), 'shopt -s nocaseglob; '), holds('$x', ['-vu'], x('-V*')),
        holds('$x', ['-vu'], x('!(zz)'), 'shopt -s extglob; '), holds('$x', ['-vu'], x('!(zz)')), holds('$1"*"', ['\\-vu']), holds('"$x"', ['-vu'], x('-v*')),
        holds('$y$x', ['a\\b'], x('\\*')), holds('$x', ['ab'], x('\\a\\*')), holds('$x\\*', ['a\\*'], x('a\\')), holds('$x', ['vu'], x('\\V*'), 'shopt -s nocaseglob; '),
      ], [true, true, true, false, true, false, true, false, true, false, true, true]);
      assert.deepStrictEqual(one('[ab'), [{ fields: [{ text: '[ab', start: '[ab', end: '[ab' }] }]);
      assert.deepStrictEqual([holds('x*', [], undefined, 'shopt -s nullglob; '), holds('x*', []), holds('~*', [], undefined, 'shopt -s nullglob; '), holds('~*', [])], [true, false, true, false]);
    });
    it('joins the descriptions of runs that may be empty', () => {
      const holds = (text: string, k: string, fields: string[], pre = ''): boolean => shapesHold(shapesOf(`${pre}show ${text}`, new Map([['k', [k]], ['y', ['ab*']]]))!, fields);
      // (Sound, not exact: the last field of `${!}x${!}` joins `x` and digits, and keeps no end; an empty head bounds nothing.)
      assert.deepStrictEqual([
        holds('${!}x$k${!}', ' ', ['x']), holds('${!}x$k${!}', ' ', ['12x', '12']), holds('${!}x$k${!}', ' ', ['x', '']), holds('${!}x$k${!}', ' ', ['ax']),
        holds('$!$k$#', ' ', ['3']), holds('${!}$k$((x))', ' ', ['-1'], 'set -f; '), holds('$!$k$#', ' ', ['12', '3']), holds('$!$k$#', ' ', ['a']), holds('$!$k${#x}', ' ', ['1', '2', '3']),
        holds('ab$k*', ' ', ['ab'], 'shopt -s nullglob; '), holds('ab$k*', ' ', ['ab', 'f', 'g'], 'shopt -s nullglob; '), holds('ab$k*', ' ', [], 'shopt -s nullglob; '),
        holds('$k$y', 'a b', ['a', 'bab*']), holds('$k$y', 'a b', ['a', 'babx']), holds('$k$y', 'a b', ['a', 'b']), holds('$k$!$k', 'a b', ['a', 'ba', 'b']),
      ], [true, true, true, true, true, true, true, false, false, true, true, false, true, true, false, true]);
      // (Digits and an integer join as an integer; digits and text as text.)
      const head = (text: string): string => (shapesOf(`set -f; show ${text}`, new Map([['k', [' ']]]))!.cases[0][0] as { first: Field }).first.head!.kind;
      assert.deepStrictEqual([head('${!}$k$((1))'), head('${!}$k$"a"')], ['integer', 'text']);
    });
    it('keeps the text around a hole that may split', () => {
      const s = one('-v$x"\\n"$k', new Map([['k', [' u']]]))[0];
      assert.deepStrictEqual([s.hasOwnProperty('min'), (s as { first: Field }).first.start, (s as { last: Field }).last.text], [true, '-v', 'u']);
      const t = shapesOf('IFS=:; show :$x"a"')!.cases[0][0] as { min: number; first: Field; last: Field };
      assert.deepStrictEqual([t.min, t.first.start, t.last.end], [1, ':', 'a']);
      assert.deepStrictEqual(shapesOf('show $x$k', new Map([['k', ['a ']]]))!.cases[0][0].hasOwnProperty('min'), true);
      // (With an IFS not known, a known value is a hole.)
      assert.strictEqual(shapesOf('if [ "$F" = 1 ]; then IFS=:; fi; show -v$k', new Map([['k', ['a']]]))!.cases[0][0].hasOwnProperty('min'), true);
      assert.strictEqual(shapesOf('IFS=$\'\\u00e9\'; show -v$k', new Map([['k', ['a']]]))!.cases[0][0].hasOwnProperty('min'), true);
      // (A `$#` splits where IFS holds a digit, `$(( ))` where it holds `-`.)
      const open = (t: string): boolean => ((s) => !('fields' in s) && s.max === undefined)(shapesOf(t)!.cases[0][0]);
      assert.deepStrictEqual(['IFS=1; show $#', 'IFS=-; show $((x))', 'set -f; IFS=; show $x', 'IFS=-; show $#'].map(open), [true, true, false, false]);
    });
    it('reads `"$@"` as no field or many, joined to the text around', () => {
      assert.deepStrictEqual(shapesOf('show "-v$@"')!.cases[0][0].hasOwnProperty('min'), true);
      assert.deepStrictEqual(shapesOf('x="$@"; show $x')!.cases.length, 1);
      assert.deepStrictEqual(shapesOf('IFS=; show "$@"')!.cases[0][0].hasOwnProperty('min'), true);
    });
    it('gives one field in a context of one field, and nothing outside a word', () => {
      const tree = parser.parse('x=$y; show');
      const model = shellState(tree, 'bash');
      const value = descendants(tree.root, ['variable_assignment'])[0];
      assert.deepStrictEqual(wordShapes(field(value, 'value')!, model)!.cases, [[{ fields: [{ start: '', end: '', head: { kind: 'text', quoted: false, empty: true }, tail: { kind: 'text', quoted: false, empty: true } }] }]]);
      assert.strictEqual(wordShapes(field(value, 'name')!, model), undefined);
    });
    it('gives nothing for a shell other than bash, or brace words not known', () => {
      assert.strictEqual(shapesOf('show $x', undefined, undefined, 'sh'), undefined);
      assert.strictEqual(shapesOf('show $x{a,b}'), undefined);
    });
    it('says where bash may fail on the word', () => {
      assert.deepStrictEqual([shapesOf('show ${x:?}')!.mayFail, shapesOf('show $x')!.mayFail, shapesOf('set -u; show $x', new Map([['x', [null]]]))!.cases.length], [true, false, 0]);
      // (Also inside another expansion under `set -u`, and on an arithmetic error, an offset, an indirection, a subscript.)
      const fails = (t: string): boolean => shapesOf(t)!.mayFail;
      assert.deepStrictEqual(['set -u; show "$(( ${#x} ))"', 'if [ "$F" = 1 ]; then set -u; fi; show $x', 'show $((x))', 'show ${x:1}', 'show ${!x}', 'show ${!x*}', 'show ${a[1]}', 'show "${a[@]}"', 'show ${x:-y}', 'show ${!x:-y}'].map(fails),
        [true, true, true, true, true, false, true, false, false, true]);
      // (`${x:=w}` where `x` cannot be assigned; a transformation bash does not have; a case operator on a special parameter.)
      assert.deepStrictEqual(['show ${x:=a}', 'show ${1:=a}', 'readonly x; show ${x=a}', 'show ${x@Q}', 'show ${x@Z}', 'show ${#^^}', 'show ${x^^}', 'show ${#:+x}'].map(fails),
        [false, true, true, false, true, true, false, false]);
    });
    it('reads `$#` and a length as digits only where no operator changes them', () => {
      const one1 = (t: string): Field => ((s) => ('fields' in s ? s.fields[0] : s.first))(shapesOf(`set -f; show ${t}`)!.cases[0][0]);
      // (With one element, `${#:+-v}` is `-v`, `${#/#/-}` is `-1`, `${##1}` is nothing, `${#@Q}` is `'1'`.)
      assert.deepStrictEqual(['$#', '${#}', '${##}', '${#x}', '${#-x}', '$?', '${$}', '${!}'].map((t) => one1(t).head?.kind), ['digits', 'digits', 'digits', 'digits', 'digits', 'digits', 'digits', 'digits']);
      assert.deepStrictEqual(['${#:+-v}', '${#/#/-}', '${##1}', '${#@Q}', '${#x[1]}'].map((t) => [mayStartWith(one1(t), '-'), mayGiveNone(shapesOf(`show ${t}`)!)]),
        [[true, true], [true, true], [true, true], [true, true], [false, false]]);
    });
    it('takes no value for a special or positional parameter, one bash sets, an array, a nameref, nor one the word assigns', () => {
      const given = (text: string, name: string): number => shapesOf(text, new Map([[name, ['-v']]]))!.cases.filter((c) => c.every((s) => 'fields' in s && s.fields.every((f) => f.text !== undefined))).length;
      assert.deepStrictEqual([given('show "$x"', 'x'), given('show "$RANDOM"', 'RANDOM'), given('show "$_"', '_'), given('show "$1"', '1'), given('declare -n x=y; show "$x"', 'x'),
        given('x=(a); show "$x"', 'x'), given('declare -i x; show "$x"', 'x'), given('source "$f"; show "$x"', 'x'), given('show "${x:=a}$x"', 'x')], [1, 0, 0, 0, 0, 0, 0, 0, 0]);
    });
    it('splits the parts after `"$@"` in the same quotes, but a variable alone (F75)', () => {
      const t = (text: string): boolean => shapesHold(shapesOf(`IFS=:; x=a:b; show ${text}`, new Map([['x', ['a:b']]]))!, ['p', 'a', 'b']);
      assert.deepStrictEqual([t('"$@${x:+a:b}"'), t('"$@$x"'), t('"$@${#x}"')], [true, false, false]);
      assert.strictEqual(shapesHold(shapesOf('IFS=1; show "$@${#x}"', new Map([['x', ['1']]]))!, ['p']), true);
      // (F84: `$(( ))` anywhere in those quotes, `"$((-1))$@"` with `IFS=-` and no element is an empty field and `1`.)
      assert.deepStrictEqual([shapesHold(shapesOf('IFS=-; show "$((-1))$@"')!, ['', '1']), shapesHold(shapesOf('IFS=-; show "$((-1))$x"')!, ['', '1'])], [true, false]);
    });
    it('does not know the words the word model reads otherwise than bash', () => {
      assert.deepStrictEqual(['~\\\n', '"$y\\\na"', '$\\\n{x}', '$x\\\n{a,b}','a<(:)', '<(:)a', '1<(:)"x"', '<(:)\\\n$x','$${1..2}', '$$$${a,b}', 'a{Z..a}', '{a..c}{Z..a}', '$_{a,b}'].map((t) => shapesOf(`show ${t}`)), Array(13).fill(undefined));
      // (The word after a process substitution and a line continuation, which the parser reads as two.)
      const joined = parser.parse('show <(:)\\\n$x');
      assert.strictEqual(wordShapes(fields(descendants(joined.root, ['command'])[0], 'argument')[1], shellState(joined, 'bash')), undefined);
      assert.deepStrictEqual(['$$${x}','{a..c}', '<(:)', '~/a', '$y-a'].map((t) => !!shapesOf(`show ${t}`)), [true, true, true, true, true]);
      // (An IFS with a control character, `\v`; with a glob character, where a value has a backslash.)
      assert.deepStrictEqual([shapesOf("IFS=$'\\v'; show $x"), shapesOf("IFS='*'; show $x", new Map([['x', ['a\\*b']]])), !!shapesOf("IFS='*'; show $x"), !!shapesOf("IFS=$'\\v'; show \"$x\"")],
        [undefined, undefined, true, true]);
      // (F81: a quoted glob character or part not known, where IFS may hold a glob character; F83: `"$@"` and a quoted backslash, where IFS may hold one.)
      assert.deepStrictEqual(["IFS='*'; show '*'*", "IFS='*'; show \"$x\"*", 'if [ "$F" = 1 ]; then IFS=:; fi; show "$x"*', "IFS='\\\\'; show \"$@\\\\n\"", "IFS='\\\\'; show \"$@$x\""].map((t) => shapesOf(t)), Array(5).fill(undefined));
      assert.deepStrictEqual(["IFS='*'; show '?'*", "IFS='\\\\'; show \"x\\\\n\"", "IFS=':'; show \"$@\\\\n\""].map((t) => !!shapesOf(t)), [true, true, true]);
    });
    it('reads a hole whose word has quotes as one that may give an empty field, and none in quotes with `"$@"`', () => {
      // (`${x+"$y"}` with `y` unset gives the quoted null; `"$!${a[@]}"` with no `&` and no element gives nothing.)
      assert.deepStrictEqual([shapesHold(shapesOf('IFS=; show ${x+"$y"}')!, ['']), mayGiveNone(shapesOf('show "$!${a[@]}"')!), shapesHold(shapesOf('show $a${x+""}$b', new Map([['a', ['p ']], ['b', [' q']]]))!, ['p', '', 'q'])], [true, true, true]);
    });
    it('marks the patterns before pathname expansion', () => {
      const pre = (text: string, values?: Values): (string | true | undefined)[] => shapesOf(`show ${text}`, values, { glob: false })!.cases[0].flatMap((s) => ('fields' in s ? s.fields : [s.first]).map((f) => f.pattern));
      assert.deepStrictEqual([pre('a*"*"'), pre('a$x'), pre('"$x"'), pre('*$!'), pre('$x', new Map([['x', ['a b*']]]))], [['a*\\*'], [true], [undefined], [true], [undefined, 'b*']]);
      assert.deepStrictEqual(shapesOf('set -f; show *', undefined, { glob: false })!.cases[0], [{ fields: [{ text: '*', start: '*', end: '*' }] }]);
      // (A quoted `-` in brackets is escaped; a field that only an empty hole may give is still marked.)
      assert.deepStrictEqual([pre('[a"-"c]'), (shapesOf('IFS=; show $x', undefined, { glob: false })!.cases[0][0] as { first: Field }).first.pattern], [['[a\\-c]'], true]);
    });
    it('lists the names of `${!x@}` and does not fail on them; fails on `${x@}` and `${!x@Q}` (F85)', () => {
      const ws = (t: string): WordShapes => shapesOf(`show ${t}`)!;
      assert.deepStrictEqual(['${!z@}', '"${!z@}"', '${!z*}', '${x@}', '${!x@Q}', '${x@QE}', '${!a[@]@}', '${x@Q}'].map((t) => ws(t).mayFail), [false, false, false, true, true, true, true, false]);
      assert.deepStrictEqual([shapesHold(ws('"${!B@}"'), ['BASH', 'BASHOPTS']), shapesHold(ws('"${!B@}"'), [])], [true, true]);
    });
    it('says bash may fail on `:=` of what it keeps (F86)', () => {
      const fails = (t: string): boolean => shapesOf(t)!.mayFail;
      assert.deepStrictEqual(['show ${FUNCNAME:=a}', 'show ${BASH_ARGV=a}', 'show ${GROUPS:=a}', 'show ${x[@]:=a}', 'declare -i x; show ${x:=a}', 'show ${x:=a}'].map(fails),
        [true, true, true, true, true, false]);
    });
    it('takes no value for a variable the word may assign by arithmetic (F87)', () => {
      const v = new Map([['x', ['a']], ['z', ['bcd']]]);
      // (bash: `x=a; z=bcd; ${z:x=1}$x` is `cd1`, `${z[x=2]}$x` is `2`.)
      assert.deepStrictEqual([shapesHold(shapesOf('show ${z:x=1}$x', v)!, ['cd1']), shapesHold(shapesOf('show ${z[x=2]}$x', v)!, ['2']), shapesHold(shapesOf('show ${z:0:x=2}$x', v)!, ['bc2'])], [true, true, true]);
      // (Arithmetic that names nothing assigns nothing: the value is still taken.)
      assert.deepStrictEqual(texts(shapesOf('show ${z:1}$x$((1+1))', v)!) ?? texts(shapesOf('set -f; show ${z:1}$x', v)!), ['cda']);
      assert.strictEqual(shapesOf('show $x${z:1}', v)!.cases[0].length, 1);
    });
    it('does not know a word that may assign IFS, and splits by an IFS not known where its arithmetic may (F88, F89)', () => {
      assert.deepStrictEqual(['unset IFS; show ${IFS=:}$x', 'show ${IFS:=:}', 'show ${!y=1}$x', 'declare -n r=IFS; show ${r:=1}', 'show $x${y@P}', 'show $x${!y@P}'].map((t) => shapesOf(t)), Array(6).fill(undefined));
      // (bash: `set -f; x='a b'; $x$((IFS=1))` is one field, `a b`; with `y='IFS=1'`, `x=a1b; $x$((y))` is `a`, `b`, and so are
      // `$x${!y}` with `y='a[IFS=1]'`, `$x$r` with `declare -n r='a[IFS=1]'`, and `$x${i:=IFS=1}` with `declare -i i`.)
      const holds = (t: string, fields: string[]): boolean => shapesHold(shapesOf(`set -f; x='a b'; show ${t}`, new Map([['x', ['a b']]]))!, fields);
      assert.deepStrictEqual([holds('$x$((IFS=1))', ['a b']), holds('$x$((y))', ['a b']), holds('$x${!y}', ['a b']), holds('$x${a[y]}', ['a b']), holds('$x${z:y}', ['a b']), holds('$x$[y]', ['a b'])],
        [true, true, true, true, true, true]);
      // (F95: text before the assignment that the new IFS holds splits too, `a1b$((IFS=1))` is `a`, `b`; F96: text that IFS
      // holds is quoted, `*b$x` with `IFS='*'` is no pattern.)
      assert.deepStrictEqual(['a1b$((IFS=1))', '{1..2}$((IFS=1))', '-$((x))', "IFS='*'; show *b$x", "IFS='('; shopt -s extglob; show @(b)$x", "IFS=-; show [a-c]$x"].map((t) => shapesOf(t.includes('show') ? t : `show ${t}`)), Array(6).fill(undefined));
      assert.deepStrictEqual(["'1'$((IFS=1))", '$((IFS=1))', "IFS='*'; show *b", "IFS=-; show a-$x*", "IFS=:; show a:$x*"].map((t) => !!shapesOf(t.includes('show') ? t : `show ${t}`)), [true, true, true, true, true]);
      // (Through an element, `${!a[1]}`; twice, `$((x))$((y))`; after a word that may assign IFS otherwise.)
      assert.deepStrictEqual([holds('$x${!a[1]}', ['a b']), holds('$x$((y))$((z))', ['a b']), holds('$x${!a[@]}', ['a b']), shapesOf('show ${IFS=1}$((x))')], [true, true, false, undefined]);
      assert.deepStrictEqual([shapesHold(shapesOf('declare -n r; show $x$r')!, ['a', 'b']), shapesHold(shapesOf('declare -i i; set -f; show $x${i:=IFS=1}', new Map([['x', ['a1b']]]))!, ['a', 'b'])], [true, true]);
      // (Arithmetic that names nothing, `$((-1))`, splits by the IFS as it is; with digits and `-` in IFS, a quoted glob character is not known, F81.)
      assert.deepStrictEqual([holds('$x$((-1))', ['a b-1']), !!shapesOf("IFS=1; show '*'$((x))"), !!shapesOf("show '*'$((x))"), !!shapesOf("IFS='*'; show '1'$((x))")], [false, true, true, true]);
    });
    it('does not know a tilde or a `$` before a line continuation, a range with a `+` step across `\\`, an extglob group with quotes or expansions, `${ cmd; }` (F90 to F93)', () => {
      assert.deepStrictEqual(['a=~\\\n/x', 'x=a:~\\\n/x', '$\\\n@', '$\\\n#', '$\\\n((1+1))', "$\\\n'a'", '{Z..a..+2}', 'x@(${x})y', '+($x)', "@(a'|'b)", '@(a"|"b)', '@($(echo))', '${ echo; }', '${| REPLY=a; }'].map((t) => shapesOf(`shopt -s extglob\nshow ${t}`)),
        Array(14).fill(undefined));
      assert.deepStrictEqual(['@(a|b)', '@(a\\|b)', '{a..e..+2}', '$x\\\n/', 'a$', '$(echo)x'].map((t) => !!shapesOf(`shopt -s extglob\nshow ${t}`)), [true, true, true, true, false, true]);
      assert.deepStrictEqual(shapesOf('shopt -s extglob\nshow @(a\\|b)', undefined, { glob: false })!.cases[0], [{ fields: [{ text: '@(a|b)', start: '@(a|b)', end: '@(a|b)', pattern: '@(a\\|b)' }] }]);
    });
    it('reads a `/` next to a special character as special where globstar may be on (F94)', () => {
      const holds = (t: string, fields: string[], pre = 'shopt -s globstar; '): boolean => shapesHold(shapesOf(`${pre}show ${t}`, new Map([['x', ['d/**/x']]]))!, fields);
      assert.deepStrictEqual([holds('d/**/x', ['d/x']), holds('**/x', ['x']), holds('$x', ['d/x']), holds('d/**/x', ['d/x'], ''), holds('/a/**', ['/a/']), holds('/a*', ['/b'])], [true, true, true, false, true, false]);
    });
    it('reads the operand of an expansion with its quotes (`"${x:-\'a\'}"` keeps them)', () => {
      assert.deepStrictEqual(texts(shapesOf('show "${x:-\'a\'}"', new Map([['x', [null]]]))!), ["'a'"]);
    });
    it('says whether a word may give no field', () => {
      assert.deepStrictEqual(['$x', '"$x"', '"$@"', '$x$y', 'a'].map((t) => mayGiveNone(shapesOf(`show ${t}`)!)), [true, false, true, true, false]);
    });
  });

  describe('questions', () => {
    const f = (start: string, end: string, head?: Field['head'], tail?: Field['tail']): Field => ({ start, end, ...(head ? { head } : {}), ...(tail ? { tail } : {}) });
    const digits = { kind: 'digits' as const, quoted: false, empty: false };
    const integer = { kind: 'integer' as const, quoted: false, empty: false };
    it('may equal', () => {
      assert.deepStrictEqual([fieldHolds({ text: 'a', start: 'a', end: 'a' }, 'a'), fieldHolds(f('-v', '\\n'), '-v\\n'), fieldHolds(f('-v', 'v'), '-v'), fieldHolds(f('', 'x', digits), 'x'),
        fieldHolds(f('', 'x', digits), 'ax'), fieldHolds(f('', '', digits, digits), '12'), fieldHolds(f('a', '', undefined, digits), 'a'), fieldHolds(f('a', '', undefined, digits), 'ab'), fieldHolds(f('a', 'b'), 'cb')],
      [true, true, false, false, false, true, false, false, false]);
    });
    it('may start with', () => {
      assert.deepStrictEqual([mayStartWith({ text: '-a', start: '-a', end: '-a' }, '-'), mayStartWith(f('-v', ''), '-'), mayStartWith(f('v', ''), '-'), mayStartWith(f('', '', digits), '-'),
        mayStartWith(f('', '', integer), '-'), mayStartWith(f('', 'x'), '-'), mayStartWith(f('-', ''), '--'), mayStartWith(f('', '', { ...digits, empty: true }), '-')],
      [true, true, false, false, true, true, true, true]);
    });
    it('may be a name', () => {
      assert.deepStrictEqual([mayBeName({ text: 'a[1]', start: 'a[1]', end: 'a[1]' }), mayBeName(f('', '\\n')), mayBeName(f('-v', '')), mayBeName(f('a.', '')), mayBeName(f('a[.', '')),
        mayBeName(f('', '', digits, digits)), mayBeName(f('a', 'b')), mayBeName(f('', ']'))],
      [true, false, false, false, true, false, true, true]);
    });
    it('may be an assignment', () => {
      assert.deepStrictEqual([mayBeAssignment({ text: 'a+=1', start: 'a+=1', end: 'a+=1' }), mayBeAssignment(f('a', '\\n')), mayBeAssignment(f('a+', '')), mayBeAssignment(f('a+b', '')),
        mayBeAssignment(f('a[', '')), mayBeAssignment(f('1', '')), mayBeAssignment(f('', '', integer)), mayBeAssignment(f('', '')), mayBeAssignment(f('a.', ''))],
      [true, true, true, false, true, false, false, true, false]);
    });
    it('may name a function', () => {
      assert.deepStrictEqual([mayNameFunction({ text: '', start: '', end: '' }), mayNameFunction({ text: 'f.', start: 'f.', end: 'f.' }), mayNameFunction(f('', ''))], [false, true, true]);
    });
    it('fits fields to shapes', () => {
      const ws = shapesOf('show a{b,c}$x')!;
      assert.deepStrictEqual([shapesHold(ws, ['ab', 'ac']), shapesHold(ws, ['ab', 'ac', 'z', 'q']), shapesHold(ws, ['ab']), shapesHold(ws, ['ac', 'ab'])], [true, true, false, false]);
      const bang = shapesOf('show $!')!;
      assert.deepStrictEqual([shapesHold(bang, []), shapesHold(bang, ['12']), shapesHold(bang, ['1', '2'])], [true, true, false]);
    });
  });

  describe('against bash', function () {
    this.timeout(600000);
    const count = Number(process.env.FIELDSHAPE_CASES ?? 400);
    const seed = Number(process.env.FIELDSHAPE_SEED ?? 20261030);
    const cases = fieldCases(count, seed);
    /** What bash gave each case: its fields, or none where it failed on the word. */
    /** What bash gave each case: its fields, none where it failed on the word, null where it failed before the word. */
    const ran: (string[] | undefined | null)[] = [];
    /** The same, with `set -f` just before `show` (a line the model does not read): the fields before pathname expansion. */
    const unglobbed: (string[] | undefined | null)[] = [];
    /** The patterns the domain gives before pathname expansion, where it knows each field (`probeOf`), and what bash matches with each. */
    const probes = cases.map((c) => probeOf(c));
    const matched: (string[][] | undefined)[] = [];
    let dir = '';
    before(async () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldshape-'));
      const BATCH = 50;
      for (let from = 0; from < cases.length; from += BATCH) {
        const batch = cases.slice(from, from + BATCH);
        const env: Record<string, string> = {};
        const script = ["show() { printf 'S\\0'; for a; do printf 'F%s\\0' \"$a\"; done; }", ...batch.flatMap((c, k) => {
          const d = path.join(dir, `c${from + k}`);
          fs.mkdirSync(d);
          for (const f of c.files) {
            fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
            fs.writeFileSync(path.join(d, f), '');
          }
          Object.assign(env, c.env);
          // (A word with an extglob group parses only with extglob on: on before the case, which starts with it on, F91.)
          const run = (text: string, extglob = c.extglob): string => `${extglob ? 'shopt -s extglob\n' : ''}printf '\\001C\\0'; ( cd ${JSON.stringify(d)} || exit\n${c.hidden}\n${text})${extglob ? '\nshopt -u extglob' : ''}`;
          // (The text ends with `show WORD`.)
          const at = c.text.length - `show ${c.word}\n`.length;
          const ready = `${c.text.slice(0, at)}printf 'R\\0'\n`;
          const probe = probes[from + k];
          // (Each pattern alone, with nullglob: the names bash matches with it; none with `set -f`, `N`.)
          const patterns = probe && run(`${c.extglob ? '' : 'shopt -u extglob\n'}${ready}case $- in *f*) printf 'N\\0';; esac\nshopt -q extglob && printf 'E\\0'\nshopt -s nullglob; shopt -u failglob\n${probe.words.map((w) => `show ${w}\n`).join('')}`, true);
          return [run(`${ready}${c.text.slice(at)}`), run(`${ready}set -f\n${c.text.slice(at)}`), patterns ?? "printf '\\001C\\0'"];
        })].join('\n');
        const file = path.join(dir, `batch${from}.sh`);
        fs.writeFileSync(file, script);
        const r = await runContained(['bash', '--norc', file], dir, env, 60000);
        const runs = r.stdout.split('\x01C\0').slice(1);
        assert.strictEqual(runs.length, 3 * batch.length, r.stderr);
        runs.forEach((out, k) => {
          const parts = out.split('\0').slice(0, -1);
          if (k % 3 === 2) {
            const each: string[][] = [];
            for (const p of parts.slice(1)) {
              if (p === 'S') each.push([]);
              else if (p.startsWith('F')) each[each.length - 1].push(p.slice(1));
            }
            // (With extglob off, a group alone is no pattern: such a field is not checked.)
            const extglobOn = parts.includes('E');
            matched.push(parts[0] !== 'R' || parts[1] === 'N' || probes[from + Math.floor(k / 3)]!.globs.some((g) => g === 'extglob' && !extglobOn) ? undefined : each);
          } else (k % 3 ? unglobbed : ran).push(parts[0] !== 'R' ? null : parts[1] === 'S' ? parts.slice(2).map((p) => p.slice(1)) : undefined);
        });
      }
    });
    after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

    it('gives shapes that hold bash\'s fields, and questions that hold for them', () => {
      const wrong: string[] = [];
      const stats = { cases: cases.length, unknown: 0, failed: 0, exactCount: 0, exactValues: 0, patterns: 0 };
      cases.forEach((c: FieldCase, i) => {
        const got = ran[i];
        // (A case whose setup failed, `set -u` with `RANDOM=…`, says nothing.)
        if (got === null) return;
        const where = `${JSON.stringify(c.hidden)}\n${JSON.stringify(c.text)} in ${JSON.stringify(c.files)}, env ${JSON.stringify(c.env)}`;
        for (const values of [undefined, c.values]) {
          const ws = shapesOf(c.text, values);
          if (!ws) {
            if (!values) stats.unknown++;
            continue;
          }
          if (!got) {
            if (!values) stats.failed++;
            if (!ws.mayFail) wrong.push(`bash failed, the domain says it cannot: ${where}`);
            continue;
          }
          // (A word that may give no field: `mayGiveNone`; before pathname expansion, the fields with `set -f`, and where no
          // field may be a pattern, the same fields as with globbing.)
          if (!got.length && !mayGiveNone(ws)) wrong.push(`no field, the domain says there is one: ${where}`);
          const pre = shapesOf(c.text, values, { glob: false })!;
          const flat = unglobbed[i];
          if (flat && !shapesHold(pre, flat)) wrong.push(`${JSON.stringify(flat)} (set -f) not in ${JSON.stringify(pre.cases)}: ${where}`);
          const marked = pre.cases.flat().flatMap((s) => ('fields' in s ? s.fields : [s.first, s.middle, s.last])).some((f) => f.pattern !== undefined);
          // (Not where the word reads what `set -f` changes: `$-`, `$_`, `$LINENO`, `$!`, or what changes by itself.)
          const moving = /\$\{?(?:[-_!]|LINENO|RANDOM|SECONDS)/.test(c.word);
          if (flat && !marked && !moving && JSON.stringify(flat) !== JSON.stringify(got)) wrong.push(`no pattern, but globbing changed ${JSON.stringify(flat)} into ${JSON.stringify(got)}: ${where}`);
          // (The patterns, where the domain knows each field: bash's fields are the names each matches, or where it
          // matches none, the field itself or nothing, nullglob.)
          const probe = probes[i];
          const names = matched[i];
          if (values && probe && names) {
            stats.patterns++;
            const fits = (k: number, from: number): boolean => {
              if (k === names.length) return from === got.length;
              const alts = probe.globs[k] !== 'never' && !names[k].length ? [[probe.fields[k].text!], []] : [names[k]];
              return alts.some((a) => JSON.stringify(got.slice(from, from + a.length)) === JSON.stringify(a) && fits(k + 1, from + a.length));
            };
            if (!fits(0, 0)) wrong.push(`${JSON.stringify(got)}: not what the patterns ${JSON.stringify(probe.words)} match, ${JSON.stringify(names)}: ${where}`);
          }
          const questions: string[] = [];
          if (!shapesHold(ws, got, checked(questions))) wrong.push(`${JSON.stringify(got)} not in ${JSON.stringify(ws.cases)}${values ? ' (with values)' : ''}: ${where}`);
          wrong.push(...questions.map((q) => `${q}: ${where}`));
          if (!values && exact(ws)) stats.exactCount++;
          if (values && JSON.stringify(texts(ws)) === JSON.stringify(got)) stats.exactValues++;
        }
      });
      // (Precision, for the record: shapes with an exact count, every part a hole; bash's fields themselves, with the values.)
      console.log(`      fieldshape: ${JSON.stringify(stats)}`);
      assert.deepStrictEqual(wrong.slice(0, 10), []);
    });
  });
});

