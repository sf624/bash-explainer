// The name hints (docs/design/hover.md): an inlay hint after a command name only where it does not run what a reader
// would guess from the name, from the name facts (src/semantics/names.ts). Pure code, shared by VS Code and the
// Language Server.
import type { LineExplanation, Pos, Token } from '../analyzer-types';
import type { Lang } from '../i18n';
import { nameKindWord } from '../messages';
import type { NameFacts } from '../semantics/names';

/**
 * Why a name surprises: nothing runs (`builtin ls`); a program runs where bash has only a builtin of the name
 * (`sudo cd`); a function or an alias hides a builtin or a program of the same name; a builtin turned off by
 * `enable -n`; an alias that bash does not expand here. A name the reader asked for is no surprise: `builtin cd`,
 * `command ls`, `\ls`, or a program that `xargs` or `sudo` runs (`sudo echo`).
 */
export type Surprise = 'none' | 'noProgram' | 'shadow' | 'off' | 'unexpanded';

export function surprise(f: NameFacts): Surprise | undefined {
  if (f.runs === 'none') return 'none';
  if (f.noProgram) return 'noProgram';
  if ((f.runs === 'function' || f.runs === 'alias') && f.also.some((a) => a.kind === 'builtin' || a.kind === 'program')) return 'shadow';
  if (f.also.some((a) => a.off)) return 'off';
  if (f.also.some((a) => a.unexpanded)) return 'unexpanded';
  return undefined;
}

/** The hint's text: what runs, and why that is not what the name suggests ("function, not the builtin"). Plain text: a hint shows no Markdown. */
export function hintLabel(f: NameFacts, why: Surprise, lang: Lang): string {
  const ja = lang === 'ja';
  const runs = nameKindWord(lang, f.runs);
  switch (why) {
    case 'none': return runs;
    case 'noProgram': {
      const by = f.by === undefined ? '' : ja ? `${f.by} が実行。` : `, run by ${f.by}`;
      return ja ? `${runs}（${by}ふつうは存在しない）` : `${runs}${by}: usually there is none`;
    }
    case 'shadow': {
      const other = nameKindWord(lang, f.also.find((a) => a.kind === 'builtin' || a.kind === 'program')!.kind);
      return ja ? `${runs}（${other}ではない）` : `${runs}, not the ${other}`;
    }
    case 'off': return ja ? `${runs}（ビルトインは無効）` : `${runs}: the builtin is off`;
    case 'unexpanded': return ja ? `${runs}（エイリアスは展開されない）` : `${runs}: the alias is not expanded`;
  }
}

/** A hint after a command name: where it goes, its text, and its tooltip (Markdown: what runs, what else the name is, its meaning). */
export interface NameHint {
  /** Just after the name. */
  position: Pos;
  label: string;
  tooltip: string;
  /** The token of the command name. */
  tok: Token;
}

/**
 * The hints of a line: one after each surprising command name that starts on it (a name on another line of the same
 * statement gets its hint from that line). `lineText` finds the end of the name, as a command's token covers the
 * whole command.
 */
export function nameHints(ex: LineExplanation, line: number, lineText: string, lang: Lang): NameHint[] {
  const out: NameHint[] = [];
  const walk = (t: Token) => {
    const why = t.name && surprise(t.name);
    if (why && t.span.start.line === line) {
      const word = /^\S*/.exec(lineText.slice(t.span.start.character))![0];
      const s = t.name!.said;
      const tooltip = [`\`${t.name!.name}\` **${s.kind}**${s.by ? ` — ${s.by}` : ''}`, s.also, t.explanation].filter(Boolean).join('\n\n');
      out.push({ position: { line, character: t.span.start.character + word.length }, label: hintLabel(t.name!, why, lang), tooltip, tok: t });
    }
    t.children.forEach(walk);
  };
  ex.items.forEach(walk);
  return out;
}
