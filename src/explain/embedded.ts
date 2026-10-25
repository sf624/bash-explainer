// The languages written inside a command's words (docs/design/analyzer.md, step 6): a regex, a sed script, an awk
// program, a jq or yq filter, a glob of find, a printf, date or git format, the escapes of `$'…'`. The explainers are
// in src/embedded/ (src/embedded/registry.ts); this module gives them the command whose words are explained
// (`Explainer.command`: the regex flavour, tr's sets, the letters given), places their tokens in the source, and adds
// the worked example of the text (src/explain/examples.ts, src/explain/examples-jq.ts).
import type { Token } from '../analyzer-types';
import { givenOptions } from '../argv/query';
import { YQ_SPECS } from '../dict/yq';
import { explainEscapes } from '../embedded/format';
import { EMBEDDED, type EmbeddedContext } from '../embedded/registry';
import type { EmbeddedLang } from '../embedded/types';
import { awkExample } from '../examples/awk';
import { dateExample, gitLogExample } from '../examples/commands';
import { jqReadsInputs } from '../examples/jq';
import { grepWrap, literalRegex, toJsRegex } from '../examples/regex';
import type { RerunSpec } from '../examples/rerun';
import { sedExample, sedPattern } from '../examples/sed';
import { NO_INPUT } from '../examples/source';
import { type Literal, literalContent } from '../staticword';
import type { SyntaxNode } from '../syntax/tree';
import type { Explainer } from './context';
import { awkOptions, dateRun, globExample, inputSource, ioExample, pushExample, regexExample, sedScripts } from './examples';
import { jqExamples, jqFormat, jqVars, yqExample } from './examples-jq';
import { fromEmbedded } from './nodes';
import { given, regexFlavor, trContext } from './reads';
import { valueNote } from './words';

/**
 * Explain the contents of a quoted or plain word written in another language (a regex, a sed
 * script…). Only literal text is handled: with expansions or escapes inside, the shell changes
 * the text before the command sees it, so offsets would not line up.
 */
export function embedded(cx: Explainer, a: SyntaxNode, lang: EmbeddedLang): { tokens: Token[]; note?: string } | undefined {
  const lit = literalContent(a, lang);
  return lit && embeddedText(cx, lit, lang, a);
}

/** Explain `lit.text`, which sits inside `a` as `lit` describes (e.g. after `-k` in `-k3,3n`). */
export function embeddedText(cx: Explainer, lit: Literal, lang: EmbeddedLang, a: SyntaxNode): { tokens: Token[]; note?: string } | undefined {
  return cx.examplesAt(a, () => embeddedTextInner(cx, lit, lang, a));
}

function embeddedTextInner(cx: Explainer, lit: Literal, lang: EmbeddedLang, a: SyntaxNode): { tokens: Token[]; note?: string } | undefined {
  // (A line the tool refuses runs no program: `grep -E -F PATTERN` reads the pattern in no flavour.)
  if (cx.command?.parse.refused) return undefined;
  const ecx: EmbeddedContext = {
    lang: cx.lang,
    flavor: () => regexFlavor(cx),
    trSet: () => trContext(cx, a),
    // The letters given (`-lane`: l, a, n and e; `-pi.bak`: p and i).
    letters: () => new Set(givenOptions(cx.command!.parse).map(({ role }) => role.flag.slice(1))),
    given: (...names) => given(cx, ...names),
  };
  const r = EMBEDDED[lang](lit.text, ecx);
  if (!r) return undefined;
  embeddedExample(cx, lang, lit.text, a);
  return { tokens: r.tokens.map((t) => ({ ...fromEmbedded(t, a, lit, 'embedded'), language: lang })), note: r.note };
}

/** The worked example of an embedded text that the explainer read (src/embedded/registry.ts), when its language has one. */
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
      const flavor = regexFlavor(cx);
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

/** A `$'…'` string, with its escapes. */
export function ansiCString(cx: Explainer, n: SyntaxNode): Token {
  return cx.tok(n, 'string', cx.s('`$\'…\'` 文字列: `\\n` `\\t` などのエスケープを解釈した文字列になる', '`$\'…\'` string: backslash escapes such as `\\n` are interpreted') + (/\\/.test(n.text) ? valueNote(cx, n) : ''), ansiCChildren(cx, n));
}
