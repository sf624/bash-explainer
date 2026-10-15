import { LineExplanation, Pos, Token } from '../analyzer';
import { Lang } from '../i18n';

export const ui = {
  ja: {
    title: 'Bash Explain',
    line: (n: number) => `${n} 行目`,
    lineShort: (n: number) => `行 ${n}`,
    empty: 'この行には解説する内容がありません。',
    noEditor: 'bash スクリプトを開いてカーソルを置くと、その行の解説がここに表示されます。',
    modes: {
      hover: ['ホバー', 'マウスを乗せた行、またはコマンドで呼び出した行をフローティング表示'],
      panel: ['パネル', '右側のペインにカーソル行の解説を常に表示'],
      inline: ['インライン', 'カーソル行の行末に1行の要約を薄く表示'],
      both: ['ホバー + パネル', 'ホバーとパネルの両方を使う'],
    },
    pickMode: '解説の表示方法を選択',
    statusTooltip: 'Bash Explain: クリックで表示方法を切り替え',
    openInPanel: 'パネルで詳しく見る',
  },
  en: {
    title: 'Bash Explain',
    line: (n: number) => `Line ${n}`,
    lineShort: (n: number) => `line ${n}`,
    empty: 'Nothing to explain on this line.',
    noEditor: 'Open a bash script and place the cursor on a line to see its explanation here.',
    modes: {
      hover: ['Hover', 'Floating explanation when hovering a line or running the command'],
      panel: ['Panel', 'Always show the cursor line explanation in a side pane'],
      inline: ['Inline', 'Faint one-line summary at the end of the cursor line'],
      both: ['Hover + Panel', 'Use both hover and panel'],
    },
    pickMode: 'Choose how explanations are shown',
    statusTooltip: 'Bash Explain: click to change the display mode',
    openInPanel: 'Open in panel',
  },
} satisfies Record<Lang, unknown>;

export type DisplayMode = keyof typeof ui.ja.modes;

function code(text: string): string {
  const flat = text.replace(/\s*\n\s*/g, ' ⏎ ');
  const fence = flat.includes('`') ? '`` ' : '`';
  const close = flat.includes('`') ? ' ``' : '`';
  return fence + flat + close;
}

function contains(t: Token, p: Pos): boolean {
  const { start, end } = t.span;
  const afterStart = p.line > start.line || (p.line === start.line && p.character >= start.character);
  const beforeEnd = p.line < end.line || (p.line === end.line && p.character < end.character);
  return afterStart && beforeEnd;
}

/**
 * Markdown for the hover. Tokens under `at` (the mouse position) are emphasised.
 * `panelLink` is a command URI that opens this line in the panel.
 */
export function toMarkdown(ex: LineExplanation, lang: Lang, at?: Pos, panelLink?: string): string {
  const t = ui[lang];
  const out: string[] = [];
  let header = `**${t.title}** · ${t.line(ex.line + 1)}`;
  if (ex.context.length) {
    header += ' · _' + ex.context.map((c) => `${c.label} (${t.lineShort(c.line + 1)})`).join(' › ') + '_';
  }
  out.push(header, '');
  for (const n of ex.notes) out.push(`> ${n}`, '');
  if (!ex.items.length) {
    out.push(t.empty);
    return out.join('\n');
  }
  const walk = (tok: Token, depth: number) => {
    const hit = at && contains(tok, at);
    const label = hit ? `**${code(tok.label)}**` : code(tok.label);
    out.push(`${'  '.repeat(depth)}- ${label} — ${tok.explanation}`);
    for (const c of tok.children) walk(c, depth + 1);
  };
  for (const item of ex.items) walk(item, 0);
  if (panelLink) out.push('', '---', `[$(comment-discussion) ${t.openInPanel}](${panelLink})`);
  return out.join('\n');
}
