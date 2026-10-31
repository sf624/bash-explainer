// The web page's settings as data (src/ui/settingsPage.ts): the sections, the search, and the places a description
// may be cut before its "More". The page itself is tested in test/web-settings.test.ts.
import * as assert from 'assert';
import { PAGE_SECTIONS, settingsFor, SETTINGS } from '../src/settings';
import { cutPoints, foldable, lastFit, pageSections, SETTINGS_SECTIONS, sectionOpen, settingMatches } from '../src/ui/settingsPage';

describe('the settings of the web page, as data', () => {
  it('puts every setting of the web page in one section, and no other setting', () => {
    for (const s of SETTINGS) assert.strictEqual(!!s.section, s.surfaces.includes('web'), s.key);
    assert.deepStrictEqual(SETTINGS_SECTIONS, [...PAGE_SECTIONS, 'data']);
  });

  it('lists the sections in order, Common first with what most people change, and Data with no setting', () => {
    const keys = (hover: boolean) => Object.fromEntries(pageSections(settingsFor('web'), hover).map((x) => [x.section, x.specs.map((s) => s.key)]));
    assert.deepStrictEqual(keys(true), {
      common: ['language', 'notes.idioms', 'notes.pitfalls', 'examples.enabled', 'hover.enabled', 'panel.animations', 'editor.wrap'],
      examples: ['notes.basis', 'examples.disabled', 'examples.placement'],
      checks: ['shell', 'bashVersion', 'yq.flavor', 'diagnostics.enabled', 'diagnostics.ignore', 'diagnostics.embedded', 'diagnostics.pitfalls', 'customCommands'],
      editor: ['hints.names', 'hints.deadCode'],
      data: [],
    });
    // On a touch screen the hover cards never show: their setting is left out.
    assert.deepStrictEqual(keys(false).common, ['language', 'notes.idioms', 'notes.pitfalls', 'examples.enabled', 'panel.animations', 'editor.wrap']);
  });

  it('finds a setting by its title or its key, with or without the prefix, whatever the case', () => {
    assert.ok(settingMatches('', 'Shell', 'shell'));
    assert.ok(settingMatches('  ', 'Shell', 'shell'));
    assert.ok(settingMatches('shell', 'Shell', 'shell'));
    assert.ok(settingMatches('VERSION', 'bash version', 'bashVersion'));
    assert.ok(settingMatches('bashexplainer.hints.names', 'Name hints', 'hints.names'));
    assert.ok(settingMatches('hints.dead', 'Fade code that never runs', 'hints.deadCode'));
    // Every word, in either.
    assert.ok(settingMatches('fade deadcode', 'Fade code that never runs', 'hints.deadCode'));
    assert.ok(!settingMatches('fade names', 'Fade code that never runs', 'hints.deadCode'));
    assert.ok(settingMatches('ホバー', 'ホバー', 'hover.enabled'));
    // A part of the page with no key (Export and import) is found by its title alone.
    assert.ok(settingMatches('export', 'Export and import'));
    assert.ok(!settingMatches('bashexplainer', 'Export and import'));
  });

  it('finds a setting whatever the width of the letters typed (full-width, half-width kana)', () => {
    assert.ok(settingMatches('ｂａｓｈ', 'bash version', 'bashVersion'));
    assert.ok(settingMatches('ＶＥＲＳＩＯＮ　ｂａｓｈ', 'bash version', 'bashVersion'));
    assert.ok(settingMatches('ｂａｓｈＶｅｒｓｉｏｎ', 'bash version', 'bashVersion'));
    assert.ok(settingMatches('ﾎﾊﾞｰ', 'ホバー', 'hover.enabled'));
    assert.ok(settingMatches('ホバー', 'ﾎﾊﾞｰ', 'hover.enabled'));
    assert.ok(!settingMatches('ｚｓｈ', 'bash version', 'bashVersion'));
  });

  it('folds every section but Common, which is shown whatever is unfolded or searched', () => {
    assert.deepStrictEqual(SETTINGS_SECTIONS.filter(foldable), ['examples', 'checks', 'editor', 'data']);
    const none = new Set<(typeof SETTINGS_SECTIONS)[number]>();
    assert.deepStrictEqual(SETTINGS_SECTIONS.map((x) => sectionOpen(x, none, false)), [true, false, false, false, false]);
    assert.deepStrictEqual(SETTINGS_SECTIONS.map((x) => sectionOpen(x, new Set(['checks']), false)), [true, false, true, false, false]);
    assert.deepStrictEqual(SETTINGS_SECTIONS.map((x) => sectionOpen(x, none, true)), [true, true, true, true, true]);
  });

  it('cuts a description before a blank, after a Japanese character, or before an element, never inside one', () => {
    assert.deepStrictEqual(cutPoints(['Shows a card', null, ' here.']), [[0, 5], [0, 7], [1, 0]]);
    assert.deepStrictEqual(cutPoints(['カードを', null, 'で']), [[0, 1], [0, 2], [0, 3], [1, 0]]);
    // (A full-width parenthesis is Japanese too.)
    assert.deepStrictEqual(cutPoints(['a（b']), [[0, 2]]);
    assert.deepStrictEqual(cutPoints([]), []);
  });

  it('finds the last place that fits', () => {
    for (const n of [0, 1, 2, 7, 100]) {
      for (let last = -1; last < n; last++) assert.strictEqual(lastFit(n, (i) => i <= last), last, `${n} ${last}`);
    }
  });
});
