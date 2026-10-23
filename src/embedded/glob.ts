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
 * Nothing for a pattern with an expansion (`$x`, `$(…)`): its text is only known at run time.
 */
export function explainGlob(src: string, lang: Lang): EmbeddedToken[] {
  if (/\$|`/.test(src)) return [];
  return parse(src, 0, src.length, pick(lang), lang);
}

const EXT: Record<string, [string, string]> = {
  '?': ['次を0回か1回', 'zero or one of'],
  '*': ['次の0回以上の繰り返し', 'zero or more repetitions of'],
  '+': ['次の1回以上の繰り返し', 'one or more repetitions of'],
  '@': ['次のどれか1つ', 'exactly one of'],
  '!': ['次のどれにも一致しないもの', 'anything that matches none of'],
};

function parse(src: string, from: number, to: number, s: (ja: string, en: string) => string, lang: Lang): EmbeddedToken[] {
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
    if (c === '\\' && i + 1 < to) {
      add(i, i + 2, 'string', s(`\`${src.slice(i, i + 2)}\`: \`${src[i + 1]}\` という文字そのもの（パターンの記号としては働かない）`, `\`${src.slice(i, i + 2)}\`: the character \`${src[i + 1]}\` itself, not a pattern symbol`));
      i++;
    } else if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      if (end < 0 || end >= to) { literal(i); continue; }
      add(i, end + 1, 'string', s('クォートされた部分: 中の文字そのもの（`*` や `?` もパターンにならない）', 'Quoted part: the characters themselves (`*` and `?` are not pattern symbols here)'));
      i = end;
    } else if ('?*+@!'.includes(c) && src[i + 1] === '(' && closingParen(src, i + 1) > 0 && closingParen(src, i + 1) < to) {
      const end = closingParen(src, i + 1);
      const [ja, en] = EXT[c];
      const alts = alternatives(src, i + 2, end).filter(([a, b]) => b > a).map(([a, b]): EmbeddedToken => ({
        start: a, end: b, kind: 'pattern',
        explanation: s(`選択肢 \`${src.slice(a, b)}\``, `Alternative \`${src.slice(a, b)}\``),
        children: parse(src, a, b, s, lang),
      }));
      add(i, end + 1, 'pattern', s(`\`${c}(…)\`: 拡張グロブ。${ja}（\`|\` で区切った選択肢）`, `\`${c}(…)\`: extended glob, ${en} the alternatives separated by \`|\``), alts);
      i = end;
    } else if (c === '*') add(i, i + 1, 'pattern', s('`*`: 任意の文字列（空でもよい）', '`*`: any string, including an empty one'));
    else if (c === '?') add(i, i + 1, 'pattern', s('`?`: 任意の1文字', '`?`: any one character'));
    else if (c === '[' && bracketEnd(src, i, to) > 0) {
      const end = bracketEnd(src, i, to);
      add(i, end + 1, 'pattern', `\`${src.slice(i, end + 1)}\`: ${describeGlob([{ type: 'class', body: src.slice(i + 1, end) }], lang)}`);
      i = end;
    } else literal(i);
  }
  for (const t of out) {
    if (!t.explanation) {
      const text = src.slice(t.start, t.end);
      t.explanation = s(`文字列 \`${text}\` そのもの`, `The text \`${text}\` itself`);
    }
  }
  return out;
}

const hasBracket = (s: string) => [...s].some((c, i) => c === '[' && s[i - 1] !== '\\' && bracketEnd(s, i) > i);
/** Whether a word's text has a wildcard: `*`, `?`, an extended glob (`+(`, `@(`, `!(`) or a bracket expression. */
export const hasGlob = (s: string): boolean => /(^|[^\\])([*?]|[+@!]\()/.test(s) || hasBracket(s);
