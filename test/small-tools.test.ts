// rg, pv, sponge, expect, socat and sshpass (src/dict/smalltools.ts) against the option lines the real tools print (ripgrep 14.1.0,
// pv 1.8.5, moreutils 0.69, expect 5.45.4, socat 1.8.0.0, sshpass 1.09), recorded in test/fixtures/small-tools/. Every option a
// tool lists is an option of the spec, and takes a value where the tool's text shows one. test/small-tools-real.test.ts checks that
// the recorded lines are still what the tools print, and runs the tools, when they are installed.
import * as assert from 'assert';
import { Analyzer, lookupCommand, Token } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { ENTRIES, reads } from './support/smalltools';

describe('small tools: the specs against the option lines of the real tools', () => {
  for (const tool of Object.keys(ENTRIES)) {
    it(`${tool}: every option of the tool is an option of the spec`, () => {
      const bad: string[] = [];
      let n = 0;
      for (const e of ENTRIES[tool]()) {
        n++;
        for (const w of e.words) {
          const r = reads(tool, e.value ? [w, 'v'] : [w]);
          if (r.role !== 'option' && r.role !== 'pattern-option') bad.push(`${w}: read as ${r.role}`);
          else if (r.role === 'option' && r.takesValue !== e.value) bad.push(`${w}: ${e.value ? 'misses its value' : 'takes a value it should not'}`);
        }
      }
      assert.ok(n >= (tool === 'sponge' ? 1 : tool === 'sshpass' ? 7 : 8), `${tool}: only ${n} options read`);
      assert.deepStrictEqual(bad, []);
    });
  }

  it('the spec has no option the tool does not list (the others are named, each with its reason)', () => {
    // (ripgrep's `-h` text lacks `--unicode`, the opposite of `--no-unicode`, and the socat texts the forms with a value attached.)
    const OTHER: Record<string, string[]> = { rg: ['--unicode'], pv: [], sshpass: [], sponge: [], expect: [], socat: [] };
    for (const tool of Object.keys(OTHER)) {
      const listed = new Set(ENTRIES[tool]().flatMap((e) => e.words));
      const extra = lookupCommand(tool)!.options!.flatMap((o) => o.names).filter((n) => !listed.has(n) && !OTHER[tool].includes(n));
      // (socat: `-lm`, `-ly` and `-d` are listed with brackets and `-hh`, `-hhh` as words of their own.)
      assert.deepStrictEqual(extra.filter((n) => !(tool === 'socat' && /^-(?:h|\?|hh|hhh|d|lm|ly)$/.test(n))), [], tool);
    }
  });
});

describe('small tools: how the words are read', () => {
  const parser = createUnbashParser();
  const explain = (src: string, lang: 'en' | 'ja' = 'en'): string[] => {
    const out: Token[] = [];
    const walk = (t: Token): void => { out.push(t); t.children.forEach(walk); };
    new Analyzer(lang).explainLine(parser.parse(src), 0).items.forEach(walk);
    return out.filter((t) => t.kind === 'argument' || t.kind === 'option').map((t) => `${t.label}: ${t.explanation}`);
  };

  it('rg: -A3, -A=3, -A 3 and --after-context=3 give the value; an unambiguous prefix of a long option is not an option', () => {
    for (const w of ['-A3', '-A=3']) assert.match(explain(`rg ${w} x`)[0], /^-A.*: show N lines after each match/);
    assert.match(explain('rg --after-context 3 x')[1], /^3: Value for `--after-context`/);
    assert.match(explain('rg --after-cont=3 x')[0], /^--after-cont=3: .*not in the dictionary/);
  });

  it('rg: the pattern is the first operand, or the value of -e or -f', () => {
    assert.match(explain('rg -n foo src tests').join('\n'), /foo: the pattern to search for[\s\S]*src: a file or directory to search[\s\S]*tests: a file or directory to search/);
    const e = explain('rg -e foo src').join('\n');
    assert.match(e, /foo: Value for `-e`/);
    assert.match(e, /src: a file or directory to search/);
    assert.match(explain('rg -f pats.txt src').join('\n'), /src: a file or directory to search/);
  });

  it('rg: -uu is two -u; the negations and the options with values are read', () => {
    assert.match(explain('rg -uu foo').join('\n'), /-uu: Combined short options `-u` `-u`/);
    assert.match(explain('rg --no-heading --max-count 2 --glob "x" foo').join('\n'), /--no-heading: turn off `--heading` \(the later flag wins\)[\s\S]*2: Value for `--max-count`[\s\S]*"x": Value for `--glob`/);
  });

  it('pv: clusters, abbreviated long options and files', () => {
    assert.match(explain('pv -pterb a.iso').join('\n'), /\na\.iso: a file to copy/);
    assert.match(explain('pv --siz 100 -q')[0], /^--siz: the expected total size/);
    assert.match(explain('pv -s100M -L1M x')[0], /^-s100M: .*total size/);
  });

  it('sponge: -a, and the file it writes', () => {
    const e = explain('sort f | sponge -a f');
    assert.match(e.join('\n'), /-a: append to the file instead of replacing it/);
    assert.match(e.join('\n'), /f: the file to write/);
    assert.match(String(lookupCommand('sponge')!.summary.en), /Read all of standard input first, then write it to a file.*sort f \| sponge f/);
  });

  it('sshpass: -p says that the password can be seen; the command after it is explained as a command', () => {
    const e = explain('sshpass -p secret ssh host uptime').join('\n');
    assert.match(e, /-p: the password \(on the command line other users can see it in `ps`; use `-f` or `-e`\)/);
    assert.match(e, /host: destination/);
    assert.match(explain('sshpass -p secret ssh host', 'ja').join('\n'), /-p: パスワード（コマンド行に書くと `ps` などで他のユーザーに見える/);
    assert.match(explain('sshpass -e ssh -p 2222 host').join('\n'), /-e: read the password from the environment variable `SSHPASS`/);
  });

  it('expect: the script is the first operand; with -f or -b every operand is an argument', () => {
    const a = explain('expect s.exp one two').join('\n');
    assert.match(a, /s\.exp: the script file to run \(Tcl/);
    assert.match(a, /one: an argument for the script/);
    const b = explain("expect -c 'puts hi' -f s.exp one").join('\n');
    assert.match(b, /one: an argument for the script/);
    assert.doesNotMatch(b, /one: the script file/);
  });

  it('socat: options do not cluster; -t5, -t 5 and -lf FILE are read; the two operands are addresses', () => {
    assert.match(explain('socat -t5 - -')[0], /^-t5: wait 5 seconds before closing the second channel/);
    const s = explain('socat -t 5 -lf /tmp/log -d -d TCP-LISTEN:8080,fork TCP:localhost:80').join('\n');
    assert.match(s, /5: Value for `-t`/);
    assert.match(s, /\/tmp\/log: Value for `-lf`/);
    assert.match(s, /TCP-LISTEN:8080,fork: the first address/);
    assert.match(s, /TCP:localhost:80: the second address/);
    assert.match(explain('socat -vx - -')[0], /^-vx: .*not in the dictionary/);
    // (An option after the addresses is a third address, which socat refuses.)
    assert.doesNotMatch(explain('socat - - -u').join('\n'), /unidirectional/);
    assert.match(explain('socat -dd - -')[0], /^-dd: 2 levels more verbose/);
    assert.match(explain('socat -d3 - -')[0], /^-d3: verbosity level 3/);
  });
  it('socat: the forms with the value attached are options too, each with its text', () => {
    const words = ['-lyDAEMON', '-lmUSER', '-lfx.log', '-lpname', '-rraw', '-Rraw', '-b8192', '-S1', '-T5'];
    const e = explain(`socat ${words.join(' ')} - -`);
    assert.strictEqual(e.length, words.length + 2);
    for (const w of words) assert.ok(e.some((x) => x.startsWith(`${w}: `) && !/not in the dictionary/.test(x)), w);
    assert.match(explain('socat -b8192 - -', 'ja')[0], /^-b8192: データ用のバッファーの大きさを 8192 バイトにする/);
  });

  it('rg: under set -e, the note says what status 1 means', () => {
    const line = new Analyzer('en').explainLine(parser.parse('set -e\nrg foo f'), 1);
    assert.match(line.notes.join('\n'), /`rg` exits with a status other than 0 \(1: no line was selected\)/);
  });
});
