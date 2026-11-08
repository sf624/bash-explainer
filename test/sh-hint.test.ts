// The web page's hint toward POSIX sh (docs/design/usability-9.md, 2.1; decisions Q2 and Q3): how many constructs POSIX sh
// lacks in a script the page reads as bash, only where nothing says its shell: no shebang (decision of 2026-11-09, #761).
// `shProblemCount` is the one count, made from the dialect issues for sh (`dialectIssues`) through the call the strip makes
// for a sh script; the hint is never a problem, so no list holds it.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { dialectIssues, readShell } from '../src/dialect';
import { diagnosticsFor, documentIssues, shProblemCount, type ShellDocument, type Shells } from '../src/document';
import { shellsOf } from '../src/document-setup';
import { extractShell } from '../src/hosts';
import { defaultSettings, type Settings } from '../src/settings';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import type { BashParser } from '../src/syntax/tree';

let parser: BashParser;
before(() => {
  parser = createUnbashParser();
});

const script = (text: string): ShellDocument => ({ lines: text.split('\n'), tree: parser.parse(text) });
const shellsFor = (text: string, fileName = 'x', forced?: Shells['forced']) => shellsOf(text.split('\n'), fileName, forced, 'said');
const settings = (over: Partial<Settings> = {}): Settings => ({ ...defaultSettings(), ...over });
const countOf = (text: string, fileName = 'x', over: Partial<Settings> = {}, forced?: Shells['forced']) => shProblemCount(script(text), 'en', shellsFor(text, fileName, forced), settings(over), 'web');

// Two features POSIX sh lacks, one that dash runs but POSIX does not have, and a behaviour: all dialect issues for sh.
const BODY = '[[ -f a ]] && echo y\nlocal v=1\narr=(a b)\n';

describe('the hint toward POSIX sh: when it is made', () => {
  it('counts for no shebang', () => {
    assert.ok((countOf(BODY) ?? 0) >= 3);
  });

  it('has none for any shebang that names bash (#!/bin/bash, #!/usr/bin/env bash, env -S), another path to bash, sh, a ShellCheck directive, a file name that says bash, or a text not surely a script', () => {
    for (const first of ['#!/bin/bash\n', '#!/usr/bin/bash\n', '#!/usr/bin/env bash\n', '#!/usr/bin/env -S bash -e\n', '#!/usr/bin/env -S\n', '#!/bin/sh\n', '#!/bin/dash\n', '# shellcheck shell=bash\n', '#!/usr/bin/python3\n']) {
      assert.strictEqual(countOf(first + BODY), undefined, first);
    }
    assert.strictEqual(countOf(BODY, 'x.bash'), undefined);
    assert.strictEqual(countOf(BODY, '.bashrc'), undefined);
  });

  it('has none where the shell is chosen, in a host file (bats too), when the file is not read, with no problem in sh, or without a reading', () => {
    const text = BODY;
    assert.strictEqual(countOf(text, 'x', {}, 'bash'), undefined);
    assert.strictEqual(countOf(text, 'x', {}, 'sh'), undefined);
    const bats = `#!/usr/bin/env bats\n@test "a" {\n  [[ -f a ]]\n}\n`;
    const extracted = extractShell('bats', bats);
    const doc: ShellDocument = { lines: bats.split('\n'), extracted, tree: parser.parse(extracted.text) };
    assert.strictEqual(shProblemCount(doc, 'en', { detected: { shell: 'bash', source: 'default' }, script: 'said' }, settings(), 'web'), undefined);
    const unread = Object.assign(parser.parse(text), { unread: 'too big' });
    assert.strictEqual(shProblemCount({ lines: text.split('\n'), tree: unread }, 'en', shellsFor(text), settings(), 'web'), undefined);
    assert.strictEqual(countOf('echo "$1"\n'), undefined);
    assert.strictEqual(shProblemCount(script(text), 'en', { script: 'said' }, settings(), 'web'), undefined);
    assert.strictEqual(shProblemCount(script(text), 'en', { detected: { shell: 'bash', source: 'default' } }, settings(), 'web'), undefined);
  });

  it('follows what the strip lists: the warnings turned off, a code to ignore, a comment of the file', () => {
    const text = BODY;
    const all = countOf(text)!;
    assert.strictEqual(countOf(text, 'x', { 'diagnostics.enabled': false }), undefined);
    const codes = dialectIssues(script(text).tree, 'sh', 'en').map((i) => i.id);
    const first = codes[0];
    const same = codes.filter((c) => c === first).length;
    assert.ok(same < codes.length, 'a second code is left');
    assert.strictEqual(countOf(text, 'x', { 'diagnostics.ignore': [first] }), all - same);
    assert.strictEqual(countOf(`# bash-explainer disable-file=all\n${BODY}`), undefined);
  });
});

describe('the hint toward POSIX sh: the count', () => {
  const sample = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.sh'), 'utf8').replace(/^#!.*\n/, '');

  it('is the number of dialect issues for sh, all of which the list has once the script is read as sh', () => {
    for (const text of [BODY, BODY, sample]) {
      const doc = script(text);
      const hint = shProblemCount(doc, 'en', shellsFor(text), settings(), 'web');
      assert.ok(hint, text.slice(0, 30));
      const dialect = dialectIssues(doc.tree, 'sh', 'en');
      // (Code that never runs lowers or drops an issue: the call of the strip is the count, the bare issues an upper bound. The list as sh has more: the notes of sh's explanations.)
      assert.ok(hint <= dialect.length && (text === sample || hint === dialect.length), text.slice(0, 30));
      const codes = new Set(dialect.map((i) => i.id));
      const rows = documentIssues(doc, 'en', shellsFor(text, 'x', 'sh')).filter((i) => codes.has(i.code));
      assert.ok(rows.length >= hint, `${text.slice(0, 30)}: ${rows.length} rows for ${hint}`);
    }
  });

  it('is made by diagnosticsFor and is in none of its lists', () => {
    const text = BODY;
    const doc = script(text);
    const found = diagnosticsFor(() => doc, () => shellsFor(text), 'en', settings(), 'web');
    assert.strictEqual(found.sh, shProblemCount(doc, 'en', shellsFor(text), settings(), 'web'));
    // (The hint is no problem: neither the shown ones nor all of them hold a sh problem the bash reading does not have.)
    const sh = documentIssues(doc, 'en', shellsFor(text, 'x', 'sh')).map((i) => i.code);
    assert.ok(found.sh! > 0 && sh.length > found.all.length);
    assert.deepStrictEqual(found.shown, found.all.filter((i) => !i.pitfall || settings()['diagnostics.pitfalls']));
    assert.strictEqual(diagnosticsFor(() => undefined, () => ({}), 'en', settings(), 'web').sh, undefined);
    assert.strictEqual(diagnosticsFor(() => script('#!/bin/bash\n' + BODY), () => shellsFor('#!/bin/bash\n' + BODY), 'en', settings(), 'web').sh, undefined);
  });

  it('is the same count in Japanese', () => {
    const text = BODY;
    assert.strictEqual(shProblemCount(script(text), 'ja', shellsFor(text), settings(), 'web'), shProblemCount(script(text), 'en', shellsFor(text), settings(), 'web'));
  });

  it('reads the same shebang as readShell', () => {
    assert.deepStrictEqual(readShell('#!/usr/bin/env bash'), { shell: 'bash', source: 'shebang' });
  });
});
