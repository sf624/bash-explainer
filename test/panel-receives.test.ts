import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import type { LineExplanation } from '../src/analyzer-types';
import { explainHostedLine, extractShell, type HostKind } from '../src/hosts';
import type { Lang } from '../src/i18n';
import { keyOf } from '../src/reading';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import type { ReceivedChip } from '../src/ui/panelReceives';
import { type ModelRow, rowModel } from '../src/ui/panelRows';
import { corpus } from './support/corpus';
import { run } from './support/run';

// What the switch "What the program receives" adds to the rows, and the marks "handled by bash" and "not in POSIX sh" (docs/design/panel-redesign.md,
// P9; src/ui/panelReceives.ts). The words themselves are held to bash's argv by test/argv.test.ts: here, which line says them, in which form.

const parser = createUnbashParser();
const OPTIONS = { reading: true, argv: true, notPosix: true, script: 'said' } as const;
const explain = (src: string, line = 0, lang: Lang = 'en', shell: 'bash' | 'sh' = 'bash'): LineExplanation => new Analyzer(lang).explainLine(parser.parse(src), line, shell, OPTIONS);
const all = (rows: readonly ModelRow[]): ModelRow[] => rows.flatMap((r) => [r, ...all(r.children)]);
const rows = (src: string, { line = 0, depth = 1 as 1 | 2, lang = 'en' as Lang, shell = 'bash' as 'bash' | 'sh', receives = true } = {}): ModelRow[] => all(rowModel(explain(src, line, lang, shell), { depth, receives }, lang).rows);
const shown = (c: ReceivedChip): string => c.parts.map((p) => ('text' in p ? p.text : `‹${p.hole}›`)).join('');
/** What a command's row says it receives: the lead, then the words as chips show them. */
const line = (src: string, label: string, options: Parameters<typeof rows>[1] = {}): string[] => {
  const r = rows(src, options).filter((x) => x.label === label && x.receives).pop()!.receives!;
  return [r.lead, ...r.chips.map(shown)];
};

describe('the panel: what the program receives', () => {
  it('says the words of a program, the name first, and of a builtin or a function without it', () => {
    const table: [string, string, string[]][] = [
      ['grep -h "$USER" /var/log/*.log', 'grep', ['receives:', 'grep', '-h', '‹current user name›', '‹each file name matching `/var/log/*.log`›']],
      ['sort', 'sort', ['receives only its name:', 'sort']],
      ['tar -czf "$b" ~/d', 'tar', ['receives:', 'tar', '-czf', '‹value of `$b`›', '‹home directory›/d']],
      ['echo "a  b" c', 'echo', ['runs inside bash, gets:', 'a  b', 'c']],
      ['pwd', 'pwd', ['runs inside bash, gets no arguments']],
      ['source f', 'source', ['runs inside bash, gets:', 'f']],
      ['[ -f a ]', '[ -f a ]', ['runs inside bash, gets:', '-f', 'a', ']']],
      ['f() { :; }; f a', 'f', ['a function of the shell, gets:', 'a']],
      ['f() { :; }; f', 'f', ['a function of the shell, gets no arguments']],
      ['$cmd a', '$cmd', ['receives:', '‹value of `$cmd`›', 'a']],
      ['e=; $e a', '$e', ['receives only its name:', 'a']],
      ['e=; $e', '$e', ['no word is left, so nothing runs']],
      ['echo ""', 'echo', ['runs inside bash, gets:', '∅']],
    ];
    for (const [src, label, want] of table) assert.deepStrictEqual(line(src, label), want, src);
  });

  it('says them in Japanese from the same words', () => {
    assert.deepStrictEqual(line('grep -h "$u"', 'grep', { lang: 'ja' }), ['受け取る単語:', 'grep', '-h', '‹`$u` の値›']);
    assert.deepStrictEqual(line('sort', 'sort', { lang: 'ja' }), ['受け取るのは名前だけ:', 'sort']);
    assert.deepStrictEqual(line('echo a', 'echo', { lang: 'ja' }), ['bash の中で動き、受け取るのは:', 'a']);
    assert.deepStrictEqual(line('pwd', 'pwd', { lang: 'ja' }), ['bash の中で動き、引数はなし']);
    assert.deepStrictEqual(line('f() { :; }; f a', 'f', { lang: 'ja' }), ['シェルの関数で、受け取るのは:', 'a']);
  });

  it('marks a space at an end, and tints only a word received as written', () => {
    const r = rows('echo " a" b "c"').find((x) => x.label === 'echo')!.receives!;
    assert.deepStrictEqual(r.chips, [{ parts: [{ text: '␣a', ends: [1, 0] }] }, { parts: [{ text: 'b', ends: [0, 0] }], asWritten: true }, { parts: [{ text: 'c', ends: [0, 0] }] }]);
    assert.deepStrictEqual(rows('ls -l "$x"').map((x) => [x.label, x.received]), [['ls', 'asWritten'], ['-l', 'asWritten'], ['"$x"', 'changed']]);
    assert.deepStrictEqual(rows('echo -n').map((x) => [x.label, x.received]), [['echo', undefined], ['-n', 'asWritten']], 'a builtin has no first word of its name');
    assert.deepStrictEqual(rows('echo $x').find((x) => x.label === 'echo')!.receives!.chips, [{ parts: [{ hole: 'value of `$x`' }], many: true }]);
  });

  it('shows the first words of a long list, and says how many it leaves out', () => {
    const r = rows('echo {1..100}').find((x) => x.label === 'echo')!.receives!;
    assert.deepStrictEqual([r.chips.length, shown(r.chips[29]), r.more], [30, '30', 'and 70 more words']);
    assert.strictEqual(rows('echo {1..100}', { lang: 'ja' }).find((x) => x.label === 'echo')!.receives!.more, 'ほか 70 語');
    assert.strictEqual(rows('echo {1..30}').find((x) => x.label === 'echo')!.receives!.more, undefined);
  });

  it('says where bash stops, so that the program does not run', () => {
    const fails = (src: string, label: string, lang: Lang = 'en') => rows(src, { lang }).filter((x) => x.label === label && x.receives).pop()!.receives!.fails;
    assert.strictEqual(fails('x=; ls ${x:?}', 'ls'), 'bash stops here, so it does not run: a variable is empty or not set (`${x:?}`)');
    assert.strictEqual(fails('x=; ls ${x:?}', 'ls', 'ja'), 'ここで bash が止まり、実行されない: 変数が空か設定されていない（`${x:?}`）');
    assert.strictEqual(fails('x="a b"; cat < $x', 'cat'), 'bash stops here, so it does not run: the target of a redirection is not one word');
    assert.strictEqual(fails('ls "${x:?no}"', 'ls'), undefined, 'only where the model knows it fails');
    // (bash, the same words: the program does not run.)
    assert.match(run('bash', ['-c', 'x=; ls ${x:?}; echo after']).stderr.toString(), /parameter null or not set/);
    assert.strictEqual(run('bash', ['-c', 'x=; (printf ran ${x:?}) 2>/dev/null']).stdout.toString(), '');
  });

  it('reaches every command a statement continued on other lines shows', () => {
    const src = 'grep x \\\n  | wc -l';
    for (const at of [0, 1]) {
      assert.deepStrictEqual(rows(src, { line: at }).filter((r) => r.receives).map((r) => [r.label, r.receives!.chips.map(shown)]), [['grep', ['grep', 'x']], ['wc', ['wc', '-l']]], `line ${at}`);
    }
    // (And no more than the line shows: a loop's body has no row on its first line.)
    assert.deepStrictEqual(explain('for f in a; do\n  b\ndone < c').argv, [], 'nothing of the body');
    assert.deepStrictEqual(explain('for f in a; do\n  b\ndone < c', 1).argv!.map((l) => l.words.length), [1]);
  });

  it('says of an alias that its words are the alias\'s text, as bash replaces it (bash runs `ls -l x`)', () => {
    const src = 'shopt -s expand_aliases\nalias ll="ls -l"\nll x';
    assert.deepStrictEqual(line(src, 'll', { line: 2 }), ['receives:', '‹the words of `ll`›', 'x']);
    const got = run('bash', ['-c', 'shopt -s expand_aliases\nalias p="printf [%s]"\np x']).stdout.toString();
    assert.strictEqual(got, '[x]');
    assert.deepStrictEqual(line('shopt -s expand_aliases\nalias p="printf [%s]"\np x', 'p', { line: 2 }), ['receives:', '‹the words of `p`›', 'x']);
    const trailing = 'shopt -s expand_aliases\nalias s="sudo "\nalias ll="ls -l"\ns ll x';
    assert.deepStrictEqual(line(trailing, 's', { line: 3 }), ['receives:', '‹the words of `s`›', '‹the words of `ll`›', 'x']);
  });

  it('says a builtin or a function runs inside the shell where bash does: against `type -t`', () => {
    const table: [string, string, 'builtin' | 'function' | undefined][] = [
      ['', 'echo', 'builtin'], ['', '[', 'builtin'], ['', 'source', 'builtin'], ['', 'ls', undefined], ['', '/bin/echo', undefined],
      ['f() { :; }\n', 'f', 'function'], ['echo() { :; }\n', 'echo', 'function'], ['enable -n echo\n', 'echo', undefined],
    ];
    const script = table.map(([before, name]) => `( ${before}type -t ${name}; printf '.\\n' )`).join('\n');
    const out = run('bash', ['-c', script]).stdout.toString().split('.\n').map((s) => s.trim());
    table.forEach(([before, name, inside], i) => {
      const said = explain(`${before}${name} a`, before ? 1 : 0).argv!.at(-1)!.inside;
      assert.strictEqual(said, inside, `${before}${name}`);
      assert.strictEqual(out[i] === 'builtin' || out[i] === 'function' ? out[i] : undefined, inside, `bash, ${before}${name}: ${out[i]}`);
    });
  });

  it('gives a function and a builtin the words bash gives them', () => {
    const words = `a 'b c' {1,2} ''`;
    const got = run('bash', ['-c', `f() { for w in "$@"; do echo "[$w]"; done; }; f ${words}`]).stdout.toString().trim().split('\n').map((s) => s.slice(1, -1));
    const said = line(`f() { :; }; f ${words}`, 'f').slice(1);
    assert.deepStrictEqual(said.map((w) => (w === '∅' ? '' : w)), got);
  });

  it('shows the text of a host file, not the extracted script', () => {
    const hosted = (kind: HostKind, src: string, at: number): { ex: LineExplanation; rows: ModelRow[] } => {
      const extracted = extractShell(kind, src);
      const ex = explainHostedLine(new Analyzer('en'), parser.parse(extracted.text), extracted, src.split('\n'), at, 'en', undefined, { ...OPTIONS, sentence: true })!;
      return { ex, rows: all(rowModel(ex, { depth: 2, receives: true }, 'en').rows) };
    };
    const make = hosted('makefile', 'all:\n\techo a > "$(OUT)"\n\tcp $< "$@" $(CC) \'$(OUT)\'\n', 1);
    assert.ok(make.rows.some((r) => r.text === 'Write stdout (fd 1) to file `"$(OUT)"` (overwrite)'), make.rows.map((r) => r.text).join('\n'));
    assert.match(make.ex.sentence ?? '', /`"\$\(OUT\)"`/);
    const cp = hosted('makefile', 'all:\n\tcp $< "$@" $(CC) \'$(OUT)\'\n', 1);
    assert.deepStrictEqual(cp.rows.find((r) => r.label === 'cp')!.receives!.chips.map(shown), ['cp', '‹the words of `$<`›', '‹the words of `"$@"`›', '‹the words of `$(CC)`›', '$(OUT)']);
    for (const r of [...make.rows, ...cp.rows]) assert.doesNotMatch([r.text, ...r.more.map((m) => m.map((p) => p.text).join(''))].join(' '), /make_target|make_first|\$\{OUT\}|\$\{CC\}/, r.label);
    const yaml = hosted('yaml', 'on: push\njobs:\n  a:\n    runs-on: x\n    steps:\n      - run: echo a > "${{ env.X }}"\n', 5);
    assert.ok(yaml.rows.some((r) => r.text === 'Write stdout (fd 1) to file `"${{ env.X }}"` (overwrite)'), yaml.rows.map((r) => r.text).join('\n'));
    for (const r of yaml.rows) assert.doesNotMatch(r.text, /ENV_X/);
  });
});

describe('the panel: the mark "handled by bash"', () => {
  /** The labels of the rows with the mark. */
  const marked = (src: string, options: Parameters<typeof rows>[1] = {}): string[] => rows(src, options).filter((r) => r.handled).map((r) => r.label);

  it('is once per construct that no program receives, on its first row, at both depths', () => {
    const table: [string, number, string[]][] = [
      ['if [[ -f c ]]; then source c; fi', 0, ['if ‹condition› then ‹commands› fi', '[[ -f c ]]']],
      ['if a; then\n  b\nelse\n  c\nfi', 0, ['if ‹condition› then ‹commands› else ‹commands› fi']],
      ['if a; then\n  b\nelse\n  c\nfi', 1, []],
      ['if a; then\n  b\nelse\n  c\nfi', 2, ['else ‹commands›']],
      ['if a; then\n  b\nelse\n  c\nfi', 4, ['fi']],
      ['for f in a; do\n  b\ndone < x', 0, ['for f in ‹words› do ‹commands› done < x']],
      ['for f in a; do\n  b\ndone < x', 2, ['done']],
      ['grep a | sort', 0, ['grep | sort']],
      ['tar f 2>/dev/null || echo x >&2', 0, ['tar || echo', '2>/dev/null', '>&2']],
      ['LANG=C sort f', 0, ['LANG=C']],
      ['>f ls', 0, ['>f']],
      ['x=1', 0, ['x=1']],
      ['z=3 >f', 0, ['z=3 >f']],
      ['a &', 0, ['a &']],
      ['(a) > f', 0, ['( ‹commands› )']],
      ['time a | b', 0, ['time a | b']],
      ['! a | b', 0, ['! a | b']],
      ['a; ! b | c', 0, ['a; ! b | c', 'b | c']],
      ['cat <<E\nx\nE', 0, ['<<E']],
      ['echo "$(date)" $x *.txt ~/a', 0, []],
      ['echo $(x=1; date)', 0, ['x=1; date', 'x=1']],
      ['ls', 0, []],
      ['sudo ls >f', 0, ['>f']],
      ['# c', 0, []],
      ['#!/bin/bash', 0, []],
      ['sh -c "a | b; x=1"', 0, []],
      ['docker exec c sh -c ls', 0, []],
    ];
    for (const [src, at, want] of table) {
      assert.deepStrictEqual(marked(src, { line: at }), want, `${src}, line ${at}, depth 1`);
      assert.deepStrictEqual(marked(src, { line: at, depth: 2 }), want, `${src}, line ${at}, depth 2`);
    }
  });

  it('shows only with the switch on', () => {
    assert.deepStrictEqual(marked('a | b', { receives: false }), []);
    assert.deepStrictEqual(rowModel({ ...explain('a | b'), argv: undefined }, { depth: 1, receives: true }, 'en').rows[0].handled, undefined, 'nor without the data');
  });

  it('says the shell a script is read as', () => {
    const say = (shell: 'bash' | 'sh', lang: Lang) => { const m = rowModel(explain('a | b', 0, lang, shell), { depth: 1, receives: true }, lang).marks; return [m.handled, m.handledSays]; };
    assert.deepStrictEqual(say('bash', 'en'), ['handled by bash', 'bash handles it; the program never sees it']);
    assert.deepStrictEqual(say('bash', 'ja'), ['bash が処理', 'bash が処理し、プログラムには渡らない']);
    assert.deepStrictEqual(say('sh', 'en'), ['handled by the shell', 'the shell handles it; the program never sees it']);
    assert.deepStrictEqual(say('sh', 'ja'), ['シェルが処理', 'シェルが処理し、プログラムには渡らない']);
    assert.deepStrictEqual(rows('ls | pwd', { shell: 'sh' }).find((r) => r.label === 'pwd')!.receives!.lead, 'runs inside the shell, gets no arguments');
  });

  it('follows the argv of the corpus: none on what a program receives, one per construct, the same at both depths', function () {
    this.timeout(400000);
    const { files, snippets } = corpus();
    let constructs = 0;
    let marks = 0;
    for (const { name, text } of [...files, ...snippets.slice(0, 1500)]) {
      const tree = parser.parse(text);
      const analyzer = new Analyzer('en');
      text.split('\n').slice(0, 300).forEach((source, at) => {
        const ex = analyzer.explainLine(tree, at, 'bash', OPTIONS);
        const where = `${name}: ${at}: ${source}`;
        const words = new Set((ex.argv ?? []).flatMap((l) => l.words.map((w) => keyOf(w.from))));
        const starts = new Set((ex.argv ?? []).flatMap((l) => l.removed.map((r) => `${r.span.start.line}:${r.span.start.character}`)));
        const two = rowModel(ex, { depth: 2, receives: true }, 'en').rows;
        const walk = (r: ModelRow, up: readonly ModelRow[]): void => {
          if (r.inScript) {
            assert.strictEqual(all([r]).some((x) => x.handled), false, `${where}: a string another shell reads`);
            return;
          }
          if (r.handled) {
            marks++;
            assert.ok(!r.receives && !(r.frame === 'command' && r.name), `${where}: ${r.label} is a command with a program`);
            if (!r.frame) {
              assert.ok(!words.has(keyOf(r.span)), `${where}: ${r.label} is a word a program receives`);
              // (Inside a construct, what has no box of its own has no mark: only what bash takes out of a command.)
              if (up.length) assert.ok(starts.has(`${r.span.start.line}:${r.span.start.character}`), `${where}: ${r.label} is inside a construct`);
              const open = [...up].reverse();
              const box = open.findIndex((u) => u.frame);
              assert.ok(!(box < 0 ? open : open.slice(0, box)).some((u) => u.handled), `${where}: ${r.label} twice in one construct`);
            }
          }
          if (r.frame === 'compound' || (r.frame === 'command' && !r.receives)) {
            constructs++;
            assert.ok(r.handled, `${where}: ${r.label} has no mark`);
          }
          if (r.frame === 'group' && !up.at(-1)?.handled) assert.ok(r.handled, `${where}: ${r.label} has no mark`);
          r.children.forEach((c) => walk(c, [...up, r]));
        };
        two.forEach((r) => walk(r, []));
        const one = new Map(all(rowModel(ex, { depth: 1, receives: true }, 'en').rows).map((r) => [r.key, r.handled]));
        for (const r of all(two)) if (one.has(r.key)) assert.strictEqual(r.handled, one.get(r.key), `${where}: ${r.label} at both depths`);
      });
    }
    assert.ok(constructs > 500 && marks > 1000, `${constructs} constructs, ${marks} marks`);
  });
});

describe('the panel: the mark "not in POSIX sh"', () => {
  const marks = (src: string, options: Parameters<typeof rows>[1] = {}): [string, string[]][] => rows(src, options).filter((r) => r.notPosix).map((r) => [r.label, r.notPosix!]);

  it('is on the construct only, with the sentence of the problems of a sh script, in a bash script too and with the switch off', () => {
    const table: [string, [string, string[]][]][] = [
      ['if [[ a ]]; then b; fi', [['[[ a ]]', ['`[[ ]]` is not POSIX sh (it fails in dash). Instead, use `[ ]`.']]]],
      ['[[ a =~ b ]]', [['[[ a =~ b ]]', ['`[[ ]]` is not POSIX sh (it fails in dash). Instead, use `[ ]`.', '`[[ =~ ]]` regex matching is not POSIX sh (it fails in dash and busybox ash). Instead, use `expr` or `grep -E`.']]]],
      ['[ a == b ]', [['[ a == b ]', ['`==` in `[ ]` is not POSIX sh (it fails in dash). Instead, use `=`.']]]],
      ['source f', [['source', ['`source` is not POSIX sh (it fails in dash). Instead, use `.`.']]]],
      ['f() { local x; }', [['local', ['`local` is not POSIX sh (dash and busybox ash accept it, but POSIX does not have it).']]]],
      ['cat <<< x', [['<<< x', ['here-strings `<<<` is not POSIX sh (it fails in dash and busybox ash). Instead, use `printf \'%s\\n\' … |` or a here-document.']]]],
      ['echo {a,b}', [['{a,b}', ['brace expansion `{a,b}` is not POSIX sh (it fails in dash and busybox ash).']]]],
      ['for ((;;)); do\n  a\ndone', [['for (( ; ; )) do ‹commands› done', ['C-style `for (( ; ; ))` is not POSIX sh (it fails in dash and busybox ash). Instead, use `while` with `$(( ))`.']]]],
      ['[ a = b ] && . f; echo "${x:-d}" $((1+2)); a | b; c > d', []],
    ];
    for (const [src, want] of table) {
      assert.deepStrictEqual(marks(src), want, src);
      assert.deepStrictEqual(marks(src, { receives: false, depth: 2 }), want, `${src}, depth 2, switch off`);
    }
  });

  it('says it in Japanese, and is in the Key only where it is drawn', () => {
    assert.deepStrictEqual(marks('[[ a ]]', { lang: 'ja' }), [['[[ a ]]', ['`[[ ]]` は POSIX sh にない書き方です（dash では動きません）。代わりに `[ ]` を使う。']]]);
    const key = (src: string, lang: Lang = 'en') => rowModel(explain(src, 0, lang), { depth: 1, receives: true }, lang).key.filter((k) => k.id.startsWith('mark:')).map((k) => [k.id, k.sample]);
    assert.deepStrictEqual(key('ls'), []);
    assert.deepStrictEqual(key('[[ a ]]'), [['mark:handled', 'handled by bash'], ['mark:notPosix', 'not in POSIX sh']]);
    assert.deepStrictEqual(key('[[ a ]]', 'ja'), [['mark:handled', 'bash が処理'], ['mark:notPosix', 'POSIX sh にない']]);
  });

  it('holds each construct of the corpus on one row of the line', function () {
    this.timeout(300000);
    const { files, snippets } = corpus();
    let seen = 0;
    for (const { name, text } of [...files, ...snippets.slice(0, 1500)]) {
      const tree = parser.parse(text);
      const analyzer = new Analyzer('en');
      text.split('\n').slice(0, 300).forEach((source, at) => {
        const ex = analyzer.explainLine(tree, at, 'bash', { ...OPTIONS, reading: false, argv: false });
        // (A line in a script bash cannot read may hold a part of a construct with no row of it.)
        if (tree.errors.length) return;
        const drawn = all(rowModel(ex, { depth: 1, receives: false }, 'en').rows).flatMap((r) => r.notPosix ?? []);
        for (const n of ex.notPosix ?? []) {
          seen++;
          assert.ok(drawn.includes(n.says) || !ex.items.length, `${name}: ${at}: ${source}: ${n.says}`);
        }
      });
    }
    assert.ok(seen > 400, `${seen} marks`);
  });

});
