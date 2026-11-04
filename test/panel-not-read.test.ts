import * as assert from 'assert';
import type { Browser, Page } from 'playwright-core';
import { Analyzer } from '../src/analyzer';
import { documentIssues, type ShellDocument } from '../src/document';
import type { Lang } from '../src/i18n';
import { LineExplainer } from '../src/explain/context';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { boxProblems, problemsAround } from '../src/ui/panelProblems';
import { PanelServer, servePanel } from './support/panel-page';
import { until } from './support/site';

// What the panel says of a line too deep to follow and of a file not read: a limit of the tool, with its headline and a word
// of its own ("Not read", not "Pitfall"), and no error in the page (src/messages-unread.ts, src/levels.ts `NOT_READ_WORD`).

const parser = createUnbashParser();
// (How deep a walk can go depends on the stack of the machine: the walk of the line `deep` is made to run out of it, as in test/line-budget.test.ts.)
const deep = 'echo a';
const OVERFLOW = new RangeError('Maximum call stack size exceeded');
/** Runs `run` with the walk of the lines `lines` (0-based, of the script) running out of stack. */
function tooDeep<T>(lines: readonly number[], run: () => T): T {
  const proto = LineExplainer.prototype as unknown as { end: () => void };
  const real = proto.end;
  proto.end = function (this: LineExplainer) {
    if (lines.includes((this as unknown as { line: number }).line)) throw OVERFLOW;
    real.call(this);
  };
  try {
    return run();
  } finally {
    proto.end = real;
  }
}
const WORD = { en: 'Not read', ja: '読めていない' } as const;
const HEAD = { line: { en: /nests too deep to follow/, ja: /入れ子が深すぎて最後までたどれない/ }, file: { en: /nests too deep to be read/, ja: /入れ子が深すぎて読めない/ } } as const;
const unreadFile = 'coproc '.repeat(5e4);

describe('a line too deep and a file not read, in the panel', () => {
  for (const lang of ['en', 'ja'] as const) {
    it(`boxProblems gives the headline and the word of their own (${lang})`, function () {
      this.timeout(60000);
      const line = tooDeep([0], () => new Analyzer(lang).explainLine(parser.parse(deep), 0));
      const [p, ...none] = boxProblems(line, line.items, lang, () => true);
      assert.strictEqual(none.length, 0);
      assert.match(p.head, HEAD.line[lang]);
      assert.strictEqual(p.word, WORD[lang]);
      const file = new Analyzer(lang).explainLine(parser.parse(unreadFile), 3);
      const [f] = boxProblems(file, file.items, lang, () => true);
      assert.match(f.head, HEAD.file[lang]);
      assert.strictEqual(f.word, WORD[lang]);
    });

    it(`problemsAround points at a line too deep with its headline and the word (${lang})`, () => {
      const text = `if ${deep}; then\n  :\nfi\n`;
      const tree = parser.parse(text);
      const doc: ShellDocument = { lines: text.split('\n'), tree };
      const ex = tooDeep([0], () => new Analyzer(lang).explainLine(tree, 1));
      const [pointer, ...none] = problemsAround(ex, tooDeep([0], () => documentIssues(doc, lang, {})), [], lang);
      assert.strictEqual(none.length, 0);
      assert.match(pointer.head, HEAD.line[lang]);
      assert.ok(pointer.where.includes(WORD[lang]), pointer.where);
    });
  }

  describe('in the real page', function () {
    this.timeout(120000);
    let browser: Browser | undefined;
    const servers: PanelServer[] = [];
    const cases = {
      'a line': { text: deep, at: 1, file: 'a.sh' },
      'the line after one': { text: `if ${deep}; then\n  :\nfi`, at: 2, file: 'b.sh' },
      'a file not read': { text: unreadFile, at: 1, file: 'c.sh' },
    } as const;
    const serverOf = new Map<string, PanelServer>();

    before(async function () {
      if (Number(process.versions.node.split('.')[0]) < 20) return this.skip();
      try {
        const { chromium } = await import('playwright-core');
        browser = await chromium.launch();
      } catch (e) {
        if (process.env.BASH_EXPLAINER_BROWSER) throw e;
        return this.skip();
      }
      for (const [name, c] of Object.entries(cases)) {
        // (The script of the page has a first line before the text's: line 1 is the text's first.)
        const s = await tooDeep([1], () => servePanel(c.text, c.file, false, c.at));
        servers.push(s);
        serverOf.set(name, s);
      }
    });

    after(async () => {
      await browser?.close();
      for (const s of servers) await s.close();
    });

    for (const [name, c] of Object.entries(cases)) {
      for (const lang of ['en', 'ja'] as Lang[]) {
        it(`${name} shows its problem and throws nothing (${lang})`, async () => {
          const page: Page = await browser!.newPage({ viewport: { width: 500, height: 700 } });
          const errors: string[] = [];
          page.on('pageerror', (e) => errors.push(e.message));
          try {
            await page.goto(serverOf.get(name)!.url('dark', lang));
            await until('the problems', () => page.locator('#problems').evaluate((e) => (e as unknown as { hidden: boolean }).hidden), (hidden) => !hidden);
            const labels = await page.locator('#problems .note-label').allTextContents();
            const heads = await page.locator('#problems .problem-head-text').allTextContents();
            assert.ok(labels.length && heads.length, `${labels}`);
            assert.ok(labels.every((l) => l.includes(WORD[lang])), labels.join('|'));
            assert.ok(heads.some((h) => (c.text === unreadFile ? HEAD.file : HEAD.line)[lang].test(h)), heads.join('|'));
            assert.deepStrictEqual(errors, []);
          } finally {
            await page.close();
          }
        });
      }
    }
  });
});
