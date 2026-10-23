// The option parser presets (src/argv/parsers.ts), each compared with a real parser of its family: GNU getopt_long
// through util-linux getopt(1), bash's echo, OpenSSL, gh (cobra and pflag), iproute2, jq, git and dpkg. A tool
// that is missing skips its rows.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { Analyzer, lookupCommand, Token } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { ArgRole, ArgvParse, ArgWord, interpret } from '../src/argv/interpret';
import { OptionParser, PARSERS } from '../src/argv/parsers';
import type { CommandSpec, OptionSpec } from '../src/argv/spec';
import { argWords } from './support/argwords';

const ENV: NodeJS.ProcessEnv = { ...process.env, LC_ALL: 'C', GH_TOKEN: 'x', GH_HOST: 'github.com', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
delete ENV.POSIXLY_CORRECT;
delete ENV.GETOPT_COMPATIBLE;
const has = (tool: string): boolean => spawnSync('bash', ['--norc', '-c', `command -v ${tool}`]).status === 0;
const run = (line: string): { out: string; err: string; status: number | null } => {
  const r = spawnSync('bash', ['--norc', '-c', line], { env: ENV, encoding: 'utf8', timeout: 30000 });
  return { out: r.stdout, err: r.stderr, status: r.status };
};

/**
 * What a parse reads, written as getopt(1) prints it: the options in order with their values (an optional value
 * not given is `''`; a long option by its full name), `--`, then the operands and the subcommands' names.
 * `error` when an option is unknown or misses its value, as the tool refuses it.
 */
function normalized(parse: ArgvParse, words: ArgWord[]): string {
  const options: string[] = [];
  const operands: string[] = [];
  let error = false;
  const text = (i: number): string => words[i].value ?? '?';
  const name = (flag: string, o: OptionSpec): string => (o.names.includes(flag) ? flag : o.names.find((n) => n.startsWith(flag)) ?? flag);
  const option = (r: ArgRole, word: number): void => {
    if (r.role === 'unknown-option') { error = true; return; }
    if (r.role === 'cluster') { r.letters.forEach((l) => option(l, word)); return; }
    if (r.role !== 'option') return;
    if (r.missing) error = true;
    options.push(name(r.flag, r.spec));
    if (r.value) options.push(text(word).slice(r.value.attached));
    else if (!Array.isArray(r.spec.value) && r.spec.value?.optional) options.push('');
  };
  const walk = (p: ArgvParse): void => {
    for (const { word, role } of p.roles) {
      if (role.role === 'value') options.push(text(word));
      else if (role.role === 'operand') operands.push(text(word));
      else if (role.role === 'subcommand') { operands.push(role.name); walk(role.parse); } else option(role, word);
    }
  };
  walk(parse);
  return error ? 'error' : [...options, '--', ...operands].join(' ');
}

const parseLine = (line: string, spec?: CommandSpec): { parse: ArgvParse; words: ArgWord[] } => {
  const { name, words } = argWords(line);
  return { parse: interpret(spec ?? lookupCommand(name)!, words, { name, lookup: lookupCommand }), words };
};

/** Each preset that has rows, and each whose rows ran against its tool (a tool may be missing). */
const CHECKED = new Set<OptionParser>();
const RAN = new Set<OptionParser>();

/**
 * Runs `test` when the tool is there. Under CI, which has every tool of this file (the ubuntu runner's own, and jq
 * that the workflow installs), a missing tool fails; elsewhere it skips.
 */
function withTool(parser: OptionParser, tool: string, title: string, test: () => void): void {
  CHECKED.add(parser);
  it(title, function () {
    if (!has(tool)) {
      if (process.env.CI) assert.fail(`${tool} is missing: the ${parser} preset is not compared`);
      return this.skip();
    }
    test();
    RAN.add(parser);
  });
}

describe('option parser presets agree with a real parser of their family', () => {
  // getopt(1) of util-linux runs glibc's getopt_long on the words and prints what it reads.
  const opt = (names: string, value?: 'required' | 'optional'): OptionSpec => ({
    names: names.split('|'), text: { ja: names, en: names }, ...(value ? { value: { name: 'V', ...(value === 'optional' ? { optional: true } : {}) } } : {}),
  });
  const options = [opt('-a|--alpha'), opt('-b|--beta', 'required'), opt('-c|--gamma', 'optional'), opt('--alpine'), opt('-d')];
  const getopt = (words: string[], first: boolean): string => {
    const r = spawnSync('getopt', ['-o', `${first ? '+' : ''}ab:c::d`, '-l', 'alpha,beta:,gamma::,alpine', '--', ...words], { env: ENV, encoding: 'utf8' });
    if (r.status !== 0) return 'error';
    const set = spawnSync('bash', ['--norc', '-c', 'eval "set -- $1"; printf "%s\\n" "$*"', '_', r.stdout], { encoding: 'utf8' });
    return set.stdout.replace(/\n$/, '');
  };
  const ROWS = [
    'p -a -b x op', 'p op -a -bx --beta=y --beta z', 'p -ab x op', 'p -ad op', 'p -cfoo -c op --gamma=1 --gamma op2', 'p -- -a op',
    'p -x op', 'p op --beta', 'p -a op -a', "p --beta '' -b '' op", 'p --nope=1', 'p -b',
  ];
  // Abbreviations: getopt_long takes a unique prefix, and refuses one of several.
  const PREFIXES = ['p --alph op', 'p --be=v op', 'p --gam=3 --alpi op', 'p --al op', 'p --g op'];
  const cases: [OptionParser, boolean][] = [['gnu', false], ['gnu', true], ['getopt_long', false], ['getopt_long', true]];
  for (const [parser, first] of cases) {
    withTool(parser, 'getopt', `${parser}${first ? ' with optionsFirst (getopt_long with `+`)' : ''}: as getopt(1) reads the words`, () => {
      const spec: CommandSpec = { summary: { ja: 'p', en: 'p' }, parser, ...(first ? { optionsFirst: true } : {}), options };
      for (const line of [...ROWS, ...PREFIXES]) {
        const { parse, words } = parseLine(line, spec);
        const theirs = getopt(words.map((w) => w.value!), first);
        const ours = normalized(parse, words);
        // `gnu` takes no prefix: an entry with it does not list every long option, so a prefix may stand for one it lacks.
        if (parser === 'gnu' && PREFIXES.includes(line)) assert.strictEqual(ours, 'error', line);
        else assert.strictEqual(ours, theirs, line);
      }
    });
  }

  // echo: a word is an option only when each letter is one; the first operand ends them. bash's builtin, and
  // coreutils' program (`/bin/echo`, which `env echo` runs).
  const printed = (line: string): string => {
    const { parse, words } = parseLine(line);
    const ops = parse.roles.filter((r) => r.role.role === 'operand').map((r) => words[r.word].value);
    const flags = parse.roles.flatMap(({ role: r }) => (r.role === 'cluster' ? r.letters : [r])).map((r) => (r.role === 'option' ? r.flag : ''));
    return ops.join(' ') + (flags.includes('-n') ? '' : '\n');
  };
  const ECHO = ['-n x', '-nx y', '-ne x', '-n -e x -n', '-- x', '-nE x', '-q x', 'x -n', '-', 'x -e -n'];
  withTool('letters', 'bash', 'letters: as bash prints the words of echo', () => {
    for (const line of ECHO.map((w) => `echo ${w}`)) assert.strictEqual(printed(line), run(line).out, line);
  });
  withTool('letters', '/bin/echo', 'letters: as coreutils echo prints its words', () => {
    // (coreutils echo reads `--help` alone, and `--` as a word, as the builtin does.)
    for (const line of ECHO.map((w) => `/bin/echo ${w}`)) assert.strictEqual(printed(line), run(line).out, line);
  });

  /**
   * Rows of a tool: the line, what the tool does (prints, on stdout or stderr; `fails`: exits with a status not 0,
   * for a refusal whose wording differs between releases), and what the parse reads.
   */
  const TOOLS: { parser: OptionParser; tool: string; rows: [string, RegExp | 'fails', string][] }[] = [
    // OpenSSL's opt.c: one word per option, `-name=value`, no clusters, no prefixes.
    { parser: 'single-dash', tool: 'openssl', rows: [
      ['openssl rand -hex 4', /^[0-9a-f]{8}\n$/, '-hex -- rand 4'],
      ['openssl rand -out=/dev/null -hex 4', /^$/, '-out /dev/null -hex -- rand 4'],
      ['openssl rand -he 4', 'fails', 'error'],
      ['openssl rand -hexbase64 4', 'fails', 'error'],
    ] },
    // pflag: `-R=foo` gives `foo` (`-R==foo` gives `=foo`); no prefixes.
    { parser: 'cobra', tool: 'gh', rows: [
      ['gh pr list -R=foo', /got "foo"/, '-R foo -- pr list'],
      ['gh pr list -R==foo', /got "=foo"/, '-R =foo -- pr list'],
      ['gh pr list -Rfoo', /got "foo"/, '-R foo -- pr list'],
      ['gh pr list --repo=foo', /got "foo"/, '--repo foo -- pr list'],
      ['gh pr list --rep foo', 'fails', 'error'],
    ] },
    // iproute2's matches(): any prefix selects the first option that has it.
    { parser: 'iproute2', tool: 'ip', rows: [
      ['ip -Ver', /^ip utility/, '-Version --'],
      ['ip -brie link show lo', /^lo +UNKNOWN/, '-brief -- link show lo'],
    ] },
    // jq: clusters, options after the filter, no `--name=value`.
    { parser: 'jq', tool: 'jq', rows: [
      ['jq -nr \'"a"\'', /^a\n$/, '-n -r -- "a"'],
      ['jq -n \'"a"\' -r', /^a\n$/, '-n -r -- "a"'],
      ['jq -n --arg=x 1 .', 'fails', 'error'],
    ] },
    // git before its subcommand: no clusters, no attached short values; `--name=value`.
    { parser: 'git', tool: 'git', rows: [
      ['git -pP version', 'fails', 'error'],
      ['git -C. version', 'fails', 'error'],
      ['git --git-dir=/nonexistent version', /^git version/, '--git-dir /nonexistent -- version'],
    ] },
    // dpkg's myopt: `-f=x` gives `x`.
    { parser: 'dpkg', tool: 'dpkg-query', rows: [
      ['dpkg-query -f=\'${Package}\\n\' -W dpkg', /^dpkg\n$/, '-f ${Package}\\n -W -- dpkg'],
    ] },
  ];
  for (const { parser, tool, rows } of TOOLS) {
    withTool(parser, tool, `${parser}: as ${tool} reads its options`, () => {
      for (const [line, does, reads] of rows) {
        const r = run(line);
        if (does === 'fails') assert.notStrictEqual(r.status, 0, line);
        else assert.match(r.out + r.err, does, line);
        const { parse, words } = parseLine(line);
        assert.strictEqual(normalized(parse, words), reads, line);
      }
    });
  }

  it('every preset has rows compared with a real parser, and says which ran', () => {
    assert.deepStrictEqual(Object.keys(PARSERS).filter((p) => !CHECKED.has(p as OptionParser)), []);
    const missed = [...CHECKED].filter((p) => !RAN.has(p));
    if (missed.length) console.log(`      (presets not compared here, their tool is missing: ${missed.join(', ')})`);
  });
});

// bash's `test` and `[` read no options: every word is part of the expression, also `-eq` or `--version` where the
// expression has no place for them (`test 1 -eq 2 --version`: bash says "`--version' unexpected"). No word is
// explained as an option.
describe('test reads no options, as bash', () => {
  const analyzer = new Analyzer('en');
  const parser = createUnbashParser();
  const kinds = (line: string): string[] => {
    const all = (t: Token): Token[] => [t, ...t.children.flatMap(all)];
    return analyzer.explainLine(parser.parse(line), 0, 'bash')!.items.flatMap(all).slice(1).map((t) => `${t.label}: ${t.kind}`);
  };
  for (const line of ['test 1 -eq 2 --version', '[ 1 -eq 2 --version ]', 'test --version', 'test --help', 'test -eq', 'test 1 -eq 2 -x']) {
    it(line, () => {
      const r = run(line);
      // A word in a place that is not an operator's is a syntax error (status 2), not an unknown option.
      if (r.status === 2) assert.match(r.err, /unexpected|too many arguments|expected/, line);
      else assert.ok(r.status === 0 || r.status === 1, line);
      assert.deepStrictEqual(kinds(line).filter((k) => /: option$/.test(k)), [], line);
    });
  }
});
