import * as assert from 'assert';
import { run } from './support/run';
import { execFileSync } from 'child_process';
import type { BashVersion } from '../src/bashversion';
import { runContained } from './support/contained';
import { random } from './support/fuzz';
import { Analyzer } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { readSampleLine, runRead, runXargs, showCommand, testCases, xargsExample } from '../src/examples/runtime';

describe('xargs agrees with GNU xargs', () => {
  const cases: [string[], string[]][] = [
    [['-n', '2'], ['rm']], [['-I{}'], ['mv', '{}', '{}.bak']], [['-0'], ['rm', '-f']], [['-L', '1'], ['echo']], [[], []], [['-d', ','], ['echo']],
    [['-n1', '-P4'], ['gzip']], [['-r'], ['ls']], [['-n', '3'], ['cp', '-t', 'dest']], [['--max-args=2'], ['echo']],
    // With `-I` and a delimiter, each item is a run of its own.
    [['-0', '-n', '1', '-I{}'], ['rm', '-f', '{}']], [['-0', '-I{}'], ['mv', '{}', '{}.bak']], [['-d', ',', '-I{}'], ['echo', '{}']],
    // `-i`/`--replace` and `-l`/`--max-lines` take a value only attached: the next word is the command (`-I {}`, `-L 1`).
    [['--replace'], ['echo', '{}']], [['-i'], ['mv', '{}', '{}.bak']], [['-i@'], ['echo', '@']], [['--max-lines'], ['echo']], [['-l'], ['echo']], [['--max-l=2'], ['echo']],
  ];
  for (const [opts, cmd] of cases) {
    it([...opts, ...cmd].join(' ') || '(no options)', () => {
      const ex = xargsExample([...opts, ...cmd])!;
      assert.ok(ex, 'has an example');
      // Prefix the command with echo so xargs prints the command lines instead of running them.
      const real = run('xargs', [...opts, 'echo', ...(cmd.length ? cmd : ['echo'])], { input: ex.input }).stdout.toString().trim().split('\n').filter(Boolean);
      // (With -d, the newline ending the input stays in the last item; echo prints it, and the line split above drops it.)
      const mine = runXargs([...opts, ...cmd], ex.input).map((c) => c.join(' ').trimEnd());
      // With -P the runs finish in any order, so GNU xargs' output order is not specified: compare the same lines, sorted.
      if (opts.some((o) => /^-P/.test(o) || o === '--max-procs' || o.startsWith('--max-procs='))) assert.deepStrictEqual([...mine].sort(), [...real].sort());
      else assert.deepStrictEqual(mine, real);
    });
  }
  it('keeps the newline that ends the input in the last item of -d', () => {
    const cases: [string, string][] = [[',', 'a,b,c\n'], [',', 'a,b,\n'], [',', 'a,b,'], ['\\n', 'a\n\nb\n'], [' ', 'a b\tc\n'], [';', 'a;;b'], [',', ''], [',', ',']];
    for (const [d, input] of cases) {
      const real = run('xargs', ['-d', d, 'printf', '[%s]'], { input }).stdout.toString();
      const mine = runXargs(['-d', d, 'printf', '[%s]'], input).map((c) => c.slice(2).map((x) => `[${x}]`).join('')).join('');
      assert.strictEqual(mine === '' ? '[]' : mine, real === '' ? '[]' : real, JSON.stringify([d, input]));
    }
    assert.deepStrictEqual(runXargs(['-d', ',', 'echo'], 'a,b\n'), [['echo', 'a', 'b\n']]);
    assert.strictEqual(showCommand(['echo', 'b\n', "it's\t", 'a\\\x01']), "echo $'b\\n' $'it\\'s\\t' $'a\\\\\\x01'");
  });
  it('-I with -0 or -d: an item is whole, blanks and empty items included; with newlines, leading blanks go', () => {
    const cases: [string[], string][] = [
      [['-0', '-I{}'], ' a b\0c\0'], [['-0', '-I{}'], 'a\0\0b\0'], [['-d', ',', '-I{}'], ' a b,c\n'], [['-d', ',', '-I{}'], 'a,,b,'], [['-I{}'], ' a\n\nb \n'],
    ];
    for (const [opts, input] of cases) {
      const real = run('xargs', [...opts, 'printf', '[%s]', '{}'], { input }).stdout.toString();
      const mine = runXargs([...opts, 'printf', '[%s]', '{}'], input).map((c) => c.slice(2).map((x) => `[${x}]`).join('')).join('');
      assert.strictEqual(mine, real, JSON.stringify([opts, input]));
    }
  });
  it('treats quotes in the input as grouping', () => {
    assert.deepStrictEqual(runXargs(['-n', '1'], 'a "b c" d\\ e\n'), [['echo', 'a'], ['echo', 'b c'], ['echo', 'd e']]);
  });
});

describe('test examples agree with bash', () => {
  const cases: [string, Parameters<typeof testCases>][] = [
    ['[ "$a" -eq 3 ]', ['[', '-eq', { var: 'a' }, { lit: '3' }]], ['[ "$n" -gt 10 ]', ['[', '-gt', { var: 'n' }, { lit: '10' }]],
    ['[ "$n" -le 0 ]', ['[', '-le', { var: 'n' }, { lit: '0' }]], ['[[ $f == *.txt ]]', ['[[', '==', { var: 'f' }, { lit: '*.txt' }]],
    ['[[ $f != *.txt ]]', ['[[', '!=', { var: 'f' }, { lit: '*.txt' }]], ['[[ $f == "*.txt" ]]', ['[[', '==', { var: 'f' }, { lit: '*.txt' }, true]],
    ['[ "$x" = yes ]', ['[', '=', { var: 'x' }, { lit: 'yes' }]], ['[ "$x" != "" ]', ['[', '!=', { var: 'x' }, { lit: '' }]],
    ['[ -z "$v" ]', ['[', '-z', undefined, { var: 'v' }]], ['[ -n "$v" ]', ['[', '-n', undefined, { var: 'v' }, true]],
    // Unquoted and empty, `[ -n $v ]` is `[ -n ]`: true.
    ['[ -n $v ]', ['[', '-n', undefined, { var: 'v' }]],
    ['(( c >= 5 ))', ['((', '>=', { var: 'c' }, { lit: '5' }]], ['(( c == 0 ))', ['((', '==', { var: 'c' }, { lit: '0' }]],
    ['[ 0 -ne "$1" ]', ['[', '-ne', { lit: '0' }, { var: '1' }]],
  ];
  for (const [src, args] of cases) {
    it(src, () => {
      const results = testCases(...args)!;
      assert.ok(results?.length === 2);
      for (const c of results) {
        const set = Object.entries(c.vars).map(([k, v]) => (/^\d+$/.test(k) ? `set -- ${JSON.stringify(v)};` : `${k}=${JSON.stringify(v)};`)).join(' ');
        assert.strictEqual(execFileSync('bash', ['-c', `${set} ${src} && echo true || echo false`]).toString().trim(), String(c.result), `${set} ${src}`);
      }
    });
  }
  it('declines tests that depend on the system', () => {
    assert.strictEqual(testCases('[', '-f', undefined, { var: 'f' }), undefined);
    assert.strictEqual(testCases('[', '-eq', { var: 'a' }, { var: 'b' }), undefined);
  });
});

/** The bashes to compare `read` with: bash 5.2 on PATH, and bash 5.3 when `$BASH_EXPLAINER_BASH53` names one. */
const READ_BASHES: [BashVersion, string][] = [['5.2', 'bash'], ...(process.env.BASH_EXPLAINER_BASH53 ? [['5.3', process.env.BASH_EXPLAINER_BASH53] as [BashVersion, string]] : [])];
/** A string as a bash word, in ANSI-C quotes. */
const ansiC = (text: string): string => `$'${[...text].map((c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')}'`;

describe('read agrees with bash', () => {
  const cases: [string, boolean, string[], string?][] = [
    [' \t\n', true, ['a', 'b', 'c']], [',', true, ['a', 'b', 'c']], ['', true, ['line']], [':', true, ['user', 'rest']], [' \t\n', true, [], 'arr'],
    [' \t\n', false, ['a', 'b']], [', ', true, ['a', 'b']], ['\t', true, ['a', 'b', 'c']],
    // (The vertical tab, the form feed and the carriage return are whitespace too; at the end of the last variable,
    // bash 5.2 keeps them, bash 5.3 does not.)
    ['\v', true, ['a', 'b', 'c']], [':\f', true, ['a', 'b']], ['\r', true, [], 'arr'], ['\v', true, ['a']], ['\v', true, ['a', 'b']],
    // (With no name, REPLY gets the line as it is.)
    [' \t\n', false, []],
    // (Without -r, an escaped `\v` at the end keeps bash's mark, the byte 1, in 5.3; with an IFS of a newline alone,
    // the sample line is not split.)
    ['\v', false, ['a']], ['\n', true, ['a', 'b']],
  ];
  const lines = (ifs: string, names: string[], array?: string) => [readSampleLine(names.length || 1, ifs, !!array), '  lead  trail  ', 'a\\ b c', 'x,,y,', ' a , b ,c ', '\v\va\v\f:b\r\r:\fc\v', '\v\vx\v\v', 'x\v\vy\v\v', 'p x y\\ ', 'x\vy\\\v'];
  for (const [version, bash] of READ_BASHES) {
    for (const [ifs, raw, names, array] of cases) {
      for (const line of lines(ifs, names, array)) {
        it(`bash ${version}: IFS=${JSON.stringify(ifs)} read ${raw ? '-r ' : ''}${array ? `-a ${array}` : names.join(' ')} <<< ${JSON.stringify(line)}`, () => {
          const r = runRead(line, names, { ifs, raw, array, version })!;
          const target = array ?? names.join(' ');
          const dump = array ? `for x in "\${${array}[@]}"; do printf '[%s]' "$x"; done` : (names.length ? names : ['REPLY']).map((n) => `printf '[%s]' "$${n}"`).join('; ');
          const real = execFileSync(bash, ['-c', `IFS="$2" read ${raw ? '-r ' : ''}${array ? '-a ' : ''}${target} <<< "$1"; ${dump}`, '_', line, ifs]).toString();
          const mine = array ? r.array![1].map((x) => `[${x}]`).join('') : r.vars.map(([, v]) => `[${v}]`).join('');
          assert.strictEqual(mine, real);
        });
      }
    }
  }

  it('gives no fields for an IFS with byte 1 or 127, which bash splits erratically', () => {
    // (bash: `IFS=$'\x01' read a b <<< $'x\\\x01y\x01z'` gives a=x, b=$'y\001z'.)
    assert.strictEqual(runRead('x\\\x01y\x01z', ['a', 'b'], { ifs: '\x01', raw: false }), undefined);
    assert.strictEqual(runRead('x', ['a'], { ifs: ' \x7f', raw: true }), undefined);
  });

  // A seeded random comparison: IFS of whitespace, `:` and `,`; lines with them, backslashes, newlines and bash's marks.
  for (const [version, bash] of READ_BASHES) {
    it(`bash ${version}: random lines and IFS`, async function () {
      this.timeout(30000);
      const next = random(2026);
      const rnd = (n: number): number => Math.floor(next() * n);
      const pick = (xs: string): string => xs[rnd(xs.length)];
      const cases = Array.from({ length: 400 }, () => {
        const ifs = rnd(10) === 0 ? ' \t\n' : Array.from({ length: rnd(4) }, () => pick(' \t\n\v\f\r:,')).join('');
        const line = Array.from({ length: rnd(12) }, () => pick(' \t\v\f\r:,ab\\\n a:\x01\x7f')).join('');
        const array = rnd(5) === 0 ? 'arr' : undefined;
        return { ifs, line, raw: rnd(2) === 0, array, names: array ? [] : ['v1', 'v2', 'v3'].slice(0, rnd(4)) };
      });
      const script = cases.map((c) => {
        const dump = c.array ? `for x in "\${arr[@]}"; do printf '%s\\x1f' "$x"; done` : (c.names.length ? c.names : ['REPLY']).map((n) => `printf '%s\\x1f' "$${n}"`).join('; ');
        return `unset arr REPLY v1 v2 v3; IFS=${ansiC(c.ifs)} read ${c.raw ? '-r ' : ''}${c.array ? '-a arr ' : ''}${c.names.join(' ')} <<< ${ansiC(c.line)}; ${dump}; printf '\\x1e'`;
      }).join('\n');
      const out = (await runContained([bash, '-c', script], process.cwd())).stdout.split('\x1e');
      const bad = cases.filter((c, k) => {
        const r = runRead(c.line, c.names, { ifs: c.ifs, raw: c.raw, array: c.array, version })!;
        return (r.array ? r.array[1] : r.vars.map(([, v]) => v)).map((x) => `${x}\x1f`).join('') !== out[k];
      });
      assert.deepStrictEqual(bad, []);
    });
  }
});

describe('the example of read follows the IFS written before it and the input the script gives, as bash reads them', () => {
  /**
   * `src`: the line explained; `names`/`array`: the variables bash is asked for after it (`inside`: `src` prints them
   * itself, with `printf '%s\x1f'`); `pre`: lines before it; `sample`: the line gives `read` no input, so the example
   * reads a made-up line, which bash then reads from a here-string; `optional`: an example may be missing (a value the
   * model does not follow), but one shown is checked.
   */
  interface Row { src: string; names?: string[]; array?: string; pre?: string; inside?: boolean; sample?: boolean; optional?: boolean }
  const S = String.raw;
  const PF = S`printf '%s\x1f'`;
  const rows: Row[] = [
    // The prefix as a word: single and double quotes keep the backslash, `$'…'` decodes it.
    { src: S`IFS='\t' read -r a b <<< 'x\ty'`, names: ['a', 'b'] }, { src: S`IFS="\t" read -r a b <<< 'x\ty'`, names: ['a', 'b'] },
    { src: S`IFS='\t' read -r a <<< 'x\ty'`, names: ['a'] }, { src: S`IFS='\n' read -r a b <<< 'x\ny'`, names: ['a', 'b'] },
    { src: S`IFS="\\" read -r a b <<< 'x\ty'`, names: ['a', 'b'] }, { src: S`IFS="$'\t'" read -r a b <<< 'x\ty'`, names: ['a', 'b'] },
    { src: S`IFS=a$'\t' read -r a b c <<< $'xa\ty'`, names: ['a', 'b', 'c'] },
    { src: S`IFS=: read -r a b c <<< 'x:y:z:w'`, names: ['a', 'b', 'c'] }, { src: S`IFS=: read -r a b <<< 'x:y:z:w'`, names: ['a', 'b'] },
    { src: S`IFS=: read -r a <<< 'x:y'`, names: ['a'] }, { src: S`IFS=, read -r a b c <<< '1,2,,3'`, names: ['a', 'b', 'c'] },
    { src: S`IFS= read -r a <<< ' x '`, names: ['a'] }, { src: S`IFS='' read -r a b <<< ' x y '`, names: ['a', 'b'] },
    { src: S`IFS=$"x" read -r a b <<< 'pxq'`, names: ['a', 'b'] },
    // The same prefixes where the line is the example's own.
    ...[S`$'\t'`, S`$'\v'`, S`$'\f'`, S`$'\r'`, S`$'\n'`, S`$'\e'`, S`$'\t:'`, S`$'\f:'`, S`:`, ',', S`"\t"`, S`'\t'`].flatMap((ifs) => [
      { src: `IFS=${ifs} read -r a b c`, names: ['a', 'b', 'c'], sample: true }, { src: `IFS=${ifs} read -r a b`, names: ['a', 'b'], sample: true },
      { src: `IFS=${ifs} read -r -a arr`, array: 'arr', sample: true },
    ] as Row[]),
    // A here-string that is $'…', a concatenation, escapes, or has an expansion the model follows.
    { src: S`IFS=$'\t' read -r name age <<< $'alice\t30'`, names: ['name', 'age'] }, { src: S`IFS=$'\t' read -r a b <<< p$'\t'q`, names: ['a', 'b'] },
    { src: S`IFS=$'\t' read -r -a arr <<< $'p\t\tq\t'`, array: 'arr' }, { src: S`LC_ALL=C IFS=$'\t' read -r a b <<< $'p\tq'`, names: ['a', 'b'] },
    { src: S`IFS=$'\v' read -r a b <<< $'x\vy'`, names: ['a', 'b'] }, { src: S`IFS=$'\f:' read -r a b <<< $'p\fq:r'`, names: ['a', 'b'] },
    { src: S`IFS=$'\e' read -r a b <<< $'p\eq'`, names: ['a', 'b'] }, { src: S`IFS=: read -r a b <<< $'p:q\\:r'`, names: ['a', 'b'] },
    { src: S`IFS=: read a b <<< $'p:q\\:r'`, names: ['a', 'b'] },
    { src: S`read -r a b <<< $'p q'`, names: ['a', 'b'] }, { src: S`read -r a b <<< "x\\y"`, names: ['a', 'b'] }, { src: S`read -r a b <<< 'a   b'`, names: ['a', 'b'] },
    { src: S`read -r a b <<< $'a b\nc d'`, names: ['a', 'b'] }, { src: S`read a b <<< $'a\\\nb c'`, names: ['a', 'b'] }, { src: S`read -r a <<< ''`, names: ['a'] },
    { src: S`x=$'p\tq'; IFS=$'\t' read -r a b <<< "$x"`, names: ['a', 'b'], optional: true },
    { src: S`x='p:q'; IFS=: read -r a b <<< "$x"`, names: ['a', 'b'], optional: true },
    // A here-document, the compound command around the command, and a pipe that print the line.
    { src: 'IFS=: read -r a b <<E\np:q\nE', names: ['a', 'b'] },
    { src: S`while IFS=$'\t' read -r a b; do ${PF} "$a" "$b"; done <<< $'p\tq'`, inside: true },
    { src: S`{ IFS=: read -r a b; } <<< 'p:q'`, names: ['a', 'b'] },
    { src: S`printf 'p\tq\n' | { IFS=$'\t' read -r a b; ${PF} "$a" "$b"; }`, inside: true, optional: true },
    { src: S`echo 'p:q' | { IFS=: read -r a b; ${PF} "$a" "$b"; }`, inside: true, optional: true },
    // `IFS+=` adds to the IFS in effect.
    { src: S`IFS+=: read -r a b c <<< 'p q:r'`, names: ['a', 'b', 'c'] }, { src: S`IFS=: IFS+=, read -r a b c <<< 'p:q,r'`, names: ['a', 'b', 'c'] },
  ];
  /** What stands for bash's `$a $b` (or the array) after the row, one value after the other, each ended by byte 31. */
  const dump = (r: Row): string => (r.array ? `for x in "\${${r.array}[@]}"; do printf '%s\\x1f' "$x"; done` : (r.names ?? []).map((v) => `printf '%s\\x1f' "$${v}"`).join('; '));
  const explained = rows.map((r) => {
    const src = `${r.pre ? `${r.pre}\n` : ''}${r.src}`;
    const ex = new Analyzer('en').explainLine(createUnbashParser().parse(src), r.pre ? r.pre.split('\n').length : 0).examples.filter((e) => e.kind === 'read');
    const sections = ex[0]?.sections;
    const label = (l: string): string[] => sections!.find((s) => s.label === l)!.lines!;
    return {
      examples: ex.length,
      line: sections ? JSON.parse(label('Line read')[0]) as string : '',
      // (`a="x"` or `arr=("p" "")`: the values, in order.)
      values: sections ? label('Values stored').flatMap((l) => (l.includes('=(') ? l.slice(l.indexOf('=(')) : l.slice(l.indexOf('='))).match(/"(?:[^"\\]|\\.)*"/g)!.map((v) => JSON.parse(v) as string)) : [],
    };
  });

  it('gives an example for each of these, unless the model does not follow a value', () => {
    assert.deepStrictEqual(rows.filter((r, k) => !r.optional && explained[k].examples !== 1).map((r) => r.src), []);
    assert.deepStrictEqual(rows.filter((r, k) => explained[k].examples > 1).map((r) => r.src), []);
  });

  it('gives none where the input or the IFS is not known', () => {
    const none = [
      S`IFS=$'\t' read -r a b <<< "$(printf 'p\tq')"`, S`IFS=$'\t' read -r a b <<< "$RANDOM"`, S`IFS=$'\t' read -r a b <<< $(echo x)`,
      'IFS=$x read -r a b <<< "x y"', 'IFS=$(cat f) read -r a b', 'IFS=${y}: read -r a b', 'IFS=: read -r a b <<< "$y"',
      // (`$(:)` prints nothing only where `:` is the builtin.)
      ':() { echo z; }\nIFS=$(:): read -r a b <<< \'pzq:r\'', 'IFS=$(true): read -r a b <<< "p q"',
      // (`+=` adds to an IFS that is not known: `IFS` may be changed anywhere before.)
      'IFS=$y; IFS+=: read -r a b <<< "p q"', 'IFS+=$y read -r a b <<< "p q"',
      // (A string read as a script takes the input of the command around it.)
      "IFS=: eval read -r a b <<< 'p:q'", "IFS=: eval 'read -r a b' <<< 'p:q'", "bash -c 'IFS=: read -r a b' <<< 'p:q'", "trap 'IFS=: read -r a b' EXIT",
      // (A here-document with an expansion in it, and a here-string of a command's output, in the compound command around.)
      'IFS=: read -r a b <<E\n$y\nE', 'while IFS=: read -r a b; do :; done <<< "$(cat f)"',
    ];
    for (const src of none) {
      const pre = src.includes('\n') && src.startsWith(':()') ? 1 : 0;
      assert.deepStrictEqual(new Analyzer('en').explainLine(createUnbashParser().parse(src), pre).examples.filter((e) => e.kind === 'read'), [], src);
    }
  });

  it('keeps the made-up line where the script gives the text no way to be known', () => {
    // (A file, a pipe that copies one, and a function's body, which takes the input of its call.)
    for (const [src, line] of [['IFS=: read -r a b < f', 0], ['cat f | IFS=: read -r a b', 0], ['cat f | while IFS=: read -r a b; do :; done', 0], ['f() { IFS=: read -r a b; }\nf <<< "p:q"', 0]] as const) {
      const ex = new Analyzer('en').explainLine(createUnbashParser().parse(src), line).examples.filter((e) => e.kind === 'read');
      assert.strictEqual(ex.length, 1, src);
      assert.strictEqual(ex[0].sections[0].lines![0], '"alice:30:tokyo"', src);
    }
  });

  it('shows a control character of the IFS as bash reads it, in the note', () => {
    const notes = (src: string): string => JSON.stringify(new Analyzer('en').explainLine(createUnbashParser().parse(src), 0).notes);
    assert.ok(notes(S`IFS=$'\e' read -r a b`).includes('IFS=$\'\\\\x1b\''), notes(S`IFS=$'\e' read -r a b`));
    assert.ok(!/[\x00-\x1f]/.test(JSON.stringify(notes(S`IFS=$'\f:' read -r a b`)).replace(/\\\\n/g, '')), 'no raw control character');
    assert.ok(notes(S`IFS=$'\f:' read -r a b`).includes('IFS=$\'\\\\x0c:\''));
  });

  for (const [version, bash] of READ_BASHES) {
    it(`bash ${version}: the values stored are what bash stores`, async function () {
      this.timeout(30000);
      const script = rows.map((r, k) => {
        const e = explained[k];
        const run = r.sample ? `${r.src} <<< ${ansiC(e.line)}` : r.src;
        return `${r.pre ? `${r.pre}\n` : ''}unset a b c arr REPLY; ${run}\n${r.inside ? '' : dump(r)}\nprintf '\\x1e'`;
      }).join('\n');
      const out = (await runContained([bash, '-c', script], process.cwd())).stdout.split('\x1e');
      const bad = rows.flatMap((r, k) => {
        const e = explained[k];
        if (e.examples === 0) return [];
        const mine = e.values.map((v) => `${v}\x1f`).join('');
        return mine === out[k] ? [] : [`${r.src}: ${JSON.stringify(mine)} <> ${JSON.stringify(out[k])}`];
      });
      assert.deepStrictEqual(bad, []);
      // (A here-string the example reads is the line it shows.)
    });
  }
});
