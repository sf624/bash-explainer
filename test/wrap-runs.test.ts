// Where the web page's editor may wrap a long line (src/ui/wrapRuns.ts), and where its hover card goes
// (src/ui/cardPlace.ts): docs/design/chrome-redesign.md, C1a. test/web-wrap.test.ts runs both in the browser.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { openDocument } from '../src/document-setup';
import type { FileKind } from '../src/document-setup';
import { hostKind } from '../src/hosts';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { fields, type SyntaxNode } from '../src/syntax/tree';
import { CARD_CAP, CARD_GRACE, CARD_MIN, cardPlace, towardCard } from '../src/ui/cardPlace';
import { blankRuns, type Run, wrapRuns } from '../src/ui/wrapRuns';
import { corpus } from './support/corpus';

const parser = createUnbashParser();
const docOf = (text: string, kind: FileKind = 'shell') => openDocument(text, kind, (t) => parser.parse(t));
/** The runs of each line, as their texts. */
const texts = (text: string, kind: FileKind = 'shell') => {
  const doc = docOf(text, kind);
  return wrapRuns(doc).map((runs, i) => runs.map(([a, b]) => doc.lines[i].slice(a, b)));
};

/** What every line's runs must be: in order, apart, not starting or ending with a blank, and covering every other character. */
function sound(line: string, runs: readonly Run[]): string | undefined {
  let at = 0;
  for (const [a, b] of runs) {
    if (a < at || b <= a || b > line.length) return `bad run [${a}, ${b}) after ${at}`;
    if (/[ \t]/.test(line[a]) || /[ \t]/.test(line[b - 1])) return `a run with a blank at an end: ${JSON.stringify(line.slice(a, b))}`;
    if (/[^ \t]/.test(line.slice(at, a))) return `text outside a run: ${JSON.stringify(line.slice(at, a))}`;
    at = b;
  }
  if (/[^ \t]/.test(line.slice(at))) return `text outside a run: ${JSON.stringify(line.slice(at))}`;
  return undefined;
}

/** The words bash reads in a command, by the command's structure (its name, arguments, assignments' values and redirections' targets). */
function commandWords(n: SyntaxNode, out: SyntaxNode[] = []): SyntaxNode[] {
  // (An array's words are words of their own: `a=(1 2)`, also as an argument, `declare a=(1 2)`.)
  const hasArray = (w: SyntaxNode): boolean => w.type === 'array' || w.children.some(hasArray);
  const add = (w: SyntaxNode) => !hasArray(w) && out.push(w);
  if (n.type === 'command') {
    for (const c of n.namedChildren) {
      if (c.type === 'command_name' || c.field === 'argument') add(c);
      if (c.type === 'variable_assignment') fields(c, 'value').forEach(add);
      if (c.type === 'file_redirect') fields(c, 'destination').forEach(add);
    }
  }
  for (const c of n.children) commandWords(c, out);
  return out;
}

describe('where a long line may wrap (src/ui/wrapRuns.ts)', () => {
  it('keeps a word with its quotes and substitutions whole, and cuts the rest at its blanks', () => {
    assert.deepStrictEqual(
      texts('grep -rn "ERROR $USER" ./src 2>&1 | sort -u > errors.txt && echo "done: $(date +%F)" || exit 1')[0],
      ['grep', '-rn', '"ERROR $USER"', './src', '2>&1', '|', 'sort', '-u', '>', 'errors.txt', '&&', 'echo', '"done: $(date +%F)"', '||', 'exit', '1'],
    );
    assert.deepStrictEqual(texts("diff <(sort a.txt) <(sort b.txt) # compare  them")[0], ['diff', '<(sort a.txt)', '<(sort b.txt)', '#', 'compare', 'them']);
    assert.deepStrictEqual(texts('x="a b"${y:-c d}`echo e f` z=$(( 1 + 2 ))')[0], ['x="a b"${y:-c d}`echo e f`', 'z=$(( 1 + 2 ))']);
    assert.deepStrictEqual(texts("echo a\\ b $'c d' $\"e f\"")[0], ['echo', 'a\\ b', "$'c d'", '$"e f"']);
    // The words of an array are words of their own.
    assert.deepStrictEqual(texts('a=(1 "2 3")')[0], ['a=(1', '"2 3")']);
  });

  it('reads the lines of a substitution over several lines as lines of their own, and a string over several lines as one word', () => {
    assert.deepStrictEqual(texts('x=$(\n  grep -c "a b" f\n)'), [['x=$('], ['grep', '-c', '"a b"', 'f'], [')']]);
    assert.deepStrictEqual(texts('echo "one two  \n  three four\nfive six" x'), [['echo', '"one two'], ['three four'], ['five six"', 'x']]);
  });

  it('cuts a here-document at its blanks, its substitutions whole', () => {
    assert.deepStrictEqual(texts('cat <<EOF\nhello  big $(date +%F) ${a:-b c}\nEOF\ncat <<\'X\'\n$(a b)\nX'), [
      ['cat', '<<EOF'], ['hello', 'big', '$(date +%F)', '${a:-b c}'], ['EOF'], ['cat', "<<'X'"], ['$(a', 'b)'], ['X'],
    ]);
  });

  it('cuts at blanks a line the parser cannot read, and a construct not closed yet', () => {
    assert.deepStrictEqual(texts('echo "a b" )\necho "c d"'), [['echo', '"a', 'b"', ')'], ['echo', '"c d"']]);
    assert.deepStrictEqual(texts('echo "a b'), [['echo', '"a', 'b']]);
    assert.deepStrictEqual(texts('echo "a b"\necho "c d" )'), [['echo', '"a b"'], ['echo', '"c', 'd"', ')']]);
  });

  it('moves the words of a host file back to its columns, and cuts its own lines at their blanks', () => {
    assert.deepStrictEqual(texts('FROM alpine AS x\nRUN echo "a b" && \\\n    tar -xf "c d.tar"\n', 'dockerfile'), [
      ['FROM', 'alpine', 'AS', 'x'], ['RUN', 'echo', '"a b"', '&&', '\\'], ['tar', '-xf', '"c d.tar"'], [],
    ]);
    // make's `$(CC)` is `${CC}` in the shell text: the columns after it move back.
    assert.deepStrictEqual(texts('all:\n\t$(CC) -o "a b" $(SRC)\n', 'makefile')[1], ['$(CC)', '-o', '"a b"', '$(SRC)']);
    assert.deepStrictEqual(texts('steps:\n  - run: echo "x y" | tee "a b"\n', 'yaml')[1], ['-', 'run:', 'echo', '"x y"', '|', 'tee', '"a b"']);
    assert.deepStrictEqual(texts('# T\n\n```bash\necho "a b"  c\n```\n', 'markdown').slice(2, 5), [['```bash'], ['echo', '"a b"', 'c'], ['```']]);
  });

  it('reads a script with CRLF line ends as with LF', () => {
    assert.deepStrictEqual(texts('echo "a b"\r\nx="c\r\nd e"\r\n'), [['echo', '"a b"'], ['x="c'], ['d e"'], []]);
  });

  it('cuts a text at its blanks without a tree', () => {
    assert.deepStrictEqual(blankRuns(' a\tbc  d '), [[1, 2], [3, 5], [7, 8]]);
    assert.deepStrictEqual(blankRuns(''), []);
  });

  it('keeps a substitution on one line as one run, which breaks at every blank when too wide (a follow-up of C1a)', () => {
    // Today's fallback, pinned: the words inside `$( )` are not runs of their own yet, so a run too wide for a row
    // breaks at its blanks, those inside quotes too (docs/design/chrome-redesign.md, C1a, "Follow-up").
    const line = `result=$(curl -s "https://example.com/a b" | jq -r '.items[] | select(.name == "x y") | .id')`;
    const runs = wrapRuns(docOf(line))[0];
    assert.deepStrictEqual(runs, [[0, line.length]]);
    const parts = blankRuns(line).map(([a, b]) => line.slice(a, b));
    assert.ok(parts.includes(`'.items[]`) && parts.includes(`"x`), JSON.stringify(parts));
  });

  it('never breaks inside a word bash reads, over the corpus', function () {
    this.timeout(120000);
    const { files, snippets } = corpus();
    const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, 'fixtures', ...p), 'utf8');
    const hosts = fs.readdirSync(path.join(__dirname, 'fixtures', 'hosts')).flatMap((f) => {
      const kind = hostKind('', f);
      return kind ? [{ name: `hosts/${f}`, text: read('hosts', f), kind }] : [];
    });
    let words = 0;
    for (const { name, text, kind } of [...files.filter((f) => !f.name.startsWith('hosts/')), ...snippets, ...hosts].map((f) => ({ kind: 'shell' as FileKind, ...f }))) {
      const doc = docOf(text, kind);
      const runs = wrapRuns(doc);
      assert.strictEqual(runs.length, doc.lines.length, name);
      doc.lines.forEach((line, i) => {
        const bad = sound(line, runs[i]);
        assert.ok(!bad, `${name}, line ${i + 1}: ${bad}`);
      });
      if (kind !== 'shell' || doc.tree.errors.some((e) => e.kind === 'unreadable')) continue;
      // Each word on one line lies in one run.
      for (const w of commandWords(doc.tree.root)) {
        if (w.startPosition.row !== w.endPosition.row || w.incomplete || w.startIndex === w.endIndex) continue;
        const { row, column: a } = w.startPosition;
        // (A word not closed yet may end with a blank: `$(( `.)
        const b = a + w.text.trimEnd().length;
        words++;
        assert.ok(runs[row].some(([s, e]) => s <= a && e >= Math.min(b, doc.lines[row].length)), `${name}, line ${row + 1}: ${JSON.stringify(w.text)} is cut (${JSON.stringify(runs[row].map(([s, e]) => doc.lines[row].slice(s, e)))})`);
      }
    }
    assert.ok(words > 5000, `${words} words checked`);
  });
});

describe('where a hover card goes (src/ui/cardPlace.ts)', () => {
  const space = { top: 100, bottom: 900 };
  /** A row of the line, for the lines that have room: it does not count there. */
  const row = { top: 200, bottom: 220 };
  it('goes under the whole line, at most CARD_CAP and half the window high, and no higher than the room', () => {
    assert.deepStrictEqual(cardPlace({ top: 200, bottom: 260 }, row, space, 1000), { above: false, overLine: false, maxHeight: CARD_CAP });
    assert.deepStrictEqual(cardPlace({ top: 200, bottom: 260 }, row, space, 600), { above: false, overLine: false, maxHeight: 300 });
    assert.deepStrictEqual(cardPlace({ top: 500, bottom: 560 }, row, space, 2000), { above: false, overLine: false, maxHeight: 332 });
  });
  it('goes above the line when the room below is short and the room above larger', () => {
    assert.deepStrictEqual(cardPlace({ top: 700, bottom: 780 }, row, space, 1000), { above: true, overLine: false, maxHeight: CARD_CAP });
    assert.deepStrictEqual(cardPlace({ top: 300, bottom: 780 }, row, space, 1000), { above: true, overLine: false, maxHeight: 192 });
    // Short on both sides, but room for CARD_MIN on one: the larger.
    assert.deepStrictEqual(cardPlace({ top: 150, bottom: 760 }, row, space, 1000), { above: false, overLine: false, maxHeight: 132 });
    // A window so low that half of it is under CARD_MIN: that half is enough.
    assert.deepStrictEqual(cardPlace({ top: 150, bottom: 760 }, row, space, 200), { above: false, overLine: false, maxHeight: 100 });
  });
  it('goes by the hovered row, over the line, when the line leaves under CARD_MIN on both sides', () => {
    // A line taller than its room (a long one-liner in a low pane): on the side of the row with more room.
    const tall = { top: 100, bottom: 900 };
    assert.deepStrictEqual(cardPlace(tall, { top: 400, bottom: 420 }, space, 1000), { above: false, overLine: true, maxHeight: CARD_CAP });
    assert.deepStrictEqual(cardPlace(tall, { top: 800, bottom: 820 }, space, 1000), { above: true, overLine: true, maxHeight: CARD_CAP });
    // Little room by the row too: still CARD_MIN high, never a sliver.
    const low = { top: 100, bottom: 300 };
    assert.deepStrictEqual(cardPlace({ top: 110, bottom: 290 }, { top: 200, bottom: 220 }, low, 420), { above: true, overLine: true, maxHeight: CARD_MIN });
    assert.deepStrictEqual(cardPlace({ top: 110, bottom: 290 }, { top: 110, bottom: 130 }, low, 420), { above: false, overLine: true, maxHeight: 162 });
  });
  it('stays while the pointer leaves the part\'s row towards the card, for a short time', () => {
    const line = { top: 100, bottom: 160 };
    const part = { top: 100, bottom: 120 };
    const left = { x: 50, y: 110, time: 0 };
    const below = { top: 164, bottom: 400 };
    assert.ok(towardCard(left, { x: 80, y: 140, time: 100 }, part, line, below), 'down across the later rows');
    assert.ok(towardCard(left, { x: 80, y: 164, time: 100 }, part, line, below), 'at the card');
    assert.ok(!towardCard(left, { x: 200, y: 115, time: 100 }, part, line, below), 'along the part\'s row: another word');
    assert.ok(!towardCard(left, { x: 80, y: 109, time: 100 }, part, line, below), 'resting on the row');
    assert.ok(!towardCard({ x: 50, y: 119, time: 0 }, { x: 50, y: 120.5, time: 100 }, part, line, below), 'not closer yet');
    assert.ok(!towardCard(left, { x: 80, y: 100, time: 100 }, part, line, below), 'up, away from the card');
    assert.ok(!towardCard(left, { x: 80, y: 140, time: CARD_GRACE + 1 }, part, line, below), 'too late');
    assert.ok(!towardCard(left, { x: 80, y: 170, time: 100 }, part, line, below), 'past the card\'s top');
    const above = { top: 0, bottom: 96 };
    const last = { top: 140, bottom: 160 };
    const up = { x: 50, y: 150, time: 0 };
    assert.ok(towardCard(up, { x: 60, y: 120, time: 50 }, last, line, above), 'up across the earlier rows');
    assert.ok(!towardCard(up, { x: 60, y: 145, time: 50 }, last, line, above), 'along the part\'s row');
    assert.ok(!towardCard({ x: 50, y: 141, time: 0 }, { x: 60, y: 139.5, time: 50 }, last, line, above), 'not closer yet');
    assert.ok(!towardCard(up, { x: 60, y: 90, time: 50 }, last, line, above), 'past the card\'s bottom');
    assert.ok(!towardCard(up, { x: 60, y: 170, time: 50 }, last, line, above), 'under the line');
  });
});
