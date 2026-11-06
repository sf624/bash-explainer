// The user documentation: the READMEs, CONTRIBUTING.md and the user guide (docs/guide/, its Japanese pages in
// docs/guide/ja/ under the same names). Every relative link and anchor resolves, at the commit, so that the README
// pinned to a release's tag on the package pages (scripts/readme-pins.ts) leads to pages that exist there; and every
// guide page has its pair in the other language, with the same headings.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { linkTargets, maskCode, REPO } from '../scripts/readme-pins';

const root = path.join(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

const guidePages = (dir: string) => fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.md')).sort();

/** The documents whose links are checked, relative to the repository root. */
const DOCUMENTS = ['README.md', 'README.ja.md', 'CONTRIBUTING.md', 'SECURITY.md', 'cli/README.md',
  ...guidePages('docs/guide').map((f) => `docs/guide/${f}`), ...guidePages('docs/guide/ja').map((f) => `docs/guide/ja/${f}`)];

/** The headings of a Markdown text, outside its code: level and text as written. */
function headings(text: string): { level: number; text: string }[] {
  const masked = maskCode(text).split('\n');
  return text.split('\n').flatMap((line, i) => {
    const m = /^(#{1,6})[ \t]+(.*?)[ \t#]*$/.exec(line);
    return m && /^#{1,6}[ \t]/.test(masked[i]) ? [{ level: m[1].length, text: m[2] }] : [];
  });
}

/**
 * The anchor GitHub gives a heading: its text as shown (no markup, HTML tags or link targets), in lower case, with
 * every character but letters, marks, digits, `_`, `-` and spaces left out, and each space a `-`.
 */
function slug(heading: string): string {
  // (A tag's name is left out; a `<` or `>` that is left is no letter, so the slug drops it too.)
  const shown = heading.replace(/<[^>]*>/g, '').replace(/[<>]/g, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*]/g, '');
  return shown.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '').replace(/ /g, '-');
}

/** The anchors of a Markdown text: each heading's slug, a repeated one with -1, -2, … as GitHub numbers them. */
function anchors(text: string): Set<string> {
  const seen = new Map<string, number>();
  const out = new Set<string>();
  for (const h of headings(text)) {
    const base = slug(h.text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n ? `${base}-${n}` : base);
  }
  return out;
}

// A URL of this repository's files on main or HEAD, or the repository page (which shows README.md): checked as the
// relative link it stands for. Other absolute URLs are not checked.
const REPO_FILE = new RegExp(`^https://github\\.com/${REPO}(?:/(?:blob|tree)/(?:main|HEAD)/([^?#]*))?/?(#.*)?$`);

/** What is wrong with the link `url` of `file`, or undefined when it resolves. */
function problem(file: string, url: string): string | undefined {
  let target: string;
  let anchor: string;
  const repo = REPO_FILE.exec(url);
  if (repo) {
    target = repo[1] ?? 'README.md';
    anchor = repo[2] ?? '';
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return undefined;
  else {
    const [, p, a] = /^([^#?]*)(?:\?[^#]*)?(#.*)?$/.exec(url)!;
    target = p === '' ? file : path.posix.normalize(path.posix.join(path.posix.dirname(file), p));
    anchor = a ?? '';
  }
  if (target.startsWith('..')) return 'leaves the repository';
  const full = path.join(root, target);
  if (!fs.existsSync(full)) return `${target} does not exist`;
  if (anchor && target.endsWith('.md')) {
    const name = decodeURIComponent(anchor.slice(1));
    if (!anchors(fs.readFileSync(full, 'utf8')).has(name)) return `${target} has no heading for #${name}`;
  }
  return undefined;
}

describe('the user documentation', () => {
  it('finds the anchors GitHub makes of headings', () => {
    assert.strictEqual(slug('Settings outside VS Code'), 'settings-outside-vs-code');
    assert.strictEqual(slug('In your editor (Language Server)'), 'in-your-editor-language-server');
    assert.strictEqual(slug('Command line, other editors and CI'), 'command-line-other-editors-and-ci');
    assert.strictEqual(slug('VS Code で使う'), 'vs-code-で使う');
    assert.strictEqual(slug('コマンドライン、他のエディタ、CI'), 'コマンドライン他のエディタci');
    assert.strictEqual(slug('The `yq` [flavours](x.md)'), 'the-yq-flavours');
    assert.deepStrictEqual([...anchors('# A\n\n```\n# not a heading\n```\n\n## A\n### B ##\n')], ['a', 'a-1', 'b']);
  });

  it('reads the links of every page of the guide, in both languages', () => {
    assert.ok(DOCUMENTS.includes('docs/guide/README.md') && DOCUMENTS.includes('docs/guide/ja/README.md'));
    assert.ok(DOCUMENTS.length >= 15, String(DOCUMENTS.length));
    assert.strictEqual(problem('docs/guide/x.md', '../../README.md#nothing-here'), 'README.md has no heading for #nothing-here');
    assert.strictEqual(problem('README.md', 'docs/guide/none.md'), 'docs/guide/none.md does not exist');
    assert.strictEqual(problem('README.md', '../x.md'), 'leaves the repository');
    assert.strictEqual(problem('SECURITY.md', `https://github.com/${REPO}/blob/main/README.md#nothing-here`), 'README.md has no heading for #nothing-here');
    assert.strictEqual(problem('README.md', `https://github.com/${REPO}#privacy`), undefined);
  });

  for (const file of DOCUMENTS) {
    it(`${file}: every relative link and anchor resolves`, () => {
      const links = linkTargets(read(file));
      assert.ok(links.length > 0, 'it has links');
      assert.deepStrictEqual(links.flatMap(({ url }) => {
        const why = problem(file, url);
        return why ? [`${url}: ${why}`] : [];
      }), []);
    });
  }

  it('has a Japanese page for every English page of the guide, and the reverse', () => {
    assert.deepStrictEqual(guidePages('docs/guide/ja'), guidePages('docs/guide'));
    assert.ok(guidePages('docs/guide').includes('README.md'));
  });

  const levels = (file: string) => headings(read(file)).map((h) => h.level).join(' ');
  for (const [en, ja] of [['README.md', 'README.ja.md'], ...guidePages('docs/guide').map((f) => [`docs/guide/${f}`, `docs/guide/ja/${f}`])]) {
    it(`${en} and ${ja} have the same headings, level by level`, () => assert.strictEqual(levels(ja), levels(en)));
  }

  it('links each guide page to its index and to its page in the other language', () => {
    for (const f of guidePages('docs/guide')) {
      const en = linkTargets(read(`docs/guide/${f}`)).map((l) => l.url);
      const ja = linkTargets(read(`docs/guide/ja/${f}`)).map((l) => l.url);
      assert.ok(en.includes(`ja/${f}`) && ja.includes(`../${f}`), f);
      if (f !== 'README.md') assert.ok(en.includes('README.md') && ja.includes('README.md'), f);
    }
  });
});
