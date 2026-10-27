// The embedded languages, one explainer each with one return shape: the tokens of the text, and a note on the whole.
// What an explainer needs of the command around the text (the regex flavor its options choose, the role of a `tr`
// set, perl's letters) it asks of the context; the worked examples are the analyzer's (src/explain/embedded.ts).
import type { BashVersion } from '../bashversion';
import type { Lang } from '../i18n';
import { explainArith } from './arith';
import { explainAwk } from './awk';
import { describeFindPattern } from './find';
import { explainDate, explainEscapes, explainPrintf, printfNote } from './format';
import { explainGetoptLong, explainGetoptShort } from './getopt';
import { explainGetopts } from './getopts';
import { explainGitDate, explainGitFormat } from './gitformat';
import { explainGlob } from './glob';
import { explainJq } from './jq';
import { explainMode, explainUmask } from './mode';
import { explainPerl, perlLoopNote } from './perl';
import { explainRegex, Flavor, flavorName } from './regex';
import { explainSed } from './sed';
import { explainCutList, explainSortKey, explainTrSet, trSummary } from './textutils';
import { explainPrompt, promptNote } from './prompt';
import { EmbeddedLang, EmbeddedToken, pick } from './types';
import { explainYq3Path } from './yq';

/** An embedded text explained: its tokens (offsets in the text), and a note on the whole. */
export interface Embedded { tokens: EmbeddedToken[]; note?: string }

/** What the command around the text says about it, asked only by the languages that need it. */
export interface EmbeddedContext {
  lang: Lang;
  /** The regex flavor the command's options choose (grep -E, sed -E…). */
  flavor(): Flavor | 'fixed';
  /** What a `tr` set is for, and the sets of the command. */
  trSet(): { role: 'from' | 'to' | 'delete' | 'squeeze'; sets: string[] };
  /** The letters of the options given (`-lane`: l, a, n, e). */
  letters(): Set<string>;
  /** Whether one of these options is given, in any of its spellings (`sed -n` is `--quiet` too). */
  given(...names: string[]): boolean;
  /** The bash release whose builtin reads the text; undefined when a program does (`env printf`). */
  bash(): BashVersion | undefined;
}

type Explainer = (text: string, cx: EmbeddedContext) => Embedded | undefined;

const regex: Explainer = (text, cx) => {
  const flavor = cx.flavor();
  return { tokens: flavor === 'fixed' ? [] : explainRegex(text, flavor, cx.lang), note: flavorName(flavor, cx.lang) };
};

/** One explainer per embedded language; undefined when the text is not one of that language (`date` without `+`). */
export const EMBEDDED: Readonly<Record<EmbeddedLang, Explainer>> = {
  regex,
  sed: (text, cx) => ({ tokens: explainSed(text, cx.flavor() === 'ere' ? 'ere' : 'bre', cx.lang, cx.given('-n')) }),
  jq: (text, cx) => ({ tokens: explainJq(text, cx.lang) }),
  yq4: (text, cx) => ({ tokens: explainJq(text, cx.lang, 'yq') }),
  yq3path: (text, cx) => explainYq3Path(text, cx.lang),
  awk: (text, cx) => ({ tokens: explainAwk(text, cx.lang) }),
  printf: (text, cx) => {
    const reader = cx.bash() ?? 'coreutils';
    return { tokens: explainPrintf(text, cx.lang, reader), note: printfNote(text, cx.lang, reader) };
  },
  echo: (text, cx) => ({ tokens: explainEscapes(text, cx.lang, 'echo') }),
  mode: (text, cx) => explainMode(text, cx.lang),
  umask: (text, cx) => explainUmask(text, cx.lang),
  sortkey: (text, cx) => explainSortKey(text, cx.lang),
  cutfields: (text, cx) => explainCutList(text, 'field', cx.lang),
  cutchars: (text, cx) => explainCutList(text, 'char', cx.lang),
  trset: (text, cx) => {
    const { role, sets } = cx.trSet();
    const r = explainTrSet(text, role, cx.lang);
    if (!r) return undefined;
    const summary = role === 'to' ? trSummary(sets[0], text, cx.lang) : undefined;
    return { tokens: r.tokens, note: summary ? `${r.note}${pick(cx.lang)('。つまり', '; that is, it ')}${summary}` : r.note };
  },
  getoptshort: (text, cx) => explainGetoptShort(text, cx.lang),
  getoptlong: (text, cx) => explainGetoptLong(text, cx.lang),
  getopts: (text, cx) => explainGetopts(text, cx.lang),
  perl: (text, cx) => ({ tokens: explainPerl(text, cx.lang), note: perlLoopNote(cx.letters(), cx.lang) }),
  gitformat: (text, cx) => explainGitFormat(text, cx.lang),
  gitdate: (text, cx) => explainGitDate(text, cx.lang),
  glob: (text, cx) => {
    // (find's patterns: unlike the shell's, `*` matches a leading dot too.)
    const note = describeFindPattern(text, cx.lang);
    return note ? { tokens: explainGlob(text, cx.lang), note } : undefined;
  },
  arith: (text, cx) => explainArith(text, cx.lang),
  // (The value of PS0, PS1, PS2 or PS4: bash reads it each time it prints the prompt, 6.9.)
  prompt: (text, cx) => ({ tokens: explainPrompt(text, cx.lang), note: promptNote(cx.lang) }),
  // Only `+FORMAT` is a format; other date arguments set the clock.
  date: (text, cx) => (text.startsWith('+') ? { tokens: explainDate(text, cx.lang) } : undefined),
};
