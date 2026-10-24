// The panel's colours from the editor's theme (`bashExplainer.panel.colors`): the colour arithmetic (src/ui/colour.ts),
// the reading of a theme and the resolution of the roles as VS Code colours them (src/ui/themeTokens.ts), and the
// palettes "theme" and "themeLike" (src/ui/themePalette.ts), with their guarantees checked over every theme the
// tests can read (VS Code's bundled ones, and `$BASH_EXPLAINER_THEMES`; test/support/themes.ts).
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { contrast, deltaE2000, deltaEOK, fromOklch, luminance, mix, parseColour, toHex, toOklch } from '../src/ui/colour';
import { DISTINCT, FREQUENT, GROUP, paletteStats, panelPalette, paletteVars, readable, ROLE_ORDER, SAME, synthesize, type PanelBase } from '../src/ui/themePalette';
import {
  customize, emptyTheme, joinPath, loadTheme, parsePlist, ROLES, roleColours, compareSpecificity, selectorMatch, semanticForeground, tokenFallback, semanticOn, textMateForeground, type Role, type ThemeTokens,
} from '../src/ui/themeTokens';
import { availableThemes, baseOf, readTheme } from './support/themes';

const hex = (s: string) => parseColour(s)!;
const scopes = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).contributes.semanticTokenScopes[0].scopes as Record<string, string[]>;

describe('colour arithmetic', () => {
  it('reads the colours VS Code writes, laying a translucent one over the background', () => {
    assert.deepStrictEqual(parseColour('#abc'), [170, 187, 204]);
    assert.deepStrictEqual(parseColour('#AABBCC'), [170, 187, 204]);
    assert.deepStrictEqual(parseColour('#ffffff80', [0, 0, 0])!.map(Math.round), [128, 128, 128]);
    assert.deepStrictEqual(parseColour('#fff8', [0, 0, 0])!.map(Math.round), [136, 136, 136]);
    assert.deepStrictEqual(parseColour('#ffffff80'), [255, 255, 255]);
    assert.deepStrictEqual(parseColour('rgb(1, 2, 3)'), [1, 2, 3]);
    assert.deepStrictEqual(parseColour('rgba(255, 255, 255, 0.5)', [0, 0, 0]), [127.5, 127.5, 127.5]);
    assert.deepStrictEqual(parseColour('rgb(255 255 255 / 50%)', [0, 0, 0]), [127.5, 127.5, 127.5]);
    assert.strictEqual(parseColour('var(--x)'), undefined);
    assert.strictEqual(toHex([255.4, -3, 300]), '#ff00ff');
    assert.deepStrictEqual(mix([0, 0, 0], [200, 100, 0], 0.5), [100, 50, 0]);
  });

  it('measures contrast as WCAG does', () => {
    assert.strictEqual(contrast([0, 0, 0], [255, 255, 255]), 21);
    assert.strictEqual(luminance([255, 255, 255]), 1);
    assert.strictEqual(Math.round(contrast(hex('#767676'), [255, 255, 255]) * 100) / 100, 4.54);
  });

  it('goes to OKLCH and back, lowering the chroma of a colour out of gamut', () => {
    for (const c of ['#3794ff', '#d18616', '#000000', '#ffffff', '#7f7f7f']) assert.strictEqual(toHex(fromOklch(toOklch(hex(c)))), c);
    assert.strictEqual(toOklch([128, 128, 128])[2], 0);
    const wide = fromOklch([0.7, 0.4, 150]);
    assert.ok(wide.every((x) => x >= 0 && x <= 255));
    assert.ok(Math.abs(toOklch(wide)[0] - 0.7) < 0.02);
  });

  it('measures colour differences: ΔE in OKLab, and CIEDE2000', () => {
    assert.strictEqual(deltaEOK([10, 20, 30], [10, 20, 30]), 0);
    assert.ok(Math.abs(deltaEOK([0, 0, 0], [255, 255, 255]) - 100) < 0.01);
    assert.strictEqual(deltaE2000([10, 20, 30], [10, 20, 30]), 0);
    assert.ok(Math.abs(deltaE2000([0, 0, 0], [255, 255, 255]) - 100) < 0.01);
    // Symmetric, across the hue's wrap (red and violet) and with one grey (no hue).
    for (const [a, b] of [['#ff0040', '#ff00c0'], ['#ff2000', '#c000ff'], ['#808080', '#3794ff'], ['#00ff00', '#ff00ff'], ['#ff0000', '#00ffff']]) {
      const d = deltaE2000(hex(a), hex(b));
      assert.ok(d > 0 && Math.abs(d - deltaE2000(hex(b), hex(a))) < 1e-9, `${a} ${b}`);
    }
    // A pair of the CIEDE2000 test data (Sharma, Wu, Dalal 2005), through sRGB: about 2 apart.
    assert.ok(Math.abs(deltaE2000(hex('#c83232'), hex('#c83737')) - 1.1) < 1);
  });
});

describe('reading a colour theme', () => {
  const files: Record<string, string> = {
    'x/themes/base.json': `{ // comment
      "colors": { "editor.background": "#101010" }, "semanticTokenColors": { "variable": "#111111" }, "semanticHighlighting": true,
      "tokenColors": [ { "scope": "comment", "settings": { "foreground": "#222222" } }, ], }`,
    'x/themes/main.json': '{ "name": "Main", "include": "./base.json", "colors": { "editor.foreground": "#eeeeee" }, "tokenColors": "../tm/rules.tmTheme" }',
    'x/tm/rules.tmTheme': `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>name</key><string>Rules &amp; more</string>
  <!-- the rules -->
  <key>settings</key>
  <array>
    <dict><key>settings</key><dict><key>background</key><string>#000001</string><key>foreground</key><string>#fffffe</string></dict></dict>
    <dict><key>scope</key><string>keyword, storage</string><key>settings</key><dict><key>foreground</key><string>#333333</string></dict></dict>
  </array>
</dict></plist>`,
    'x/themes/loop.json': '{ "include": "./loop.json" }',
    'x/themes/plain.tmTheme': '<plist><dict><key>settings</key><array><dict><key>settings</key><dict/></dict></array></dict></plist>',
  };
  const read = async (f: string) => {
    if (!(f in files)) throw new Error(`no ${f}`);
    return files[f];
  };

  it('joins paths as a theme names its files', () => {
    assert.strictEqual(joinPath('x/themes/main.json', './base.json'), 'x/themes/base.json');
    assert.strictEqual(joinPath('x/themes/main.json', '../tm//a.tmTheme'), 'x/tm/a.tmTheme');
    assert.strictEqual(joinPath('package.json', './themes/a.json'), 'themes/a.json');
    assert.strictEqual(joinPath('a/b.json', '/abs/c.json'), '/abs/c.json');
  });

  it('reads a property list', () => {
    assert.deepStrictEqual(parsePlist('<plist><dict><key>a</key><integer>3</integer><key>b</key><real>1.5</real><key>c</key><true/><key>d</key><false/>'
      + '<key>e</key><array><string>x &lt;y&gt; &quot;z&quot; &apos;</string><string/><array/><dict/></array><key></key><string>k</string></dict></plist>'),
    { a: 3, b: 1.5, c: true, d: false, e: ['x <y> "z" \'', '', [], {}], '': 'k' });
    assert.strictEqual(parsePlist(''), '');
    // Tags written with spaces, an empty key, a self-closed element of another type, numeric entities.
    assert.deepStrictEqual(parsePlist('<dict><key >a</key ><string />\n<key>b</key><true /><key/><false/><key>c</key><data/><key>d</key><string>&#39;&#x41;</string></dict>'),
      { a: '', b: true, '': false, c: '', d: "'A" });
  });

  it('follows includes (the included first), a .tmTheme for the rules, and the colours and semantic rules', async () => {
    const theme = emptyTheme();
    assert.strictEqual(await loadTheme('x/themes/main.json', read, theme), 'Main');
    assert.deepStrictEqual(theme.rules.map((r) => r.settings?.foreground), ['#222222', '#fffffe', '#333333']);
    assert.deepStrictEqual(theme.colors, { 'editor.background': '#101010', 'editor.foreground': '#eeeeee' });
    assert.deepStrictEqual(theme.semantic, { variable: '#111111' });
    assert.strictEqual(theme.semanticHighlighting, true);
    // A theme that is a .tmTheme: its first item gives the editor's colours, unless a theme above gave them.
    const tm = emptyTheme();
    assert.strictEqual(await loadTheme('x/tm/rules.tmTheme', read, tm), undefined);
    assert.deepStrictEqual(tm.colors, { 'editor.foreground': '#fffffe', 'editor.background': '#000001' });
    const plain = emptyTheme();
    await loadTheme('x/themes/plain.tmTheme', read, plain);
    assert.deepStrictEqual(plain.colors, {});
    await assert.rejects(loadTheme('x/themes/loop.json', read), /too many includes/);
    // A theme with nothing but a name.
    files['x/themes/bare.json'] = '{}';
    assert.deepStrictEqual(await (async () => { const t = emptyTheme(); await loadTheme('x/themes/bare.json', read, t); return t; })(), emptyTheme());
    files['x/tm/empty.tmTheme'] = '<plist><dict></dict></plist>';
    assert.deepStrictEqual((await (async () => { const t = emptyTheme(); await loadTheme('x/tm/empty.tmTheme', read, t); return t; })()).rules, []);
  });

  it('matches and ranks selectors as vscode-textmate does', () => {
    const stack = ['source.shell', 'meta.argument.shell', 'string.unquoted.argument.shell', 'constant.other.option.shell'];
    const m = (sel: string) => selectorMatch(sel, stack);
    assert.deepStrictEqual(m('constant'), { depth: 1, parents: [] });
    assert.deepStrictEqual(m('constant.other.option'), { depth: 3, parents: [] });
    assert.deepStrictEqual(m('source string constant.other'), { depth: 2, parents: ['string', 'source'] });
    assert.deepStrictEqual(m('string > constant'), { depth: 1, parents: ['>', 'string'] });
    assert.deepStrictEqual(m('source > meta > string constant'), { depth: 1, parents: ['string', '>', 'meta', '>', 'source'] });
    for (const sel of ['string', 'comment constant', 'constant.other.optional', 'meta > constant', 'string >', '> constant', 'constant - string', 'constant  string', 'source > string constant']) {
      assert.strictEqual(m(sel), undefined, sel);
    }
    assert.strictEqual(selectorMatch('constant', []), undefined);
    // Deeper first; then the longer parent, innermost first; then more parents.
    const cmp = (a: string, b: string) => compareSpecificity(m(a)!, m(b)!);
    assert.ok(cmp('constant', 'constant.other') > 0);
    assert.ok(cmp('source constant', 'string.unquoted constant') > 0);
    assert.ok(cmp('string constant', 'source string constant') > 0);
    assert.ok(cmp('string > constant', 'meta string constant') > 0);
    assert.strictEqual(cmp('string constant', 'string > constant'), 0);
  });

  it('colours a scope stack as the editor does: the best rule for each scope, the inner one winning', () => {
    const rules = [
      { scope: 'string', settings: { foreground: '#000001' } },
      { scope: ['keyword.operator', 'keyword.operator.pipe'], settings: { foreground: '#000002' } },
      { scope: 'keyword.operator', settings: { foreground: '#000003' } },
      { scope: 'keyword.operator.redirect, comment', settings: { foreground: '#000004' } },
      { scope: 'keyword', settings: { fontStyle: 'bold' } },
      { settings: { foreground: '#ffffff' } },
    ];
    assert.strictEqual(textMateForeground(rules, ['source.shell', 'string.unquoted.argument.shell', 'constant.other.option.shell']), '#000001');
    assert.strictEqual(textMateForeground(rules, ['source.shell', 'keyword.operator.pipe.shell']), '#000002');
    assert.strictEqual(textMateForeground(rules, ['source.shell', 'keyword.operator.logical.shell']), '#000003');
    assert.strictEqual(textMateForeground(rules, ['source.shell', 'keyword.operator.redirect.shell']), '#000004');
    assert.strictEqual(textMateForeground(rules, ['source.shell', 'keyword.control.shell']), undefined);
    // A later rule wins a tie; a colour that is not hex is dropped; a list's items are not split at commas.
    const more = [
      { scope: 'source keyword', settings: { foreground: '#000005' } },
      { scope: 'source keyword', settings: { foreground: '#000006' } },
      { scope: 'keyword', settings: { foreground: 'rgb(1, 2, 3)' } },
      { scope: ['comment, keyword'], settings: { foreground: '#000007' } },
    ];
    assert.strictEqual(textMateForeground(more, ['source.shell', 'keyword.control.shell']), '#000006');
    assert.strictEqual(textMateForeground(more, ['comment.line']), undefined);
  });

  it('finds the semantic rule of a token, the most specific winning', () => {
    const semantic = { '*.defaultLibrary': '#000001', function: { foreground: '#000002' }, 'function.defaultLibrary:shellscript': '#000003', 'variable:python': '#000004', parameter: { fontStyle: 'italic' } };
    assert.strictEqual(semanticForeground(semantic, 'function'), '#000002');
    assert.strictEqual(semanticForeground(semantic, 'function.defaultLibrary'), '#000003');
    assert.strictEqual(semanticForeground(semantic, 'function.defaultLibrary', 'python'), '#000002');
    assert.strictEqual(semanticForeground(semantic, 'variable.defaultLibrary'), '#000001');
    assert.strictEqual(semanticForeground(semantic, 'variable'), undefined);
    assert.strictEqual(semanticForeground(semantic, 'variable', 'python'), '#000004');
    assert.strictEqual(semanticForeground(semantic, 'parameter'), undefined);
  });

  it('applies the user\'s customizations, for every theme and for the theme by name', () => {
    const theme = emptyTheme();
    customize(theme, {
      tokens: {
        functions: '#000001', keywords: { foreground: '#000002' }, strings: { fontStyle: 'bold' },
        textMateRules: [{ scope: 'keyword.operator.pipe', settings: { foreground: '#000003' } }],
        '[Other]': { comments: '#000009' },
        '[My Theme][Else]': { variables: '#000004' },
        '[My*]': { numbers: '#000005' },
        '[Bad]': 'not an object',
      },
      semantic: { enabled: true, rules: { variable: '#000006' }, '[My Theme]': { enabled: false, rules: { 'function.defaultLibrary': '#000007' } }, '[Other]': null },
    }, 'My Theme');
    assert.deepStrictEqual(theme.rules.map((r) => r.settings?.foreground), ['#000002', '#000001', '#000003', '#000004', '#000005']);
    assert.strictEqual(textMateForeground(theme.rules, ['source.shell', 'keyword.control.shell']), '#000002');
    // (`keyword - keyword.operator` matches nothing in the editor's theming: the operators keep their colour.)
    assert.strictEqual(textMateForeground(theme.rules, ['source.shell', 'keyword.operator.redirect.shell']), undefined);
    assert.deepStrictEqual(theme.semantic, { variable: '#000006', 'function.defaultLibrary': '#000007' });
    assert.strictEqual(theme.semanticHighlighting, false);
    const none = emptyTheme();
    customize(none, {}, 'X');
    customize(none, { tokens: { textMateRules: 'no' }, semantic: { rules: 'no' } }, 'X');
    assert.deepStrictEqual(none, emptyTheme());
  });

  it('says when the editor draws our semantic tokens', () => {
    const on = { ...emptyTheme(), semanticHighlighting: true };
    assert.strictEqual(semanticOn(on, 'configuredByTheme', true), true);
    assert.strictEqual(semanticOn(emptyTheme(), 'configuredByTheme', true), false);
    assert.strictEqual(semanticOn(emptyTheme(), true, true), true);
    assert.strictEqual(semanticOn(on, false, true), false);
    assert.strictEqual(semanticOn(on, true, false), false);
  });

  it('resolves each role from the semantic token, its scopes, or the grammar', () => {
    const theme: ThemeTokens = {
      ...emptyTheme(),
      semantic: { 'function.defaultLibrary': '#000001' },
      rules: [
        { scope: 'entity.name.function', settings: { foreground: '#000002' } },
        { scope: 'variable.other.normal', settings: { foreground: '#000003' } },
        { scope: 'keyword.operator', settings: { foreground: '#000004' } },
        { scope: 'variable.parameter', settings: { foreground: '#000005' } },
        { scope: 'constant.other.option', settings: { foreground: '#000006' } },
        { scope: 'variable', settings: { foreground: '#000007' } },
      ],
    };
    const grammar = roleColours(theme, false, scopes);
    assert.strictEqual(grammar.builtin, undefined);
    assert.strictEqual(grammar.command, '#000002');
    assert.strictEqual(grammar.option, '#000006');
    assert.strictEqual(grammar.redirect, '#000004');
    assert.strictEqual(grammar.argument, undefined);
    const sem = roleColours(theme, true, scopes);
    assert.strictEqual(sem.builtin, '#000001');
    assert.strictEqual(sem.variable, '#000003');
    // Our scopes for the operator (the pipe's) colour a redirect too, as the editor does with semantic tokens.
    assert.strictEqual(sem.redirect, '#000004');
    // Without our scopes, VS Code's defaults for the type: a parameter as `variable.parameter`; a modification as its type.
    // VS Code's own default rules count too: with our scope for parameters unmatched, `variable.parameter` is.
    assert.strictEqual(tokenFallback(theme.rules, 'parameter', { parameter: ['constant.other.nothing'] }), '#000005');
    // The most specific default first: a builtin by `support.function` before `function`'s scopes.
    assert.strictEqual(tokenFallback([...theme.rules, { scope: 'support.function', settings: { foreground: '#000008' } }], 'function.defaultLibrary', {}), '#000008');
    assert.strictEqual(tokenFallback(theme.rules, 'function.defaultLibrary', {}), '#000002');
    assert.strictEqual(tokenFallback(theme.rules, 'variable', {}, 'python'), '#000007');
    assert.strictEqual(tokenFallback([], 'comment', { 'comment:python': ['x'] }), undefined);
    const defaults = roleColours(theme, true, {});
    assert.strictEqual(defaults.option, '#000005');
    assert.strictEqual(defaults.assignment, '#000007');
    assert.strictEqual(defaults.argument, undefined);
  });
});

describe('the palettes that follow the theme', () => {
  const classicDark: Record<Role, string> = {
    command: 'rgb(55, 148, 255)', builtin: 'rgb(55, 148, 255)', option: 'rgb(209, 134, 22)', argument: 'rgb(137, 209, 133)', string: 'rgb(137, 209, 133)',
    number: 'rgb(137, 209, 133)', keyword: 'rgb(177, 128, 215)', operator: 'rgb(177, 128, 215)', redirect: 'rgb(204, 167, 0)', pattern: 'rgb(204, 167, 0)',
    variable: 'rgb(255, 92, 101)', assignment: 'rgb(255, 92, 101)', comment: 'rgba(204, 204, 204, 0.7)',
  };
  const dark: PanelBase = { highContrast: false, backgrounds: ['#1f1f1f', 'rgba(10, 10, 10, 0.4)', '#2a2d2e'], foreground: '#cccccc', classic: classicDark };
  const none = Object.fromEntries(ROLES.map((r) => [r, undefined])) as Record<Role, string | undefined>;
  // Dark Modern's colours of the roles (the editor's, measured in VS Code 1.142).
  const darkModern: Record<Role, string | undefined> = {
    command: '#DCDCAA', builtin: '#DCDCAA', option: '#569cd6', argument: '#ce9178', string: '#ce9178', number: '#b5cea8', keyword: '#C586C0',
    operator: '#d4d4d4', redirect: '#d4d4d4', pattern: '#d16969', variable: '#9CDCFE', assignment: '#9CDCFE', comment: '#6A9955',
  };

  it('orders the roles by frequency, and keeps every role in a group', () => {
    assert.deepStrictEqual([...ROLE_ORDER].sort(), [...ROLES].sort());
    assert.deepStrictEqual(FREQUENT, ROLE_ORDER.slice(0, 8));
    assert.deepStrictEqual(Object.keys(GROUP).sort(), [...ROLES].sort());
    assert.ok(SAME < DISTINCT);
  });

  it('classic: the panel\'s own colours (a translucent one laid over the background)', () => {
    const p = panelPalette('classic', darkModern, dark);
    assert.strictEqual(p.command, '#3794ff');
    assert.strictEqual(p.comment, toHex(parseColour(classicDark.comment, hex('#1f1f1f'))!));
    assert.deepStrictEqual(Object.keys(paletteVars(p)), ROLES.map((r) => `--c-${r}`));
  });

  it('theme: the theme\'s colours, the panel\'s where the theme has none or one too faint', () => {
    const p = panelPalette('theme', darkModern, dark);
    assert.strictEqual(p.command, '#dcdcaa');
    assert.strictEqual(p.operator, '#d4d4d4');
    // #6A9955 is 4.4:1 on a code block: the panel's muted colour instead.
    assert.strictEqual(p.comment, panelPalette('classic', none, dark).comment);
    assert.deepStrictEqual(panelPalette('theme', none, dark), panelPalette('classic', none, dark));
    // An unreadable colour of the theme's own (`var(…)` is not one).
    assert.strictEqual(panelPalette('theme', { ...none, command: 'var(--x)' }, dark).command, '#3794ff');
    // High contrast: the theme's colour only at 7:1.
    const hc: PanelBase = { highContrast: true, backgrounds: ['#000000'], foreground: '#ffffff', classic: { ...classicDark, command: '#6badff' } };
    assert.strictEqual(panelPalette('theme', { ...none, command: '#0060c0' }, hc).command, '#6badff');
    assert.strictEqual(panelPalette('theme', { ...none, command: '#9cdcfe' }, hc).command, '#9cdcfe');
  });

  it('themeLike: the theme\'s colours where they keep the groups apart, new ones where not', () => {
    const p = panelPalette('themeLike', darkModern, dark);
    // Frequent roles keep the theme's colour; a builtin keeps the command's (one group).
    for (const r of ['command', 'builtin', 'string', 'argument', 'variable', 'keyword', 'option'] as Role[]) assert.strictEqual(p[r], darkModern[r]!.toLowerCase(), r);
    // The operator is the foreground in Dark Modern: it takes the keyword's colour, as in the panel's own palette.
    assert.strictEqual(p.operator, p.keyword);
    // The number's #B5CEA8 is near the command's #DCDCAA: it takes the argument's colour, its group's.
    assert.strictEqual(p.number, p.argument);
    // The redirect is the foreground and the pattern is near the string: their group gets a colour of its own.
    assert.strictEqual(p.redirect, p.pattern);
    assert.ok(!Object.values(darkModern).includes(p.redirect));
    const s = paletteStats(p, dark);
    assert.ok(s.deltaEOK >= SAME && s.contrast >= 4.5, JSON.stringify(s));
    // A theme with no colours: every group made, apart.
    const made = panelPalette('themeLike', none, dark);
    assert.ok(paletteStats(made, dark).deltaEOK >= DISTINCT, JSON.stringify(paletteStats(made, dark)));
    // A theme whose colour cannot be read (`var(…)`) counts as the foreground.
    assert.deepStrictEqual(panelPalette('themeLike', { ...none, command: 'var(--x)' }, dark), made);
  });

  it('themeLike on a light background, with colours it cannot read', () => {
    // A background, a foreground and a classic colour that are not colours (`var(…)`): passed over, the argument's, the background.
    const light: PanelBase = { highContrast: false, backgrounds: ['#ffffff', '#f2f2f2', 'transparent'], foreground: 'var(--x)', classic: { ...classicDark, argument: '#1f7c2b', comment: 'var(--y)' } };
    const p = panelPalette('themeLike', none, light);
    assert.ok(paletteStats(p, light).contrast >= 4.5);
    assert.strictEqual(panelPalette('classic', none, light).comment, '#ffffff');
  });

  it('themeLike where nothing can be read: black and white surfaces at 7:1', () => {
    const both: PanelBase = { highContrast: true, backgrounds: ['#000000', '#ffffff'], foreground: '#808080', classic: classicDark };
    const p = panelPalette('themeLike', none, both);
    // The foreground stays as it is; each group gets the extreme towards contrast with the first surface.
    assert.strictEqual(p.argument, '#808080');
    assert.strictEqual(p.command, '#ffffff');
    const light = { ...both, backgrounds: ['#ffffff', '#000000'] };
    assert.strictEqual(panelPalette('themeLike', none, light).command, '#000000');
  });

  it('themeLike computes again on its own tints until they stop changing it', () => {
    // (Found by a random search: the first palette, made on the classic colours' tints, is not readable on its own.)
    const theme = { command: undefined, builtin: '#36ff27', option: '#9d0000', argument: '#ba516a', string: '#ae34d6', number: '#d41814', keyword: '#a13636', operator: '#63f3f2', redirect: '#44b148', pattern: '#c86c48', variable: '#0231fb', assignment: '#d12265', comment: '#2dd428' };
    const classic = { command: '#0021c1', builtin: '#758838', option: '#0cadad', argument: '#ef6284', string: '#d4080d', number: '#87ab01', keyword: '#62116a', operator: '#af96ee', redirect: '#d88617', pattern: '#a76ab3', variable: '#e9c343', assignment: '#0cbc54', comment: '#a1c1fd' };
    const base: PanelBase = { highContrast: false, backgrounds: ['#ffffff', 'rgba(10,10,10,0.4)', '#e8e8e8'], foreground: '#333333', classic };
    const s = paletteStats(panelPalette('themeLike', theme, base), base);
    assert.ok(s.contrast >= 4.5 && s.deltaEOK >= SAME, JSON.stringify(s));
  });

  it('makes a colour readable by changing its lightness only, or says it cannot', () => {
    const dim = readable(hex('#6A9955'), [hex('#2b2b2b')], 4.5)!;
    assert.ok(contrast(dim, hex('#2b2b2b')) >= 4.5);
    assert.ok(Math.abs(toOklch(dim)[2] - toOklch(hex('#6A9955'))[2]) < 3);
    const darker = readable(hex('#6A9955'), [hex('#ffffff')], 4.5)!;
    assert.ok(toOklch(darker)[0] < toOklch(hex('#6A9955'))[0]);
    assert.strictEqual(readable(hex('#808080'), [hex('#000000'), hex('#ffffff')], 7), undefined);
  });

  it('makes a new colour far from those in use, within the theme\'s range, widening it when nothing is readable', () => {
    const used = [hex('#ff0000'), hex('#00ff00')];
    const c = synthesize(used, [hex('#c586c0'), hex('#569cd6')], [hex('#1f1f1f')], 4.5);
    assert.ok(contrast(c, hex('#1f1f1f')) >= 4.5);
    assert.ok(Math.min(...used.map((u) => deltaEOK(u, c))) > 20);
    // Dark colours on a dark background: the range widens up to readable ones.
    const w = synthesize([], [hex('#202060'), hex('#602020')], [hex('#000000')], 7);
    assert.ok(contrast(w, hex('#000000')) >= 7);
    const l = synthesize([], [hex('#e0e0ff'), hex('#ffe0e0')], [hex('#ffffff')], 7);
    assert.ok(contrast(l, hex('#ffffff')) >= 7);
  });

  describe('over the themes the tests can read', () => {
    const themes = availableThemes();
    before(function () {
      if (!themes.length) this.skip();
    });
    for (const semantic of [false, true]) {
      it(`keeps the groups apart and readable in every theme${semantic ? ', with semantic highlighting' : ''}`, async () => {
        const failures: string[] = [];
        for (const t of themes) {
          const theme = await readTheme(t.file);
          const base = baseOf(theme, t.uiTheme);
          const roles = roleColours(theme, semantic && theme.semanticHighlighting === true, scopes);
          const min = base.highContrast ? 7 : 4.5;
          const like = paletteStats(panelPalette('themeLike', roles, base), base);
          if (like.deltaEOK < SAME || like.contrast < min) failures.push(`${t.name} themeLike: ${JSON.stringify(like)}`);
          // "theme" is as readable as the panel's own colours, role by role.
          const exact = panelPalette('theme', roles, base);
          const classic = panelPalette('classic', roles, base);
          for (const r of ROLES) {
            const own = roles[r] && parseColour(roles[r], hex(base.backgrounds[0]));
            if (exact[r] !== classic[r] && (!own || exact[r] !== toHex(own))) failures.push(`${t.name} theme ${r}: ${exact[r]}`);
          }
        }
        assert.deepStrictEqual(failures, []);
      });
    }

    it('resolves the roles of Dark Modern as VS Code 1.142 draws them in the editor', async function () {
      const dm = themes.find((t) => t.name === 'Dark Modern');
      if (!dm) return this.skip();
      const roles = roleColours(await readTheme(dm.file), false, scopes);
      assert.deepStrictEqual(Object.fromEntries(ROLES.map((r) => [r, roles[r]?.toLowerCase()])), Object.fromEntries(ROLES.map((r) => [r, darkModern[r]?.toLowerCase()])));
    });
  });
});
