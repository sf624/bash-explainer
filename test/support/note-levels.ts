import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { regionLines } from '../../scripts/level-css';
import { LEVELS, SEVERITIES } from '../../src/levels';
import { base, counted as countedAny, enclosing, isAllowed, lineOf, parseSource, sourceFiles, type Match as MatchOf } from './scan';

// The scan behind test/note-levels.test.ts (docs/design/sources.md, row 13, stage SA, step SA4): where code names the level of a note
// (a severity, an icon, a colour, a rank, a mark) without going through the one table that holds them: the level table, src/levels.ts
// (three-levels.md, step 1a), with the catalog's levels of each note in src/messages.ts. The style sheets' rules of the levels are
// written from the table by scripts/level-css.ts, in regions the scan leaves out (test/level-css.test.ts checks them). It is syntactic (no type checker), so the guard runs in a fraction of a second. `npx tsx test/support/note-levels.ts` prints the
// matches as the known list's entries (counts per file, function and kind), `--lines` the places.

export type Kind = 'level-literal' | 'level-type' | 'level-map' | 'severity-enum' | 'severity-number' | 'glyph' | 'level-style';
export type Match = MatchOf<Kind>;

/** The directories that are scanned, and the extensions of the files read in them. */
export const DIRS: readonly string[] = ['src', 'cli', 'web', 'media'];
export const CODE_EXTENSIONS: readonly string[] = ['.ts', '.js'];
export const STYLE_EXTENSIONS: readonly string[] = ['.css'];

/** Files (or directories, ending in `/`) that are the table, or have no notes: their matches are not counted. */
export const ALLOWED: readonly string[] = [
  // The level table: the levels, their severity in each protocol, marks, words, icons, colours and names.
  'src/levels.ts',
  // The catalog: every note's level (each entry's; beside it, the style checks' and the other problems').
  'src/messages.ts',
  'src/messages-levels.ts',
  // The words `error` and `info` there belong to the languages of the embedded programs (jq's `error`, awk's and sed's messages).
  'src/embedded/',
  ...['jq', 'awk', 'sed', 'perlrun', 'yaml', 'regex'].map((n) => `src/examples/${n}.ts`),
];

/**
 * The words that name a level, a severity or the kind of a level's note. `error` is one only in a context that is a level's (below):
 * the syntax tree has an `error` node type and the tokens an `error` kind, and no note has the level Error yet.
 */
export const LEVEL_WORDS: ReadonlySet<string> = new Set(['warning', 'info', 'hint', 'pitfall', 'caveat']);
const ERROR_WORD = 'error';
/** The names whose value is a level: `i.severity === 'error'`, `{ level: 'error' }`. */
const LEVEL_NAMES = /^(?:severity|level|sev)$/;
/** The words that, as the keys of an object, make it a map from a level. */
const LEVEL_KEYS: ReadonlySet<string> = new Set([...LEVEL_WORDS, 'note']);
/** The marks of the levels, from the level table: a mark written by hand anywhere else is a match. */
const GLYPHS = new RegExp(`[${Object.values(LEVELS).map((l) => l.mark).join('')}]`, 'u');
/** The names of the levels and of the severities (`error`, `warning`, `info`, `note`, `hint`), from the level table. */
const STYLE_WORDS = [...new Set([...Object.keys(LEVELS), ...Object.keys(SEVERITIES)])];
const capital = (w: string): string => w[0].toUpperCase() + w.slice(1);
const alt = (ws: readonly string[]): string => [...new Set(ws)].join('|');
const CODICONS = alt([...Object.values(LEVELS).map((l) => l.codicon), ...Object.keys(SEVERITIES)]);
/**
 * A style that is a level's, from the level table: a class (`level-warning`, `squiggle-info`, `severity-error`), a colour
 * name the table gives (`--c-warning`) or the one a level takes where `--c-<level>` is another's (`--c-error-level`: the
 * panel's `--c-error` is the error tokens'), the editor's colour (`editorWarning-foreground`), a codicon (`codicon-warning`,
 * `$(info)`).
 */
const STYLE = new RegExp([
  `\\b(?:level|squiggle|severity)-(?:${alt(STYLE_WORDS)})\\b`,
  `(?:${alt([...Object.values(LEVELS).flatMap((l) => (l.colour ? [l.colour.name] : [])), ...STYLE_WORDS.map((w) => `--c-${w}-level`)])})\\b`,
  `editor(?:${alt(Object.keys(SEVERITIES).map(capital))})`,
  `codicon-(?:${CODICONS})\\b`,
  `\\$\\((?:${CODICONS})\\)`,
].join('|'));
/** The first part of a class built from a level (`` `note level-${n.level}` ``). */
const STYLE_PREFIX = /\b(?:level|squiggle|severity)-$/;

const nameText = (n: ts.PropertyName): string | undefined => (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n.text : undefined);

/** The matches of one code file, `rel` being its path from the repo root. */
export function scanSource(rel: string, text: string): Match[] {
  const sf = parseSource(rel, text);
  const found: Match[] = [];
  const add = (n: ts.Node, kind: Kind, what: string): void => {
    found.push({ file: rel, fn: enclosing(n), kind, what, line: lineOf(n) });
  };
  /** The text pieces of a template, which carry the glyphs and the style names. */
  const piece = (n: ts.Node, value: string): void => {
    if (GLYPHS.test(value)) add(n, 'glyph', value.match(GLYPHS)![0]);
    if (STYLE.test(value) || (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) ? STYLE_PREFIX.test(value) : false)) add(n, 'level-style', value.trim().slice(0, 40));
  };
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      const parent = n.parent;
      const isKey = ts.isPropertyAssignment(parent) && parent.name === n;
      const isModule = ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent);
      if ((LEVEL_WORDS.has(n.text) || (n.text === ERROR_WORD && errorIsLevel(n))) && !isKey && !isModule && !(n.text === 'pitfall' && isFactKind(n))) add(n, ts.isLiteralTypeNode(parent) ? 'level-type' : 'level-literal', n.text);
      piece(n, n.text);
    } else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      piece(n, n.text);
    } else if (ts.isRegularExpressionLiteral(n)) {
      piece(n, n.text);
    } else if (ts.isIdentifier(n) && n.text === 'DiagnosticSeverity' && !ts.isImportSpecifier(n.parent)) {
      add(n, 'severity-enum', 'DiagnosticSeverity');
    } else if (ts.isPropertyAssignment(n) && nameText(n.name) === 'severity' && containsNumber(n.initializer)) {
      add(n, 'severity-number', 'severity: <number>');
    } else if (ts.isObjectLiteralExpression(n)) {
      const keys = new Set(n.properties.flatMap((p) => ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name && nameText(p.name) !== undefined ? [nameText(p.name)!] : [])).filter((k) => LEVEL_KEYS.has(k)));
      if (keys.size >= 2) add(n, 'level-map', [...keys].sort().join('/'));
    } else if (ts.isTypeReferenceNode(n) && ts.isIdentifier(n.typeName) && n.typeName.text === 'Record' && n.typeArguments?.length === 2) {
      // `Record<NoteLevel, string>`, `Record<'warning' | 'info', Text>`: a map keyed by a level.
      const key = n.typeArguments[0];
      const names = ts.isTypeReferenceNode(key) ? [key.typeName.getText()] : ts.isUnionTypeNode(key) ? key.types.map((t) => (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal) ? t.literal.text : '')) : [];
      if (names.some((k) => /Level$|Severity$/.test(k) || LEVEL_WORDS.has(k))) add(n, 'level-map', `Record<${names.join(' | ')}>`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/** Whether a literal is compared with or assigned to a `kind` (`f.kind === 'pitfall'`, `{ kind: 'pitfall' }`): `FactKind` is not a level. */
export function isFactKind(n: ts.Node): boolean {
  const p = n.parent;
  const named = (e: ts.Node): boolean => (ts.isPropertyAccessExpression(e) && e.name.text === 'kind') || (ts.isIdentifier(e) && e.text === 'kind');
  if (ts.isBinaryExpression(p)) return named(p.left === n ? p.right : p.left);
  if (ts.isPropertyAssignment(p)) return (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === 'kind';
  if (ts.isCaseClause(p)) return named((p.parent.parent as ts.SwitchStatement).expression);
  return false;
}

/** Whether a literal `'error'` is a level: compared with or assigned to a `severity` or `level`, or one of several level words in a type. */
export function errorIsLevel(n: ts.Node): boolean {
  const p = n.parent;
  const named = (e: ts.Node): boolean => (ts.isPropertyAccessExpression(e) && LEVEL_NAMES.test(e.name.text)) || (ts.isIdentifier(e) && LEVEL_NAMES.test(e.text));
  if (ts.isBinaryExpression(p)) return named(p.left === n ? p.right : p.left);
  if (ts.isPropertyAssignment(p)) return ts.isIdentifier(p.name) && LEVEL_NAMES.test(p.name.text);
  if (ts.isLiteralTypeNode(p) && ts.isUnionTypeNode(p.parent)) return p.parent.types.some((t) => ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal) && LEVEL_WORDS.has(t.literal.text));
  if (ts.isCaseClause(p)) return named((p.parent.parent as ts.SwitchStatement).expression);
  return false;
}

/** Whether an expression holds a numeric literal (`2`, `a ? 2 : 3`). */
function containsNumber(e: ts.Node): boolean {
  if (ts.isNumericLiteral(e)) return true;
  let found = false;
  ts.forEachChild(e, (c) => { found = found || containsNumber(c); });
  return found;
}

/** The matches of one style file: every line that names a level's colour or class. */
export function scanStyle(rel: string, text: string): Match[] {
  const found: Match[] = [];
  // (A comment may name a level; it is not a style. Nor are the regions written from the level table.)
  const code = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const generated = regionLines(text);
  code.split('\n').forEach((line, i) => {
    if (STYLE.test(line) && !generated.has(i + 1)) found.push({ file: rel, fn: '<css>', kind: 'level-style', what: line.trim().slice(0, 40), line: i + 1 });
  });
  return found;
}

/** The matches of every code and style file of the scanned directories outside the allow-list. */
export function scanAll(): Match[] {
  const out: Match[] = [];
  for (const dir of DIRS) {
    // Tracked files only (scan.ts): never a built bundle such as cli/dist/cli.js.
    for (const f of [...CODE_EXTENSIONS, ...STYLE_EXTENSIONS].flatMap((x) => sourceFiles(dir, x)).filter((x) => !x.endsWith('.d.ts')).sort()) {
      const rel = path.relative(base, f).split(path.sep).join('/');
      if (isAllowed(ALLOWED, rel)) continue;
      const text = fs.readFileSync(f, 'utf8');
      out.push(...(f.endsWith('.css') ? scanStyle(rel, text) : scanSource(rel, text)));
    }
  }
  return out;
}

/** The matches counted per file, function and kind (the known list's grain). */
export const counted = (matches: readonly Match[]): { file: string; fn: string; kind: Kind; count: number }[] => countedAny(matches);

if (require.main === module) {
  if (process.argv.includes('--lines')) for (const m of scanAll()) console.log(`${m.file}:${m.line} ${m.fn} ${m.kind} ${m.what}`);
  else console.log(JSON.stringify(counted(scanAll()), null, 1));
}

