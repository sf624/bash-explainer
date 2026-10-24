// What a command name is (src/semantics/names.ts `nameFacts`, said by src/namefacts.ts), against bash. Each row is a
// script whose last line has the name; the model gives what runs, who looks it up, and the other meanings of the
// name with the code that reaches each. bash checks the three, with fake programs first in PATH that print
// `program` (the dictionary's programs of the names: the model does not know the file system), functions that
// print `function` and aliases that print `alias`:
// - the last line runs what the model says (when it can run here: not `sudo`);
// - each code of `reach` runs the other meaning it is given for (a reserved word's code is the name, first and
//   unquoted; a builtin turned off with `enable -n`, `enable NAME` first);
// - `type -a NAME` lists the same meanings, but for the differences in `gaps`, each with its reason.
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Analyzer, type Token } from '../src/analyzer';
import { nameSaid } from '../src/messages';
import { nameFacts, type NameKind } from '../src/semantics/names';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { runBash } from './support/bash';
import { allTokens } from './support/explain';
import { readingNodes } from '../src/reading';
import { toMarkdown, toPlainMarkdown } from '../src/ui/render';

const parser = createUnbashParser();

/** The programs the fake PATH has, which print `program`: the dictionary's programs of the names in the rows. */
const FAKES = ['echo', 'printf', 'kill', 'test', '[', 'true', 'pwd', 'time', 'grep', 'ls', 'apt-get', 'git', 'useradd'];
/** The real programs the rows run, linked into the fake PATH. */
const REAL = ['bash', 'env', 'xargs', 'find', 'nohup'];

interface Row {
  script: string;
  /** The label of the token with the name. */
  label: string;
  runs: NameKind;
  by?: string;
  /** The other meanings: [kind, ...reach]. */
  also?: [NameKind, ...string[]][];
  /** The last line cannot run here (`sudo`), or runs more than one kind (an alias that runs the program of its name). */
  noRun?: string;
  /** Nothing runs: what bash says, in place of a kind that ran. */
  fails?: RegExp;
  /** What `type -a` lists that the model does not give, or the other way round, with why. */
  gaps?: Record<string, string>;
}

const rows: Row[] = [
  { script: 'echo x', label: 'echo', runs: 'builtin', also: [['program', 'env echo']] },
  { script: 'time :', label: 'time', runs: 'keyword', also: [['program', '\\time', 'command time']] },
  { script: '[ -f x ]', label: '[', runs: 'builtin', also: [['program', 'env [']] },
  { script: 'cd /', label: 'cd', runs: 'builtin' },
  { script: 'apt-get install -y curl', label: 'apt-get', runs: 'program' },
  { script: 'git commit -m x', label: 'git', runs: 'program' },
  { script: 'echo() { printf "function\\n"; }\necho x', label: 'echo', runs: 'function', also: [['builtin', 'builtin echo', 'command echo'], ['program', 'env echo']] },
  { script: 'ls() { printf "function\\n"; }\nls', label: 'ls', runs: 'function', also: [['program', 'command ls']] },
  { script: 'sudo echo x', label: 'echo', runs: 'program', by: 'sudo', also: [['builtin', 'echo']], noRun: 'no sudo here' },
  { script: 'nohup echo x', label: 'echo', runs: 'program', by: 'nohup', also: [['builtin', 'echo']] },
  { script: 'exec echo x', label: 'echo', runs: 'program', by: 'exec', also: [['builtin', 'echo']] },
  { script: 'find . -maxdepth 0 -exec echo x \\;', label: 'echo', runs: 'program', by: 'find -exec', also: [['builtin', 'echo']] },
  { script: 'printf "x\\n" | xargs kill', label: 'kill', runs: 'program', by: 'xargs', also: [['builtin', 'kill']] },
  { script: 'command time x', label: 'time', runs: 'program', by: 'command', also: [['keyword']] },
  { script: '\\time x', label: '\\time', runs: 'program', also: [['keyword']] },
  { script: 'env time x', label: 'time', runs: 'program', by: 'env', also: [['keyword']] },
  {
    script: 'f() { printf "function\\n"; }\ncommand f', label: 'f', runs: 'program', by: 'command', also: [['function', 'f']],
    gaps: { program: 'no program has this name: bash looks for one in PATH, and fails (command not found)' },
  },
  { script: 'builtin nope', label: 'nope', runs: 'none', by: 'builtin' },
  // (The other meanings are reached from what the bare name runs first: a reserved word, a function.)
  { script: 'builtin time', label: 'time', runs: 'none', by: 'builtin', also: [['keyword'], ['program', '\\time', 'command time']] },
  { script: 'builtin ls', label: 'ls', runs: 'none', by: 'builtin', also: [['program', 'ls']] },
  { script: 'ls() { printf "function\\n"; }\nbuiltin ls', label: 'ls', runs: 'none', by: 'builtin', also: [['function', 'ls'], ['program', 'command ls']] },
  {
    script: 'enable -n echo\nbuiltin echo x', label: 'echo', runs: 'none', by: 'builtin', also: [['builtin'], ['program', 'echo']],
    gaps: { builtin: '`type -a` leaves out a builtin turned off by `enable -n`; the model says it is there, turned off' },
  },
  { script: 'function time { printf "function\\n"; }\ntime :', label: 'time', runs: 'keyword', also: [['function', '\\time'], ['program', 'command time']] },
  { script: 'function time { printf "function\\n"; }\n\\time x', label: '\\time', runs: 'function', also: [['keyword'], ['program', 'command time']] },
  { script: 'function time { printf "function\\n"; }\ncommand time x', label: 'time', runs: 'program', by: 'command', also: [['keyword'], ['function', '\\time']] },
  { script: 'useradd() { printf "function\\n"; }\nuseradd x', label: 'useradd', runs: 'function', also: [['program', 'command useradd']] },
  // (A reserved word is no command: `command` looks for a program of the name, and finds none.)
  { script: 'command [[ -f x ]]', label: '[[', runs: 'none', by: 'command', also: [['keyword']], fails: /\[\[: command not found/ },
  // (A builtin with no program of its name: the program run in its place is not found.)
  {
    script: 'nohup cd /', label: 'cd', runs: 'program', by: 'nohup', also: [['builtin', 'cd']], fails: /nohup: failed to run command 'cd': No such file or directory/,
    gaps: { program: 'no program has this name: `nohup` looks for one in PATH, and fails' },
  },
  {
    script: 'sudo cd /', label: 'cd', runs: 'program', by: 'sudo', also: [['builtin', 'cd']], noRun: 'no sudo here',
    gaps: { program: 'no program has this name: `sudo` looks for one in PATH, and fails (command not found)' },
  },
  { script: 'enable -n echo\necho x', label: 'echo', runs: 'program', also: [['builtin']], gaps: { builtin: '`type -a` leaves out a builtin turned off by `enable -n`; the model says it is there, turned off' } },
  { script: 'hash -p @BIN@/echo myecho\nmyecho x', label: 'myecho', runs: 'program', gaps: { program: '`type -a` lists only files found in PATH, not a path given by `hash -p`' } },
  {
    script: 'eval() { printf "function\\n"; }\nset -o posix\neval :', label: 'eval', runs: 'builtin',
    gaps: { function: 'in POSIX mode bash finds a special builtin before a function, so no code reaches the function by its name' },
  },
  { script: 'shopt -s expand_aliases\nalias grep=\'echo alias\'\ngrep x', label: 'grep', runs: 'alias', also: [['program', '\\grep', 'command grep']] },
  {
    script: 'shopt -s expand_aliases\nalias ls=\'ls -l\'\nls', label: 'ls', runs: 'alias', also: [['program', '\\ls', 'command ls']],
    noRun: 'the alias runs the program of its name: both run',
  },
  { script: 'shopt -s expand_aliases\nalias grep=\'echo alias\'\n\\grep x', label: '\\grep', runs: 'program', also: [['alias', 'grep']] },
  {
    script: 'alias ll=\'echo alias\'\nll x', label: 'll', runs: 'program',
    // (Without `shopt -s expand_aliases`, bash expands no alias in a script, and `type` does not list it either.)
    also: [['alias']],
    gaps: {
      program: 'no program has this name: bash looks for one in PATH, and fails (command not found)',
      alias: 'the model lists the alias that is not expanded here; `type -a` does not',
    },
  },
];

/** A command on the process's PATH. */
function which(name: string): string {
  for (const d of (process.env.PATH ?? '').split(':')) {
    const p = path.join(d, name);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      if (d && fs.statSync(p).isFile()) return p;
    } catch {
      // (Not there, or not a program: the next directory.)
    }
  }
  throw new Error(`${name} not found`);
}

describe('what a command name is, against bash', () => {
  let dir = '';
  let bin = '';
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'name-kinds-'));
    bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    for (const n of FAKES) fs.writeFileSync(path.join(bin, n), '#!/bin/sh\necho program\n', { mode: 0o755 });
    for (const n of REAL) fs.symlinkSync(which(n), path.join(bin, n));
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const sh = (script: string) => runBash(script, { cwd: dir, env: { PATH: bin, FUNCNEST: '20' }, program: path.join(bin, 'bash'), timeout: 10000 });
  /** What a run printed says ran: our fakes, a function or an alias, `time`'s report, or else a builtin. */
  const ran = (r: { stdout: string; stderr: string }): string => {
    if (/^program$/m.test(r.stdout) || /command not found/.test(r.stderr)) return 'program';
    if (/^function$/m.test(r.stdout)) return 'function';
    if (/^alias/m.test(r.stdout)) return 'alias';
    if (/^real\s/m.test(r.stderr)) return 'keyword';
    if (/not a shell builtin/.test(r.stderr)) return 'none';
    return 'builtin';
  };
  /** The kinds `type -a` lists (each once; a function's body lines are not about a kind). */
  const typeKinds = (name: string, out: string): string[] => [...new Set(out.split('\n').filter((l) => l.startsWith(`${name} is `)).map((l) => (/ is aliased to /.test(l) ? 'alias'
    : / is a shell keyword/.test(l) ? 'keyword' : / is a function/.test(l) ? 'function' : / is a (special )?shell builtin/.test(l) ? 'builtin' : 'program')))];

  for (const row of rows) {
    it(row.script.replace(/\n/g, '; '), () => {
      const script = row.script.replace('@BIN@', bin);
      const lines = script.split('\n');
      const ex = new Analyzer('en').explainLine(parser.parse(script), lines.length - 1);
      const t = allTokens(ex.items).find((x: Token) => x.label === row.label && x.name);
      assert.ok(t, JSON.stringify(allTokens(ex.items).map((x) => [x.label, x.name?.runs])));
      const n = t.name!;
      assert.deepStrictEqual({ runs: n.runs, by: n.by, also: n.also.map((o) => [o.kind, ...o.reach]) }, { runs: row.runs, by: row.by, also: row.also ?? [] });
      const setup = lines.slice(0, -1).join('\n');
      if (row.fails) assert.match(sh(script).stderr, row.fails, 'what bash says');
      else if (!row.noRun) assert.strictEqual(ran(sh(script)), row.runs, 'what runs');
      for (const o of n.also) {
        // (`[[` prints nothing: bash reads it as the reserved word when the test parses and succeeds.)
        if (o.kind === 'keyword' && n.name === '[[') {
          assert.deepStrictEqual(sh(`${setup}\n[[ -n x ]]`), { stdout: '', stderr: '', status: 0 });
          continue;
        }
        const codes = o.kind === 'keyword' ? [`${n.name} :`] : o.off ? [`enable ${n.name}; ${n.name} x`] : o.reach.map((c) => `${c} x`);
        for (const c of codes) {
          const r = sh(`${setup}\n${c}`);
          assert.strictEqual(ran(r), o.kind, `${c}: ${JSON.stringify(r)}`);
        }
      }
      const listed = typeKinds(n.name, sh(`${setup}\ntype -a ${n.name}`).stdout);
      const ours = [n.runs === 'none' ? [] : [n.runs], ...n.also.map((o) => o.kind)].flat();
      const differ = [...listed.filter((k) => !ours.includes(k as NameKind)), ...ours.filter((k) => !listed.includes(k))];
      assert.deepStrictEqual(differ.sort(), Object.keys(row.gaps ?? {}).sort(), `type -a: ${listed.join(', ')}`);
    });
  }
});

describe('what a command name is, in the model and the texts', () => {
  const tokens = (src: string, line = 0, lang: 'en' | 'ja' = 'en') => allTokens(new Analyzer(lang).explainLine(parser.parse(src), line).items);

  it('gives no badge to a subcommand, and one to each command name', () => {
    const ts = tokens('git commit -m x');
    assert.strictEqual(ts.find((t) => t.label === 'commit')!.name, undefined);
    assert.strictEqual(ts.find((t) => t.label === 'git')!.name!.said.kind, 'program');
    assert.strictEqual(tokens('[[ -f x ]]')[0].name!.runs, 'keyword');
  });

  it('shows an alias with its own kind', () => {
    const t = tokens('shopt -s expand_aliases\nalias ll=\'ls -l\'\nll', 2)[0];
    assert.strictEqual(t.kind, 'alias');
    assert.strictEqual(t.name!.runs, 'alias');
    // (Not expanded, the alias is still the token's kind; bash looks for a program.)
    const off = tokens('alias ll=\'ls -l\'\nll', 1)[0];
    assert.strictEqual(off.kind, 'alias');
    assert.strictEqual(off.name!.runs, 'program');
  });

  it('says the kinds and the other meanings in both languages', () => {
    const sudo = tokens('sudo echo hi').find((t) => t.label === 'echo')!.name!.said;
    assert.deepStrictEqual([sudo.kind, sudo.by, sudo.also, sudo.short], ['program', 'run by `sudo`', '`sudo` looks the name up, so this is the program, not bash\'s builtin', ' (program, run by `sudo`)']);
    const ja = tokens('sudo echo hi', 0, 'ja').find((t) => t.label === 'echo')!.name!.said;
    assert.deepStrictEqual([ja.kind, ja.by, ja.short], ['プログラム', '`sudo` が実行', '（プログラム。`sudo` が実行）']);
    assert.strictEqual(tokens('time :', 0, 'ja')[0].children[0].name!.said.also, '同じ名前で、ほかに: プログラム（ふつうは `/usr/bin/time`。`\\time`・`command time` で動く）');
    assert.strictEqual(tokens('function time { :; }\ntime :', 1, 'ja')[0].children[0].name!.said.also,
      '同じ名前で、ほかに: このスクリプトの関数（`\\time` で動く）・プログラム（ふつうは `/usr/bin/time`。`command time` で動く）');
    assert.deepStrictEqual([ja.spoken, sudo.spoken], ['プログラム、sudo が実行', 'program, run by sudo']);
    const fn = tokens('echo() { :; }; echo hi').find((t) => t.kind === 'function' && t.name)!.name!.said;
    assert.strictEqual(fn.also, 'Same name, also: bash\'s builtin (run with `builtin echo` or `command echo`); a program, usually `/usr/bin/echo` (run with `env echo`)');
    const off = tokens('enable -n echo\necho x', 1, 'ja')[0].name!.said;
    assert.strictEqual(off.also, '同じ名前で、ほかに: bash のビルトイン（`enable -n` で無効。`enable echo` で有効に戻る）');
    assert.strictEqual(tokens('enable -n echo\necho x', 1)[0].name!.said.also, 'Same name, also: bash\'s builtin, turned off by `enable -n` (`enable echo` turns it on again)');
  });

  it('says why nothing runs, and where no program has the name', () => {
    const said = (src: string, label: string, lang: 'en' | 'ja' = 'en') => {
      const lines = src.split('\n');
      return tokens(src, lines.length - 1, lang).find((t) => t.label === label && t.name)!.name!.said;
    };
    const ls = said('builtin ls', 'ls');
    assert.deepStrictEqual([ls.kind, ls.by, ls.also], ['nothing runs', '`builtin` finds no builtin named `ls`', 'Same name, also: a program in PATH (run with `ls`)']);
    assert.strictEqual(said('builtin ls', 'ls', 'ja').by, '`builtin` が探しても `ls` という名前のビルトインはない');
    assert.strictEqual(said('enable -n echo\nbuiltin echo x', 'echo').by, '`builtin` finds no builtin named `echo`');
    assert.strictEqual(said('command [[ -f x ]]', '[[').by, '`command` finds no command named `[[` (bash says `[[: command not found`)');
    assert.strictEqual(said('command [[ -f x ]]', '[[', 'ja').by, '`command` が探しても `[[` という名前のコマンドはない（bash は `[[: command not found` と表示する）');
    assert.strictEqual(said('\\[[ -f x ]]', '\\[[').by, 'bash finds no command named `[[` (bash says `[[: command not found`)');
    assert.strictEqual(said('sudo cd /', 'cd').also, '`sudo` looks the name up, so bash\'s builtin does not run, and there is usually no program of this name');
    assert.strictEqual(said('sudo cd /', 'cd', 'ja').also, '`sudo` が名前を探すので、bash のビルトインは動かない。この名前のプログラムはふつうない');
    assert.strictEqual(said('enable -n cd\ncd /', 'cd', 'ja').also, 'この名前のプログラムはふつうない。同じ名前で、ほかに: bash のビルトイン（`enable -n` で無効。`enable cd` で有効に戻る）');
    assert.strictEqual(said('enable -n cd\ncd /', 'cd').also, 'There is usually no program of this name. Same name, also: bash\'s builtin, turned off by `enable -n` (`enable cd` turns it on again)');
    assert.strictEqual(said('alias ll=\'ls -l\'\nll', 'll').also, 'Same name, also: an alias, not expanded here (needs `shopt -s expand_aliases`)');
    assert.strictEqual(said('alias ll=\'ls -l\'\nll', 'll', 'ja').also, '同じ名前で、ほかに: エイリアス（ここでは展開されない。`shopt -s expand_aliases` が要る）');
    assert.strictEqual(said('useradd() { :; }\nuseradd x', 'useradd').also, 'Same name, also: a program in PATH (run with `command useradd`)');
    assert.strictEqual(said('useradd() { :; }\nuseradd x', 'useradd', 'ja').also, '同じ名前で、ほかに: PATH の中のプログラム（`command useradd` で動く）');
  });

  it('names nothing else for a path, and no bash-only builtin in another shell', () => {
    assert.deepStrictEqual(nameFacts({ kind: 'file', name: '/bin/echo', path: 'given', known: true }), { name: '/bin/echo', runs: 'program', also: [] });
    assert.deepStrictEqual(nameFacts({ kind: 'file', name: 'shopt', path: 'search', known: false }, { shell: 'sh' }).also, []);
    assert.deepStrictEqual(nameFacts({ kind: 'file', name: 'shopt', path: 'search', known: false }).also, [{ kind: 'builtin', reach: ['shopt'] }]);
    const none = nameSaid('ja', { name: 'x', runs: 'none', also: [{ kind: 'alias', reach: [] }] });
    assert.deepStrictEqual([none.kind, none.also], ['実行されない', '同じ名前で、ほかに: エイリアス']);
    assert.strictEqual(nameSaid('en', { name: 'x', runs: 'alias', also: [{ kind: 'none', reach: [] }] }).also, 'Same name, also: nothing');
    assert.strictEqual(nameSaid('en', { name: 'x', runs: 'none', also: [] }).by, '`builtin` finds no builtin named `x`');
    // (With no lookup, the name is read as in a script that defines nothing.)
    assert.deepStrictEqual(nameFacts({ kind: 'keyword', name: 'time' }, { program: (n) => n === 'time' }).also, [{ kind: 'program', reach: ['\\time', 'command time'] }]);
  });
});

describe('what a command name is, in the outputs with no badge and in the reading tree', () => {
  const ex = (src: string, lang: 'en' | 'ja' = 'en') => new Analyzer(lang).explainLine(parser.parse(src), 0, undefined, { reading: true });

  it('says the kind in the hover and in Markdown, where the explanation no longer does', () => {
    const e = ex('sudo echo hi; cd /');
    assert.ok(!allTokens(e.items).some((t) => /shell builtin|coreutils program/.test(t.explanation)));
    const md = toPlainMarkdown(e, 'sudo echo hi; cd /', 'a.sh:1');
    assert.match(md, /^- `sudo` — Run a command as another user \(root by default\) \(program\)$/m);
    assert.match(md, /^ {2}- `echo` — runs `echo`: .* \(from coreutils\) \(program, run by `sudo`\)$/m);
    assert.match(md, /^- `cd` — Change the current directory \(builtin\)/m);
    assert.match(toMarkdown(e, 'en'), /— Change the current directory \(builtin\)/);
    assert.match(toPlainMarkdown(ex('cd /', 'ja'), 'cd /', 'a.sh:1', 'ja'), /— カレントディレクトリを移動する（ビルトイン）/);
  });

  it('puts the facts on the nodes of the reading tree', () => {
    const nodes = readingNodes(ex('time sudo echo hi; echo hi').reading!);
    const names = nodes.filter((n) => n.name).map((n) => `${n.kind} ${n.label} ${n.name!.runs}${n.name!.by ? ` by ${n.name!.by}` : ''}`);
    assert.deepStrictEqual(names, ['keyword time keyword', 'commandName sudo program', 'command echo program by sudo', 'commandName echo builtin']);
    const alias = readingNodes(new Analyzer('en').explainLine(parser.parse('shopt -s expand_aliases\nalias ll=\'ls -l\'\nll'), 2, undefined, { reading: true }).reading!);
    assert.strictEqual(alias.find((n) => n.kind === 'aliasWord')!.name!.runs, 'alias');
    // (A command of a string read as a script.)
    const inner = readingNodes(ex('bash -c "cd /"').reading!).find((n) => n.label === 'cd' && n.name);
    assert.strictEqual(inner?.name!.runs, 'builtin');
  });
});
