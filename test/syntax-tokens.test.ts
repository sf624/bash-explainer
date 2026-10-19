import * as assert from 'assert';
import { KEYWORDS, scanGap } from '../src/syntax/adapters/tokens';
import type { Piece } from '../src/syntax/adapters/tokens';

/** `text:start` for each piece of the whole text. */
const scan = (text: string, skip: readonly (readonly [number, number])[] = []): string[] =>
  scanGap(text, 0, text.length, skip).map((p) => `${p.kind === 'comment' ? '#' : ''}${p.text}:${p.start}`);

describe('token scanner: operators', () => {
  it('finds the control operators, the longest first', () => {
    assert.deepEqual(scan('; ;; ;& ;;& & && | || |& ( )'), [
      ';:0', ';;:2', ';&:5', ';;&:8', '&:12', '&&:14', '|:17', '||:19', '|&:22', '(:25', '):27',
    ]);
  });
  it('finds redirection operators', () => {
    assert.deepEqual(scan('<< <<< <<- < > >> >& <& <> >| &> &>>').map((s) => s.split(':')[0]), [
      '<<', '<<<', '<<-', '<', '>', '>>', '>&', '<&', '<>', '>|', '&>', '&>>',
    ]);
  });
  it('does not need blanks around an operator', () => {
    assert.deepEqual(scan('a&&b||c;;'), ['&&:1', '||:4', ';;:7']);
  });
  it('gives the ranges', () => {
    const [p] = scanGap('xx ;; yy', 0, 8);
    assert.deepEqual(p, { kind: 'token', text: ';;', start: 3, end: 5 } satisfies Piece);
  });
});

describe('token scanner: keywords', () => {
  it('finds the reserved words', () => {
    const words = [...KEYWORDS];
    assert.deepEqual(scan(words.join(' ')).map((s) => s.split(':')[0]), words);
  });
  it('ignores other words and words that only start like a keyword', () => {
    assert.deepEqual(scan('echo then2 thenx fi_ ifx'), []);
    assert.deepEqual(scan('echo; then'), [';:4', 'then:6']);
  });
  it('reads a keyword that a line continuation cuts', () => {
    assert.deepEqual(scan('th\\\nen'), ['then:0']);
    assert.deepEqual(scan('a \\\n then'), ['then:5']);
  });
  it('does not read a keyword with a quote or an escape in it', () => {
    assert.deepEqual(scan('"then" \'fi\' t\\hen'), []);
  });
});

describe('token scanner: what it skips', () => {
  it('reads a comment up to the end of the line', () => {
    assert.deepEqual(scan('# one\nthen # two\n#three'), ['## one:0', 'then:6', '## two:11', '##three:17']);
  });
  it('stops a comment at the end of the stretch', () => {
    assert.deepEqual(scanGap('then # abc', 0, 8).map((p) => p.text), ['then', '# abc'.slice(0, 3)]);
  });
  it('does not take a # in the middle of a word for a comment', () => {
    assert.deepEqual(scan('a#b then'), ['then:4']);
  });
  it('skips single and double quotes, with escapes and a ; inside', () => {
    const text = "x'; fi'y \"a; then \\\" done\"z ;";
    assert.deepEqual(scan(text), [`;:${text.length - 1}`]);
  });
  it('skips $( ), ${ } and backquotes, which may hold operators, keywords and quotes', () => {
    const text = 'a$(b; fi ")") ${c:-;} `d; done` e$((1)) ;';
    assert.deepEqual(scan(text), [`;:${text.length - 1}`]);
    const nested = '"$(echo ")" ; then)" ;';
    assert.deepEqual(scan(nested), [`;:${nested.length - 1}`]);
  });
  it('skips a bracket that is not closed to the end of the stretch', () => {
    assert.deepEqual(scan("a 'b; fi"), []);
    assert.deepEqual(scan('a "b; fi'), []);
    assert.deepEqual(scan('a $(b; fi'), []);
    assert.deepEqual(scan('a ${b; fi'), []);
    assert.deepEqual(scan('a `b; fi'), []);
  });
  it('skips escaped characters, also at the end', () => {
    const text = '\\; \\then ;';
    assert.deepEqual(scan(text), [`;:${text.length - 1}`]);
    assert.deepEqual(scan('a\\'), []);
  });
  it('skips line continuations between tokens', () => {
    assert.deepEqual(scan('a \\\n; \\\r\n'), [';:4']);
  });
  it('skips the ranges it is given, such as heredoc bodies', () => {
    const text = 'cat <<E\nthen\n# no\nE\n; fi';
    assert.deepEqual(scan(text), ['<<:4', 'then:8', '## no:13', ';:20', 'fi:22']);
    assert.deepEqual(scan(text, [[8, 20]]), ['<<:4', ';:20', 'fi:22']);
  });
});

describe('token scanner: ranges', () => {
  it('scans only the stretch it is given', () => {
    const text = 'then x; fi';
    assert.deepEqual(scanGap(text, 4, 8).map((p) => p.text), [';']);
    assert.deepEqual(scanGap(text, 0, 4).map((p) => p.text), ['then']);
    assert.deepEqual(scanGap(text, 5, 5), []);
  });
});

describe('token scanner: escapes inside groups', () => {
  it('skips an escaped parenthesis inside $( )', () => {
    assert.deepEqual(scan('a $(b \\) ; c) ; d'), [';:14']);
  });
});
