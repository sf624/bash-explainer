import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { HIGHLIGHT_KINDS } from '../src/highlight';
import { TOKEN_OF } from '../src/semanticTokens';
import { CLASSIC_COLOURS, CLASSIC_ROLE, EDITOR_COLOURS, kindColour, paletteColour, PANEL_KIND_ROLE } from '../web/editor-colors';

describe('the colours of the editor', () => {
  it('has a scope and a colour for every highlight kind', () => {
    assert.deepEqual(Object.keys(EDITOR_COLOURS).sort(), [...HIGHLIGHT_KINDS, 'argument'].sort());
    for (const k of HIGHLIGHT_KINDS) {
      const c = EDITOR_COLOURS[k];
      assert.ok(c.scope.endsWith('.shell') || k === 'error', k);
      for (const v of [c.dark, c.light]) assert.ok(v === null || /^#[0-9A-F]{6}$/.test(v), `${k} ${v}`);
      assert.ok(kindColour(k).length > 0);
    }
    assert.equal(kindColour('option'), 'light-dark(#0000FF, #569CD6)');
    assert.equal(kindColour('operator'), 'light-dark(#000000, #D4D4D4)');
  });

  it('maps every semantic token type we send to a scope of the shell grammar, as the web page does', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const scopes: Record<string, string[]> = pkg.contributes.semanticTokenScopes[0].scopes;
    for (const [kind, token] of Object.entries(TOKEN_OF)) {
      if (!token) continue;
      const [type, ...mods] = token;
      // The most specific selector: the type and the most modifiers.
      const selector = [type, ...mods].join('.');
      assert.ok(scopes[selector], `${kind}: no semanticTokenScopes for ${selector}`);
      assert.ok(scopes[selector].every((s) => s.endsWith('.shell')), selector);
      // The web page uses the same scope for the kind, unless it is told apart there (a redirection, a heredoc).
      if (!['redirect', 'heredoc', 'command', 'substitution', 'heredocDelimiter'].includes(kind)) assert.equal(scopes[selector][0], EDITOR_COLOURS[kind as keyof typeof EDITOR_COLOURS].scope, kind);
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
  const FG = 'var(--vscode-editor-foreground)';

  it('gives the panel the colours of the editor, light and dark, for every kind of token', () => {
    const root = path.join(__dirname, '..');
    const panel = fs.readFileSync(path.join(root, 'media', 'panel.css'), 'utf8');
    const page = fs.readFileSync(path.join(root, 'web', 'panel-page.css'), 'utf8');
    // The colour each `.kind-*` takes: a variable.
    const kindVar = new Map<string, string>();
    for (const m of panel.matchAll(/^((?:\.kind-\w+(?:, )?)+) \{ color: var\((--c-[\w-]+)\); \}$/gm)) for (const k of m[1].split(', ')) kindVar.set(k.slice(6), m[2]);
    assert.deepEqual([...kindVar.keys(), 'error'].sort(), Object.keys(PANEL_KIND_ROLE).sort());
    // The variables in VS Code's dark and light themes (panel.css), and on the web page (panel-page.css, light-dark()).
    const dark = declared(panel, /body\.vscode-dark:not\(\.vscode-high-contrast\):not\(\.colors-classic\) \{([^}]*)\}/);
    const light = declared(panel, /body\.vscode-light:not\(\.vscode-high-contrast-light\):not\(\.colors-classic\) \{([^}]*)\}/);
    const web = declared(page, /^body:not\(\.colors-classic\) \{([^}]*)\}/m);
    for (const [kind, v] of kindVar) {
      const { dark: d, light: l } = EDITOR_COLOURS[PANEL_KIND_ROLE[kind as keyof typeof PANEL_KIND_ROLE]];
      assert.equal(dark[v], d ?? FG, `${kind} in dark`);
      assert.equal(light[v], l ?? FG, `${kind} in light`);
      assert.equal(web[v], d && l ? `light-dark(${l}, ${d})` : FG, `${kind} on the web page`);
    }
  });

  it('gives the panel the classic colours of the editor, in the variables of :root', () => {
    const panel = fs.readFileSync(path.join(__dirname, '..', 'media', 'panel.css'), 'utf8');
    const root = declared(panel, /^:root \{([^}]*)\}/m);
    const resolve = (v: string): string => (/^var\((--c-[\w-]+)\)$/.exec(v) ? resolve(root[/^var\((--c-[\w-]+)\)$/.exec(v)![1]]) : v);
    const kindVar = new Map<string, string>();
    for (const m of panel.matchAll(/^((?:\.kind-\w+(?:, )?)+) \{ color: var\((--c-[\w-]+)\); \}$/gm)) for (const k of m[1].split(', ')) kindVar.set(k.slice(6), m[2]);
    for (const [kind, v] of kindVar) {
      const role = PANEL_KIND_ROLE[kind as keyof typeof PANEL_KIND_ROLE];
      assert.equal(resolve(`var(${v})`), CLASSIC_COLOURS[CLASSIC_ROLE[role]], kind);
    }
    assert.equal(paletteColour('option', 'classic'), CLASSIC_COLOURS.option);
    assert.equal(paletteColour('option', 'vscode'), kindColour('option'));
    assert.equal(paletteColour('error', 'classic'), 'var(--vscode-errorForeground)');
  });
});
