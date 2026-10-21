// The wrappers and shells, compared with the real tools: which words go to the command a wrapper runs,
// which are the shell's `$0` and `$1`…, and which are names or users. Each command runs `printf %s,`, so
// its output lists the words it got. Tools that are missing are skipped.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { lookupCommand } from '../src/analyzer';
import { ArgvParse, ArgWord, interpret } from '../src/argv/interpret';
import { argWords } from './support/argwords';

const has = (tool: string): boolean => spawnSync('bash', ['--norc', '-c', `command -v ${tool}`]).status === 0;
const run = (line: string, input = ''): { out: string; err: string } => {
  const r = spawnSync('bash', ['--norc', '-c', line], { input, encoding: 'utf8', timeout: 10000 });
  return { out: r.stdout, err: r.stderr };
};
const parseOf = (line: string): { parse: ArgvParse; words: string[] } => {
  const { name, words, texts } = argWords(line);
  // (`{}` is a word of its own; its value is not taken as known.)
  return { parse: interpret(lookupCommand(name)!, words, { name, lookup: lookupCommand }), words: words.map((w: ArgWord, i) => w.value ?? texts[i]) };
};
/** The words of the command that the line runs, as the interpreter reads them (the first command slot). */
function ran(line: string): string[] {
  const { parse, words } = parseOf(line);
  const find = (p: ArgvParse): string[] | undefined => {
    for (const { word, role } of p.roles) {
      if (role.role === 'command' && role.parse) return words.slice(word, role.parse.end);
      if (role.role === 'subcommand') return find(role.parse);
    }
    return undefined;
  };
  const out = find(parse);
  assert.ok(out, `no command in ${line}`);
  return out;
}
/** The words of the line whose operands are named `names`, in order. */
function operands(line: string, names: string[]): string[] {
  const { parse, words } = parseOf(line);
  return parse.roles.flatMap(({ word, role }) => (role.role === 'operand' && role.spec && names.includes(role.spec.name) ? [words[word]] : []));
}
/** What `printf %s, …` prints for the words after its format. */
const printed = (words: string[]): string => words.map((w) => `${w},`).join('');

describe('wrappers agree with the real tools', () => {
  const lock = path.join(os.tmpdir(), `bash-explainer-flock-${process.pid}`);
  after(() => fs.rmSync(lock, { force: true }));

  // [line, input]: the command gets the words the interpreter gives it.
  const ROWS: Record<string, string[]> = {
    timeout: [
      'timeout -k 5 10 printf %s, -h x',
      'timeout --signal=KILL 2 printf %s, -s 9',
      'timeout -sKILL 2 printf %s, a',
      'timeout 5 printf %s, --foreground',
      // Options the dictionary lacked, and long options written as a unique prefix (getopt_long).
      'timeout --foreground -v --preserve-status 5 printf %s, -v',
      'timeout --sig KILL 2 printf %s, a',
      'timeout --kill 1 2 printf %s, a',
    ],
    env: [
      'env -i A=1 printf %s, -i',
      'env -u HOME printf %s, x',
      'env -iu HOME printf %s, a',
      'env A=1 B=2 printf %s, A=3',
      'env -- printf %s, -u',
    ],
    nice: [
      'nice -n 5 printf %s, -n',
      'nice -5 printf %s, a',
      'nice --adjustment=3 printf %s, a',
      'nice --adj 3 printf %s, a',
      'nice printf %s, -n 3',
    ],
    flock: [
      `flock ${lock} printf %s, -n`,
      `flock -n ${lock} printf %s, a`,
      `flock -w 1 ${lock} printf %s, a`,
    ],
    exec: [
      'exec -a name printf %s, a',
      'exec -c printf %s, -a',
      'exec -l printf %s, -l',
      'exec -- printf %s, x',
    ],
    command: [
      'command printf %s, -v',
      'command -p printf %s, a',
    ],
  };
  for (const [tool, rows] of Object.entries(ROWS)) {
    (has(tool) ? it : it.skip)(`${tool}: the words of the command it runs`, () => {
      for (const line of rows) {
        const words = ran(line);
        assert.deepStrictEqual(words.slice(0, 2), ['printf', '%s,'], line);
        assert.strictEqual(run(line).out, printed(words.slice(2)), line);
      }
    });
  }

  (has('xargs') ? it : it.skip)('xargs: the words of the command, and the input after them (or in place of `{}`)', () => {
    for (const line of ['xargs printf %s, -0', 'xargs -n 1 printf %s, a', 'xargs -r printf %s, -r', 'xargs -I{} printf %s, {} b', 'xargs -i printf %s, {} b', 'xargs -d , printf %s, a', 'xargs -L 1 printf %s, -L']) {
      const words = ran(line).slice(2);
      const replaces = /-I\{\}|-i /.test(line);
      assert.strictEqual(run(line, 'z').out, printed(replaces ? words.map((w) => (w === '{}' ? 'z' : w)) : [...words, 'z']), line);
    }
  });

  (has('bash') ? it : it.skip)('bash and sh: `$0`, the arguments, and the script', () => {
    const script = path.join(os.tmpdir(), `bash-explainer-args-${process.pid}.sh`);
    fs.writeFileSync(script, 'printf %s, "$@"');
    try {
      for (const line of [
        `bash -c 'printf %s, "$0" "$@"' a b`, `bash -ec 'printf %s, "$0"' n`, `bash -o pipefail -c 'printf %s, "$0" "$1"' a b`, `sh -c 'printf %s, "$0" "$@"' a -x`,
      ]) assert.strictEqual(run(line).out, printed(operands(line, ['NAME', 'ARG'])), line);
      for (const line of ['bash -s -- --prefix x', 'bash -s a -b', 'sh -s -e x']) {
        assert.strictEqual(run(line, 'printf %s, "$@"').out, printed(operands(line, ['ARG'])), line);
      }
      for (const line of [`bash ${script} a -x`, `bash +x ${script} -e`, `bash -e -- ${script} -x`]) {
        assert.deepStrictEqual(operands(line, ['SCRIPT']), [script], line);
        assert.strictEqual(run(line).out, printed(operands(line, ['ARG'])), line);
      }
    } finally {
      fs.rmSync(script, { force: true });
    }
  });

  (has('flock') ? it : it.skip)('flock -c: the string runs in a shell', () => {
    const line = `flock ${lock} -c 'printf %s, x'`;
    const { parse } = parseOf(line);
    assert.deepStrictEqual(parse.roles.map((r) => r.role.role), ['operand', 'option', 'command']);
    assert.strictEqual(run(line).out, 'x,');
  });

  (has('bash') ? it : it.skip)('command -v and -V: the operands are names to look up, and nothing runs', () => {
    for (const line of ['command -v printf ls cd', 'command -V ls', 'command -v -p ls cd']) {
      const names = operands(line, ['NAME']);
      assert.ok(names.length, line);
      assert.ok(!parseOf(line).parse.roles.some((r) => r.role.role === 'command'), line);
      assert.strictEqual(run(line).out.trim().split('\n').length, names.length, line);
    }
  });

  // su asks for no password before it looks the user up, so a user that does not exist shows which word it took.
  (has('su') && run('su nosuchuser_zz').err.includes('nosuchuser_zz') ? it : it.skip)('su: the user, with options before or after it', () => {
    for (const line of ['su -c ls nosuchuser_zz', 'su nosuchuser_zz -c ls', 'su - nosuchuser_zz', 'su -s /bin/sh nosuchuser_zz', 'su --command=ls nosuchuser_zz']) {
      const [user] = operands(line, ['USER']);
      assert.strictEqual(user, 'nosuchuser_zz', line);
      assert.match(run(line).err, /user nosuchuser_zz does not exist/, line);
    }
  });
});
