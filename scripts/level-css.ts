// The style sheets' rules of the note levels, written from the level table (src/levels.ts): the colours of the levels
// per theme kind, the class of each level in the panel and the web page's Problems list, and their look with forced
// colours. Each file holds them between two comments, a region:
//
//   /* level table (src/levels.ts, scripts/level-css.ts): <region> */
//   …what this script writes…
//   /* end of the level table */
//
// so that the level table stays the one source of a level's look (docs/design/sources.md, row 13, SB1), and
// test/note-levels.test.ts leaves the regions out. test/level-css.test.ts fails when a region is not what the table
// gives; this script writes them again.
//
// Usage: npx tsx scripts/level-css.ts [--check]
import * as fs from 'fs';
import * as path from 'path';
import { COLOURED, LEVELS, type LevelColour } from '../src/levels';
import type { ThemeKind } from '../src/ui/palette';

const root = path.join(__dirname, '..');

/** The classes of the coloured levels, with their colour. */
const coloured = (): { cls: string; c: LevelColour; forcedBorder?: string }[] =>
  COLOURED.map((l) => ({ cls: LEVELS[l].className, c: LEVELS[l].colour!, forcedBorder: LEVELS[l].forcedBorder }));

/** Our colour of each level in a theme kind, where the theme's is not readable, as the panel names it. */
const ours = (kind: ThemeKind): string[] => coloured().flatMap(({ c }) => (c.ours[kind] ? [`${c.name}: ${c.ours[kind]};`] : []));

/** The lines of each region of each file, without the indentation of the region's opening comment. */
export const REGIONS: Readonly<Record<string, Readonly<Record<string, () => string[]>>>> = {
  'media/panel.css': {
    // The editor's colour of each level, under the panel's name; a chart colour where there is no editor. A colour the
    // panel also gives another name (`alias`) takes it from the level's.
    root: () => coloured().flatMap(({ c }) => [`${c.name}: var(${c.variable}, ${c.fallback});`, ...(c.alias ? [`${c.alias}: var(${c.name});`] : [])]),
    light: () => ours('light'),
    dark: () => ours('dark'),
    highContrast: () => ours('highContrast'),
    highContrastLight: () => ours('highContrastLight'),
    // The left border of a note, its icon and its word, and the squiggle under the part of the line a problem is about.
    rules: () => [
      ...coloured().map(({ cls, c }) => `.note.${cls} { border-left-color: var(${c.name}); }`),
      ...coloured().map(({ cls, c }) => `.${cls} .note-icon, .${cls} .note-label { fill: var(${c.name}); color: var(${c.name}); }`),
      ...coloured().map(({ cls, c }) => `#line .squiggle.${cls} { text-decoration-color: var(${c.name}); }`),
    ],
    // With forced colours: the icon and the word in the text's colour, and the borders that must differ without colour.
    forced: () => [
      `.note-icon, ${coloured().map(({ cls }) => `.${cls} .note-icon`).join(', ')} { fill: CanvasText; }`,
      `${coloured().map(({ cls }) => `.${cls} .note-label`).join(', ')} { color: CanvasText; }`,
      ...coloured().flatMap(({ cls, forcedBorder }) => (forcedBorder ? [`.note.${cls} { border-left: ${forcedBorder}; }`] : [])),
    ],
  },
  'web/page.css': {
    root: () => coloured().map(({ c }) => `${c.name}: var(${c.variable});`),
    problems: () => coloured().flatMap(({ cls, c }, i) => [...(i ? [''] : []), `#problems .icon.${cls} {`, `  color: var(${c.name});`, '}']),
  },
  'web/theme.css': {
    // The editor's colours of the levels, which the page defines for itself: ours in the light theme, Dark Modern's in
    // the dark, or ours where Dark Modern's is not readable (the error's).
    light: () => coloured().flatMap(({ c }) => (c.ours.light ? [`${c.variable}: ${c.ours.light};`] : [])),
    dark: () => coloured().map(({ c }) => `${c.variable}: ${c.ours.dark ?? c.dark};`),
  },
};

const OPEN = /^([ \t]*)\/\* level table \(src\/levels\.ts, scripts\/level-css\.ts\): (\w+) \*\/$/;
const CLOSE = /^[ \t]*\/\* end of the level table \*\/$/;

/** The text of `file` with its regions written from the table; an unknown or unclosed region is an error. */
export function withRegions(file: string, text: string): string {
  const regions = REGIONS[file];
  const lines = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    const m = OPEN.exec(lines[i]);
    if (!m) continue;
    const make = regions?.[m[2]];
    if (!make) throw new Error(`${file}:${i + 1}: no region "${m[2]}"`);
    const end = lines.findIndex((l, j) => j > i && CLOSE.test(l));
    if (end < 0) throw new Error(`${file}:${i + 1}: region "${m[2]}" is not closed`);
    out.push(...make().map((l) => (l ? m[1] + l : l)), lines[end]);
    i = end;
  }
  return out.join('\n');
}

/** The line numbers (from 1) inside the regions of a style sheet: what the guard leaves out. */
export function regionLines(text: string): Set<number> {
  const inside = new Set<number>();
  let open = false;
  text.split('\n').forEach((l, i) => {
    if (CLOSE.test(l)) open = false;
    else if (OPEN.test(l)) open = true;
    else if (open) inside.add(i + 1);
  });
  return inside;
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const file of Object.keys(REGIONS)) {
    const p = path.join(root, file);
    const text = fs.readFileSync(p, 'utf8');
    const next = withRegions(file, text);
    if (next === text) continue;
    stale++;
    if (check) console.error(`${file}: the level table's rules are not current; run npx tsx scripts/level-css.ts`);
    else fs.writeFileSync(p, next);
  }
  process.exitCode = check && stale ? 1 : 0;
}
