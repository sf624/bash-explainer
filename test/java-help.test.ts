// The specs of java, javac, keytool, mvn and gradle (src/dict/java.ts) against the usage texts the real tools print: the option
// lines are recorded in test/fixtures/java/ (Temurin 21.0.13, Apache Maven 3.9.9, Gradle 8.14.3; test/java-real.test.ts checks that
// the recorded lines are still what the tools print, when they are installed). Every option a usage text lists is read as an option
// by the spec, and takes a value where the usage text shows one.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { lookupCommand } from '../src/analyzer';
import { ArgRole, interpret } from '../src/argv/interpret';
import { argWords } from './support/argwords';

const fixture = (name: string): string[] => fs.readFileSync(path.join(__dirname, 'fixtures', 'java', name), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));

/** What the spec makes of `tool WORDS`: the role of the first word, and whether the second is its value. */
function reads(tool: string, words: string[]): { role: ArgRole['role']; takesValue: boolean } {
  const { name, words: ws } = argWords(`${tool} ${words.map((w) => `'${w}'`).join(' ')}`);
  const p = interpret(lookupCommand(name)!, ws, { name, lookup: lookupCommand });
  const first = p.roles.find((r) => r.word === 0)!.role;
  const second = p.roles.find((r) => r.word === 1)?.role;
  return { role: first.role, takesValue: second?.role === 'value' };
}

interface Entry { word: string; value: boolean; text: string }

/** The options a usage line lists: each alternative as the word that spells it, and whether a value follows it as a word. */
function entries(line: string): Entry[] {
  const flat = line.replace(/<[^>]*>/g, '<>');
  const out: Entry[] = [];
  // (`-esa | -enablesystemassertions`, `-am,--also-make`, `-? -h -help`, `--class-path <path>, -classpath <path>`.)
  const re = /(^|[\s,|])((?:--?|@)[^\s,|<[]*)(<>|\[[^\]]*\])?(\s+<>)?/g;
  for (let m: RegExpExecArray | null; (m = re.exec(flat)); ) {
    let text = m[2];
    if (text === '--') continue;
    // `-verbose:[class|gc]`, `-Xmn<size>`, `-D<name>=<value>`, `-Akey[=value]`: written with something attached.
    let word = text;
    if (m[3] === '<>' || /[:=]$/.test(text)) word += 'x';
    else if (m[3]?.startsWith('[:')) word += ':x';
    out.push({ word, value: m[4] !== undefined, text });
  }
  return out;
}

describe('java tools: the specs against the usage texts', () => {
  const CHECKS: [string, string, { skipValue?: boolean; skip?: RegExp }][] = [
    ['java', 'java.txt', {}],
    ['javac', 'javac.txt', {}],
    ['mvn', 'mvn.txt', {}],
    // (Gradle's usage text does not show which options take a value.)
    ['gradle', 'gradle.txt', { skipValue: true }],
  ];
  for (const [tool, file, o] of CHECKS) {
    it(`${tool}: every option of the usage is an option of the spec`, () => {
      const bad: string[] = [];
      let n = 0;
      for (const line of fixture(file)) {
        for (const e of entries(line)) {
          n++;
          const r = reads(tool, e.value ? [e.word, 'v'] : [e.word]);
          if (r.role !== 'option' && r.role !== 'pattern-option' && r.role !== 'operand') bad.push(`${e.word}: read as ${r.role}`);
          else if (r.role === 'option' && !o.skipValue && r.takesValue !== e.value) bad.push(`${e.word}: ${e.value ? 'misses its value' : 'takes a value it should not'}`);
          else if (r.role === 'operand' && e.word[0] !== '@') bad.push(`${e.word}: read as an operand`);
        }
      }
      assert.ok(n > 30, `${tool}: only ${n} options read`);
      assert.deepStrictEqual(bad, []);
    });
  }

  it('keytool: every command and option of the usages is in the spec', () => {
    const lines = fixture('keytool.txt');
    const commands = lines[0].replace('commands: ', '').split(' ');
    assert.ok(commands.length >= 15);
    const bad: string[] = [];
    for (const c of commands) if (reads('keytool', [c]).role !== 'option') bad.push(c);
    for (const line of lines.slice(1)) {
      for (const item of line.slice(line.indexOf(': ') + 2).split(', ')) {
        const [word, arg] = item.split(' ');
        const r = reads('keytool', arg ? [word, 'v'] : [word]);
        if (r.role !== 'option') bad.push(`${word}: read as ${r.role}`);
        else if (r.takesValue !== !!arg) bad.push(`${word}: ${arg ? 'misses its value' : 'takes a value it should not'}`);
      }
    }
    assert.deepStrictEqual(bad, []);
  });

  it('the spec has no option the real tool refuses (the ones outside the usage texts are listed, each with its reason)', () => {
    // Options the usage texts do not list in their option lines (`-jar` and `-m` are in the synopsis; the others are old or legacy forms
    // the tools still take), found by running the tools:
    const HIDDEN: Record<string, string[]> = {
      java: ['-jar', '-m', '--module', '-verbose', '-server'],
      javac: [],
      keytool: ['-genkey', '-import', '-export', '-selfcert', '-keyclone', '-identitydb', '-gencrl', '--version', '--help', '-debug', '-conf', '-J', '-infile', '-outfile', '-srcprotected', '-destprotected'],
      mvn: [],
      // (`--tests` is an option of the test task, not of gradle: it is listed by `gradle help --task test`.)
      gradle: ['--tests'],
    };
    for (const tool of Object.keys(HIDDEN)) {
      const spec = lookupCommand(tool)!;
      const listed = new Set<string>();
      for (const file of tool === 'keytool' ? ['keytool.txt'] : [`${tool}.txt`]) {
        for (const line of fixture(file)) {
          if (tool === 'keytool') line.split(/[\s,:]+/).filter((w) => w.startsWith('-')).forEach((w) => listed.add(w));
          else entries(line).forEach((e) => listed.add(e.text.replace(/[:=]$/, '')));
        }
      }
      const extra = spec.options!.flatMap((o) => o.names).filter((n) => !listed.has(n) && !HIDDEN[tool].includes(n));
      // (A usage text that lists `-g:none` and `-g:{lines,vars,source}` but not `-g` itself; `-Xlint` and the like.)
      const unexplained = extra.filter((n) => !/^-(g|Xlint|Xdoclint|d|h|X|help|version|\?|--help)$/.test(n) || tool === 'mvn' || tool === 'gradle');
      assert.deepStrictEqual(unexplained, [], `${tool}: options the usage text does not list`);
    }
  });
});
