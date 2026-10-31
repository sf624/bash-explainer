import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { base, counted as countedAny, enclosing, lineOf, parseSource, type Match as MatchOf } from './scan';

// The scan behind test/note-levels.test.ts (docs/design/sources.md, row 13, stage SA, step SA4): where code names the level of a note
// (a severity, an icon, a colour, a rank, a mark) without going through the one table that holds them. Today that table is src/messages.ts
// (`NoteLevel`, `severityOf`, `MARKS`, `PITFALL_WORD`); the level table of three-levels.md, step 1, replaces it and empties the known
// list. It is syntactic (no type checker), so the guard runs in a fraction of a second. `npx tsx test/support/note-levels.ts` prints the
// matches as the known list's entries (counts per file, function and kind), `--lines` the places.

export type Kind = 'level-literal' | 'level-type' | 'level-map' | 'severity-enum' | 'severity-number' | 'glyph' | 'level-style';
export type Match = MatchOf<Kind>;

/** The directories that are scanned, and the extensions of the files read in them. */
export const DIRS: readonly string[] = ['src', 'cli', 'web', 'media'];
export const CODE_EXTENSIONS: readonly string[] = ['.ts', '.js'];
export const STYLE_EXTENSIONS: readonly string[] = ['.css'];

/** Files (or directories, ending in `/`) that are the table, or have no notes: their matches are not counted. */
export const ALLOWED: readonly string[] = [
  // The one table for now: the levels, their severity, marks and words, with every catalog entry's level.
  'src/messages.ts',
  // The words `error` and `info` there belong to the languages of the embedded programs (jq's `error`, awk's and sed's messages).
  'src/embedded/',
  ...['jq', 'awk', 'sed', 'perlrun', 'yaml', 'regex'].map((n) => `src/examples/${n}.ts`),
  // The icons by name (`warning`, `info`, `gear`…): a table of drawings, not a map from a level.
  'media/icons.js',
  'web/icons.ts',
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
const GLYPHS = /[⚠ⓘℹ]/u;
/** A style that is a level's: `level-warning`, `squiggle-info`, `--c-warning`, `editorWarning-foreground`, `codicon-warning`, `$(info)`. */
const STYLE = /\b(?:level|squiggle|severity)-(?:warning|info|hint)\b|--c-(?:warning|info)\b|editor(?:Warning|Info|Error)|codicon-(?:warning|info|error)\b|\$\((?:warning|info|error)\)/;
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
      if ((LEVEL_WORDS.has(n.text) || (n.text === ERROR_WORD && errorIsLevel(n))) && !isKey && !isModule) add(n, ts.isLiteralTypeNode(parent) ? 'level-type' : 'level-literal', n.text);
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
  // (A comment may name a level; it is not a style.)
  const code = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  code.split('\n').forEach((line, i) => {
    if (STYLE.test(line)) found.push({ file: rel, fn: '<css>', kind: 'level-style', what: line.trim().slice(0, 40), line: i + 1 });
  });
  return found;
}

const isAllowed = (rel: string): boolean => ALLOWED.some((a) => (a.endsWith('/') ? rel.startsWith(a) : rel === a));

function filesUnder(dir: string, exts: readonly string[], out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) filesUnder(p, exts, out);
    else if (exts.some((x) => e.name.endsWith(x)) && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** The matches of every code and style file of the scanned directories outside the allow-list. */
export function scanAll(): Match[] {
  const out: Match[] = [];
  for (const dir of DIRS) {
    const root = path.join(base, dir);
    if (!fs.existsSync(root)) continue;
    for (const f of filesUnder(root, [...CODE_EXTENSIONS, ...STYLE_EXTENSIONS]).sort()) {
      const rel = path.relative(base, f).split(path.sep).join('/');
      if (isAllowed(rel)) continue;
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

