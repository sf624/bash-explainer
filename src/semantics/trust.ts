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
//   known, a command name not known (`$cmd`, `"$@"`), a file a function of the file's host runs (bats' `load`; the
//   others, `run`…, are read by their specs, as builtins: `shellState`'s `host`), a builtin given a variable name not known (`read "$v"`),
//   indirection (`${!v}`, `${!1}`: its subscript may assign), a DEBUG or RETURN trap, a trap's or a callback's function that changes options, functions
//   or aliases; and when arithmetic may read text not known (`$1`, `$(cmd)`, a variable `read` sets or that is never
//   set: bash runs it as an expression, which may assign any variable).
// - A function is closed (its decisions and dead code may be said, and src/semantics/env.ts says for sure where its
//   body runs) when every call of it is one the walk sees, in the script or in an `eval`'s string: not exported
//   (`export -f`, `set -a`), not named as an argument (`complete -F f`, `trap f INT`), not called from the text of a
//   trap (which runs at any time) or an alias (bash also expands an alias after one whose text ends with a blank,
//   which the walk does not follow, so the scan cannot tell which uses the walk sees: `trap g EXIT` may call `f`
//   through `g`), and nothing is blind.
//
// The walk runs the static strings of `eval` and of traps (4.13), and the aliases it expands (an alias's text with the
// rest of the command), and this scan reads the same trees (`StringTrees`: the model's), as foreign text (a trap's
// action runs at any time; what a string assigns is not trusted; the rest of a command is read where the command is).
// So the facts of statements (`arithNames`, `mayFail`, `associative`) are of every statement the walk runs. A string
// the walk does not read (an expansion in it, a glob, too deep) makes it walk again with nothing trusted
// (`Walker.found`), as does a trap's action that may leave what a signal interrupts.
// Another shell's model (`bash -c`) trusts no more than the model of the script that starts it (`withinTrust`).
import type { CommandSpec } from '../argv/spec';
import { prefixOf } from '../argv/words';
import { builtins } from '../dict/builtins';
import { staticWordValue, substitutionNames } from '../staticword';
import { field, fields, type SyntaxNode } from '../syntax/tree';
import { aliasName, aliasOf, builtinParse, callbacks, commandName, DECLARATIONS, setOptionWrites, variableWrites, wordName, wrapped } from './effects';
import { STATEMENTS } from './env';
import { alwaysNumeric, ARITH_ASSIGNED, assignsArithmetic, changedUnseen, optionRoles, readDeclaration, readDeclarationWords, type Declaration } from './vars';

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

/**
 * Where a node is: the function whose body holds it, whether it is in the text of an `eval`, a trap or an alias
 * (`foreign`), and whether the walk runs it where it stands (`now`: the script, or an `eval`'s string there, whose
 * calls are calls the walk sees; not a trap's action or an alias's text). In the tree of an alias expanded at a
 * command (`StringTrees.expansion`), what starts at `rest.at` is the rest of the command, where the command is.
 */
interface Where { fn: string | undefined; foreign: boolean; now: boolean; rest?: { at: number; where: Where } }

/**
 * How many trees of aliases expanded the scan reads from one command of the script (each alias in an alias's text
 * may double them there); the commands of the script are not counted together.
 */
const ALIAS_EXPANSIONS = 1000;
const NO_NAMES: ReadonlySet<string> = new Set();

const identifiers = (text: string): string[] => text.match(IDENTIFIERS) ?? [];

/**
 * Whether the expansion `n` is an indirection (`${!v}`, `${!1}`, `${!a[1]}`, `${!v@Q}`, `${!v:-x}`, `${!a[@]:-x}`): the
 * value it reads names the variable, and a subscript there is arithmetic, which may assign any variable. Not the keys
 * of an array (`${!a[@]}`) or the names with a prefix (`${!v@}`) with nothing after them, nor a special parameter
 * whose value is a number or the option letters (`${!#}`, `${!?}`, `${!-}`); `${!@}` and `${!*}` take `$1`'s value.
 */
function indirect(n: SyntaxNode): boolean {
  const kids = n.children;
  if (kids[1]?.type !== '!') return false;
  // (`${!}` is `$!`, with no `!` token; in `${!:-x}`, `!` is the name and `x` the operand.)
  const name = kids[2];
  const after = kids.slice(3).filter((c) => c.type !== '}').map((c) => c.type).join(' ');
  switch (name?.type) {
    case 'subscript': return !(['@', '*'].includes(field(name, 'index')!.text) && after === '');
    case 'special_variable_name': return name.text === '@' || name.text === '*';
    case 'variable_name': return after !== '@' && after !== '*';
  }
  return false;
}

/** The values of several words given in turn (a list of `for`, the elements of an array). */
const joined = (values: Value[]): Value =>
  (values.every((v): v is Extract<Value, object> => typeof v === 'object') ? { names: values.flatMap((v) => v.names), text: '' } : 'unknown');

/** An alias an `alias` command defines: its name and text, the word that gives them, and where the command is. */
interface AliasDef { name: string; value: string; word: SyntaxNode; where: Where }

/** Thrown when the scan finds that nothing is trusted (see `Scan.blindFor`). */
class StopScan {}

class Scan {
  readonly writes = new Map<string, Write[]>();
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
  /** Whether the script runs `alias` or `enable`, which may make `$(true)` print something (see `value`). */
  private renames = false;
  /** The functions each function calls ('' : the top level), and those run otherwise than by a plain call. */
  readonly calls = new Map<string, Set<string>>();
  readonly callbacks = new Set<string>();
  /** Where options, functions or aliases change: by function ('' : the top level), and in foreign text. */
  readonly changes = new Set<string>();
  foreignChanges = false;
  blind: string | undefined;
  /** The variables whose values are command names (`$debug`), and whether they are quoted (not split). */
  private readonly commandVariables: { name: string; quoted: boolean }[] = [];
  /** The aliases the `alias` commands define (a name and its text), and the commands that may run one (see `aliases`). */
  private readonly aliasDefs: AliasDef[] = [];
  private readonly aliasCommands: { c: SyntaxNode; name: string; where: Where }[] = [];
  /** The aliases each tree of an alias expanded at a command comes from (bash does not expand an alias in itself). */
  private readonly expanding = new Map<SyntaxNode, ReadonlySet<string>>();

  constructor(root: SyntaxNode, private readonly strings: StringTrees, private readonly host: HostCommands) {
    const defs = (n: SyntaxNode): void => {
      if (n.type === 'function_definition') this.functions.add(field(n, 'name')!.text);
      if (n.type === 'command' && ['alias', 'enable'].includes(commandName(n) ?? '')) this.renames = true;
      n.children.forEach(defs);
    };
    defs(root);
    try {
      this.visit(root, { fn: undefined, foreign: false, now: true });
      this.aliases();
      this.finish();
    } catch (e) {
      /* c8 ignore next -- only `StopScan` is thrown on purpose */
      if (!(e instanceof StopScan)) throw e;
    }
  }

  /** Nothing is trusted, for `why`: the scan stops there (`StopScan`), since nothing it finds after would count. */
  private blindFor(why: string): never {
    this.blind = why;
    throw new StopScan();
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

  /** The statement that runs `n`: of the script, or of a string it runs (the walk runs the same tree, `StringTrees`). */
  private owner(n: SyntaxNode): SyntaxNode | undefined {
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
    // (`$(true)` prints nothing only when `true` is the builtin: not when the script defines a function or an alias of it.)
    const s = substitutionNames(v).some((x) => this.renames || this.functions.has(x)) ? undefined : staticWordValue(v, true);
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
    list.push({ text, owner: this.owner(n), where: w });
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
    // (An unset gives no text to read as arithmetic.)
    if (value !== 'none') this.assigned(m[1], undefined, word, w);
    if (m[2] !== undefined) this.subscripts.push({ array: m[1], text: m[2], owner: this.owner(word), where: w });
  }

  private visit(n: SyntaxNode, w: Where): void {
    if (w.rest && n.startIndex >= w.rest.at) w = w.rest.where;
    switch (n.type) {
      case 'function_definition': {
        this.changed(w);
        const name = field(n, 'name')!.text;
        for (const c of n.children) this.visit(c, { ...w, fn: w.foreign ? w.fn : name });
        if (w.foreign) this.callbacks.add(name);
        return;
      }
      case 'arithmetic_expansion': case 'arithmetic_command':
        // (Run by the walk: its reads are checked there.)
        this.arithText(n.type === 'arithmetic_command' ? n.namedChildren.map((c) => c.text).join(' ') : n.text, w);
        return;
      case 'c_style_for_statement':
        for (const f of ['initializer', 'condition', 'update'] as const) for (const c of fields(n, f)) this.arithText(c.text, w);
        for (const c of n.children) if (c.field === 'body') this.visit(c, w);
        return;
      case 'subscript': {
        const index = field(n, 'index');
        if (index) this.subscripts.push({ array: field(n, 'name')!.text, text: index.text, owner: this.owner(n), where: w });
        break;
      }
      case 'expansion': {
        const name = n.namedChildren[0];
        const ops = n.children.filter((c) => !c.named).map((c) => c.type);
        if (indirect(n)) this.blindFor('indirect expansion');
        if (name?.type === 'variable_name' && (ops.includes(':=') || ops.includes('='))) {
          const word = n.namedChildren[n.namedChildren.length - 1];
          this.write(name.text, w, false, word === name ? { names: [], text: '' } : this.value(word));
          this.assigned(name.text, undefined, n, w);
        }
        // `${x:offset:length}`: arithmetic, the text after the first `:` (an operator of its own, not `:-`).
        const colon = n.children.find((c) => c.type === ':' && c.field === 'operator');
        if (colon) {
          const end = n.children[n.children.length - 1];
          const text = n.text.slice(colon.endIndex - n.startIndex, (end.type === '}' ? end.startIndex : n.endIndex) - n.startIndex);
          const owner = this.owner(n);
          this.arithText(text, w, owner);
          if (owner && !/^\s*-?\d+\s*(?::\s*\d+\s*)?$/.test(text)) this.fails.add(owner);
        }
        break;
      }
      case 'binary_expression': {
        const op = field(n, 'operator')?.text;
        if (op && ['-eq', '-ne', '-lt', '-le', '-gt', '-ge'].includes(op) && n.parent && this.inExtendedTest(n)) {
          for (const side of [field(n, 'left'), field(n, 'right')]) if (side) this.arithText(side.text, w, this.owner(n));
        }
        break;
      }
      case 'unary_expression':
        if (field(n, 'operator')?.text === '-v') for (const c of n.namedChildren.slice(1)) this.testV(c, w);
        break;
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
      case 'command':
        this.command(n, w);
        break;
    }
    for (const c of n.children) this.visit(c, w);
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
    if (m) this.subscripts.push({ array: m[1], text: m[2], owner: this.owner(word), where: w });
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
        if (key !== undefined && !associative) this.subscripts.push({ array: name, text: key, owner: this.owner(a), where: w });
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
            if (m[2] !== undefined) this.subscripts.push({ array: m[1], text: m[2], owner: this.owner(o), where: w });
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
        if (m[2]) this.subscripts.push({ array: name, text: m[2].slice(1, -1), owner: this.owner(o), where: w });
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

  /**
   * The command name of `c` and its words, past `command` and `builtin` (undefined: not known); `lookup`: `command -v`;
   * `direct`: not behind them (so it may be a function).
   */
  private nameOf(c: SyntaxNode): { name: string | undefined; args: SyntaxNode[]; lookup: boolean; direct: boolean } {
    let name = commandName(c);
    let args = fields(c, 'argument');
    let direct = true;
    while (name === 'command' || name === 'builtin') {
      const inner = wrapped(name, args);
      if ('lookup' in inner) return { name, args, lookup: true, direct };
      ({ name, args } = inner);
      direct = false;
    }
    return { name, args, lookup: false, direct };
  }

  private command(c: SyntaxNode, w: Where): void {
    const alias = aliasName(c);
    if (alias !== undefined) this.aliasCommands.push({ c, name: alias, where: w });
    const { name, args, lookup, direct } = this.nameOf(c);
    if (name === undefined) {
      // `$debug`, `"$run"`: a variable the script sets to command names (see `finish`).
      const m = /^("?)\$\{?([A-Za-z_]\w*)\}?\1$/.exec(field(c, 'name')!.namedChildren[0].text);
      if (m) this.commandVariables.push({ name: m[2], quoted: !!m[1] });
      else this.blindFor('a command name not known');
      return;
    }
    if (this.functions.has(name)) {
      if (!w.now) this.callbacks.add(name);
      else {
        const set = this.calls.get(w.fn ?? '') ?? new Set<string>();
        set.add(name);
        this.calls.set(w.fn ?? '', set);
      }
    }
    // A function named as an argument may be run by the command (`complete -F f`, `mapfile -C f`, `trap f INT`).
    // (`eval`'s words are read as its string, below: a name there is a call.)
    const refs = !lookup && !['unset', 'type', 'eval'].includes(name) && !DECLARATIONS.has(name);
    if (refs) for (const a of args) if (this.functions.has(staticWordValue(a) ?? '')) this.callbacks.add(staticWordValue(a)!);
    // (A function the host file defines, bats' `run`, is read by its spec as a builtin, unless the script defines its own.)
    const hosted = direct && !this.functions.has(name) && Object.hasOwn(this.host, name) ? this.host[name] : undefined;
    const spec = hosted ?? builtins[name];
    if (lookup || !spec) return;
    if (spec.shellEffect?.alters) this.changed(w);
    const unread = spec.shellEffect?.runsUnread;
    if (unread) {
      this.blindFor(unread === 'file' ? 'a file is sourced' : 'a command line the model does not read is run');
    }
    const parse = builtinParse(name, args, spec);
    // The variables it sets, and the functions it runs later, as its spec says (src/semantics/effects.ts).
    for (const v of variableWrites(spec, parse, args)) {
      if (v.node) this.named(v.name, v.node, w, v.sets === 'job-id' ? 'number' : 'unknown');
      else this.write(v.name!, w, false, 'unknown');
    }
    for (const f of callbacks(parse, args)) this.callback(f);
    if (hosted) return;
    switch (name) {
      case 'eval': {
        // (The string is the words of its command slot, as the walk reads it: `WalkBuiltins.builtin`.)
        const at = parse.roles.find((r) => r.role.role === 'command');
        if (at) this.foreign(this.strings.script(args.slice(at.word)), 'eval of text not known', w, true);
        return;
      }
      case 'trap': {
        // (Its action is the word of the slot that runs it later; the signals are its operands.)
        const at = parse.roles.find((r) => r.role.role === 'command');
        if (!at || ['', '-'].includes(staticWordValue(args[at.word])!)) return;
        const root = this.strings.script([args[at.word]]);
        const signals = parse.roles.filter((r) => r.role.role === 'operand').map((r) => staticWordValue(args[r.word]));
        if (root && signals.some((s) => s === undefined || /^(?:SIG)?(?:DEBUG|RETURN)$/i.test(s))) this.blindFor('a DEBUG or RETURN trap');
        else this.foreign(root, 'a trap of text not known', w);
        return;
      }
      case 'alias':
        for (const a of args) {
          // (Read where commands may run it: see `aliases`. One the walk does not take, by its name: its text alone.)
          const v = staticWordValue(a);
          const def = v === undefined ? undefined : aliasOf(a);
          const m = v === undefined ? null : /^[^=]+=([\s\S]*)$/.exec(v);
          if (def) this.aliasDefs.push({ ...def, word: a, where: w });
          else if (m) this.foreign(this.strings.alias(a, m[1]), 'an alias of text not known', w);
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

  /**
   * The tree of an `eval`'s string, a trap's action or an alias's text: read as part of the script, run from
   * elsewhere (`now`: where it stands, an `eval`'s). None: its text is not known, for `why`.
   */
  private foreign(root: SyntaxNode | undefined, why: string, w: Where, now = false): void {
    if (!root) this.blindFor(why);
    this.visit(root, { fn: w.fn, foreign: true, now: now && w.now });
  }

  /**
   * The aliases, read where the walk may run them: at each command named like an alias the script defines, the tree of
   * each text the alias may have there with the rest of the command (the walk's: `StringTrees.expansion`), with the
   * commands in it in turn, but not in an alias it comes from. Its text is foreign (bash also expands an alias after
   * one whose text ends with a blank, which the walk does not follow), and the rest of the command is read where the
   * command is, now as part of that tree: the facts of its statements are the walk's. An alias no command names is
   * read alone, as foreign text.
   */
  private aliases(): void {
    const read = new Set<AliasDef>();
    const done = new Map<SyntaxNode, Set<string>>();
    // (The command of the script each tree comes from, and how many trees each such command has.)
    const origin = new Map<SyntaxNode, SyntaxNode>();
    const counts = new Map<SyntaxNode, number>();
    for (let more = true; more;) {
      more = false;
      // (The trees read add commands and definitions to both lists.)
      for (let i = 0; i < this.aliasCommands.length; i++) {
        const { c, name, where } = this.aliasCommands[i];
        let root = c;
        while (root.parent) root = root.parent;
        const from = this.expanding.get(root) ?? NO_NAMES;
        if (from.has(name)) continue;
        const top = origin.get(root) ?? c;
        const texts = done.get(c) ?? new Set<string>();
        done.set(c, texts);
        for (const d of this.aliasDefs) {
          if (d.name !== name || texts.has(d.value)) continue;
          const count = (counts.get(top) ?? 0) + 1;
          if (count > ALIAS_EXPANSIONS) this.blindFor('too many aliases expanded in aliases');
          counts.set(top, count);
          texts.add(d.value);
          read.add(d);
          more = true;
          const tree = this.strings.expansion(c, d.value);
          if (this.strings.capped) this.blindFor('too many aliases expanded');
          this.expanding.set(tree, new Set([...from, name]));
          origin.set(tree, top);
          // (A command in an alias's text is foreign: so is the rest of it, in the tree of an alias expanded there.)
          const { rest: _, ...outer } = where;
          this.visit(tree, { fn: where.fn, foreign: true, now: false, rest: { at: d.value.length, where: outer } });
        }
      }
    }
    for (const d of this.aliasDefs) if (!read.has(d)) this.foreign(this.strings.alias(d.word, d.value), 'an alias of text not known', d.where);
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
    // (Also those of bash's integers that read it so, `OPTIND='x=5'` sets x: src/semantics/vars.ts.)
    for (const name of new Set([...this.integers, ...[...this.texts.keys()].filter(assignsArithmetic)])) {
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
      if (alwaysNumeric(name)) continue;
      const writes = this.writes.get(name);
      if (!writes) {
        this.blindFor(`arithmetic reads \`${name}\`, which the script never sets`);
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

/** The functions a file's host defines (bats' `run`, `load`…), by name, with their specs (src/dict/bats.ts). */
export type HostCommands = Readonly<Record<string, CommandSpec>>;
export const NO_HOST: HostCommands = {};

/**
 * The trees of the strings the scan reads as part of the script: those of the model (`Scripts` in
 * src/semantics/state.ts), whose walk runs them. So each string is parsed once, and the facts of its statements are
 * the scan's.
 */
export interface StringTrees {
  /** The root of the string that `words` make (`eval a b`, a trap's action); undefined when its text is not known. */
  script(words: readonly SyntaxNode[]): SyntaxNode | undefined;
  /** The root of `text`, the value the word `word` of `alias` gives, read alone (for an alias no command names). */
  alias(word: SyntaxNode, text: string): SyntaxNode;
  /**
   * The root of the alias text `text` with the rest of the simple command `command`: the tree the walk runs where it
   * expands the alias there. Past the trees a model makes one per command (`ALIAS_TREES`), a tree shared by the
   * commands of the same text, and `capped` is set.
   */
  expansion(command: SyntaxNode, text: string): SyntaxNode;
  readonly capped: boolean;
}

/**
 * The trust of the decisions of a model over the script `root`, whose strings have the trees `strings` gives (once
 * per model: the trees are the model's). The scan stops at the first reason to trust nothing. `host`: the functions
 * the file's host defines (a bats file: `run`, `load`…), read by their specs.
 */
export function scriptTrust(root: SyntaxNode, strings: StringTrees, host = NO_HOST): Trust {
  const scan = new Scan(root, strings, host);
  if (scan.blind) return { ...BLIND, blind: scan.blind };
  const unseen = new Set<string>();
  for (const [name, ws] of scan.writes) if (ws.some((w) => w.foreign || (w.fn !== undefined && scan.callbacks.has(w.fn)))) unseen.add(name);
  return {
    blind: undefined,
    variable: (name) => NAME.test(name) && !changedUnseen(name) && !scan.arith.has(name) && !unseen.has(name)
      && !scan.refTargets.has(name) && (scan.writes.get(name) ?? []).every((w) => w.plain),
    closed: (name) => !scan.exportAll && !scan.exported.has(name) && !scan.callbacks.has(name),
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
