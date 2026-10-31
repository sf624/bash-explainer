// The name hints (src/ui/nameHints.ts) and the notice that the inline summary was removed (src/ui/inlineNotice.ts).
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import { explainDocumentLine } from '../src/document';
import { openDocument } from '../src/document-setup';
import type { Lang } from '../src/i18n';
import type { NameFacts } from '../src/semantics/names';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { INLINE_NOTICE_KEY, inlineNotice, inlineNoticeDue } from '../src/ui/inlineNotice';
import { hintLabel, nameHints, surprise } from '../src/ui/nameHints';

const parser = createUnbashParser();

/** The hints of a script: "line:character label". */
function hints(src: string, lang: Lang = 'en'): string[] {
  const doc = openDocument(src, 'shell', (t) => parser.parse(t));
  const analyzer = new Analyzer(lang);
  return doc.lines.flatMap((text, line) => nameHints(explainDocumentLine(analyzer, doc, line, lang, {}, {}), line, text, lang)
    .map((h) => `${line}:${h.position.character} ${h.label}`));
}

describe('the name hints', () => {
  it('mark a function or an alias that hides a builtin or a program', () => {
    assert.deepStrictEqual(hints('cd() { builtin cd "$@"; }\ncd /tmp'), ['1:2 function, not the builtin']);
    assert.deepStrictEqual(hints('#!/bin/bash\nshopt -s expand_aliases\nalias ls="ls -F"\nls'), ['3:2 alias, not the program']);
    assert.deepStrictEqual(hints('grep() { :; }\ngrep x', 'ja'), ['1:4 関数（プログラムではない）']);
  });

  it('mark a builtin turned off, an alias not expanded, a program that is not there, and a name that runs nothing', () => {
    assert.deepStrictEqual(hints('enable -n echo\necho hi'), ['1:4 program: the builtin is off']);
    assert.deepStrictEqual(hints('#!/bin/bash\nalias ll="ls -l"\nalias ls="ls -F"\nls'), ['3:2 program: the alias is not expanded']);
    // (After code not read here, which may turn expand_aliases on: `maybe`.)
    assert.deepStrictEqual(hints('#!/bin/bash\nalias ls="ls -F"\n. ./lib.sh\nls'), ['3:2 program: the alias may not be expanded']);
    assert.deepStrictEqual(hints('#!/bin/bash\nalias ls="ls -F"\n. ./lib.sh\nls', 'ja'), ['3:2 プログラム（エイリアスは展開されないかもしれない）']);
    assert.deepStrictEqual(hints('sudo cd /root'), ['0:7 program, run by sudo: usually there is none']);
    assert.deepStrictEqual(hints('sudo cd /root', 'ja'), ['0:7 プログラム（sudo が実行。ふつうは存在しない）']);
    assert.deepStrictEqual(hints('builtin ls'), ['0:10 nothing runs']);
    assert.deepStrictEqual(hints('enable -n echo\necho hi', 'ja'), ['1:4 プログラム（ビルトインは無効）']);
    assert.deepStrictEqual(hints('#!/bin/bash\nalias ls="ls -F"\nls', 'ja'), ['2:2 プログラム（エイリアスは展開されない）']);
  });

  it('leave alone the names the reader asked for, and plain ones', () => {
    const src = 'cd() { builtin cd "$@"; }\nls() { command ls "$@"; }\nsudo echo hi\nfind . | xargs echo\necho hi\ngrep x f\nif true; then :; fi';
    assert.deepStrictEqual(hints(src), []);
    // `\ls` skips the alias.
    assert.deepStrictEqual(hints('#!/bin/bash\nshopt -s expand_aliases\nalias ls="ls -F"\n\\ls'), []);
  });

  it('put each hint just after the name, on the line where the name is', () => {
    const src = 'cd() { :; }\nfoo \\\n  && cd /tmp \\\n  && cd /';
    assert.deepStrictEqual(hints(src), ['2:7 function, not the builtin', '3:7 function, not the builtin']);
    assert.deepStrictEqual(hints('cd() { :; }\n"cd" x'), ['1:4 function, not the builtin']);
  });

  it('say in the tooltip what runs, who runs it, what else the name is, and what it does', () => {
    const doc = openDocument('sudo cd /root', 'shell', (t) => parser.parse(t));
    const [h] = nameHints(explainDocumentLine(new Analyzer('en'), doc, 0, 'en', {}, {}), 0, doc.lines[0], 'en');
    assert.match(h.tooltip, /^`cd` \*\*program\*\* — run by `sudo`\n\n`sudo` looks the name up, so bash's builtin does not run/);
    assert.match(h.tooltip, /\n\nruns `cd`: Change/);
    assert.strictEqual(h.tok.name!.name, 'cd');
  });

  it('classify the facts, and name the other kind', () => {
    const f = (o: Partial<NameFacts>): NameFacts => ({ name: 'x', runs: 'program', also: [], ...o });
    assert.strictEqual(surprise(f({})), undefined);
    assert.strictEqual(surprise(f({ runs: 'function', also: [{ kind: 'alias', reach: [] }] })), undefined);
    assert.strictEqual(surprise(f({ runs: 'alias', also: [{ kind: 'program', reach: ['\\x'] }] })), 'shadow');
    assert.strictEqual(hintLabel(f({ runs: 'alias', also: [{ kind: 'program', reach: ['\\x'] }] }), 'shadow', 'en'), 'alias, not the program');
    assert.strictEqual(hintLabel(f({ noProgram: true }), 'noProgram', 'en'), 'program: usually there is none');
    assert.strictEqual(hintLabel(f({ noProgram: true }), 'noProgram', 'ja'), 'プログラム（ふつうは存在しない）');
    assert.strictEqual(hintLabel(f({ runs: 'none' }), 'none', 'ja'), '実行されない');
    assert.strictEqual(hintLabel(f({ runs: 'function', also: [{ kind: 'builtin', reach: [] }] }), 'shadow', 'ja'), '関数（ビルトインではない）');
  });

  it('are in Japanese in a Japanese run: no English word but the code (the name of the command that runs it)', () => {
    const scripts = [
      'cd() { builtin cd "$@" && echo "now in $PWD"; }\nenable -n echo\ncd /tmp\nsudo cd /root\necho done\nbuiltin ls\n',
      '#!/bin/bash\nalias ls="ls -F"\nls\nshopt -s expand_aliases\nalias ll="ls -l"\nll\ngrep() { :; }\ngrep x\nenv cd /\n',
      fs.readFileSync(path.join(__dirname, 'fixtures/sample.sh'), 'utf8'),
    ];
    let seen = 0;
    for (const src of scripts) {
      const doc = openDocument(src, 'shell', (t) => parser.parse(t));
      const analyzer = new Analyzer('ja');
      doc.lines.forEach((text, line) => {
        for (const h of nameHints(explainDocumentLine(analyzer, doc, line, 'ja', {}, {}), line, text, 'ja')) {
          seen++;
          const code = h.tok.name!.by;
          const words = (code ? h.label.split(code).join('') : h.label).match(/[A-Za-z]+/g);
          assert.strictEqual(words, null, `${line + 1}: ${h.label}`);
        }
      });
    }
    assert.ok(seen >= 8, String(seen));
  });

  it('find no name to mark in the sample script but the ones it shows on purpose', () => {
    const src = fs.readFileSync(path.join(__dirname, 'fixtures/sample.sh'), 'utf8');
    for (const h of hints(src)) assert.match(h, /not the|is off|not expanded|usually there is none|nothing runs/);
  });
});

describe('the notice that the inline summary was removed', () => {
  it('is due when the setting is on in some scope, until it is dismissed', () => {
    assert.strictEqual(inlineNoticeDue(undefined, undefined), false);
    assert.strictEqual(inlineNoticeDue({}, undefined), false);
    assert.strictEqual(inlineNoticeDue({ globalValue: false }, undefined), false);
    assert.strictEqual(inlineNoticeDue({ globalValue: true }, undefined), true);
    assert.strictEqual(inlineNoticeDue({ workspaceValue: true }, undefined), true);
    assert.strictEqual(inlineNoticeDue({ workspaceFolderValue: true }, false), true);
    assert.strictEqual(inlineNoticeDue({ globalValue: true }, true), false);
    assert.match(INLINE_NOTICE_KEY, /^bashExplainer\./);
  });

  it('says what to use instead, with its buttons, in both languages', () => {
    const en = inlineNotice('en');
    assert.match(en.message, /^The inline summary was removed, and bashExplainer\.inline\.enabled no longer has an effect/);
    assert.ok(!/`/.test(en.message + inlineNotice('ja').message), 'a notification shows no Markdown');
    assert.deepStrictEqual([en.open, en.dismiss], ['Open settings', "Don't show again"]);
    const ja = inlineNotice('ja');
    assert.match(ja.message, /効果がなくなりました/);
    assert.deepStrictEqual([ja.open, ja.dismiss], ['設定を開く', '今後表示しない']);
  });
});
