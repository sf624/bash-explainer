// Compares the web editor's colours with the panel's, character by character (docs/design/one-colour-source.md): the
// editor's from the lean explanation (in English), the panel's from its full explanation (in Japanese, with what its
// default state needs), each resolved to a colour in the web page's light and dark themes (web/theme.css).
//   npx tsx scripts/colour-agreement.ts [FILE…]     (no file: test/fixtures/sample.sh and every snippet of the corpus)
import * as fs from 'fs';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import { explainDocumentLine, leanExplanation, leanOptions } from '../src/document';
import { openDocument, shellsOf } from '../src/document-setup';
import type { TokenRole } from '../src/roles';
import { explainOptions, mergeSettings } from '../src/settings';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { lineColours } from '../src/ui/lineColours';
import { explainNeeds, panelUpdate } from '../src/ui/panelView';
import { ROLE_COLOURS } from '../web/editor-colors';

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'web/theme.css'), 'utf8');
const vars = (block: string) => Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const light = vars(/:root\s*{([^}]*)}/.exec(css)![1]);
const dark = { ...light, ...vars(/@media \(prefers-color-scheme: dark\)\s*{\s*:root:not\(\[data-theme="light"\]\)\s*{([^}]*)}/.exec(css)![1]) };
const resolve = (v: string, theme: Record<string, string>): string => {
  const m = /^var\((--[\w-]+)(?:,\s*(.*))?\)$/.exec(v.trim());
  if (!m) return v.trim();
  return resolve(theme[m[1]] ?? m[2] ?? '', theme);
};
// The panel's colour of each role: its `.kind-*` rules through the variables of body (media/panel.css).
const panel = fs.readFileSync(path.join(root, 'media/panel.css'), 'utf8');
const body = vars(/^body \{([^}]*)\}/m.exec(panel)![1]);
const kindVar = new Map<string, string>();
for (const m of panel.matchAll(/^((?:\.kind-\w+(?:, )?)+) \{ color: var\((--c-[\w-]+)(?:, var\((--c-[\w-]+)\))?\); \}$/gm)) for (const k of m[1].split(', ')) kindVar.set(k.slice(6), m[3] ?? m[2]);
const panelColour = (kind: string | undefined, theme: Record<string, string>) => resolve(kind ? `var(${kindVar.get(kind)})` : 'var(--vscode-editor-foreground)', { ...theme, ...body });
const editorColour = (role: TokenRole | undefined, theme: Record<string, string>) => resolve(role ? ROLE_COLOURS[role] : 'var(--vscode-editor-foreground)', theme);

const parser = createUnbashParser();
const settings = mergeSettings({});
const full = { ...explainOptions(settings), examples: { enabled: false, disabled: [] }, sentence: true, ...explainNeeds({}) };
const lean = leanOptions({ ...explainOptions(settings), pitfalls: true });
const ja = new Analyzer('ja');
const count = { chars: 0, agree: 0, lines: 0, linesAgree: 0 };
const differ = new Map<string, number>();

function compare(text: string): void {
  const doc = openDocument(text, 'shell', (s) => parser.parse(s));
  const shells = shellsOf(doc.lines, 'script.sh', undefined, 'said');
  doc.lines.forEach((lineText, line) => {
    if (!lineText.trim()) return;
    const ex = explainDocumentLine(ja, doc, line, 'ja', shells, full);
    const runs = panelUpdate({ lang: 'ja', explanation: ex, file: 'x', line, lineText, doc, wrap: false, choice: {}, detected: undefined, placement: 'first', animations: false, issues: [], web: true, state: {} } as never).lineRuns;
    const pan: (string | undefined)[] = new Array(lineText.length).fill(undefined);
    for (const r of runs) if ('kind' in r) for (let i = r.from; i < r.to; i++) pan[i] = r.kind;
    const ed: (TokenRole | undefined)[] = new Array(lineText.length).fill(undefined);
    for (const r of lineColours(lineText, leanExplanation(doc, line, 'en', shells, lean))) for (let i = r.from; i < r.to; i++) ed[i] = r.role;
    let all = true;
    for (let i = 0; i < lineText.length; i++) {
      if (!lineText[i].trim()) continue;
      count.chars++;
      const same = [light, dark].every((t) => editorColour(ed[i], t) === panelColour(pan[i], t));
      if (same) count.agree++;
      else {
        all = false;
        const key = `editor ${ed[i] ?? 'none'}, panel ${pan[i] ?? 'none'}`;
        differ.set(key, (differ.get(key) ?? 0) + 1);
      }
    }
    count.lines++;
    if (all) count.linesAgree++;
  });
}

const files = process.argv.slice(2);
if (files.length) for (const f of files) compare(fs.readFileSync(f, 'utf8'));
else {
  compare(fs.readFileSync(path.join(root, 'test/fixtures/sample.sh'), 'utf8'));
  for (const s of JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/snippets.json'), 'utf8')) as string[]) compare(s);
}
console.log(`${count.agree} of ${count.chars} characters agree (${((100 * count.agree) / count.chars).toFixed(1)}%), ${count.linesAgree} of ${count.lines} lines`);
for (const [k, n] of [...differ].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${n} ${k}`);
