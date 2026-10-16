import { Example, Kind, LineExplanation, Pos, Span, Token } from '../analyzer';
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

/**
 * Where worked examples go: under the token they explain, before (`first`) or after (`last`) the
 * explanations of its parts, or all together at the end (`bottom`).
 */
export type ExamplePlacement = 'first' | 'last' | 'bottom';

function covers(outer: Span, inner: Span): boolean {
  const le = (a: Pos, b: Pos) => a.line < b.line || (a.line === b.line && a.character <= b.character);
  return le(outer.start, inner.start) && le(inner.end, outer.end);
}

/**
 * A copy of the explanation with each example moved onto the token for its anchor
 * (`Token.examples`): the outermost token with exactly that range, else the deepest one covering
 * it. Examples with no such token stay in `examples`, shown at the end.
 */
export function placeExamples(ex: LineExplanation): LineExplanation {
  const copy = (t: Token): Token => ({ ...t, children: t.children.map(copy), examples: undefined });
  const items = ex.items.map(copy);
  const rest: Example[] = [];
  for (const e of ex.examples) {
    let best: { tok: Token; depth: number } | undefined;
    let exact: Token | undefined;
    const visit = (t: Token, depth: number) => {
      if (!e.anchor || !covers(t.span, e.anchor)) return;
      if (!exact && covers(e.anchor, t.span)) exact = t;
      if (!best || depth >= best.depth) best = { tok: t, depth };
      t.children.forEach((c) => visit(c, depth + 1));
    };
    items.forEach((t) => visit(t, 0));
    const target = exact ?? best?.tok;
    if (target) (target.examples ??= []).push(e);
    else rest.push(e);
  }
  return { ...ex, items, examples: rest };
}

/** Theme colours per token kind; the same palette as the panel (media/panel.css). */
const KIND_COLOR: Record<Kind, string> = {
  command: '--vscode-charts-blue', builtin: '--vscode-charts-blue', function: '--vscode-charts-blue',
  option: '--vscode-charts-orange',
  argument: '--vscode-charts-green', string: '--vscode-charts-green', number: '--vscode-charts-green',
  operator: '--vscode-charts-purple', keyword: '--vscode-charts-purple', block: '--vscode-charts-purple', test: '--vscode-charts-purple',
  redirect: '--vscode-charts-yellow', pattern: '--vscode-charts-yellow',
  variable: '--vscode-charts-red', expansion: '--vscode-charts-red', substitution: '--vscode-charts-red', assignment: '--vscode-charts-red',
  comment: '--vscode-descriptionForeground',
  error: '--vscode-errorForeground',
};

/** Escape text for inline HTML inside Markdown (entities also stop `*`, `_` etc. acting as Markdown). */
function esc(text: string): string {
  return text.replace(/[&<>"'*_`\\[\]~|#$]/g, (c) => `&#${c.charCodeAt(0)};`).replace(/ /g, '&nbsp;');
}

/** Hover HTML only keeps `<span style>` in exactly this shape: `color:<#hex|var(--vscode-…)>;`. */
function colored(text: string, kind: Kind): string {
  return `<span style="color:var(${KIND_COLOR[kind]});">${esc(text)}</span>`;
}

function contains(t: Token, p: Pos): boolean {
  const { start, end } = t.span;
  const afterStart = p.line > start.line || (p.line === start.line && p.character >= start.character);
  const beforeEnd = p.line < end.line || (p.line === end.line && p.character < end.character);
  return afterStart && beforeEnd;
}

/** Split a line into runs, each owned by the deepest token covering it (as the panel does). */
export function lineSegments(text: string, line: number, items: Token[]): { text: string; kind?: Kind }[] {
  const owner: (Token | undefined)[] = new Array(text.length).fill(undefined);
  const depthAt: number[] = new Array(text.length).fill(-1);
  const visit = (tok: Token, depth: number) => {
    const { start, end } = tok.span;
    if (start.line <= line && end.line >= line) {
      const from = start.line < line ? 0 : start.character;
      const to = Math.min(end.line > line ? text.length : end.character, text.length);
      for (let i = from; i < to; i++) {
        if (depth >= depthAt[i]) {
          depthAt[i] = depth;
          owner[i] = tok;
        }
      }
    }
    tok.children.forEach((c) => visit(c, depth + 1));
  };
  items.forEach((t) => visit(t, 0));
  const out: { text: string; kind?: Kind }[] = [];
  for (let i = 0; i < text.length;) {
    let j = i;
    while (j < text.length && owner[j] === owner[i]) j++;
    const part = text.slice(i, j);
    out.push({ text: part, kind: part.trim() ? owner[i]?.kind : undefined });
    i = j;
  }
  return out;
}

/**
 * Markdown (with inline HTML, so `supportHtml` must be on) for the hover. Labels are coloured
 * by token kind, and `lineText` is shown regex101-style at the top. Tokens under `at` (the
 * mouse position) are emphasised. `panelLink` is a command URI that opens this line in the panel.
 */
export function toMarkdown(ex: LineExplanation, lang: Lang, at?: Pos, panelLink?: string, lineText?: string, placement: ExamplePlacement = 'first'): string {
  if (placement !== 'bottom') ex = placeExamples(ex);
  const t = ui[lang];
  const out: string[] = [];
  let header = `**${t.title}** · ${t.line(ex.line + 1)}`;
  if (ex.context.length) {
    header += ' · _' + ex.context.map((c) => `${c.label} (${t.lineShort(c.line + 1)})`).join(' › ') + '_';
  }
  out.push(header, '');
  if (lineText?.trim() && ex.items.length) {
    const segs = lineSegments(lineText, ex.line, ex.items);
    while (segs.length && !segs[0].text.trim()) segs.shift();
    if (segs.length) segs[0].text = segs[0].text.trimStart();
    out.push('<code>' + segs.map((g) => (g.kind ? colored(g.text, g.kind) : esc(g.text))).join('') + '</code>', '');
  }
  for (const n of ex.notes) out.push(`> ${n}`, '');
  if (!ex.items.length) {
    out.push(t.empty);
    return out.join('\n');
  }
  const walk = (tok: Token, depth: number) => {
    const flat = tok.label.replace(/\s*\n\s*/g, ' ⏎ ');
    const label = `<code>${colored(flat, tok.kind)}</code>`;
    const shown = at && contains(tok, at) ? `<strong>${label}</strong>` : label;
    out.push(`${'  '.repeat(depth)}- ${shown} — ${tok.explanation}`);
    // Indented to the item's content so the example stays inside it; no blank lines keep the list tight.
    const examples = tok.examples?.length ? examplesMarkdown(tok.examples, '  '.repeat(depth + 1)) : [];
    if (placement === 'first') out.push(...examples);
    for (const c of tok.children) walk(c, depth + 1);
    if (placement !== 'first') out.push(...examples);
  };
  for (const item of ex.items) walk(item, 0);
  out.push(...examplesMarkdown(ex.examples));
  if (panelLink) out.push('', '---', `[$(comment-discussion) ${t.openInPanel}](${panelLink})`);
  return out.join('\n');
}

/** Examples as headings with one code block per section, so every line keeps its own row. */
export function examplesMarkdown(examples: Example[], indent?: string): string[] {
  const out: string[] = [];
  for (const e of examples) {
    if (indent === undefined) out.push('', '---', '', `#### ${e.title}`);
    else out.push(`${indent}##### ${e.title}`);
    for (const sec of e.sections) {
      const lines = sec.lines.length ? sec.lines : [sec.empty ?? ''];
      // The fence must be longer than any run of backticks inside.
      const longest = Math.max(2, ...lines.map((l) => Math.max(0, ...(l.match(/`+/g) ?? []).map((m) => m.length))));
      const fence = '`'.repeat(longest + 1);
      if (indent === undefined) out.push('', `**${sec.label}**`, '', `${fence}text`, ...lines, fence);
      // A heading and a fence may each interrupt a paragraph, so the label needs no blank line around it.
      else out.push(`${indent}**${sec.label}**`, `${indent}${fence}text`, ...lines.map((l) => indent + l), `${indent}${fence}`);
    }
  }
  return out;
}
