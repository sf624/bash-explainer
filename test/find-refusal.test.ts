// `find-action-refused` (src/messages.ts): find refuses the whole line when the command of an action (`-exec`, `-execdir`,
// `-ok`, `-okdir`) is not ended as it wants, and runs nothing. Each case runs the line in GNU find (the one on the PATH
// of test/support/bash.ts) and checks that the note quotes what find printed; the rewrite for a bare `;` is run too.
import * as assert from 'assert';
import { Analyzer, type Token } from '../src/analyzer';
import type { Fact } from '../src/messages';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { runBash } from './support/bash';
import { applied, factsOf } from './support/rewrites';

const ID = 'find-action-refused';
const parser = createUnbashParser();
/** The line in find, in a directory with one file; `-ok` reads nothing, so it asks and does not run. */
const real = (line: string) => runBash(line, { files: ['a'], input: '' });
const note = (src: string, lang: 'en' | 'ja' = 'en'): Fact | undefined => new Analyzer(lang).explainLine(parser.parse(src), 0).facts?.find((f) => f.id === ID);

describe('the note on an action that find refuses', () => {
  // The line, what find prints (after "find: "), the reason the note gives.
  const cases: [string, string, RegExp][] = [
    ['find . -maxdepth 0 -exec echo ran {} ;', "missing argument to `-exec'", /^⚠ `-exec` has no `\\;` \(or `\+` right after a `\{\}`\) to end its command: the `;` at the end is the shell's list separator, so find never gets it\./],
    ['find . -maxdepth 0 -execdir echo ran {} \\; -execdir echo ran {} ;', "missing argument to `-execdir'", /^⚠ `-execdir` has no/],
    ['find . -maxdepth 0 -ok echo ran {} ;', "missing argument to `-ok'", /^⚠ `-ok` has no `\\;` to end its command: the `;` at the end is the shell's list separator/],
    ['find . -maxdepth 0 -okdir echo ran {} +', "missing argument to `-okdir'", /^⚠ `-okdir` has no `\\;` to end its command; only `-exec` and `-execdir` can be ended by a `\+`\./],
    ['find . -maxdepth 0 -exec echo ran {} a +', "missing argument to `-exec'", /^⚠ `-exec` has no `\\;` \(or `\+` right after a `\{\}`\) to end its command\. /],
    ['find . -maxdepth 0 -exec \\;', "invalid argument `;' to `-exec'", /is followed at once by `\\;`, so it has no command to run\./],
    ['find . -maxdepth 0 -ok \\;', "invalid argument `;' to `-ok'", /^⚠ `-ok` is followed at once by/],
    ['find . -maxdepth 0 -exec echo ran {}.bak +', "In '-exec ... {} +' the '{}' must appear by itself, but you specified '{}.bak'", /a `\+` ends the command of `-exec` only after a `\{\}` that stands alone, and here the word before it is `\{\}\.bak`\./],
    ['find . -maxdepth 0 -execdir echo ran {}.bak +', "In '-execdir ... {} +' the '{}' must appear by itself, but you specified '{}.bak'", /command of `-execdir` only after/],
    ['find . -maxdepth 0 -exec echo ran {} {} +', 'Only one instance of {} is supported with -exec ... +', /command of `-exec` that a `\+` ends takes only one `\{\}`\./],
    ['find . -maxdepth 0 -execdir echo ran {} {}.bak +', 'Only one instance of {} is supported with -execdir ... +', /command of `-execdir` that a `\+` ends/],
  ];
  for (const [src, said, reason] of cases) {
    it(`quotes what find prints for ${src}`, () => {
      const r = real(src);
      // find prints it, runs nothing, and fails.
      assert.ok(r.stderr.startsWith(`find: ${said}`), JSON.stringify(r));
      assert.deepStrictEqual([r.stdout.includes('ran'), r.status], [false, 1]);
      const f = note(src)!;
      assert.match(f.text, reason);
      // (As a code span: the fence is longer than the backticks inside.)
      assert.ok(f.text.includes(said.includes('`') ? `\`\`find: ${said}\`\`` : `\`find: ${said}\``), f.text);
      assert.match(f.text, /runs nothing\./);
      assert.ok(note(src, 'ja')!.text.includes('何も実行しない'));
    });
  }

  it('is said once for a line, for the first action find refuses, and not for a line it accepts', () => {
    // (find reports the first: the `-exec` after the first `\;` has no end, and the `-ok` after it is read as words of its command.)
    const line = 'find . -exec rm {} \\; -exec rm {} ; -ok rm {}.bak +';
    assert.strictEqual(new Analyzer('en').explainLine(parser.parse(line), 0).facts!.filter((f) => f.id === ID).length, 1);
    for (const src of ['find . -exec rm {} \\;', 'find . -exec rm {} +', 'find . -exec echo a + \\;', 'find . -ok rm {} \\;', 'find . -exec rm {} \\; -exec rm {} +']) assert.strictEqual(note(src), undefined, src);
  });

  it('says the same in Japanese', () => {
    assert.match(note('find . -exec rm {} ;', 'ja')!.text, /`-exec` のコマンドを終わらせる `\\;`（または `\{\}` の直後の `\+`）がない。末尾の `;` はシェルのコマンドリストの区切りなので、find には渡らない。find は行全体を受け付けず（``find: missing argument to `-exec'``）、何も実行しない。`\\;` と書く/);
    assert.match(note('find . -exec rm {}.bak +', 'ja')!.text, /`\+` が `-exec` のコマンドを終わらせるのは、直前の語が `\{\}` だけのときに限る。ここでは `\{\}\.bak` なので/);
    assert.match(note('find . -exec rm {} {} +', 'ja')!.text, /`\{\}` は1つだけ。2つ以上必要なら `\\;` で1件ずつ実行する。/);
    assert.match(note('find . -exec \\;', 'ja')!.text, /直後がすぐ `\\;` で、実行するコマンドがない。/);
  });

  it('leaves the explanation of the rest of the line as it is: the pattern of `-name` and its example', () => {
    const line = "find . -name '*.c' -exec rm {} ;";
    for (const lang of ['en', 'ja'] as const) {
      const ex = new Analyzer(lang).explainLine(parser.parse(line), 0);
      const all = (ts: Token[]): Token[] => ts.flatMap((t) => [t, ...all(t.children)]);
      assert.ok(all(ex.items).some((t) => t.kind === 'pattern' && t.label === '*'), lang);
      assert.strictEqual(ex.examples!.length, 1, lang);
      assert.ok(ex.facts!.some((f) => f.id === ID), lang);
    }
  });

  describe('rewrite', () => {
    it('writes `\\;` for the bare `;` that ends the line, and runs in find', () => {
      for (const [src, want] of [
        ['find . -maxdepth 0 -exec echo ran {} ;', 'find . -maxdepth 0 -exec echo ran {} \\;'],
        ['find . -maxdepth 0 -exec echo ran {} ;  # all', 'find . -maxdepth 0 -exec echo ran {} \\;  # all'],
        ['find . -maxdepth 0 -exec echo ran {} \\; -execdir echo ran {} ;\necho after', 'find . -maxdepth 0 -exec echo ran {} \\; -execdir echo ran {} \\;\necho after'],
      ] as const) {
        const [f] = factsOf(src, ID);
        assert.deepStrictEqual(f.rewrite!.map((r) => [r.code, applied(src, r)]), [['\\;', want]], src);
        // (find refuses the original and runs the rewrite.)
        const before = real(src.split('\n')[0]);
        const after = real(want.split('\n')[0]);
        assert.deepStrictEqual([before.stdout.includes('ran'), before.status, after.stdout.includes('ran'), after.status], [false, 1, true, 0], JSON.stringify([before, after]));
        assert.deepStrictEqual(factsOf(want, ID), []);
        assert.ok(f.text.endsWith('Write `\\;` (or `\';\'`)'), f.text);
      }
    });
    it('gives none where the cause is not the bare `;`, or the `;` is followed by another command', () => {
      for (const src of ['find . -ok rm {} +', 'find . -exec rm {}.bak +', 'find . -exec rm {} ; echo done', 'find . -exec rm {}', 'find . -exec rm {} ;; ', 'find . -exec rm {} & ']) {
        const f = factsOf(src, ID);
        assert.ok(f.length >= 1 && f.every((x) => x.rewrite === undefined), src);
      }
      assert.ok(factsOf('find . -exec rm {}', ID)[0].text.endsWith('End it with `\\;` or `\';\'`'));
    });
    it('is said, but not carried as edits, in a string another shell reads', () => {
      const [f] = factsOf("bash -c 'find . -exec rm {} ;'", ID);
      assert.strictEqual(f?.rewrite, undefined);
    });
  });
});
