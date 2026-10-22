// The settings module (src/settings.ts) against package.json, and the code that reads settings
// outside VS Code: settings files, `--set key=value`, editors' settings objects.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { EXAMPLE_KINDS } from '../src/analyzer';
import { SHELL_NAMES } from '../src/dialect';
import { YQ_NAMES } from '../src/embedded/yq';
import {
  changedSettings, checkValue, defaultSettings, defaultSettingsPath, explainOptions, exportSettings, forcedShell, importSettings, mergeSettings, parseAssignment,
  parseJsonc, PREFIX, readSettings, settingSpec, settingsFor, settingsJson, settingTexts, SETTINGS,
} from '../src/settings';

const root = path.join(__dirname, '..');
const json = (file: string) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const configuration = json('package.json').contributes.configuration;
const properties: Record<string, any> = configuration.properties;
/** The settings VS Code lists in package.json (those of the web page only are not). */
const VSCODE = SETTINGS.filter((s) => s.surfaces.includes('vscode'));

describe('the settings module', () => {
  it('lists the settings of package.json, in the same order', () => {
    assert.deepStrictEqual(VSCODE.map((s) => PREFIX + s.key), Object.keys(properties));
  });

  it('keeps a setting of the web page only out of package.json, with its own description', () => {
    const webOnly = SETTINGS.filter((s) => !s.surfaces.includes('vscode'));
    assert.deepStrictEqual(webOnly.map((s) => s.key), ['editor.wrap']);
    for (const s of webOnly) {
      assert.deepStrictEqual(s.surfaces, ['web']);
      assert.ok(s.description![0] && s.description![1] && s.elsewhere);
      assert.strictEqual(properties[PREFIX + s.key], undefined);
    }
    for (const s of VSCODE) assert.strictEqual(s.description, undefined);
  });

  for (const spec of VSCODE) {
    it(`agrees with package.json on ${spec.key}`, () => {
      const p = properties[PREFIX + spec.key];
      assert.strictEqual(spec.type, p.type);
      assert.deepStrictEqual(spec.default, p.default);
      assert.deepStrictEqual(spec.enum, p.enum);
      assert.deepStrictEqual(spec.items, p.items?.enum);
      assert.strictEqual(spec.minimum, p.minimum);
      // The default is a valid value.
      assert.strictEqual(checkValue(spec, spec.default), undefined);
      assert.ok(spec.title[0] && spec.title[1]);
      // Every setting is in VS Code; one missing elsewhere says why.
      assert.ok(spec.surfaces.includes('vscode'));
      assert.strictEqual(spec.surfaces.length < 4, !!spec.elsewhere, 'a setting not offered everywhere says why, and only then');
    });
  }

  it('names the shells, yq flavors and kinds of examples the code knows', () => {
    assert.deepStrictEqual(settingSpec('shell')!.enum, ['auto', ...Object.keys(SHELL_NAMES)]);
    assert.deepStrictEqual(settingSpec('yq.flavor')!.enum, ['auto', ...Object.keys(YQ_NAMES)]);
    assert.deepStrictEqual(settingSpec('examples.disabled')!.items, EXAMPLE_KINDS);
    assert.strictEqual(settingSpec('nope'), undefined);
  });

  it('has a description in English and Japanese for each setting and each value', () => {
    for (const nls of [json('package.nls.json'), json('package.nls.ja.json')]) {
      const texts = settingTexts(configuration, nls);
      assert.deepStrictEqual(Object.keys(texts), VSCODE.map((s) => s.key));
      for (const [key, t] of Object.entries(texts)) {
        assert.ok(t.description && !/^%.*%$/.test(t.description), key);
        for (const label of Object.values(t.values ?? {})) assert.ok(label && !/^%.*%$/.test(label), key);
      }
      assert.deepStrictEqual(Object.keys(texts['examples.disabled'].values!), EXAMPLE_KINDS);
    }
    // A reference with no translation stays as it is.
    assert.deepStrictEqual(settingTexts({ properties: { 'bashExplainer.x': { description: '%missing%' } } }, {}), { x: { description: '%missing%', values: undefined } });
  });

  it('gives each surface its settings', () => {
    assert.strictEqual(settingsFor('vscode').length, VSCODE.length);
    const web = settingsFor('web').map((s) => s.key);
    assert.ok(web.includes('customCommands') && web.includes('examples.placement') && !web.includes('panel.autoOpen'));
    assert.ok(!settingsFor('cli').some((s) => s.key === 'diagnostics.enabled'));
    assert.ok(settingsFor('lsp').some((s) => s.key === 'hover.maxDepth'));
  });

  it('checks values', () => {
    const check = (key: string, v: unknown) => checkValue(settingSpec(key)!, v);
    assert.strictEqual(check('notes.idioms', 'no'), 'expected true or false');
    assert.strictEqual(check('shell', 'fish'), 'expected one of auto, bash, sh, dash, ash, yash, ksh, mksh, zsh');
    assert.strictEqual(check('shell', 3), 'expected one of auto, bash, sh, dash, ash, yash, ksh, mksh, zsh');
    assert.strictEqual(check('hover.followDelay', '5'), 'expected a number');
    assert.strictEqual(check('hover.followDelay', Infinity), 'expected a number');
    assert.strictEqual(check('inline.maxLength', 10), 'expected a number from 20');
    assert.strictEqual(check('inline.maxLength', 20), undefined);
    assert.strictEqual(check('diagnostics.ignore', 'crlf'), 'expected a list of strings');
    assert.strictEqual(check('diagnostics.ignore', [1]), 'expected a list of strings');
    assert.strictEqual(check('diagnostics.ignore', ['crlf', 'anything']), undefined);
    assert.strictEqual(check('examples.disabled', ['sed', 'nope']), 'unknown nope (expected regex, sed, awk, jq, yq, perl, textFilters, pipeline, expansion, printf, glob, test, xargs, read, getopt, gitLog, date)');
    assert.strictEqual(check('customCommands', []), 'expected an object');
    assert.strictEqual(check('customCommands', null), 'expected an object');
    assert.strictEqual(check('customCommands', { deploy: { summary: 'x' } }), undefined);
  });

  it('reads flat keys with or without the prefix, and nested objects, and warns about the rest', () => {
    const r = readSettings({
      'bashExplainer.language': 'ja',
      shell: 'dash',
      bashExplainer: { notes: { idioms: false }, 'examples.enabled': false },
      examples: { disabled: ['sed'], nope: 1 },
      'hover.maxDepth': -1,
      'editor.fontSize': 14,
      customCommands: { deploy: { summary: 'Deploy' } },
    }, 'settings.json');
    assert.deepStrictEqual(r.settings, {
      language: 'ja', shell: 'dash', 'notes.idioms': false, 'examples.enabled': false, 'examples.disabled': ['sed'],
      customCommands: { deploy: { summary: 'Deploy' } },
    });
    assert.deepStrictEqual(r.warnings, [
      'settings.json: unknown setting examples.nope; ignored',
      'settings.json: bashExplainer.hover.maxDepth: expected a number from 0; ignored',
      'settings.json: unknown setting editor.fontSize; ignored',
    ]);
    assert.deepStrictEqual(readSettings({ bashExplainer: 1 }, 'x').warnings, ['x: unknown setting bashExplainer; ignored']);
    assert.deepStrictEqual(readSettings([1], 'x'), { settings: {}, warnings: ['x: expected an object of settings'], ignored: [] });
    // A value read is a copy.
    const list = ['crlf'];
    const read = readSettings({ 'diagnostics.ignore': list }, 'x').settings;
    list.push('more');
    assert.deepStrictEqual(read['diagnostics.ignore'], ['crlf']);
  });

  it('imports what applies on a surface, and says which keys it leaves out and why', () => {
    const text = `{
      // a copy of VS Code's settings.json
      "bashExplainer.shell": "sh",
      "notes": { "idioms": false },
      "bashExplainer.hover.enabled": false,
      "bashExplainer.nope": 1,
      "editor.fontSize": 14,
      "examples.placement": "nowhere",
    }`;
    assert.deepStrictEqual(importSettings(text, 'web'), {
      settings: { shell: 'sh', 'notes.idioms': false },
      ignored: [
        { key: 'nope', reason: 'unknown' },
        { key: 'editor.fontSize', reason: 'unknown' },
        { key: 'examples.placement', reason: 'invalid', detail: 'expected one of first, last, bottom' },
        { key: 'hover.enabled', reason: 'elsewhere' },
      ],
    });
    assert.deepStrictEqual(importSettings('{"hover.enabled": false}', 'lsp').settings, { 'hover.enabled': false });
    // A setting of a build that had it (bashExplainer.colors, before 0.7.0) is unknown like any other key.
    assert.deepStrictEqual(importSettings('{"bashExplainer.colors": "classic"}', 'web'), { settings: {}, ignored: [{ key: 'colors', reason: 'unknown' }] });
    assert.throws(() => importSettings('[1]', 'web'), /expected an object of settings/);
    assert.throws(() => importSettings('{', 'web'), SyntaxError);
  });

  it('exports the settings that differ from the defaults, as a settings file, and imports them back', () => {
    assert.strictEqual(exportSettings(defaultSettings(), 'web'), '{}\n');
    const s = mergeSettings({ shell: 'dash', 'examples.disabled': ['sed'], 'hover.enabled': false, customCommands: { deploy: { summary: 'Deploy' } } });
    const text = exportSettings(s, 'web');
    assert.strictEqual(text, `{
  "bashExplainer.shell": "dash",
  "bashExplainer.examples.disabled": [
    "sed"
  ],
  "bashExplainer.customCommands": {
    "deploy": {
      "summary": "Deploy"
    }
  }
}
`);
    const back = importSettings(text, 'web');
    assert.deepStrictEqual(back.ignored, []);
    assert.deepStrictEqual(mergeSettings(back.settings), mergeSettings({ shell: 'dash', 'examples.disabled': ['sed'], customCommands: { deploy: { summary: 'Deploy' } } }));
  });

  it('reads key=value, the value as JSON when it is JSON', () => {
    assert.deepStrictEqual(parseAssignment('shell=dash'), { key: 'shell', value: 'dash' });
    assert.deepStrictEqual(parseAssignment('notes.idioms=false'), { key: 'notes.idioms', value: false });
    assert.deepStrictEqual(parseAssignment('diagnostics.ignore=["crlf"]'), { key: 'diagnostics.ignore', value: ['crlf'] });
    assert.deepStrictEqual(parseAssignment('x=a=b'), { key: 'x', value: 'a=b' });
    assert.deepStrictEqual(parseAssignment('x='), { key: 'x', value: '' });
    assert.strictEqual(parseAssignment('=1'), undefined);
    assert.strictEqual(parseAssignment('shell'), undefined);
  });

  it('reads JSON with comments and trailing commas, as settings.json is written', () => {
    const text = `{
      // a comment
      "bashExplainer.shell": "dash", /* another */
      "a//b": "x/*y*/z",
      "q": "say \\"hi\\", ]",
      "list": [1, 2,],
    }`;
    assert.deepStrictEqual(parseJsonc(text), { 'bashExplainer.shell': 'dash', 'a//b': 'x/*y*/z', q: 'say "hi", ]', list: [1, 2] });
    assert.deepStrictEqual(parseJsonc('{} /* not closed'), {});
    assert.throws(() => parseJsonc('{"a": }'), SyntaxError);
    assert.throws(() => parseJsonc('{"a'), SyntaxError);
  });

  it('looks for the settings file under XDG_CONFIG_HOME, else ~/.config', () => {
    assert.strictEqual(defaultSettingsPath({ XDG_CONFIG_HOME: '/x', HOME: '/h' }), '/x/bash-explainer/settings.json');
    assert.strictEqual(defaultSettingsPath({ HOME: '/h' }), '/h/.config/bash-explainer/settings.json');
    assert.strictEqual(defaultSettingsPath({ USERPROFILE: 'C:\\Users\\u' }), 'C:\\Users\\u/.config/bash-explainer/settings.json');
    assert.strictEqual(defaultSettingsPath({}), undefined);
  });

  it('merges layers over the defaults, and gives what the analyzer takes', () => {
    const d = defaultSettings();
    d['diagnostics.ignore'].push('x');
    assert.deepStrictEqual(defaultSettings()['diagnostics.ignore'], [], 'the defaults are not shared');
    const s = mergeSettings({ shell: 'dash', 'notes.idioms': false }, { shell: 'sh' });
    assert.strictEqual(s.shell, 'sh');
    assert.strictEqual(forcedShell(s), 'sh');
    assert.strictEqual(forcedShell(defaultSettings()), undefined);
    assert.deepStrictEqual(explainOptions(s), {
      yqFlavor: 'auto', examples: { enabled: true, disabled: [] }, idioms: false, pitfalls: true, customCommands: {},
    });
    assert.deepStrictEqual(changedSettings(s), { 'bashExplainer.notes.idioms': false, 'bashExplainer.shell': 'sh' });
    assert.deepStrictEqual(changedSettings(mergeSettings({ 'panel.autoOpen': true, shell: 'sh' }), 'web'), { 'bashExplainer.shell': 'sh' });
    const cli = settingsJson(s, 'cli');
    assert.deepStrictEqual(Object.keys(cli), settingsFor('cli').map((x) => PREFIX + x.key));
    assert.strictEqual(cli['bashExplainer.shell'], 'sh');
  });
});
