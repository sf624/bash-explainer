// The steps of the panel's Reading view and what each node shows there (src/ui/readingSteps.ts), and the view slot's
// contract (src/ui/panelView.ts: `panelState`, `needsReading`, `viewControl`; docs/design/panel-redesign.md, 6.1).
// media/panel.js draws what these say; it decides none of it (docs/design/sources.md, SB2).
import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import type { ReadingNode } from '../src/reading';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { isPressed, needsReading, PANEL_DEFAULTS, PanelState, panelState, panelUpdate, viewControl } from '../src/ui/panelView';
import {
  aboutKey, bandOf, chipOf, DrawnNode, layerOfStep, levelOf, measureSteps, ownStep, readerOf, readingView, roleOf, startsBand, stepFrom, stepNames, STEPS,
} from '../src/ui/readingSteps';

const parser = createUnbashParser();
const reading = (src: string, lang: 'en' | 'ja' = 'en') => new Analyzer(lang).explainLine(parser.parse(src), 0, 'bash', { reading: true }).reading!;
const span = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
/** A node of the reading tree, for the cases no short line gives. */
const node = (n: Partial<ReadingNode> & Pick<ReadingNode, 'layer' | 'kind'>): ReadingNode => ({ label: 'x', span, children: [], ...n });
const drawn = (root: DrawnNode): DrawnNode[] => [root, ...root.children.flatMap(drawn)];
const find = (root: DrawnNode, layer: string, label: string) => drawn(root).find((n) => n.layer === layer && n.label === label)!;

describe('the steps of Reading (src/ui/readingSteps.ts)', () => {
  it('puts each node at its own step, or its parent\'s when that is later', () => {
    assert.strictEqual(STEPS, 8);
    assert.deepStrictEqual(['line', 'pipeline', 'command', 'argument', 'quote'].map((kind) => ownStep({ layer: 'bash', kind })), [1, 2, 3, 4, 5]);
    assert.deepStrictEqual((['child', 'command', 'language'] as const).map((layer) => ownStep({ layer, kind: 'argument' })), [6, 7, 8]);
    assert.deepStrictEqual([1, 4, 5, 6, 7, 8].map(levelOf), [1, 1, 1, 2, 3, 4]);
    assert.deepStrictEqual([1, 5, 6, 7, 8].map(layerOfStep), ['bash', 'bash', 'child', 'command', 'language']);
    const view = readingView(reading('x=$(date +%F); [[ $x =~ ^a+ ]]'), 'en');
    // (The regex of `=~` is a word of step 4, read as a language at step 8; date's format under the subshell at 6.)
    assert.deepStrictEqual(['line', 'list', 'command', 'assignment', 'substitution'].map((kind) => drawn(view.root).find((n) => n.kind === kind)!.appears), [1, 2, 3, 4, 5]);
    assert.strictEqual(find(view.root, 'child', 'date +%F').appears, 6);
    assert.strictEqual(find(view.root, 'command', '+%F').appears, 7);
    assert.strictEqual(find(view.root, 'language', 'regex').appears, 8);
    assert.deepStrictEqual(view.steps.map((s) => s.adds), [true, true, true, true, true, true, true, true]);
  });

  it('counts what each step adds, and the arrows pass over the steps that add nothing', () => {
    const m = measureSteps(reading('tar -czf "$b" *.txt'));
    // (No list, no script inside, no language.)
    assert.deepStrictEqual(m.added.map((n) => n > 0), [true, false, true, true, true, false, true, false]);
    assert.deepStrictEqual([stepFrom(1, 1, m.added), stepFrom(3, -1, m.added), stepFrom(5, 1, m.added), stepFrom(7, 1, m.added), stepFrom(1, -1, m.added)], [3, 1, 7, 7, 1]);
    const view = readingView(reading('tar -czf "$b" *.txt'), 'en');
    assert.deepStrictEqual(view.steps.map((s) => [s.adds, s.back, s.forward]), [
      [true, 1, 3], [false, 1, 3], [true, 1, 4], [true, 3, 5], [true, 4, 7], [false, 5, 7], [true, 5, 7], [false, 7, 8],
    ]);
    assert.strictEqual(view.steps[0].full, 'Step 1 of 8: the line');
    assert.strictEqual(view.steps[1].said, 'Step 2 of 8: lists and pipelines');
    assert.match(view.steps[1].full, /^Step 2 of 8: lists and pipelines \(.+\)$/);
    assert.strictEqual(readingView(reading('tar -czf "$b" *.txt', 'ja'), 'ja').steps[0].full, 'ステップ 1/8：行');
  });

  it('names the steps, with the layer each adds', () => {
    assert.deepStrictEqual(stepNames('en').map((s) => `${s.short}:${s.layer}`), ['Line:bash', 'Lists:bash', 'Commands:bash', 'Words:bash', 'Inside:bash', 'Scripts:child', 'Arguments:command', 'Languages:language']);
    assert.deepStrictEqual(stepNames('ja').map((s) => s.short), ['行', 'リスト', 'コマンド', '単語', '単語の中', 'スクリプト', '引数', '言語']);
  });

  it('says what a kind is in general on its first node only, by step and then in order', () => {
    const view = readingView(reading('x=$(date +%F); [[ $x =~ ^a+ ]]'), 'en');
    const about = drawn(view.root).filter((n) => n.about).map((n) => `${n.layer}/${n.kind} ${n.label}`);
    assert.deepStrictEqual(about, ['bash/line ', 'bash/command x=$(date +%F)', 'child/script date +%F', 'child/argument +%F', 'language/language date', 'language/language regex']);
    // (The regex of `=~` is bash's own language; date's format is date's.)
    assert.match(find(view.root, 'language', 'regex').about!, /POSIX extended regular expression|ERE/);
    // A kind seen first deep under a later step goes to the node that appears earlier.
    const late = node({ layer: 'child', kind: 'word', children: [] });
    const early = node({ layer: 'bash', kind: 'word' });
    const root = node({ layer: 'bash', kind: 'line', children: [node({ layer: 'child', kind: 'script', children: [late] }), early] });
    const m = measureSteps(root);
    assert.ok(m.aboutAt.has(early) && !m.aboutAt.has(late));
    // A node a token explains has no general text.
    assert.ok(!measureSteps(node({ layer: 'bash', kind: 'line', text: 'said' })).aboutAt.size);
  });

  it('keys the general texts by kind, a language by who reads it, and a language\'s own tokens not at all', () => {
    assert.strictEqual(aboutKey({ layer: 'bash', kind: 'argument', label: 'a' }), 'argument');
    assert.strictEqual(aboutKey({ layer: 'language', kind: 'language', label: 'regex', reader: 'bash' }), 'bashLanguage');
    assert.strictEqual(aboutKey({ layer: 'language', kind: 'language', label: 'prompt', reader: 'bash' }), 'promptLanguage');
    assert.strictEqual(aboutKey({ layer: 'language', kind: 'language', label: 'sed', reader: 'sed' }), 'language');
    assert.strictEqual(aboutKey({ layer: 'language', kind: 'keyword', label: '^', reader: 'bash' }), '');
    // (No general text for that key: none is drawn.)
    const lang = node({ layer: 'language', kind: 'language', label: 'sed', reader: 'sed', children: [node({ layer: 'language', kind: 'keyword', reader: 'sed' })] });
    assert.strictEqual(readingView(node({ layer: 'bash', kind: 'line', text: 'said', children: [lang] }), 'en').root.children[0].children[0].about, undefined);
  });

  it('shows each node with its kind, the command name with what it runs, a value with its option', () => {
    const view = readingView(reading('tar -czf "$b" *.txt'), 'en');
    assert.deepStrictEqual(['', 'tar -czf "$b" *.txt', 'tar', '-czf'].map((l) => find(view.root, 'bash', l).chip), ['bash reads the line', 'simple command', 'command name', 'argument']);
    assert.strictEqual(find(view.root, 'command', '"$b"').chip, 'value of -f');
    assert.strictEqual(find(view.root, 'command', '-c').chip, 'option');
    const ja = readingView(reading('tar -czf "$b" *.txt', 'ja'), 'ja');
    assert.strictEqual(find(ja.root, 'command', '"$b"').chip, '-f の値');
    assert.strictEqual(find(readingView(reading('date +%F'), 'en').root, 'command', '+%F').chip, 'operand');
    assert.strictEqual(find(readingView(reading('date +%F'), 'en').root, 'language', 'date').chip, 'date format');
  });

  it('shows the cases no short line in the tests above gives', () => {
    const en = (n: Partial<ReadingNode> & Pick<ReadingNode, 'layer' | 'kind'>) => chipOf(node(n), 'en');
    // A value that bash expands first; an operand that does; a language the table does not name; a kind of no table.
    assert.strictEqual(en({ layer: 'command', kind: 'argument', valueFor: '-f', expands: 'glob' }), 'value of -f: the first of the expanded words; the rest are operands');
    assert.strictEqual(en({ layer: 'command', kind: 'argument', expands: 'split' }), 'operand: each word it splits into');
    assert.strictEqual(en({ layer: 'language', kind: 'language', label: 'brainfuck' }), 'brainfuck');
    assert.strictEqual(en({ layer: 'bash', kind: 'unheard-of' }), 'unheard-of');
    // A command name with what bash runs for it, when it has no name badge to say so.
    assert.strictEqual(en({ layer: 'bash', kind: 'commandName', resolves: 'builtin' }), 'command name · builtin');
    assert.strictEqual(en({ layer: 'command', kind: 'command', resolves: 'file', name: { kind: 'program' } as unknown as ReadingNode['name'] }), 'command name');
  });

  it('says who reads each node, and where a new reader\'s band starts', () => {
    const view = readingView(reading('x=$(date +%F); [[ $x =~ ^a+ ]]'), 'en');
    assert.deepStrictEqual(drawn(view.root).filter((n) => n.band !== undefined).map((n) => `${n.label}: ${n.band}`), [': bash', 'date +%F: subshell', '+%F: date reads', 'date: date format', 'regex: regex']);
    assert.strictEqual(find(view.root, 'child', 'date +%F').readBy, 'a subshell (a copy of this shell) parses it again');
    assert.strictEqual(find(view.root, 'command', '+%F').readBy, 'date reads it, not bash');
    assert.strictEqual(find(view.root, 'language', 'regex').readBy, 'bash reads it itself (its regex matching, POSIX ERE)');
    assert.strictEqual(find(view.root, 'bash', '$x').readBy, 'bash parses it');
    // (A language's own tokens are in its band: no name of their own.)
    assert.strictEqual(bandOf(node({ layer: 'language', kind: 'keyword' }), 'en'), '');
    assert.strictEqual(readerOf(node({ layer: 'language', kind: 'language', label: 'prompt', reader: 'bash' }), 'en'), 'bash reads it itself, each time it prints the prompt');
    // A script a command gives a shell, and one whose shell is not said (a substitution's: a subshell).
    assert.strictEqual(readerOf(node({ layer: 'child', kind: 'script', process: 'shell' }), 'en'), 'a newly started shell (another process) parses it again');
    assert.strictEqual(readerOf(node({ layer: 'child', kind: 'script' }), 'en'), readerOf(node({ layer: 'child', kind: 'script', process: 'subshell' }), 'en'));
    assert.strictEqual(bandOf(node({ layer: 'child', kind: 'script' }), 'ja'), 'サブシェル');
    assert.strictEqual(bandOf(node({ layer: 'child', kind: 'script', process: 'remote' }), 'en'), 'remote shell');
    // Another command, another shell: another band, in the same layer.
    const a = node({ layer: 'command', kind: 'argument', reader: 'xargs' });
    assert.ok(startsBand(node({ layer: 'command', kind: 'argument', reader: 'grep' }), a));
    assert.ok(!startsBand(node({ layer: 'command', kind: 'argument', reader: 'xargs' }), a));
    assert.ok(startsBand(node({ layer: 'child', kind: 'script', process: 'shell' }), node({ layer: 'child', kind: 'script' })));
    assert.ok(!startsBand(node({ layer: 'bash', kind: 'word' }), node({ layer: 'bash', kind: 'line' })));
  });

  it('colours a node\'s code by the role of its kind, as the list colours its tokens', () => {
    assert.deepStrictEqual(['commandName', 'expandedName', 'quote', 'pipeline', 'script', 'option'].map((kind) => roleOf({ kind })), ['command', 'variable', 'string', 'operator', 'substitution', 'option']);
  });
});

describe('the view slot\'s contract (src/ui/panelView.ts)', () => {
  it('reads a kept state: the view, the step (from the layers kept before the steps), nothing else', () => {
    assert.deepStrictEqual(panelState({ view: 'tree', step: 7 }), { view: 'tree', step: 7, level: 3 });
    assert.deepStrictEqual(panelState({ view: 'list', level: 2 }), { view: 'list', step: 6, level: 2 });
    assert.deepStrictEqual(panelState({ step: 2, level: 4 }), { step: 2, level: 1 });
    for (const kept of [undefined, null, 'tree', 3, {}, { view: 'graph', step: 9, level: 5 }, { step: 2.5, level: 0 }, { step: '3' }]) assert.deepStrictEqual(panelState(kept), {}, JSON.stringify(kept));
  });

  it('keeps every field of the state: a field added to PanelState and not read back fails here', () => {
    // (Required<PanelState>: a new field must be given a value here, and `panelState` must keep it.)
    const every: Required<PanelState> = { view: 'tree', step: 7, level: 3 };
    assert.deepStrictEqual(panelState(every), every);
    assert.deepStrictEqual(panelState(JSON.parse(JSON.stringify(panelState(every)))), every);
  });

  it('presses an option by one rule: the state, with its defaults, has everything the option sets', () => {
    assert.deepStrictEqual(PANEL_DEFAULTS, { view: 'list', step: STEPS });
    assert.ok(isPressed({}, { view: 'list' }) && !isPressed({}, { view: 'tree' }));
    assert.ok(isPressed({ view: 'tree', step: 3 }, { view: 'tree' }));
    assert.ok(isPressed({ step: 3 }, { view: 'list', step: 3 }) && !isPressed({ step: 3 }, { view: 'list', step: 8 }));
    assert.ok(isPressed({ view: 'tree' }, {}), 'an option that sets nothing is always shown');
    // viewControl applies it to each option.
    for (const state of [{}, { view: 'list' as const }, { view: 'tree' as const, step: 2 }]) {
      for (const o of viewControl(state, 'en').options) assert.strictEqual(o.pressed, isPressed(state, o.sets), `${JSON.stringify(state)} ${o.id}`);
    }
  });

  it('says when the explanation needs the reading tree: in the tree view only', () => {
    assert.deepStrictEqual([{}, { view: 'list' as const, step: 8 }, { view: 'tree' as const }].map(needsReading), [false, false, true]);
  });

  it('describes the view control as data: the options, their names, the one pressed, what a press sets', () => {
    const en = viewControl({}, 'en');
    assert.strictEqual(en.label, 'View');
    assert.deepStrictEqual(en.options.map((o) => [o.id, o.short, o.full, o.pressed, JSON.stringify(o.sets), o.steps?.length]), [
      ['list', 'Meaning', 'Meaning', true, '{"view":"list"}', undefined],
      ['tree', 'Reading', 'Reading', false, '{"view":"tree"}', 8],
    ]);
    const ja = viewControl({ view: 'tree', step: 3 }, 'ja');
    assert.deepStrictEqual(ja.options.map((o) => `${o.short} ${o.pressed}`), ['意味 false', '読まれ方 true']);
    assert.strictEqual(ja.label, '表示');
    assert.deepStrictEqual(ja.options[1].steps, stepNames('ja'));
    // (No option is drawn as an icon alone: none has an icon yet.)
    assert.ok(en.options.every((o) => o.icon === undefined && o.short));
  });

  it('sends the control and the reading view with the line; the explanation goes without its tree', () => {
    const ex = new Analyzer('en').explainLine(parser.parse('ls -l'), 0, 'bash', { reading: true });
    const msg = panelUpdate({ lang: 'en', explanation: ex, file: 'a.sh', line: 0, lineText: 'ls -l', choice: {}, placement: 'first', animations: true, state: { view: 'tree' } });
    assert.deepStrictEqual(msg.control, viewControl({ view: 'tree' }, 'en'));
    assert.strictEqual(msg.reading?.root.chip, 'bash reads the line');
    assert.strictEqual(msg.reading?.steps.length, STEPS);
    assert.ok(!('reading' in msg.explanation));
    const list = panelUpdate({ lang: 'en', explanation: new Analyzer('en').explainLine(parser.parse('ls -l'), 0, 'bash'), file: 'a.sh', line: 0, lineText: 'ls -l', choice: {}, placement: 'first', animations: true });
    assert.strictEqual(list.reading, undefined);
    assert.strictEqual(list.control.options[0].pressed, true);
  });
});
