import type { Lang } from '../i18n';
import { bracketEnd } from '../bracket';
import { describeGlob } from '../expansion';
import { alternatives, closingParen } from '../examples/shellwords';
import { EmbeddedToken, pick } from './types';

/** What a glob is matched against: a string (`case`, `[[ ]]`, `${x#pat}`) or the names of files (an argument). */
export type GlobTarget = 'value' | 'file';

/**
 * The one explanation of a glob pattern, wherever it appears: shell wildcards, matched against a string
 * or against file names. `quoted` adds the rule of `[[ ]]`, where only the unquoted parts are a pattern.
 */
export function globIntro(lang: Lang, target: GlobTarget): string {
  const s = pick(lang);
  return target === 'file'
    ? s('グロブパターン（シェルのワイルドカード）: 一致するファイル名に展開される', 'Glob pattern (shell wildcards): expands to the matching file names')
    : s('グロブパターン（シェルのワイルドカード）: 文字列と照合される', 'Glob pattern (shell wildcards): matched against a string');
}

/**
 * The parts of a glob pattern as tokens, with offsets into `src`: `*`, `?`, a bracket expression, an extended
 * glob with its alternatives, a run of literal characters, an escaped character, a quoted part.
 * Nothing for a pattern with an expansion (`$x`, `$(…)`): its text is only known at run time. `ifs`: the places of
 * backslashes not written in the script, put before the characters that bash quotes because `IFS` holds them (in a
 * word with an unquoted expansion, `IFS='?'; ls $x[ab]?`); the texts shown leave them out.
 */
export function explainGlob(src: string, lang: Lang, extglob = true, ifs: ReadonlySet<number> = new Set()): EmbeddedToken[] {
  if (/\$(?!')|`/.test(src)) return [];
  const shown = (from: number, to: number): string => [...src.slice(from, to)].filter((_, k) => !ifs.has(from + k)).join('');
  return parse({ src, s: pick(lang), lang, ifs, shown }, 0, src.length, extglob);
}

/** What `parse` reads: the pattern, the language, and the backslashes put before characters of `IFS` (`explainGlob`). */
interface Source { src: string; s: (ja: string, en: string) => string; lang: Lang; ifs: ReadonlySet<number>; shown: (from: number, to: number) => string }

const EXT: Record<string, [string, string]> = {
  '?': ['次を0回か1回', 'zero or one of'],
  '*': ['次の0回以上の繰り返し', 'zero or more repetitions of'],
  '+': ['次の1回以上の繰り返し', 'one or more repetitions of'],
  '@': ['次のどれか1つ', 'exactly one of'],
  '!': ['次のどれにも一致しないもの', 'anything that matches none of'],
};

/** `extglob: false`: without the option, `@(…)` is no extended glob (`*(` and `?(` are a wildcard and a `(`). */
function parse(at: Source, from: number, to: number, extglob: boolean): EmbeddedToken[] {
  const { src, s, lang, ifs, shown } = at;
  const out: EmbeddedToken[] = [];
  let run: EmbeddedToken | undefined;
  const add = (start: number, end: number, kind: EmbeddedToken['kind'], explanation: string, children: EmbeddedToken[] = []) => {
    out.push({ start, end, kind, explanation, children });
    run = undefined;
  };
  const literal = (i: number) => {
    if (run && run.end === i) run.end = i + 1;
    else out.push((run = { start: i, end: i + 1, kind: 'string', explanation: '', children: [] }));
  };
  for (let i = from; i < to; i++) {
    const c = src[i];
    if (ifs.has(i)) {
      add(i, i + 2, 'string', s(`\`${src[i + 1]}\`: \`IFS\` にある文字で、語にクォートしていない展開があるので、bash はこの文字そのものとして照合する（パターンの記号としては働かない）`, `\`${src[i + 1]}\`: \`IFS\` holds it and the word has an unquoted expansion, so bash matches the character itself, not a pattern symbol`));
      i++;
    } else if (c === '\\' && i + 1 < to) {
      add(i, i + 2, 'string', s(`\`${src.slice(i, i + 2)}\`: \`${src[i + 1]}\` という文字そのもの（パターンの記号としては働かない）`, `\`${src.slice(i, i + 2)}\`: the character \`${src[i + 1]}\` itself, not a pattern symbol`));
      i++;
    } else if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      if (end < 0 || end >= to) { literal(i); continue; }
      add(i, end + 1, 'string', s('クォートされた部分: 中の文字そのもの（`*` や `?` もパターンにならない）', 'Quoted part: the characters themselves (`*` and `?` are not pattern symbols here)'));
      i = end;
    } else if (c === '$' && src[i + 1] === "'" && ansiEnd(src, i + 2) < to) {
      // `$'a*'` is quoted as `'a*'` is, with its escapes read (`$'\t'` is a tab).
      const end = ansiEnd(src, i + 2);
      add(i, end + 1, 'string', s('`$\'…\'` でクォートされた部分: エスケープを解釈した文字そのもの（`*` や `?` もパターンにならない）', 'Part quoted with `$\'…\'`: the characters it stands for themselves (`*` and `?` are not pattern symbols here)'));
      i = end;
    } else if (extglob && '?*+@!'.includes(c) && src[i + 1] === '(' && closingParen(src, i + 1) > 0 && closingParen(src, i + 1) < to) {
      const end = closingParen(src, i + 1);
      const [ja, en] = EXT[c];
      const alts = alternatives(src, i + 2, end).filter(([a, b]) => b > a).map(([a, b]): EmbeddedToken => ({
        start: a, end: b, kind: 'pattern',
        explanation: s(`選択肢 \`${shown(a, b)}\``, `Alternative \`${shown(a, b)}\``),
        children: parse(at, a, b, true),
      }));
      add(i, end + 1, 'pattern', s(`\`${c}(…)\`: 拡張グロブ。${ja}（\`|\` で区切った選択肢）`, `\`${c}(…)\`: extended glob, ${en} the alternatives separated by \`|\``), alts);
      i = end;
    } else if (c === '*') add(i, i + 1, 'pattern', s('`*`: 任意の文字列（空でもよい）', '`*`: any string, including an empty one'));
    else if (c === '?') add(i, i + 1, 'pattern', s('`?`: 任意の1文字', '`?`: any one character'));
    else if (c === '[' && bracketEnd(src, i, to) > 0) {
      const end = bracketEnd(src, i, to);
      // (Characters of `IFS` in it are themselves: `IFS='-'; ls $x[a-c]b` matches `a`, `-` or `c`.)
      const held = [...new Set([...ifs].filter((k) => k > i && k < end).map((k) => `\`${src[k + 1]}\``))];
      const note = held.length ? s(`（\`IFS\` にある ${held.join('・')} はその文字そのもの）`, ` (${held.join(', ')}, which \`IFS\` holds, ${held.length > 1 ? 'are themselves' : 'is itself'})`) : '';
      add(i, end + 1, 'pattern', `\`${shown(i, end + 1)}\`: ${describeGlob([{ type: 'class', body: src.slice(i + 1, end) }], lang)}${note}`);
      i = end;
    } else literal(i);
  }
  for (const t of out) {
    if (!t.explanation) {
      const text = shown(t.start, t.end);
      t.explanation = s(`文字列 \`${text}\` そのもの`, `The text \`${text}\` itself`);
    }
  }
  return out;
}

/** The closing quote of a `$'…'` whose text starts at `from` (a backslash escapes the next character), or the end of `src`. */
function ansiEnd(src: string, from: number): number {
  let i = from;
  while (i < src.length && src[i] !== "'") i += src[i] === '\\' ? 2 : 1;
  return Math.min(i, src.length);
}

const hasBracket =(s: string) => [...s].some((c, i) => c === '[' && s[i - 1] !== '\\' && bracketEnd(s, i) > i);
/** A word's text without its line continuations, which bash removes before it reads the word (`*.t\<newline>xt` is `*.txt`). */
export const unbroken = (s: string): string => (s.includes('\\\n') ? s.replace(/\\\n/g, '') : s);
/** Whether a word's text has a wildcard: `*`, `?`, an extended glob (`+(`, `@(`, `!(`) or a bracket expression. */
export const hasGlob = (text: string): boolean => {
  const s = unbroken(text);
  return /(^|[^\\])([*?]|[+@!]\()/.test(s) || hasBracket(s);
};
