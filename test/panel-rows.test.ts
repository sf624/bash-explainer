import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import type { LineExplanation, Token } from '../src/analyzer-types';
import type { Lang } from '../src/i18n';
import { keyOf } from '../src/reading';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { TOKEN_TEXTS } from '../src/messages-tokens';
import { markedText, textParts } from '../src/tokenmarks';
import { type ModelRow, type RowOptions, rowModel } from '../src/ui/panelRows';
import { roleOf } from '../src/ui/readingSteps';
import { placeExamples } from '../src/ui/render';
import { corpus } from './support/corpus';

// The panel's row model (docs/design/panel-redesign.md, P7a): which rows a line has at each depth, a box around each command, the roles,
// what a program receives, and the Key. The model is a pure function of the explanation; nothing draws it yet (P7c does).

const parser = createUnbashParser();
const explain = (src: string, line = 0, lang: Lang = 'en'): LineExplanation => new Analyzer(lang).explainLine(parser.parse(src), line, 'bash', { reading: true, argv: true });
const all = (rows: readonly ModelRow[]): ModelRow[] => rows.flatMap((r) => [r, ...all(r.children)]);
const tokens = (ts: readonly Token[]): Token[] => ts.flatMap((t) => [t, ...tokens(t.children)]);
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

    it('explains what bash expands in an option\'s attached value: a command runs there', () => {
      const commands = (src: string) => all(model(src, { depth: 2, receives: true }).rows).filter((r) => r.receives).map((r) => r.label);
      assert.deepStrictEqual(commands('make -j"$(nproc)" build'), ['make', 'nproc']);
      assert.deepStrictEqual(commands('make -j$(nproc)'), ['make', 'nproc']);
      const value = all(model('sort -k$n,$n f', D2).rows).find((r) => r.label === '$n,$n')!;
      assert.deepStrictEqual(value.children.map((c) => c.label), ['$n', ',', '$n']);
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
      // (A redirection alone stays one.)
      assert.deepStrictEqual(outline(model('>o').rows), ['>o']);
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
            assert.strictEqual(rows.filter((r) => r.receives === l).length, 1, `${name}: ${source}: ${keyOf(l.span)}`);
          }
          for (const r of rows) if (r.receives) assert.strictEqual(r.frame, 'command', source);
        });
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
      assert.deepStrictEqual(value.roles.map((x) => x.readBy), ['bash parses it', 'tar reads it, not bash']);
      assert.deepStrictEqual(value.roles.map((x) => x.band), [undefined, 'tar reads']);
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
      assert.deepStrictEqual(cmd.receives!.words.length, 4);
      assert.deepStrictEqual(cmd.receives!.removed.map((x) => x.text), ['2>/dev/null']);
      assert.deepStrictEqual(rows.slice(1).map((r) => [r.label, r.received]), [['-h', 'asWritten'], ['"$USER"', 'changed'], ['$USER', undefined], ['f', 'asWritten'], ['2>/dev/null', undefined]]);
      assert.strictEqual(cmd.received, undefined);
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
      assert.deepStrictEqual(first, { id: 'level:error', sample: 'ⓧ', text: 'Error: fails every time as written' });
      assert.deepStrictEqual(key('echo $((09))', D1, 'ja')[0], { id: 'level:error', sample: 'ⓧ', text: 'エラー: 書いたとおりでは毎回失敗する' });
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
      assert.deepStrictEqual(ids('sort "$x"', on).filter((k) => k.startsWith('received')), ['received:changed', 'received:hole']);
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

    it('marks what fails every time as written as an error (docs/design/three-levels.md, section 2)', () => {
      for (const [src, id] of [['echo $((09))', 'arith-invalid-number'], ["env -S'\"a' s", 'splice-refused'], ['terraform -foo plan', 'terraform-option-before-subcommand'], ['#!/usr/bin/env bash -e', 'shebang-env-one-argument'], ['#!/usr/bin/env -S"a', 'shebang-env-string-refused'], ['#!/usr/bin/env', 'shebang-env-loop']] as const) {
        const row = all(rowModel(explain(src), D1, 'en').rows).find((r) => r.marks?.some((m) => m.id === id));
        assert.strictEqual(row?.level, 'error', src);
        assert.ok(row!.text.includes('ⓧ'), row!.text);
        assert.strictEqual(levelOf(id), 'error');
      }
      // ("Mostly": it depends on a file there, or on the options.)
      assert.strictEqual(levelOf('shebang-relative-interpreter'), 'warning');
      assert.strictEqual(levelOf('shebang-env-reads-options'), 'warning');
    });

    it('checks them against the real tools: each fails, whatever follows', function () {
      this.timeout(20000);
      const arith = spawnSync('bash', ['-c', 'echo $((09)); echo next'], { encoding: 'utf8' });
      assert.deepStrictEqual([arith.status, arith.stdout], [1, '']);
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
