// What each node of the reading tree is on a row of depth 2 (src/ui/panelRoles.ts), and the view slot's contract (src/ui/panelView.ts:
// `panelState`, `explainNeeds`, `viewControl`; docs/design/panel-redesign.md, 6.1). media/panel.js draws what these say; it decides none of it.
import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import { type ReadingNode, readingNodes } from '../src/reading';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { explainNeeds, isPressed, PANEL_DEFAULTS, PanelState, panelState, panelUpdate, shownDiffers, viewControl } from '../src/ui/panelView';
import { panelTools, viewControlForms } from '../src/ui/panelHead';
import { aboutKey, aboutOf, bandOf, chipOf, readerOf, roleFor, roleLine, roleOf, startsBand } from '../src/ui/panelRoles';

const parser = createUnbashParser();
const reading = (src: string, lang: 'en' | 'ja' = 'en') => new Analyzer(lang).explainLine(parser.parse(src), 0, 'bash', { reading: true }).reading!;
const span = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
/** A node of the reading tree, for the cases no short line gives. */
const node = (n: Partial<ReadingNode> & Pick<ReadingNode, 'layer' | 'kind'>): ReadingNode => ({ label: 'x', span, children: [], ...n });
const find = (root: ReadingNode, layer: string, label: string) => readingNodes(root).find((n) => n.layer === layer && n.label === label)!;
/** The node `n` and the one around it. */
const upOf = (root: ReadingNode, n: ReadingNode): ReadingNode | undefined => readingNodes(root).find((u) => u.children.includes(n));

describe('the roles of a row (src/ui/panelRoles.ts)', () => {
  it('keys the general texts by kind, a language by who reads it, and a language\'s own tokens not at all', () => {
    assert.strictEqual(aboutKey({ layer: 'bash', kind: 'argument', label: 'a' }), 'argument');
    assert.strictEqual(aboutKey({ layer: 'language', kind: 'language', label: 'regex', reader: 'bash' }), 'bashLanguage');
    assert.strictEqual(aboutKey({ layer: 'language', kind: 'language', label: 'prompt', reader: 'bash' }), 'promptLanguage');
    assert.strictEqual(aboutKey({ layer: 'language', kind: 'language', label: 'sed', reader: 'sed' }), 'language');
    assert.strictEqual(aboutKey({ layer: 'language', kind: 'keyword', label: '^', reader: 'bash' }), '');
    // (No general text for that key: none is said.)
    assert.strictEqual(aboutOf(node({ layer: 'language', kind: 'keyword', reader: 'sed' }), 'en'), undefined);
    assert.match(aboutOf(node({ layer: 'bash', kind: 'descriptor' }), 'en')!, /file descriptor/i);
  });

  it('shows each node with its kind, the command name with what it runs, a value with its option', () => {
    const root = reading('tar -czf "$b" *.txt');
    assert.deepStrictEqual(['tar -czf "$b" *.txt', 'tar', '-czf'].map((l) => chipOf(find(root, 'bash', l), 'en')), ['simple command', 'command name', 'argument']);
    assert.strictEqual(chipOf(find(root, 'command', '"$b"'), 'en'), 'value of -f');
    assert.strictEqual(chipOf(find(root, 'command', '-c'), 'en'), 'option');
    assert.strictEqual(chipOf(find(reading('tar -czf "$b" *.txt', 'ja'), 'command', '"$b"'), 'ja'), '-f の値');
    assert.strictEqual(chipOf(find(reading('date +%F'), 'command', '+%F'), 'en'), 'operand');
    assert.strictEqual(chipOf(find(reading('date +%F'), 'language', 'date'), 'en'), 'date format');
  });

  it('shows the cases no short line in the tests above gives', () => {
    const en = (n: Partial<ReadingNode> & Pick<ReadingNode, 'layer' | 'kind'>) => chipOf(node(n), 'en');
    // A value that bash expands first; an operand that does; a language the table does not name.
    assert.strictEqual(en({ layer: 'command', kind: 'argument', valueFor: '-f', expands: 'glob' }), 'value of -f: the first of the expanded words; the rest are operands');
    assert.strictEqual(en({ layer: 'command', kind: 'argument', expands: 'split' }), 'operand: each word it splits into');
    assert.strictEqual(en({ layer: 'language', kind: 'language', label: 'brainfuck' }), 'brainfuck');
    assert.strictEqual(en({ layer: 'bash', kind: 'unheard-of' }), '');
    // (Inside a language, and on a piece of a word bash has no node for, a token's kind is no place: no name.)
    assert.strictEqual(en({ layer: 'language', kind: 'keyword' }), '');
    assert.strictEqual(en({ layer: 'child', kind: 'pattern' }), '');
    assert.strictEqual(en({ layer: 'command', kind: 'pattern' }), '');
    // A command name with what bash runs for it, when it has no name badge to say so.
    assert.strictEqual(en({ layer: 'bash', kind: 'commandName', resolves: 'builtin' }), 'command name · builtin');
    assert.strictEqual(en({ layer: 'command', kind: 'command', resolves: 'file', name: { kind: 'program' } as unknown as ReadingNode['name'] }), 'command name');
  });

  it('says who reads each node, and where a new reader\'s band starts', () => {
    const root = reading('x=$(date +%F); [[ $x =~ ^a+ ]]');
    const roles = readingNodes(root).map((n) => [n, roleFor(n, upOf(root, n), 'en')] as const);
    assert.deepStrictEqual(roles.filter(([, r]) => r?.band !== undefined).map(([n, r]) => `${n.label}: ${r!.band}`), [': bash', 'date +%F: subshell', '+%F: date reads it', 'date: date format', 'regex: regex']);
    assert.strictEqual(readerOf(find(root, 'child', 'date +%F'), 'en'), 'a subshell (a copy of this shell) parses it again');
    assert.strictEqual(readerOf(find(root, 'command', '+%F'), 'en'), 'date reads it, not bash');
    assert.strictEqual(readerOf(find(root, 'language', 'regex'), 'en'), 'bash reads it itself (its regex matching, POSIX ERE)');
    assert.strictEqual(readerOf(find(root, 'bash', '$x'), 'en'), 'bash parses it');
    // (A language's own tokens have no role.)
    assert.strictEqual(roleFor(node({ layer: 'language', kind: 'keyword' }), undefined, 'en'), undefined);
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

  it('says a row\'s roles on one line: the names in order, an arrow where another reader takes it, the last reader', () => {
    const line = (src: string, layer: string, label: string) => {
      const root = reading(src);
      const n = find(root, layer, label);
      const up = upOf(root, n);
      return roleLine([...(up && up.layer !== n.layer ? [roleFor(up, upOf(root, up), 'en')!] : []), roleFor(n, up, 'en')!])!;
    };
    const said = (l: ReturnType<typeof roleLine>) => l!.chips.map((c) => `${c.changes ? '→ ' : ''}${c.text}`).join(' | ') + (l!.reader ? ` | ${l!.reader}` : '');
    assert.strictEqual(said(line('tar -czf "$b" x', 'command', '"$b"')), 'argument | → value of -f | tar reads it');
    assert.strictEqual(line('x=$(date +%F)', 'child', 'date +%F').reader, 'subshell');
    assert.strictEqual(roleLine([]), undefined);
    // (bash taking over says no reader: it is the default.)
    assert.strictEqual(roleLine([roleFor(node({ layer: 'bash', kind: 'word' }), undefined, 'en')!])!.reader, undefined);
    // (The same name twice is one name; it opens to who reads it, and what the kind is.)
    const name = roleFor(node({ layer: 'bash', kind: 'argument' }), node({ layer: 'bash', kind: 'line' }), 'en')!;
    assert.deepStrictEqual(roleLine([name, name])!.chips.length, 1);
    assert.match(roleLine([name])!.chips[0].said, /An argument: bash expands it.*\(bash parses it\)/);
    assert.strictEqual(roleLine([roleFor(node({ layer: 'bash', kind: 'operator' }), node({ layer: 'bash', kind: 'line' }), 'en')!])!.chips[0].said, 'bash parses it');
  });

  it('colours a node\'s code by the role of its kind, as the list colours its tokens', () => {
    assert.deepStrictEqual(['commandName', 'expandedName', 'quote', 'pipeline', 'script', 'option'].map((kind) => roleOf({ kind })), ['command', 'variable', 'string', 'operator', 'substitution', 'option']);
  });
});

describe('the view slot\'s contract (src/ui/panelView.ts)', () => {
  it('reads a kept state: the depth; a view kept before the depths opens at the depth it has become', () => {
    assert.deepStrictEqual(panelState({ depth: 2 }), { depth: 2 });
    assert.deepStrictEqual(panelState({ depth: 1, view: 'tree' }), { depth: 1 });
    assert.deepStrictEqual(panelState({ view: 'tree', step: 7, level: 3 }), { depth: 2 });
    assert.deepStrictEqual(panelState({ view: 'list', level: 2 }), { depth: 1 });
    for (const kept of [undefined, null, 'tree', 3, {}, { view: 'graph', step: 9, level: 5 }, { step: 2 }, { depth: 3 }, { depth: '2' }]) assert.deepStrictEqual(panelState(kept), {}, JSON.stringify(kept));
  });

  it('keeps every field of the state: a field added to PanelState and not read back fails here', () => {
    // (Required<PanelState>: a new field must be given a value here, and `panelState` must keep it.)
    const every: Required<PanelState> = { depth: 2, receives: false };
    assert.deepStrictEqual(panelState(every), every);
    assert.deepStrictEqual(panelState(JSON.parse(JSON.stringify(panelState(every)))), every);
  });

  it('presses an option by one rule: the state, with its defaults, has everything the option sets', () => {
    assert.deepStrictEqual(PANEL_DEFAULTS, { depth: 1, receives: true });
    assert.ok(isPressed({}, { depth: 1 }) && !isPressed({}, { depth: 2 }));
    assert.ok(isPressed({ depth: 2 }, { depth: 2 }));
    assert.ok(isPressed({ depth: 2 }, {}), 'an option that sets nothing is always shown');
    // viewControl applies it to each option.
    for (const state of [{}, { depth: 1 as const }, { depth: 2 as const }]) {
      for (const o of viewControl(state, 'en').options) assert.strictEqual(o.pressed, isPressed(state, o.sets), `${JSON.stringify(state)} ${o.id}`);
    }
  });

  it('says what the explanation needs: the reading tree at both depths, what each program receives with the switch on, the marks of POSIX sh either way', () => {
    assert.deepStrictEqual(
      [{}, { depth: 1 as const }, { depth: 2 as const }, { receives: false }, { depth: 2 as const, receives: false }].map(explainNeeds),
      [
        { reading: true, argv: true, notPosix: true },
        { reading: true, argv: true, notPosix: true },
        { reading: true, argv: true, notPosix: true },
        { reading: true, argv: false, notPosix: true },
        { reading: true, argv: false, notPosix: true },
      ],
    );
    // (A host draws the line again for another depth or the switch turned, not for the default chosen.)
    assert.strictEqual(shownDiffers({}, { depth: 1, receives: true }), false, 'what was the default, chosen');
    assert.strictEqual(shownDiffers({}, { depth: 2 }), true);
    assert.strictEqual(shownDiffers({}, { receives: false }), true);
    assert.strictEqual(shownDiffers({ depth: 2 }, { depth: 2, receives: true }), false);
  });

  it('keeps the switch only once it was chosen, and a value that is no choice not at all', () => {
    assert.deepStrictEqual(panelState({ depth: 1 }), { depth: 1 });
    assert.deepStrictEqual(panelState({ receives: false }), { receives: false });
    assert.deepStrictEqual(panelState({ receives: 'no' }), {});
    assert.deepStrictEqual(panelState({ view: 'tree', receives: true }), { depth: 2, receives: true });
  });

  it('describes the view control as data: the depths, their names, the one pressed, what a press sets', () => {
    const en = viewControl({}, 'en');
    assert.strictEqual(en.label, 'Depth');
    assert.deepStrictEqual(en.options.map((o) => [o.id, o.short, o.full, o.tip, o.said, o.pressed, JSON.stringify(o.sets)]), [
      ['depth1', 'Overview', 'What it does', 'What it does (key 1 in the panel)', 'Depth: Overview (What it does)', true, '{"depth":1}'],
      ['depth2', 'Word by word', 'How bash reads it, word by word', 'How bash reads it, word by word (key 2 in the panel)', 'Depth: Word by word (How bash reads it, word by word)', false, '{"depth":2}'],
    ]);
    const ja = viewControl({ depth: 2 }, 'ja');
    assert.deepStrictEqual(ja.options.map((o) => `${o.short} ${o.full} ${o.tip} ${o.pressed}`), ['概要 何をするか 何をするか（パネルの中ではキー 1） false', '単語ごと bash が単語ごとにどう読むか bash が単語ごとにどう読むか（パネルの中ではキー 2） true']);
    // (A script read as another shell: not "bash" in the full name.)
    assert.strictEqual(viewControl({}, 'en', 'sh').options[1].full, 'How the shell reads it, word by word');
    assert.strictEqual(ja.label, '深さ');
    // (No option is drawn as an icon alone: none has an icon yet.)
    assert.ok(en.options.every((o) => o.icon === undefined && o.short));
  });

  it('sends the control and the rows of the depth with the line; the explanation goes without its tree', () => {
    const ex = new Analyzer('en').explainLine(parser.parse('ls -l'), 0, 'bash', { reading: true });
    const msg = panelUpdate({ lang: 'en', explanation: ex, file: 'a.sh', line: 0, lineText: 'ls -l', choice: {}, placement: 'first', animations: true, state: { depth: 2 } });
    assert.deepStrictEqual(msg.control, viewControl({ depth: 2 }, 'en'));
    // (And the forms the panel's own header may draw it in, and its tools' names: src/ui/panelHead.ts.)
    assert.deepStrictEqual(msg.viewForms, viewControlForms(msg.control));
    assert.deepStrictEqual(msg.tools, panelTools('en'));
    assert.strictEqual(msg.depth, 2);
    assert.deepStrictEqual(msg.rows[0].roleLine!.chips.map((c) => c.text), ['simple command', 'command name']);
    assert.ok(!('reading' in msg) && !('reading' in msg.explanation));
    const one = panelUpdate({ lang: 'en', explanation: new Analyzer('en').explainLine(parser.parse('ls -l'), 0, 'bash'), file: 'a.sh', line: 0, lineText: 'ls -l', choice: {}, placement: 'first', animations: true });
    assert.strictEqual(one.depth, 1);
    assert.strictEqual(one.rows[0].roleLine, undefined);
    assert.strictEqual(one.control.options[0].pressed, true);
  });
});
