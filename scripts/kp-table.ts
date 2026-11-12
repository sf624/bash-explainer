// Prototype (key points): the points the rule picks for every explained line of a script, as a Markdown table, with counts.
// usage: npx tsx scripts/kp-table.ts [en|ja] [file] [--why]
import * as fs from 'fs';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import { openDocument, shellsOf } from '../src/document-setup';
import { diagnosticsFor, explainDocumentLine, issueFilter, plain } from '../src/document';
import { defaultSettings, explainOptions } from '../src/settings';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { explainNeeds, panelUpdate } from '../src/ui/panelView';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const why = process.argv.includes('--why');
const lang = (args[0] ?? 'en') as 'en' | 'ja';
const file = args[1] ?? path.join(__dirname, '..', 'test/fixtures/sample.sh');
const text = fs.readFileSync(file, 'utf8');
const parser = createUnbashParser();
const settings = defaultSettings();
const doc = openDocument(text, 'shell' as never, (t) => parser.parse(t));
const shells = shellsOf(doc.lines, path.basename(file), undefined, 'said');
const diag = diagnosticsFor(() => doc, () => shells, lang, settings, 'web');
const an = new Analyzer(lang);
const counts = [0, 0, 0, 0];
let competed = 0;
const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const out: string[] = ['| Line | Code | Problems | Key points (source: sentence) |', '| --- | --- | --- | --- |'];
for (let line = 0; line < doc.lines.length; line++) {
  const ex = explainDocumentLine(an, doc, line, lang, shells, { ...explainOptions(settings), ...explainNeeds({}), sentence: true });
  if (!ex.items.length) continue;
  const u = panelUpdate({ lang, explanation: ex, file: path.basename(file), line, lineText: doc.lines[line], doc, choice: {}, placement: settings['examples.placement'], issues: diag.shown, shown: issueFilter(doc, settings, 'web'), web: true, state: {}, keyPoints: 'a' } as never);
  const kp = u.keyPoints!;
  counts[kp.points.length]++;
  if (kp.candidates > kp.points.length) competed++;
  const pts = kp.points.map((p, i) => `${i + 1}. \`${p.code}\`: ${plain(p.text, { backticks: true })}${why ? ` _[${p.score} ${p.why}]_` : ''}`).join('<br>') || '—';
  out.push(`| ${line + 1} | \`${cell(doc.lines[line].trim())}\` | ${u.problems.length || ''} | ${cell(pts)} |`);
}
out.push('', `Lines explained: ${counts.reduce((a, b) => a + b, 0)}. With 0 points: ${counts[0]}; 1: ${counts[1]}; 2: ${counts[2]}; 3: ${counts[3]}. Lines where more candidates competed than were shown: ${competed}.`);
console.log(out.join('\n'));
