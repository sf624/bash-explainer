import * as assert from 'assert';
import { explainSed } from '../src/embedded/sed';
import { EmbeddedToken } from '../src/embedded/types';

function all(ts: EmbeddedToken[]): EmbeddedToken[] {
  return ts.flatMap((t) => [t, ...all(t.children)]);
}

function text(src: string, t: EmbeddedToken): string {
  return src.slice(t.start, t.end);
}

describe('sed explainer', () => {
  it('breaks an s command into pattern, replacement and flags', () => {
    const src = 's/([0-9]+)-x/\\1/g';
    const [cmd] = explainSed(src, 'ere', 'en');
    assert.match(cmd.explanation, /^Substitute: replace every match of `\(\[0-9\]\+\)-x` on each line with `\\1`/);
    assert.deepStrictEqual(cmd.children.map((t) => [text(src, t), t.kind]), [
      ['s', 'command'], ['/', 'operator'], ['([0-9]+)-x', 'pattern'], ['/', 'operator'], ['\\1', 'string'], ['/', 'operator'], ['g', 'option'],
    ]);
    // The pattern is explained as an ERE, the replacement's backreference too.
    assert.ok(all(cmd.children).some((t) => t.kind === 'block' && /^Group 1/.test(t.explanation)));
    assert.match(all(cmd.children).find((t) => text(src, t) === '\\1' && t.kind === 'variable')!.explanation, /what group 1 matched/);
  });

  it('uses the regex dialect it is given', () => {
    const bre = all(explainSed('s/a+/b/', 'bre', 'en')).find((t) => t.explanation.includes('basic regex'));
    assert.ok(bre, '+ is a literal in BRE');
    assert.ok(all(explainSed('s/a+/b/', 'ere', 'en')).some((t) => /one or more/.test(t.explanation)));
  });

  it('explains addresses, ranges and negation', () => {
    const [range] = explainSed('/^BEGIN/,/^END/p', 'bre', 'en');
    assert.match(range.explanation, /^For lines matching `\^BEGIN` through lines matching `\^END`: print the line/);
    const [neg] = explainSed('2,+3!d', 'bre', 'en');
    assert.match(neg.explanation, /^For all but line 2 through 3 lines later: delete/);
    const [step] = explainSed('0~2p', 'bre', 'ja');
    assert.match(step.explanation, /0 行目から 2 行おき/);
  });

  it('splits several commands and blocks', () => {
    const src = '1d;$d\n/x/{p;q}';
    const ts = explainSed(src, 'bre', 'en');
    assert.deepStrictEqual(ts.map((t) => text(src, t)), ['1d', '$d', '/x/{', 'p', 'q', '}']);
  });

  it('explains other commands', () => {
    assert.match(explainSed('y/abc/xyz/', 'bre', 'en')[0].explanation, /Transliterate/);
    assert.match(explainSed('/foo/i\\\ninserted', 'bre', 'en')[0].explanation, /insert the line "inserted" before it/);
    assert.match(explainSed('3q5', 'bre', 'en')[0].explanation, /quit/);
    assert.match(explainSed(':a;N;ba', 'bre', 'en')[2].explanation, /branch to "a"/);
    const src = 's/.*/\\U&/';
    const repl = explainSed(src, 'bre', 'en')[0].children.find((t) => text(src, t) === '\\U&')!;
    assert.deepStrictEqual(repl.children.map((t) => text(src, t)), ['\\U', '&']);
    assert.deepStrictEqual(explainSed('s|/usr|/opt|', 'bre', 'en')[0].children[4].children, [], 'a plain replacement is not broken down');
  });

  it('reports malformed scripts instead of throwing', () => {
    for (const bad of ['s/a/b', 's', '/foo', 'k', 'y/ab/']) {
      const ts = explainSed(bad, 'bre', 'en');
      assert.ok(all(ts).some((t) => t.kind === 'error'), bad);
    }
  });
});
