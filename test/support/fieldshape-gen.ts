// The generator of test/fieldshape.test.ts: words with literal starts and ends around parts of every kind, quoted and
// not, in states with the glob options, braces, POSIX mode and IFS each on, off or not known, with values for the
// parameters (backslashes and glob characters among them) and files for the patterns to match. Each case is a script
// the model reads (`text`) and a wrapper it does not see (`hidden`: the environment, the positional parameters, an
// array, a background job), so that what the wrapper sets is a hole to the model.
import { random } from './fuzz';

export interface FieldCase {
  /** The case as the model reads it: its setup lines, then `show WORD`. */
  text: string;
  /** The word. */
  word: string;
  /** Lines bash runs before `text`, in the case's subshell, that the model does not see. */
  hidden: string;
  /** The values the case assigns in `text` (a text, or null for `unset`): the tuple of the precise reading. */
  values: Map<string, (string | null)[]>;
  /** The files of the case's directory. */
  files: string[];
  /** The variables of the environment that decide the options the model does not know. */
  env: Record<string, string>;
  /** The word has an extglob group: bash parses it only with extglob on, so the case starts with `shopt -s extglob`. */
  extglob: boolean;
}

const VALUES = ['', '-v', '-vu', 'u', 'a b', ' a ', '-v u', '*', '-v*', '\\-v*', '-V*', '!(zz)', '@(-vu)', 'a:b', ':', 'a::b', ' ',
  '\\', 'a\\b', '[a]', '-', '--', '1', '-1', 'x y z', '\\n', '-v\nu', '+x', 'a=1', 'v[1]', '12', '\t-v', '*u', '-?u', ':-v:',
  // (Values that assign when arithmetic reads them, or an indirection's subscript: F87, F89.)
  'IFS=1', 'a[IFS=1]', 'y=2', 'a[y=1]', '1-1', 'IFS', 'y', '$((IFS=1))'];
const FILES = ['-vu', '-Vu', '-v', '\\-vu', 'a\\b', 'x1', '.h', '[a]', '*', 'ab', 'a b', '-', '--', 'u', 'a=1', '12', 'v1', 'd/x', 'd/e/x', 'a|b', 'a(b'];
const LITERALS = ['-', '-v', 'v', 'u', '--', '+', 'a', '=', 'a=', '1', '*', '?', '[a]', '[', ']', '\\*', '\\-', '%s', '.', '/', ':', '@',
  '\\\n', '\\ ', 'x', 'V', '+=', '_', '\\n', '~', '~/x',
  // (A tilde after `=` or `:` before a line continuation, and `$` before one: F90.)
  'a=~\\\n/x', ':~\\\n/x', 'x=a:~\\\n/x', '~\\\nx', '$\\\n@', '$\\\n#', '$\\\n((1+1))', "$\\\n'a'", '$\\\n"b"', '$\\\n{x}', '$\\\n$', '$\\\n?', '$\\\n*',
  '$\\\n-', '$\\\n1', '$\\\nx', '${x\\\n}', '$(\\\n(1))',
  // (globstar: `d/**/x` also matches `d/x`.)
  '**', '**/', 'd/**/x', 'd/**', '**/x', 'd/*/x'];
/** Extglob groups, with quotes and expansions in them or not (F91). */
const GROUPS = ['@(a|b)', '+(-v)', '!(zz)', '*(a)', '?(-)v*', '@(-v|-vu)', '@(a\\|b)', "@(a'|'b)", '@(a"|"b)', 'x@(${x})y', '+($x)', '@(${x}|u)', '!($y)', '@($(printf a))', '@(a|$((1)))', '*(\\-)v'];
/** Variables bash does not let a script assign (F86). */
const NOASSIGN = ['FUNCNAME', 'BASH_LINENO', 'BASH_SOURCE', 'BASH_ARGV', 'BASH_ARGC', 'GROUPS', 'DIRSTACK', 'BASH_ARGV0', 'PPID'];
const IN_QUOTES = ['-v', ' ', 'a b', '*', '\\\n', '\\$', '\\n', '%s', '-', 'u', '\\"', '\\\\', ':', '='];
const WORDS = ['-v', 'a b', '', '"$y"', '*', '-', 'u', '"-v"', '$z', "'a b'", "'-v'", '\\-v', "'*'", '\\*', "$'\\t'", '"a"b', '~', '$((1))'];
const NAMES = ['x', 'y', 'z'];
const SPECIAL = ['RANDOM', 'LINENO', 'SECONDS', '_', 'FUNCNAME'];
const quote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

export function fieldCases(count: number, seed: number): FieldCase[] {
  const rnd = random(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const chance = (p: number): boolean => rnd() < p;
  const cases: FieldCase[] = [];
  for (let i = 0; i < count; i++) {
    const env: Record<string, string> = {};
    const lines: string[] = [];
    const hidden: string[] = [];
    const values = new Map<string, (string | null)[]>();
    let flags = 0;
    // An option on, off, left as it starts, or set on some paths only (a variable of the environment decides).
    const option = (on: string, off: string): void => {
      const r = rnd();
      if (r < 0.2) lines.push(on);
      else if (r < 0.3) lines.push(off);
      else if (r < 0.45) {
        const flag = `G${i}_${flags++}`;
        env[flag] = chance(0.5) ? '1' : '0';
        lines.push(`if [ "$${flag}" = 1 ]; then ${on}; fi`);
      }
    };
    for (const o of ['nullglob', 'failglob', 'dotglob', 'nocaseglob', 'extglob', 'globstar']) option(`shopt -s ${o}`, `shopt -u ${o}`);
    option('set -f', 'set +f');
    option('set +B', 'set -B');
    option('set -o posix', 'set +o posix');
    if (chance(0.05)) lines.push('set -u');
    const ifs = pick(['', '', '', "IFS=' '", 'IFS=:', "IFS=' :'", 'IFS=', 'IFS=-v', 'IFS=1', 'unset IFS', 'IFS=u', "IFS='\\'", "IFS='*'", "IFS='?x'", "IFS=$'\\v'", "IFS='['"]);
    if (ifs) lines.push(ifs);
    if (chance(0.15)) {
      const flag = `G${i}_${flags++}`;
      env[flag] = chance(0.5) ? '1' : '0';
      lines.push(`if [ "$${flag}" = 1 ]; then IFS=:; fi`);
    }
    // The variables: assigned where the model sees it, by the hidden wrapper, or unset.
    for (const name of NAMES) {
      const r = rnd();
      const v = pick(VALUES);
      if (r < 0.45) {
        lines.push(`${name}=${quote(v)}`);
        values.set(name, [v]);
      } else if (r < 0.55) {
        lines.push(`unset ${name}`);
        values.set(name, [null]);
      } else if (r < 0.85) hidden.push(`${name}=${quote(v)}`);
      else hidden.push(`unset ${name}`);
    }
    // A read-only variable, a nameref and a variable bash sets itself, each with a value given to the domain that it must not take.
    if (chance(0.1)) lines.push(`readonly ${pick(NAMES)}`);
    if (chance(0.05)) lines.push(`declare -i ${pick(NAMES)}`);
    if (chance(0.15)) {
      const target = pick(['x', 'a[@]', 'a']);
      lines.push(`declare -n r=${quote(target)}`);
      values.set('r', [target]);
    }
    if (chance(0.1)) {
      const special = pick(SPECIAL);
      // (Its value given is `-v`; it is set to a number, which `RANDOM` and `SECONDS` read as arithmetic.)
      lines.push(`${special}=7`);
      values.set(special, ['-v']);
    }
    hidden.push(`set -- ${Array.from({ length: Math.floor(rnd() * 4) }, () => quote(pick(VALUES))).join(' ')}`);
    hidden.push(`a=(${Array.from({ length: Math.floor(rnd() * 3) }, () => quote(pick(VALUES))).join(' ')})`);
    if (chance(0.5)) hidden.push(': &', 'wait');
    hidden.push(chance(0.5) ? 'true' : 'false');
    const word = wordOf(pick, chance);
    // (An extglob group parses only with extglob on: on at the start, the options above may turn it off as the case runs.)
    const extglob = GROUPS.some((g) => word.includes(g));
    if (extglob) lines.unshift('shopt -s extglob');
    cases.push({ text: `${lines.join('\n')}${lines.length ? '\n' : ''}show ${word}\n`, word, hidden: hidden.join('\n'), values, files: FILES.filter(() => chance(0.3)), env, extglob });
  }
  return cases;
}

/** A word of one to four parts. */
function wordOf(pick: <T>(xs: readonly T[]) => T, chance: (p: number) => boolean): string {
  const name = (): string => pick(NAMES);
  const expansion = (quoted: boolean): string => {
    const x = name();
    return pick([
      `$${x}`, `\${${x}}`, `\${${x}:-${pick(WORDS)}}`, `\${${x}-${pick(WORDS)}}`, `\${${x}:+${pick(WORDS)}}`, `\${${x}+${pick(WORDS)}}`,
      `\${${x}#-}`, `\${${x}%u}`, `\${#${x}}`, '$#', '$?', '$$', '$!', '$((-1))', `$((\${#${x}}-2))`, `$(printf %s "$${x}")`,
      '"$@"', '$@', '$*', '"$*"', '"${a[@]}"', '${a[@]}', '${a[*]}', '$1', '${2}', `\${${x}:?}`, '$-',
      `\${${x}:=${pick(WORDS)}}`, `\${${x}=${pick(WORDS)}}`, '${1:=a}', `\${${x}@Q}`, `\${${x}@Z}`, '$r', '${r}', `$${pick(SPECIAL)}`,
      pick(['${#:+-v}', '${#/#/-}', '${##1}', '${#%1}', '${#@Q}', '${#-x}', '${?:+x}', '${#^^}', '${##}', '${#}', '${!}', '${#1}']),
      // (What the word assigns itself, by `=` or arithmetic, IFS among them (F87, F88); names and indirections (F85, F89); `:=` on what bash keeps (F86).)
      pick([`\${${x}:${pick(['1', 'y=1', 'IFS=1', 'x', '0:y=2'])}}`, `\${a[${pick(['0', 'y=1', 'IFS=1', 'x', '$x'])}]}`, `\${${x}[y=1]}`, `$((${pick(['x', 'y=1', 'IFS=1', 'IFS=-1', '${x}', 'IFS+=1'])}))`,
        `$[${pick(['x', 'IFS=1'])}]`, `\${IFS${pick(['=', ':=', '-', ':+', '+'])}${pick([':', '1', '', '"$y"', ' '])}}`, `\${!${x}}`, `\${!${x}@}`, `\${!${x}*}`, '${!z@}', '${!B*}', `\${${x}@}`,
        `\${!${x}@Q}`, `\${${x}@P}`, `\${${x}[@]:=a}`, `\${!${x}=a}`, `\${${pick(NOASSIGN)}${pick([':=', '='])}a}`, `\${${x}@QE}`, '${!a[@]}', '${#a[y=1]}']),
      // (Operators the evaluator computes over known values.)
      pick([`\${${x}/a/-v}`, `\${${x}//[ab]/ }`, `\${${x}^^}`, `\${${x},}`, `\${${x}:1:1}`, `\${${x}: -1}`, `\${${x}/#-/+}`, `\${${x}/%u/ x}`, `\${${x}//\\*/a}`, `\${${x}/a/"$y"}`,
        `\${${x}~~}`, `\${${x}##*-}`, `\${${x}%%[a-z]*}`, '"${a[*]}"', '${*:-x}', '${@:2}', '"${@:1:2}"', '${#@}', '${#*}', `\${${x}@U}`, `\${${x}@a}`, '~+', '~-', '~+/*', `~${x}`]),
      ...(quoted ? [] : [`$"${pick(IN_QUOTES)}"`, `$'${pick(['-v', 'a b', '\\t', '*'])}'`, '<(:)']),
    ]);
  };
  const part = (): string => {
    switch (pick([0, 1, 2, 3, 4, 5, 5, 5])) {
      case 0: return pick(LITERALS);
      case 1: return quote(pick(IN_QUOTES).replace(/\\/g, ''));
      case 2: return `"${Array.from({ length: 1 + (chance(0.5) ? 1 : 0) + (chance(0.3) ? 1 : 0) }, () => (chance(0.5) ? pick(IN_QUOTES) : expansion(true))).join('')}"`;
      case 3: return pick(['{a,-v}', '{,x}', '{1..2}', '{"a b",c}', '{-v,"*"}', '{Z..a}', '{a..c}', '{Z..a..+2}', '{a..e..+2}', '{1..5..+2}', '{Z..a..-3}', '{+1..3}', '{a..c..+0}',
        '{1..$x}', '{$x,a}', '{a,b{c,d}}', '{a,}', '{,}', '{a}', '{a..c..}', '{1..3..0}', '{-1..1}', '{01..3}', '{a..C}', '\\{a,b}', '{a,b\\}', "{'a,b',c}", '{a..c}{1..2}',
        "{$'a b',c}", '{1..a}', '{3..1}', '{-3..-1..2}', '{a,"$x"}']);
      case 4: return chance(0.5) ? pick(GROUPS) : pick(['-v', '-', 'a', '*']);
      default: return expansion(false);
    }
  };
  // (The words the word model reads otherwise than bash are made too: the domain must say it does not know them.)
  for (;;) {
    const w = Array.from({ length: 1 + (chance(0.5) ? 1 : 0) + (chance(0.5) ? 1 : 0) + (chance(0.3) ? 1 : 0) }, part).join('');
    // (Not a word of line continuations only: no word.)
    if (w.replace(/\\\n/g, '')) return w;
  }
}
