import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as path from 'path';
import { Analyzer, Token } from '../src/analyzer';
import { controlAbbr, controlSuffix, pictureCode, pictureNote } from '../src/ctlchars';
import { explainPrintf } from '../src/embedded/format';
import { explainTrSet } from '../src/embedded/textutils';
import { explainGitFormat } from '../src/embedded/gitformat';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { examplesMarkdown, toMarkdown } from '../src/ui/render';
import type { BashParser as Parser } from '../src/syntax/tree';

void path;
let parser: Parser;
before(() => { parser = createUnbashParser(); });

const pickEn = (_ja: string, en: string) => en;
const pickJa = (ja: string) => ja;

function hasBash(): boolean {
  try { execFileSync('bash', ['-c', 'true']); return true; } catch { return false; }
}

/** [printf escape, code, English suffix, Japanese suffix] */
const TABLE: [string, number, string, string][] = [
  ['\\000', 0, 'NUL, null', 'NUL、ヌル文字'], ['\\007', 7, 'BEL, bell', 'BEL、ベル'], ['\\010', 8, 'BS, backspace', 'BS、バックスペース'],
  ['\\011', 9, 'HT, tab', 'HT、タブ'], ['\\012', 10, 'LF, line feed, newline', 'LF、改行'], ['\\013', 11, 'VT, vertical tab', 'VT、垂直タブ'],
  ['\\014', 12, 'FF, form feed', 'FF、改ページ'], ['\\015', 13, 'CR, carriage return', 'CR、復帰文字'], ['\\033', 27, 'ESC, escape', 'ESC、エスケープ文字'],
  ['\\x1b', 27, 'ESC, escape', 'ESC、エスケープ文字'], ['\\x1B', 27, 'ESC, escape', 'ESC、エスケープ文字'], ['\\u001b', 27, 'ESC, escape', 'ESC、エスケープ文字'],
  ['\\177', 127, 'DEL, delete', 'DEL、削除文字'], ['\\x7f', 127, 'DEL, delete', 'DEL、削除文字'], ['\\001', 1, 'SOH', 'SOH'],
  ['\\e', 27, 'ESC, the escape', 'ESC（エスケープ'], ['\\E', 27, 'ESC, the escape', 'ESC（エスケープ'],
];

describe('names of control characters', () => {
  it('has the abbreviations and the pictures', () => {
    assert.strictEqual(controlAbbr(27), 'ESC');
    assert.strictEqual(controlAbbr(127), 'DEL');
    assert.strictEqual(controlAbbr(65), undefined);
    assert.strictEqual(controlSuffix(65, pickEn), '');
    assert.strictEqual(controlSuffix(27, pickEn), ' (ESC, escape)');
    assert.strictEqual(controlSuffix(27, pickJa), '（ESC、エスケープ文字）');
    assert.strictEqual(controlSuffix(2, pickEn), ' (STX)');
    assert.strictEqual(controlSuffix(2, pickJa), '（STX）');
    assert.strictEqual(pictureCode('␛'), 27);
    assert.strictEqual(pictureCode('⇥'), 9);
    assert.strictEqual(pictureCode('␡'), 127);
    assert.strictEqual(pictureCode('a'), undefined);
  });

  it('names the character in every escape of a printf format, in en and ja', function () {
    for (const [esc, , en, ja] of TABLE) {
      assert.ok(explainPrintf(esc, 'en')[0].explanation.includes(en), `${esc}: ${explainPrintf(esc, 'en')[0].explanation}`);
      assert.ok(explainPrintf(esc, 'ja')[0].explanation.includes(ja), `${esc}: ${explainPrintf(esc, 'ja')[0].explanation}`);
    }
    assert.match(explainPrintf('\\0033', 'en')[0].explanation, /octal code 0033 \(ESC, escape\)/);
    assert.match(explainPrintf('\\u0041', 'en')[0].explanation, /U\+0041$/);
  });

  it('agrees with bash on the character each escape stands for', function () {
    if (!hasBash()) this.skip();
    for (const [esc, code] of TABLE) {
      if (esc.length === 2) continue; // \e and \E are named escapes, checked below
      const out = execFileSync('bash', ['-c', 'printf "$1" | od -An -tu1', '_', esc]).toString().trim();
      assert.strictEqual(out, String(code), esc);
    }
    for (const esc of ['\\e', '\\E']) {
      assert.strictEqual(execFileSync('bash', ['-c', 'printf "$1" | od -An -tu1', '_', esc]).toString().trim(), '27', esc);
    }
    assert.strictEqual(execFileSync('bash', ['-c', 'printf %b "$1" | od -An -tu1', '_', '\\0033']).toString().trim(), '27');
    assert.strictEqual(execFileSync('bash', ['-c', 'echo -ne "\\0033" | od -An -tu1']).toString().trim(), '27');
  });

  it('names the characters of tr sets and git formats', () => {
    assert.match(explainTrSet('\\033', 'from', 'en')!.tokens[0].explanation, /octal code 033 \(ESC, escape\)/);
    assert.match(explainTrSet('\\033', 'from', 'ja')!.tokens[0].explanation, /8進数 033 の文字（ESC、エスケープ文字）/);
    assert.match(explainTrSet('\\101', 'from', 'en')!.tokens[0].explanation, /octal code 101$/);
    const t = explainGitFormat('format:%x1b%x41', 'en')!.tokens;
    assert.match(t[1].explanation, /the byte 0x1b \(ESC, escape\)/);
    assert.match(t[2].explanation, /the byte 0x41$/);
  });
});

function find(ts: { start: number; end: number; explanation: string; children: unknown[] }[], from: number): string[] {
  return ts.map((t) => `${t.start}-${t.end}:${t.explanation}`).filter(() => from >= 0);
}

describe('ANSI escape sequences in printf formats', () => {
  const sgr = (src: string, lang: 'en' | 'ja' = 'en') => explainPrintf(src, lang);

  it('puts a parent token over ESC [ params m, with the escape and the text under it', () => {
    const ts = sgr('\\033[1;32m%s\\033[0m\\n');
    assert.strictEqual(ts[0].start, 0);
    assert.strictEqual(ts[0].end, 10);
    assert.match(ts[0].explanation, /ANSI escape sequence: bold, green foreground$/);
    assert.deepStrictEqual(ts[0].children.map((c) => [c.start, c.end, c.kind]), [[0, 4, 'operator'], [4, 10, 'string']]);
    assert.match(ts[0].children[0].explanation, /octal code 033 \(ESC, escape\)/);
    assert.strictEqual(ts[1].kind, 'variable');
    assert.strictEqual(ts[1].start, 10);
    assert.match(ts[2].explanation, /ANSI escape sequence: reset all$/);
    assert.strictEqual(ts[3].explanation, '`\\n`: newline');
    assert.ok(find(ts, 0).length === 4);
  });

  it('explains the same in Japanese', () => {
    assert.match(sgr('\\033[1;32m', 'ja')[0].explanation, /ANSI エスケープシーケンス: 太字、文字色を緑に$/);
  });

  it('reads the common forms of the escape', () => {
    for (const esc of ['\\e', '\\E', '\\x1b', '\\x1B', '\\u001b', '\\033']) {
      const ts = sgr(`${esc}[31m`);
      assert.strictEqual(ts.length, 1, esc);
      assert.match(ts[0].explanation, /ANSI escape sequence: red foreground$/, esc);
    }
    assert.match(sgr('\\e[m')[0].explanation, /reset all$/);
    assert.match(sgr('\\e[;1m')[0].explanation, /reset all, bold$/);
  });

  it('knows the attributes, the colours and the resets', () => {
    const e = (p: string) => sgr(`\\e[${p}m`)[0].explanation.replace(/^.*?sequence: /, '');
    assert.strictEqual(e('0'), 'reset all');
    assert.strictEqual(e('2;3;4;5;7'), 'dim, italic, underline, blink, reverse video');
    assert.strictEqual(e('22;23;24;25;27'), 'normal intensity, not italic, not underlined, not blinking, not reversed');
    assert.strictEqual(e('30'), 'black foreground');
    assert.strictEqual(e('37'), 'white foreground');
    assert.strictEqual(e('39'), 'default foreground');
    assert.strictEqual(e('90'), 'bright black foreground');
    assert.strictEqual(e('97'), 'bright white foreground');
    assert.strictEqual(e('44'), 'blue background');
    assert.strictEqual(e('49'), 'default background');
    assert.strictEqual(e('101'), 'bright red background');
    assert.strictEqual(e('107'), 'bright white background');
    assert.strictEqual(e('38;5;208'), 'foreground colour 208 of the 256-colour palette');
    assert.strictEqual(e('48;5;17'), 'background colour 17 of the 256-colour palette');
    assert.strictEqual(e('38;2;255;0;10'), 'foreground RGB(255,0,10)');
    assert.strictEqual(e('48;2;1;2;3;1'), 'background RGB(1,2,3), bold');
    assert.strictEqual(sgr('\\e[91m', 'ja')[0].explanation.replace(/^.*?: /, ''), 'ANSI エスケープシーケンス: 文字色を明るい赤に');
    assert.strictEqual(sgr('\\e[42m', 'ja')[0].explanation.replace(/^.*?: /, ''), 'ANSI エスケープシーケンス: 背景色を緑に');
    assert.strictEqual(sgr('\\e[38;5;1m', 'ja')[0].explanation.replace(/^.*?: /, ''), 'ANSI エスケープシーケンス: 文字色を 256 色パレットの 1 番に');
    assert.strictEqual(sgr('\\e[48;2;1;2;3m', 'ja')[0].explanation.replace(/^.*?: /, ''), 'ANSI エスケープシーケンス: 背景色を RGB(1,2,3) に');
  });

  it('gives a generic parent for other CSI sequences and for parameters it does not know', () => {
    assert.match(sgr('\\e[2K')[0].explanation, /ANSI escape sequence: CSI `\[2K` \(cursor or screen control/);
    assert.match(sgr('\\e[?25l')[0].explanation, /CSI `\[\?25l`/);
    assert.match(sgr('\\e[99m')[0].explanation, /CSI `\[99m`/);
    assert.match(sgr('\\e[38;5;300m')[0].explanation, /CSI/);
    assert.match(sgr('\\e[38;2;1;2m')[0].explanation, /CSI/);
    assert.match(sgr('\\e[38;9m')[0].explanation, /CSI/);
    assert.match(sgr('\\e[2K', 'ja')[0].explanation, /ANSI エスケープシーケンス: CSI `\[2K`（カーソルや画面の制御など）/);
    assert.match(sgr('\\e[?1m')[0].explanation, /CSI/);
  });

  it('leaves a lone escape, other escapes and a bare "[" alone', () => {
    assert.strictEqual(sgr('\\033').length, 1);
    assert.match(sgr('\\033')[0].explanation, /^`\\033`: the character/);
    assert.strictEqual(sgr('\\033[')[0].children.length, 0);
    assert.strictEqual(sgr('\\033x[1m')[0].children.length, 0);
    assert.strictEqual(sgr('\\n[1m')[0].children.length, 0);
  });

  it('does not touch tput or the arguments of %b', () => {
    const a = new Analyzer('en');
    const dump = (src: string) => JSON.stringify(a.explainLine(parser.parse(src), 0).items);
    assert.ok(!dump('tput setaf 2').includes('ANSI escape sequence'));
    assert.ok(!dump("printf '%b' '\\033[1m'").includes('ANSI escape sequence'));
  });
});

describe('notes on the control pictures in examples', () => {
  const explain = (src: string, lang: 'en' | 'ja' = 'en') => new Analyzer(lang).explainLine(parser.parse(src), 0);

  it('says once what the pictures stand for', () => {
    const ex = explain("printf '\\033[1;32m%s\\033[0m\\n' OK").examples;
    assert.strictEqual(ex.length, 1);
    assert.deepStrictEqual(ex[0].sections[0].lines, ['␛[1;32mOK␛[0m']);
    assert.strictEqual(ex[0].note, 'Control characters are invisible, so the example shows them as symbols: `␛` is ESC (escape)');
    assert.strictEqual(explain("printf '\\033[1;32m%s\\033[0m\\n' OK", 'ja').examples[0].note, '制御文字は目に見えないので、例では記号で表している: `␛` は ESC（エスケープ文字）');
  });

  it('lists each picture once, with tabs and unnamed control characters', () => {
    const note = explain("printf 'a\\tb\\001\\033\\t\\177\\n'").examples[0].note!;
    assert.match(note, /`⇥` is HT \(tab\), `␁` is SOH, `␛` is ESC \(escape\), `␡` is DEL \(delete\)$/);
    assert.match(explain("printf 'a\\tb\\n'", 'ja').examples[0].note!, /`⇥` は HT（タブ）$/);
  });

  it('has no note when no line shows a picture', () => {
    assert.strictEqual(explain("printf 'a\\n'").examples[0].note, undefined);
    assert.strictEqual(pictureNote(['plain'], pickEn), undefined);
  });

  it('is shown by the hover, the plain Markdown and the other renderers', () => {
    const src = "printf '\\033[1m%s' OK";
    const ex = explain(src);
    const md = toMarkdown(ex, 'en', undefined, undefined, src);
    assert.ok(md.includes('> Control characters are invisible'));
    assert.ok(examplesMarkdown(ex.examples).join('\n').includes('\n> Control characters are invisible'));
    const nested = examplesMarkdown(ex.examples, '  ').join('\n');
    assert.ok(nested.includes('  > Control characters are invisible'));
    const html = require('fs').readFileSync(path.join(__dirname, '../media/panel.js'), 'utf8') as string;
    assert.ok(html.includes('ex.note'));
  });
});

describe('Token type', () => {
  it('keeps children of the ANSI parent in the analyzer tree', () => {
    const items = new Analyzer('en').explainLine(parser.parse("printf '\\e[1mx'"), 0).items;
    const find2 = (ts: Token[]): Token | undefined => ts.flatMap((t) => [t, ...t.children]).find((t) => t.explanation.includes('ANSI escape'));
    const walk = (ts: Token[]): Token | undefined => find2(ts) ?? ts.map((t) => walk(t.children)).find(Boolean);
    const t = walk(items)!;
    assert.strictEqual(t.children.length, 2);
  });
});
