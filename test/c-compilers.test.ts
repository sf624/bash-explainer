// cc, c++, g++, clang and clang++ read gcc's command line (src/dict/system.ts, `cCompiler`). The options the specs list
// are compared with the real compilers found on PATH (separate programs; a missing one is skipped).
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { Analyzer, type Token } from '../src/analyzer';
import { commands } from '../src/dict/commands';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { allTokens } from './support/explain';

const NAMES = ['gcc', 'cc', 'c++', 'g++', 'clang', 'clang++'];
const present = (n: string): boolean => spawnSync(n, ['--version'], { stdio: 'ignore' }).status === 0;
const accepts = (n: string, ...opts: string[]): boolean => spawnSync(n, ['-fsyntax-only', '-x', 'c', '/dev/null', ...opts], { stdio: 'ignore' }).status === 0;

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
    assert.match(text(src, '-DX=1'), /macro `X=1`/);
    assert.match(text(src, '-UY'), /undefine the macro `Y`/);
    assert.match(text(src, '-Wl,-rpath,.'), /linker: `-rpath \.`/);
    assert.match(text(src, 'main.cpp'), /source file/);
    assert.match(text('gcc -I inc -l m a.c', 'inc'), /Value for `-I`/);
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
      '-lm', '-Iinc', '-L.', '-DX=1', '-UX', '-Wl,-x'];
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
        // (cc and c++ are whichever the system chose: only the others are known to differ.)
        const own = only[n];
        if (!own) return;
        for (const o of own.yes) assert.ok(accepts(n, o), `${n} accepts ${o}`);
        for (const o of own.no) assert.ok(!accepts(n, o), `${n} refuses ${o}`);
      });
    }
  });
});
