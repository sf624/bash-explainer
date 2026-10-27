// The builtin effects of the walk of the shell state (src/semantics/walk/walker.ts): what the builtins and the
// assignments change in the state (`set`, `shopt`, `alias`, `enable`, `hash`, the declarations, `unset`, `read`…),
// read with their specs (src/semantics/effects.ts).
import { evalArithWrapping } from '../../arith';
import type { ArgRole, ArgvParse } from '../../argv/interpret';
import type { CommandSpec } from '../../argv/spec';
import { actedNames, onlyInFunction } from '../../argv/query';
import { prefixOf } from '../../argv/words';
import { BASH_ONLY_BUILTINS, builtins } from '../../dict/builtins';
import { staticWordValue, tildeParts, tildeSpots } from '../../staticword';
import { descendants, field, fields, type SyntaxNode } from '../../syntax/tree';
import { parseExpansion } from '../../expansion';
import { expansionFailure, sameInEveryLocale, substring } from '../chars';
import { temporariesUnset } from '../names';
import { aliasOf, builtinParse, commandName, DECLARATIONS, setOptionWrites, variableWrites, wrapped } from '../effects';
import { attribute, type Attribute, merge, option, POSIX_ON, type ShellState, type Tri, withoutErrexitWhy } from '../shellstate';
import { changedByBash, optionRoles, readDeclarationWords, type Declaration } from '../vars';
import { ExpansionError, NAME, type Operand } from './shared';
import type { Walker } from './walker';

/** The attributes the declaration builtins give with their options. */
export const ATTRIBUTE_LETTERS: ReadonlySet<string> = new Set(['a', 'A', 'i', 'l', 'n', 'r', 't', 'u', 'x']);

/** What builtins and assignments change in the state, for the walk. */
export class WalkBuiltins {
  constructor(private readonly w: Walker) {}

  /**
   * The builtin `name` run with `args`, when it changes the state; with `host`, also a function of the file's host
   * (bats' `run`), read by its spec (not behind `command` and `builtin`, which run no function).
   */
  builtin(name: string, args: SyntaxNode[], n: SyntaxNode, st: ShellState, host = false): ShellState {
    const hosted = host && Object.hasOwn(this.w.host, name) ? this.w.host[name] : undefined;
    if (hosted) return this.effects(hosted, builtinParse(name, args, this.w.shell, hosted), args, n, st, true);
    if (!builtins[name] || !this.bashBuiltin(name)) return st;
    // Where brace expansion may be on or off (`set +B` on some paths before), a word with braces gives other words
    // (`unset {a,b}`: `a` and `b`, or the name `{a,b}`): both are followed.
    if (option(st, 'set', 'braceexpand') === 'unknown') {
      const [on, off] = (['on', 'off'] as const).map((v): ShellState => ({ ...st, set: st.set.with('braceexpand', v) }));
      const words = args.filter((a) => !a.type.endsWith('redirect'));
      if (words.some((a) => String(this.w.conditions.fieldsOf(a, on)) !== String(this.w.conditions.fieldsOf(a, off)))) {
        return merge([this.builtin(name, args, n, on), this.builtin(name, args, n, off)], this.w.posix);
      }
    }
    // A builtin turned off (`enable -n exit`) runs the program of its name, or fails: it changes nothing here, and
    // `exit` ends nothing. Where it may be off, both.
    const off = st.disabled.get(name)?.state;
    if (off === 'on') return st;
    if (off === 'unknown') return merge([st, this.builtinOn(name, args, n, st)], this.w.posix);
    return this.builtinOn(name, args, n, st);
  }

  /** The builtin `name` run with `args` (see `builtin`), when it is not turned off. */
  private builtinOn(name: string, args: SyntaxNode[], n: SyntaxNode, st: ShellState): ShellState {
    // `command set -f`, `builtin shopt -s x`: the builtin runs (`command -v` only looks it up).
    if (name === 'command' || name === 'builtin') {
      const inner = wrapped(name, args, this.w.shell);
      return 'lookup' in inner || inner.name === undefined ? st : this.builtin(inner.name, inner.args, n, st);
    }
    if (DECLARATIONS.has(name)) return this.declare(name, args, readDeclarationWords(name, args, this.w.shell), n, st);
    if (name === 'unset') return this.unset(args, n, st);
    const spec = builtins[name];
    const parse = builtinParse(name, args, this.w.shell);
    st = this.effects(spec, parse, args, n, st);
    const operands = parse.roles.filter((r) => r.role.role === 'operand').map((r) => args[r.word]);
    const valueOf = (flag: string): SyntaxNode | undefined => {
      const r = parse.roles.find((x) => x.role.role === 'value' && x.role.of === flag);
      return r ? args[r.word] : undefined;
    };
    const letters = optionRoles(parse);
    const has = (flag: string): boolean => letters.some((l) => l.flag === flag);
    // `break`, `continue`, `return` and `exit`: the path goes on where what they end ends.
    if (spec.ends === 'loop' || spec.ends === 'pass') {
      // `break N`: N loops (a count not known, or not a number above 0, may fail).
      const words = args.filter((a, i) => i > 0 || a.text !== '--');
      const count = words.length ? staticWordValue(words[0]) : '1';
      return this.w.jump(spec.ends, words.length < 2 && count !== undefined && /^0*[1-9]\d{0,8}$/.test(count) ? Number(count) : undefined, st);
    }
    if (spec.ends) return this.w.jump(spec.ends, undefined, st);
    switch (name) {
      case 'eval': case 'trap': {
        // A static string of `eval` runs here, in this shell; a trap's action runs later, when the signal comes
        // (docs/design/semantics.md, 4.13). A string not known here may set any name, and call any function: nothing
        // is trusted then (src/semantics/trust.ts; also a string too deep, or one with a glob, which the walk does not read).
        const at = parse.roles.find((r) => r.role.role === 'command');
        if (!at) return st;
        const words = name === 'eval' ? args.slice(at.word) : [args[at.word]];
        const script = this.w.script(words, name === 'eval' ? 'current' : 'later', n, parse, args);
        if ('why' in script) {
          if (!this.w.mode.dead && !this.w.blind) this.w.walkAgain(`\`${name}\` of a string the walk does not read`);
          return this.w.opaque(st);
        }
        if (name === 'eval') return this.w.evalScript(script, n, st);
        const signals = parse.roles.filter((r) => r.role.role === 'operand').map((r) => staticWordValue(args[r.word]) ?? '');
        const exit = (x: string) => /^(SIG)?EXIT$|^0$/i.test(x);
        if (!this.w.silent) this.w.traps.push({ script, host: this.w.aliasHost ?? n, st, since: this.w.changeCount, exit: signals.some(exit), exitOnly: signals.every(exit), dead: this.w.mode.dead > 0 });
        // (What it changes, it may change after any later statement; an EXIT trap runs at the end only.)
        if (!signals.every(exit)) {
          const keys = new Set<string>();
          this.w.collecting.push(keys);
          this.w.silent++;
          this.w.trapAction(script, this.w.aliasHost ?? n, st, false);
          this.w.silent--;
          this.w.collecting.pop();
          for (const k of keys) this.w.trapKeys.add(k);
        }
        return st;
      }
      case 'cd': case 'pushd': case 'popd': {
        // They set PWD and OLDPWD (when they succeed), to values not followed.
        const moved = this.setVariable(this.setVariable(st, 'PWD', n, undefined), 'OLDPWD', n, undefined);
        return merge([st, moved], this.w.posix);
      }
      case 'let': return this.w.arith.arithRun((s) => this.w.arith.letCommand(operands, s), st);
      case 'set': return this.setCommand(st, parse, args);
      case 'shopt': {
        const on = has('-s') ? 'on' : has('-u') ? 'off' : undefined;
        if (!on) return st;
        for (const o of operands) {
          const opt = staticWordValue(o);
          if (opt === 'posix' && has('-o')) st = this.setPosix(st, on === 'on', n);
          else if (opt) st = this.w.put(st, has('-o') ? 'set' : 'shopt', opt, on);
        }
        return st;
      }
      case 'alias':
        st = this.markedArrays('alias', args, n, st);
        for (const a of args) {
          const def = a.type === 'variable_assignment' ? undefined : aliasOf(a);
          if (def) st = this.w.put(st, 'aliases', def.name, { state: 'on', value: def.value, at: n });
        }
        return st;
      case 'unalias':
        if (has('-a')) for (const [k, a] of st.aliases) st = this.w.put(st, 'aliases', k, { ...a, state: 'off' });
        for (const o of operands) {
          const a = staticWordValue(o);
          const prev = a ? st.aliases.get(a) : undefined;
          if (prev) st = this.w.put(st, 'aliases', a!, { ...prev, state: 'off' });
        }
        return st;
      case 'enable': {
        // (`-p` prints. `-f` and `-d` load and remove builtins of a shared object, not followed: `-f` trusts nothing.
        // With names, `-a` and `-s` choose nothing: `enable -ns exit` turns `exit` off.)
        if (has('-f') || has('-d') || has('-p')) return st;
        for (const o of operands) {
          const b = staticWordValue(o);
          if (b) st = this.w.put(st, 'disabled', b, { state: has('-n') ? 'on' : 'off', value: '', at: n });
        }
        return st;
      }
      case 'hash': {
        if (has('-r')) st = this.forgetHashed(st);
        const path = valueOf('-p');
        // (`-d` takes no value: it forgets every name after it.)
        for (const o of operands) {
          const b = staticWordValue(o);
          if (!b) continue;
          if (path) st = this.w.put(st, 'hashed', b, { state: 'on', value: staticWordValue(path) ?? '', at: n });
          else if (has('-d')) st = this.unhash(st, b, n);
        }
        return st;
      }
      case 'getopts': {
        // OPTARG is set, or unset when the option takes no value.
        st = this.setVariable(st, 'OPTIND', n, undefined);
        const prev = st.variables.get('OPTARG');
        return this.w.put(st, 'variables', 'OPTARG', { declared: 'unknown', set: 'unknown', attrs: prev?.attrs ?? {}, at: n });
      }
    }
    return st;
  }

  /**
   * What its spec says a builtin (or a function of the host: `hosted`) does, read from `parse`: the variables it sets
   * (`read`, `printf -v`, `mapfile`, `getopts`, `wait -p`, bats' `run`), and a file it runs (`source`). What a
   * function of the host runs (the file of bats' `load`, the pipeline of `bats_pipe`) is taken to define helpers or
   * to run tools, not to change what the names of the file run: the walk goes on as it was (the trust scan trusts
   * nothing in the whole file then, so no condition of it is decided: src/semantics/trust.ts).
   */
  private effects(spec: CommandSpec, parse: ArgvParse, args: SyntaxNode[], n: SyntaxNode, st: ShellState, hosted = false): ShellState {
    for (const v of variableWrites(spec, parse, args)) {
      // (`wait -p`: bash unsets the variable first, also an integer: `x=1; wait -p x` with no job leaves `x` unset.)
      if (v.sets === 'job-id' && v.name && NAME.test(v.name) && attribute(st, v.name, 'r') === 'off') st = this.w.put(st, 'variables', v.name, { declared: 'off', set: 'off', attrs: {}, at: n });
      const was = st;
      if (v.sets === 'lines') st = v.name && NAME.test(v.name) ? this.giveAttribute(this.setVariable(st, v.name, n, undefined), v.name, 'a', n) : st;
      else st = this.setNamed(st, v.name, n, v.sets === 'array');
      if (v.maybe || v.sets === 'job-id') st = merge([was, st], this.w.posix);
    }
    if (spec.shellEffect?.runsUnread && !hosted) {
      // (The file is not read: what it defines is not known here.)
      if (!this.w.silent) this.w.sources.push(this.w.aliasHost ?? n);
      st = this.w.opaque(st);
    }
    return st;
  }

  /** Every path `hash -p` gave is forgotten (`hash -r`, an assignment to PATH). */
  forgetHashed(st: ShellState): ShellState {
    for (const [k, e] of st.hashed) if (e.state !== 'off') st = this.w.put(st, 'hashed', k, { ...e, state: 'off' });
    return st;
  }

  private unhash(st: ShellState, name: string, at: SyntaxNode): ShellState {
    const e = st.hashed.get(name);
    return e ? this.w.put(st, 'hashed', name, { ...e, state: 'off', at }) : st;
  }

  /**
   * Whether the simple command `c` runs a program (not a builtin or a function), in a process of its own, where its
   * redirections are made; `unknown` when its name is not known here. `command cat` runs `cat` (`command -v` only
   * looks it up), and never a function.
   */
  runsProgram(c: SyntaxNode, st: ShellState): Tri {
    let name = commandName(c);
    let args = fields(c, 'argument');
    let fn = true;
    while (name === 'command') {
      const inner = wrapped(name, args, this.w.shell);
      if ('lookup' in inner) return 'off';
      ({ name, args } = inner);
      fn = false;
    }
    if (name === undefined) return 'unknown';
    if (!name || (fn && st.functions.has(name))) return 'off';
    if (!builtins[name] || !this.bashBuiltin(name)) return 'on';
    // A builtin turned off (`enable -n echo`) runs the program of its name.
    return st.disabled.get(name)?.state ?? 'off';
  }

  /** Whether `name` is read here as bash's builtin (the others are programs, or other shells' builtins). */
  bashBuiltin(name: string): boolean {
    return this.w.bash || !BASH_ONLY_BUILTINS.has(name);
  }

  /** Sets the variable `name` names (`v`, `a[1]`: an element), to a value not known here. */
  private setNamed(st: ShellState, name: string | undefined, at: SyntaxNode, array: boolean): ShellState {
    const m = /^([A-Za-z_]\w*)(\[.*\])?$/s.exec(name ?? '');
    if (!m) return st;
    // (An integer runs the text it is given, which may fail: see `assignmentError`.)
    if (attribute(st, this.resolve(st, m[1]) ?? m[1], 'i') !== 'off') this.w.abort(st, false);
    st = this.setVariable(st, m[1], at, undefined);
    return (array || m[2]) && attribute(st, m[1], 'A') === 'off' ? this.giveAttribute(st, m[1], 'a', at) : st;
  }

  /**
   * POSIX mode turned on or off (`set -o posix`, `POSIXLY_CORRECT`): on turns expand_aliases, inherit_errexit and
   * shift_verbose on; leaving it turns expand_aliases and shift_verbose off. `variable`: the change comes from
   * POSIXLY_CORRECT itself (which `set -o posix` sets and `set +o posix` unsets otherwise).
   */
  setPosix(st: ShellState, on: boolean, at: SyntaxNode, variable = false): ShellState {
    const now = option(st, 'set', 'posix');
    if (!this.w.bash) return this.w.put(st, 'set', 'posix', on ? 'on' : 'off');
    // Leaving a mode bash is not in changes nothing else.
    if (!on && (now === 'off' || now === 'default')) return this.w.put(st, 'set', 'posix', 'off');
    let out = this.w.put(st, 'set', 'posix', on ? 'on' : 'off');
    for (const s of POSIX_ON.shopt) if (on || s !== 'inherit_errexit') out = this.w.put(out, 'shopt', s, on ? 'on' : 'off');
    if (!variable) out = on ? this.setVariable(out, 'POSIXLY_CORRECT', at, 'y', true) : this.w.put(out, 'variables', 'POSIXLY_CORRECT', { declared: 'off', set: 'off', attrs: {}, at });
    return !on && now === 'unknown' ? merge([st, out], this.w.posix) : out;
  }

  private setCommand(st: ShellState, parse: ArgvParse, args: SyntaxNode[]): ShellState {
    for (const { name, on } of setOptionWrites(parse, args, this.w.shell)) {
      if (!name) continue;
      const writes = this.w.setWrites.get(this.w.node!) ?? new Map<string, 'on' | 'off'>();
      this.w.setWrites.set(this.w.node!, writes.set(name, on ? 'on' : 'off'));
      st = name === 'posix' ? this.setPosix(st, on, this.w.node!) : this.w.put(st, 'set', name, on ? 'on' : 'off');
      // (errexit is now what this `set` made it.)
      if (name === 'errexit') st = withoutErrexitWhy(st);
    }
    return st;
  }

  /** The names a declaration's words declare or assign. */
  private operands(words: SyntaxNode[], roles: Map<SyntaxNode, ArgRole>, st: ShellState): Operand[] {
    const out: Operand[] = [];
    for (const w of words) {
      if (roles.get(w)?.role !== 'operand') continue;
      if (w.type === 'variable_assignment') {
        const nameNode = field(w, 'name')!;
        const value = field(w, 'value');
        const subscript = nameNode.type === 'subscript';
        const text = value ? this.w.conditions.staticText(value, st, true) : '';
        out.push({ node: w, name: subscript ? field(nameNode, 'name')!.text : nameNode.text, subscript,
          assign: { append: w.children.some((c) => c.type === '+='), text, array: value?.type === 'array', source: value, kept: !!value && this.readsUnwritten(value, st) } });
        continue;
      }
      // A word: `x`, `a[1]` (a glob that matches no file, as the walk takes it), `y=2` in `command declare y=2`; `"c"=$x`
      // (whose value is not known here). It is expanded as any argument: `\declare a=$v` declares a name in each field.
      // (`local {a,b}` declares `a` and `b` where the shell expands braces; an unquoted `a[1]` that matches no file is itself.)
      const text = this.w.conditions.staticText(w, st);
      const texts = text !== undefined ? [text] : this.w.conditions.fieldsOf(w, st) ?? [w.type === 'word' ? w.text : undefined];
      for (const t of texts) {
        const m = /^([A-Za-z_]\w*)(\[.*?\])?(?:(\+?=)(.*))?$/s.exec(t ?? prefixOf(w).replace(/=.*/s, '='));
        if (!m || (t === undefined && !m[3])) continue;
        out.push({ node: w, name: m[1], subscript: !!m[2], ...(m[3] ? { assign: { append: m[3] === '+=', text: t === undefined ? undefined : m[4], array: false } } : {}) });
      }
    }
    return out;
  }

  /**
   * The arrays `a=(…)` among the words of a command that does not declare them, after a name written as a declaration
   * builtin or `alias` (a function named `declare`, `alias` itself): bash assigns them as the builtin `command` would.
   * Those that make locals (`CommandSpec.locals`: `declare`, `local`, `typeset`) read their options (`-g`, `-l`) and
   * make them local in a function; `export`, `readonly` and `alias` assign the variable visible here (a local one,
   * else the global one), with no attribute.
   */
  markedArrays(command: string, words: readonly SyntaxNode[], n: SyntaxNode, st: ShellState): ShellState {
    const arrays = words.filter((w) => w.type === 'variable_assignment' && field(w, 'value')?.type === 'array');
    if (!arrays.length) return st;
    if (!builtins[command]?.locals) return arrays.reduce((s, a) => this.assignNode(a, s), st);
    return this.declare(command, arrays, readDeclarationWords(command, [...words], this.w.shell), n, st);
  }

  declare(builtin: string, words: SyntaxNode[], { roles, on, off }: Declaration, n: SyntaxNode, st: ShellState): ShellState {
    if (on.includes('p')) return st;
    // (bash expands every word before the builtin runs: `a=1; declare a=5 b=$a` sets b to 1.)
    const before = st;
    const spec = builtins[builtin];
    const operands = this.operands(words, roles, st);
    // `export -f f`, `declare -fx f`, `readonly -f f`: the names are functions.
    if (/[fF]/.test(on)) {
      const exported: Tri | undefined = (builtin === 'export' && !on.includes('n')) || on.includes('x') ? 'on' : (builtin === 'export' || off.includes('x')) ? 'off' : undefined;
      const ro = builtin === 'readonly' || on.includes('r');
      for (const o of operands) {
        const fn = st.functions.get(o.name);
        if (fn && fn.state !== 'off') st = this.w.put(st, 'functions', o.name, { ...fn, ...(exported ? { exported } : {}), ...(ro ? { readonly: 'on' as Tri } : {}) });
      }
      return st;
    }
    // `local` works only in a function (`scope`; `declare` there is local too, unless `-g`): outside one it fails,
    // and changes nothing; its words are still read as in a function (a line taken from one).
    if (onlyInFunction(spec, this.w.shell) && !this.w.frames.length) {
      this.w.frames.push({ def: n, saved: new Map() });
      this.declare(builtin, words, { roles, on, off }, n, st);
      this.w.frames.pop();
      return st;
    }
    // `local -` (`localOptions`): the set options come back when the function returns.
    const frame = this.w.frames[this.w.frames.length - 1];
    if (spec.localOptions && words.some((w) => staticWordValue(w) === '-')) frame.options ??= st.set;
    const local = this.w.frames.length > 0 && spec.locals === 'unless-g' && !on.includes('g');
    const gives = builtin === 'export' ? (on.includes('n') ? '' : 'x') : builtin === 'readonly' ? 'r' : [...on].filter((l) => ATTRIBUTE_LETTERS.has(l)).join('');
    const removes = builtin === 'export' && on.includes('n') ? 'x' : [...off].filter((l) => ATTRIBUTE_LETTERS.has(l)).join('');
    // (An option the spec does not know, `declare -c`, may change the values assigned: they are not known. So does
    // `-I`, with the attributes of the variable it hides: an integer one runs the value.)
    const unknown = on.includes('I') || words.some((w) => roles.get(w)?.role === 'unknown-option');
    for (let o of operands) {
      if (unknown && o.assign) o = { ...o, assign: { ...o.assign, text: undefined, source: undefined } };
      // `declare a[1]=x` makes `a` an array.
      if (o.subscript) {
        st = this.assign(st, o.name, true, o.assign ?? { append: false, text: undefined, array: false }, o.node, false, true);
        continue;
      }
      const name = o.name;
      // A local variable starts afresh, hiding the one outside, from here to the end of the function.
      if (local && !frame.saved.has(name)) {
        const hidden = st.variables.get(name);
        // bash refuses a local copy of a readonly global variable ("readonly variable"), which stays as it is; a
        // caller's readonly local may be hidden.
        if (hidden?.attrs.r?.state === 'on' && !this.w.frames.some((f) => f.saved.has(name))) continue;
        frame.saved.set(name, hidden);
        // It keeps the export attribute of the one it hides, and no other (bash's make_local_variable). (With
        // localvar_inherit, it starts with the value and attributes of the one it hides: not followed. So does dash's
        // `local`, and sh may be dash: `local IFS` keeps the IFS of the caller there.)
        const x = hidden?.attrs.x;
        // (So does `declare -I`, and `local -I`.)
        const inherit = ['sh', 'dash', 'ash'].includes(this.w.shell ?? '') || on.includes('I') ? 'unknown' : option(st, 'shopt', 'localvar_inherit');
        st = this.w.put(st, 'variables', name, { declared: 'on', set: inherit === 'off' || inherit === 'default' ? 'off' : 'unknown', attrs: x && x.state !== 'off' ? { x: { state: x.state, at: n } } : {}, at: n });
      }
      // `declare -g x` while `x` is local: the global one.
      const global = on.includes('g') ? this.w.frames.find((f) => f.saved.has(name)) : undefined;
      const scope = global ? { ...st, variables: st.variables.with(name, global.saved.get(name)) } : st;
      let next = this.declareOne(scope, name, gives, removes, o, n, on.includes('n'), before);
      if (global) {
        global.saved.set(name, next.variables.get(name));
        next = { ...next, variables: next.variables.with(name, st.variables.get(name)) };
      }
      st = next;
    }
    return st;
  }

  /** `before`: the state before the declaration, where its words are expanded. */
  private declareOne(st: ShellState, name: string, gives: string, removes: string, o: Operand, n: SyntaxNode, nameref: boolean, before: ShellState): ShellState {
    const prev = st.variables.get(name);
    const attrs: Record<string, Attribute> = { ...(prev?.attrs ?? {}) };
    for (const l of gives) {
      // bash refuses to make an indexed array associative, and keeps an associative one so.
      if ((l === 'A' && attrs.a?.state === 'on') || (l === 'a' && attrs.A?.state === 'on')) continue;
      attrs[l] = { state: 'on', at: n };
    }
    for (const l of removes) attrs[l] = { state: 'off', at: n };
    // (A name the script has not set may come from the environment: by custom, those are in capitals.)
    const set: Tri = prev ? prev.set : /^[A-Z_][A-Z0-9_]*$/.test(name) ? 'unknown' : 'off';
    // (One the script has not set keeps a value from the environment: `export n`, `declare n` outside a function.)
    st = this.w.put(st, 'variables', name, { declared: 'on', set, attrs, value: prev?.value, at: n, ...(!prev || prev.kept ? { kept: true as const } : {}) });
    // (A variable readonly before the declaration keeps its value; `readonly r=1` sets it.)
    if (!o.assign || prev?.attrs.r?.state === 'on') return st;
    // (The state of an assignment in a declaration has the attributes the declaration gives, and the values from before
    // it, where bash expands its words: `local x=$x` reads the `x` of the caller. A value that may not be a valid
    // expression, given to an integer, may discard the rest of the line: see `assignmentError`.)
    if (o.node.type === 'variable_assignment') {
      const was = before.variables.get(name);
      const declared = st.variables.get(name)!;
      this.w.record(o.node, { ...before, variables: before.variables.with(name, was ? { ...was, attrs: declared.attrs } : declared) });
    }
    if ((attrs.i?.state ?? 'off') !== 'off' && !o.subscript && this.mayFail(o.assign.text, st, o.node)) this.w.abort(st, false);
    return this.assign(st, name, false, o.assign, o.node, nameref, true);
  }

  unset(words: readonly SyntaxNode[], n: SyntaxNode, st: ShellState): ShellState {
    // The options and the names, read with unset's spec.
    const ws = words.filter((w) => !w.type.endsWith('redirect'));
    const parse = builtinParse('unset', ws, this.w.shell);
    const acted = actedNames(parse);
    // What the names stand for, by unset's options (its spec): the same for every name.
    const space = acted[0]?.space;
    // (`unset -fv` is an error: nothing is unset.)
    if (space === 'none') return st;
    const temporary = temporariesUnset('unset', ws, n, this.w.shell, parse);
    for (const node of acted.map(({ word }) => ws[word])) {
      // The names the word gives, from the word model: `unset {a,b}` unsets `a` and `b` where the shell expands braces.
      const value = staticWordValue(node, false, this.w.shell);
      const texts = value !== undefined ? [value] : this.w.conditions.fieldsOf(node, st);
      if (!texts) {
        // A name not known here: a variable that `${u:=u}` in it sets may be the one it names.
        for (const e of descendants(node, ['expansion'])) {
          const name = e.namedChildren[0];
          if (!e.children.some((c) => c.type === ':=' || c.type === '=') || name?.type !== 'variable_name' || space === 'function' || attribute(st, name.text, 'r') === 'on') continue;
          st = merge([st, this.w.put(st, 'variables', name.text, { declared: 'off', set: 'off', attrs: {}, at: node })], this.w.posix);
        }
        continue;
      }
      for (const text of texts) {
        const fn = st.functions.get(text);
        if (space === 'function') {
          if (fn) st = this.w.put(st, 'functions', text, { ...fn, state: 'off', removed: n });
          continue;
        }
        // `unset 'a[1]'` removes an element; `x=1 unset x` the `x` of the command, and the one from before stays.
        if (text.includes('[') || temporary.has(text)) continue;
        const v = st.variables.get(text);
        // With no -v, a name with no variable is a function.
        if (space === 'either' && (!v || v.declared === 'off') && fn && fn.state !== 'off') {
          st = this.w.put(st, 'functions', text, { ...fn, state: 'off', removed: n });
          continue;
        }
        // No variable has a name such as `{a,b}` (`set +B`): bash unsets nothing; dash ends the shell ("bad variable name").
        if (!NAME.test(text)) {
          if (['sh', 'dash', 'ash'].includes(this.w.shell ?? '')) return this.w.abort(st, true);
          continue;
        }
        // `unset -n r` unsets the nameref itself, and a variable that is not one stays (bash 5.2 and 5.3).
        const ref = space === 'nameref' ? attribute(st, text, 'n') : 'on';
        if (ref === 'off') continue;
        // A readonly variable stays; `unset r` of a nameref unsets the variable it names.
        const target = space === 'nameref' ? text : this.resolve(st, text);
        // (dash ends the shell there: "unset: r: is read only".)
        if (target && !this.w.bash && attribute(st, target, 'r') === 'on') return this.w.abort(st, true);
        if (target && !this.w.bash && attribute(st, target, 'r') === 'unknown') this.w.abort(st, false);
        if (!target || attribute(st, target, 'r') === 'on') continue;
        const after = this.unsetVariable(st, target, node);
        st = ref === 'unknown' ? merge([st, after], this.w.posix) : after;
      }
    }
    return st;
  }

  /** `st` with the variable `target` unset by the word `node` of `unset`. */
  private unsetVariable(st: ShellState, target: string, node: SyntaxNode): ShellState {
    // The local of a calling function: unset removes it, and the variable outside shows again (it is no longer restored).
    const top = this.w.frames[this.w.frames.length - 1];
    const outer = this.w.frames.find((f) => f !== top && f.saved.has(target));
    if (outer && !top.saved.has(target)) {
      st = this.w.put(st, 'variables', target, outer.saved.get(target));
      outer.saved.delete(target);
      return st;
    }
    if (target === 'POSIXLY_CORRECT' && this.w.bash) st = this.setPosix(st, false, node, true);
    // Unsetting GLOBIGNORE turns dotglob off (setting it turned it on).
    if (target === 'GLOBIGNORE' && this.w.bash) st = this.w.put(st, 'shopt', 'dotglob', 'off');
    return this.w.put(st, 'variables', target, { declared: 'off', set: 'off', attrs: {}, at: node });
  }

  /**
   * Whether the word `w` reads a variable whose value the script may not have written in `st`: one it has not set
   * there (it may come from the environment), or one `kept` (see `VariableState.kept`). Not bash's own (`RANDOM`),
   * nor IFS, which bash sets when it starts whatever the environment says. A tilde reads HOME (`m=~`), and `~user` a
   * home not known.
   */
  private readsUnwritten(w: SyntaxNode, st: ShellState): boolean {
    const unwritten = (name: string): boolean => {
      const target = this.resolve(st, name) ?? name;
      const v = st.variables.get(target);
      return !changedByBash(target) && target !== 'IFS' && (!v || !!v.kept);
    };
    // (Each element of `a=(~ x)` starts a word of its own.)
    const tildes = (w.type === 'array' ? w.namedChildren : [w]).flatMap((e) => tildeSpots(tildeParts([e]), 'assignment'));
    if (tildes.some((t) => t.user !== '' || unwritten('HOME'))) return true;
    return [w, ...descendants(w, ['simple_expansion', 'expansion'])].some((e) => {
      const name = (e.type === 'simple_expansion' || e.type === 'expansion') ? e.namedChildren[0] : undefined;
      return name?.type === 'variable_name' && unwritten(name.text);
    });
  }

  /** The variable that `name` stands for, following namerefs; undefined when it is not known. */
  resolve(st: ShellState, name: string): string | undefined {
    const seen = new Set<string>();
    for (let v = st.variables.get(name); v?.attrs.n?.state === 'on' && v.set === 'on'; v = st.variables.get(name)) {
      if (v.value === undefined || !NAME.test(v.value) || seen.has(v.value)) return undefined;
      seen.add(name);
      name = v.value;
    }
    return name;
  }

  /**
   * The assignment `a`; `statement`: one with no command (`x=1`, not `x=1 cmd`), where an error discards the rest of
   * the line; `temporary`: one before a function call (`x=1 f`), see `assign`.
   */
  assignNode(a: SyntaxNode, st: ShellState, statement = false, temporary = false): ShellState {
    const nameNode = field(a, 'name')!;
    const value = field(a, 'value');
    const subscript = nameNode.type === 'subscript';
    const name = subscript ? field(nameNode, 'name')!.text : nameNode.text;
    const text = value ? this.w.conditions.staticText(value, st, true) : '';
    const kept = !!value && this.readsUnwritten(value, st);
    // (dash ends the shell on a prefix assignment to a readonly variable too: `r=2 true`.)
    if (statement || !this.w.bash) this.assignmentError(st, name, value?.type === 'array' ? '' : text, a);
    return this.assign(st, name, subscript, { append: a.children.some((c) => c.type === '+='), text, array: value?.type === 'array', source: value, kept }, a, false, false, temporary);
  }

  /**
   * An assignment statement to a readonly variable, or of text that may not be a valid expression to an integer
   * variable (`declare -i n; n=1/0`), is an error that discards the rest of the line, as an expansion error does
   * (see `abort`): surely when the variable surely is readonly, else it may.
   */
  private assignmentError(st: ShellState, name: string, text: string | undefined, at: SyntaxNode): void {
    const target = this.resolve(st, name);
    const v = target === undefined ? undefined : st.variables.get(target);
    const readonly = v?.attrs.r?.state ?? 'off';
    // (In POSIX mode it ends the shell.)
    const posix = this.posixMode(st);
    if (readonly === 'on') throw new ExpansionError(st, posix !== 'unknown', posix !== 'off');
    if (readonly === 'unknown' || ((v?.attrs.i?.state ?? 'off') !== 'off' && this.mayFail(text, st, at))) this.w.abort(st, false);
  }

  /** Whether `text`, given to an integer at `at`, may fail: it is not known, or the walk's arithmetic gives it no value. */
  private mayFail(text: string | undefined, st: ShellState, at: SyntaxNode): boolean {
    return text === undefined || this.w.arith.integer(text, st, at).value === undefined;
  }

  /**
   * The assignments before the builtin or program `n` runs (`n+='x=7' true`), which are the command's alone: only
   * `+=` to an integer leaves something, the arithmetic its text runs (bash adds it to the value, running it), and
   * only the first assignment of a name: the variable it makes has no attribute (`n+='x=7' n+='x=9' true` sets x to
   * 7). Not before `eval`, which makes them in the shell itself (`Walker.evalScript`).
   */
  appendArith(assignments: SyntaxNode[], n: SyntaxNode, st: ShellState): ShellState {
    let name = field(n, 'name')!.text;
    let args = fields(n, 'argument');
    while (name === 'command' || name === 'builtin') {
      const inner = wrapped(name, args, this.w.shell);
      if ('lookup' in inner || inner.name === undefined) break;
      ({ name, args } = inner);
    }
    if (name === 'eval') return st;
    const seen = new Set<string>();
    for (const a of assignments) {
      const nameNode = field(a, 'name')!;
      const value = field(a, 'value');
      const first = !seen.has(nameNode.text);
      seen.add(nameNode.text);
      if (!first || nameNode.type === 'subscript' || !value || !a.children.some((c) => c.type === '+=')) continue;
      const target = this.resolve(st, nameNode.text);
      const text = this.w.conditions.staticText(value, st, true);
      if (target === undefined || attribute(st, target, 'i') !== 'on' || text === undefined) continue;
      st = this.w.arith.integer(text, st, a).st;
    }
    return st;
  }

  /**
   * `name=value`, `name+=value`, `name[i]=value`, `name=(…)`; `nameref`: the assignment of a `declare -n`;
   * `temporary`: one before a function call (`n=1+1 f`), whose variable bash makes without the integer and case
   * attributes: `=` gives it the text as it is (`n='x=5' f` sets no x), but `+=` still runs an integer's arithmetic
   * (then the variable made has no attribute either: a second `+=` of it appends text).
   */
  assign(st: ShellState, name: string, subscript: boolean, how: NonNullable<Operand['assign']>, at: SyntaxNode, nameref: boolean, declaring = false, temporary = false): ShellState {
    // Assigning to a nameref assigns to the variable it names.
    const target = nameref ? name : this.resolve(st, name);
    if (!target) return st;
    let prev = st.variables.get(target);
    if (temporary && !how.append && prev) {
      st = this.withoutCase(st, target);
      prev = st.variables.get(target);
    }
    // A readonly variable keeps its value.
    if (prev?.attrs.r?.state === 'on' && !declaring) return st;
    if (subscript || how.array) {
      // (An array is `kept` when one of its elements may be: an element, or `+=`, keeps what the others were.)
      const kept = !!how.kept || ((subscript || how.append) && !!prev?.kept);
      st = this.setVariable(st, target, at, undefined, false, true, undefined, kept);
      return attribute(st, target, 'A') === 'off' ? this.giveAttribute(st, target, 'a', at) : st;
    }
    let text = how.text;
    const is = (l: string): boolean => prev?.attrs[l]?.state === 'on';
    if (is('a') || is('A')) text = undefined;
    else if (is('i') && text !== undefined) {
      // (The text is run as arithmetic, with what it assigns: `n='x = 5'` sets x.)
      const r = this.w.arith.integer(text, st, at);
      st = r.st;
      const old = prev?.value !== undefined ? evalArithWrapping(prev.value)?.value : how.append ? undefined : 0n;
      text = r.value === undefined || old === undefined ? undefined : String(BigInt.asIntN(64, how.append ? old + r.value : r.value));
    } else if (how.append) text = prev?.set === 'on' && prev.value !== undefined && text !== undefined ? prev.value + text : prev?.set === 'off' ? text : undefined;
    if (text !== undefined && is('l')) text = text.toLowerCase();
    if (text !== undefined && is('u')) text = text.toUpperCase();
    // An empty nameref (`declare -n r; r=x`) takes the name as its value; bash refuses one that is no name.
    if (is('n') && !nameref && (text === undefined || !NAME.test(text))) return st;
    // (An integer or a case attribute changes the value: then the word alone does not give it.)
    const source = text === undefined && !how.append && !['i', 'l', 'u'].some(is) ? how.source : undefined;
    // (Text made of a value the script may not have written, or added to one: `kept`.)
    const kept = !!how.kept || (how.append && (!prev || !!prev.kept));
    st = this.setVariable(st, target, at, text, false, is('a') || is('A'), source, kept);
    return temporary ? this.withoutCase(st, target) : st;
  }

  /** `name` without the integer and case attributes (a variable made before a function call, see `assign`). */
  private withoutCase(st: ShellState, name: string): ShellState {
    const v = st.variables.get(name)!;
    const { i: _i, l: _l, u: _u, ...attrs } = v.attrs;
    return Object.keys(attrs).length === Object.keys(v.attrs).length ? st : this.w.put(st, 'variables', name, { ...v, attrs });
  }

  /** Sets `name` (to `value`, when known), exporting it under `set -a` (not an array: bash cannot export one). */
  setVariable(st: ShellState, name: string, at: SyntaxNode, value: string | undefined, plain = false, array = false, source?: SyntaxNode, kept = false): ShellState {
    const prev = st.variables.get(name);
    st = this.w.put(st, 'variables', name, { declared: 'on', set: 'on', attrs: prev?.attrs ?? {}, value, ...(source ? { source } : {}), at, ...(kept ? { kept: true as const } : {}) });
    // Assigning PATH empties the table of remembered paths.
    if (name === 'PATH') st = this.forgetHashed(st);
    if (name === 'POSIXLY_CORRECT' && !plain && this.w.bash && option(st, 'set', 'posix') !== 'on') st = this.setPosix(st, true, at, true);
    if (name === 'GLOBIGNORE' && this.w.bash) st = this.globignore(st, value);
    const all = option(st, 'set', 'allexport');
    if (!array && (all === 'on' || (all === 'unknown' && prev?.attrs.x?.state !== 'on'))) {
      const v = st.variables.get(name)!;
      st = this.w.put(st, 'variables', name, { ...v, attrs: { ...v.attrs, x: { state: all === 'on' ? 'on' : 'unknown', at } } });
    }
    return st;
  }

  /**
   * After `${x?word}` (`${x:?word}`), `x` is set, from the environment or by what the model does not follow: bash
   * ends the shell otherwise (the walker's `unsetError`). Its value is not known, unless it was known to be set.
   */
  checkedSet(st: ShellState, e: SyntaxNode): ShellState {
    const name = e.namedChildren[0];
    if (name?.type !== 'variable_name' || !e.children.some((c) => c.type === '?' || c.type === ':?')) return st;
    const v = st.variables.get(name.text);
    // (A nameref stands for another variable.)
    if (v && (v.set === 'on' || attribute(st, name.text, 'n') !== 'off')) return st;
    return this.w.put(st, 'variables', name.text, { declared: 'on', set: 'on', attrs: v?.attrs ?? {}, value: undefined, at: e });
  }

  /** GLOBIGNORE set to `value` (undefined: not known here): one that is not empty turns dotglob on, until it is unset; an empty one leaves it as it is. */
  globignore(st: ShellState, value: string | undefined): ShellState {
    return value !== '' && option(st, 'shopt', 'dotglob') !== 'on' ? this.w.put(st, 'shopt', 'dotglob', value === undefined ? 'unknown' : 'on') : st;
  }

  giveAttribute(st: ShellState, name: string, letter: string, at: SyntaxNode): ShellState {
    const v = st.variables.get(name)!;
    return this.w.put(st, 'variables', name, { ...v, attrs: { ...v.attrs, [letter]: { state: 'on', at } } });
  }

  /**
   * The failures of the expansion `e` of `${…}` that do not depend on whether its variable is set or empty: a
   * substring whose numbers may fail discards the rest of the line; a transformation bash lacks (`${x@Z}`) ends the
   * shell where the variable is set (unset, it gives nothing). (Such an operator has no row in the allow-list, so the
   * model trusts nothing there: the walk takes the shell as one that may end, never as one that surely does.)
   */
  expansionFails(e: SyntaxNode, st: ShellState): void {
    const fails = expansionFailure(e.text);
    const name = e.namedChildren[0]?.text ?? '';
    const v = st.variables.get(name);
    if (fails === 'line') {
      // (Surely, for a value the script set: `x=abc; … ${x:1:-4}`.)
      const p = parseExpansion(e.text)!;
      const part = (role: string): string | undefined => p.parts.find((x) => x.role === role)?.text;
      if (v?.set === 'on' && typeof v.value === 'string' && sameInEveryLocale(v.value) && this.w.trust.variable(name) && substring(v.value, part('offset')!, part('length')) === null) throw new ExpansionError(st, true);
      this.w.abort(st, false);
    }
    if (fails !== 'shell') return;
    if (v?.set === 'off' && v.declared !== 'unknown') return;
    this.w.jump('shell', undefined, st, false);
  }

  /** Whether bash is in POSIX mode at `st`, where an arithmetic or assignment error ends the shell, not only the line. */
  posixMode(st: ShellState): Tri {
    const p = option(st, 'set', 'posix');
    return p === 'default' ? 'off' : p;
  }
}
