import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import type { LineExplanation } from '../src/analyzer-types';
import { explainHostedLine, extractShell, type HostKind } from '../src/hosts';
import type { Lang } from '../src/i18n';
import { shownPiece, shownWord } from '../src/messages';
import { keyOf } from '../src/reading';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import type { ReceivedChip } from '../src/ui/panelReceives';
import { type ModelRow, rowModel } from '../src/ui/panelRows';
import { shellState } from '../src/semantics/state';
import { corpus } from './support/corpus';
import { run } from './support/run';

// What the switch "What the program receives" adds to the rows, and the marks "handled by bash" and "not in POSIX sh" (docs/design/panel-redesign.md,
// P9; src/ui/panelReceives.ts). The words themselves are held to bash's argv by test/argv.test.ts: here, which line says them, in which form.

const parser = createUnbashParser();
const OPTIONS = { reading: true, argv: true, notPosix: true, script: 'said' } as const;
type Sh = 'bash' | 'sh' | 'dash' | 'ash' | 'zsh';
const explain = (src: string, line = 0, lang: Lang = 'en', shell: Sh = 'bash'): LineExplanation => new Analyzer(lang).explainLine(parser.parse(src), line, shell, OPTIONS);
const all = (rows: readonly ModelRow[]): ModelRow[] => rows.flatMap((r) => [r, ...all(r.children)]);
const rows = (src: string, { line = 0, depth = 1 as 1 | 2, lang = 'en' as Lang, shell = 'bash' as Sh, receives = true } = {}): ModelRow[] => all(rowModel(explain(src, line, lang, shell), { depth, receives }, lang).rows);
const shown = (c: ReceivedChip): string => c.parts.map((p) => ('text' in p ? p.text : `‹${p.hole}›`)).join('');
const FILE_READ = 'a program, or a function of the file read, gets:';
/** What a command's row says it receives: the lead, then the words as chips show them. */
const line = (src: string, label: string, options: Parameters<typeof rows>[1] = {}): string[] => {
  const r = rows(src, options).filter((x) => x.label === label && x.receives).pop()!.receives!;
  return [r.lead, ...r.chips.map(shown)];
};

describe('the panel: what the program receives', () => {
  it('says the words of a program, the name first, and of a builtin or a function without it', () => {
    const table: [string, string, string[]][] = [
      ['grep -h "$USER" /var/log/*.log', 'grep', ['receives:', 'grep', '-h', '‹current user name›', '‹each file name matching `/var/log/*.log`, else the pattern itself›']],
      ['sort', 'sort', ['receives only its name:', 'sort']],
      ['tar -czf "$b" ~/d', 'tar', ['receives:', 'tar', '-czf', '‹value of `$b`›', '‹home directory›/d']],
      ['echo "a  b" c', 'echo', ['runs inside bash, gets:', 'a  b', 'c']],
      ['pwd', 'pwd', ['runs inside bash, gets no arguments']],
      ['source f', 'source', ['runs inside bash, gets:', 'f']],
      ['[ -f a ]', '[', ['runs inside bash, gets:', '-f', 'a', ']']],
      ['f() { :; }; f a', 'f', ['a function of the shell, gets:', 'a']],
      ['f() { :; }; f', 'f', ['a function of the shell, gets no arguments']],
      ['$cmd a', '$cmd', ['receives:', '‹value of `$cmd`›', 'a']],
      ['{,} a', '{,}', ['receives only its name:', 'a']],
      ['{,}', '{,}', ['no word is left, so nothing runs']],
      ['echo ""', 'echo', ['runs inside bash, gets:', '∅']],
    ];
    for (const [src, label, want] of table) assert.deepStrictEqual(line(src, label), want, src);
  });

  it('marks a space only at the ends of the whole word: beside a placeholder it shows as it is', () => {
    const chips = (src: string, lang: Lang = 'en') => rows(src, { lang }).filter((x) => x.label === 'echo' && x.receives).pop()!.receives!.chips.map((c) => c.parts);
    const text = (text: string, lead = 0, trail = 0) => ({ text, ends: [lead, trail] });
    assert.deepStrictEqual(chips('echo "ERROR $USER" "$USER " " $USER" "$a $b" "a  $USER" " " "  " "a "'), [
      [text('ERROR '), { hole: 'current user name' }],
      [{ hole: 'current user name' }, text('␣', 0, 1)],
      [text('␣', 0, 1), { hole: 'current user name' }],
      [{ hole: 'value of `$a`' }, text(' '), { hole: 'value of `$b`' }],
      [text('a  '), { hole: 'current user name' }],
      [text('␣', 0, 1)],
      [text('␣␣', 0, 2)],
      [text('a␣', 0, 1)],
    ]);
    // (Both ends of a text beside placeholders on one side only: the end by the placeholder is plain.)
    assert.deepStrictEqual(chips('echo " a $USER" "$USER b "'), [
      [text('␣a ', 1, 0), { hole: 'current user name' }],
      [{ hole: 'current user name' }, text(' b␣', 0, 1)],
    ]);
    assert.deepStrictEqual(chips('echo "ERROR $USER" "$USER "', 'ja'), [
      [text('ERROR '), { hole: '現在のユーザー名' }],
      [{ hole: '現在のユーザー名' }, text('␣', 0, 1)],
    ]);
  });

  it('shows a text as the whole word does by default, and a piece of a word by the ends it has', () => {
    const both = { lead: true, trail: true };
    assert.deepStrictEqual(shownWord('  a  '), { text: '␣␣a␣␣', ends: [2, 2] });
    assert.deepStrictEqual(shownPiece('  a  ', both), shownWord('  a  '));
    assert.deepStrictEqual(shownPiece('  a  ', { lead: true, trail: false }), { text: '␣␣a  ', ends: [2, 0] });
    assert.deepStrictEqual(shownPiece('  a  ', { lead: false, trail: true }), { text: '  a␣␣', ends: [0, 2] });
    assert.deepStrictEqual(shownPiece('  a  ', { lead: false, trail: false }), { text: '  a  ', ends: [0, 0] });
    assert.deepStrictEqual(shownWord('  '), { text: '␣␣', ends: [0, 2] });
    assert.deepStrictEqual(shownPiece('  ', { lead: true, trail: false }).text, '␣␣');
    assert.deepStrictEqual(shownPiece('  ', { lead: false, trail: true }).text, '␣␣');
    assert.deepStrictEqual(shownPiece('  ', { lead: false, trail: false }), { text: '  ', ends: [0, 0] });
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
    assert.strictEqual(fails('x=; ls ${x:?}', 'ls', 'ja'), 'bash がここで止まり、実行されない: 変数が空か設定されていない（`${x:?}`）');
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
      ['if a; then f() { :; }; fi\n', 'f', undefined], ['', 'echo', 'builtin'], ['', '[', 'builtin'], ['', 'source', 'builtin'], ['', 'ls', undefined], ['', '/bin/echo', undefined],
      ['f() { :; }\n', 'f', 'function'], ['echo() { :; }\n', 'echo', 'function'], ['enable -n echo\n', 'echo', undefined],
    ];
    const script = table.map(([before, name]) => `( ${before}type -t ${name}; printf '.\\n' )`).join('\n');
    const out = run('bash', ['-c', script]).stdout.toString().split('.\n').map((s) => s.trim());
    table.forEach(([before, name, inside], i) => {
      const said = explain(`${before}${name} a`, before ? 1 : 0).argv!.at(-1)!.inside;
      assert.strictEqual(said, inside, `${before}${name}`);
      // (On that path `a` fails, so bash finds no function: "may be" is no claim.)
      assert.strictEqual(out[i] === 'builtin' || out[i] === 'function' ? out[i] : undefined, inside, `bash, ${before}${name}: ${out[i]}`);
    });
  });

  it('makes no claim of a builtin turned off on some paths', () => {
    assert.strictEqual(explain('if a; then enable -n echo; fi\necho x', 1).argv![0].inside, undefined);
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
    assert.deepStrictEqual(cp.rows.find((r) => r.label === 'cp')!.receives!.chips.map(shown), ['cp', '‹the words of `$<`›', '‹the words of `"$@"`›', '‹the words of `$(CC)`›', '‹the words of `\'$(OUT)\'`›']);
    for (const r of [...make.rows, ...cp.rows]) assert.doesNotMatch([r.text, ...r.more.map((m) => m.map((p) => p.text).join(''))].join(' '), /make_target|make_first|\$\{OUT\}|\$\{CC\}/, r.label);
    // (A warning on a token, as the row draws it, says the file's text too.)
    const marked = hosted('makefile', 'all:\n\t$$((09)) $(OUT)\n', 1);
    assert.ok(marked.rows.some((r) => r.marks?.length), marked.rows.map((r) => r.label).join(' '));
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
      ['f() { a; }', 0, ['f() { ‹commands› }']],
      ['function f { a; }', 0, ['function f { ‹commands› }']],
      ['f() ( a )', 0, ['f() ( ‹commands› )']],
      ['time { a; }', 0, ['time { ‹commands› }']],
      ['! { a; }', 0, ['! { ‹commands› }']],
      ['coproc N { a; }', 0, ['coproc N { ‹commands› }']],
      ['x=1; { a; }', 0, ['x=1; { ‹commands› }', 'x=1', '{ ‹commands› }']],
      ['x=1; y=2; z=3', 0, ['x=1; y=2; z=3']],
      ['x=1; y=2; a', 0, ['x=1; y=2; a', 'x=1', 'y=2']],
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

  it('marks a run with no row of depth 1 at depth 2 only', () => {
    const src = 'if a\nthen b; fi';
    assert.deepStrictEqual(marked(src, { line: 0, depth: 1 }), marked(src, { line: 0, depth: 2 }));
    const semi = rowModel({ ...explain('a'), items: [{ ...explain('a').items[0], frame: undefined }] }, { depth: 1, receives: true }, 'en').rows;
    assert.strictEqual(semi[0].handled, undefined, 'a word of a command is no construct: its name has an argv');
  });

  it('shows only with the switch on', () => {
    assert.deepStrictEqual(marked('a | b', { receives: false }), []);
    assert.deepStrictEqual(rowModel({ ...explain('a | b'), argv: undefined }, { depth: 1, receives: true }, 'en').rows[0].handled, undefined, 'nor without the data');
  });

  it('says the shell a script is read as', () => {
    const say = (shell: 'bash' | 'sh', lang: Lang) => { const m = rowModel(explain('a | b', 0, lang, shell), { depth: 1, receives: true }, lang).marks; return [m.handled, m.handledSays]; };
    assert.deepStrictEqual(say('bash', 'en'), ['handled by bash', 'bash handles it; it is not among the program\'s words']);
    assert.deepStrictEqual(say('bash', 'ja'), ['bash が処理', 'bash が処理し、プログラムの単語にはならない']);
    assert.deepStrictEqual(say('sh', 'en'), ['handled by the shell', 'the shell handles it; it is not among the program\'s words']);
    assert.deepStrictEqual(say('sh', 'ja'), ['シェルが処理', 'シェルが処理し、プログラムの単語にはならない']);
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
          // (What a word before it applies to, `f() { a; }`, and a list of assignments alone have one mark, on the first row.)
          const parent = up.at(-1);
          const applied = parent?.handled && (!parent.frame || parent.kind === 'function') && r.span.end.line === parent.span.end.line && r.span.end.character === parent.span.end.character;
          const inAssignments = parent?.handled && parent.frame === 'group' && parent.children.every((c) => !c.frame || (c.frame === 'command' && !c.receives));
          if ((r.frame === 'compound' || (r.frame === 'command' && !r.receives)) && !applied && !inAssignments) {
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
      ['[[ a =~ b ]]', [['[[ a =~ b ]]', ['`[[ ]]` is not POSIX sh (it fails in dash). Instead, use `[ ]`.', '`[[ =~ ]]` regex matching is not POSIX sh (it fails in dash; busybox ash matches it, but a `(` in it is a syntax error). Instead, use `expr` or `grep -E`.']]]],
      ['[ a == b ]', [['[', ['`==` in `[ ]` or `test` is not POSIX sh (it fails in dash). Instead, use `=`.']]]],
      ['source f', [['source', ['`source` is not POSIX sh (it fails in dash). Instead, use `.`.']]]],
      ['f() { local x; }', [['local', ['`local` is not POSIX sh (dash and busybox ash accept it, but POSIX does not have it).']]]],
      ['cat <<< x', [['<<< x', ['a here-string `<<<` is not POSIX sh (it fails in dash and busybox ash). Instead, use `printf \'%s\\n\' … |` or a here-document.']]]],
      ['echo {a,b}', [['{a,b}', ['brace expansion `{a,b}` is not POSIX sh (in dash and busybox ash the braces stay, as one word).']]]],
      ['for ((;;)); do\n  a\ndone', [['for (( ; ; )) do ‹commands› done', ['C-style `for (( ; ; ))` is not POSIX sh (it fails in dash and busybox ash). Instead, use `while` with `$(( ))`.']]]],
      ['[ a = b ] && . f; echo "${x:-d}" $((1+2)); a | b; c > d', []],
    ];
    for (const [src, want] of table) {
      assert.deepStrictEqual(marks(src), want, src);
      assert.deepStrictEqual(marks(src, { receives: false, depth: 2 }), want, `${src}, depth 2, switch off`);
    }
  });

  it('says a sentence once on a row, and finds the row of a part with no row of its own', () => {
    assert.deepStrictEqual(rows('x=$\'a\'$\'b\'').filter((r) => r.notPosix).map((r) => [r.label, r.notPosix!.length]), [["$'a'$'b'", 1]]);
    assert.deepStrictEqual(rowModel({ ...explain('ls'), notPosix: [{ span: { start: { line: 9, character: 0 }, end: { line: 9, character: 1 } }, says: 'x' }] }, { depth: 1, receives: false }, 'en').rows[0].notPosix, undefined, 'nor a mark with no row');
  });

  it('says it in Japanese, and is in the Legend only where it is drawn', () => {
    assert.deepStrictEqual(marks('[[ a ]]', { lang: 'ja' }), [['[[ a ]]', ['`[[ ]]` は POSIX sh にない書き方です（dash では動きません）。代わりに `[ ]` を使う。']]]);
    const key = (src: string, lang: Lang = 'en') => rowModel(explain(src, 0, lang), { depth: 1, receives: true }, lang).key.filter((k) => k.id.startsWith('mark:')).map((k) => [k.id, k.sample]);
    assert.deepStrictEqual(key('ls'), []);
    assert.deepStrictEqual(key('[[ a ]]'), [['mark:handled', 'handled by bash'], ['mark:notPosix', 'not portable to sh']]);
    assert.deepStrictEqual(key('[[ a ]]', 'ja'), [['mark:handled', 'bash が処理'], ['mark:notPosix', 'sh に移植できない']]);
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
        const drawn = all(rowModel(ex, { depth: 1, receives: false }, 'en').rows).flatMap((r) => r.notPosix ?? []);
        // (A line in a script bash cannot read may hold a part of a construct with no row of it.)
        if (tree.errors.length) return;
        for (const n of ex.notPosix ?? []) {
          seen++;
          assert.ok(drawn.includes(n.says) || !ex.items.length, `${name}: ${at}: ${source}: ${n.says}`);
        }
      });
    }
    assert.ok(seen > 400, `${seen} marks`);
  });

});

// What the review of #606 ran: the words the panel says against what a recorder gets from real bash, where the model cannot read a file or a text, or where
// the shell is not bash. A row: the script, its files, the variables of its environment, the line and row, what the recorders print with the status, and what the row says.
interface RunRow { src: string; files?: Record<string, string>; env?: string; at?: number; label: string; out: string; says: string[] }

describe('the panel: what the program receives, where the model cannot read, against real runs', () => {
  const recorder = '#!/bin/sh\nprintf "%s" "${0##*/}"\nfor a; do printf " [%s]" "$a"; done\necho\n';
  const IN_FILE = { 's.sh': 'x=2\n' };
  const table: RunRow[] = [
    // A file or a text the model does not read: a variable is a value known only when the line runs.
    { src: 'x=1; . ./s.sh; ls $x', files: IN_FILE, label: 'ls', out: 'ls [2]\nstatus=0', says: ['receives:', 'ls', '‹value of `$x`›'] },
    { src: 'x=1; source ./s.sh; ls $x', files: IN_FILE, label: 'ls', out: 'ls [2]\nstatus=0', says: ['receives:', 'ls', '‹value of `$x`›'] },
    { src: 'x=1; eval "$y"; ls $x', env: 'y=x=2', label: 'ls', out: 'ls [2]\nstatus=0', says: ['receives:', 'ls', '‹value of `$x`›'] },
    { src: 'x=1; eval "$(cmd)"; ls $x', label: 'ls', out: 'ls [2]\nstatus=0', says: ['receives:', 'ls', '‹value of `$x`›'] },
    { src: 'x=1; eval $(cmd); ls $x', label: 'ls', out: 'ls [2]\nstatus=0', says: ['receives:', 'ls', '‹value of `$x`›'] },
    { src: '. ./s.sh\nx="a,b c"; ls $x', files: { 's.sh': 'IFS=,\n' }, at: 1, label: 'ls', out: 'ls [a] [b c]\nstatus=0', says: ['receives:', 'ls', '‹value of `$x`›'] },
    { src: '. ./s.sh; ls "$y"', files: { 's.sh': 'y="a b"\n' }, label: 'ls', out: 'ls [a b]\nstatus=0', says: ['receives:', 'ls', '‹value of `$y`›'] },
    { src: '. ./s.sh; read <<< a; ls "$REPLY"', files: { 's.sh': ':\n' }, label: 'ls', out: 'ls [a]\nstatus=0', says: ['receives:', 'ls', '‹value of `$REPLY`›'] },
    { src: 'n=x; x=1; unset "$n"; ls "$x"', label: 'ls', out: 'ls []\nstatus=0', says: ['receives:', 'ls', '‹value of `$x`›'] },
    { src: 'declare -c x; x=abc; ls $x', label: 'ls', out: 'ls [Abc]\nstatus=0', says: ['receives:', 'ls', '‹value of `$x`›'] },
    { src: 'HOME=/h; . ./s.sh; ls ~', files: { 's.sh': 'HOME=/j\n' }, label: 'ls', out: 'ls [/j]\nstatus=0', says: ['receives:', 'ls', '‹home directory›'] },
    { src: 'x=1; . ./s.sh; ls a "b c"', files: IN_FILE, label: 'ls', out: 'ls [a] [b c]\nstatus=0', says: ['receives:', 'ls', 'a', 'b c'] },
    // `set -k`: a word in the form of an assignment is the command's, wherever it stands.
    { src: 'set -k; ls a=b c', label: 'ls', out: 'ls [c]\nstatus=0', says: ['receives:', 'ls', 'c'] },
    { src: 'set -k; ls a=b "d=e" f+=1 g[1]=2 =h c', label: 'ls', out: 'ls [d=e] [=h] [c]\nstatus=0', says: ['receives:', 'ls', 'd=e', '=h', 'c'] },
    { src: 'set -k; set +k; ls a=b c', label: 'ls', out: 'ls [a=b] [c]\nstatus=0', says: ['receives:', 'ls', 'a=b', 'c'] },
    // A name the dictionary does not know, after a file read: maybe a function of it.
    { src: '. ./lib.sh\nlg hello', files: { 'lib.sh': 'lg() { printf "lg [%s]\\n" "$1"; }\n' }, at: 1, label: 'lg', out: 'lg [hello]\nstatus=0', says: [FILE_READ, 'hello'] },
    { src: '. ./lib.sh\nrec hello', files: { 'lib.sh': ':\n' }, at: 1, label: 'rec', out: 'rec [hello]\nstatus=0', says: [FILE_READ, 'hello'] },
    { src: '. ./lib.sh\nls hello', files: { 'lib.sh': ':\n' }, at: 1, label: 'ls', out: 'ls [hello]\nstatus=0', says: ['receives:', 'ls', 'hello'] },
    // A command named by a variable may run a function, which changes what the walk does not see.
    { src: 'c=f; f() { x=2; }; x=1; $c; ls $x', label: 'ls', out: 'ls [2]\nstatus=0', says: ['receives:', 'ls', '‹value of `$x`›'] },
    { src: 'c=f; f() { x=2; }; x=1; "$c"; ls $x', label: 'ls', out: 'ls [2]\nstatus=0', says: ['receives:', 'ls', '‹value of `$x`›'] },
    { src: 'f() { :; }; c=cmd; x=1; $c; ls $x', label: 'ls', out: 'x=2\nls [1]\nstatus=0', says: ['receives:', 'ls', '1'] },
    // An inherited `OLDPWD` that names a directory stays.
    { src: 'ls $OLDPWD', env: 'OLDPWD=/', label: 'ls', out: 'ls [/]\nstatus=0', says: ['receives:', 'ls', '‹previous directory›'] },
    { src: 'ls $OLDPWD', label: 'ls', out: 'ls\nstatus=0', says: ['receives:', 'ls', '‹previous directory›'] },
    { src: 'unset OLDPWD; ls $OLDPWD', env: 'OLDPWD=/', label: 'ls', out: 'ls\nstatus=0', says: ['receives only its name:', 'ls'] },
    // CR LF: the CR is in the last word of the line.
    { src: 'ls a\r\n', label: 'ls', out: 'ls [a\r]\nstatus=0', says: ['receives:', 'ls', 'a␍'] },
    { src: 'ls $x\r\n', label: 'ls', out: 'ls [\r]\nstatus=0', says: ['receives:', 'ls', '‹value of `$x`›␍'] },
    { src: 'set -k; ls c a=b\r\n', label: 'ls', out: 'ls [c]\nstatus=0', says: ['receives:', 'ls', 'c'] },
    { src: 'ls a \r\n', label: 'ls', out: 'ls [a] [\r]\nstatus=0', says: ['receives:', 'ls', 'a', '␍'] },
    { src: 'ls "a b"\r\n', label: 'ls', out: 'ls [a b\r]\nstatus=0', says: ['receives:', 'ls', 'a b␍'] },
    { src: 'ls {a,b}\r\n', label: 'ls', out: 'ls [a\r] [b\r]\nstatus=0', says: ['receives:', 'ls', 'a␍', 'b␍'] },
    { src: 'x=1\r\nls "$x"\r\n', at: 1, label: 'ls', out: 'ls [1\r\r]\nstatus=0', says: ['receives:', 'ls', '‹value of `$x`›␍'] },
    { src: 'ls a # c\r\n', label: 'ls', out: 'ls [a]\nstatus=0', says: ['receives:', 'ls', 'a'] },
    { src: 'ls\r\n', label: 'ls', out: 'status=127', says: ['receives only its name:', 'ls␍'] },
    { src: 'ls *.nomatch\r\n', label: 'ls', out: 'ls [*.nomatch\r]\nstatus=0', says: ['receives:', 'ls', '‹each file name matching `*.nomatch␍`›'] },
    // Where no file matches.
    { src: 'ls *.nomatch', label: 'ls', out: 'ls [*.nomatch]\nstatus=0', says: ['receives:', 'ls', '‹each file name matching `*.nomatch`, else the pattern itself›'] },
    { src: 'shopt -s nullglob\nls *.nomatch', at: 1, label: 'ls', out: 'ls\nstatus=0', says: ['receives:', 'ls', '‹each file name matching `*.nomatch`, else no word›'] },
    { src: 'shopt -s failglob\nls *.nomatch', at: 1, label: 'ls', out: 'status=1', says: ['receives:', 'ls', '‹each file name matching `*.nomatch`, else the command does not run›'] },
    { src: 'shopt -s nullglob failglob\nls *.nomatch', at: 1, label: 'ls', out: 'status=1', says: ['receives:', 'ls', '‹each file name matching `*.nomatch`, else the command does not run›'] },
    // (The command does not run; the rest of the statement it is in goes too, and the next one runs.)
    { src: 'shopt -s failglob\nf() {\n  ls *.nomatch\n  ls y\n}\nf\nls x', at: 2, label: 'ls', out: 'ls [x]\nstatus=0', says: ['receives:', 'ls', '‹each file name matching `*.nomatch`, else the command does not run›'] },
    { src: 'shopt -s failglob\n{ ls *.nomatch; }\nls x', at: 1, label: 'ls', out: 'ls [x]\nstatus=0', says: ['receives:', 'ls', '‹each file name matching `*.nomatch`, else the command does not run›'] },
  ];

  let dir: string;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-receives-'));
    fs.mkdirSync(path.join(dir, 'bin'));
    for (const name of ['ls', 'rec']) fs.writeFileSync(path.join(dir, 'bin', name), recorder, { mode: 0o755 });
    // (Its output is run, or recorded.)
    fs.writeFileSync(path.join(dir, 'bin', 'cmd'), '#!/bin/sh\necho x=2\n', { mode: 0o755 });
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('says what bash gives each row', () => {
    table.forEach((row, i) => {
      const at = path.join(dir, `case-${i}`);
      fs.mkdirSync(at);
      fs.writeFileSync(path.join(at, 'script'), row.src);
      fs.writeFileSync(path.join(at, 'env'), row.env ? `export ${row.env}\n` : '');
      for (const [name, text] of Object.entries(row.files ?? {})) fs.writeFileSync(path.join(at, name), text);
    });
    // (One process for the table; each script in a bash of its own, with no file that matches.)
    const driver = `B=$(command -v bash); D=$PWD; PATH=$D/bin; i=0; while [ -d "$D/case-$i" ]; do ( cd "$D/case-$i"; unset OLDPWD; . ./env; FUNCNEST=50 "$B" ./script 2>/dev/null; printf 'status=%s\\n' "$?" ); printf '\\036'; i=$((i+1)); done`;
    const got = run('bash', ['-c', driver], { cwd: dir, timeout: 60000 }).stdout.toString().split('\x1e');
    table.forEach((row, i) => {
      assert.strictEqual(got[i].trimEnd(), row.out, `bash: ${JSON.stringify(row.src)}`);
      assert.deepStrictEqual(line(row.src, row.label, { line: row.at ?? 0 }), row.says, JSON.stringify(row.src));
    });
  });

  it('says the same with one analyzer moved through the file', () => {
    for (const row of table) {
      const lines = row.src.split('\n').keys();
      const analyzer = new Analyzer('en');
      const tree = parser.parse(row.src);
      const each = [...lines];
      for (const at of [...each, ...[...each].reverse()]) {
        const moved = all(rowModel(analyzer.explainLine(tree, at, 'bash', OPTIONS), { depth: 1, receives: true }, 'en').rows);
        const fresh = rows(row.src, { line: at });
        assert.deepStrictEqual(moved.map((r) => [r.label, r.receives, r.handled, r.notPosix]), fresh.map((r) => [r.label, r.receives, r.handled, r.notPosix]), `${JSON.stringify(row.src)}, line ${at}`);
      }
    }
  });

  it('says nothing of a pattern with no match where the options are not known', () => {
    const name = '‹each file name matching `*.x`›';
    assert.deepStrictEqual(line('if q; then shopt -s nullglob; fi\nls *.x', 'ls', { line: 1 }), ['receives:', 'ls', name]);
    assert.deepStrictEqual(line('if q; then shopt -s failglob; fi\nls *.x', 'ls', { line: 1 }), ['receives:', 'ls', name]);
  });

  it('says nothing is known of a word that `set -k` may take, and tints no word with a CR', () => {
    assert.deepStrictEqual(line('if q; then set -k; fi; ls a=b c', 'ls'), ['receives:', 'ls', '‹the words of `a=b`›', 'c']);
    for (const src of ['ls a\r\n', 'ls a\r']) {
      const r = rows(src).find((x) => x.label === 'ls')!.receives!;
      assert.deepStrictEqual(r.chips.map((c) => c.asWritten), [true, undefined], JSON.stringify(src));
    }
    assert.strictEqual(shellState(parser.parse('ls a\r\n'), 'bash').blind, 'the script has CR LF line ends');
  });

  it('says a program or a function, in both languages, on the name too', () => {
    const src = '. ./lib.sh\nlg hello\nlg';
    const said = (at: number, lang: Lang) => { const r = rows(src, { line: at, lang }).find((x) => x.label === 'lg')!; return [r.name!.said.kind, r.name!.sourced, r.received, r.receives!.lead]; };
    assert.deepStrictEqual(said(1, 'en'), ['program or function', true, undefined, FILE_READ]);
    assert.deepStrictEqual(said(2, 'en'), ['program or function', true, undefined, 'a program, or a function of the file read, gets no arguments']);
    assert.deepStrictEqual(said(1, 'ja'), ['プログラムか関数', true, undefined, 'プログラムか、読み込んだファイルの関数で、受け取るのは:']);
    assert.deepStrictEqual(said(2, 'ja'), ['プログラムか関数', true, undefined, 'プログラムか、読み込んだファイルの関数で、引数はなし']);
    const key = rowModel(explain(src, 1), { depth: 1, receives: true }, 'en').key.find((k) => k.id === 'name:sourced');
    assert.deepStrictEqual([key?.sample, key?.text], ['program or function', 'a program, or a function of a file read before here']);
    assert.strictEqual(rowModel(explain('ls'), { depth: 1, receives: true }, 'en').key.some((k) => k.id === 'name:sourced'), false);
  });

  it('says what is true of a part bash takes out: the program gets it, though not as a word', () => {
    assert.strictEqual(run('bash', ['-c', 'A=1 printenv A']).stdout.toString(), '1\n');
    assert.strictEqual(run('bash', ['-c', 'cat <<<x']).stdout.toString(), 'x\n');
    assert.deepStrictEqual(line('A=1 printenv A', 'printenv'), ['receives:', 'printenv', 'A']);
    assert.deepStrictEqual(line('cat <<<x', 'cat'), ['receives only its name:', 'cat']);
    assert.ok(rows('cat <<<x').some((r) => r.label === '<<<x' && r.handled));
    assert.strictEqual(rowModel(explain('cat <<<x'), { depth: 1, receives: true }, 'en').marks.handledSays, 'bash handles it; it is not among the program\'s words');
  });
});

describe('the panel: what the program receives, in a shell that is not bash, against dash and busybox ash', () => {
  const programs: Record<'dash' | 'ash', string[] | undefined> = (() => {
    const dirs = [process.env.BASH_EXPLAINER_SHELLS, ...(process.env.PATH ?? '').split(':')].filter(Boolean) as string[];
    const find = (p: string): string | undefined => dirs.map((d) => path.join(d, p)).find((f) => fs.existsSync(f));
    const [d, b] = [find('dash'), find('busybox')];
    return { dash: d ? [d] : undefined, ash: b ? [b, 'sh'] : undefined };
  })();
  const running = (sh: 'dash' | 'ash', code: string) => {
    const r = run(programs[sh]![0], [...programs[sh]!.slice(1), '-c', code], { timeout: 5000 });
    return { out: r.stdout.toString(), err: r.stderr.toString(), status: r.status };
  };
  const PLAIN = (name: string, ...args: string[]): string[] => ['receives:', name, ...args];
  const INSIDE = (...args: string[]): string[] => ['runs inside the shell, gets:', ...args];

  it('says a builtin the shell lacks is looked for as a program', () => {
    const table: [string, string, Record<'sh' | 'dash' | 'ash', string[]>, Record<'dash' | 'ash', number>][] = [
      ['declare x=1', 'declare', { sh: PLAIN('declare', 'x=1'), dash: PLAIN('declare', 'x=1'), ash: PLAIN('declare', 'x=1') }, { dash: 127, ash: 127 }],
      ['typeset x=1', 'typeset', { sh: PLAIN('typeset', 'x=1'), dash: PLAIN('typeset', 'x=1'), ash: PLAIN('typeset', 'x=1') }, { dash: 127, ash: 127 }],
      ['let x=1', 'let', { sh: PLAIN('let', 'x=1'), dash: PLAIN('let', 'x=1'), ash: INSIDE('x=1') }, { dash: 127, ash: 0 }],
      ['source /dev/null', 'source', { sh: PLAIN('source', '/dev/null'), dash: PLAIN('source', '/dev/null'), ash: INSIDE('/dev/null') }, { dash: 127, ash: 0 }],
      ['shopt -s x', 'shopt', { sh: PLAIN('shopt', '-s', 'x'), dash: PLAIN('shopt', '-s', 'x'), ash: PLAIN('shopt', '-s', 'x') }, { dash: 127, ash: 127 }],
      ['mapfile x', 'mapfile', { sh: PLAIN('mapfile', 'x'), dash: PLAIN('mapfile', 'x'), ash: PLAIN('mapfile', 'x') }, { dash: 127, ash: 127 }],
      ['echo a', 'echo', { sh: INSIDE('a'), dash: INSIDE('a'), ash: INSIDE('a') }, { dash: 0, ash: 0 }],
    ];
    for (const [src, label, says, status] of table) {
      for (const shell of ['sh', 'dash', 'ash'] as const) assert.deepStrictEqual(line(src, label, { shell }), says[shell], `${src} in ${shell}`);
      for (const sh of ['dash', 'ash'] as const) if (programs[sh]) assert.strictEqual(running(sh, src).status, status[sh], `${src} in ${sh}`);
    }
    // (`local`, not POSIX, is a builtin of both: outside a function, each says so.)
    assert.deepStrictEqual(line('local x', 'local', { shell: 'sh' }), INSIDE('x'));
    for (const sh of ['dash', 'ash'] as const) if (programs[sh]) assert.match(running(sh, 'local x').err, /not in a function/);
    // (Nor has bash a builtin the table does not give it: bash says "not found".)
    assert.deepStrictEqual(line('print a', 'print'), PLAIN('print', 'a'));
    assert.strictEqual(run('bash', ['-c', 'PATH=/nonexistent; print a']).status, 127);
  });

  it('says no shell handles a keyword it lacks', () => {
    const handled = (src: string, shell: Sh): string[] => rows(src, { shell }).filter((r) => r.handled).map((r) => r.label);
    const table: [string, string[], string[], string[]][] = [
      ['[[ a ]]', [], [], ['[[ a ]]']],
      ['time true', [], [], []],
      ['coproc true', [], [], []],
      ['if [[ a ]]; then :; fi', ['if ‹condition› then ‹commands› fi'], ['if ‹condition› then ‹commands› fi'], ['if ‹condition› then ‹commands› fi', '[[ a ]]']],
      ['time a | b', ['a | b'], ['a | b'], ['a | b']],
    ];
    for (const [src, sh, dash, ash] of table) assert.deepStrictEqual([handled(src, 'sh'), handled(src, 'dash'), handled(src, 'ash')], [sh, dash, ash], src);
    assert.deepStrictEqual(handled('[[ a ]]', 'bash'), ['[[ a ]]']);
    assert.deepStrictEqual(handled('time true', 'bash'), ['time true']);
    // (A shell the table gives them.)
    assert.deepStrictEqual(handled('[[ a ]]', 'zsh'), ['[[ a ]]']);
    assert.deepStrictEqual(handled('coproc true', 'zsh'), ['coproc true']);
    assert.deepStrictEqual(handled('time true', 'zsh'), ['time true']);
    if (programs.dash) {
      assert.strictEqual(running('dash', '[[ a ]]').status, 127);
      assert.match(running('dash', '[[ a ]]').err, /\[\[: not found/);
      assert.doesNotMatch(running('dash', 'command -V time').out, /keyword/);
    }
    if (programs.ash) {
      assert.strictEqual(running('ash', '[[ a ]]').status, 0);
      assert.doesNotMatch(running('ash', 'command -V time').out, /keyword/);
      assert.strictEqual(running('ash', 'coproc true').status, 127);
    }
  });

  it('reads a `$"…"` as the shell does', () => {
    for (const shell of ['sh', 'dash', 'ash'] as const) assert.deepStrictEqual(line('printf "[%s]" $"hi"', 'printf', { shell }), INSIDE('[%s]', '$hi'), shell);
    assert.deepStrictEqual(line('printf "[%s]" $"$(x)"', 'printf', { shell: 'dash' }), INSIDE('[%s]', '‹the words of `$"$(x)"`›'));
    assert.deepStrictEqual(line('printf "[%s]" $"hi"', 'printf'), ['runs inside bash, gets:', '[%s]', 'hi']);
    for (const sh of ['dash', 'ash'] as const) if (programs[sh]) assert.strictEqual(running(sh, 'printf "[%s]" $"hi"').out, '[$hi]');
    assert.strictEqual(run('bash', ['-c', 'printf "[%s]" $"hi"']).stdout.toString(), '[hi]');
  });

  it('says the shell stops, not bash', () => {
    const fails = (shell: Sh, lang: Lang) => rows('x=; printf a ${x:?}', { shell, lang }).find((r) => r.label === 'printf')!.receives!.fails;
    assert.strictEqual(fails('sh', 'en'), 'the shell stops here, so it does not run: a variable is empty or not set (`${x:?}`)');
    assert.strictEqual(fails('dash', 'ja'), 'シェルがここで止まり、実行されない: 変数が空か設定されていない（`${x:?}`）');
    assert.strictEqual(fails('bash', 'en'), 'bash stops here, so it does not run: a variable is empty or not set (`${x:?}`)');
    for (const sh of ['dash', 'ash'] as const) if (programs[sh]) assert.strictEqual(running(sh, 'x=; printf a ${x:?}').out, '');
  });
});

describe('the panel: a word a host pastes as text', () => {
  const hosted = (kind: HostKind, src: string, at: number, label: string): string[] => {
    const extracted = extractShell(kind, src);
    const ex = explainHostedLine(new Analyzer('en'), parser.parse(extracted.text), extracted, src.split('\n'), at, 'en', undefined, OPTIONS)!;
    const r = all(rowModel(ex, { depth: 2, receives: true }, 'en').rows).find((x) => x.label === label)!.receives!;
    return [r.lead, ...r.chips.map((c) => shown(c) + (c.many ? '*' : ''))];
  };
  const step = (run: string, shell = ''): string => `on: push\njobs:\n  a:\n    runs-on: x\n    steps:\n      - ${shell ? `shell: ${shell}\n        ` : ''}run: ${run}\n`;

  it('is any number of words, under bash too', () => {
    // (What the runner pastes: `a" "b` makes two words of the one written.)
    assert.strictEqual(run('bash', ['-c', 'printf "[%s]" "a" "b"']).stdout.toString(), '[a][b]');
    const words = ['runs inside bash, gets:', '%s', '‹the words of `"${{ env.Y }}"`›*'];
    assert.deepStrictEqual(hosted('yaml', step('printf %s "${{ env.Y }}"'), 5, 'printf'), words);
    assert.deepStrictEqual(hosted('yaml', step('printf %s "${{ env.Y }}"', 'bash'), 6, 'printf'), words);
    assert.deepStrictEqual(hosted('yaml', step('printf %s "${{ env.Y }}" lit "$x"', 'bash'), 6, 'printf'), [...words, 'lit', '‹value of `$x`›']);
    assert.deepStrictEqual(hosted('yaml', step('echo a${{ env.Y }}b{c,d}'), 5, 'echo'), ['runs inside bash, gets:', '‹the words of `a${{ env.Y }}b{c,d}`›*']);
    const make = (recipe: string, first = ''): string => `${first}all:\n\t${recipe}\n`;
    assert.deepStrictEqual(hosted('makefile', make('cp "$(DST)" x', 'SHELL := /bin/bash\n'), 2, 'cp'), ['receives:', 'cp', '‹the words of `"$(DST)"`›*', 'x']);
    assert.deepStrictEqual(hosted('makefile', make('cp "$(DST)" x'), 1, 'cp'), ['receives:', 'cp', '‹the words of `"$(DST)"`›*', 'x']);
    // (A variable of the shell is the shell's: `$$f` is `$f` to it.)
    assert.deepStrictEqual(hosted('makefile', make('f=a; echo "$$f"', 'SHELL := /bin/bash\n'), 2, 'echo'), ['runs inside bash, gets:', 'a']);
  });
});
