// The languages written inside a command's words (docs/design/analyzer.md, step 6): a regex, a sed script, an awk
// program, a jq or yq filter, a glob of find, a printf, date or git format, the escapes of `$'…'`. The explainers are
// in src/embedded/ (src/embedded/registry.ts); this module gives them the command whose words are explained
// (`Explainer.command`: the regex flavour, tr's sets, the letters given), places their tokens in the source, and adds
// the worked example of the text (src/explain/examples.ts, src/explain/examples-jq.ts).
import type { ExampleKind, Span, Token } from '../analyzer-types';
import { givenOptions, values } from '../argv/query';
import { DEFAULT_BASH_VERSION } from '../bashversion';
import { YQ_SPECS } from '../dict/yq';
import { explainEscapes } from '../embedded/format';
import { type Embedded, EMBEDDED, type EmbeddedContext } from '../embedded/registry';
import { hasHole, HOLES, isHole, type EmbeddedLang, type EmbeddedToken, type HoleMark } from '../embedded/types';
import { codeSpan } from '../label';
import { countIn } from '../semantics/argwords';
import { givesElements, joinsElements } from '../semantics/elements';
import { awkExample } from '../examples/awk';
import { dateExample, gitLogExample } from '../examples/commands';
import { jqReadsInputs } from '../examples/jqsample';
import { grepWrap, literalRegex, toJsRegex } from '../examples/regex';
import type { RerunSpec } from '../examples/rerun';
import { sedExample, sedPattern } from '../examples/sed';
import { NO_INPUT } from '../examples/source';
import { featureWorks } from '../shellfeatures';
import { holedContent, type Literal, literalContent, literalOfMapped, removedBackslashes, sourceIndex, staticWordText } from '../staticword';
import type { SyntaxNode } from '../syntax/tree';
import { type Explainer, memoKey } from './context';
import { awkOptions, dateRun, globExample, guardedExample, inputSource, ioExample, pushExample, regexExample, sedScripts } from './examples';
import { jqExamples, jqFormat, jqVars, yqExample } from './examples-jq';
import { fromEmbedded, same, sourcePos } from './nodes';
import { invalidHow } from '../arith';
import { given, regexFlavor, trContext } from './reads';
import { hostString } from './hoststrings';
import { valueNote } from './words';

/** What a reader made of a word: its tokens, a note on the whole, and the source of the holes it read (`holedWord`). */
export interface EmbeddedReading { tokens: Token[]; note?: string; holes?: Span[] }

/**
 * Explain the contents of a quoted or plain word written in another language (a regex, a sed script…), as the command
 * is given it: the text after quote removal (`literalContent`), whose tokens are placed over the source, escapes
 * included. A word with an expansion in double quotes is read with the expansion as a hole (`holedWord`).
 */
export function embedded(cx: Explainer, a: SyntaxNode, lang: EmbeddedLang): EmbeddedReading | undefined {
  const lit = literalContent(a) ?? holedWord(cx, a);
  return lit && embeddedText(cx, lit, lang, a);
}

/**
 * The text of a word that gives one field, with each expansion in its double quotes as a hole (`holedContent`). Not where
 * no shell reads the words (Docker's exec form), where `$x` is text; nor for what may give several words (the fields model:
 * `countIn`); nor for what a host pastes before the shell reads the line (`hostPasted`), which may close the quotes.
 */
function holedWord(cx: Explainer, a: SyntaxNode): Literal | undefined {
  if (cx.state.noShell || countIn(a, cx.state)) return undefined;
  const pasted = cx.opts.hostPasted;
  return holedContent(a, (n) => !givesElements(n) && !joinsElements(n) && ![...n.text.matchAll(/\$\{?([A-Za-z_]\w*)/g)].some((m) => pasted?.includes(m[1])));
}

/**
 * Explain the value of an assignment that bash reads in a language of its own when it uses it (a prompt string,
 * `PS1='\u@\h:\w\$ '`): its text after quote removal, when that is known (`"\[\e[1m\]\u"`, but not `"$USER"`).
 */
export function embeddedValue(cx: Explainer, value: SyntaxNode, lang: EmbeddedLang): { tokens: Token[]; note?: string } | undefined {
  const m = staticWordText(value, cx.shell);
  return m && embeddedText(cx, literalOfMapped(m, value), lang, value);
}

/** Explain `lit.text`, which sits inside `a` as `lit` describes (e.g. after `-k` in `-k3,3n`). */
export function embeddedText(cx: Explainer, lit: Literal, lang: EmbeddedLang, a: SyntaxNode): EmbeddedReading | undefined {
  return cx.examplesAt(a, () => embeddedTextInner(cx, lit, lang, a));
}

function embeddedTextInner(cx: Explainer, lit: Literal, lang: EmbeddedLang, a: SyntaxNode): EmbeddedReading | undefined {
  // (A line the tool refuses runs no program: `grep -E -F PATTERN` reads the pattern in no flavour.)
  if (cx.command?.parse.refused) return undefined;
  // (A text that holds what a hole is written as, with no hole: nothing says which it is.)
  if (!lit.holes && hasHole(lit.text)) return undefined;
  const ecx: EmbeddedContext = {
    lang: cx.lang,
    flavor: () => regexFlavor(cx, cx.command!.nodes.findIndex((w) => same(w, a))),
    trSet: () => trContext(cx, a),
    // The letters given (`-lane`: l, a, n and e; `-pi.bak`: p and i).
    letters: () => new Set(givenOptions(cx.command!.parse).map(({ role }) => role.flag.slice(1))),
    given: (...names) => given(cx, ...names),
    bash: () => (cx.command?.spec.builtin ? cx.opts.bashVersion ?? DEFAULT_BASH_VERSION : undefined),
    shell: cx.shell,
    invalid: () => invalidHow(cx.evidenceAt(a)),
  };
  const read = EMBEDDED[lang](lit.text, ecx);
  const holes = lit.holes ? readHoles(cx, lit, lang, a, read) : undefined;
  if (holes?.stopped) return holes.reading;
  const r = holes ? holes.read : read;
  if (!r) return undefined;
  // (A worked example would need a value made up for the hole.)
  if (!lit.holes) guardedEmbeddedExample(cx, lang, lit.text, a);
  // (Where bash took a backslash away before the command read the text, `"a\\.b"`, it says what the command is given.)
  const taken = removedBackslashes(lit);
  const bash = taken.length ? cx.text('embedded-backslash-removed', { taken }) : undefined;
  const note = bash && r.note ? r.note + cx.s('。', '; ') + bash : bash ?? r.note;
  return { tokens: r.tokens.map((t) => ({ ...fromEmbedded(t, a, lit, 'embedded'), language: lang })), note, ...(holes ? { holes: holes.spans } : {}) };
}

/** The languages that are code: a hole that stops their reader says the script depends on it, and how a value is passed as data. */
const SCRIPTS: Partial<Record<EmbeddedLang, { data?: string }>> = { sed: {}, awk: { data: '`-v name=value`' }, jq: { data: '`--arg name value`' }, yq4: {}, perl: {} };

/** What is said of a hole at each place, from the catalog. */
function holeText(cx: Explainer, value: string, mark: HoleMark): string {
  const { place } = mark;
  switch (place) {
    case 'regex': return cx.text('hole-regex', { value, delimiter: mark.delimiter, perl: mark.perl, alone: mark.alone });
    case 'repeat': return cx.text('hole-repeat', { value, written: mark.written! });
    case 'replacement': return cx.text('hole-replacement', { value, delimiter: mark.delimiter });
    case 'perl-replacement': return cx.text('hole-perl-replacement', { value, delimiter: mark.delimiter });
    default: return cx.text(`hole-${place}`, { value });
  }
}

/**
 * A reading of a text with holes (`Literal.holes`). It stands only if the reader claimed every hole with a token of a hole
 * (src/embedded/types.ts) and found no error, which may be the value's to mend; else the word stays unread, with a note
 * where the text is code. The tokens have the texts of the catalog, and the source in place of each hole. `spans`: where
 * the holes are in the source.
 */
function readHoles(cx: Explainer, lit: Literal, lang: EmbeddedLang, a: SyntaxNode, read: ReturnType<typeof EMBEDDED[EmbeddedLang]>): { stopped: true; reading?: EmbeddedReading } | { stopped?: false; read: Embedded; spans: Span[] } {
  const { parse, nodes } = cx.command!;
  const source = (c: string): string => lit.holes![c];
  const show = (text: string): string => text.replace(HOLES, source);
  const claimed = new Set<number>();
  let error = false;
  const look = (t: EmbeddedToken): void => {
    if (t.hole && isHole(lit.text[t.start])) claimed.add(t.start);
    if (t.kind === 'error') error = true;
    t.children.forEach(look);
  };
  read?.tokens.forEach(look);
  const at: number[] = [];
  for (let k = 0; k < lit.text.length; k++) if (isHole(lit.text[k])) at.push(k);
  const open = at.filter((k) => !claimed.has(k));
  if (!read || error || open.length) {
    const script = SCRIPTS[lang];
    const named = [...new Set((open.length ? open : at).map((k) => codeSpan(source(lit.text[k]))))];
    return { stopped: true, ...(script ? { reading: { tokens: [], note: cx.text('hole-script', { values: named, command: parse.command, data: script.data }) } } : {}) };
  }
  const spans = at.map((k): Span => ({ start: sourcePos(a, sourceIndex(lit, k, false)), end: sourcePos(a, sourceIndex(lit, k + 1, true)) }));
  const fill = (t: EmbeddedToken): EmbeddedToken => ({
    ...t,
    explanation: t.hole ? holeText(cx, codeSpan(source(t.hole.of ?? lit.text[t.start])), t.hole) : show(t.explanation),
    ...(t.label ? { label: show(t.label) } : {}),
    children: t.children.map(fill),
  });
  // (A value that starts with `-` is an option of the command, where the word is its first operand and the reader reads more of it. In code, the text of the hole says what the value may be.)
  const first = parse.roles.find(({ role }) => role.role === 'operand' || role.role === 'end-of-options');
  const dash = !SCRIPTS[lang] && lit.text.length > 1 && isHole(lit.text[0]) && first?.role.role === 'operand' && same(nodes[first.word], a)
    ? cx.text('hole-leading-dash', { value: codeSpan(source(lit.text[0])), command: parse.command }) : undefined;
  const tokens = read.tokens.map(fill);
  // (The whole word is one hole: no parts for the reader to show, and what it says stands on the word, beside bash's `$x`.)
  const whole = tokens.length === 1 && tokens[0].hole && lit.text.length === 1;
  // (A regex that is only the value: the word already says it is a pattern, with the option that chooses the flavour beside it.)
  const regexWord = whole && read.tokens[0].hole!.place === 'regex';
  const said = regexWord ? cx.text('hole-regex-word') : whole ? tokens[0].explanation : undefined;
  const note = [...(read.note && !regexWord ? [show(read.note)] : []), ...(said ? [said] : []), ...(dash ? [dash] : [])].join(cx.sep());
  return { spans: whole ? [] : spans, read: { tokens: whole ? [] : tokens, ...(note ? { note } : {}) } };
}

/** The kinds of the examples that run the embedded text on data, and may run a regex of it (a regex and a glob say so themselves). */
const RUNNERS: Partial<Record<EmbeddedLang, ExampleKind>> = { sed: 'sed', awk: 'awk', jq: 'jq', yq4: 'yq' };

/** The worked example of an embedded text that the explainer read (src/embedded/registry.ts), when its language has one. */
const SED_EXAMPLE = memoKey<true>('sedExample');

function guardedEmbeddedExample(cx: Explainer, lang: EmbeddedLang, text: string, a: SyntaxNode): void {
  guardedExample(cx, RUNNERS[lang] ?? 'regex', () => embeddedExample(cx, lang, text, a));
}

function embeddedExample(cx: Explainer, lang: EmbeddedLang, text: string, a: SyntaxNode): void {
  switch (lang) {
    case 'regex': {
      const flavor = regexFlavor(cx);
      const ignoreCase = given(cx, '-i');
      const js = flavor === 'fixed' ? literalRegex(text, ignoreCase) : toJsRegex(text, flavor, { ignoreCase });
      if (js) regexExample(cx, grepWrap(js, given(cx, '-x'), given(cx, '-w')), given(cx, '-v') ? 'inverted' : 'lines');
      break;
    }
    case 'sed': {
      // (Each -e makes the same example, of the whole script: once for a command.)
      const made = cx.memo(SED_EXAMPLE);
      if (made.has(cx.command!.nodes[0])) break;
      made.set(cx.command!.nodes[0], true);
      // (Each -e script is read with the options given before it: `sed -e 's/a+/x/' -E -e 's/(b)/\1/'` mixes BRE and
      // ERE, which the example, of one script, does not show.)
      const flavors = new Set(values(cx.command!.parse, '-e').map(({ word }) => regexFlavor(cx, word)));
      if (flavors.size > 1) break;
      const flavor = [...flavors][0] ?? regexFlavor(cx);
      // With several -e options sed runs them as one script, so the example does too.
      const scripts = sedScripts(cx) ?? [text];
      const quiet = given(cx, '-n');
      // -z / --null-data: the "lines" are NUL-separated records, which the example runner does not model.
      const ex = given(cx, '-z') ? undefined : sedExample(scripts.join('\n'), { quiet, extended: flavor === 'ere' });
      // (Each -e makes the same example, of the whole script: it belongs to the command, and is shown once.)
      if (ex) {
        cx.examplesAt(scripts.length > 1 ? cx.command!.args[0].parent! : a, () => {
          // With `-s` or `-i`, sed works on each file apart: the example shows the first (`EachFile`).
          ioExample(cx, ex.input, ex.output, {
            kind: 'sed', script: scripts.join('\n'), quiet, extended: flavor === 'ere',
            highlight: sedPattern(scripts.join('\n'), flavor === 'ere' ? 'ere' : 'bre'),
          }, inputSource(cx));
        });
      }
      break;
    }
    case 'jq': {
      // kislyuk/yq passes the filter to jq, but reads and (with -y) writes YAML.
      if (cx.command!.spec === YQ_SPECS.kislyuk) {
        yqExample(cx, text, 'kislyuk');
        break;
      }
      const nullInput = given(cx, '-n');
      const rawInput = given(cx, '-R');
      const format = jqFormat(cx);
      if (!format) break;
      const spec: Extract<RerunSpec, { kind: 'jq' }> = {
        kind: 'jq', filter: text, raw: given(cx, '-r'), join: given(cx, '-j'), slurp: given(cx, '-s') && !nullInput, vars: jqVars(cx), format,
        ...(nullInput ? { nullInput } : {}), ...(rawInput ? { rawInput } : {}),
      };
      // `-n`: jq reads no input, unless the filter's `input` or `inputs` reads it.
      const readBy = jqReadsInputs(text);
      jqExamples(cx, spec, nullInput && !readBy ? NO_INPUT : inputSource(cx), readBy);
      break;
    }
    case 'awk': {
      const opts = awkOptions(cx);
      const ex = opts && awkExample(text, opts);
      if (!ex) break;
      // A program of `BEGIN` rules alone reads no input.
      const src = ex.readsInput ? inputSource(cx) : NO_INPUT;
      // The names of the files a glob gives are not known, so neither is what `FILENAME` holds.
      if (/\bFILENAME\b/.test(text) && src.streams.some((st) => st.kind !== 'stdin' && (st.many || st.pipe))) break;
      ioExample(cx, ex.input, ex.output, { kind: 'awk', program: text, fs: opts!.fs, vars: opts!.vars, assigns: opts!.assigns }, src);
      break;
    }
    case 'yq4':
      yqExample(cx, text, 'mikefarah');
      break;
    case 'gitformat':
    case 'gitdate':
      pushExample(cx, gitLogExample(lang, text, cx.command!.parse, cx.command!.nodes.map((x) => literalContent(x)?.text), cx.lang));
      break;
    case 'glob': {
      // Unlike the shell, find matches a leading dot with * too; -path also matches / with *.
      // The test before the pattern: -name, -path…
      const opt = previousNamed(a).text;
      if (!/^-i/.test(opt)) {
        globExample(cx, a, text, 'value', cx.s(`例（\`${opt}\` のパターン）`, `Example (the \`${opt}\` pattern)`),
          opt === '-name' ? [cx.s('一致するファイル名', 'Matching names'), cx.s('一致しないファイル名', 'Non-matching names')] : [cx.s('一致するパス', 'Matching paths'), cx.s('一致しないパス', 'Non-matching paths')]);
      }
      break;
    }
    case 'date': {
      const run = dateRun(cx);
      if (run) pushExample(cx, dateExample(text, run, cx.lang));
      break;
    }
  }
}

/** The named sibling before `n`. */
function previousNamed(n: SyntaxNode): SyntaxNode {
  const kids = n.parent!.namedChildren;
  return kids[kids.indexOf(n) - 1];
}

/** The escapes inside `$'…'`, each with its meaning. */
export function ansiCChildren(cx: Explainer, n: SyntaxNode): Token[] {
  const lit: Literal = { text: n.text.slice(2, -1), base: 2 };
  return explainEscapes(lit.text, cx.lang, 'ansic').map((t) => fromEmbedded(t, n, lit, 'shell'));
}

/**
 * A `$'…'` string, with its escapes. In a shell without it (`FEATURES.ansiC`), what dash makes of it instead: a `$` and
 * a single-quoted string, with its value there (`ansiCWordValue`; none in POSIX sh, which may be dash or not).
 */
export function ansiCString(cx: Explainer, n: SyntaxNode): Token {
  const host = hostString(cx, n);
  if (host) return host;
  if (!featureWorks('ansiC', cx.shell)) {
    const escapes = /\\/.test(n.text);
    // (A `\'`: dash's quote ends there, and the `'` after it opens another; the word is not what the tree shows.)
    if (cx.shell === 'dash' && n.text.slice(2, -1).includes("'")) {
      return cx.tok(n, 'string', cx.text('ansi-c-dash-quote-ends'));
    }
    return cx.tok(n, 'string', cx.shell === 'dash'
      ? cx.text('ansi-c-dash', { escapes }) + valueNote(cx, n)
      : cx.text('ansi-c-not-posix'));
  }
  return cx.tok(n, 'string', cx.text('ansi-c-string') + (/\\/.test(n.text) ? valueNote(cx, n) : ''), ansiCChildren(cx, n));
}
