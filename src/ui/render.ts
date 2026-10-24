import { Example, Kind, LineExplanation, Pos, Span, Token } from '../analyzer-types';
import { basisLines, type BasisSaid, type TryIt } from '../basis';
import { SHELL_NAMES } from '../dialect';
import { Lang } from '../i18n';
import { joinParts, LabelPart, labelParts } from '../label';
import { manualLabel, SECTIONS } from '../manual';
import { errorColour, Role, roleColour, ThemeKind } from './palette';

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
      editHint: '書き換えられます（結果はその場で更新）', noMatch: '該当なし',
      views: '表示', listView: '意味', treeView: '読まれ方',
      // PROTOTYPE (src/basis.ts): around a try-it.
      tryIt: '端末で試す', tryItHint: 'このコマンドを自分の端末に貼り付けて実行する（ここでは実行されない）', prints: '出力', copyCode: 'コピー', copiedCode: 'コピーしました',
      tree: {
        label: '行の各部分を誰が読むか', show: '表示',
        // The steps of the tree, from the line alone to every layer: their short names (the buttons) and their names.
        steps: [['行', '行'], ['リスト', 'リストとパイプライン'], ['コマンド', 'コマンド'], ['単語', '単語'], ['単語の中', '単語の中身（クォートと展開）'],
          ['スクリプト', '中のスクリプト'], ['引数', '各コマンドによる引数の読み方'], ['言語', '言語']],
        stepper: {
          group: 'ステップ', back: '前のステップ', forward: '次のステップ',
          step: 'ステップ {i}/{n}：{name}', empty: 'この行では増えるものなし', jump: 'ステップを選ぶ',
        },
        reads: '{name} が読む',
        bands: { bash: 'bash', child: { subshell: 'サブシェル', shell: '新しいシェル', same: '同じシェルでもう一度', remote: 'リモートのシェル', container: 'コンテナのシェル' } },
        readers: {
          bash: 'bash が解析する',
          child: {
            subshell: 'サブシェル（このシェルのコピー）がもう一度解析する', shell: '新しく起動したシェル（別のプロセス）がもう一度解析する', same: 'それを実行するシェルが、この文字列をもう一度解析する（新しいプロセスなし）',
            remote: '別のマシンのシェルが解析する', container: 'コンテナの中のシェルが解析する',
          },
          command: 'bash ではなく {name} が読む', language: '{name} が読む独自の言語', bashLanguage: 'bash 自身が読む（正規表現の照合、POSIX の拡張正規表現(ERE)）',
        },
        kinds: {
          line: 'bash がこの行を読む', script: '中のスクリプト', list: 'リスト', pipeline: 'パイプライン', command: '単純コマンド', compound: '複合コマンド',
          clause: '節', coprocess: 'コプロセス', function: '関数', commandName: 'コマンド名', aliasWord: 'エイリアス（読むときに置き換わる）', expandedName: '最初の単語', option: 'オプション', argument: '引数',
          assignmentArgument: '代入の引数', word: '単語', name: '名前', assignment: '代入', redirect: 'リダイレクト', heredoc: 'ヒアドキュメント', quote: 'クォート',
          expansion: '展開', substitution: '置換', arithmetic: '算術式展開', brace: 'ブレース展開', operator: '演算子', keyword: 'キーワード',
          comment: 'コメント', part: '部分',
        },
        commandKinds: { argument: 'オペランド' },
        resolves: { alias: 'エイリアス', keyword: '予約語', function: '関数', builtin: 'ビルトイン', file: '外部コマンド', none: '実行されない' },
        tokenKinds: {
          command: '実行', subcommand: 'サブコマンド', builtin: 'ビルトイン', function: '関数', alias: 'エイリアス', keyword: 'キーワード', option: 'オプション', argument: '引数',
          operator: '演算子', redirect: 'リダイレクト', variable: '変数', expansion: '展開', substitution: '置換', string: 'リテラル',
          number: '数値', comment: 'コメント', assignment: '代入', test: '条件', pattern: 'パターン', block: 'ブロック', error: 'エラー',
        },
        about: {
          line: 'bash はこの行をコマンドに分け、単純コマンドをさらに代入・単語・リダイレクトに分ける。',
          script: 'サブシェルがこのテキストを独立したスクリプトとしてもう一度解析し、実行する。',
          command: '単純コマンド: 代入・単語・リダイレクトからなる。bash が単語を展開し、最初のフィールドをコマンド名、残りを引数とする。',
          commandName: 'コマンド名: bash が探し（関数、ビルトイン、PATH の中のファイルの順）、引数を渡して実行する。',
          aliasWord: 'エイリアス: bash は行を読むときに、最初の単語をエイリアスの中身に置き換える。単語の展開より前なので、探すコマンド名は中身の最初の単語で、残りは引数になる。',
          option: '予約語のオプション: bash は書いたとおりに読む。展開する単語ではない。',
          expandedName: 'コマンド名は実行するときに決まる: bash が単語を展開し、最初のフィールドがコマンド名、残りが引数になる。この単語が何にも展開されなければ、次の単語が名前になる。',
          argument: '引数: bash が展開し、そのフィールドをコマンドに渡す。',
          assignmentArgument: '代入の形の引数: bash は代入として展開し（値は単語分割もグロブもされない）、ビルトインに渡す。ビルトインが代入する。',
          word: '単語: bash が展開し、その結果を渡す。',
          heredoc: 'ヒアドキュメントの本文: コマンドの標準入力(fd 0)になる。',
          language: '単語の中にある独自の言語: bash ではなく、コマンドが独自の規則で読む。',
          bashLanguage: '`=~` の右辺の正規表現: bash 自身が、POSIX の拡張正規表現(ERE)の規則で左辺と照合する。',
        },
        languages: {
          regex: '正規表現', glob: 'glob パターン', sed: 'sed スクリプト', awk: 'awk プログラム', jq: 'jq フィルター', yq4: 'yq の式', yq3path: 'yq のパス',
          printf: 'printf の書式', echo: 'エスケープ', date: 'date の書式', perl: 'Perl', mode: 'ファイルモード', umask: 'umask', sortkey: 'ソートキー',
          cutfields: 'フィールドの範囲', cutchars: '文字の範囲', trset: '文字の集合', getopts: 'オプション文字', getoptshort: 'オプション文字',
          getoptlong: '長いオプション', gitformat: 'git の書式', gitdate: 'git の日付', arith: '算術式',
        },
      },
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
      editHint: 'Editable; the result updates as you type', noMatch: 'Nothing found',
      views: 'View', listView: 'Meaning', treeView: 'Reading',
      // PROTOTYPE (src/basis.ts): around a try-it.
      tryIt: 'Try it in your terminal', tryItHint: 'Paste this command into your own terminal and run it (it is not run here)', prints: 'Prints', copyCode: 'Copy', copiedCode: 'Copied',
      tree: {
        label: 'Who reads each part of the line', show: 'Show',
        steps: [['Line', 'the line'], ['Lists', 'lists and pipelines'], ['Commands', 'commands'], ['Words', 'words'], ['Inside', 'inside the words (quotes and expansions)'],
          ['Scripts', 'scripts inside'], ['Arguments', 'how each command reads its arguments'], ['Languages', 'languages']],
        stepper: {
          group: 'Steps', back: 'Previous step', forward: 'Next step',
          step: 'Step {i} of {n}: {name}', empty: 'Adds nothing on this line', jump: 'Choose a step',
        },
        reads: '{name} reads',
        bands: { bash: 'bash', child: { subshell: 'subshell', shell: 'new shell', same: 'same shell, again', remote: 'remote shell', container: 'container shell' } },
        readers: {
          bash: 'bash parses it',
          child: {
            subshell: 'a subshell (a copy of this shell) parses it again', shell: 'a newly started shell (another process) parses it again', same: 'the shell that runs it parses this string again (no new process)',
            remote: 'a shell on another machine parses it', container: 'a shell in the container parses it',
          },
          command: '{name} reads it, not bash', language: 'a language of its own, read by {name}', bashLanguage: 'bash reads it itself (its regex matching, POSIX ERE)',
        },
        kinds: {
          line: 'bash reads the line', script: 'script inside', list: 'list', pipeline: 'pipeline', command: 'simple command', compound: 'compound command',
          clause: 'clause', coprocess: 'coprocess', function: 'function', commandName: 'command name', aliasWord: 'alias, replaced when the line is read', expandedName: 'first word', option: 'option', argument: 'argument',
          assignmentArgument: 'assignment argument', word: 'word', name: 'name', assignment: 'assignment', redirect: 'redirection', heredoc: 'here-document', quote: 'quotes',
          expansion: 'expansion', substitution: 'substitution', arithmetic: 'arithmetic', brace: 'brace expansion', operator: 'operator', keyword: 'keyword',
          comment: 'comment', part: 'part',
        },
        commandKinds: { argument: 'operand' },
        resolves: { alias: 'alias', keyword: 'reserved word', function: 'function', builtin: 'builtin', file: 'program', none: 'nothing runs' },
        tokenKinds: {
          command: 'runs', subcommand: 'subcommand', builtin: 'builtin', function: 'function', alias: 'alias', keyword: 'keyword', option: 'option', argument: 'argument',
          operator: 'operator', redirect: 'redirection', variable: 'variable', expansion: 'expansion', substitution: 'substitution', string: 'literal',
          number: 'number', comment: 'comment', assignment: 'assignment', test: 'condition', pattern: 'pattern', block: 'block', error: 'error',
        },
        about: {
          line: 'bash splits the line into commands, then each simple command into assignments, words and redirections.',
          script: 'A subshell parses this text again, as a script of its own, and runs it.',
          command: 'A simple command: assignments, words and redirections. bash expands the words; the first field is the command name, and the others are its arguments.',
          commandName: 'The command name: bash looks it up (a function, a builtin, then a file in PATH) and runs it with the arguments.',
          aliasWord: 'An alias: bash replaces the first word with the text of the alias when it reads the line. That comes before the words are expanded, so the name it looks up is the first word of the text, and the rest are arguments.',
          option: 'An option of a reserved word: bash reads it as written. It is not a word that bash expands.',
          expandedName: 'The command name is known only when it runs: bash expands the words, and the first field is the name, the others its arguments. If this word expands to nothing, the next word gives the name.',
          argument: 'An argument: bash expands it and passes its fields to the command.',
          assignmentArgument: 'An argument that is an assignment: bash expands it as an assignment (no word splitting or globbing of the value) and passes it to the builtin, which assigns it.',
          word: 'A word: bash expands it, then passes on the result.',
          heredoc: 'The body of the here-document: it becomes the standard input (fd 0) of the command.',
          language: 'A language of its own inside the word: the command reads it by its own rules, not bash.',
          bashLanguage: 'The regex on the right of `=~`: bash itself matches the left side against it, by the rules of a POSIX extended regular expression (ERE).',
        },
        languages: {
          regex: 'regex', glob: 'glob pattern', sed: 'sed script', awk: 'awk program', jq: 'jq filter', yq4: 'yq expression', yq3path: 'yq path',
          printf: 'printf format', echo: 'escapes', date: 'date format', perl: 'Perl', mode: 'file mode', umask: 'umask', sortkey: 'sort key',
          cutfields: 'field list', cutchars: 'character list', trset: 'character set', getopts: 'option letters', getoptshort: 'option letters',
          getoptlong: 'long options', gitformat: 'git format', gitdate: 'git date', arith: 'arithmetic',
        },
      },
    },
  },
} satisfies Record<Lang, unknown>;

/** The sections of the manual a note cites: those of the fact it says (`LineExplanation.facts`), if it is one. */
export function noteRefs(ex: LineExplanation, note: string): readonly string[] | undefined {
  return ex.facts?.find((f) => f.text === note)?.refs;
}

/** PROTOTYPE (src/basis.ts): the basis and try-it of a note, from the fact it says. */
export function noteBasis(ex: LineExplanation, note: string): { basis?: BasisSaid; tryIt?: TryIt } {
  const f = ex.facts?.find((x) => x.text === note);
  return { ...(f?.basis ? { basis: f.basis } : {}), ...(f?.tryIt ? { tryIt: f.tryIt } : {}) };
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

/**
 * A token's explanation for an output with no badge (the hover, Markdown, the CLI): with the kind of its command name,
 * and who runs it, when it is one (`Token.name`): "Print arguments to stdout (builtin)".
 */
export function explained(tok: Token): string {
  return tok.name ? tok.explanation + tok.name.said.short : tok.explanation;
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

/** The colour role of each token kind; the same palette as the panel (media/panel.css). */
const KIND_ROLE: Record<Kind, Role | 'comment' | 'error'> = {
  command: 'command', subcommand: 'command', builtin: 'command', function: 'command', alias: 'command',
  option: 'option',
  argument: 'argument', string: 'argument', number: 'argument',
  operator: 'operator', keyword: 'operator', block: 'operator', test: 'operator',
  redirect: 'redirect', pattern: 'redirect',
  variable: 'variable', expansion: 'variable', substitution: 'variable', assignment: 'variable',
  comment: 'comment',
  error: 'error',
};

/** The CSS colour of a token kind in the hover, in a theme of that kind (src/ui/palette.ts). */
function kindColor(kind: Kind, theme: ThemeKind): string {
  const role = KIND_ROLE[kind];
  if (role === 'comment') return 'var(--vscode-descriptionForeground)';
  if (role === 'error') return errorColour(theme);
  return roleColour(role, theme);
}

/** Escape text for inline HTML inside Markdown (entities also stop `*`, `_` etc. acting as Markdown). */
function esc(text: string): string {
  return text.replace(/[&<>"'*_`\\[\]~|#$]/g, (c) => `&#${c.charCodeAt(0)};`).replace(/ /g, '&nbsp;');
}

/** Hover HTML only keeps `<span style>` in exactly this shape: `color:<#hex|var(--vscode-…)>;`. */
function colored(text: string, kind: Kind, theme: ThemeKind): string {
  return `<span style="color:${kindColor(kind, theme)};">${esc(text)}</span>`;
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
 * `theme` is the kind of the active colour theme, whose colours the labels take.
 */
export function toMarkdown(ex: LineExplanation, lang: Lang, at?: Pos, panelLink?: string, lineText?: string, placement: ExamplePlacement = 'first', theme: ThemeKind = 'dark'): string {
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
    out.push('<code>' + segs.map((g) => (g.kind ? colored(g.text, g.kind, theme) : esc(g.text))).join('') + '</code>', '');
  }
  // A note, and a token, end with the sections of the manual they are about, small.
  const small = (refs: readonly string[] | undefined) => (refs?.length ? ` <small>${refsMarkdown(lang, refs)}</small>` : '');
  for (const n of ex.notes) out.push(`> ${n}${small(noteRefs(ex, n))}`, ...basisLines(lang, noteBasis(ex, n), 'markdown').map((l) => `> <small>${l}</small>`), '');
  if (!ex.items.length) {
    out.push(t.empty);
    return out.join('\n');
  }
  const walk = (tok: Token, depth: number) => {
    // A code part in `<code>`, a placeholder in italics and the muted colour; the parts are a space apart.
    const label = joinParts(labelParts(tok), (p) => (p.placeholder
      ? `<i>${colored(p.text, 'comment', theme)}</i>`
      : `<code>${colored(p.text.replace(/\s*\n\s*/g, ' ⏎ '), tok.kind, theme)}</code>`));
    const shown = at && contains(tok, at) ? `<strong>${label}</strong>` : label;
    out.push(`${'  '.repeat(depth)}- ${shown} — ${explained(tok)}${small(tok.refs)}`, ...basisLines(lang, tok, 'markdown').map((l) => `${'  '.repeat(depth + 1)}<small>${l}</small>  `));
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
  for (const n of ex.notes) out.push(`> ${n}${links(noteRefs(ex, n))}`, ...basisLines(lang, noteBasis(ex, n), 'markdown').map((l) => `> ${l}`), '');
  const walk = (tok: Token, depth: number) => {
    out.push(`${'  '.repeat(depth)}- ${labelMarkdown(labelParts(tok))} — ${explained(tok)}${links(tok.refs)}`, ...basisLines(lang, tok, 'markdown').map((l) => `${'  '.repeat(depth + 1)}${l}  `));
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
