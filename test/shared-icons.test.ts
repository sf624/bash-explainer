// An action shows the same icon in the VS Code panel's header and on the web page (top bar, menu, compare page):
// both draw it from the one table of media/icons.js, by the same name. The web page's own actions (menu, share,
// sample, read mode, GitHub, the editor's header…) keep the page's own icons. test/web-topbar.test.ts checks that the page follows the
// panel when the fold and the quick reference buttons change their icon.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { PANEL_BODY } from '../src/ui/panelView';

const root = path.join(__dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf8');

/** The icon drawn in the element `id` of `html`: a Codicon's name, or the page's own symbol (`#i-…`). */
function iconOf(html: string, id: string): string | undefined {
  const m = new RegExp(`id="${id}"[^>]*>\\s*<svg([^>]*)>(?:<use href="([^"]+)")?`).exec(html);
  if (!m) return undefined;
  return /data-icon="([^"]+)"/.exec(m[1])?.[1] ?? m[2];
}

describe('shared icons', () => {
  const index = read('web', 'index.html');
  const compare = read('web', 'compare.html');
  // Web page element → the panel's button of the same action.
  const SAME: [string, string, string][] = [
    [index, 'collapse', 'toggle'],
    [index, 'ref', 'ref'],
    [index, 'copy-md', 'copy'],
    [index, 'menu-copy', 'copy'],
    [index, 'settings-open', 'settings'],
    [compare, 'settings-open', 'settings'],
  ];

  it('draws the same Codicon for the same action on the web page as in the panel', () => {
    for (const [html, web, panel] of SAME) {
      const want = iconOf(PANEL_BODY, panel);
      assert.ok(want && !want.startsWith('#'), `the panel's #${panel} has a Codicon`);
      assert.strictEqual(iconOf(html, web), want, `#${web} on the web page draws the icon of the panel's #${panel}`);
    }
  });

  it('keeps no copy of a Codicon on the web page: no symbol for them, and the shared script loads first', () => {
    for (const html of [index, compare]) {
      for (const old of ['i-collapse', 'i-book', 'i-copy', 'i-gear']) assert.ok(!html.includes(old), old);
      assert.ok(html.includes('<script src="icons.js"></script>\n<script src="app.js"></script>'));
    }
    assert.ok(!read('media', 'panel.js').includes('const ICONS'), 'media/panel.js uses media/icons.js');
  });

  it('keeps the web page\'s own icons for the actions only it has', () => {
    for (const [id, icon] of [['menu-open', '#i-menu'], ['share', '#i-link'], ['more-sample', '#i-sample'], ['readmode', '#i-keyboard'], ['github', '#i-github'], ['menu-close', '#i-close'], ['open-btn', '#i-open'], ['save-btn', '#i-save'], ['ed-more', '#i-more'], ['more-copy', '#i-duplicate'], ['more-clear', '#i-clear']]) {
      assert.strictEqual(iconOf(index, id), icon, id);
    }
  });
});
