import { Example, Kind, LineExplanation, Pos, Span, Token } from '../analyzer';
import { SHELL_NAMES } from '../dialect';
import { Lang } from '../i18n';
import { joinParts, LabelPart, labelParts } from '../label';
import { manualLabel, SECTIONS } from '../manual';

export const ui = {
  ja: {
    title: 'Bash Explainer',
    line: (n: number) => `${n} 行目`,
    lineShort: (n: number) => `行 ${n}`,
    forShell: (name: string) => `${name} 向けとして確認`,
    empty: 'この行には解説する内容がありません。',
    noEditor: 'bash スクリプトを開いてカーソルを置くと、その行の解説がここに表示されます。',
    features: {
      hover: ['ホバー', 'マウスを乗せた行の解説をフローティング表示'],
      inline: ['インライン', 'カーソル行の行末に1行の要約を薄く表示'],
      panel: ['パネルを自動で開く', 'bash スクリプトを開いたら、カーソル行に追従するパネルを開く'],
    },
    short: { hover: 'ホバー', inline: 'インライン', panel: 'パネル' },
    off: 'オフ',
    pickFeatures: '使う表示方法を選択（複数可）',
    statusTooltip: 'Bash Explainer: クリックで表示方法を切り替え',
    openInPanel: 'パネルで詳しく見る',
    settings: '設定',
    panel: {
      copy: 'Markdown でコピー', copied: '解説を Markdown としてコピーしました。', expandAll: 'すべて展開', collapseAll: 'すべて折りたたむ',
      reference: '早見表', search: '検索（例: ${、2>&1、-f、grep）', back: '← 解説に戻る', shell: 'シェル', yq: 'yq', auto: '自動',
      editHint: '入力は書き換えられます（結果はその場で更新）', noMatch: '該当なし',
    },
  },
  en: {
    title: 'Bash Explainer',
    line: (n: number) => `Line ${n}`,
    lineShort: (n: number) => `line ${n}`,
    forShell: (name: string) => `checked for ${name}`,
    empty: 'Nothing to explain on this line.',
    noEditor: 'Open a bash script and place the cursor on a line to see its explanation here.',
    features: {
      hover: ['Hover', 'Floating explanation of the line under the mouse'],
      inline: ['Inline', 'Faint one-line summary at the end of the cursor line'],
      panel: ['Open the panel automatically', 'Open the panel that follows the cursor line when a bash script is opened'],
    },
    short: { hover: 'Hover', inline: 'Inline', panel: 'Panel' },
    off: 'Off',
    pickFeatures: 'Choose how explanations are shown (any number)',
    statusTooltip: 'Bash Explainer: click to change how explanations are shown',
    openInPanel: 'Open in panel',
    settings: 'Settings',
    panel: {
      copy: 'Copy as Markdown', copied: 'Copied the explanation as Markdown.', expandAll: 'Expand all', collapseAll: 'Collapse all',
      reference: 'Quick reference', search: 'Search (e.g. ${, 2>&1, -f, grep)', back: '← Back to the explanation', shell: 'Shell', yq: 'yq', auto: 'Auto',
      editHint: 'You can edit the input; the result updates as you type', noMatch: 'Nothing found',
    },
  },
} satisfies Record<Lang, unknown>;

/** The sections of the manual a note cites: those of the fact it says (`LineExplanation.facts`), if it is one. */
export function noteRefs(ex: LineExplanation, note: string): readonly string[] | undefined {
  return ex.facts?.find((f) => f.text === note)?.refs;
}

/** "Bash manual [3.2.5.2](…), [6.4](…)": the sections as Markdown links, after the words "Bash manual". */
export function refsMarkdown(lang: Lang, refs: readonly string[]): string {
  const [first, ...rest] = refs.map((id) => `[${id}](${SECTIONS.get(id)!.url} "${SECTIONS.get(id)!.title}")`);
  return [manualLabel(lang, [first]), ...rest].join(', ');
}

/** " (Bash manual 3.7.2)", after a row that cites sections. */
export function refsText(lang: Lang, refs: readonly string[]): string {
  return ` (${manualLabel(lang, refs)})`;
}

/** Display features that can each be turned on or off. */
export type Feature = keyof typeof ui.ja.features;

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
  command: '--vscode-charts-blue', subcommand: '--vscode-charts-blue', builtin: '--vscode-charts-blue', function: '--vscode-charts-blue',
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
  if (ex.shell) header += ` · ${t.forShell(SHELL_NAMES[ex.shell])}`;
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
  // A note, and a token, end with the sections of the manual they are about, small.
  const small = (refs: readonly string[] | undefined) => (refs?.length ? ` <small>${refsMarkdown(lang, refs)}</small>` : '');
  for (const n of ex.notes) out.push(`> ${n}${small(noteRefs(ex, n))}`, '');
  if (!ex.items.length) {
    out.push(t.empty);
    return out.join('\n');
  }
  const walk = (tok: Token, depth: number) => {
    // A code part in `<code>`, a placeholder in italics and the muted colour; the parts are a space apart.
    const label = joinParts(labelParts(tok), (p) => (p.placeholder
      ? `<i>${colored(p.text, 'comment')}</i>`
      : `<code>${colored(p.text.replace(/\s*\n\s*/g, ' ⏎ '), tok.kind)}</code>`));
    const shown = at && contains(tok, at) ? `<strong>${label}</strong>` : label;
    out.push(`${'  '.repeat(depth)}- ${shown} — ${tok.explanation}${small(tok.refs)}`);
    // Indented to the item's content so the example stays inside it; no blank lines keep the list tight.
    const examples = tok.examples?.length ? examplesMarkdown(tok.examples, '  '.repeat(depth + 1)) : [];
    if (placement === 'first') out.push(...examples);
    for (const c of tok.children) walk(c, depth + 1);
    if (placement !== 'first') out.push(...examples);
  };
  for (const item of ex.items) walk(item, 0);
  out.push(...examplesMarkdown(ex.examples));
  const links = [panelLink && `[$(comment-discussion) ${t.openInPanel}](${panelLink})`, `[$(gear) ${t.settings}](command:bashExplainer.openSettings)`];
  out.push('', '---', links.filter(Boolean).join(' &nbsp;·&nbsp; '));
  return out.join('\n');
}

/** Examples as headings with one code block per section, so every line keeps its own row. */
export function examplesMarkdown(examples: Example[], indent?: string): string[] {
  const out: string[] = [];
  for (const e of examples) {
    if (indent === undefined) out.push('', '---', '', `#### ${e.title}`);
    else out.push(`${indent}##### ${e.title}`);
    if (e.note) out.push(...(indent === undefined ? ['', `> ${e.note}`] : [`${indent}> ${e.note}`]));
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

/** Text as a Markdown code span: the fence is longer than any run of backticks inside, and a backtick at either end is set off by a space. */
export function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((m) => m.length));
  const fence = '`'.repeat(longest + 1);
  return text.startsWith('`') || text.endsWith('`') ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
}

/** A label as Markdown: code parts as code spans, placeholders in italics (`if` *condition* `then`). */
export function labelMarkdown(parts: readonly LabelPart[]): string {
  return joinParts(parts, (p) => (p.placeholder ? `*${p.text}*` : codeSpan(p.text.replace(/\s*\n\s*/g, ' ⏎ '))));
}

/** The explanation as plain Markdown (no HTML), for pasting into reviews and docs. */
export function toPlainMarkdown(ex: LineExplanation, lineText: string, where: string, lang: Lang = 'en'): string {
  const out: string[] = [`**${where}**`, '', '```bash', lineText.trim(), '```', ''];
  const links = (refs: readonly string[] | undefined) => (refs?.length ? ` (${refsMarkdown(lang, refs)})` : '');
  for (const n of ex.notes) out.push(`> ${n}${links(noteRefs(ex, n))}`, '');
  const walk = (tok: Token, depth: number) => {
    out.push(`${'  '.repeat(depth)}- ${labelMarkdown(labelParts(tok))} — ${tok.explanation}${links(tok.refs)}`);
    for (const c of tok.children) walk(c, depth + 1);
  };
  for (const item of ex.items) walk(item, 0);
  out.push(...examplesMarkdown(ex.examples));
  return out.join('\n').trim() + '\n';
}

/**
 * The tree without levels below `maxDepth` (1: only the top level; 0: everything). Examples of
 * a removed token move to the deepest token still shown, since they are placed by source range.
 */
export function pruneDepth(items: Token[], maxDepth: number): Token[] {
  if (!maxDepth || maxDepth < 1) return items;
  const cut = (t: Token, depth: number): Token => ({ ...t, children: depth + 1 >= maxDepth ? [] : t.children.map((c) => cut(c, depth + 1)) });
  return items.map((t) => cut(t, 0));
}
