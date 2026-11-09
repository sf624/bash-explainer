import * as assert from 'assert';
import type { Browser, Page } from 'playwright-core';
import { hostMessage, type PanelServer, serveMessages } from './support/panel-page';

// The VS Code panel on a line of a part of a host file in another language (docs/design/python-regex.md, 2.5 and 2.8): the
// pattern of a call of Python's `re`. Its header says no shell reads it, its rows are the pattern's, and an error Python
// raises is a problem of the line, in the accessibility tree too.

const SRC = "import re\nNUMBER = re.compile(r'^\\d+$')\nbad = re.compile(r'\\e')\n";

describe('the VS Code panel on a line of a Python pattern', function () {
  this.timeout(60000);
  let browser: Browser | undefined;
  const servers: PanelServer[] = [];

  before(async function () {
    if (Number(process.versions.node.split('.')[0]) < 20) return this.skip();
    try {
      const { chromium } = await import('playwright-core');
      browser = await chromium.launch();
    } catch (e) {
      if (process.env.BASH_EXPLAINER_BROWSER) throw e;
      return this.skip();
    }
  });

  after(async () => {
    await browser?.close();
    for (const s of servers) await s.close();
  });

  async function open(line: number, lang: 'en' | 'ja' = 'en', depth: 1 | 2 = 1): Promise<Page & { errors: string[] }> {
    const server = await serveMessages((l, d) => hostMessage(l, 'python', SRC, 'patterns.py', line, d));
    servers.push(server);
    const page = await browser!.newPage({ viewport: { width: 600, height: 520 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(server.url('dark', lang, depth));
    await page.locator('#tree li').first().waitFor();
    return Object.assign(page, { errors });
  }

  it('says in the header that no shell reads the line, and shows the pattern\'s rows', async () => {
    const page = await open(1);
    try {
      assert.strictEqual(await page.locator('#shell option:checked').textContent(), 'Auto (no shell, Python regex)');
      const tree = await page.locator('main').ariaSnapshot();
      assert.match(tree, /code: r'\^\\d\+\$'\n\s+- text: The pattern of\n\s+- code: re\.compile/);
      assert.match(tree, /code: \\d\n\s+- text: a decimal digit of any script/);
      assert.deepStrictEqual(page.errors, []);
    } finally {
      await page.close();
    }
  });

  it('shows the error Python raises as a problem of the line, in Japanese too', async () => {
    const page = await open(2, 'ja');
    try {
      assert.strictEqual(await page.locator('#shell option:checked').textContent(), '自動（シェルなし、Python の正規表現）');
      const tree = await page.locator('main').ariaSnapshot();
      assert.match(tree, /エラー/);
      assert.match(tree, /bad escape \\e at position 0/);
      assert.deepStrictEqual(page.errors, []);
    } finally {
      await page.close();
    }
  });

  it('reads the line word by word, with the one reader of the pattern', async () => {
    const page = await open(1, 'en', 2);
    try {
      await page.locator('#tree li').first().waitFor();
      assert.match(await page.locator('main').ariaSnapshot(), /a decimal digit of any script/);
      // (The root's name is the language's, and what it is says no shell reads the line: no word or command is around it.)
      const chip = page.getByRole('button', { name: 'Python regex' }).first();
      await chip.click();
      const tree = await page.locator('main').ariaSnapshot();
      assert.match(tree, /No shell reads this line/);
      assert.doesNotMatch(tree, /inside the word/);
      assert.deepStrictEqual(page.errors, []);
    } finally {
      await page.close();
    }
  });
});
