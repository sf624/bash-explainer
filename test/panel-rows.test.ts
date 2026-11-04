import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import type { LineExplanation, Token } from '../src/analyzer-types';
import type { Lang } from '../src/i18n';
import { keyOf, readingNodes } from '../src/reading';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { TOKEN_TEXTS } from '../src/messages-tokens';
import { markedText, textParts } from '../src/tokenmarks';
import { sameSpan } from '../src/ui/hoverParts';
import { type ModelRow, type RowOptions, rowModel, wholeLineExamples } from '../src/ui/panelRows';
import { panelUpdate } from '../src/ui/panelView';
import { roleOf } from '../src/ui/panelRoles';
import { stepsLine } from '../src/ui/panelSteps';
import { placeExamples, toPlainMarkdown } from '../src/ui/render';
import { ui } from '../src/ui/texts';
import { main } from '../cli/main';
import { corpus } from './support/corpus';

// The panel's row model (docs/design/panel-redesign.md, P7a): which rows a line has at each depth, a box around each command, the roles,
// what a program receives, and the Key. The model is a pure function of the explanation; media/panel.js draws it (P7c).

const parser = createUnbashParser();
const explain = (src: string, line = 0, lang: Lang = 'en'): LineExplanation => new Analyzer(lang).explainLine(parser.parse(src), line, 'bash', { reading: true, argv: true, script: 'said' });
const all = (rows: readonly ModelRow[]): ModelRow[] => rows.flatMap((r) => [r, ...all(r.children)]);
const tokens = (ts: readonly Token[]): Token[] => ts.flatMap((t) => [t, ...tokens(t.children)]);
const within = (a: Token['span'], b: Token['span']): boolean => (a.start.line < b.start.line || (a.start.line === b.start.line && a.start.character <= b.start.character))
  && (a.end.line > b.end.line || (a.end.line === b.end.line && a.end.character >= b.end.character));
/** The rows of `src` at depth 2, after `touch` changes its tokens. */
const rowsWith = (src: string, touch: (t: Token) => void): ModelRow[] => {
  const ex = explain(src);
  tokens(ex.items).forEach(touch);
  return all(rowModel(ex, D2, 'en').rows);
};
const D1: RowOptions = { depth: 1, receives: false };
const D2: RowOptions = { depth: 2, receives: false };
const model = (src: string, options: RowOptions = D1, lang: Lang = 'en', line = 0) => rowModel(explain(src, line, lang), options, lang);
/** The rows as an outline: each row's label, with its frame and its parts. */
const outline = (rows: readonly ModelRow[]): unknown[] => rows.map((r) => {
  const me = r.frame ? `[${r.frame}] ${r.label}` : r.label;
  return r.children.length ? [me, outline(r.children)] : me;
});

describe('the panel\'s row model', () => {
  describe('the rows at each depth', () => {
    it('shows what each command does at depth 1, and bash\'s syntax and the parts of a word at depth 2', () => {
      const src = 'grep -h "$USER" /var/log/*.log | sort -rn';
      assert.deepStrictEqual(outline(model(src).rows), [['[group] grep | sort', [
        ['[command] grep', ['-h', ['"$USER"', ['$USER']], '/var/log/*.log']],
        ['[command] sort', [['-rn', ['-r', '-n']]]],
      ]]]);
      assert.deepStrictEqual(outline(model(src, D2).rows), [['[group] grep | sort', [
        ['[command] grep', ['-h', ['"$USER"', ['$USER']], ['/var/log/*.log', ['/var/log/', '*', '.log']]]],
        '|',
        ['[command] sort', [['-rn', ['-r', '-n']]]],
      ]]]);
      const glob = all(model(src, D2).rows).find((r) => r.label === '*')!;
      assert.strictEqual(glob.comesAt, 2);
    });

    it('leaves a variable that only expands to depth 2, and keeps one with a meaning of its own at depth 1', () => {
      const labels = (src: string, options = D1) => all(model(src, options).rows).map((r) => r.label);
      assert.deepStrictEqual(labels('cp "$a" b'), ['cp', '"$a"', 'b']);
      assert.deepStrictEqual(labels('cp "$a" b', D2), ['cp', '"$a"', '$a', 'b']);
      assert.deepStrictEqual(labels('cp "$USER" b'), ['cp', '"$USER"', '$USER', 'b']);
    });

    it('gives a compound command\'s reserved words and separators to depth 2, and a line of one reserved word its row', () => {
      const src = 'if [[ -f a ]]; then source b; fi';
      assert.deepStrictEqual(outline(model(src).rows), [['[compound] if ‹condition› then ‹commands› fi', [
        ['[compound] [[ -f a ]]', ['-f a']],
        ['[command] source', ['b']],
      ]]]);
      assert.deepStrictEqual(all(model(src, D2).rows).map((r) => r.label).filter((l) => ['if', ';', 'then', 'fi'].includes(l)), ['if', ';', 'then', ';', 'fi']);
      assert.deepStrictEqual(outline(model('for f in a; do\n  x\ndone', D1, 'en', 2).rows), ['done']);
    });

    it('has no row for the body of a loop at depth 1: its commands are in the loop\'s box', () => {
      assert.deepStrictEqual(outline(model('while a; do b; done').rows), [['[compound] while ‹condition› do ‹commands› done', ['[command] a', '[command] b']]]);
      const body = all(model('while a; do b; done', D2).rows).find((r) => r.texts?.includes('loop-body'))!;
      assert.strictEqual(body.frame, undefined);
      assert.strictEqual(body.comesAt, 2);
    });

    it('keeps at depth 1 a part that holds a warning, a fact, a value or an example', () => {
      const marked = all(model('echo "$((09))"').rows).find((r) => r.marks)!;
      assert.deepStrictEqual([marked.label, marked.level, marked.comesAt], ['09', 'error', 1]);
      assert.ok(all(model('rm -rf $d/').rows).some((r) => r.facts?.includes('unquoted-variable-as-path')));
      const value = 'x=1; cp "$x" b';
      assert.ok(all(model(value).rows).some((r) => r.label === '$x' && r.value), 'a known value');
      assert.ok(all(rowModel(placeExamples(explain('echo {a,b}')), D1, 'en').rows).some((r) => r.examples?.length), 'an example');
      assert.deepStrictEqual(model('echo a').rows.length, 1);
    });

    it('never loses a warning, a fact or an example, and adds rows at depth 2 without moving or changing those of depth 1', function () {
      this.timeout(120000);
      const { files, snippets } = corpus();
      let checked = 0;
      for (const { name, text } of [...files, ...snippets]) {
        const tree = parser.parse(text);
        const analyzer = new Analyzer('en');
        text.split('\n').slice(0, 400).forEach((_, line) => {
          const ex = analyzer.explainLine(tree, line, 'bash', { reading: true, argv: true });
          if (!ex.items.length) return;
          checked++;
          const first = all(rowModel(ex, D1, 'en').rows);
          const second = all(rowModel(ex, D2, 'en').rows);
          const where = `${name}, line ${line}`;
          assert.strictEqual(new Set(second.map((r) => r.key)).size, second.length, `a key twice: ${where}`);
          // (The rows of depth 1, in order, are among those of depth 2, saying the same.)
          let at = 0;
          for (const r of second) if (r.key === first[at]?.key) assert.strictEqual(first[at++].text, r.text, where);
          assert.strictEqual(at, first.length, `depth 1 is not in depth 2: ${where}`);
          // (What the panel must show is shown at depth 1.)
          const toks = tokens(ex.items);
          assert.deepStrictEqual(new Set(first.flatMap((r) => r.marks?.map((m) => m.id) ?? [])), new Set(toks.flatMap((t) => t.marks?.map((m) => m.id) ?? [])), where);
          assert.deepStrictEqual(new Set(first.flatMap((r) => r.facts ?? [])), new Set(toks.flatMap((t) => t.facts ?? [])), where);
          assert.deepStrictEqual(new Set(first.flatMap((r) => r.examples ?? [])), new Set(toks.flatMap((t) => t.examples ?? [])), where);
          // (A fact of the line is said by its note: no row says it again.)
          for (const n of ex.noteInfo) for (const r of first) assert.ok(!r.text.includes(n.body), `${where}: ${r.label} says ${n.body}`);
        });
      }
      assert.ok(checked > 2000, String(checked));
    });

    it('says the same of a word on every line of its statement', function () {
      this.timeout(120000);
      const { files, snippets } = corpus();
      const differ: string[] = [];
      for (const { name, text } of [...files, ...snippets]) {
        if (!text.includes('\n')) continue;
        const tree = parser.parse(text);
        const analyzer = new Analyzer('en');
        const seen = new Map<string, string>();
        text.split('\n').slice(0, 400).forEach((_, line) => {
          for (const r of all(rowModel(analyzer.explainLine(tree, line, 'bash'), D1, 'en').rows)) {
            // (A part over several lines is about the lines it is on, and said as a whole on one of them.)
            if (r.span.start.line !== r.span.end.line) continue;
            const before = seen.get(r.key);
            if (before !== undefined && before !== r.text) differ.push(`${name}: ${r.label}: ${before} / ${r.text}`);
            seen.set(r.key, r.text);
          }
        });
      }
      assert.deepStrictEqual(differ, []);
    });

    it('says a redirection after a block as on the block\'s first line', () => {
      const src = 'while read -r l; do\n  echo "$l"\ndone < in';
      const said = (line: number) => all(model(src, D1, 'en', line).rows).find((r) => r.label === '< in')!.text;
      assert.strictEqual(said(2), said(0));
      assert.match(said(2), /applies to the whole loop/);
      assert.ok(!explain(src, 2).summary.includes('whole loop'), 'the inline display stays short');
    });

    it('says what a row holds once: what a token folded into it says is no repeat of its own text', function () {
      this.timeout(120000);
      const { files, snippets } = corpus();
      for (const { name, text } of [...files, ...snippets]) {
        const tree = parser.parse(text);
        const analyzer = new Analyzer('en');
        text.split('\n').slice(0, 400).forEach((_, line) => {
          const ex = analyzer.explainLine(tree, line, 'bash', { reading: true, argv: true });
          for (const r of all(rowModel(ex, D2, 'en').rows)) for (const m of r.more) assert.notStrictEqual(m.map((p) => p.text).join(''), r.text, `${name}, line ${line}: ${r.label}`);
        });
      }
    });

    it('explains what bash expands in an option\'s attached value: a command runs there', () => {
      const commands = (src: string) => all(model(src, { depth: 2, receives: true }).rows).filter((r) => r.receives).map((r) => r.label);
      assert.deepStrictEqual(commands('make -j"$(nproc)" build'), ['make', 'nproc']);
      assert.deepStrictEqual(commands('make -j$(nproc)'), ['make', 'nproc']);
      const value = all(model('sort -k$n,$n f', D2).rows).find((r) => r.label === '$n,$n')!;
      assert.deepStrictEqual(value.children.map((c) => c.label), ['$n', ',', '$n']);
      // (The long form, the value in quotes, and the option's word itself in quotes.)
      for (const src of ['make --jobs=$(nproc)', 'make --jobs="$(nproc)"', 'make "--jobs=$(nproc)"', 'make -"j$(nproc)"', 'make "-j$(nproc)"', 'make "-j$(nproc)"x', 'make "-j"$(nproc)']) {
        assert.deepStrictEqual(commands(src), ['make', 'nproc'], src);
      }
      assert.deepStrictEqual(commands('ls --color="$(x)"'), ['ls', 'x']);
      assert.ok(all(model('sed -i"$x" f', D2).rows).some((r) => r.label === '$x'));
    });

    it('labels the value as written, and places it and the letter in the word: no quote left over', () => {
      const place = (src: string, label: string) => {
        const r = all(model(src, D2).rows).find((x) => x.label === label)!;
        return src.slice(r.span.start.character, r.span.end.character);
      };
      assert.strictEqual(place('make "-j$(nproc)"', '$(nproc)'), '$(nproc)');
      assert.strictEqual(place('make -"j$(nproc)"', '$(nproc)'), '$(nproc)');
      assert.strictEqual(place('make "-j$(nproc)"x', '$(nproc)x'), '$(nproc)"x');
      assert.strictEqual(place('make -j"$(nproc)"', '"$(nproc)"'), '"$(nproc)"');
      assert.strictEqual(place('make "-j"$x', '$x'), '$x');
      assert.match(explain('make "--jobs=$(nproc)"').items[0].children[0].explanation, /value: `\$\(nproc\)`\)/);
      // (A letter of a cluster in quotes, too: `v` of `"-vj$x"`.)
      const letters = (src: string) => tokens(explain(src).items).filter((t) => t.kind === 'option' && t.label.length === 2).map((t) => src.slice(t.span.start.character, t.span.end.character));
      assert.deepStrictEqual(letters('sort "-rk$x"'), ['r', 'k']);
      assert.deepStrictEqual(letters('sort -"rk$x"'), ['r', 'k']);
      assert.deepStrictEqual(letters('sort -\\rk$x'), ['r', 'k']);
      assert.deepStrictEqual(letters('sort -""rk$x'), ['r', 'k']);
      // (A part of the value in the word before the expansion is in the value, and has no row of its own.)
      assert.deepStrictEqual(all(model('sort -k1$x', D2).rows).find((r) => r.label === '1$x')!.children.map((c) => c.label), ['$x']);
    });
  });

  describe('a redirection at depth 1', () => {
    // [the script, its line, the row of the redirection, what it says, what lies in its target]
    const table: readonly [string, number, string, RegExp, readonly string[]][] = [
      ['echo a > "$f"', 0, '> "$f"', /^Write stdout \(fd 1\) to file/, ['"$f"', '$f']],
      ['echo a > $b', 0, '> $b', /^Write stdout \(fd 1\) to file/, ['$b']],
      ['echo a 2>"$f"', 0, '2>"$f"', /^Write stderr \(fd 2\) to file/, ['"$f"', '$f']],
      ['cat < "$f"', 0, '< "$f"', /^Read file/, ['"$f"', '$f']],
      ['cat <<< "$x"', 0, '<<< "$x"', /^Here-string/, ['"$x"', '$x']],
      ['cat <<< \'hi\'', 0, '<<< \'hi\'', /^Here-string/, ['\'hi\'']],
      ['cat <<EOF\n$var\nEOF', 0, '<<EOF', /^Here-document/, ['$var']],
      ['[ $a < $b ]', 0, '< $b', /^Read file/, ['$b']],
      ['echo a > "$f" b', 0, '> "$f"', /^Write stdout/, ['"$f"', '$f']],
      ['tar c x 2>"$f"', 0, '2>"$f"', /^Write stderr/, ['"$f"', '$f']],
      ['{ a; } > "$f"', 0, '> "$f"', /^Write stdout/, ['"$f"', '$f']],
      ['x=1 > "$f"', 0, '> "$f"', /^Write stdout/, ['"$f"', '$f']],
      ['exec > "$f"', 0, '> "$f"', /^Write stdout/, ['"$f"', '$f']],
      ['x=$(ls /nope) 2>/dev/null', 0, '2>/dev/null', /^Write stderr/, []],
      ['while read l; do\n  echo "$l"\ndone < "$f"', 2, '< "$f"', /^Read file .* It applies to the whole loop/, ['"$f"', '$f']],
      ['while read l; do\n  echo "$l"\ndone < input.txt', 2, '< input.txt', /^Read file .* It applies to the whole loop/, []],
    ];
    for (const [src, line, label, says, target] of table) {
      it(`keeps the row of \`${label}\` in \`${src.replace(/\n/g, '; ')}\`, and takes its target for no part of the command`, () => {
        const rows = all(model(src, D1, 'en', line).rows);
        const row = rows.find((r) => r.label === label);
        assert.ok(row, rows.map((r) => r.label).join());
        assert.match(row.text, says);
        assert.ok(row.refs?.some((r) => r.startsWith('3.6')), src);
        assert.deepStrictEqual(rows.filter((r) => r !== row && r.children.some((c) => target.includes(c.label))).map((r) => r.label), []);
      });
    }

    it('shows a target\'s value under the redirection, not as a part of the command', () => {
      const rows = all(model('f=out.txt; echo a > "$f"').rows);
      const echo = rows.find((r) => r.label === 'echo')!;
      assert.deepStrictEqual(echo.children.map((r) => r.label), ['a', '> "$f"']);
      assert.deepStrictEqual(echo.children[1].children.map((r) => r.label), ['$f']);
      assert.ok(echo.children[1].children[0].value);
    });

    it('says at depth 1 that the redirections of a command with no name apply to nothing, not even to its assignments', () => {
      for (const [src, word] of [['x=$(ls /nope) 2>/dev/null', '2>/dev/null'], ['x=1 > "$f"', '> "$f"'], ['x=1 y=2 > "$f"', '> "$f"']]) {
        const [row, ...others] = model(src).rows;
        assert.deepStrictEqual(others, [], src);
        assert.strictEqual(row.frame, 'command', src);
        assert.match(row.text, /^Redirections of a command with no name: .*nor do they apply to/, src);
        // (The redirection and the assignments are parts of that row, side by side.)
        assert.ok(row.children.some((c) => c.label === word), src);
        assert.ok(row.children.some((c) => c.label.startsWith('x=')), src);
      }
      // (With a name, or around a compound command, the row is the command's.)
      assert.strictEqual(model('ls /nope 2>/dev/null').rows[0].label, 'ls');
      assert.match(model('{ ls; } 2>/dev/null').rows[0].text, /^Command group/);
    });

    it('takes a command\'s redirections for what stands around it, whatever their targets hold', () => {
      assert.deepStrictEqual(outline(model('tar c x 2>/dev/null').rows), [['[command] tar', ['c', 'x', '2>/dev/null']]]);
      assert.deepStrictEqual(outline(model('>"$f" cat').rows), [['[command] cat', ['>"$f"']]]);
      // (A redirection in a word's command is that command's.)
      assert.deepStrictEqual(outline(model('cat <<< "$(a > "$f")"').rows), [['[command] cat', [['<<< "$(a > "$f")"', [['$(a > "$f")', [['[command] a', ['> "$f"']]]]]]]]]);
      // (No command, or more than one assignment, to stand around: the row of the redirections.)
      assert.deepStrictEqual(outline(model('> "$f"').rows), ['[command] > "$f"']);
      assert.deepStrictEqual(outline(model('x=1 y=2 > "$f"').rows)[0], ['[command] x=1 y=2 > "$f"', [['x=1 y=2', ['x=1', 'y=2']], '> "$f"']]);
    });

    it('leaves what it stands around out of `--format json`', async () => {
      let text = '';
      await main(['--no-config', '--format', 'json', '-e', 'tar c x > "$f"; time a | b; ! c | d'], { stdout: (s) => { text += s; }, stderr: () => {}, env: {}, isTTY: false });
      assert.ok(text.includes('tar'));
      assert.doesNotMatch(text, /"around"/);
    });
  });

  describe('what a command name is, at depth 1', () => {
    it('gives the reserved word `time` a row of its own, with its badge, among the parts of what it times', () => {
      for (const [src, whole, timed] of [['time sort f | uniq', 'time sort | uniq', 'sort | uniq'], ['time a', 'time a', 'a'], ['time { a; }', 'time { ‹commands› }', '{ ‹commands› }'], ['time > "$o" a', 'time a', 'a'], ['time -p a', 'time -p a', 'a']]) {
        const [top] = model(src).rows;
        assert.strictEqual(top.label, whole, src);
        assert.strictEqual(top.name, undefined, src);
        const [time, ...rest] = top.children;
        assert.strictEqual(time.label, 'time', src);
        assert.strictEqual(time.name?.said.kind, 'keyword', src);
        assert.match(time.name?.said.also ?? '', /\/usr\/bin\/time/, src);
        assert.strictEqual(time.text, 'Measure and report the run time of the pipeline', src);
        assert.notStrictEqual(time.text, top.text, src);
        assert.strictEqual(rest.at(-1)!.label, timed, src);
        // (At depth 2, the same row and the badge, once.)
        const deep = all(model(src, D2).rows);
        assert.deepStrictEqual(deep.filter((r) => r.name?.said.kind === 'keyword').map((r) => r.label), ['time'], src);
        assert.strictEqual(deep.filter((r) => r.label === 'time').length, 1, src);
      }
      // (With nothing to time, the word is the row.)
      const [alone] = model('time').rows;
      assert.deepStrictEqual([alone.label, alone.name?.said.kind, alone.children], ['time', 'keyword', []]);
    });

    it('loses no name: each token that has one has a row that says it, over the corpus', function () {
      this.timeout(120000);
      const { files, snippets } = corpus();
      for (const { name, text } of [...files, ...snippets]) {
        const tree = parser.parse(text);
        const analyzer = new Analyzer('en');
        text.split('\n').slice(0, 400).forEach((_, line) => {
          const ex = analyzer.explainLine(tree, line, 'bash');
          const m = rowModel(ex, D1, 'en');
          const check = (t: Token, up: Token | undefined): void => {
            if (t.name) {
              const row = m.places.get(t)!.split('.').reduce<ModelRow | undefined>((r, i) => (r ? r.children : m.rows)[Number(i)], undefined);
              assert.strictEqual(row?.name, t.name, `${name}, line ${line}: ${t.label}`);
              // (Its own row: not that of a part around it, but where the two are one row, a part of the same range or a command in its redirections.)
              if (up && !sameSpan(up.span, t.span) && up.around !== 'redirections') assert.notStrictEqual(m.places.get(t), m.places.get(up), `${name}, line ${line}: ${t.label}`);
            }
            t.children.forEach((c) => check(c, t));
          };
          ex.items.forEach((t) => check(t, undefined));
        });
      }
    });
  });

  describe('one row per range', () => {
    it('folds the tokens of one range into a row, which says the rest at depth 2 and a warning at both', () => {
      const texts = (src: string, options: RowOptions) => all(model(src, options).rows).find((r) => r.label === '"$a"')!.more.map((p) => p.map((x) => x.text).join(''));
      assert.deepStrictEqual(texts('cp "$a" b', D1), []);
      assert.match(texts('cp "$a" b', D2)[0], /^Double-quoted string/);
      // (The value and the reference of a part it holds alone.)
      const word = all(model('x=1; cp $x b').rows).find((r) => r.label === '$x')!;
      assert.ok(word.value);
      assert.ok(word.more.length === 0);
    });

    it('keeps a folded warning\'s text at depth 1', () => {
      const r = rowModel({ noteInfo: [], items: [token('option', '-x', 'first', [{ ...token('variable', '-x', 'bad'), marks: [{ id: 'splice-refused', level: 'warning', text: 'bad' }] }])] }, D1, 'en').rows[0];
      assert.deepStrictEqual(r.more, [[{ text: 'bad', level: 'warning' }]]);
      assert.strictEqual(r.level, 'warning');
    });

    it('makes a redirection around a command the command\'s row, with the redirection among its parts', () => {
      const [cmd] = model('tar -czf a b 2>/dev/null').rows;
      assert.deepStrictEqual(outline([cmd]), [['[command] tar', [['-czf', ['-c', '-z', '-f']], 'a', 'b', '2>/dev/null']]]);
      assert.strictEqual(keyOf(cmd.span), '0:0-0:24');
      assert.deepStrictEqual(cmd.more, []);
      const said = model('tar -czf a b 2>/dev/null', D2).rows[0].more.map((p) => p[0].text);
      assert.match(said[0], /^Redirection applied to/);
      // (Before the name, too; and around a compound command.)
      assert.deepStrictEqual(outline(model('>o echo a').rows), [['[command] echo', ['>o', 'a']]]);
      assert.deepStrictEqual(outline(model('{ a; } >o').rows), [['[compound] { ‹commands› }', ['[command] a', '>o']]]);
      // (A redirection alone is bash's simple command of no words.)
      assert.deepStrictEqual(outline(model('>o').rows), ['[command] >o']);
    });

    it('keeps a pipeline apart from its first command when they end together', () => {
      const src = 'cat <<E | sort\nx\nE';
      const rows = model(src, { depth: 2, receives: true }, 'en', 1).rows;
      assert.strictEqual(new Set(all(rows).map((r) => r.key)).size, all(rows).length);
      assert.strictEqual(rows[0].frame, 'group');
      assert.strictEqual(rows[0].receives, undefined);
      assert.ok(all(rows).some((r) => r.frame === 'command' && r.receives));
    });
  });

  describe('where each token is shown', () => {
    /** The row at a path. */
    const at = (rows: readonly ModelRow[], path: string): ModelRow => path.split('.').map(Number).reduce<{ children: readonly ModelRow[] }>((r, i) => r.children[i], { children: rows }) as ModelRow;
    const placeOf = (src: string, label: string, options = D1) => {
      const ex = explain(src);
      const { rows, places } = rowModel(ex, options, 'en');
      const token = tokens(ex.items).find((t) => t.label === label)!;
      return at(rows, places.get(token)!).label;
    };

    it('is the token\'s own row where it has one', () => {
      assert.strictEqual(placeOf('sort -u f | head', '-u'), '-u');
      assert.strictEqual(placeOf('sort -u f | head', 'head'), 'head');
    });

    it('is the row it is folded into: a word made of one expansion, a command with its redirection', () => {
      const ex = explain('tar -czf x y 2>/dev/null');
      const { rows, places } = rowModel(ex, D1, 'en');
      for (const t of ex.items) assert.strictEqual(places.get(t), '0');
      assert.strictEqual(rows[0].label, 'tar');
    });

    it('is the nearest row around it where it has none at this depth, and its own at depth 2', () => {
      const src = 'if [ -f a ]; then echo b; fi';
      assert.strictEqual(placeOf(src, 'then'), 'if ‹condition› then ‹commands› fi');
      assert.strictEqual(placeOf(src, 'then', D2), 'then');
      assert.strictEqual(placeOf('echo "a b"', '"a b"'), '"a b"');
    });

    it('names a row for every token of the corpus, at both depths', function () {
      this.timeout(120000);
      for (const { text } of corpus().snippets.filter((_, i) => i % 5 === 0)) {
        const ex = explain(text);
        for (const options of [D1, D2]) {
          const { rows, places } = rowModel(ex, options, 'en');
          for (const t of tokens(ex.items)) assert.ok(at(rows, places.get(t)!), `${t.label} in ${text}`);
        }
      }
    });
  });

  describe('the line box', () => {
    it('colours each run by the deepest token, and goes to the row that shows it or lies around it', () => {
      const lineText = '  if [ "$x" ]; then y; fi';
      const explanation = explain(lineText);
      const { lineRuns, rows } = panelUpdate({ lang: 'en', explanation, file: 'f', line: 0, lineText, choice: {}, placement: 'first', animations: true });
      const at = (word: string) => lineRuns.find((r) => r.from <= lineText.indexOf(word) && lineText.indexOf(word) < r.to)!;
      // (The indent is nobody's.)
      assert.deepStrictEqual(lineRuns[0], { from: 0, to: 2 });
      assert.strictEqual(at('$x').kind, 'variable');
      assert.strictEqual(at('then').row, '0');
      assert.strictEqual(rows[0].label.startsWith('if'), true);
      // (Every character is in one run, in order.)
      assert.strictEqual(lineRuns.at(-1)!.to, lineText.length);
      lineRuns.slice(1).forEach((r, i) => assert.strictEqual(r.from, lineRuns[i].to));
    });
  });

  describe('the example of the whole line', () => {
    const whole = (src: string) => {
      const ex = explain(src);
      return wholeLineExamples(ex).map((e) => e.kind);
    };

    it('is that of a pipeline that is the line, or a statement of its list', () => {
      assert.deepStrictEqual(whole('printf "a\\n" | sort'), ['pipeline']);
      assert.deepStrictEqual(whole('printf "a\\n" | sort; printf "b\\n" | tac'), ['pipeline', 'pipeline']);
    });

    it('is that of a pipeline after its `time` or `!`, which are parts of it (3.2.3)', () => {
      for (const src of ['time sort f | uniq', '! sort f | uniq', 'time -p sort f | uniq', '! sort f | uniq && ls', 'time sort f | uniq; ls']) {
        const ex = explain(src);
        assert.deepStrictEqual(wholeLineExamples(ex).map((e) => e.kind), ['pipeline'], src);
        // (So it is drawn apart: no row holds it.)
        const msg = panelUpdate({ lang: 'en', explanation: ex, file: 'a.sh', line: 0, lineText: src, choice: {}, placement: 'first', animations: true });
        assert.strictEqual(msg.wholeLine.length, 1, src);
        assert.deepStrictEqual(all(msg.rows).filter((r) => r.examples?.length).map((r) => r.label), [], src);
      }
      // (Inside a construct, it keeps its place.)
      assert.deepStrictEqual(whole('if ! sort f | uniq; then :; fi'), []);
      assert.deepStrictEqual(whole('for x in a; do time sort f | uniq; done'), []);
    });

    it('is not that of a pipeline inside a construct of the line, nor any other example', () => {
      assert.deepStrictEqual(whole('for x in a; do printf "a\\n" | sort; done'), []);
      assert.deepStrictEqual(whole('y=$(printf "a\\n" | sort)'), []);
      assert.deepStrictEqual(whole('grep "a.b" f'), []);
    });
  });

  describe('the frames', () => {
    const frames = (src: string) => all(model(src).rows).filter((r) => r.frame).map((r) => `${r.frame} ${r.label}`);

    it('boxes a simple command, also of assignments alone or a test, and a compound command', () => {
      assert.deepStrictEqual(frames('x=1'), ['command x=1']);
      assert.deepStrictEqual(frames('a=1 b=2'), ['command a=1 b=2']);
      assert.deepStrictEqual(frames('FOO=1 ls'), ['command ls']);
      assert.deepStrictEqual(frames('local y=2'), ['command local']);
      assert.deepStrictEqual(frames('$cmd x'), ['command $cmd']);
      assert.deepStrictEqual(frames('[ -f x ]'), ['command [ -f x ]']);
      assert.deepStrictEqual(frames('[[ -f x && -f y ]]'), ['compound [[ -f x && -f y ]]']);
      assert.deepStrictEqual(frames('f() { a; }'), ['compound f() { ‹commands› }', 'compound { ‹commands› }', 'command a']);
      assert.deepStrictEqual(frames('f() { :; }; f'), ['group f() { ‹commands› }; f', 'compound f() { ‹commands› }', 'compound { ‹commands› }', 'command :', 'command f']);
    });

    it('takes them from what bash\'s grammar makes of the part: an expression, `time` and `!` are no commands of their own', () => {
      assert.deepStrictEqual(frames('for ((i=0; i<3; i++)); do :; done'), ['compound for (( ‹init› ; ‹test› ; ‹update› )) do ‹commands› done', 'command :']);
      assert.deepStrictEqual(frames('(( i=0 ))'), ['compound (( i=0 ))']);
      // (3.2.3: `time` and `!` are parts of a pipeline, and the commands under them have their boxes.)
      assert.deepStrictEqual(frames('time a'), ['command a']);
      assert.deepStrictEqual(frames('time a | b'), ['group a | b', 'command a', 'command b']);
      assert.deepStrictEqual(frames('! a'), ['command a']);
      assert.deepStrictEqual(frames('coproc a'), ['command a']);
      assert.deepStrictEqual(frames('[[ ( -f a ) ]]'), ['compound [[ ( -f a ) ]]']);
      assert.deepStrictEqual(frames('x=1 [ -f f ]'), ['command x=1 [ -f f ]']);
      // (A clause of `if` is no command either: on a line of its own, only what it runs is boxed.)
      assert.deepStrictEqual(all(model('if a; then b\nelif c; then d\nfi', D1, 'en', 1).rows).filter((r) => r.frame).map((r) => `${r.frame} ${r.label}`), ['command c', 'command d']);
    });

    it('brackets a pipeline and a list', () => {
      assert.deepStrictEqual(frames('a | b'), ['group a | b', 'command a', 'command b']);
      assert.deepStrictEqual(frames('a && b'), ['group a && b', 'command a', 'command b']);
      assert.deepStrictEqual(frames('a; b'), ['group a; b', 'command a', 'command b']);
    });

    it('does not box what a command reads as a command, or a language\'s tokens: bash\'s simple command is the outer one', () => {
      assert.deepStrictEqual(frames('sudo ls'), ['command sudo']);
      assert.deepStrictEqual(frames('git commit -m x'), ['command git']);
      assert.deepStrictEqual(frames("awk '{ print }' f"), ['command awk']);
      // (A script a command gives a shell is commands again.)
      assert.deepStrictEqual(frames('bash -c "ls; pwd"').slice(0, 1), ['command bash']);
      assert.ok(frames("trap 'rm x' EXIT").includes('command rm'));
      // (A row that folds a command takes its box.)
      assert.ok(frames("eval 'ls'").includes('command eval'));
    });

    it('boxes each simple command bash reads on a line, as P4 knows them, over the corpus', function () {
      this.timeout(120000);
      const { files, snippets } = corpus();
      for (const { name, text } of [...files, ...snippets]) {
        const tree = parser.parse(text);
        const analyzer = new Analyzer('en');
        text.split('\n').slice(0, 400).forEach((source, line) => {
          const ex = analyzer.explainLine(tree, line, 'bash', { argv: true });
          const rows = all(rowModel(ex, { depth: 2, receives: true }, 'en').rows);
          for (const l of ex.argv ?? []) {
            // (In POSIX mode, `time -p` with a first word that may start with a dash is a command that reads its command, as `sudo` does.)
            if (l.span.start.line !== line || l.span.end.line !== line || text.startsWith('set -o posix\ntime')) continue;
            assert.strictEqual(rows.filter((r) => r.receives && keyOf(r.receives.span) === keyOf(l.span)).length, 1, `${name}: ${source}: ${keyOf(l.span)}`);
          }
          for (const r of rows) if (r.receives) assert.strictEqual(r.frame, 'command', source);
        });
      }
    });
  });

  describe('depth 2: what the reading tree adds', () => {
    const rows = (src: string, options = D2, lang: Lang = 'en', line = 0) => all(model(src, options, lang, line).rows);
    const row = (src: string, label: string, lang: Lang = 'en', line = 0) => rows(src, D2, lang, line).find((r) => r.label === label)!;
    const said = (r: ModelRow) => [r.text, ...r.more.map((m) => m.map((p) => p.text).join(''))];

    it('gives every part of bash\'s grammar with no token a row: `[[`, its operators, the parts of a redirection and of an assignment', () => {
      const labels = (src: string) => rows(src).map((r) => r.label);
      assert.deepStrictEqual(labels('[[ -f a && b ]]').filter((l) => ['[[', '-f', 'a', '&&', ']]'].includes(l)), ['[[', '-f', 'a', '&&', ']]']);
      assert.strictEqual(row('[[ -f a ]]', '[[').text, 'Start of the conditional expression');
      assert.strictEqual(row('[[ -f a ]]', ']]').comesAt, 2);
      assert.strictEqual(row('[[ -f a ]]', 'a').text, 'The file `-f` tests');
      assert.deepStrictEqual(labels('a 2>/dev/null'), ['a', '2>/dev/null', '2', '>', '/dev/null']);
      assert.deepStrictEqual(labels('x=1'), ['x=1', 'x', '=', '1']);
      assert.deepStrictEqual(labels('cat <<E\nE').slice(0, 4), ['cat', '<<E', '<<', 'E']);
      // In the order of the line, under the deepest row around them; depth 1 has none of them.
      const redirect = row('a 2>/dev/null', '2>/dev/null');
      assert.deepStrictEqual(redirect.children.map((c) => [c.label, c.comesAt]), [['2', 2], ['>', 2], ['/dev/null', 2]]);
      assert.deepStrictEqual(rows('a 2>/dev/null', D1).map((r) => r.label), ['a', '2>/dev/null']);
      // No row twice: a part the row around it speaks for is one more of its roles.
      assert.deepStrictEqual(labels('xargs -0 rm -f').filter((l) => l === 'rm'), ['rm']);
      assert.ok(row('xargs -0 rm -f', 'rm').roles.some((r) => r.id === 'command:command'));
    });

    it('says what a kind is in general on a row with no text of its own, the first time on the line', () => {
      const [first, second] = rows('a >x >y').filter((r) => r.label === 'x' || r.label === 'y');
      assert.match(first.text, /^A word: bash expands it/);
      assert.strictEqual(second.text, '');
      assert.deepStrictEqual(second.parts, []);
      // (An operator has no general text: its role line says what it is.)
      assert.strictEqual(row('a >x', '>').text, '');
      assert.deepStrictEqual(row('a >x', '>').roleLine!.chips.map((c) => c.text), ['operator']);
    });

    it('keeps a row of its own only for a part that holds no row of a token: `items[1]` is no row, its parts are', () => {
      const labels = rows('echo "${items[1]}"').map((r) => r.label);
      assert.ok(!labels.includes('items[1]'), String(labels));
      assert.ok(labels.includes('[1]'));
    });

    it('gives each row one role line: its names, an arrow where another reader takes it, the reader, the sections no text cites', () => {
      const line = (src: string, label: string) => {
        const l = row(src, label).roleLine!;
        return [l.chips.map((c) => `${c.changes ? '→ ' : ''}${c.text}`).join(' '), l.reader, l.refs];
      };
      assert.deepStrictEqual(line('tar -czf "$b" x', '"$b"'), ['argument → value of -f', 'tar reads it', ['3.7.1']]);
      assert.deepStrictEqual(line('tar -czf "$b" x', 'tar').slice(0, 2), ['simple command command name', undefined]);
      assert.deepStrictEqual(line('grep -E "^a" f', '"^a"').slice(0, 2), ['argument → operand → regex', 'grep reads it']);
      // (The ja role line reads the same ids.)
      assert.strictEqual(row('tar -czf "$b" x', '"$b"', 'ja').roleLine!.chips[1].text, '-f の値');
      assert.strictEqual(row('tar -czf "$b" x', '"$b"', 'ja').roleLine!.reader, 'tar が読む');
      assert.strictEqual(rows('cd $d/x', D1)[0].roleLine, undefined);
    });

    // A role says where a part stands in bash's reading: the place its range has there, never what its token is lexically. Each row: the code,
    // its names in English and in Japanese ('' for no role), and who reads it last. Where main's Reading had a node of the range, its names are here too,
    // but for quotes, which are a property of a word (`x="$DIR"` said "quotes": it is the value); what is added is a place that Reading did not draw.
    const ROLES: readonly (readonly [src: string, label: string, en: string, ja: string, reader?: string])[] = [
      // The value of an assignment, whatever its token's kind is.
      ['x=notes.txt', 'notes.txt', 'value', '値'],
      ['d=/tmp', '/tmp', 'value', '値'],
      ['x=1', '1', 'value', '値'],
      ['x="$DIR"', '"$DIR"', 'value', '値'],
      ["x='a b'", "'a b'", 'value', '値'],
      ['x=$y', '$y', 'value | expansion', '値 | 展開'],
      ['x=$(date)', '$(date)', 'value | substitution', '値 | 置換'],
      ['x=a$b', 'a$b', 'value', '値'],
      ['x+=1', '1', 'value', '値'],
      ['a[0]=x', 'x', 'value', '値'],
      ['backup="${HOME}/b-$(date +%F).tar.gz"', '"${HOME}/b-$(date +%F).tar.gz"', 'value', '値'],
      ['export LANG=C', 'C', 'value', '値'],
      ['local v="$1"', '"$1"', 'value', '値'],
      // The first word, when the name is known only when it runs.
      ['"$cmd" x', '"$cmd"', 'simple command | first word', '単純コマンド | 最初の単語'],
      ['$cmd x', '$cmd', 'simple command | first word', '単純コマンド | 最初の単語'],
      ['$cmd x', 'x', 'word', '単語'],
      // A pipeline with its `!` or `time`, on its top row, and what `time` stands before.
      ['! grep -q x f', '! grep', 'pipeline', 'パイプライン'],
      ['! grep -q x f', '!', 'reserved word', '予約語'],
      ['! a && b', '! a', 'pipeline', 'パイプライン'],
      ['! a && b', '! a && b', 'AND list', 'AND リスト'],
      ['time ls', 'time ls', 'pipeline', 'パイプライン'],
      ['time -p ls | wc', 'time -p ls | wc', 'pipeline', 'パイプライン'],
      ['time -p ls | wc', 'time', 'reserved word', '予約語'],
      ['time -p ls | wc', '-p', 'option', 'オプション'],
      ['time -p ls | wc', 'ls | wc', 'pipeline', 'パイプライン'],
      ['time -p', 'time -p', 'pipeline', 'パイプライン'],
      ['echo $(time -p a | b)', 'a | b', 'pipeline', 'パイプライン'],
      // A piece of a word has no role: the word has it. A part bash reads in it has its own.
      ['cd $d/cache', '$d/cache', 'argument | operand: each word it splits into', '引数 | オペランド: 分割された語ごと', 'cd reads it'],
      ['cd $d/cache', '/cache', '', ''],
      ['cd $d/cache', '$d', 'expansion', '展開'],
      ['echo a$b', 'a', '', ''],
      ['echo "a"b', '"a"', '', ''],
      ['echo "a"b', 'b', '', ''],
      ['x=a$b', 'a', '', ''],
      ['alias ll="ls -l"', 'll=', '', ''],
      // A whole word.
      ['echo "$a"', '"$a"', 'argument | operand', '引数 | オペランド', 'echo reads it'],
      ["echo 'x'", "'x'", 'argument | operand', '引数 | オペランド', 'echo reads it'],
      ['echo *.txt', '*.txt', 'argument | operand: each matching file name', '引数 | オペランド: 一致したファイル名ごと', 'echo reads it'],
      ['echo {a,b}', '{a,b}', 'argument | brace expansion | operand: each word the braces give', '引数 | ブレース展開 | オペランド: ブレース展開の語ごと', 'echo reads it'],
      // A command name, and what another command runs: to bash an argument.
      ['[ -f f ]', '[ -f f ]', 'simple command | command name', '単純コマンド | コマンド名'],
      ['[ -f f ]', '[', 'command name', 'コマンド名'],
      ['sudo echo hi', 'echo', 'argument | command name', '引数 | コマンド名', 'sudo reads it'],
      ['nice -n 5 ls', 'ls', 'argument | command name', '引数 | コマンド名', 'nice reads it'],
      ['xargs rm -f', 'rm', 'argument | command name', '引数 | コマンド名', 'xargs reads it'],
      ['tar -czf "$out" x', '"$out"', 'argument | value of -f', '引数 | -f の値', 'tar reads it'],
      // What a reader's language calls its parts, as main's Reading did.
      ["grep -E '^a' f", "'^a'", 'argument | operand | regex', '引数 | オペランド | 正規表現', 'grep reads it'],
      // Redirections, here-documents, lists, compound commands.
      ['cat <<E\nhi\nE', '<<E', 'redirection | here-document', 'リダイレクト | ヒアドキュメント'],
      ['cat <<E\nhi\nE', 'E', 'delimiter', '終わりの区切り'],
      ['a >x', 'x', 'word', '単語'],
      ['a 2>&1', '2', 'file descriptor', 'ファイルディスクリプタ'],
      ['a; b &', 'a; b &', 'list', 'リスト'],
      ['a | b', 'a | b', 'pipeline', 'パイプライン'],
      ['a && b || c', 'a && b || c', 'OR list', 'OR リスト'],
      ['if a; then b; fi', 'then', 'reserved word', '予約語'],
      ['(a; b)', 'a; b', 'list', 'リスト'],
      ['echo $(a)', '$(a)', 'argument | substitution | operand: each word it splits into', '引数 | 置換 | オペランド: 分割された語ごと', 'echo reads it'],
      ['echo ${items[1]}', '[1]', 'expression', '式'],
      ["PS1='\\u@\\h'", "'\\u@\\h'", 'value | prompt string', '値 | プロンプト文字列', ''],
    ];
    for (const lang of ['en', 'ja'] as const) {
      it(`says each row's role by its place in bash's reading, not by its token's kind, ${lang}`, () => {
        const got = ROLES.map(([src, label]) => {
          const r = all(rowModel(explain(src, 0, lang), D2, lang).rows).find((x) => x.label === label);
          assert.ok(r, `${src}: no row ${label}`);
          return (r.roleLine?.chips ?? []).map((c) => c.text).join(' | ');
        });
        assert.deepStrictEqual(got, ROLES.map((r) => (lang === 'en' ? r[2] : r[3])));
      });
    }

    describe('a role is a place in bash\'s reading, or nothing', () => {
      /** Each row, from the column `from` on, with the line it says: `label: names · reader`. */
      const lines = (src: string, lang: Lang = 'en', from = 0, line = 0): string[] => all(rowModel(explain(src, line, lang), D2, lang).rows).filter((r) => r.span.start.line > line || r.span.start.character >= from).map((r) => {
        const l = r.roleLine;
        return `${r.label}: ${l ? l.chips.map((c) => `${c.changes ? '→ ' : ''}${c.text}`).join(' | ') : '-'}${l?.reader ? ` · ${l.reader}` : ''}`;
      });
      /** What the name `chip` opens to on the row `label`. */
      const opens = (src: string, label: string, chip: string, lang: Lang = 'en', line = 0): string => {
        const r = all(rowModel(explain(src, line, lang), D2, lang).rows).find((x) => x.label === label);
        assert.ok(r, `${src}: no row ${label}`);
        const c = r.roleLine?.chips.find((x) => x.text === chip);
        assert.ok(c, `${src}: ${label} has no ${chip}: ${r.roleLine?.chips.map((x) => x.text).join(' | ')}`);
        return c.said;
      };
      const noReader = (l: string): string => l.replace(/ · [^·|]*$/, '');

      it('reads a string a shell reads as the same code at the top level: the same roles', () => {
        const everywhere = ['for i in 1; do echo $i; done', 'rm -rf "$w"', 'echo $a', 'echo "$a" | wc -l', 'if [ "$c" = yes ]; then :; fi', 'find . -exec rm {} \;', 'echo ${a[@]} ${a[*]} ${a[1]}', 'time ls | wc', 'date +%F', 'x=1 y=$z', 'cat <f >g 2>&1', 'while read l; do echo; done < f', 'coproc foo { cat; }', 'f() { :; }; f'];
        const wrappers: [string, string][] = [["sh -c '", "'"], ["bash -c '", "'"], ["eval '", "'"], ["trap '", "' EXIT"], ["ssh h '", "'"], ['x=$(', ')']];
        for (const lang of ['en', 'ja'] as const) {
          for (const code of everywhere) {
            const top = lines(code, lang).map(noReader);
            for (const [open, close] of wrappers) {
              const src = open + code + close;
              // (The text of a `$( )` is a script, whose name a statement all of it shares: a place more, of that text.)
              const got = lines(src, lang, open.length).filter((l) => !l.startsWith('EXIT:')).map(noReader).map((l) => l.replace(/: (?:script inside|中のスクリプト) \| /, ': '));
              assert.deepStrictEqual(got, top, src);
            }
          }
        }
      });

      it('says the loop of `sh -c`, and opens the text of what each part is, with the shell that reads it', () => {
        const src = "sh -c 'for i in 1; do echo $i; done'";
        assert.deepStrictEqual(lines(src, 'en', 7), [
          'for i in ‹words› do ‹commands› done: compound command · new shell',
          'for: reserved word',
          'i: name',
          'in: reserved word',
          '1: word',
          ';: operator',
          'do ‹commands› done: part',
          'do: reserved word',
          'echo: simple command | command name',
          '$i: argument | expansion | → operand: each word it splits into · echo reads it',
          ';: operator',
          'done: reserved word',
        ]);
        assert.deepStrictEqual(lines(src, 'ja', 7), [
          'for i in ‹words› do ‹commands› done: 複合コマンド · 新しいシェル',
          'for: 予約語',
          'i: 名前',
          'in: 予約語',
          '1: 単語',
          ';: 演算子',
          'do ‹commands› done: 部分',
          'do: 予約語',
          'echo: 単純コマンド | コマンド名',
          '$i: 引数 | 展開 | → オペランド: 分割された語ごと · echo が読む',
          ';: 演算子',
          'done: 予約語',
        ]);
        const whole = 'for i in ‹words› do ‹commands› done';
        assert.strictEqual(opens(src, whole, 'compound command'), 'a newly started shell (another process) parses it again');
        assert.strictEqual(opens(src, 'i', 'name'), 'a newly started shell (another process) parses it again');
        assert.match(opens(src, 'for', 'reserved word'), /^A reserved word: .*\(a newly started shell \(another process\) parses it again\)$/);
        assert.match(opens(src, 'for', '予約語', 'ja'), /^予約語: .*（新しく起動したシェル（別のプロセス）がもう一度解析する）$/);
        assert.strictEqual(opens(src, '$i', 'expansion'), 'a newly started shell (another process) parses it again');
      });

      it('says the word of a trap expands: an argument, and its `$w` an expansion; no literal, no variable', () => {
        const src = 'trap \'rm -rf "$w"\' EXIT';
        const skip = "trap '".length;
        assert.deepStrictEqual(lines(src, 'en', skip), [
          'rm: simple command | command name · same shell, again',
          '-rf: argument | → option · rm reads it',
          '-r: option',
          '-f: option',
          '"$w": argument | → operand · rm reads it',
          '$w: expansion',
          'EXIT: argument | → operand · trap reads it',
        ]);
        assert.deepStrictEqual(lines(src, 'ja', skip), [
          'rm: 単純コマンド | コマンド名 · 同じシェルでもう一度',
          '-rf: 引数 | → オプション · rm が読む',
          '-r: オプション',
          '-f: オプション',
          '"$w": 引数 | → オペランド · rm が読む',
          '$w: 展開',
          'EXIT: 引数 | → オペランド · trap が読む',
        ]);
      });

      it('says who reads a string once, from the string: this shell again, a new one, a remote one, also under a command\'s argument', () => {
        const AGAIN = ['the shell that runs it parses this string again (no new process)', 'それを実行するシェルが、この文字列をもう一度解析する（新しいプロセスなし）'] as const;
        const NEW = ['a newly started shell (another process) parses it again', '新しく起動したシェル（別のプロセス）がもう一度解析する'] as const;
        const REMOTE = ['a shell on another machine parses it', '別のマシンのシェルが解析する'] as const;
        const table: [string, string, readonly [string, string]][] = [
          ["eval 'echo $a'", '$a', AGAIN],
          ['trap \'rm -f "$w"\' EXIT', '$w', AGAIN],
          ["bash -c 'echo $a'", '$a', NEW],
          ["sh -c 'rm -f \"$w\"'", '$w', NEW],
          ['ssh h \'echo "$a"\'', '$a', REMOTE],
          ['ssh h "echo \\$a"', '$a', REMOTE],
        ];
        for (const [src, label, [en, ja]] of table) {
          assert.strictEqual(opens(src, label, 'expansion'), en, src);
          assert.strictEqual(opens(src, label, '展開', 'ja'), ja, src);
        }
        // (A `$( )` in it has a subshell of its own, and a string in the string its own shell.)
        assert.strictEqual(opens("bash -c 'echo $(ls)'", 'ls', 'command name').endsWith('(a subshell (a copy of this shell) parses it again)'), true);
        assert.strictEqual(opens("bash -c 'eval \"ls\"'", 'ls', 'command name').endsWith('(the shell that runs it parses this string again (no new process))'), true);
        // (A pipeline with no node of its own, in a string, is that shell's too.)
        assert.strictEqual(opens("ssh h 'time ls | wc'", 'ls | wc', 'pipeline'), 'a shell on another machine parses it');
        assert.deepStrictEqual(lines("ssh h 'time ls | wc'", 'en', 7).slice(0, 1), ['time ls | wc: pipeline · remote shell']);
      });

      it('names a language\'s reader by the command, never by the code around it', () => {
        const sed = 'bash -c "echo a | sed \'s/a/b/\'"';
        assert.strictEqual(opens(sed, 's/a/b/', 'sed script'), 'A language of its own inside the word: the command reads it by its own rules, not bash. (a language of its own, read by sed)');
        assert.strictEqual(opens(sed, 's/a/b/', 'sed スクリプト', 'ja'), '単語の中にある独自の言語: bash ではなく、コマンドが独自の規則で読む。（sed が読む独自の言語）');
        const test = 'trap \'if [ "$cleanup" = yes ]; then :; fi\' EXIT';
        assert.strictEqual(opens(test, '"$cleanup" = yes', 'condition'), '[ reads it, inside the shell');
        assert.strictEqual(opens(test, '"$cleanup" = yes', '条件', 'ja'), 'シェルの中で [ が読む');
      });

      it('says the shell first and the command after, whatever the ranges: `rm` of `find -exec`', () => {
        for (const [src, skip] of [['find . -exec rm {} \;', 0], ["sh -c 'find . -exec rm {} \;'", 7]] as const) {
          assert.deepStrictEqual(lines(src, 'en', skip).filter((l) => l.startsWith('rm:')), ['rm: argument | → command name'], src);
          assert.deepStrictEqual(lines(src, 'ja', skip).filter((l) => l.startsWith('rm:')), ['rm: 引数 | → コマンド名'], src);
        }
        assert.deepStrictEqual(lines('xargs rm').filter((l) => l.startsWith('rm:')), ['rm: argument | → command name · xargs reads it']);
      });

      it('draws no chip on a token inside a language: the word\'s row says the language, and the colours stay', () => {
        const table: [string, string[]][] = [
          ['date +%F', ['+%F: argument | → operand | → date format · date reads it', '+: -', '%F: -']],
          ["printf 'a\\n'", ["'a\\n': argument | → operand | → printf format · printf reads it", 'a: -', '\\n: -']],
          ["grep -E '^([a-z]+)$' f", ["'^([a-z]+)$': argument | → operand | → regex · grep reads it", '^: -', '([a-z]+): -', '[a-z]: -', '+: -', '$: -', 'f: argument | → operand · grep reads it']],
          ["jq '.a' f", ["'.a': argument | → operand · jq reads it", '.a: jq filter', 'f: argument | → operand · jq reads it']],
          ['chmod u+x f', ['u+x: argument | → operand | → file mode · chmod reads it', 'f: argument | → operand · chmod reads it']],
          ['[[ a =~ ^b ]]', ['[[ a =~ ^b ]]: compound command', '[[: reserved word', 'a =~ ^b: expression', 'a: word', '=~: operator', '^b: word | → regex', '^: -', 'b: -', ']]: reserved word']],
        ];
        const skip = (l: string): boolean => !/^(date|printf|grep|jq|chmod): /.test(l);
        for (const [src, want] of table) assert.deepStrictEqual(lines(src).filter(skip).filter((l) => !/^(-E): /.test(l)), want, src);
        // (A token's colour is its own kind.)
        const row = all(rowModel(explain('date +%F'), D2, 'en').rows).find((r) => r.label === '%F')!;
        assert.strictEqual(row.kind, 'variable');
      });

      it('over the corpus, a name is a place: of the shell, of a command\'s reading, or a language', () => {
        const { files, snippets } = corpus();
        const { kinds, commandKinds } = ui.en.panel.tree;
        for (const { name, text } of [...files.filter((f) => f.name === 'sample.sh'), ...snippets.slice(0, 400)]) {
          const tree = parser.parse(text);
          text.split('\n').forEach((_, l) => {
            const ex = new Analyzer('en').explainLine(tree, l, 'bash', { reading: true, argv: true });
            for (const r of all(rowModel(ex, D2, 'en').rows)) {
              for (const role of r.roles) {
                const [layer, kind] = role.id.split(':');
                assert.ok(layer === 'language' ? kind === 'language' : kind in (layer === 'command' ? commandKinds : kinds), `${name}:${l + 1}: ${r.label}: ${role.id}`);
              }
            }
          });
        }
      });

      it('gives `[@]` and `[*]` a role where `[1]` has one: all the elements, no expression', () => {
        for (const [src, skip] of [['echo ${a[@]} ${a[*]} ${a[1]}', 0], ["eval 'echo ${a[@]} ${a[*]} ${a[1]}'", 6]] as const) {
          assert.deepStrictEqual(lines(src, 'en', skip).filter((l) => /^\[.\]:/.test(l)), ['[@]: subscript', '[*]: subscript', '[1]: expression'], src);
          assert.deepStrictEqual(lines(src, 'ja', skip).filter((l) => /^\[.\]:/.test(l)), ['[@]: 添字', '[*]: 添字', '[1]: 式'], src);
        }
        assert.strictEqual(opens('echo ${a[@]}', '[@]', 'subscript'), 'The subscript `@` or `*`: all the elements of the array, not one. It is no expression. (bash parses it)');
        assert.strictEqual(opens('echo ${a[@]}', '[@]', '添字', 'ja'), '添字 `@`・`*`: 配列の 1 つの要素ではなく、すべての要素。式ではない。（bash が解析する）');
        // (Where no text says it, as an element's key: a row of its own.)
        assert.deepStrictEqual(lines('declare -A m=([@]=x)').filter((l) => l.startsWith('@:')), ['@: subscript']);
      });

      it('says the redirection of a compound command on a later line, with its parts, from its first line', () => {
        const loop = 'while read -r line; do\n  echo\ndone < input.txt';
        const after = (src: string, lang: Lang = 'en') => lines(src, lang, 0, 0).slice(-3);
        assert.deepStrictEqual(after(loop), ['< input.txt: redirection', '<: operator', 'input.txt: word']);
        assert.deepStrictEqual(after(loop, 'ja'), ['< input.txt: リダイレクト', '<: 演算子', 'input.txt: 単語']);
        assert.deepStrictEqual(after('((\n1\n)) > out.txt'), ['> out.txt: redirection', '>: operator', 'out.txt: word']);
        assert.deepStrictEqual(after('{ a\n} > f'), ['> f: redirection', '>: operator', 'f: word']);
        // (On a line of its body, not; and on its last, as before.)
        assert.ok(!lines(loop, 'en', 0, 1).some((l) => l.includes('input.txt')));
        assert.deepStrictEqual(lines(loop, 'en', 0, 2), ['done: reserved word', '< input.txt: redirection', '<: operator', 'input.txt: word']);
      });

      it('says the name of a coprocess is a name, which bash does not expand', () => {
        assert.deepStrictEqual(lines('coproc foo { cat; }').slice(0, 3), ['coproc foo { ‹commands› }: coprocess', 'coproc: reserved word', 'foo: name']);
        assert.deepStrictEqual(lines('coproc foo { cat; }', 'ja').slice(0, 3), ['coproc foo { ‹commands› }: コプロセス', 'coproc: 予約語', 'foo: 名前']);
        assert.strictEqual(opens('coproc foo { cat; }', 'foo', 'name'), 'bash parses it');
        assert.strictEqual(opens('coproc foo { cat; }', 'foo', '名前', 'ja'), 'bash が解析する');
      });

      it('reads each line of a string on its own, with what spans lines once', () => {
        const src = "bash -c 'for i in 1; do\n echo $i\n\ndone > f # c\n'";
        assert.deepStrictEqual(lines(src, 'en', 9).slice(0, 2), ['for i in 1; do: compound command · new shell', 'for: reserved word']);
        const said = all(rowModel(explain(src), D2, 'en').rows);
        const line = (label: string) => said.find((r) => r.label === label)!;
        assert.deepStrictEqual(line('echo $i').roleLine!.chips.map((c) => c.text), ['simple command', 'command name']);
        assert.deepStrictEqual(said.filter((r) => r.label === '> f').map((r) => r.roleLine!.chips.map((c) => c.text)), [['redirection'], ['redirection']]);
        assert.deepStrictEqual(line('# c').roleLine!.chips.map((c) => c.text), ['comment']);
        // (A line of a string has no place of its own: its row says which, and its parts their roles.)
        assert.strictEqual(line('done > f # c').roleLine, undefined);
        // (Parts on a later line that no reading of that line starts with: `c`, in a list that started on the first.)
        const list = lines("bash -c '{ a \"\n  b\"; c; }\n'", 'en', 9);
        assert.ok(list.includes('c: simple command | command name'), list.join('\n'));
        // (A second token of a line, `# c`, has its node from the first's.)
        assert.deepStrictEqual(lines("bash -c 'a # c'", 'en', 9), ['a: simple command | command name · new shell', '# c: comment · new shell']);
      });

      it('has the string\'s reading in a statement over several lines, whichever asks for it first', () => {
        const src = "bash -c 'ls' \\\n  x";
        const analyzer = new Analyzer('en');
        const tree = parser.parse(src);
        analyzer.explainLine(tree, 0, 'bash', { reading: false });
        const ex = analyzer.explainLine(tree, 0, 'bash', { reading: true, argv: true });
        assert.deepStrictEqual(all(rowModel(ex, D2, 'en').rows).find((r) => r.label === 'ls')!.roleLine!.chips.map((c) => c.text), ['simple command', 'command name']);
        // (The other way round, the tokens of a line that does not ask have none.)
        const lean = new Analyzer('en').explainLine(parser.parse("bash -c 'ls'"), 0, 'bash', { reading: false });
        assert.ok(tokens(lean.items).every((t) => t.reading === undefined));
      });
    });

    it('copies the same at both depths: the Markdown does not read the reading tree', () => {
      for (const src of ['x=notes.txt', 'grep -q "$a" f | sort', 'time -p ls | wc', 'cat <<E\nhi\nE']) {
        const line = src.split('\n')[0];
        const lean = new Analyzer('en').explainLine(parser.parse(src), 0, 'bash', { reading: false, argv: true });
        assert.strictEqual(toPlainMarkdown(explain(src), line, 'a.sh:1', 'en'), toPlainMarkdown(lean, line, 'a.sh:1', 'en'), src);
      }
    });

    it('says who reads a row last, on the table of roles', () => {
      for (const [src, label, , , reader] of ROLES) {
        if (reader === '') continue;
        assert.strictEqual(all(rowModel(explain(src), D2, 'en').rows).find((x) => x.label === label)!.roleLine?.reader, reader, `${src}: ${label}`);
      }
    });

    it('opens a name to what it is and who reads it; what a command or a language reads has no text of bash\'s', () => {
      const said = (src: string, label: string) => row(src, label).roleLine!.chips.map((c) => c.said);
      assert.deepStrictEqual(said('grep -q x f', '-q'), ['An argument: bash expands it and passes its fields to the command. (bash parses it)', 'grep reads it, not bash']);
      assert.match(said('x=a', 'a')[0], /^The value of an assignment: .*no word splitting or globbing/);
      assert.match(said('cat <<E\nhi\nE', '<<E')[1], /^The body of the here-document/);
      // (In Japanese, who reads it in full-width parentheses.)
      assert.match(row('x=a', 'a', 'ja').roleLine!.chips[0].said, /。（bash が解析する）$/);
      // (The ids are the same in both languages.)
      assert.deepStrictEqual(row('x=a', 'a', 'ja').roleLine!.chips.map((c) => c.id), row('x=a', 'a').roleLine!.chips.map((c) => c.id));
    });

    // Who reads a word: "not bash" only of a program that is not this shell. A builtin or a function is the shell (what the name resolves to, not a list of names).
    const PROGRAM = (name: string) => [`${name} reads it, not bash`, `bash ではなく ${name} が読む`];
    const IN_SHELL = (name: string) => [`${name} reads it, inside the shell`, `シェルの中で ${name} が読む`];
    const NEW_BASH = ['a new bash reads it, not this shell', 'このシェルではなく、新しく起動した bash が読む'];
    for (const [src, label, [en, ja]] of [
      ['grep -n x f', '-n', PROGRAM('grep')],
      ['sudo ls -l', 'ls', PROGRAM('sudo')],
      ['sudo echo -n x', '-n', PROGRAM('echo')],
      ['sudo cd /x', '/x', PROGRAM('cd')],
      ['sh -c \'x\'', '-c', PROGRAM('sh')],
      ['/usr/bin/[ -f x ]', '-f x', PROGRAM('/usr/bin/[')],
      ['enable -n echo\necho -n x', '-n', PROGRAM('echo')],
      ['shopt -s expand_aliases\nalias g=grep\ng -n x', '-n', PROGRAM('grep')],
      ['bash -c \'x\'', '-c', NEW_BASH],
      ['bash -c \'x\'', '\'x\'', NEW_BASH],
      ['/bin/bash -c \'x\'', '-c', NEW_BASH],
      ['sudo bash -c \'x\'', '-c', NEW_BASH],
      ['exec bash -c \'x\'', '-c', NEW_BASH],
      ['#!/bin/bash -x', '-x', NEW_BASH],
      ['eval \'x\'', '\'x\'', IN_SHELL('eval')],
      ['trap \'x\' EXIT', '\'x\'', IN_SHELL('trap')],
      ['trap \'x\' EXIT', 'EXIT', IN_SHELL('trap')],
      ['exec bash -c \'x\'', 'bash', IN_SHELL('exec')],
      ['command ls -l', 'ls', IN_SHELL('command')],
      ['command ls -l', '-l', PROGRAM('ls')],
      ['builtin echo -n x', '-n', IN_SHELL('echo')],
      ['echo -n x | cat', '-n', IN_SHELL('echo')],
      ['[ -f x ]', '-f x', IN_SHELL('[')],
      ['f() { :; }; f -x', '-x', IN_SHELL('f')],
      ['bash() { :; }; bash -c x', '-c', IN_SHELL('bash')],
      ['shopt -s expand_aliases\nalias a=eval\na x', 'x', IN_SHELL('eval')],
      ['shopt -s expand_aliases\nf() { :; }\nalias a=f\na -x', '-x', IN_SHELL('f')],
    ] as const) {
      it(`says who reads ${label} of ${JSON.stringify(src)}: ${en}`, () => {
        const line = src.split('\n').length - 1;
        for (const [lang, text] of [['en', en], ['ja', ja]] as const) assert.strictEqual(row(src, label, lang, line).roleLine!.chips.at(-1)!.said, text, lang);
      });
    }

    it('gives the whole line its role, which no row stands for, at depth 2 with the reading tree only', () => {
      for (const [lang, name, about] of [['en', 'bash reads the line', /^bash splits the line into commands/], ['ja', 'bash がこの行を読む', /^bash はこの行をコマンドに分け/]] as const) {
        const chip = model('a; b', D2, lang).line!.chips[0];
        assert.strictEqual(chip.text, name);
        assert.match(chip.said, about);
      }
      assert.strictEqual(model('a; b').line, undefined);
      assert.strictEqual(rowModel({ ...explain('a'), reading: undefined }, D2, 'en').line, undefined);
      assert.strictEqual(rowModel({ ...explain('a'), items: [] }, D2, 'en').line, undefined);
    });

    it('keeps the section of what has no row of its own, on the row around it', () => {
      const refs = (src: string, label: string) => { const r = row(src, label); return [...r.refs ?? [], ...r.roleLine?.refs ?? []]; };
      assert.ok(refs("git log --format='%h %s'", "--format='%h %s'").includes('3.1.2.2'));
      assert.ok(refs('echo ${items[1]}', '[1]').includes('6.5'));
      assert.ok(refs('a; b', ';').includes('3.2.4') || refs('a; b', 'a; b').includes('3.2.4'));
      assert.ok(refs('cut -d"," -f2 f', '-d","').includes('3.1.2.3'));
      // (A piece of a word has no role line: its section is beside its text.)
      assert.ok((row('echo "a"b', '"a"').refs ?? []).includes('3.1.2.3'));
    });

    it('says a text of the catalog once on a line: the same message with another name in it', () => {
      const more = (src: string) => all(rowModel(explain(src), D2, 'en').rows).flatMap((r) => r.more.map((m) => m.map((p) => p.text).join('')));
      assert.strictEqual(more('a >x | b >y').filter((t) => t.startsWith('Redirection applied to')).length, 1);
      assert.strictEqual(more('echo $e $f $g').filter((t) => t.startsWith('Expands to the value of')).length, 1);
      // (A warning stays on each.)
      const warned = all(rowModel(explain('rm -rf $a $b'), D2, 'en').rows).flatMap((r) => r.more).filter((m) => m.some((p) => p.level));
      assert.deepStrictEqual(warned.length, all(rowModel(explain('rm -rf $a $b'), D1, 'en').rows).flatMap((r) => r.more).filter((m) => m.some((p) => p.level)).length);
    });

    it('gives a list and its first command, of one range, each its own roles', () => {
      const [group, cat] = rows('cat <<E | sort\nE');
      assert.deepStrictEqual(group.roles.map((r) => r.id), ['bash:pipeline']);
      assert.deepStrictEqual(cat.roles.map((r) => r.id), ['bash:command', 'bash:commandName']);
    });

    it('says a text of the tree that no token of the range says, in `more`, and a folded text once on the line', () => {
      assert.ok(said(row('[[ $a == b ]]', '$a')).includes('The string on the left of `==`'));
      // (The double quotes' text: on the first of the two words.)
      const words = rows('echo "x" "y"').filter((r) => r.label === '"x"' || r.label === '"y"');
      assert.deepStrictEqual(words.map((r) => r.more.length), [1, 0]);
    });

    it('holds at depth 1 what a folded token says of what the command or the language reads, and what bash reads at depth 2', () => {
      // The awk idiom changes what the line means: at depth 1 too.
      const rule = rows("awk '!seen[$0]++' f", D1).find((r) => r.label === '!seen[$0]++')!;
      assert.match(said(rule).join(' '), /classic dedupe idiom/);
      // What braces and a tilde make of a word, too; what quotes do, at depth 2.
      assert.match(said(rows('mkdir a/{b,c}', D1)[1]).join(' '), /expands to 2 words/);
      assert.match(said(rows('ls ~/a', D1)[1]).join(' '), /Tilde expansion/);
      assert.deepStrictEqual(rows('ls "a"', D1)[1].more, []);
      assert.deepStrictEqual(rows('rm $d/x', D1)[1].more, [], 'how bash joins the parts of a word, at depth 2');
      assert.deepStrictEqual(rows('tr a-z A-Z', D1)[1].more, [], 'a text that only repeats its code, at depth 2');
      assert.match(said(rows('rm $d/x')[1]).join(' '), /Concatenation/);
      assert.deepStrictEqual(rows('tar x 2>/dev/null', D1)[0].more, [], 'the redirection around a command, at depth 2');
    });

    it('judges the rows of an expansion and of a value: what changes the word at depth 1, what only reads it at depth 2', () => {
      const labels = (src: string) => rows(src, D1).map((r) => r.label);
      // (`${s:$i:2}` says what it takes, with or without an example; `s` says only that it is a variable.)
      assert.deepStrictEqual(labels('echo "${s:$i:2}"'), ['echo', '"${s:$i:2}"', '${s:$i:2}']);
      assert.ok(rows('echo "${HOME:-x}"', D1).some((r) => r.label === 'HOME'), 'a variable with a meaning of its own stays');
      // (A value that is only its text is in the code of the assignment, whatever its kind.)
      assert.deepStrictEqual(labels('x=notes.txt'), ['x=notes.txt']);
      assert.deepStrictEqual(labels('a=1'), ['a=1']);
      assert.deepStrictEqual(rows('x=notes.txt').map((r) => r.label), ['x=notes.txt', 'x', '=', 'notes.txt']);
      // (One with something to say keeps its row.)
      assert.deepStrictEqual(labels('x=*.txt'), ['x=*.txt', '*.txt']);
    });

    it('says what `time` with no pipeline does on the row of the whole, and only the word on its own row', () => {
      const [whole, word] = rows('time >o');
      assert.match(whole.text, /with no pipeline/);
      assert.strictEqual(word.text, 'The reserved word `time`');
      assert.deepStrictEqual(whole.more, []);
      assert.strictEqual(row('time >o', '>o', 'ja').comesAt, 1);
    });

    it('draws a pipe as a connector: what goes from the command before it to the one after, in words, once', () => {
      const pipes = (src: string, lang: Lang = 'en') => rows(src, D2, lang).filter((r) => r.connector);
      assert.deepStrictEqual(pipes('a -x | b | c').map((r) => r.text), ['stdout of `a` → stdin of `b`', 'stdout of `b` → stdin of `c`']);
      assert.deepStrictEqual(pipes('a |& b').map((r) => r.text), ['stdout and stderr of `a` → stdin of `b`']);
      assert.deepStrictEqual(pipes('a | b', 'ja').map((r) => r.text), ['`a` の標準出力 → `b` の標準入力']);
      assert.deepStrictEqual(pipes('a | b')[0].parts, [{ text: 'stdout of `a` → stdin of `b`' }]);
      assert.deepStrictEqual(pipes('a | b')[0].more, []);
      // (Only between two commands of a pipeline: not `&&`, and none at depth 1.)
      assert.deepStrictEqual(pipes('a && b'), []);
      assert.deepStrictEqual(rows('a | b', D1).filter((r) => r.connector), []);
      // (A warning on it stays what it says: none reaches the model on a pipe today, so the row is built to show one.)
      const marked = rowsWith('a | b', (t) => { if (t.label === '|') t.marks = [{ id: 'x', level: 'warning', text: 'bad' } as never]; });
      assert.deepStrictEqual(marked.filter((r) => r.connector), []);
      // (With no command on one side, it says what it says.)
      const lone = (cut: (c: Token[]) => void) => rowsWith('a | b', (t) => { if (t.grammar) cut(t.children); }).filter((r) => r.label === '|');
      assert.deepStrictEqual(lone((c) => c.shift()).map((r) => r.connector), [undefined]);
      assert.deepStrictEqual(lone((c) => c.pop()).map((r) => r.connector), [undefined]);
    });

    it('gives a word bash changes its steps in bash\'s order, on the row of the word; none to a plain word', () => {
      const line = (src: string, label: string) => row(src, label).steps;
      const text = (src: string, label: string) => line(src, label)!.steps.map((s) => (s.off ? `${s.text}${s.why}` : s.text));
      assert.deepStrictEqual(text('echo "$a"', '"$a"'), ['parameter expansion', 'no word splitting or globbing (quoted)', 'quote removal']);
      assert.deepStrictEqual(text('echo $a', '$a'), ['parameter expansion', 'word splitting', 'globbing']);
      assert.deepStrictEqual(text('echo *.txt', '*.txt'), ['globbing']);
      assert.deepStrictEqual(text('echo ~/a', '~/a'), ['tilde expansion']);
      assert.deepStrictEqual(text('echo {a,b}', '{a,b}'), ['brace expansion']);
      assert.deepStrictEqual(text('echo $(a)', '$(a)'), ['command substitution', 'word splitting', 'globbing']);
      assert.deepStrictEqual(text('echo $((1+2))', '$((1+2))'), ['arithmetic expansion', 'word splitting', 'globbing']);
      assert.deepStrictEqual(text('cat <(a)', '<(a)'), ['process substitution']);
      assert.strictEqual(line('set -f; echo *', '*')!.acts, false);
      assert.ok(text('set -f; echo *', '*').includes('no globbing (`set -f`)'));
      assert.deepStrictEqual(text('x=$a', 'x=$a'), ['parameter expansion', 'no word splitting or globbing (not in an assignment)']);
      assert.deepStrictEqual(text('[[ $a == b ]]', '$a'), ['parameter expansion', 'no word splitting or globbing (not in `[[ ]]`)']);
      assert.strictEqual(line('echo a', 'a'), undefined);
      assert.strictEqual(line('x=a', 'x=a'), undefined);
      assert.strictEqual(line('tar -c', '-c'), undefined);
      assert.strictEqual(rows('echo "$a"', D1)[1].steps, undefined);
      assert.strictEqual(line('echo "$a"', '"$a"')!.acts, true);
    });

    it('folds the steps of a word where none acts: the line says so, and opens on every step with why', () => {
      const fold = row('echo "a"', '"a"').steps!;
      assert.strictEqual(fold.acts, false);
      assert.strictEqual(fold.summary, 'nothing expands');
      assert.strictEqual(fold.lead, "bash's steps:");
      assert.deepStrictEqual(fold.steps.map((s) => [s.text, s.off, s.why]), [
        ['no brace expansion, tilde expansion, parameter expansion, command substitution, arithmetic expansion, process substitution, word splitting or globbing', true, undefined],
        ['quote removal', false, undefined],
      ]);
      assert.strictEqual(row('echo "a"', '"a"', 'ja').steps!.steps[0].text, 'ブレース展開・チルダ展開・パラメータ展開・コマンド置換・算術展開・プロセス置換・単語分割・グロブはしない');
      // (In Japanese, the reason in full-width parentheses: docs/japanese-style.md.)
      assert.deepStrictEqual(row('echo "$a"', '"$a"', 'ja').steps!.steps[1], { text: '単語分割・グロブはしない', off: true, why: '（クォート内）' });
      assert.strictEqual(row('echo "a"', '"a"', 'ja').steps!.summary, '展開はなし');
      // "maybe": a step known only when the line runs.
      const unknown = stepsLine([{ kind: 'split', applies: 'unknown', manual: '3.5.7' }], 'argument', 'en');
      assert.deepStrictEqual(unknown.steps, [{ text: 'word splitting (maybe)', off: false }]);
      assert.deepStrictEqual(stepsLine([{ kind: 'split', applies: false, why: 'context', manual: '3.5.7' }], 'other', 'en').steps.map((s) => s.why), [' (not done here)']);
    });

    it('starts folded a row whose parts all come at depth 2, and never one that holds a row of depth 1', () => {
      assert.strictEqual(row('a 2>/dev/null', '2>/dev/null').folded, true);
      assert.strictEqual(row('ls *.txt', '*.txt').folded, true);
      // (A glob's folded example keeps its title; an open one would be hidden, so its row stays open.)
      assert.strictEqual(all(rowModel(placeExamples(explain('ls /var/log/*.log')), D2, 'en').rows).find((r) => r.label === '/var/log/*.log')!.folded, true);
      const open = rowsWith('ls a*', (t) => { if (t.label === 'a*') t.examples = [{ kind: 'expansion', title: 'x', target: '', sections: [] }]; }).find((r) => r.label === 'a*')!;
      assert.strictEqual(open.folded, undefined);
      assert.strictEqual(row('a "$USER"', '"$USER"').folded, undefined);
      assert.strictEqual(row('backup="${HOME}/b"', 'backup="${HOME}/b"').folded, undefined);
      assert.strictEqual(row('if a; then b; fi', 'if ‹condition› then ‹commands› fi').folded, undefined);
    });

    it('folds a glob\'s example under its title, at both depths; others stay open', () => {
      const ex = (src: string, depth: 1 | 2) => all(rowModel(placeExamples(explain(src)), { depth, receives: false }, 'en').rows).flatMap((r) => r.examples ?? []);
      for (const depth of [1, 2] as const) assert.deepStrictEqual(ex('ls /var/log/*.log', depth).map((e) => [e.kind, e.folded]), [['glob', true]]);
      assert.ok(ex("sed 's/a/b/' f", 2).every((e) => e.kind !== 'glob' && !e.folded));
    });

    it('over the corpus: depth 2 only adds, holds every text of the line, has a row for each reserved word and operator on the line, roles from places only; nothing of depth 1 is folded away', function () {
      this.timeout(300000);
      const { files, snippets } = corpus();
      for (const { name, text } of [...files, ...snippets]) {
        const tree = parser.parse(text);
        const lines = text.split('\n');
        const analyzer = new Analyzer('en');
        for (let line = 0; line < lines.length; line++) {
          if (!lines[line].trim()) continue;
          const at = `${name}, line ${line + 1}: ${lines[line].slice(0, 50)}`;
          const ex = analyzer.explainLine(tree, line, 'bash', { reading: true, argv: true });
          const two = all(rowModel(ex, D2, 'en').rows);
          const one = all(rowModel(ex, D1, 'en').rows);
          // Only adds, in the same order, saying the same.
          const keys = new Map(two.map((r) => [r.key, r]));
          assert.deepStrictEqual(one.map((r) => r.key), two.filter((r) => one.some((o) => o.key === r.key)).map((r) => r.key), at);
          for (const r of one) assert.strictEqual(keys.get(r.key)!.connector ? undefined : keys.get(r.key)!.text, r.text, at);
          // Every row of depth 1 is outside any row that starts folded.
          const inFold = (rs: readonly ModelRow[], folded: boolean): ModelRow[] => rs.flatMap((r) => [...(folded ? [r] : []), ...inFold(r.children, folded || !!r.folded)]);
          assert.deepStrictEqual(inFold(rowModel(ex, D2, 'en').rows, false).filter((r) => r.comesAt === 1).map((r) => r.label), [], at);
          // Every text of a token on the line is said (a pipe's says it in words of its own).
          const said = new Set(two.flatMap((r) => [r.text, ...r.more.map((m) => m.map((p) => p.text).join(''))]));
          const plainOf = (t: Token) => markedText(t);
          for (const t of tokens(ex.items)) {
            if (two.some((r) => r.connector && sameSpan(r.span, t.span))) continue;
            // (Or the same message of the catalog, said once on the line, with another name.)
            const again = !!t.texts?.length && !t.marks?.length && tokens(ex.items).some((o) => o !== t && o.texts?.join(' ') === t.texts!.join(' ') && said.has(plainOf(o)));
            assert.ok(again || said.has(plainOf(t)) || [...said].some((x) => x.includes(textParts(t).map((p) => p.text).join(''))), `${at}: "${plainOf(t)}" of ${t.label}`);
          }
          // A role comes from a place: a row of bash's grammar has its own, one on a list's range is that list, and a row with none is a piece.
          for (const r of two) {
            if (r.frame === 'group') assert.ok(r.roleLine?.chips.length, `${at}: ${r.label}`);
            assert.ok(!r.roles.some((x) => x.id.startsWith('token:')), `${at}: ${r.label}`);
          }
          // A row for each reserved word and operator of the tree on the lines shown, unless a row around it speaks for it.
          const shownLines = new Set(tokens(ex.items).map((t) => t.span.start.line));
          for (const n of ex.reading ? readingNodes(ex.reading) : []) {
            if ((n.kind === 'keyword' || n.kind === 'operator') && shownLines.has(n.span.start.line) && !(n.layer === 'language')) {
              assert.ok(two.some((r) => within(r.span, n.span)), `${at}: ${n.kind} ${n.label}`);
              if (n.text === undefined) assert.ok(two.some((r) => sameSpan(r.span, n.span)), `${at}: the row of ${n.kind} ${n.label}`);
            }
          }
        }
      }
    });
  });

  describe('the roles', () => {
    it('says each row\'s roles at depth 2, with the same ids in both languages', () => {
      const src = 'tar -czf "$out" ~/docs';
      const roles = (lang: Lang) => all(model(src, D2, lang).rows).map((r) => [r.label, r.roles.map((x) => x.id)]);
      assert.deepStrictEqual(roles('en'), [
        ['tar', ['bash:command', 'bash:commandName']],
        ['-czf', ['bash:argument', 'command:option']],
        ['-c', ['command:option']], ['-z', ['command:option']], ['-f', ['command:option']],
        ['"$out"', ['bash:argument', 'command:argument:value:-f']],
        ['$out', ['bash:expansion']],
        ['~/docs', ['bash:argument', 'command:argument']],
      ]);
      assert.deepStrictEqual(roles('ja'), roles('en'));
      const value = all(model(src, D2).rows).find((r) => r.label === '"$out"')!;
      assert.deepStrictEqual(value.roles.map((x) => x.chip), ['argument', 'value of -f']);
      assert.match(value.roles[0].said, /\(bash parses it\)$/);
      assert.strictEqual(value.roles[1].said, 'tar reads it, not bash');
      assert.deepStrictEqual(value.roles.map((x) => x.band), [undefined, 'tar reads it']);
      assert.strictEqual(all(model(src, D2, 'ja').rows).find((r) => r.label === '"$out"')!.roles[1].chip, '-f の値');
      assert.deepStrictEqual(all(model(src).rows).flatMap((r) => r.roles), []);
    });

    it('has no roles without the reading tree, and the same keys and roles in both languages over the corpus', function () {
      this.timeout(120000);
      const { reading: _, ...lean } = explain('ls');
      assert.deepStrictEqual(all(rowModel(lean, D2, 'en').rows).flatMap((r) => r.roles), []);
      for (const { text } of corpus().snippets.slice(0, 600)) {
        const shape = (lang: Lang) => all(model(text, { depth: 2, receives: true }, lang).rows).map((r) => [r.key, r.frame, r.comesAt, r.received, r.roles.map((x) => x.id)]);
        assert.deepStrictEqual(shape('ja'), shape('en'), text);
      }
    });

    it('colours a node of bash\'s reading from the one table of kinds', () => {
      assert.deepStrictEqual(['commandName', 'quote', 'option'].map((kind) => roleOf({ kind })), ['command', 'string', 'option']);
    });
  });

  describe('what the program receives', () => {
    const on: RowOptions = { depth: 1, receives: true };

    it('puts what a program receives on its command, and says of each word if it comes as written, with the switch on', () => {
      const rows = all(model('grep -h "$USER" f 2>/dev/null', on).rows);
      const cmd = rows.find((r) => r.label === 'grep')!;
      assert.deepStrictEqual(cmd.receives!.chips.length, 4);
      assert.strictEqual(cmd.receives!.lead, 'receives:');
      assert.deepStrictEqual(rows.slice(1).map((r) => [r.label, r.received]), [['-h', 'asWritten'], ['"$USER"', 'changed'], ['$USER', undefined], ['f', 'asWritten'], ['2>/dev/null', undefined]]);
      assert.strictEqual(cmd.received, 'asWritten', 'a program gets its name as its first word');
    });

    it('says nothing of it with the switch off', () => {
      for (const r of all(model('grep -h x').rows)) assert.deepStrictEqual([r.receives, r.received], [undefined, undefined]);
      const { argv: _, ...lean } = explain('ls');
      assert.strictEqual(rowModel(lean, on, 'en').rows[0].receives, undefined);
    });
  });

  describe('the Key', () => {
    const key = (src: string, options: RowOptions = D1, lang: Lang = 'en') => model(src, options, lang).key;
    const ids = (src: string, options?: RowOptions) => key(src, options).map((k) => k.id);

    it('lists what is drawn, and only that', () => {
      assert.deepStrictEqual(ids('sort f'), ['frame:command', 'name:program', 'role:command', 'role:argument']);
      assert.deepStrictEqual(ids('echo a'), ['frame:command', 'name:builtin', 'role:builtin', 'role:argument', 'ref']);
      assert.ok(ids('a | b').includes('frame:group'));
      assert.ok(ids('[[ -f a ]]').includes('frame:compound'));
      assert.ok(ids('sort f', D2).includes('roleLine'));
      assert.ok(!ids('sort f').includes('roleLine'));
    });

    it('gives a level\'s mark and what it means, from the level table', () => {
      const [first] = key('echo $((09))');
      assert.deepStrictEqual(first, { id: 'level:error', sample: 'ⓧ', text: 'Error: fails every time it runs' });
      assert.deepStrictEqual(key('echo $((09))', D1, 'ja')[0], { id: 'level:error', sample: 'ⓧ', text: 'エラー: 実行するたびに失敗する' });
      // (And those of the notes of the line.)
      assert.ok(ids('rm $x').includes('level:warning'), ids('rm $x').join());
    });

    it('gives a badge its word and a chip its label', () => {
      assert.strictEqual(key('sort f').find((k) => k.id === 'name:program')!.sample, 'program');
      assert.strictEqual(key('sort f', D1, 'ja').find((k) => k.id === 'name:program')!.sample, 'プログラム');
      assert.strictEqual(key('BASH_XTRACEFD=7').find((k) => k.id === 'basis')!.sample, 'Differs from the manual · checked with bash 5.2 and 5.3');
      assert.strictEqual(key('ls').find((k) => k.id === 'basis'), undefined);
    });

    it('lists what the switch draws', () => {
      const on: RowOptions = { depth: 1, receives: true };
      assert.deepStrictEqual(ids('sort -r', on).filter((k) => k.startsWith('received')), ['received:asWritten']);
      assert.deepStrictEqual(ids('sort "$x"', on).filter((k) => k.startsWith('received')), ['received:asWritten', 'received:changed', 'received:hole']);
      assert.ok(ids('sort *.txt', on).includes('received:many'), ids('sort *.txt', on).join());
      assert.deepStrictEqual(ids('sort "$x"').filter((k) => k.startsWith('received')), []);
    });

    it('has the same entries in both languages, and each a text', function () {
      this.timeout(120000);
      for (const { text } of corpus().snippets.slice(0, 300)) {
        const en = key(text, { depth: 2, receives: true });
        assert.deepStrictEqual(key(text, { depth: 2, receives: true }, 'ja').map((k) => k.id), en.map((k) => k.id), text);
        for (const k of en) assert.ok(k.text, k.id);
      }
    });
  });

  describe('the levels of what tokens warn of', () => {
    const levelOf = (id: keyof typeof TOKEN_TEXTS) => (TOKEN_TEXTS[id] as { level?: string }).level;

    it('marks what fails every time it runs as an error (docs/design/three-levels.md, section 2)', () => {
      for (const [src, id] of [['echo $((09))', 'arith-invalid-number'], ["env -S'\"a' s", 'splice-refused'], ['#!/usr/bin/env bash -e', 'shebang-env-one-argument'], ['#!/usr/bin/env -S"a', 'shebang-env-string-refused'], ['#!/usr/bin/env', 'shebang-env-loop']] as const) {
        const row = all(rowModel(explain(src), D1, 'en').rows).find((r) => r.marks?.some((m) => m.id === id));
        assert.strictEqual(row?.level, 'error', src);
        assert.ok(row!.text.includes('ⓧ'), row!.text);
        assert.strictEqual(levelOf(id), 'error');
      }
      // ("Mostly": it depends on a file there, or on the options.)
      assert.strictEqual(levelOf('shebang-relative-interpreter'), 'warning');
      assert.strictEqual(levelOf('shebang-env-reads-options'), 'warning');
      // (terraform is not here to run, and it may let `-foo -version` pass.)
      assert.strictEqual(all(model('terraform -foo plan').rows).find((r) => r.marks)?.level, 'warning');
      assert.ok(!all(model('terraform -install-autocomplete').rows).some((r) => r.marks));
      assert.ok(!all(model('terraform -uninstall-autocomplete').rows).some((r) => r.marks));
      // (The arithmetic that the shell may never read: test/arith-shells.test.ts runs them.)
      assert.strictEqual(all(model('echo ${x:-$((09))}').rows).find((r) => r.marks)?.level, 'warning');
    });

    it('checks them against the real tools: each fails, and what follows it on the same line or the next is as they say', function () {
      this.timeout(20000);
      // (The rest of the line does not run; a script goes on at the next line, but in POSIX mode: test/arith-shells.test.ts has the rest.)
      const arith = (...args: string[]) => spawnSync('bash', [...args, '-c', 'echo $((09)); echo same'], { encoding: 'utf8' });
      assert.deepStrictEqual([arith().status, arith().stdout], [1, '']);
      const script = fs.mkdtempSync(path.join(os.tmpdir(), 'arith-'));
      const file = path.join(script, 's');
      fs.writeFileSync(file, 'echo $((09)); echo same\necho next\n');
      const bash = (...args: string[]) => spawnSync('bash', [...args, file], { encoding: 'utf8' });
      assert.deepStrictEqual([bash().status, bash().stdout], [0, 'next\n']);
      assert.deepStrictEqual([bash('--posix').status, bash('--posix').stdout], [1, '']);
      fs.rmSync(file);
      fs.rmdirSync(script);
      assert.strictEqual(spawnSync('env', ['-S"a', 's']).status, 125);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shebang-'));
      const run = (name: string, line: string) => {
        const file = path.join(dir, name);
        fs.writeFileSync(file, `${line}\necho it-ran\n`, { mode: 0o755 });
        return spawnSync(file, [], { encoding: 'utf8', timeout: 500, killSignal: 'SIGKILL' });
      };
      try {
        const one = run('a', '#!/usr/bin/env bash -e');
        assert.deepStrictEqual([one.status, one.stdout], [127, '']);
        const refused = run('b', '#!/usr/bin/env -S"a');
        assert.deepStrictEqual([refused.status, refused.stdout], [125, '']);
        // (It starts itself again without end, until it is killed.)
        const loop = run('c', '#!/usr/bin/env');
        assert.deepStrictEqual([loop.signal, loop.stdout], ['SIGKILL', '']);
      } finally {
        for (const name of ['a', 'b', 'c']) fs.rmSync(path.join(dir, name), { force: true });
        fs.rmdirSync(dir);
      }
    });
  });

  describe('the marks in a text', () => {
    const tok = (explanation: string, marks: Token['marks']) => ({ explanation, marks });

    it('cuts a text at its warnings, each with its level', () => {
      assert.deepStrictEqual(textParts(tok('plain', undefined)), [{ text: 'plain' }]);
      const two = tok('a bad and worse end', [{ id: 'splice-refused', level: 'warning', text: 'bad' }, { id: 'arith-invalid-number', level: 'error', text: 'worse' }]);
      assert.deepStrictEqual(textParts(two), [{ text: 'a ' }, { text: 'bad', level: 'warning' }, { text: ' and ' }, { text: 'worse', level: 'error' }, { text: ' end' }]);
      assert.strictEqual(markedText(two), 'a ⚠ bad and ⓧ worse end');
      assert.deepStrictEqual(textParts(tok('all', [{ id: 'splice-refused', level: 'warning', text: 'all' }])), [{ text: 'all', level: 'warning' }]);
      // (A warning whose text is no longer there has no mark.)
      assert.deepStrictEqual(textParts(tok('other', [{ id: 'splice-refused', level: 'warning', text: 'bad' }])), [{ text: 'other' }]);
    });

    it('gives the parts on the record, the warning on its own', () => {
      const row = all(model('echo $((09))').rows).find((r) => r.marks)!;
      assert.deepStrictEqual(row.parts.map((p) => p.level), ['error']);
    });
  });
});

/** A token, as a test makes one. */
function token(kind: Token['kind'], label: string, explanation: string, children: Token[] = []): Token {
  return { kind, role: 'argument', label, explanation, span: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, children };
}
