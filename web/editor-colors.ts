// The colours of the web page's editor: what VS Code shows for the same text with its own shell grammar and
// its default themes. Dark is Dark Modern (it includes Dark+ and Dark Visual Studio), light is Light Modern
// (Light+, Light Visual Studio); the two agree on every colour used here.
//
// Sources, read at microsoft/vscode commit c582c5307abefeb2c507725327a12c10b44f9bdd:
//  - extensions/shellscript/cgmanifest.json: the grammar is jeff-hykin/better-shell-syntax 1.8.7
//    (commit 35020b0bd79a90d3b262b4c13a8bb0b33adc1f45), shipped as syntaxes/shell-unix-bash.tmLanguage.json;
//  - extensions/theme-defaults/themes/{dark_modern,dark_plus,dark_vs,light_modern,light_plus,light_vs}.json:
//    the colour of a scope is the one of its longest matching `tokenColors` selector, a later rule winning.
// Each entry below is the scope the grammar gives the text of the kind, and the colour the themes give it.
// `null` is the editor's foreground (the themes give the scope no colour of its own).
//
// Our kinds and spans are kept as they are, and take the colour of the closest scope. Where the grammar has
// nothing that fits, or colours what we tell apart in one colour, the colour is one of the default themes' own:
//  - keyword: `keyword.control` (if, then, for, …). The grammar colours `time`, `function` and `local` blue
//    (storage, keyword.other) and `!`, `{`, `}`, `[[` like punctuation (no colour of their own).
//  - operator: `keyword.operator` (`|`, and the operators of tests and arithmetic: #d4d4d4 and #000000). The
//    grammar leaves `;`, `&&`, `&` and `()` in the editor's foreground (#cccccc, #3b3b3b), a little off.
//  - redirect: `keyword.operator.redirect`, the same colour as an operator.
//  - heredocDelimiter: the grammar gives `EOF` no colour. It takes the string colour, as `"` and `'` do
//    (`punctuation.definition.string`).
//  - substitution: `$(`, `<(`, `` ` ``, `$((` are punctuation, uncoloured outside strings and string-coloured
//    inside. They take the variable colour, as the `$` of a variable does (`punctuation.definition.variable`).
//  - glob: the grammar colours `*` blue in an argument (`variable.language.special.wildcard`), and
//    `keyword.operator.glob` in a test; the patterns of `case` are `string.regexp` (#d16969, #811f3f), the
//    colour of a pattern, and it keeps globs apart from options (blue).
//  - number: `constant.numeric`. Our numbers are the ones in arithmetic; a plain argument that is a number
//    is `string.unquoted.argument` in the grammar.
//  - Plain argument words are `string.unquoted.argument` (orange-brown) in the grammar. We have no kind for
//    them, so the editor leaves them in the foreground; the panel, which has the kind, colours them.
//  - command and builtin: both `entity.name.function.call` colours, the same; the grammar tells builtins
//    apart by scope only.
//  - A string's `$x` and `$( )` inside keep their own kinds' colours, as in the grammar (the `${`, `}` of a
//    parameter expansion are string-coloured there, variable-coloured here: our `variable` span is whole).
import type { Kind } from '../src/analyzer';
import type { HighlightKind } from '../src/highlight';

export interface EditorColour {
  /** The scope of the shell grammar for the same text. */
  readonly scope: string;
  /** Dark Modern, or null for the editor's foreground. */
  readonly dark: string | null;
  /** Light Modern, or null for the editor's foreground. */
  readonly light: string | null;
}

const COMMENT = { scope: 'comment.line.number-sign.shell', dark: '#6A9955', light: '#008000' };
const KEYWORD = { scope: 'keyword.control.shell', dark: '#C586C0', light: '#AF00DB' };
const FUNCTION = { scope: 'entity.name.function.call.shell', dark: '#DCDCAA', light: '#795E26' };
const STRING = { scope: 'string.quoted.double.shell', dark: '#CE9178', light: '#A31515' };
const VARIABLE = { scope: 'variable.other.normal.shell', dark: '#9CDCFE', light: '#001080' };
const STRING_DELIMITER = { ...STRING, scope: 'punctuation.definition.string.heredoc.delimiter.shell' };

/** The colour roles: the highlight kinds, and `argument` (a plain word after the command, which the panel colours but the editor has no kind for). */
export type ColourRole = HighlightKind | 'argument';

export const EDITOR_COLOURS: Record<ColourRole, EditorColour> = {
  argument: { scope: 'string.unquoted.argument.shell', dark: '#CE9178', light: '#A31515' },
  comment: COMMENT,
  keyword: KEYWORD,
  builtin: { ...FUNCTION, scope: 'support.function.builtin.shell' },
  command: { ...FUNCTION, scope: 'entity.name.command.shell' },
  function: FUNCTION,
  functionName: { ...FUNCTION, scope: 'entity.name.function.shell' },
  option: { scope: 'constant.other.option.shell', dark: '#569CD6', light: '#0000FF' },
  string: STRING,
  heredoc: { ...STRING, scope: 'string.unquoted.heredoc.shell' },
  heredocDelimiter: STRING_DELIMITER,
  variable: VARIABLE,
  assignment: { ...VARIABLE, scope: 'variable.other.assignment.shell' },
  substitution: { ...VARIABLE, scope: 'punctuation.definition.variable.shell' },
  number: { scope: 'constant.numeric.shell', dark: '#B5CEA8', light: '#098658' },
  operator: { scope: 'keyword.operator.pipe.shell', dark: '#D4D4D4', light: '#000000' },
  redirect: { scope: 'keyword.operator.redirect.shell', dark: '#D4D4D4', light: '#000000' },
  glob: { scope: 'string.regexp.unquoted.shell', dark: '#D16969', light: '#811F3F' },
  error: { scope: '(none)', dark: null, light: null },
};

/**
 * The colour role of each kind of the explanation panel (media/panel.css, `.kind-*`), which takes the
 * colour of the role. The panel's CSS holds the values as variables; test/editorColours.test.ts compares
 * them with this table, in light and dark. More compromises, besides the ones above:
 *  - subcommand, expansion (`{a,b}`, arrays, `?:`), test (`[ … ]`'s whole expression) and block (groups,
 *    loop bodies) have no scope of their own: they take the colour of a command, a variable and an operator.
 *  - number: arithmetic numbers are `constant.numeric`, but a number as a plain argument (`sleep 5`) is
 *    `string.unquoted.argument` in the grammar; the panel's number kind uses the first.
 *  - pattern: `variable.language.special.wildcard`, as the editor's glob.
 */
export const PANEL_KIND_ROLE: Record<Kind, ColourRole> = {
  command: 'command', subcommand: 'command', builtin: 'builtin', function: 'function', keyword: 'keyword', option: 'option',
  argument: 'argument', operator: 'operator', redirect: 'redirect', variable: 'variable', expansion: 'variable', substitution: 'substitution',
  string: 'string', number: 'number', comment: 'comment', assignment: 'assignment', test: 'operator', pattern: 'glob', block: 'operator', error: 'error',
};

/**
 * The `classic` palette (setting `colors`): the panel's own, one colour for each kind of part, in the variables of
 * VS Code's chart colours (the values of `--c-*` in media/panel.css). The editor uses it with these roles; plain
 * arguments, which the editor has no kind for, stay in the foreground there.
 */
export const CLASSIC_COLOURS = {
  command: 'var(--vscode-charts-blue, #3794ff)',
  option: 'var(--vscode-charts-orange, #d18616)',
  argument: 'var(--vscode-charts-green, #89d185)',
  operator: 'var(--vscode-charts-purple, #b180d7)',
  redirect: 'var(--vscode-charts-yellow, #cca700)',
  variable: 'var(--vscode-charts-red, #f14c4c)',
  muted: 'var(--vscode-descriptionForeground, #888)',
} as const;

/** The classic colour each role takes (the panel's `.kind-*` classes, by way of PANEL_KIND_ROLE). */
export const CLASSIC_ROLE: Record<ColourRole, keyof typeof CLASSIC_COLOURS> = {
  comment: 'muted', keyword: 'operator', builtin: 'command', command: 'command', function: 'command', functionName: 'command', option: 'option',
  argument: 'argument', string: 'argument', heredoc: 'argument', heredocDelimiter: 'argument', variable: 'variable', assignment: 'variable',
  substitution: 'variable', number: 'argument', operator: 'operator', redirect: 'redirect', glob: 'redirect', error: 'variable',
};

export type Colors = 'vscode' | 'classic';

/** The CSS colour of a kind in a palette. */
export function paletteColour(kind: HighlightKind, colors: Colors): string {
  if (kind === 'error') return 'var(--vscode-errorForeground)';
  return colors === 'classic' ? CLASSIC_COLOURS[CLASSIC_ROLE[kind]] : kindColour(kind);
}

/** The CSS colour of a kind in the VS Code palette, following the page's light or dark theme (`color-scheme`). */
export function kindColour(kind: HighlightKind): string {
  if (kind === 'error') return 'var(--vscode-errorForeground)';
  const { dark, light } = EDITOR_COLOURS[kind];
  return dark && light ? `light-dark(${light}, ${dark})` : 'var(--vscode-editor-foreground)';
}
