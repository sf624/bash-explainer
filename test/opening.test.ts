// The opening of the web page (src/ui/opening.ts): its line's parts and their labels come from the analyzer.
// test/web-opening.test.ts runs it in the browser.
import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { OPENING_LINE, OpeningPart, openingHtml, openingLabel, openingParts } from '../src/ui/opening';

const parser = createUnbashParser();
const analyzers = { en: new Analyzer('en'), ja: new Analyzer('ja') };
const parts = (line: string) => openingParts(line, parser.parse(line), analyzers);
const words = (list: Array<string | OpeningPart>) => list.filter((p): p is OpeningPart => typeof p !== 'string');

describe('the opening of the web page', () => {
  it('cuts its line into the words between the blanks, each with the kind, the role and the label the explanation gives it', () => {
    const list = parts(OPENING_LINE);
    assert.strictEqual(list.map((p) => (typeof p === 'string' ? p : p.text)).join(''), OPENING_LINE);
    assert.deepStrictEqual(
      words(list).map((p) => [p.text, p.kind, p.role, p.label.en, p.label.ja]),
      [
        ['sort', 'command', 1, 'Sort lines', '行を並べ替える'],
        ['-u', 'option', 2, 'output only unique lines', '重複行を1つにまとめる'],
        ['"$file"', 'argument', 2, 'target file', '対象のファイル'],
        ['|', 'operator', 0, 'Pipe', 'パイプ'],
        ['wc', 'command', 1, 'Count lines, words and bytes', '行数・単語数・バイト数を数える'],
        ['-l', 'option', 2, 'count lines', '行数を数える'],
      ],
    );
    // The variable inside the quoted word is coloured as one.
    assert.deepStrictEqual(words(list)[2].variables, [[1, 6]]);
  });

  it('labels a part with its explanation up to the details, and an operator with its name', () => {
    assert.strictEqual(openingLabel('file to search (default: stdin) — Glob pattern (shell wildcards): expands to the matching file names'), 'file to search (default: stdin)');
    assert.strictEqual(openingLabel('Pipe: send stdout of the left command to stdin of the right'), 'Pipe');
    assert.strictEqual(openingLabel('パイプ: 左のコマンドの標準出力を右のコマンドの標準入力に渡す'), 'パイプ');
    assert.strictEqual(openingLabel('Sort lines'), 'Sort lines');
  });

  it('takes the outermost part at a word: combined options, not the letters; the command, not its pipeline', () => {
    assert.deepStrictEqual(words(parts('du -sh x')).map((p) => [p.text, p.kind]), [['du', 'command'], ['-sh', 'option'], ['x', 'argument']]);
    assert.deepStrictEqual(words(parts('ls | wc')).map((p) => [p.text, p.kind]), [['ls', 'command'], ['|', 'operator'], ['wc', 'command']]);
  });

  it('fails on a word it has no part for, so that the page is not built with an unexplained part', () => {
    assert.throws(() => parts('echo hi'), /no explanation for "echo"/);
  });

  it('writes the overlay hidden from assistive technology, with each label in both languages and the logo it is given', () => {
    const html = openingHtml(parts(OPENING_LINE), '<svg class="opening-logo"></svg>');
    assert.match(html, /^<div id="opening" class="opening" aria-hidden="true">/);
    assert.match(html, /<svg class="opening-logo"><\/svg><span class="opening-name">Bash Explainer<\/span>/);
    assert.match(html, /<span class="part k-argument" style="--k:2;--role:2"><span class="plain">&#34;&#36;file&#34;<\/span><span class="ink">&#34;<span class="k-variable">&#36;file<\/span>&#34;<\/span>/);
    assert.match(html, /<span class="l-en" lang="en">Pipe<\/span><span class="l-ja" lang="ja">パイプ<\/span>/);
    // The list a phone shows has the same labels.
    assert.strictEqual((html.match(/<li /g) ?? []).length, 6);
    // Nothing in it can take the focus.
    assert.doesNotMatch(html, /<(a|button|input|select|textarea)\b|tabindex/);
  });
});
