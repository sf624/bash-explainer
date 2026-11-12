// Prototype (key points): dumps what the panel gets for each line of a script, to design the salience rule.
// usage: npx tsx scripts/kp-dump.ts [en|ja] [file] [lines,comma,separated]
import * as fs from 'fs';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import { openDocument, shellsOf } from '../src/document-setup';
import { diagnosticsFor, explainDocumentLine, issueFilter } from '../src/document';
import { defaultSettings, explainOptions } from '../src/settings';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { explainNeeds, panelUpdate } from '../src/ui/panelView';

const lang = (process.argv[2] ?? 'en') as 'en' | 'ja';
const file = process.argv[3] ?? path.join(__dirname, '..', 'test/fixtures/sample.sh');
const only = process.argv[4] ? process.argv[4].split(',').map(Number) : undefined;
const text = fs.readFileSync(file, 'utf8');
const parser = createUnbashParser();
const settings = defaultSettings();
const doc = openDocument(text, 'shell' as never, (t) => parser.parse(t));
const shells = shellsOf(doc.lines, path.basename(file), undefined, 'said');
const diag = diagnosticsFor(() => doc, () => shells, lang, settings, 'web');
const an = new Analyzer(lang);
for (let line = 0; line < doc.lines.length; line++) {
  if (only && !only.includes(line + 1)) continue;
  const ex = explainDocumentLine(an, doc, line, lang, shells, { ...explainOptions(settings), ...explainNeeds({}), sentence: true });
  if (!ex.items.length) continue;
  const u = panelUpdate({ lang, explanation: ex, file: 'sample.sh', line, lineText: doc.lines[line], doc, choice: {}, placement: settings['examples.placement'], issues: diag.shown, shown: issueFilter(doc, settings, 'web'), web: true, state: {} } as never);
  console.log('\n### ' + (line + 1) + ': ' + doc.lines[line]);
  console.log('  S: ' + ex.sentence);
  for (const p of u.problems) console.log('  P[' + p.level + '] ' + p.head);
  for (const n of ex.noteInfo) console.log('  N[' + n.level + ' ' + n.code + '] ' + (n.head ?? '') + ' | ' + n.body.slice(0, 90));
  const walk = (r: any, d: number): void => {
    console.log('  ' + '  '.repeat(d) + '- [' + r.kind + (r.frame ? ' ' + r.frame : '') + (r.comesAt === 2 ? ' d2' : '') + '] ' + r.label + ' :: ' + r.text.slice(0, 80)
      + (r.texts ? ' {' + r.texts.join(',') + '}' : '') + (r.facts ? ' <' + r.facts.join(',') + '>' : '') + (r.level ? ' !' + r.level : '')
      + (r.steps ? ' STEPS' : '') + (r.expands ? ' X:' + r.expands : '') + (r.examples?.length ? ' EX' + r.examples.length : '') + (r.more?.length ? ' M' + r.more.length : ''));
    r.children.forEach((c: any) => walk(c, d + 1));
  };
  u.rows.forEach((r: any) => walk(r, 0));
}
