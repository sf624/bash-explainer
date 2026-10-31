// The data of the notes (`LineExplanation.noteInfo`, docs/design/note-levels.md): every note of every line of the
// corpus has its level, its word and the rest as data, made where the note is said, and they agree with the mark the
// text starts with, read back as the views read it before the data existed (the oracle below).
import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import { detectShell } from '../src/dialect';
import { explainHostedLine, extractShell, hostKind } from '../src/hosts';
import type { Lang } from '../src/i18n';
import { LEVEL_ORDER, LEVELS } from '../src/levels';
import { MESSAGES, type NoteLevel, PORTABILITY } from '../src/messages';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { corpus } from './support/corpus';
import * as fs from 'fs';
import * as path from 'path';

/** The old reading of a note's text: the level from its mark, the word from the known headings. */
function readBack(text: string, lang: Lang): { level: NoteLevel; label: string; body: string } {
  const level: NoteLevel = LEVEL_ORDER.find((l) => text.startsWith(LEVELS[l].mark)) ?? 'note';
  const rest = level === 'note' && !text.startsWith(LEVELS.note.mark) ? text : text.slice(LEVELS[level].mark.length).trimStart();
  const words = [{ ja: '落とし穴: ', en: 'Pitfall: ' }, { ja: '注意: ', en: 'Caveat: ' }, PORTABILITY, ...Object.values(MESSAGES).map((e) => (e as { heading?: { ja: string; en: string } }).heading)];
  const label = [...new Set(words.map((h) => h?.[lang] ?? '').filter(Boolean))].find((h) => rest.startsWith(h)) ?? '';
  return { level, label: label.trimEnd(), body: rest.slice(label.length) };
}

describe('the data of the notes', () => {
  const parser = createUnbashParser();
  for (const lang of ['en', 'ja'] as const) {
    it(`gives every note of the corpus its level and word as data, as its mark says (${lang})`, function () {
      this.timeout(300_000);
      const analyzer = new Analyzer(lang);
      const { files, snippets } = corpus();
      const wrong: string[] = [];
      let notes = 0;
      const check = (where: string, ex: { notes: string[]; noteInfo: { text: string; level: NoteLevel; label: string; body: string; code?: string }[] }) => {
        if (ex.noteInfo.map((n) => n.text).join('\n') !== ex.notes.join('\n')) wrong.push(`${where}: the data is not that of the notes`);
        for (const n of ex.noteInfo) {
          notes++;
          const old = readBack(n.text, lang);
          if (old.level !== n.level || old.label !== n.label || old.body !== n.body) wrong.push(`${where}: ${JSON.stringify(n)} reads as ${JSON.stringify(old)}`);
          // (A warning or a caveat is a problem in the editors, by its code.)
          if (n.level !== 'note' && !n.code) wrong.push(`${where}: no code for ${n.text}`);
        }
      };
      for (const input of [...files.filter((f) => !f.name.startsWith('hosts/')), ...snippets]) {
        const tree = parser.parse(input.text);
        const shell = detectShell(input.text, input.name.startsWith('snippet') ? '' : input.name);
        input.text.split('\n').forEach((_, i) => check(`${input.name}:${i + 1}`, analyzer.explainLine(tree, i, shell, { examples: { enabled: false, disabled: [] } })));
      }
      // The host files, with the notes of their hosts.
      const dir = path.join(__dirname, 'fixtures/hosts');
      for (const f of fs.readdirSync(dir).sort()) {
        const kind = hostKind('', f)!;
        const original = fs.readFileSync(path.join(dir, f), 'utf8');
        const extracted = extractShell(kind, original);
        const tree = parser.parse(extracted.text);
        const lines = original.split('\n');
        lines.forEach((_, i) => {
          const ex = explainHostedLine(analyzer, tree, extracted, lines, i, lang);
          if (ex) check(`hosts/${f}:${i + 1}`, ex);
        });
      }
      assert.deepStrictEqual(wrong, []);
      assert.ok(notes > 500, String(notes));
    });
  }
});
