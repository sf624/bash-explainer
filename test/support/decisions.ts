// Generated scripts for the differential test of the state model's decisions (test/decisions.test.ts): what a
// condition always decides, the values it read, and the code that never runs, against bash.
//
// A script is generated with placeholders ⟦…⟧, removed for the model and replaced by probes for bash: after each
// condition, a function that logs its status and the values the model read (and returns that status, so nothing
// else changes; a condition is not stopped by `set -e`); before each `case` and in each of its items, functions that
// log which items run; around each function definition, a marker. Markers `: Mk` are seen through xtrace.
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { shellState } from '../../src/semantics/state';
import { createUnbashParser } from '../../src/syntax/adapters/unbash';
import { descendants, type SyntaxNode } from '../../src/syntax/tree';

/** A seeded generator (mulberry32). */
export function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Probed = 'if_statement' | 'elif_clause' | 'while_statement' | 'list' | 'case_statement';
interface Construct { id: number; type: Probed; until?: boolean }

/** A generated script: its text with placeholders, the constructs probed, and the file it sources, if any. */
export interface Script { text: string; constructs: Construct[]; lib?: string }

/**
 * The constructs the generator writes, each as a pattern that matches it in a script's text (`forModel(text).src`).
 * The rows of the allow-list name them (`generator: <name>`, src/semantics/allow.ts); test/allow-list.test.ts checks
 * that each pattern matches some generated script.
 */
export const GENERATED: Readonly<Record<string, RegExp>> = {
  // Conditions and tests.
  '[[': /\[\[ /,
  '[[ -z': /\[\[ -z /,
  '[[ $v op': /\[\[ \$\w+ (?:==|=~|-lt) /,
  '[ test': /(?:^|[^[\w])\[ [-"$]/m,
  test: /\btest "/,
  '=~': /=~ /,
  '(( ))': /(?<!\$|for )\(\( /,
  '(( v++ ))': /\(\( \w+\+\+ \)\)/,
  // Lists, groups and compound commands.
  list: /(?:\]\]?|\)\)|\b(?:true|false|h|k|f|g|rc|run|debug)|:|null) (?:&&|\|\|) /,
  'brace group': /(?:^|[;|&{] )\{ /m,
  subshell: /(?<![$\w(=])\( /,
  'function definition': /\b\w+\(\) \{ /,
  if: /\bif /,
  elif: /\belif /,
  else: /\belse /,
  case: /\bcase \S.* in /,
  while: /\bwhile /,
  until: /\buntil /,
  'for (( ))': /\bfor \(\( /,
  do: /; do /,
  // Jumps.
  break: /\bbreak\b/,
  continue: /\bcontinue\b/,
  return: /\breturn\b/,
  exit: /\bexit\b/,
  // Assignments and builtins that write.
  local: /\blocal \w/,
  export: /\bexport \w/,
  unset: /\bunset /,
  let: /\blet \w/,
  // Options.
  'set -e': /\bset -e(?=[;\s)]|$)/,
  'set -u': /\bset -u(?=[;\s)]|$)/,
  'set -o pipefail': /\bset -o pipefail\b/,
  'set option': /\bset [-+](?:[aefu]\b|o )/,
  'shopt -s': /\bshopt -s /,
  nocasematch: /\bshopt -[su] nocasematch\b/,
  // Expansions and redirections.
  'command substitution': /\$\( /,
  'substring expansion': /\$\{s:/,
  '<<<': /<<< /,
};

/** The scripts' constructs: those of the reviews of the decisions (docs/design/semantics.md, 4.14). */
class Generator {
  private n = 0;
  constructs: Construct[] = [];
  private fns: string[] = [];
  private depth = 0;
  /** Variables only plain assignments write; counters that arithmetic reads; `r`, which builtins set to text. */
  private readonly plain = ['mode', 'flag', 'v'];
  private readonly counters = ['n', 'i', 'w'];
  constructor(private readonly r: () => number) {}

  private pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.r() * xs.length)];
  }
  private chance(p: number): boolean {
    return this.r() < p;
  }
  private mark(): string {
    return `: M${++this.n}`;
  }
  private probe(type: Probed, until?: boolean): number {
    const id = ++this.n;
    this.constructs.push({ id, type, ...(until ? { until } : {}) });
    return id;
  }
  private value(): string {
    return this.pick(['0', '1', '2', 'a', 'b', '""', "'a b'", 'yes', 'no', 'A', '"*"', '01', 'fast']);
  }
  private word(v: string): string {
    return this.pick([`"$${v}"`, `$${v}`, `"\${${v}}"`, `"\${${v}:-z}"`]);
  }

  /** A test command. */
  private test(): string {
    const v = this.pick([...this.plain, ...this.plain, 'r']);
    const w = this.pick([...this.plain, 'r']);
    // (Arithmetic reads mostly the counters.)
    const a = this.chance(0.97) ? this.pick(this.counters) : v;
    const b = this.chance(0.97) ? this.pick(this.counters) : w;
    switch (Math.floor(this.r() * 24)) {
      case 0: return `[ ${this.word(v)} = ${this.value()} ]`;
      case 1: return `[ -n ${this.word(v)} ]`;
      case 2: return `[ -z "$${v}" ]`;
      case 3: return `[[ $${v} == ${this.pick(['a*', '?', '[0-9]', `"$${w}"`, `$${w}`, '@(a|b)', 'A', 'f*'])} ]]`;
      case 4: return `[[ $${v} =~ ${this.pick(['^a', 'b$', '^[0-9]+$', 'as', '^fast$'])} ]]`;
      case 5: return `[ "$${v}" -eq ${this.pick(['0', '1', `"$${w}"`])} ] 2>/dev/null`;
      case 6: return `[[ $${a} -lt ${this.pick(['1', '2', b])} ]]`;
      case 7: return `(( ${a} ${this.pick(['>', '==', '<'])} ${this.pick(['0', '1', b])} ))`;
      case 8: return this.pick(['true', 'false', ':']);
      case 9: return `[ $? ${this.pick(['=', '!='])} ${this.pick(['0', '1'])} ]`;
      case 10: return `! [ "$${v}" = ${this.value()} ]`;
      case 11: return `test "$${v}" != "$${w}"`;
      case 12: return `[[ -z $${v} || $${w} == 1 ]]`;
      case 13: return `[[ -n $${v} && $${w} != x ]]`;
      case 14: return this.fns.length ? this.pick(this.fns) : 'true';
      case 15: return `[ "$${v}" ]`;
      case 16: return `$${this.pick(['run', 'debug'])}`;
      case 17: return `[ ${this.word(v)} \\< b ]`;
      case 18: return `[[ "$${v}" == "${this.pick(['a', 'A', 'fast', ''])}" ]]`;
      case 19: return '[ -f ./lib.sh ]';
      case 20: return `[ "$${v}" = ${this.value()} -o -z "$${w}" ]`;
      case 21: return `(( ${this.pick(['0', '1', '2 > 1', '1 / 0'])} ))`;
      case 22: return `[ "\${#${v}}" -gt 1 ]`;
      default: return `[ "$${v}" != ${this.value()} ]`;
    }
  }

  /** A condition: a test, or two joined (a list, probed itself). */
  private cond(): string {
    return this.chance(0.2) ? this.list(this.test(), this.pick(['&&', '||']), this.test()) : this.test();
  }

  private list(left: string, op: string, right: string): string {
    const id = this.probe('list');
    return `⟦s:${id}⟧⟦l:${id}⟧${left}⟦r:${id}⟧ ${op} ${right}`;
  }

  private assign(): string {
    const v = this.pick(this.plain);
    switch (Math.floor(this.r() * 14)) {
      case 0: return `${v}+=${this.value()}`;
      case 1: return `export ${v}=${this.value()}`;
      case 2: return `${v}=$${this.pick(this.plain)}`;
      case 3: return `local ${v}=${this.value()}`;
      default: return `${v}=${this.value()}`;
    }
  }

  /** What writes a variable otherwise than a plain assignment. */
  private otherWrite(): string {
    const v = this.chance(0.98) ? this.pick(this.counters) : this.pick(this.plain);
    // (What writes text not known: mostly `r`, which arithmetic does not read.)
    const t = this.chance(0.9) ? 'r' : v;
    switch (Math.floor(this.r() * 22)) {
      // (A compound assignment's subscripts are arithmetic, which may fail.)
      case 20: return `arr=([${this.pick([v, '1', `1 / ${v}`, '1/0'])}]=x)`;
      case 21: return `arr=( [${v}]=x [${this.pick(['0', v])}+1]=y )`;
      case 0: return `(( ${v}++ ))`;
      case 1: return `let ${v}+=1`;
      case 2: return `arr[${v}++]=x`;
      case 3: return `printf -v ${t} %s ${this.value()}`;
      case 4: return `read -r ${t} <<< ${this.value()}`;
      case 5: return `read ${t}`;
      case 6: return this.chance(0.5) ? `declare -i ${v}=${this.pick(['1+1', '3', 'z'])}` : `declare -${this.pick(['l', 'u'])} ${t}=${this.pick(['Ab', 'x'])}`;
      case 7: return `: \${${v}:=${this.value()}}`;
      case 8: return `unset ${v}`;
      case 9: return `${v}=$(( ${v} + 1 ))`;
      case 10: return `echo "\${arr[${v}]}" > /dev/null`;
      case 11: return `s=abcdef; echo "\${s:${v}:1}" > /dev/null 2>&1`;
      case 12: return `echo 1 | read ${t}`;
      case 13: return `${t}=$(echo ${this.value()})`;
      case 14: return `for ${t} in 1 2; do :; done`;
      case 15: return `unset '${v}[0]'`;
      case 16: return `declare -n ref=${v}; ref=2`;
      case 17: return `echo $(( 1 / ${this.pick(['0', 'z', v])} ))`;
      case 18: return 'z=0';
      default: return `${v}=${this.pick(['0', '1', '2', '-1'])}`;
    }
  }

  private block(inLoop: number, inFn: boolean): string {
    this.depth++;
    const out = [this.mark()];
    const k = 1 + Math.floor(this.r() * (this.depth > 2 ? 2 : 3));
    for (let i = 0; i < k; i++) {
      out.push(this.stmt(inLoop, inFn));
      if (this.chance(0.3)) out.push(this.mark());
    }
    this.depth--;
    return out.join('; ');
  }

  private stmt(inLoop: number, inFn: boolean): string {
    const body = (): string => this.block(inLoop, inFn);
    const loopBody = (): string => this.block(inLoop + 1, inFn);
    switch (Math.floor(this.r() * (this.depth > 3 ? 8 : 39))) {
      case 0: case 1: case 2: return this.assign();
      case 3: case 4: return this.otherWrite();
      case 5: return this.cond();
      case 6: return inLoop ? this.pick(['break', 'continue', inLoop > 1 ? 'break 2' : 'break', `${this.test()} && break`, `${this.test()} && continue`]) : this.mark();
      case 7: return inFn ? this.pick(['return', 'return 1', `${this.test()} && return`]) : this.chance(0.1) ? this.pick(['exit', `${this.test()} && exit`]) : this.mark();
      case 8: case 9: case 10: {
        const id = this.probe('if_statement');
        let s = `⟦s:${id}⟧if ⟦p:${id}⟧${this.cond()}⟦c:${id}⟧; then ${body()}; `;
        while (this.chance(0.3)) {
          const e = this.probe('elif_clause');
          s += `⟦s:${e}⟧elif ⟦p:${e}⟧${this.cond()}⟦c:${e}⟧; then ${body()}; `;
        }
        if (this.chance(0.5)) s += `else ${body()}; `;
        return `${s}fi`;
      }
      case 11: case 12: return this.list(this.test(), this.pick(['&&', '||']), this.chance(0.5) ? `{ ${body()}; }` : this.pick([this.assign(), this.mark(), 'false', 'true']));
      case 13: case 14: {
        const v = this.pick(this.plain);
        const id = this.probe('case_statement');
        // (Up to 5 items, mixing the terminators.)
        const k = 1 + Math.floor(this.r() * 5);
        const items: string[] = [];
        for (let i = 0; i < k; i++) {
          const end = i === k - 1 ? ';;' : this.pick([';;', ';;', ';&', ';;&']);
          items.push(`${this.pick(['a', 'a*', '"$mode"', '$flag', '[0-9]', '*', 'fast|slow', '@(a|b)', '?', 'A', '""', 'yes|no'])}) ⟦k:${id}:${i}⟧${body()} ${end}`);
        }
        // (A word not known, too: then every list may run, after those before it that end with `;&` or `;;&`.)
        const word = this.chance(0.4) ? this.pick(['"$r"', '"$1"', '$(echo abc)']) : this.word(v);
        return `⟦s:${id}⟧⟦d:${id}⟧case ${word} in ${items.join(' ')} esac⟦e:${id}⟧`;
      }
      case 15: case 16: {
        const until = this.chance(0.3);
        const id = this.probe('while_statement', until);
        // (Mostly with a guard: at most 3 passes. A run is stopped after a few seconds anyway.)
        const g = `g${id}`;
        const guard = this.chance(0.85) ? `${g}=$((${g}+1)); [ $${g} -gt 3 ] && break; ` : '';
        return `${g}=0; ⟦s:${id}⟧${until ? 'until' : 'while'} ⟦p:${id}⟧${this.cond()}⟦c:${id}⟧; do ${guard}${loopBody()}; done`;
      }
      case 17: return `for x in ${this.pick(['1', '1 2', 'a b c', '"$mode"', '$flag'])}; do ${loopBody()}; done`;
      case 18: return `for (( c = 0; c < ${this.pick(['0', '1', '2'])}; c++ )); do ${loopBody()}; done`;
      case 19: return `( ${body()}${this.chance(0.3) ? '; exit' : ''} )`;
      case 20: return `x=$( ${body()}; echo 1 )`;
      case 21: return this.fns.length ? this.pick([...this.fns, `${this.pick(this.fns)} || :`, `if ${this.pick(this.fns)}; then ${this.mark()}; fi`]) : this.mark();
      case 22: return `{ ${body()}; } | cat`;
      case 23: return `echo 1 | { ${body()}; }`;
      case 24: return this.pick(['set -e', 'set +e', 'set -u', 'shopt -s nocasematch', 'shopt -u nocasematch', 'set -o pipefail']);
      case 25: return `[ "$${this.pick(this.plain)}" = ${this.value()} ] && ${this.pick(['exit', inFn ? 'return' : ':', inLoop ? 'break' : ':'])}`;
      case 26: return `eval '${this.assign()}'`;
      case 27: {
        // A function defined in a branch (it may call itself: FUNCNEST stops it).
        const name = this.pick(['h', 'k']);
        if (!this.fns.includes(name)) this.fns.push(name);
        return `⟦D⟧${name}() { ${this.block(0, true)}; }⟦E⟧`;
      }
      case 28: return `{ { ${body()}; } & }`;
      // Strings the walk runs (docs/design/semantics.md, 4.13): jumps, errors and conditions in them.
      case 29: return `eval '${this.pick([inLoop ? 'break' : ':', inLoop ? 'continue' : ':', inFn ? 'return 1' : ':', 'exit', 'echo $(( 1 / 0 )); mode=e', 'n=$(( 1 / n ))',
        'flag=e; [ "$mode" = a ] && flag=f', 'if [ "$v" = 1 ]; then mode=g; else exit; fi', 'q=1/0', 'q=2'])}'; ${this.mark()}`;
      // (Actions that may fail, return or break, and a signal that runs them.)
      case 30: return `trap '${this.pick(['mode=t', 'flag=$mode', ':', 'arr=([1/0]=1)', 'echo $(( 1 / 0 ))', 'q=1+', 'return', 'break', 'flag=t; [ "$mode" = a ] && exit'])}' ${this.pick(['EXIT', 'USR1', 'USR1', 'INT'])}`;
      // (Then an assignment on the same line, which an error there discards.)
      case 31: return `kill -USR1 $$; ${this.assign()}`;
      case 32: return `eval '${this.pick(['arr=([1/0]=1)', 'arr=( [n]=1 )', 'arr=([1 / n]=1); mode=c'])}'; ${this.assign()}`;
      case 33: {
        // A function that calls itself once, guarded by `d`: what its body changes after the call, the call changes too.
        if (!this.fns.includes('rc')) this.fns.push('rc');
        return `⟦D⟧rc() { if [ "$d" = 1 ]; then d=2; rc; ${this.pick(['return', ':', `${this.test()} && return`])}; fi; ${this.block(0, true)}; }⟦E⟧; d=1; rc`;
      }
      // Redirections that may fail (a file not there, a directory, a descriptor the script closed), with `set -e` or not.
      case 34: if (!this.chance(0.5)) return this.mark();
        return `{ ${body()}; } ${this.pick(['> out.txt', '> ./no/dir', '< ./nofile', '2>&1', '>&2', '<&0', '>&- 2>&1', '2>&1 >&-'])}`;
      // (The standard descriptors, closed and copied: `exec 1>&-` makes a later `2>&1` fail. Reopened from /dev/null.)
      // (Then a copy of one, and a condition that reads what the group assigns.)
      case 35: if (!this.chance(0.3)) return this.mark();
        return `${this.pick(['exec 4>&1 1>&-', 'exec 1>&-', 'exec 2>&-', 'exec 0<&-', 'exec 1>&2-', 'exec 1>/dev/null 2>/dev/null 0</dev/null',
          `${this.fns.length ? this.pick(this.fns) : this.mark()} >&-`, `${this.assign()} 2>&1`])}; { v=fd; } ${this.pick(['2>&1', '>&2', '1<&0'])}; ${this.list('[ "$v" = fd ]', '&&', this.mark())}`;
      // Copies of IFS through `for`, an array or `$(( ))`, and a word of `[` that IFS may split into `-v` and a subscript
      // that assigns.
      case 36: {
        if (!this.chance(0.25)) return this.mark();
        const v = this.pick(this.plain);
        return `${this.pick(['s=( 0 ); IFS=$s', 'for s in 0 :; do :; done; IFS=$s', 's=$((0)); IFS=$s', 'IFS=$((0))', 'for IFS in 0; do :; done', 's=$IFS; IFS=:; IFS=$s',
          'unset IFS; s=$IFS; IFS=v; IFS=$s', 'IFS=v; IFS=:'])}; t=${this.pick(["'-v0'", "'-v:'", "'-va'", 'a'])}; [ $t 'a[${v}=e]' ] 2>/dev/null; ${this.list(`[ "$${v}" = e ]`, '&&', this.mark())}`;
      }
      // Values arithmetic runs, from the environment (`q='w=7'`, `HOME='w=8'`: `runBash`): through an element of an array, or a tilde.
      // (Then a condition that reads `w`.)
      case 37: if (!this.chance(0.3)) return this.mark();
        return `w=0; ${this.pick(['a=(0); a[0]=$q; q=0; (( a[0] ))', 'a=("$q"); q=0; (( a[0] ))', 'a=(); a+=("$q"); q=0; (( a ))', 'declare -a a=([0]="$q"); q=0; (( a[0] ))',
          'm=~; (( m ))', 'm=~; : "${arr[m]}"', 'm=(~); (( m ))', 'HOME=0; m=~; (( m ))', 'a=(1); a[0]=2; (( a[0] ))'])}; ${this.list('[ "$w" = 0 ]', '&&', this.mark())}`;
      default: return this.mark();
    }
  }

  script(): Script {
    this.constructs = [];
    this.fns = [];
    const lines: string[] = [];
    if (this.chance(0.15)) lines.push('shopt -s extglob');
    if (this.chance(0.1)) lines.push('shopt -s lastpipe');
    for (const v of this.plain) if (this.chance(0.85)) lines.push(`${v}=${this.value()}`);
    for (const v of this.counters) if (this.chance(0.95)) lines.push(`${v}=${this.pick(['0', '1', '2'])}`);
    if (this.chance(0.7)) lines.push(`r=${this.value()}; z=${this.pick(['0', '1'])}`);
    lines.push(`run=${this.pick(['true', 'false', ':', 'echo'])}; debug=${this.pick(['true', 'false'])}`);
    if (this.chance(0.4)) lines.push('declare -A m=([a]=1); m[$mode]=2');
    // (An integer that eval strings give text: an error there may end the line of eval too.)
    if (this.chance(0.5)) lines.push('declare -i q=0');
    // (So that `kill -USR1 $$` does not end the script, unless a trap the script sets resets it.)
    if (this.chance(0.7)) lines.push("trap ':' USR1");
    for (const name of ['f', 'g']) {
      if (!this.chance(0.7)) continue;
      lines.push(`⟦D⟧${name}() { ${this.block(0, true)}; }⟦E⟧`);
      this.fns.push(name);
    }
    let lib: string | undefined;
    const rare = this.r();
    if (rare < 0.03) {
      lib = this.pick(['mode=zz', 'set -f', 'f() { mode=q; }', 'flag=1']);
      lines.push('. ./lib.sh');
    } else if (rare < 0.05) lines.push(this.pick(['cmd=f; $cmd', '$cmd', 'export -f f 2>/dev/null', 'trap "mode=3" USR1', 'complete -F f c 2>/dev/null', 'set -a']));
    // (Callbacks that run code in this shell: the model trusts nothing then.)
    else if (rare < 0.07) lines.push(this.pick(["mapfile -C 'mode=c; :' -c 1 arr <<< q", "readarray -C 'flag=c; :' -c 1 arr <<< q", "jobs -x eval 'v=c'"]));
    const k = 3 + Math.floor(this.r() * 5);
    for (let i = 0; i < k; i++) lines.push(this.stmt(0, false));
    lines.push(this.mark());
    return { text: lines.join('\n'), constructs: this.constructs, ...(lib !== undefined ? { lib } : {}) };
  }
}

/** `count` distinct scripts from `seed`. */
export function scripts(seed: number, count: number): Script[] {
  const r = random(seed);
  const seen = new Set<string>();
  const out: Script[] = [];
  for (let tries = 0; out.length < count && tries < count * 20; tries++) {
    const s = new Generator(r).script();
    if (seen.has(s.text)) continue;
    seen.add(s.text);
    out.push(s);
  }
  return out;
}

/**
 * Statements whose row in the allow-list is `all` (src/semantics/allow.ts; docs/design/trust-allow-list.md, section
 * 5): a construct the walk does not follow, or one the table does not have.
 */
export const UNKNOWN_CONSTRUCTS: readonly string[] = [
  'shopt -s compat42', 'BASH_COMPAT=42', 'set -k', 'FUNCNEST=1', 'BASH_ALIASES[1]="mode=9"', 'set -o history -H', 'shopt -s localvar_inherit',
  'read -Q v 2>/dev/null', 'set -o posix', 'shopt -u extquote', 'LC_ALL=de_DE.UTF-8', 'shopt -s nosuch 2>/dev/null', ': "${v@Z}" 2>/dev/null',
];

/**
 * `scripts(seed, count)`, with an unknown construct (`UNKNOWN_CONSTRUCTS`) put at the start or before the last line of
 * a fifth of them, chosen by a generator of their own (the scripts are those of `scripts`); `unknown` says which.
 */
export function withUnknown(seed: number, count: number): (Script & { unknown?: string })[] {
  const r = random(seed ^ 0x5eed);
  return scripts(seed, count).map((s) => {
    if (r() >= 0.2) return s;
    const unknown = UNKNOWN_CONSTRUCTS[Math.floor(r() * UNKNOWN_CONSTRUCTS.length)];
    const lines = s.text.split('\n');
    const at = r() < 0.5 ? 0 : lines.length - 1;
    return { ...s, text: [...lines.slice(0, at), unknown, ...lines.slice(at)].join('\n'), unknown };
  });
}

/** The text for the model (placeholders removed), where each construct starts, and where each definition does. */
export function forModel(text: string): { src: string; starts: Map<number, number>; defs: number[] } {
  const starts = new Map<number, number>();
  const defs: number[] = [];
  let src = '';
  for (const part of text.split(/(⟦[^⟧]*⟧)/)) {
    const m = /^⟦(\w)(?::(\d+))?(?::\d+)?⟧$/.exec(part);
    if (!m) src += part;
    else if (m[1] === 's') starts.set(Number(m[2]), src.length);
    else if (m[1] === 'D') defs.push(src.length);
  }
  return { src, starts, defs };
}

/** The text for bash, with probes; `reads`: the variables each decided construct read. */
export function forBash(text: string, reads: Map<number, string[]>): string {
  let d = 0;
  const values = (id: number): string => (reads.get(id) ?? []).map((v) => ` "\${${v}+S}\${${v}-}"`).join('');
  return text.replace(/⟦(\w)(?::(\d+))?(?::(\d+))?⟧/g, (_, k: string, a?: string, b?: string) => {
    const id = Number(a);
    switch (k) {
      case 'p': return `__p ${id}${values(id)}; `;
      case 'c': return `; __c ${id}${values(id)}`;
      case 'l': return `{ __p ${id}${values(id)}; `;
      case 'r': return `; __c ${id}${values(id)}; }`;
      case 'd': return `{ __d ${id}${values(id)}; `;
      case 'e': return '; }';
      case 'k': return `__k ${id} ${b}; `;
      case 'D': return `{ : D${++d}; `;
      case 'E': return '; }';
    }
    return '';
  });
}

export const PRELUDE = `__p() { local s=$?; local IFS=$'\\t'; printf 'P\\t%s\\t%s\\n' "$*" "$s" >&9; return $s; }
__c() { local s=$?; local IFS=$'\\t'; printf 'C\\t%s\\t%s\\n' "$*" "$s" >&9; return $s; }
__d() { local IFS=$'\\t'; printf 'D\\t%s\\t%s\\n' "$BASHPID" "$*" >&9; }
__k() { printf 'K\\t%s\\t%s\\t%s\\n' "$BASHPID" "$1" "$2" >&9; }
`;

/** Runs `file` with bash in `dir` (xtrace and probes to `trace`), stopped after 4 s; false when it was. */
export function runBash(dir: string, file: string): Promise<boolean> {
  return new Promise((resolve) => {
    // (A loop with no guard may write fast: the trace is limited to 10 MB.)
    const c = spawn('bash', ['-c', 'ulimit -f 20000; cd "$1" && exec 9>trace && BASH_XTRACEFD=9 PS4="+X " FUNCNEST=20 exec bash -x "$2" </dev/null >/dev/null 2>&1', 'x', dir, file],
      { detached: true, stdio: 'ignore', env: { PATH: process.env.PATH, HOME: 'w=8', q: 'w=7', LC_ALL: 'C' } });
    const stop = (): void => {
      try {
        process.kill(-c.pid!, 'SIGKILL');
      } catch {
        // (Gone.)
      }
    };
    const t = setTimeout(() => {
      stop();
      resolve(false);
    }, 4000);
    c.on('exit', () => {
      clearTimeout(t);
      stop();
      resolve(true);
    });
  });
}

export interface Checked {
  /** What bash contradicts. */
  problems: string[];
  /** Why nothing is trusted, when so. */
  blind: string | undefined;
  decided: number;
  dead: number;
  stopped: boolean;
}

const parser = createUnbashParser();

/** The decisions and dead marks of the model on `s`, checked against a run of bash in `dir`. */
export async function check(s: Script, dir: string): Promise<Checked> {
  const { src, starts, defs } = forModel(s.text);
  const tree = parser.parse(src);
  const model = shellState(tree, 'bash');
  const nodes = descendants(tree.root, ['if_statement', 'elif_clause', 'while_statement', 'list', 'case_statement']);
  const decisions = new Map<number, { c: Construct; outcome: string; reads: ReadonlyMap<string, string | null> }>();
  for (const c of s.constructs) {
    const n = nodes.find((x) => x.type === c.type && x.startIndex === starts.get(c.id));
    const d = n && model.condition(n);
    if (d) decisions.set(c.id, { c, outcome: d.outcome, reads: d.reads });
  }
  const reads = new Map([...decisions].map(([id, d]) => [id, [...d.reads.keys()].filter((k) => k !== '?')]));
  const dead: string[] = [];
  for (const c of descendants(tree.root, ['command'])) {
    const m = /^: (M\d+)$/.exec(c.text);
    if (m && model.dead(c)) dead.push(m[1]);
  }
  descendants(tree.root, ['function_definition']).forEach((f: SyntaxNode) => {
    const k = defs.indexOf(f.startIndex);
    if (k >= 0 && model.dead(f)) dead.push(`D${k + 1}`);
  });
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  if (s.lib !== undefined) fs.writeFileSync(path.join(dir, 'lib.sh'), `${s.lib}\n`);
  fs.writeFileSync(path.join(dir, 's.sh'), `${PRELUDE}${forBash(s.text, reads)}\nwait\n`);
  const done = await runBash(dir, 's.sh');
  const trace = fs.readFileSync(path.join(dir, 'trace'), 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  const problems: string[] = [];
  const ran = new Set([...trace.matchAll(/^\+*X : ([MD]\d+)$/gm)].map((m) => m[1]));
  for (const m of dead) if (ran.has(m)) problems.push(`${m} is dead in the model, but ran`);
  const lines = trace.split('\n').filter((l) => /^[PCDK]\t/.test(l)).map((l) => l.split('\t'));
  const fmt = (x: string | undefined): string | null => (x?.startsWith('S') ? x.slice(1) : null);
  for (const [id, d] of decisions) {
    const names = reads.get(id)!;
    if (d.c.type === 'case_statement') {
      // The values of the word, when the case starts; in each process, the items that run after it are the
      // first of those decided (a jump may end the list), and no others.
      const want = d.outcome ? d.outcome.split(',') : [];
      const runs = new Map<string, string[][]>();
      for (const l of lines) {
        if (l[0] === 'D' && l[2] === String(id)) {
          names.forEach((name, i) => {
            if (fmt(l[3 + i]) !== d.reads.get(name)) problems.push(`case ${id} read $${name} as ${JSON.stringify(d.reads.get(name))}, but bash had ${JSON.stringify(fmt(l[3 + i]))}`);
          });
          runs.set(l[1], [...(runs.get(l[1]) ?? []), []]);
        } else if (l[0] === 'K' && l[2] === String(id)) {
          const list = runs.get(l[1]);
          if (!list) problems.push(`case ${id}: an item ran before the case`);
          else list[list.length - 1].push(l[3]);
        }
      }
      // (A run stopped by the time limit may have been stopped in the last one.)
      for (const got of [...runs.values()].flatMap((r) => (done ? r : r.slice(0, -1)))) {
        if (got.length > want.length || got.some((x, i) => x !== want[i]) || (want.length > 0 && got.length === 0)) problems.push(`case ${id} decided [${want}], but ran [${got}]`);
      }
      continue;
    }
    // Each status logged after the condition agrees with the decision, and the values read are those it had
    // before or after the condition.
    const after = lines.filter((l) => l[0] === 'C' && l[1] === String(id));
    const before = lines.filter((l) => l[0] === 'P' && l[1] === String(id));
    for (const l of after) {
      const status = Number(l[l.length - 1]);
      const holds = d.c.until ? status !== 0 : status === 0;
      if (String(holds) !== d.outcome) problems.push(`${d.c.type} ${id} decided ${d.outcome}, but its status was ${status}`);
    }
    names.forEach((name, i) => {
      const want = d.reads.get(name);
      after.forEach((l, j) => {
        const b = before.length === after.length ? fmt(before[j][2 + i]) : before.map((x) => fmt(x[2 + i])).find((x) => x === want);
        if (fmt(l[2 + i]) !== want && b !== want) problems.push(`${d.c.type} ${id} read $${name} as ${JSON.stringify(want)}, but bash had ${JSON.stringify(b)} / ${JSON.stringify(fmt(l[2 + i]))}`);
      });
    });
  }
  return { problems, blind: model.blind, decided: decisions.size, dead: dead.length, stopped: !done };
}

/** Checks `list` with `jobs` runs of bash at a time, in directories under `dir`. */
export async function checkAll(list: Script[], dir: string, jobs: number, each?: (s: Script, c: Checked) => void): Promise<Checked[]> {
  const out: Checked[] = new Array(list.length);
  let next = 0;
  const worker = async (slot: number): Promise<void> => {
    while (next < list.length) {
      const k = next++;
      out[k] = await check(list[k], path.join(dir, String(slot)));
      each?.(list[k], out[k]);
    }
  };
  await Promise.all(Array.from({ length: jobs }, (_, j) => worker(j)));
  return out;
}
