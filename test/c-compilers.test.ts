// cc, c++, g++, clang and clang++ read gcc's command line (src/dict/system.ts, `cCompiler`). The options the specs list
// are compared with the real compilers found on PATH (separate programs; a missing one is skipped).
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Analyzer, type Token } from '../src/analyzer';
import { commands } from '../src/dict/commands';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { allTokens } from './support/explain';

const NAMES = ['gcc', 'cc', 'c++', 'g++', 'clang', 'clang++'];
const present = (n: string): boolean => spawnSync(n, ['--version'], { stdio: 'ignore' }).status === 0;
// (-MD writes a .d file next to the working directory: run in a directory of its own.)
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-'));
after(() => fs.rmSync(work, { recursive: true, force: true }));
const accepts = (n: string, ...opts: string[]): boolean => spawnSync(n, ['-fsyntax-only', '-x', 'c', '/dev/null', ...opts], { stdio: 'ignore', cwd: work }).status === 0;

function tokens(src: string): Token[] {
  return allTokens(new Analyzer('en').explainLine(createUnbashParser().parse(src), 0).items);
}
const text = (src: string, word: string): string => tokens(src).find((t) => t.label === word)!.explanation;

describe('cc, c++, g++, clang and clang++ as variants of gcc', () => {
  it('have a spec of their own, with gcc\'s options', () => {
    const base = commands.gcc.options!.map((o) => o.names[0]);
    for (const n of NAMES.slice(1)) {
      assert.ok(commands[n], n);
      const names = commands[n].options!.map((o) => o.names[0]);
      for (const o of base.filter((b) => b !== '-fanalyzer' && b !== '-fdiagnostics-color')) assert.ok(names.includes(o), `${n} ${o}`);
    }
  });

  it('say what each is', () => {
    assert.match(text('g++ -c a.cpp', 'g++'), /^C\+\+ compiler \(GCC\).*libstdc\+\+/);
    assert.match(text('clang -c a.c', 'clang'), /^C compiler \(Clang\)/);
    assert.match(text('cc -c a.c', 'cc'), /default/);
    assert.match(text('c++ -c a.c', 'c++'), /^C\+\+ compiler/);
    assert.match(text('clang++ -c a.c', 'clang++'), /^C\+\+ compiler \(Clang\)/);
  });

  it('read the options in the same word', () => {
    const src = 'g++ -std=c++17 -lm -Iinc -L/opt/lib -DX=1 -UY -Wl,-rpath,. -O2 main.cpp -o app';
    assert.match(text(src, '-std=c++17'), /language standard.*`c\+\+17`/);
    assert.match(text(src, '-lm'), /library `libm`/);
    assert.match(text(src, '-Iinc'), /`inc`.*headers/);
    assert.match(text(src, '-L/opt/lib'), /`\/opt\/lib`.*libraries/);
    assert.strictEqual(text(src, '-DX=1'), 'define the macro `X` as `1`');
    assert.strictEqual(text('gcc -DDEBUG a.c', '-DDEBUG'), 'define the macro `DEBUG` (as `1`)');
    assert.strictEqual(text('gcc -DV= a.c', '-DV='), 'define the macro `V` as ``');
    assert.match(text(src, '-UY'), /undefine the macro `Y`/);
    assert.match(text(src, '-Wl,-rpath,.'), /linker: `-rpath \.`/);
    assert.match(text(src, 'main.cpp'), /source file/);
    assert.match(text('gcc -I inc -l m a.c', 'inc'), /Value for `-I`/);
  });

  it('read the dependency, include and pass-through options', () => {
    const src = 'gcc -MMD -MP -MF a.d -MT a.o -isystem /opt/inc -include cfg.h -Wa,--noexecstack -Wp,-MD,x.d -MD a.c';
    for (const w of ['-MMD', '-MP', '-MD']) assert.ok(!/not in the dictionary/.test(text(src, w)), w);
    assert.match(text(src, 'a.d'), /Value for `-MF`/);
    assert.match(text(src, 'a.o'), /Value for `-MT`/);
    assert.match(text(src, '/opt/inc'), /Value for `-isystem`/);
    assert.match(text(src, 'cfg.h'), /Value for `-include`/);
    assert.match(text(src, '-Wa,--noexecstack'), /assembler: `--noexecstack`/);
    assert.match(text(src, '-Wp,-MD,x.d'), /preprocessor: `-MD x\.d`/);
  });

  it('take -std only with its value attached', () => {
    assert.match(text('gcc -std=c11 a.c', '-std=c11'), /\(value: `c11`\)/);
    assert.strictEqual(tokens('gcc -std c11 a.c').find((t) => t.label === 'c11')!.explanation, 'source file');
  });

  it('give each compiler its own warning options', () => {
    assert.match(text('clang -Weverything a.c', '-Weverything'), /every warning/);
    assert.match(text('gcc -fanalyzer a.c', '-fanalyzer'), /static analyzer/);
    assert.match(text('gcc -Weverything a.c', '-Weverything'), /not in the dictionary/);
    assert.match(text('clang -fanalyzer a.c', '-fanalyzer'), /not in the dictionary/);
    assert.match(text('gcc -fdiagnostics-color=always a.c', '-fdiagnostics-color=always'), /colour/);
    assert.match(text('clang -fcolor-diagnostics a.c', '-fcolor-diagnostics'), /colour/);
  });

  describe('compared with the real compilers', () => {
    const shared = ['-g', '-O0', '-O2', '-O3', '-Os', '-Wall', '-Wextra', '-Werror', '-fPIC', '-pedantic', '-w', '-pthread', '-fopenmp', '-std=c11', '-fsanitize=address',
      '-lm', '-Iinc', '-L.', '-DX=1', '-UX', '-Wl,-x', '-Wa,--noexecstack', '-Wp,-MD,/dev/null', '-MMD', '-MD'];
    const only: Record<string, { yes: string[]; no: string[] }> = {
      gcc: { yes: ['-fanalyzer', '-fdiagnostics-color=always'], no: ['-Weverything'] },
      'g++': { yes: ['-fanalyzer'], no: ['-Weverything'] },
      clang: { yes: ['-Weverything', '-fcolor-diagnostics'], no: ['-fanalyzer'] },
      'clang++': { yes: ['-Weverything', '-fcolor-diagnostics'], no: ['-fanalyzer'] },
    };
    for (const n of NAMES) {
      it(n, function () {
        if (!present(n)) return this.skip();
        for (const o of shared) {
          assert.ok(accepts(n, o), `${n} accepts ${o}`);
          assert.ok(!/not in the dictionary/.test(text(`${n} ${o} a.c`, o)), `${n}: ${o} is in the spec`);
        }
        for (const [o, v] of [['-isystem', '/usr/include'], ['-MF', '/dev/null'], ['-MT', 'x.o']]) {
          assert.ok(accepts(n, ...(o.startsWith('-M') ? ['-MD'] : []), o, v), `${n} accepts ${o} ${v}`);
          assert.match(text(`${n} ${o} ${v} a.c`, v), new RegExp('Value for `' + o + '`'));
        }
        assert.ok(accepts(n, '-include', '/dev/null'), `${n} accepts -include`);
        assert.ok(accepts(n, '-MD', '-MP'), `${n} accepts -MP with -MD`);
        assert.ok(!accepts(n, '-std', 'c11'), `${n} refuses -std c11`);
        // (-D NAME=VALUE: the macro is NAME, with the value VALUE.)
        const dm = spawnSync(n, ['-DDEBUG=7', '-dM', '-E', '-x', 'c', '/dev/null'], { encoding: 'utf8' }).stdout;
        assert.match(dm, /^#define DEBUG 7$/m);
        assert.match(spawnSync(n, ['-DDEBUG', '-dM', '-E', '-x', 'c', '/dev/null'], { encoding: 'utf8' }).stdout, /^#define DEBUG 1$/m);
        // (cc and c++ are whichever the system chose: only the others are known to differ.)
        const own = only[n];
        if (!own) return;
        for (const o of own.yes) assert.ok(accepts(n, o), `${n} accepts ${o}`);
        for (const o of own.no) assert.ok(!accepts(n, o), `${n} refuses ${o}`);
      });
    }
  });
});
