import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { HOST_LANGUAGES, OWN_SEMANTIC_LANGUAGES, SEMANTIC_LANGUAGES } from '../src/document-setup';
import { decodeTokens, semanticTokens } from '../src/semanticTokens';
import { extractShell } from '../src/hosts';
import { hostedHighlight } from '../src/highlight';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

const parser = createUnbashParser();
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));

describe('semanticTokenScopes in package.json', () => {
  const entries: { language?: string; scopes: Record<string, string[]> }[] = pkg.contributes.semanticTokenScopes;

  it('has an entry per language, never one for every language', () => {
    for (const e of entries) assert.ok(e.language, 'an entry without `language` recolours the semantic tokens of every language');
    const languages = entries.map((e) => e.language);
    assert.strictEqual(new Set(languages).size, languages.length);
    for (const e of entries) assert.deepEqual(e.scopes, entries[0].scopes, e.language);
  });

  it('covers the languages the provider is registered for, and not Python', () => {
    const defaults: string[] = pkg.contributes.configuration.properties['bashExplainer.languages'].default;
    // `json` is the language of package.json, which the provider is registered for by file name.
    const registered = new Set([...defaults, ...HOST_LANGUAGES.filter((l) => !OWN_SEMANTIC_LANGUAGES.includes(l)), 'json']);
    assert.deepEqual(new Set(entries.map((e) => e.language)), registered);
    assert.deepEqual(new Set(SEMANTIC_LANGUAGES), registered);
    assert.ok(!registered.has('python'));
  });
});

describe('semantic tokens of host files', () => {
  /** The text each token covers, in the original document. */
  const covered = (kind: Parameters<typeof extractShell>[0], text: string) => {
    const extracted = extractShell(kind, text);
    const lines = text.split('\n');
    return decodeTokens(semanticTokens({ lines, extracted, tree: parser.parse(extracted.text) })).map((t) => lines[t.line].slice(t.start, t.start + t.length));
  };

  it('leaves the host syntax a Makefile has rewritten to the grammar, and colours the shell around it', () => {
    const parts = covered('makefile', 'all:\n\trm -f $(wildcard *.tmp) out\n');
    assert.ok(parts.includes('rm'));
    assert.ok(parts.includes('-f'));
    for (const p of parts) assert.ok(!'$(wildcard *.tmp)'.includes(p), p);
  });

  it('does the same for ${{ }} of a GitHub Actions step', () => {
    const parts = covered('yaml', 'jobs:\n  a:\n    steps:\n      - run: echo "${{ github.ref }}" done\n');
    assert.ok(parts.includes('echo'));
    for (const p of parts) assert.ok(!'${{ github.ref }}'.includes(p), p);
  });

  it('clips a token that only partly covers inserted text', () => {
    const parts = covered('makefile', 'all:\n\techo "a $(wildcard *.tmp) b"\n');
    assert.deepEqual(parts.filter((p) => p.includes('"')), ['"a ', ' b"']);
  });

  it('cuts a span that runs over inserted text into the parts outside it', () => {
    const text = 'all:\n\techo a$(X)b$(Y)c';
    const extracted = extractShell('makefile', text);
    const lines = text.split('\n');
    const spans = [{ from: extracted.text.indexOf('a'), to: extracted.text.length, kind: 'string' as const }];
    const parts = hostedHighlight(spans as Parameters<typeof hostedHighlight>[0], extracted, true).map((s) => lines[s.line].slice(s.from, s.to));
    assert.deepEqual(parts, ['a', 'b', 'c']);
  });
});
