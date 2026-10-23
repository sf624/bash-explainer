// What the decisions of the shell state may rely on (docs/design/semantics.md, 4.14): which variables' values, and
// which function bodies run only at the calls the walk sees.
//
// A decision ("this condition is always false", "this code never runs") must never be wrong. So the rule is an
// allow-list, read once over the whole text of the script (every command wherever it runs, function bodies, and the
// texts of `eval`, `trap` and `alias` it can read), not a list of the ways a value may change unseen:
//
// - A variable is trusted when every command that may write it is a plain assignment (`x=w`, `x+=w`, or `local`,
//   `declare`, `typeset`, `export`, `readonly` of `x=w` with no option but -r, -x and -g), and its name appears in no
//   arithmetic text (where bash may assign it), in no other builtin that takes names, in no array, nameref, `${x:=w}`,
//   function a trap or a callback may run, nor in the text of an `eval`, `trap` or `alias`. Positional parameters and
//   the variables bash sets itself never are.
// - Nothing is trusted (`blind`) when the script runs what cannot be read: `source`, `eval` or `trap` of text not
//   known, a command name not known (`$cmd`, `"$@"`), a function of the file's host that the walk does not read (bats'
//   `run`, `load`: `shellState`'s `host`), a builtin given a variable name not known (`read "$v"`),
//   indirection (`${!v}`), a DEBUG or RETURN trap, a trap's or a callback's function that changes options, functions
//   or aliases; and when arithmetic may read text not known (`$1`, `$(cmd)`, a variable `read` sets or that is never
//   set: bash runs it as an expression, which may assign any variable).
// - A function is closed (its decisions and dead code may be said) when every call of it is a plain call in the
//   script: not exported (`export -f`, `set -a`), not named as an argument (`complete -F f`, `trap f INT`), not called
//   from the text of an `eval`, `trap` or `alias`.
//
// The walk runs the static strings of `eval` and of traps (4.13), but this scan still reads them as foreign text (a
// trap's action runs at any time). Its facts of statements (`arithNames`, `mayFail`, `associative`) are of the
// script's own statements: for a string's, the walk asks the scan of that string's tree (`Walker.facts`). A string
// the walk does not read (an expansion in it, a glob, too deep) makes it walk again with nothing trusted
// (`Walker.found`), as does a trap's action that may leave what a signal interrupts.
// Another shell's model (`bash -c`) trusts no more than the model of the script that starts it (`withinTrust`).
import { interpret } from '../argv/interpret';
import { argWord, prefixOf } from '../argv/words';
import { builtins } from '../dict/builtins';
import { staticWordValue } from '../staticword';
import { createUnbashParser } from '../syntax/adapters/unbash';
import { field, fields, type BashParser, type SyntaxNode } from '../syntax/tree';
import { builtinParse, callbacks, commandName, DECLARATIONS, setOptionWrites, variableWrites, wordName, wrapped } from './effects';
import { STATEMENTS } from './env';
import { ARITH_ASSIGNED, DYNAMIC, NUMERIC_DYNAMIC, optionRoles, readDeclaration, readDeclarationWords, type Declaration } from './vars';

export interface Trust {
  /** Why nothing is trusted (no decision at all), when so. */
  readonly blind: string | undefined;
  /** Whether a decision may read the variable `name`. */
  variable(name: string): boolean;
  /** Whether every call of the function `name` is one the walk sees (a plain call in the script). */
  closed(name: string): boolean;
  /**
   * The names that the statement `n` reads as arithmetic where the walk does not run it (a subscript, an offset,
   * `[[ x -eq y ]]`, the value of an integer variable): each must have a value there (else it may come from the
   * environment, as text bash runs).
   */
  arithNames(n: SyntaxNode): readonly string[] | undefined;
  /** The arrays whose subscripts in the statement `n` are taken as keys (the script declares them associative): each must be so there. */
  associative(n: SyntaxNode): readonly string[] | undefined;
  /**
   * Whether the statement `n` has arithmetic the walk does not run that may fail: a subscript or an offset that is not
   * a plain number (`a[i]=x`, `${s:i}`). An error there discards the rest of the line.
   */
  mayFail(n: SyntaxNode): boolean;
}

/** The variables bash sets itself (besides `DYNAMIC`), or that builtins set without naming them. */
const SPECIAL = /^(?:BASH\w*|COMP_\w+|READLINE_\w+|PWD|OLDPWD|REPLY|MAPFILE|OPTARG|OPTIND|OPTERR|COPROC\w*|UID|EUID|PPID|SHELLOPTS|BASHOPTS|COLUMNS|LINES|HOSTNAME|HOSTTYPE|MACHTYPE|OSTYPE|SHLVL)$/;
const NAME = /^[A-Za-z_]\w*$/;
/** The names in an arithmetic text or a value read as one (not the digits of `0x1f` or `16#ff`, nor `${#x}`'s). */
const IDENTIFIERS = /(?<![\w#@.])[A-Za-z_]\w*/g;
/** A `${…}` that arithmetic may paste: a value, an element, a length, or a default (`${x:-0}`). */
const PASTE = /^\$\{#?[A-Za-z_]\w*(?:\[[^\]]*\])?(?::?-[^{}$`'"]*)?\}/;
/** The builtins a command name read from a variable may be (`debug=false; $debug`): they change nothing. */
const SAFE_BUILTINS = new Set(['true', 'false', ':', 'echo', 'test', '[']);

/** What a write gives a variable: a number, nothing (unset), text with these names in it, or text not known. */
type Value = 'number' | 'none' | 'unknown' | { names: string[]; text: string; fixed?: true };

interface Write {
  /** A plain assignment (see the head of this file). */
  plain: boolean;
  value: Value;
  /** The function whose body holds it (undefined: the top level), and whether it is in the text of an eval, trap or alias. */
  fn: string | undefined;
  foreign: boolean;
  /** Made by a nameref declaration (`declare -n r=x`). */
  nameref?: boolean;
}

interface Where { fn: string | undefined; foreign: boolean }

const identifiers = (text: string): string[] => text.match(IDENTIFIERS) ?? [];

/** The values of several words given in turn (a list of `for`, the elements of an array). */
const joined = (values: Value[]): Value =>
  (values.every((v): v is Extract<Value, object> => typeof v === 'object') ? { names: values.flatMap((v) => v.names), text: '' } : 'unknown');

let foreignParser: BashParser | undefined;

/** Thrown when the scan finds that nothing is trusted (see `Scan.blindFor`). */
class StopScan {}

class Scan {
  readonly writes = new Map<string, Write[]>();
  /** The foreign texts read, by function (see `foreign`). */
  private readonly foreignSeen = new Set<string>();
  /** Names read by arithmetic, and the statements that read them where the walk does not run the arithmetic. */
  readonly arith = new Set<string>();
  readonly pending = new Map<SyntaxNode, Set<string>>();
  /** The associative arrays whose subscripts each statement reads as keys. */
  readonly keys = new Map<SyntaxNode, Set<string>>();
  /** The statements with a subscript or an offset that is not a plain number: bash may fail there (see `Trust.mayFail`). */
  readonly fails = new Set<SyntaxNode>();
  /** Subscripts, read as arithmetic unless their array is associative (known at the end). */
  private readonly subscripts: { array: string; text: string; owner: SyntaxNode | undefined; where: Where }[] = [];
  /** The texts assigned to each variable, for those that are integers (read as arithmetic). */
  private readonly texts = new Map<string, { text: string | undefined; owner: SyntaxNode | undefined; where: Where }[]>();
  readonly integers = new Set<string>();
  readonly associative = new Set<string>();
  readonly refTargets = new Set<string>();
  readonly refUnknown = new Set<string>();
  readonly exported = new Set<string>();
  exportAll = false;
  readonly functions = new Set<string>();
  /** The functions each function calls ('' : the top level), and those run otherwise than by a plain call. */
  readonly calls = new Map<string, Set<string>>();
  readonly callbacks = new Set<string>();
  /** Where options, functions or aliases change: by function ('' : the top level), and in foreign text. */
  readonly changes = new Set<string>();
  foreignChanges = false;
  blind: string | undefined;
  /** The variables whose values are command names (`$debug`), and whether they are quoted (not split). */
  private readonly commandVariables: { name: string; quoted: boolean }[] = [];

  constructor(root: SyntaxNode, private readonly stop: boolean, private readonly host: ReadonlySet<string> = NO_HOST) {
    const defs = (n: SyntaxNode): void => {
      if (n.type === 'function_definition') this.functions.add(field(n, 'name')!.text);
      n.children.forEach(defs);
    };
    defs(root);
    try {
      this.visit(root, { fn: undefined, foreign: false }, root);
      this.finish();
    } catch (e) {
      /* c8 ignore next -- only `StopScan` is thrown on purpose */
      if (!(e instanceof StopScan)) throw e;
    }
  }

  /** Whether the scan stopped at a reason to trust nothing. */
  get stopped(): boolean {
    return this.stop && this.blind !== undefined;
  }

  /**
   * Nothing is trusted, for `why`: the scan stops there (`StopScan`), since nothing it finds after would count, unless
   * it is read for the facts of its statements (`stop` off).
   */
  private blindFor(why: string): void {
    this.blind ??= why;
    if (this.stop) throw new StopScan();
  }

  private write(name: string, w: Where, plain: boolean, value: Value, nameref = false): void {
    const list = this.writes.get(name) ?? [];
    list.push({ plain, value, fn: w.fn, foreign: w.foreign, ...(nameref ? { nameref } : {}) });
    this.writes.set(name, list);
  }

  private changed(w: Where): void {
    if (w.foreign) this.foreignChanges = true;
    else this.changes.add(w.fn ?? '');
  }

  /** The statement of the main tree that runs `n` (none in foreign text, which the walk parses on its own). */
  private owner(n: SyntaxNode, w: Where): SyntaxNode | undefined {
    if (w.foreign) return undefined;
    // (An assignment in a command is run with it.)
    for (let x: SyntaxNode | null = n; x; x = x.parent) if (STATEMENTS.has(x.type) && !(x.type === 'variable_assignment' && ['command', 'variable_assignments', 'declaration_command'].includes(x.parent!.type))) return x;
    /* c8 ignore next -- every word is in a statement */
    return undefined;
  }

  /**
   * An arithmetic text: the names it reads and assigns, and what it pastes (`$1`, `$(cmd)`: text not known, which bash
   * runs as an expression). `owner`: the statement that reads it, when the walk does not run it.
   */
  private arithText(text: string, w: Where, owner?: SyntaxNode): void {
    if (text.includes('`')) this.blindFor('arithmetic pastes command output');
    for (let i = text.indexOf('$'); i >= 0; i = text.indexOf('$', i + 1)) {
      const rest = text.slice(i);
      if (/^\$(?:\(\(|\[|[A-Za-z_#?$!])/.test(rest) || PASTE.test(rest)) continue;
      this.blindFor('arithmetic pastes text not known');
    }
    const names = identifiers(text);
    for (const name of names) this.arith.add(name);
    if (owner && names.length) {
      const set = this.pending.get(owner) ?? new Set<string>();
      for (const name of names) set.add(name);
      this.pending.set(owner, set);
    }
    for (const m of text.matchAll(ARITH_ASSIGNED)) this.write(m[1] ?? m[3] ?? m[4], w, false, 'number');
  }

  /** What the word `v` assigns (undefined: the empty value). */
  private value(v: SyntaxNode | undefined): Value {
    if (!v) return { names: [], text: '' };
    const s = staticWordValue(v, true);
    if (s !== undefined) return { names: identifiers(s), text: s, fixed: true };
    const names: string[] = [];
    const parts: string[] = [];
    const known = (n: SyntaxNode): boolean => {
      switch (n.type) {
        case 'word': case 'number': case 'raw_string': case 'string_content':
          parts.push(n.text);
          names.push(...identifiers(n.text));
          return true;
        case 'string': case 'concatenation': return n.namedChildren.every(known);
        case 'simple_expansion': case 'expansion': {
          const m = /^\$\{?([A-Za-z_]\w*)\}?$/.exec(n.text);
          if (m) names.push(m[1]);
          parts.push(n.text);
          return !!m;
        }
        // (A number.)
        case 'arithmetic_expansion': return true;
      }
      return false;
    };
    return known(v) ? { names, text: parts.join('') } : 'unknown';
  }

  /** Records the text assigned to `name` (read as arithmetic if it is an integer). */
  private assigned(name: string, text: string | undefined, n: SyntaxNode, w: Where): void {
    const list = this.texts.get(name) ?? [];
    list.push({ text, owner: this.owner(n, w), where: w });
    this.texts.set(name, list);
  }

  /** A variable named by a word given to a builtin (`read x`, `printf -v 'a[i]'`): written, to a value of `value`. */
  /** A variable a builtin sets, named `text` by the word `word` (undefined: a name not known here). */
  private named(text: string | undefined, word: SyntaxNode, w: Where, value: Value = 'unknown'): void {
    const m = text === undefined ? null : /^([A-Za-z_]\w*)(?:\[(.*)\])?$/s.exec(text);
    if (!m) {
      if (text === undefined) this.blindFor('a builtin is given a variable name not known');
      return;
    }
    this.write(m[1], w, false, value);
    this.assigned(m[1], undefined, word, w);
    if (m[2] !== undefined) this.subscripts.push({ array: m[1], text: m[2], owner: this.owner(word, w), where: w });
  }

  private visit(n: SyntaxNode, w: Where, root: SyntaxNode): void {
    switch (n.type) {
      case 'function_definition': {
        this.changed(w);
        const name = field(n, 'name')!.text;
        for (const c of n.children) this.visit(c, { fn: w.foreign ? w.fn : name, foreign: w.foreign }, root);
        if (w.foreign) this.callbacks.add(name);
        return;
      }
      case 'arithmetic_expansion': case 'arithmetic_command':
        // (Run by the walk: its reads are checked there.)
        this.arithText(n.type === 'arithmetic_command' ? n.namedChildren.map((c) => c.text).join(' ') : n.text, w);
        return;
      case 'c_style_for_statement':
        for (const f of ['initializer', 'condition', 'update'] as const) for (const c of fields(n, f)) this.arithText(c.text, w);
        for (const c of n.children) if (c.field === 'body') this.visit(c, w, root);
        return;
      case 'subscript': {
        const index = field(n, 'index');
        if (index) this.subscripts.push({ array: field(n, 'name')!.text, text: index.text, owner: this.owner(n, w), where: w });
        break;
      }
      case 'expansion': {
        const name = n.namedChildren[0];
        const ops = n.children.filter((c) => !c.named).map((c) => c.type);
        if (/^\$\{![A-Za-z_]\w*(?:\[[^\]@*]*\])?(?:[^\w[\]@*]|$)/.test(n.text) && !/^\$\{![A-Za-z_]\w*[@*]\}$/.test(n.text)) this.blindFor('indirect expansion');
        if (name?.type === 'variable_name' && (ops.includes(':=') || ops.includes('='))) {
          const word = n.namedChildren[n.namedChildren.length - 1];
          this.write(name.text, w, false, word === name ? { names: [], text: '' } : this.value(word));
          this.assigned(name.text, undefined, n, w);
        }
        // `${x:offset:length}`: arithmetic.
        const m = /^\$\{(?:[A-Za-z_]\w*(?:\[[^\]]*\])?|[@*]|\d+):(?![-=?+])([\s\S]*)\}$/.exec(n.text);
        if (m) {
          const owner = this.owner(n, w);
          this.arithText(m[1], w, owner);
          if (owner && !/^\s*-?\d+\s*(?::\s*\d+\s*)?$/.test(m[1])) this.fails.add(owner);
        }
        break;
      }
      case 'binary_expression': {
        const op = field(n, 'operator')?.text;
        if (op && ['-eq', '-ne', '-lt', '-le', '-gt', '-ge'].includes(op) && n.parent && this.inExtendedTest(n)) {
          for (const side of [field(n, 'left'), field(n, 'right')]) if (side) this.arithText(side.text, w, this.owner(n, w));
        }
        break;
      }
      case 'unary_expression':
        if (field(n, 'operator')?.text === '-v') for (const c of n.namedChildren.slice(1)) this.testV(c, w);
        break;
      case 'test_command': {
        const words = n.namedChildren;
        words.forEach((c, i) => {
          if (i > 0 && staticWordValue(words[i - 1]) === '-v') this.testV(c, w);
        });
        break;
      }
      case 'for_statement': case 'select_statement': {
        const variable = field(n, 'variable');
        if (variable) {
          // (Each word, once expanded: a glob or an expansion gives text not known; `select`, what the user types.)
          const values = fields(n, 'value').map((v): Value => (staticWordValue(v) !== undefined ? this.value(v) : 'unknown'));
          this.write(variable.text, w, false, n.type === 'select_statement' || !values.length ? 'unknown' : joined(values));
          this.assigned(variable.text, undefined, n, w);
        }
        break;
      }
      case 'coproc_statement': {
        const name = field(n, 'name')?.text ?? 'COPROC';
        this.write(name, w, false, 'number');
        this.write(`${name}_PID`, w, false, 'number');
        break;
      }
      case 'file_redirect': case 'heredoc_redirect': case 'herestring_redirect': {
        const fd = /^\{([A-Za-z_]\w*)\}$/.exec(field(n, 'descriptor')?.text ?? '')?.[1];
        if (fd) this.write(fd, w, false, 'number');
        break;
      }
      case 'variable_assignment':
        // (Those of a declaration are read with it.)
        if (n.parent?.type !== 'declaration_command') this.assignment(n, w, true);
        break;
      case 'declaration_command':
        this.declaration(n.children[0].type, n.namedChildren.filter((c) => !c.type.endsWith('redirect')), readDeclaration(n), w);
        break;
      case 'unset_command':
        this.unset(n.namedChildren.filter((c) => !c.type.endsWith('redirect')), w);
        break;
      case 'command':
        this.command(n, w);
        break;
    }
    for (const c of n.children) this.visit(c, w, root);
  }

  /** Whether `n` is in `[[ ]]` (where `-eq` and the others read arithmetic; in `test` and `[`, integers only). */
  private inExtendedTest(n: SyntaxNode): boolean {
    let x: SyntaxNode | null = n.parent;
    while (x && (x.type === 'binary_expression' || x.type === 'unary_expression' || x.type === 'parenthesized_expression')) x = x.parent;
    return x?.type === 'extended_test';
  }

  /** The operand of `-v` (`[[ -v a[i] ]]`): its subscript is arithmetic. */
  private testV(word: SyntaxNode, w: Where): void {
    const m = /^([A-Za-z_]\w*)\[(.*)\]$/s.exec(staticWordValue(word) ?? word.text);
    if (m) this.subscripts.push({ array: m[1], text: m[2], owner: this.owner(word, w), where: w });
  }

  /**
   * `x=w`, `x+=w`, `a[i]=w`, `a=(…)`: `plain` unless it is in a declaration that gives attributes; `associative`: in
   * `declare -A`, whose keys are not arithmetic.
   */
  private assignment(a: SyntaxNode, w: Where, plain: boolean, associative = false): void {
    const nameNode = field(a, 'name')!;
    const value = field(a, 'value');
    const subscript = nameNode.type === 'subscript';
    const name = subscript ? field(nameNode, 'name')!.text : nameNode.text;
    if (value?.type === 'array') {
      this.write(name, w, false, joined(value.namedChildren.map((e) => this.value(e))));
      for (const e of value.namedChildren) {
        // (`a=([i]=x)`: `[i]` is a subscript.)
        const key = /^\[([^\]]*)\]\+?=/.exec(e.text)?.[1];
        if (key !== undefined && !associative) this.subscripts.push({ array: name, text: key, owner: this.owner(a, w), where: w });
      }
      this.assigned(name, undefined, a, w);
      return;
    }
    const v = this.value(value);
    this.write(name, w, plain && !subscript, v);
    this.assigned(name, value ? value.text : '', a, w);
  }

  private declaration(builtin: string, words: SyntaxNode[], { roles, on, off }: Declaration, w: Where): void {
    if (on.includes('p')) return;
    const operands = words.filter((x) => roles.get(x)?.role === 'operand');
    if (/[fF]/.test(on)) {
      // (`declare -f f` prints it; `export -f`, `declare -fx` export it, and a name not known may be any.)
      if ((builtin !== 'export' || on.includes('n')) && !on.includes('x')) return;
      for (const o of operands) {
        const name = o.type === 'variable_name' ? o.text : staticWordValue(o);
        if (name === undefined) this.exportAll = true;
        else this.exported.add(name);
      }
      return;
    }
    const unknownOption = words.some((x) => roles.get(x)?.role === 'unknown-option');
    const plain = !unknownOption && [...on].every((l) => 'rxg'.includes(l)) && [...off].every((l) => l === 'x') && !(builtin === 'export' && on.includes('n'));
    // (Attributes given where the walk does not see them change what assignments do: readonly ones fail, integer
    // ones run their values.)
    if (builtin === 'readonly' || unknownOption || [...on, ...off].some((l) => !'xg'.includes(l))) this.changed(w);
    const nameref = on.includes('n') && builtin !== 'export';
    for (const o of operands) {
      let name: string;
      if (o.type === 'variable_assignment') {
        const nameNode = field(o, 'name')!;
        name = nameNode.type === 'subscript' ? field(nameNode, 'name')!.text : nameNode.text;
        if (nameref) {
          const target = field(o, 'value') && staticWordValue(field(o, 'value')!, true);
          const m = target === undefined ? null : /^([A-Za-z_]\w*)(?:\[(.*)\])?$/s.exec(target);
          if (m) {
            this.refTargets.add(m[1]);
            if (m[2] !== undefined) this.subscripts.push({ array: m[1], text: m[2], owner: this.owner(o, w), where: w });
          } else this.refUnknown.add(name);
          this.write(name, w, false, 'unknown', true);
          continue;
        }
        this.assignment(o, w, plain, on.includes('A'));
      } else {
        // A word: `x`, `'x=1'`, `"$v"=1` (a name with a value not known), `$v` (a name not known).
        const text = o.type === 'variable_name' || o.type === 'subscript' ? o.text : staticWordValue(o);
        const m = /^([A-Za-z_]\w*)(\[.*?\])?(?:(\+?=)(.*))?$/s.exec(text ?? prefixOf(o).replace(/=.*/s, '='));
        if (!m || (text === undefined && !m[3])) {
          // (`local -`: the options, not a variable.)
          if (text === undefined) this.blindFor('a declaration names a variable not known');
          continue;
        }
        name = m[1];
        if (m[2]) this.subscripts.push({ array: name, text: m[2].slice(1, -1), owner: this.owner(o, w), where: w });
        if (nameref) {
          const target = m[3] && text !== undefined ? m[4] : undefined;
          if (target !== undefined && NAME.test(target)) this.refTargets.add(target);
          else this.refUnknown.add(name);
          this.write(name, w, false, 'unknown', true);
          continue;
        }
        if (m[3]) {
          const value: Value = text === undefined ? 'unknown' : { names: identifiers(m[4]), text: m[4], fixed: true };
          this.write(name, w, plain && !m[2], value);
          this.assigned(name, text === undefined ? undefined : m[4], o, w);
        } else if (!(builtin === 'export' || builtin === 'readonly') || !plain) {
          // (`local x`, `declare x`: a new variable, with no value; `export x` and `readonly x` change no value.)
          this.write(name, w, false, 'none');
        }
      }
      if (on.includes('i')) this.integers.add(name);
      if (on.includes('A')) this.associative.add(name);
    }
  }

  private unset(words: SyntaxNode[], w: Where): void {
    const parse = builtinParse('unset', words);
    const flags = optionRoles(parse).map((r) => r.flag.slice(1)).join('');
    if (flags.includes('f') && !flags.includes('v')) {
      this.changed(w);
      return;
    }
    for (const r of parse.roles) if (r.role.role === 'operand') this.named(wordName(words[r.word]), words[r.word], w, 'none');
  }

  /** The command name of `c` and its words, past `command` and `builtin` (undefined: not known); `lookup`: `command -v`. */
  private nameOf(c: SyntaxNode): { name: string | undefined; args: SyntaxNode[]; lookup: boolean } {
    let name = commandName(c);
    let args = fields(c, 'argument');
    while (name === 'command' || name === 'builtin') {
      const inner = wrapped(name, args);
      if ('lookup' in inner) return { name, args, lookup: true };
      ({ name, args } = inner);
    }
    return { name, args, lookup: false };
  }

  private command(c: SyntaxNode, w: Where): void {
    const { name, args, lookup } = this.nameOf(c);
    if (name === undefined) {
      // `$debug`, `"$run"`: a variable the script sets to command names (see `finish`).
      const m = /^("?)\$\{?([A-Za-z_]\w*)\}?\1$/.exec(field(c, 'name')!.namedChildren[0].text);
      if (m) this.commandVariables.push({ name: m[2], quoted: !!m[1] });
      else this.blindFor('a command name not known');
      return;
    }
    // A function the host file defines (bats' `run`, `load`): the walk does not read it, and it may set anything.
    if (!this.functions.has(name) && this.host.has(name)) this.blindFor(`\`${name}\` is a function of the test runner (bats), which the model does not read`);
    if (this.functions.has(name)) {
      if (w.foreign) this.callbacks.add(name);
      else {
        const set = this.calls.get(w.fn ?? '') ?? new Set<string>();
        set.add(name);
        this.calls.set(w.fn ?? '', set);
      }
    }
    // A function named as an argument may be run by the command (`complete -F f`, `mapfile -C f`, `trap f INT`).
    const refs = !lookup && !['unset', 'type', 'declare', 'typeset', 'readonly', 'export', 'local'].includes(name);
    if (refs) for (const a of args) if (this.functions.has(staticWordValue(a) ?? '')) this.callbacks.add(staticWordValue(a)!);
    if (lookup || !builtins[name]) return;
    const spec = builtins[name];
    if (spec.shellEffect?.alters) this.changed(w);
    const parse = builtinParse(name, args);
    // The variables it sets, and the functions it runs later, as its spec says (src/semantics/effects.ts).
    for (const v of variableWrites(spec, parse, args)) if (v.node) this.named(v.name, v.node, w, v.sets === 'job-id' ? 'number' : 'unknown');
    for (const f of callbacks(parse, args)) this.callback(f);
    switch (name) {
      case 'source': case '.':
        this.blindFor('a file is sourced');
        return;
      case 'eval': {
        // (The words the walk reads as the string, after `--`: see `Walker.script`.)
        const text = args.filter((a, i) => i > 0 || a.text !== '--').map((a) => staticWordValue(a));
        if (text.some((t) => t === undefined)) this.blindFor('eval of text not known');
        else this.foreign(text.join(' '), w);
        return;
      }
      case 'trap': {
        // (Its action is the word of the slot that runs it later; the signals are its operands.)
        const roles = parse.roles;
        const actions = roles.filter((r) => r.role.role === 'command').map((r) => staticWordValue(args[r.word]));
        const signals = roles.filter((r) => r.role.role === 'operand').map((r) => staticWordValue(args[r.word]));
        if (!actions.length || actions.every((t) => t === '' || t === '-')) return;
        if (actions.some((t) => t === undefined)) this.blindFor('a trap of text not known');
        else if (signals.some((s) => s === undefined || /^(?:SIG)?(?:DEBUG|RETURN)$/i.test(s))) this.blindFor('a DEBUG or RETURN trap');
        else this.foreign(actions.join(' '), w);
        return;
      }
      case 'alias':
        for (const a of args) {
          const v = staticWordValue(a);
          const m = v === undefined ? null : /^[^=]+=([\s\S]*)$/.exec(v);
          if (m) this.foreign(m[1], w);
          else if (v === undefined) this.blindFor('an alias of text not known');
        }
        return;
      case 'let':
        for (const r of parse.roles) if (r.role.role === 'operand') this.arithText(args[r.word].text, w);
        return;
      case 'unset':
        this.unset(args, w);
        return;
      case 'set': {
        // `set -a`, `set -o allexport` (the last of them in the command wins), or options not known (a name of `-o`
        // not known, a word whose value is not known before the operands): functions defined after are exported.
        const writes = setOptionWrites(parse, args);
        const first = parse.roles.find((r) => r.role.role === 'end-of-options' || (r.role.role === 'operand' && staticWordValue(args[r.word]) !== undefined))?.word ?? args.length;
        if (writes.filter((o) => o.name === 'allexport').pop()?.on || writes.some((o) => o.name === undefined && o.on)
          || args.slice(0, first).some((a) => staticWordValue(a) === undefined)) this.exportAll = true;
        return;
      }
      case 'test': case '[':
        args.forEach((a, i) => {
          if (i > 0 && staticWordValue(args[i - 1]) === '-v') this.testV(a, w);
        });
        return;
    }
    if (DECLARATIONS.has(name)) this.declaration(name, args, readDeclarationWords(name, args), w);
  }

  /** A function named to be run later by a builtin (`complete -F f`): any, when the name is not known. */
  private callback(f: string | undefined): void {
    if (f === undefined) this.blindFor('a callback not known');
    else this.callbacks.add(f);
  }

  /** The text of an `eval`, a trap's action or an alias: read as part of the script, run from elsewhere. */
  private foreign(text: string, w: Where): void {
    // (The same text from the same function reads the same: once is enough.)
    const key = `${w.fn ?? ''}\n${text}`;
    if (this.foreignSeen.has(key)) return;
    this.foreignSeen.add(key);
    foreignParser ??= createUnbashParser();
    const tree = foreignParser.parse(text);
    this.visit(tree.root, { fn: w.fn, foreign: true }, tree.root);
  }

  /** What is left once the whole script is read: subscripts, integers, the values read as arithmetic, callbacks. */
  private finish(): void {
    for (const s of this.subscripts) {
      if (s.owner && !this.associative.has(s.array) && !/^\s*(?:\d+|@|\*|\$\(\([^()]*\)\))\s*$/.test(s.text)) this.fails.add(s.owner);
      if (!this.associative.has(s.array)) this.arithText(s.text, s.where, s.owner);
      else if (s.owner) {
        const set = this.keys.get(s.owner) ?? new Set<string>();
        set.add(s.array);
        this.keys.set(s.owner, set);
      }
    }
    for (const name of this.integers) {
      for (const t of this.texts.get(name) ?? []) {
        if (t.text === undefined) this.blindFor('an integer variable is given text not known');
        else this.arithText(t.text, t.where, t.owner);
      }
    }
    // The values of the names read as arithmetic are run as expressions: each must be text the script wrote.
    const queue = [...this.arith];
    const seen = new Set(queue);
    while (queue.length) {
      const name = queue.pop()!;
      if (NUMERIC_DYNAMIC.test(name)) continue;
      const writes = this.writes.get(name);
      if (!writes) {
        this.blindFor(`arithmetic reads \`${name}\`, which the script never sets`);
        continue;
      }
      if (this.refUnknown.has(name)) this.blindFor(`arithmetic reads \`${name}\`, a nameref whose target is not known`);
      for (const w of writes) {
        if (w.value === 'unknown' && !w.nameref) this.blindFor(`arithmetic reads \`${name}\`, which may be set to text not known`);
        if (typeof w.value !== 'object') continue;
        for (const x of w.value.names) {
          if (!seen.has(x)) {
            seen.add(x);
            queue.push(x);
            this.arith.add(x);
          }
        }
      }
    }
    // A command named by a variable: each value the script gives it must be a command that changes nothing, or a
    // function (which runs where the walk does not see it).
    for (const { name, quoted } of this.commandVariables) {
      const writes = this.writes.get(name) ?? [];
      if (!writes.length || (!quoted && this.writes.has('IFS'))) this.blindFor('a command name not known');
      for (const w of writes) {
        const v = w.value;
        if (!w.plain || typeof v !== 'object' || !v.fixed || (!quoted && /[\s*?[]/.test(v.text))) this.blindFor('a command name not known');
        else if (this.functions.has(v.text)) this.callbacks.add(v.text);
        else if (builtins[v.text] && !SAFE_BUILTINS.has(v.text)) this.blindFor('a command name not known');
      }
    }
    // A nameref whose target is not known, assigned or unset: any variable may change.
    for (const r of this.refUnknown) if (this.writes.get(r)!.some((w) => !w.nameref)) this.blindFor('a nameref whose target is not known is assigned');
    // The functions a callback, a trap or a foreign text may run, and those they call.
    const reached = [...this.callbacks];
    const run = new Set(reached);
    while (reached.length) {
      for (const g of this.calls.get(reached.pop()!) ?? []) {
        if (!run.has(g)) {
          run.add(g);
          reached.push(g);
        }
      }
    }
    this.callbacks.clear();
    for (const f of run) this.callbacks.add(f);
    if (this.foreignChanges || [...run].some((f) => this.changes.has(f))) this.blindFor('a trap, a callback or a foreign text changes options, functions or aliases');
  }
}

const NO_HOST: ReadonlySet<string> = new Set();
const trusts = new WeakMap<SyntaxNode, Trust>();
/** The same, read to the end even when nothing is trusted: for the facts of its statements (`Walker.facts`). */
const factTrusts = new WeakMap<SyntaxNode, Trust>();

/**
 * The trust of the decisions over the script `root` (cached per tree, without a host). `stop`: the scan stops at the first reason to
 * trust nothing; off, it reads the whole tree, for the facts of its statements. `host`: the functions the file's host
 * defines (a bats file: `run`, `load`…), which the walk does not read: a call of one trusts nothing.
 */
export function scriptTrust(root: SyntaxNode, stop = true, host: readonly string[] = []): Trust {
  // (Not cached: the model that reads it is, per tree and host.)
  if (host.length) return readTrust(new Scan(root, true, new Set(host)));
  const cache = stop ? trusts : factTrusts;
  const hit = cache.get(root);
  if (hit) return hit;
  const trust = readTrust(new Scan(root, stop));
  cache.set(root, trust);
  return trust;
}

/** The trust a scan gives. */
function readTrust(scan: Scan): Trust {
  if (scan.stopped) return { ...BLIND, blind: scan.blind! };
  const unseen = new Set<string>();
  for (const [name, ws] of scan.writes) if (ws.some((w) => w.foreign || (w.fn !== undefined && scan.callbacks.has(w.fn)))) unseen.add(name);
  const trust: Trust = {
    blind: scan.blind,
    variable: (name) => !scan.blind && NAME.test(name) && !SPECIAL.test(name) && !DYNAMIC.test(name) && !scan.arith.has(name) && !unseen.has(name)
      && !scan.refTargets.has(name) && (scan.writes.get(name) ?? []).every((w) => w.plain),
    closed: (name) => !scan.blind && !scan.exportAll && !scan.exported.has(name) && !scan.callbacks.has(name),
    arithNames: (n) => {
      const names = scan.pending.get(n);
      return names && [...names];
    },
    associative: (n) => {
      const names = scan.keys.get(n);
      return names && [...names];
    },
    mayFail: (n) => scan.fails.has(n),
  };
  return trust;
}

/** Nothing trusted: for a walk that found, as it went, arithmetic reading text not known (see `Walker`). */
export const BLIND: Trust = { blind: 'arithmetic reads text not known', variable: () => false, closed: () => false, arithNames: () => undefined, associative: () => undefined, mayFail: () => false };

/**
 * What another shell's model trusts (`bash -c S`): its own script's trust, and no more than the outer model's, whose
 * values reach it (exported variables). Nothing, when the outer model trusts nothing.
 */
export function withinTrust(own: Trust, outer: Trust): Trust {
  if (outer.blind !== undefined) return { ...BLIND, blind: outer.blind };
  return { ...own, variable: (name) => own.variable(name) && outer.variable(name) };
}
