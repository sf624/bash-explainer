// PROTOTYPE (hi2 design study): the command names whose meaning a reader would not guess from the name, from the name
// facts (src/semantics/names.ts): nothing runs; a program runs where bash has only a builtin or a function of the name
// (`sudo cd`); a function or an alias hides a builtin or a program of the same name; a builtin turned off by `enable -n`;
// an alias that bash does not expand here. `builtin cd` and `command ls` are not surprising: the reader asked for them.
import { LineExplanation, Token } from '../analyzer-types';
import { Lang } from '../i18n';

export type Surprise = 'none' | 'noProgram' | 'shadow' | 'off' | 'unexpanded';

export function surprise(tok: Token): Surprise | undefined {
  const n = tok.name;
  if (!n) return undefined;
  if (n.runs === 'none') return 'none';
  if (n.noProgram) return 'noProgram';
  if ((n.runs === 'function' || n.runs === 'alias') && n.also.some((a) => a.kind === 'builtin' || a.kind === 'program')) return 'shadow';
  if (n.also.some((a) => a.off)) return 'off';
  if (n.also.some((a) => a.unexpanded)) return 'unexpanded';
  return undefined;
}

/** A short text for an inlay hint after the name: what runs, and why that is not what the name suggests. */
export function surpriseText(tok: Token, why: Surprise, lang: Lang): string {
  const n = tok.name!;
  const ja = lang === 'ja';
  const other = n.also.find((a) => a.kind === 'builtin' || a.kind === 'program')?.kind;
  const kindWord = (k: string) => (ja ? { builtin: '組み込み', program: 'プログラム', function: '関数', alias: 'エイリアス', keyword: '予約語', none: 'なし' }[k] ?? k : k);
  switch (why) {
    case 'none': return ja ? '何も実行されない' : 'nothing runs';
    case 'noProgram': return ja ? `別プログラムとして実行（${n.by ?? ''} 経由、そのプログラムはない）` : `run as a program by ${n.by ?? '?'}: no such program`;
    case 'shadow': return ja ? `${kindWord(n.runs)}（${kindWord(other!)}ではない）` : `${n.runs}, not the ${other}`;
    case 'off': return ja ? 'プログラム（組み込みは無効）' : 'program: the builtin is off';
    case 'unexpanded': return ja ? 'プログラム（エイリアスは展開されない）' : 'program: the alias is not expanded';
  }
}

/** The surprising names of a line's explanation, each once (a name on another line of the statement is left out). */
export function surprisingNames(ex: LineExplanation, line: number): { tok: Token; why: Surprise }[] {
  const out: { tok: Token; why: Surprise }[] = [];
  const walk = (t: Token) => {
    const why = surprise(t);
    if (why && t.span.start.line === line) out.push({ tok: t, why });
    t.children.forEach(walk);
  };
  ex.items.forEach(walk);
  return out;
}
