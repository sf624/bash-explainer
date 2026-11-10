// What is said of the holes of a text a reader read (src/embedded/types.ts: an expansion in a shell word, a field of a Python
// f-string), with no `Explainer` (docs/design/python-regex.md, 2.6): whether the reading stands (`holesRead`), and the texts of
// its holes from the catalog (`fillHoles`, `holeText`), each risk once on a line. A shell word's line and a Python pattern's line
// each give a `HoleSink`; what is about a command's options stays in src/explain/embedded.ts.
import type { EmbeddedToken, HoleMark } from '../embedded/types';
import { HOLES, isHole } from '../embedded/types';
import type { Lang } from '../i18n';
import { codeSpan } from '../label';
import { type TokenTextArgs, type TokenTextId, tokenSaid } from '../messages-tokens';

/** Where the texts of the holes of a line go: its language, and what was said there before. */
export interface HoleSink {
  readonly lang: Lang;
  /** The value that has said `key` on this line, and none where this is the first time: then it is `value`. */
  saidBefore(key: string, value: string): string | undefined;
  /** A newline in a regex's value makes two patterns where no delimiter ends it (the commands of a shell line); not in Python's `re`. */
  readonly patterns: boolean;
}

/** A sink over a map of what was said (`Explainer.holesSaid`, or a language line's own). */
export function holeSink(lang: Lang, said: Map<string, string>, patterns: boolean): HoleSink {
  return {
    lang, patterns,
    saidBefore(key, value) {
      const first = said.get(key);
      if (!first) said.set(key, value);
      return first;
    },
  };
}

/**
 * What is said of a hole, from the catalog: each risk once on the line, the first time a hole of its kind stands there; a
 * later hole of that kind names the first. `part`: the row of a part with nothing else in it says this too, so the text
 * leaves out what that row says, and may be empty.
 */
export function holeText(sink: HoleSink, value: string, mark: HoleMark, part: boolean): string {
  const said = (key: string): string | undefined => sink.saidBefore(key, value);
  const text = <K extends TokenTextId>(id: K, ...params: TokenTextArgs<K>): string => tokenSaid(sink.lang, id, ...params);
  const sep = sink.lang === 'ja' ? '。' : '. ';
  const { place, delimiter, perl, around, written, escaped } = mark;
  const like = (first: string): string => (part ? '' : text('hole-like', { value, like: first }));
  if (escaped && (place === 'regex' || place === 'class')) {
    // (`re.escape(x)`: its value is text, whatever it is.)
    const first = said(`${place} escaped`);
    return first ? like(first) : text(`hole-${place}-escaped`, { value });
  }
  if (place === 'regex') {
    const first = said('regex');
    const ends = delimiter && !said(`regex end ${delimiter} ${perl}`) ? delimiter : undefined;
    const says = { special: !first, delimiter: ends, perl: perl && !said('regex perl'), around: around && !said('regex around') };
    const rest = Object.values(says).some(Boolean) ? text('hole-regex', { value, part, newline: !perl, patterns: sink.patterns && !delimiter && !perl, ...says }) : '';
    return [...(first ? [like(first)] : []), rest].filter(Boolean).join(sep);
  }
  if (place === 'repeat') return text('hole-repeat', { value, written: written!, like: said(place) });
  const first = said(`${place} ${delimiter}`);
  // (A sentence on what stands after the hole is new where the first hole of the kind had nothing after it.)
  const newer = around && !said(`${place} around`);
  if (first && !newer) return like(first);
  switch (place) {
    case 'replacement': return text('hole-replacement', { value, delimiter, part });
    case 'perl-replacement': return text('hole-perl-replacement', { value, delimiter, part });
    case 'sed-text': return text('hole-sed-text', { value, part });
    case 'tr': return text('hole-tr', { value, part });
    case 'address': case 'date': case 'printf': return text(`hole-${place}`, { value, around });
    // (A value in a word of a query expression can end the word: said once on the line.)
    case 'target-package': case 'target-name': return text(`hole-${place}`, { value, query: mark.query && !said('query') });
    case 'query-word': said('query'); return text('hole-query-word', { value });
    default: return text(`hole-${place}`, { value });
  }
}

/**
 * Where the holes of `text` are (`at`), and which of them no token of a hole claims (`open`); `error`, whether the reader found an
 * error, which may be the value's to mend. A reading stands only with none open and no error.
 */
export function holesRead(text: string, tokens: readonly EmbeddedToken[] | undefined): { at: number[]; open: number[]; error: boolean } {
  const claimed = new Set<number>();
  let error = false;
  const look = (t: EmbeddedToken): void => {
    if (t.hole && isHole(text[t.start])) claimed.add(t.start);
    if (t.kind === 'error') error = true;
    t.children.forEach(look);
  };
  tokens?.forEach(look);
  const at: number[] = [];
  for (let k = 0; k < text.length; k++) if (isHole(text[k])) at.push(k);
  return { at, open: at.filter((k) => !claimed.has(k)), error };
}

/**
 * The tokens of a reading that stands (`holesRead`), with the texts of the catalog on their holes and the source in place of each
 * hole in the other texts and labels (`source`: what a hole character stands for, as written).
 */
export function fillHoles(sink: HoleSink, tokens: readonly EmbeddedToken[], text: string, source: (c: string) => string): EmbeddedToken[] {
  const show = (s: string): string => s.replace(HOLES, source);
  const said = (t: EmbeddedToken, part: boolean): string => holeText(sink, codeSpan(source(t.hole!.of ?? text[t.start])), t.hole!, part);
  const fill = (t: EmbeddedToken): EmbeddedToken => {
    const [only] = t.children;
    // (A part with only a hole in it: the row of the part says what the hole's would, and bash's `$x` stands under it.)
    const risk = t.children.length === 1 && only.hole && only.start === t.start && only.end === t.end ? said(only, true) : undefined;
    return {
      ...t,
      explanation: t.hole ? said(t, false) : show(t.explanation) + (risk ? `: ${risk}` : ''),
      ...(t.label ? { label: show(t.label) } : {}),
      children: risk === undefined ? t.children.map(fill) : [],
    };
  };
  return tokens.map(fill);
}
