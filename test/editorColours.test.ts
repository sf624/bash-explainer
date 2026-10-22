import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { HIGHLIGHT_KINDS } from '../src/highlight';
import { TOKEN_OF } from '../src/semanticTokens';
import { CLASSIC_COLOURS, CLASSIC_ROLE, kindColour, PANEL_KIND_ROLE } from '../web/editor-colors';

describe('the colours of the editor', () => {
  it('has a colour for every highlight kind', () => {
    for (const k of HIGHLIGHT_KINDS) assert.match(kindColour(k), /^var\(--vscode-[\w-]+(, #[0-9a-f]{3,6})?\)$/, k);
    assert.equal(kindColour('option'), CLASSIC_COLOURS.option);
    assert.equal(kindColour('error'), 'var(--vscode-errorForeground)');
  });

  it('maps every semantic token type we send to a scope of the shell grammar', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const scopes: Record<string, string[]> = pkg.contributes.semanticTokenScopes[0].scopes;
    for (const [kind, token] of Object.entries(TOKEN_OF)) {
      if (!token) continue;
      const [type, ...mods] = token;
      // The most specific selector: the type and the most modifiers.
      const selector = [type, ...mods].join('.');
      assert.ok(scopes[selector], `${kind}: no semanticTokenScopes for ${selector}`);
      assert.ok(scopes[selector].every((s) => s.endsWith('.shell')), selector);
    }
    for (const selector of Object.keys(scopes)) {
      const [type, ...mods] = selector.split('.');
      assert.ok(Object.values(TOKEN_OF).some((t) => t && t[0] === type && mods.every((m) => t.includes(m as never))), `${selector} is not used`);
    }
  });

  // The variables a rule of CSS declares, as { name: value }.
  const declared = (css: string, selector: RegExp): Record<string, string> => {
    const m = selector.exec(css);
    assert.ok(m, String(selector));
    return Object.fromEntries([...m[1].matchAll(/(--c-[\w-]+):\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()]));
  };

  it('gives the panel the colours of the editor, in the variables of :root, for every kind of token', () => {
    const root = path.join(__dirname, '..');
    const panel = fs.readFileSync(path.join(root, 'media', 'panel.css'), 'utf8');
    const vars = declared(panel, /^:root \{([^}]*)\}/m);
    const resolve = (v: string): string => (/^var\((--c-[\w-]+)\)$/.exec(v) ? resolve(vars[/^var\((--c-[\w-]+)\)$/.exec(v)![1]]) : v);
    // The colour each `.kind-*` takes: a variable.
    const kindVar = new Map<string, string>();
    for (const m of panel.matchAll(/^((?:\.kind-\w+(?:, )?)+) \{ color: var\((--c-[\w-]+)\); \}$/gm)) for (const k of m[1].split(', ')) kindVar.set(k.slice(6), m[2]);
    assert.deepEqual([...kindVar.keys(), 'error'].sort(), Object.keys(PANEL_KIND_ROLE).sort());
    for (const [kind, v] of kindVar) {
      const role = PANEL_KIND_ROLE[kind as keyof typeof PANEL_KIND_ROLE];
      assert.equal(resolve(`var(${v})`), CLASSIC_COLOURS[CLASSIC_ROLE[role]], kind);
    }
    // Nothing redefines them: no other palette, in VS Code's themes or on the web page.
    const page = fs.readFileSync(path.join(root, 'web', 'panel-page.css'), 'utf8');
    for (const css of [panel, page]) assert.equal(css.match(/--c-command:/g)?.length ?? 0, css === panel ? 1 : 0);
  });
});
