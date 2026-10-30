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
// - Nothing is trusted (`blind`) when the script holds a construct whose row in the allow-list (src/semantics/allow.ts;
//   docs/design/trust-allow-list.md) is `all`, or one the table does not have: what the walk does not follow, or the
//   scan cannot read (`source`, `eval` or `trap` of text not known, a command name not known, indirection, an option
//   of `set` or `shopt` the walk does not follow, a variable of bash such as `BASH_COMPAT`, a parse error…). A
//   `followed` row has a handler here, which checks its precondition (a nameref's target, `-v` of a name not known,
//   `${x@P}` of a value that may run code, a PS4 that may, a locale other than C), and arithmetic must not read text
//   not known (`$1`, `$(cmd)`, a variable `read` sets: bash runs it as an expression, which may assign any variable).
// - A word of a builtin whose fields may change what it sets (`x=-v; printf $x u 2`) is read as the fields of every
//   value bash may give it, where the scan can list them; where it cannot (`read x`, `$1`), as written, and the walk
//   trusts nothing where it runs the builtin with fields that give what no reading gave (src/semantics/deferred.ts).
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
import type { Shell } from '../dialect';
import { prefixOf } from '../argv/words';
import { builtins } from '../dict/builtins';
import { staticWordValue } from '../staticword';
import type { BashVersion } from '../bashversion';
import { field, fields, substitutionForm, type SyntaxNode } from '../syntax/tree';
import type { CommandSpec } from '../argv/spec';
import { bracedWords } from './brace';
import { BUILTINS, builtinRow, expansionRow, indirect, optionRow, quietPrompt, redirectionRow, SET_OPTIONS, SHOPT_OPTIONS, syntaxRow, type Row } from './allow';
import { plainName, aliasOf, aliasTexts, builtinParse, builtinRead, callbacks, commandName, commandWords, DECLARATIONS, setOptionWrites, variableWrites, wordName } from './effects';
import { type Deferred, type DeferredPlan, deferredReadings, unknownWords } from './deferred';
import { STATEMENTS } from './env';
import { localeWritten, openingBlinds, type Opening } from './opening';
import { closesStandard } from './redirects';
import { inExtendedTest, testSplits, testWordShape } from './testwords';
import { BLIND, type HostCommands, NO_HOST, type StringTrees, type Trust } from './trustmodel';
import { COPY, identifiers, joined, writtenValue } from './written';
import { ARITH_ASSIGNED, assignsArithmetic, changedUnseen, localeVariable, optionRoles, readDeclarationWords, writeEffect, type Declaration } from './vars';
import { arithReads, commandNames, promptReads, ps4Writes, valuesWritten, type Value, type Write } from './writechecks';

export { BLIND, type HostCommands, NO_HOST, type StringTrees, type Trust, withinTrust } from './trustmodel';

const NAME = /^[A-Za-z_]\w*$/;
/** A `${…}` that arithmetic may paste: a value, an element, a length, or a default (`${x:-0}`). */
const PASTE = /^\$\{#?[A-Za-z_]\w*(?:\[[^\]]*\])?(?::?-[^{}$`'"]*)?\}/;

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
/** How many texts of one alias with the aliases after it (6.6: a text ending with a blank) the scan reads at one command. */
const ALIAS_NEXT = 64;
const NO_NAMES: ReadonlySet<string> = new Set();


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
  /** The variables the script expands, or tests with `-v` (a nameref's target, read through it, may have a subscript). */
  private readonly reads = new Set<string>();
  /** The variables expanded as prompts (`${x@P}`), whose values bash expands again. */
  private readonly prompts = new Set<string>();
  readonly exported = new Set<string>();
  exportAll = false;
  /** Whether the script may close fd 0, 1 or 2 (see `Trust.fdsMayClose`). */
  fdsClose = false;
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
  /** The names each nameref declaration refers to (`declare -n a=b`): a nameref that refers to one in `refUnknown` is in it too. */
  private readonly refEdges = new Map<string, Set<string>>();
  /**
   * The variables expanded unquoted in a word of `test` or `[` (`[ $x = y ]`), and whether such a word is a number
   * (`$#`): no word of their values may be `-v` (see `testWords`); with the statements that split them.
   */
  private readonly testSplits: { name: string; owner: SyntaxNode }[] = [];
  private testNumbers = false;
  /** The assignments that copy a variable (`IFS=$save`), and the statements where those that IFS takes are checked. */
  private readonly copies: { owner: SyntaxNode; target: string; source: string }[] = [];
  readonly copied = new Map<SyntaxNode, Set<string>>();
  /** The variables whose values are command names (`$debug`), and whether they are quoted (not split). */
  private readonly commandVariables: { name: string; quoted: boolean }[] = [];
  /** The builtins given words whose values are not known where the scan reads them (`unknownWords`), read at the end. */
  private readonly deferred: Deferred<Where>[] = [];
  /** What the scan read of those words, by word (see `Trust.deferred`), and where each such builtin is. */
  readonly plans = new Map<SyntaxNode, DeferredPlan>();
  private readonly planned: Where[] = [];
  /** The aliases the `alias` commands define (a name and its text), and the commands that may run one (see `aliases`). */
  private readonly aliasDefs: AliasDef[] = [];
  private readonly aliasCommands: { c: SyntaxNode; name: string; where: Where }[] = [];
  /** The aliases each tree of an alias expanded at a command comes from (bash does not expand an alias in itself). */
  private readonly expanding = new Map<SyntaxNode, ReadonlySet<string>>();

  constructor(root: SyntaxNode, private readonly strings: StringTrees, private readonly host: HostCommands, opening: Opening | undefined, private readonly shell: Shell | undefined, private readonly version: BashVersion | undefined, private readonly posix: boolean) {
    const defs = (n: SyntaxNode): void => {
      if (n.type === 'function_definition') this.functions.add(field(n, 'name')!.text);
      if (n.type === 'command' && ['alias', 'enable'].includes(commandName(n) ?? '')) this.renames = true;
      n.children.forEach(defs);
    };
    defs(root);
    try {
      // (What the shebang starts bash with, as if set on the first line: `#!/bin/bash -a` exports the functions, as
      // `set -a` does.)
      const why = opening && openingBlinds(opening);
      if (why) this.blindFor(why);
      if (opening?.set?.get('allexport') === 'on') this.exportAll = true;
      this.visit(root, { fn: undefined, foreign: false, now: true });
      this.aliases();
      this.readDeferred();
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

  /**
   * The effect of a construct, by its row of the allow-list (src/semantics/allow.ts): `all` trusts nothing; whether the
   * scan reads it further (its handler), which `none` does not.
   */
  private apply(row: Row): boolean {
    if (row.effect.kind === 'all') this.blindFor(row.effect.why);
    return row.effect.kind !== 'none';
  }

  /** `program`: a prefix assignment of a program (`LANG=de_DE.UTF-8 sort`), which changes its environment only. */
  private write(name: string, w: Where, plain: boolean, value: Value, nameref = false, program = false): void {
    if (!program) this.variableRow(name, value);
    const list = this.writes.get(name) ?? [];
    list.push({ plain, value, fn: w.fn, foreign: w.foreign, ...(nameref ? { nameref } : {}) });
    this.writes.set(name, list);
  }

  /**
   * What a write of `value` to the variable `name` does to bash, by its row: a locale other than C trusts nothing.
   * Unsetting BASH_XTRACEFD, or making it empty, closes the fd it named, which may be 1 or 2.
   */
  private variableRow(name: string, value: Value): void {
    if (!localeVariable(name)) this.apply(writeEffect(name));
    else if (!localeWritten(value)) this.blindFor(`\`${name}\` may be set to a locale other than C`);
    if (name === 'BASH_XTRACEFD') this.fdsClose = true;
  }

  private changed(w: Where): void {
    if (w.foreign) this.foreignChanges = true;
    else this.changes.add(w.fn ?? '');
  }

  /** The statement that runs `n`: of the script, or of a string it runs (the walk runs the same tree, `StringTrees`). */
  private owner(n: SyntaxNode): SyntaxNode | undefined {
    // (An assignment is run with its command.)
    for (let x: SyntaxNode | null = n; x; x = x.parent) if (STATEMENTS.has(x.type)) return x;
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

  /** What the word `v` assigns (`writtenValue`). */
  private value(v: SyntaxNode | undefined): Value {
    return writtenValue(v, (x) => this.renames || this.functions.has(x), this.shell);
  }

  /** Records the text assigned to `name` (read as arithmetic if it is an integer). */
  private assigned(name: string, text: string | undefined, n: SyntaxNode, w: Where): void {
    const list = this.texts.get(name) ?? [];
    list.push({ text, owner: this.owner(n), where: w });
    this.texts.set(name, list);
  }

  /**
   * `n+=w`, just written: an integer adds to the value `n` had, read as arithmetic (one from the environment runs as an
   * expression: `declare -i n+=1` with `n='u=2'` sets `u`).
   */
  private appended(name: string, n: SyntaxNode, w: Where): void {
    if (localeVariable(name)) this.blindFor(`\`${name}\` may be set to a locale other than C`);
    this.writes.get(name)!.at(-1)!.append = true;
    this.assigned(name, name, n, w);
  }

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
    // Each node by the row of its type: what changes nothing has no handler (its parts are read in turn).
    if (n.named && !this.apply(syntaxRow(n.type))) {
      for (const c of n.children) this.visit(c, w);
      return;
    }
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
      case 'command_substitution':
        // (The walk follows a `${ …; }` as bash 5.3 runs it; bash 5.2 stops at it, "bad substitution": docs/design/bash-versions.md, 4.2.)
        if (this.version !== '5.3' && substitutionForm(n).startsWith('${')) this.blindFor('a `${ …; }` substitution, which bash 5.2 rejects ("bad substitution"): the walk follows it only as bash 5.3 runs it');
        break;
      case 'subscript': {
        const index = field(n, 'index');
        if (index) this.subscripts.push({ array: field(n, 'name')!.text, text: index.text, owner: this.owner(n), where: w });
        break;
      }
      case 'simple_expansion':
        if (n.namedChildren[0]?.type === 'variable_name') this.reads.add(n.namedChildren[0].text);
        break;
      case 'expansion': {
        this.apply(expansionRow(n));
        const name = n.namedChildren[0];
        const ops = n.children.filter((c) => !c.named).map((c) => c.type);
        if (indirect(n)) this.blindFor('indirect expansion');
        const read = name?.type === 'subscript' ? field(name, 'name')!.text : name?.text;
        if (read !== undefined) this.reads.add(read);
        // `${x@P}`: the value is expanded as a prompt, which may run `$(( ))` and `$( )` in it (see `finish`).
        if (ops.join(' ').includes('@ P')) {
          if (read === undefined || !NAME.test(read)) this.blindFor('a prompt expansion (`@P`) of a value not known');
          this.prompts.add(read);
        }
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
        if (op && ['-eq', '-ne', '-lt', '-le', '-gt', '-ge'].includes(op) && n.parent && inExtendedTest(n)) {
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
        this.apply(redirectionRow(n));
        // (`{fd}>f` sets `fd`; `{a[i]}>f` sets an element of `a`, and `i` is arithmetic.)
        const fd = /^\{([A-Za-z_]\w*)(?:\[(.*)\])?\}$/s.exec(field(n, 'descriptor')?.text ?? '');
        if (fd) this.write(fd[1], w, false, 'number');
        if (fd?.[2] !== undefined) this.subscripts.push({ array: fd[1], text: fd[2], owner: this.owner(n), where: w });
        if (closesStandard(n)) this.fdsClose = true;
        break;
      }
      case 'variable_assignment':
        // (Those of a declaration are read with it.)
        if (n.field !== 'argument') this.assignment(n, w, true, false, n.parent!.type === 'command' && this.program(n.parent!));
        break;
      case 'command':
        // (A command with no name has only its assignments, read above.)
        if (field(n, 'name')) this.command(n, w);
        break;
    }
    for (const c of n.children) this.visit(c, w);
  }

  private refEdge(name: string, target: string): void {
    const set = this.refEdges.get(name) ?? new Set<string>();
    set.add(target);
    this.refEdges.set(name, set);
  }

  /**
   * The words of `test` or `[` (`]` left out). `-v name` reads a variable (`testV`). Which word is an operator is
   * decided when the command runs, from the words expansion gives: a word not known may be `-v` itself, and then the
   * word after it is its operand (`[ "$1" "$2" ]` with `-v` and `a[u=2]`); a word that splits or globs gives words
   * not known, at places not known (`test "$@"`, `[ $x ]`). `[[ ]]` reads its operators before expansion.
   */
  private testWords(words: SyntaxNode[], w: Where): void {
    words.forEach((a, i) => {
      const next = words[i + 1] as SyntaxNode | undefined;
      const v = staticWordValue(a);
      if (v !== undefined) {
        if (v === '-v' && next) this.testV(next, w);
        return;
      }
      const shape = testWordShape(a);
      if (shape === 'split') this.blindFor('`-v` may test a variable name not known');
      if (shape === 'number') {
        this.testNumbers = true;
        return;
      }
      if (typeof shape === 'object') {
        this.testSplits.push({ name: shape.variable, owner: this.owner(a)! });
        return;
      }
      // (A word that starts with text other than `-` is never `-v`: `"x$1"`, `/tmp/*`.)
      const lead = /^[^-$`"'*?[\\{~]/.test(a.text);
      if (lead) return;
      if (shape === 'glob' || (next && staticWordValue(next) === undefined)) this.blindFor('`-v` may test a variable name not known');
      if (next) this.testV(next, w);
    });
  }

  /**
   * The operand of `-v` (`[[ -v a[i] ]]`): its subscript is arithmetic. A name not known (`[ -v "$1" ]`) may have a
   * subscript that assigns any variable (`-v 'a[u=2]'`).
   */
  private testV(word: SyntaxNode, w: Where): void {
    const text = staticWordValue(word) ?? word.text;
    const m = /^([A-Za-z_]\w*)(?:\[(.*)\])?$/s.exec(text);
    if (!m) {
      if (staticWordValue(word) === undefined) this.blindFor('`-v` tests a variable name not known');
      return;
    }
    this.reads.add(m[1]);
    if (m[2] !== undefined) this.subscripts.push({ array: m[1], text: m[2], owner: this.owner(word), where: w });
  }

  /**
   * `x=w`, `x+=w`, `a[i]=w`, `a=(…)`: `plain` unless it is in a declaration that gives attributes; `associative`: in
   * `declare -A`, whose keys are not arithmetic.
   */
  private assignment(a: SyntaxNode, w: Where, plain: boolean, associative = false, program = false): void {
    const nameNode = field(a, 'name')!;
    const value = field(a, 'value');
    const subscript = nameNode.type === 'subscript';
    const name = subscript ? field(nameNode, 'name')!.text : nameNode.text;
    if (value?.type === 'array') {
      this.write(name, w, false, joined(value.namedChildren.map((e) => this.value(e))), false, program);
      for (const e of value.namedChildren) {
        // (`a=([i]=x)`: `[i]` is a subscript.)
        const key = /^\[([^\]]*)\]\+?=/.exec(e.text)?.[1];
        if (key !== undefined && !associative) this.subscripts.push({ array: name, text: key, owner: this.owner(a), where: w });
      }
      this.assigned(name, undefined, a, w);
      return;
    }
    const v = this.value(value);
    // (A copy, `save=$IFS`, `IFS=$save`: see `testSplits`.)
    const copy = typeof v === 'object' && !subscript ? COPY.exec(v.text)?.[1] : undefined;
    if (copy) this.copies.push({ owner: this.owner(a)!, target: name, source: copy });
    this.write(name, w, plain && !subscript, v, false, program);
    this.assigned(name, value ? value.text : '', a, w);
    if (!subscript && a.children.some((c) => c.type === '+=')) this.appended(name, a, w);
  }

  private declaration(builtin: string, { words, on, off }: Declaration, w: Where): void {
    if (on.includes('p')) return;
    // (A field of a word, `x='a b'; declare $x`, is text of its own: `a`, then `b`.)
    const operands = words.filter((d) => d.role.role === 'operand');
    if (/[fF]/.test(on)) {
      // (`declare -f f` prints it; `export -f`, `declare -fx` export it, and a name not known may be any.)
      if ((builtin !== 'export' || on.includes('n')) && !on.includes('x')) return;
      for (const { node: o, field: f } of operands) {
        const name = f ?? staticWordValue(o);
        if (name === undefined) this.exportAll = true;
        else this.exported.add(name);
      }
      return;
    }
    const unknownOption = words.some((d) => d.role.role === 'unknown-option');
    const plain = !unknownOption && [...on].every((l) => 'rxg'.includes(l)) && [...off].every((l) => l === 'x') && !(builtin === 'export' && on.includes('n'));
    // (Attributes given where the walk does not see them change what assignments do: readonly ones fail, integer
    // ones run their values.)
    if (builtin === 'readonly' || unknownOption || [...on, ...off].some((l) => !'xg'.includes(l))) this.changed(w);
    const nameref = on.includes('n') && builtin !== 'export';
    for (const { node: o, field: f } of operands) {
      let name: string;
      if (f === undefined && o.type === 'variable_assignment') {
        const nameNode = field(o, 'name')!;
        name = nameNode.type === 'subscript' ? field(nameNode, 'name')!.text : nameNode.text;
        if (nameref) {
          const target = field(o, 'value') && staticWordValue(field(o, 'value')!, true);
          const m = target === undefined ? null : /^([A-Za-z_]\w*)(?:\[(.*)\])?$/s.exec(target);
          if (m) {
            this.refTargets.add(m[1]);
            this.refEdge(name, m[1]);
            if (m[2] !== undefined) this.subscripts.push({ array: m[1], text: m[2], owner: this.owner(o), where: w });
          } else this.refUnknown.add(name);
          this.write(name, w, false, 'unknown', true);
          continue;
        }
        this.assignment(o, w, plain, on.includes('A'));
      } else {
        // A word: `x`, `a[1]` (a glob that matches no file, as the walk takes it), `'x=1'`, `"$v"=1` (a name with a value
        // not known), `$v` (a name not known), `{a,b}` (names the braces give where they expand).
        const text = f ?? staticWordValue(o, false, this.shell) ?? (o.type === 'word' && !bracedWords([o]).length ? o.text : undefined);
        const m = /^([A-Za-z_]\w*)(\[.*?\])?(?:(\+?=)(.*))?$/s.exec(text ?? prefixOf(o, this.shell).replace(/=.*/s, '='));
        if (!m || (text === undefined && !m[3])) {
          // (`local -`: the options, not a variable.)
          if (text === undefined) this.blindFor('a declaration names a variable not known');
          continue;
        }
        name = m[1];
        if (m[2]) this.subscripts.push({ array: name, text: m[2].slice(1, -1), owner: this.owner(o), where: w });
        if (nameref) {
          const target = m[3] && text !== undefined ? m[4] : undefined;
          if (target !== undefined && NAME.test(target)) {
            this.refTargets.add(target);
            this.refEdge(name, target);
          } else this.refUnknown.add(name);
          this.write(name, w, false, 'unknown', true);
          continue;
        }
        if (m[3]) {
          const value: Value = text === undefined ? 'unknown' : { names: identifiers(m[4]), text: m[4], fixed: true };
          this.write(name, w, plain && !m[2], value);
          this.assigned(name, text === undefined ? undefined : m[4], o, w);
          if (m[3] === '+=' && !m[2]) this.appended(name, o, w);
        } else if (!(builtin === 'export' || builtin === 'readonly') || !plain) {
          // (`local x`, `declare x` in a function: a new variable, with no value; `export x` and `readonly x` change no
          // value. Outside a function, or with -g or -I, `declare x` keeps the value it had, maybe one from the environment:
          // `declare n; (( n ))` runs `n='y=5'` from there. A trap's action may run in any function, or none.)
          // (`declare -I x` makes the local variable start with the value of the one it hides.)
          const local = w.fn !== undefined && (!w.foreign || w.now) && !on.includes('g') && !on.includes('I') && builtin !== 'export' && builtin !== 'readonly';
          this.write(name, w, false, local ? 'none' : 'kept');
        }
      }
      if (on.includes('i')) this.integers.add(name);
      if (on.includes('A')) this.associative.add(name);
    }
  }

  private unset(words: SyntaxNode[], w: Where): void {
    const parse = builtinParse('unset', words, this.shell);
    const flags = optionRoles(parse).map((r) => r.flag.slice(1)).join('');
    if (flags.includes('f') && !flags.includes('v')) {
      this.changed(w);
      return;
    }
    for (const r of parse.roles) if (r.role.role === 'operand') this.named(wordName(words[r.word]), words[r.word], w, 'none');
  }

  /**
   * Whether the command `c` runs a program (a child process), or a name bash does not find: a static name that is no
   * builtin of bash, no function of the script, and no function of the file's host, in a script that defines no alias
   * (an alias's text may make it another command).
   */
  private program(c: SyntaxNode): boolean {
    const name = field(c, 'name') && commandName(c);
    return name !== undefined && !Object.hasOwn(BUILTINS, name) && !this.functions.has(name) && !Object.hasOwn(this.host, name) && !this.renames;
  }

  private command(c: SyntaxNode, w: Where): void {
    const alias = plainName(c);
    if (alias !== undefined) this.aliasCommands.push({ c, name: alias, where: w });
    const { name, args, lookup, direct } = commandWords(c, this.shell);
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
    // A builtin whose words say what it sets or turns on (`set`, the declarations, `printf -v`…), given a word whose
    // value is not known here: read at the end, as the fields of the values the script gives its variables (`readDeferred`).
    const unknown = hosted ? undefined : unknownWords(name, spec, args, this.shell);
    if (unknown) this.deferred.push({ c, name, args, spec, words: unknown, w });
    else this.builtinWords(c, name, args, spec, hosted, w);
  }

  /**
   * The words of the builtin `name` (or of a function of the host: `hosted`), read by its spec and its row; those
   * whose fields `fieldsOf` gives, as those fields (`readDeferred`).
   */
  private builtinWords(c: SyntaxNode, name: string, args: SyntaxNode[], spec: CommandSpec, hosted: CommandSpec | undefined, w: Where, fieldsOf?: (n: SyntaxNode) => readonly string[] | undefined): void {
    const read = builtinRead(name, args, this.shell, spec, fieldsOf);
    const { parse } = read;
    // The variables it sets, and the functions it runs later, as its spec says (src/semantics/effects.ts).
    for (const v of variableWrites(spec, read)) {
      if (v.node) this.named(v.name, v.node, w, v.sets === 'job-id' ? 'number' : 'unknown');
      else this.write(v.name!, w, false, 'unknown');
    }
    for (const f of callbacks(read)) this.callback(f);
    if (hosted) return;
    // The rest by the builtin's row: an option the spec does not know, and the handler of a builtin the walk follows.
    const row = builtinRow(name);
    if (parse.roles.some((r) => r.role.role === 'unknown-option')) this.apply(row.unknownOption);
    for (const o of optionRoles(parse)) if (row.options && Object.hasOwn(row.options, o.flag)) this.apply(row.options[o.flag]);
    if (!this.apply(row)) return;
    // `test` and `[` (by their spec): `-v name` reads a variable.
    if (spec.operandParser === 'test-expression') {
      this.testWords(name === '[' && staticWordValue(args[args.length - 1] ?? c) === ']' ? args.slice(0, -1) : args, w);
      return;
    }
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
          // (`alias c=(1 2)` assigns the array `c`, and defines no alias.)
          if (a.type === 'variable_assignment') {
            this.assignment(a, w, true);
            continue;
          }
          // (Read where commands may run it: see `aliases`. A name bash rejects, `a/b=x`, defines nothing.)
          const v = staticWordValue(a);
          const def = v === undefined ? undefined : aliasOf(a);
          if (def) this.aliasDefs.push({ ...def, word: a, where: w });
          else if (v === undefined) this.blindFor('an alias of text not known');
        }
        return;
      case 'let':
        for (const r of parse.roles) if (r.role.role === 'operand') this.arithText(args[r.word].text, w);
        return;
      case 'compgen': {
        // `compgen -W list` expands the list in the shell (`compgen -W '$((u=2))'` sets `u`); `-F f` runs a function
        // in the shell, and `-C cmd` a command. (The word being completed is only matched; `-G`, `-X`, `-P` and `-S`
        // take their words as text.)
        for (const r of parse.roles) {
          const v = staticWordValue(args[r.word]);
          if (r.role.role === 'operand') continue;
          if (v === undefined || r.role.role === 'command' || (r.role.role === 'value' && r.role.of === '-F')
            || (r.role.role === 'value' && r.role.of === '-W' && !quietPrompt(v))) this.blindFor('`compgen` expands a word list or runs a command the model does not read');
        }
        return;
      }
      case 'fc':
        // (`fc -l` lists; the others run a line of the history again.)
        if (!optionRoles(parse).some((r) => r.flag === '-l')) this.blindFor('`fc` runs a line of the history again');
        return;
      case 'enable':
        // (`enable -n x` turns the builtin `x` off: the walk follows a name it knows. `-f` loads a builtin from a
        // shared object, which may replace one, and run code as it loads.)
        if (optionRoles(parse).some((r) => r.flag === '-f')) this.blindFor('`enable -f` loads a builtin the model does not read');
        if (args.some((a) => staticWordValue(a) === undefined)) this.blindFor('`enable` is given a name not known');
        return;
      case 'unset':
        this.unset(args, w);
        return;
      case 'shopt':
        this.shopt(parse, args);
        return;
      case 'set': {
        // Each option by its row; a name of `-o` not known, or a word whose value is not known before the operands
        // (`set $x`: `-k`?), may be any option. `set -a`, `set -o allexport` (the last of them in the command wins):
        // functions defined after are exported.
        const writes = setOptionWrites(read, this.shell);
        for (const o of writes) {
          if (o.name === undefined) this.blindFor('`set -o` is given an option name not known');
          this.apply(optionRow(SET_OPTIONS, o.name, o.on));
        }
        const first = parse.roles.find((r) => r.role.role === 'end-of-options' || (r.role.role === 'operand' && read.text(r.word) !== undefined))?.word ?? read.size;
        if (Array.from({ length: first }, (_, j) => read.text(j)).some((t) => t === undefined)) this.blindFor('`set` is given a word not known before its operands, which may be any option');
        if (writes.filter((o) => o.name === 'allexport').pop()?.on) this.exportAll = true;
        return;
      }
    }
    if (DECLARATIONS.has(name)) this.declaration(name, readDeclarationWords(name, args, this.shell, fieldsOf), w);
  }

  /**
   * `shopt -s` and `-u`: each option by its row (`-o`: those of `set -o`); a name not known may be any option.
   * `shopt -so allexport` exports the functions defined after it, as `set -a` does.
   */
  private shopt(parse: ReturnType<typeof builtinParse>, args: SyntaxNode[]): void {
    const flags = optionRoles(parse).map((r) => r.flag);
    const on = flags.includes('-s') ? true : flags.includes('-u') ? false : undefined;
    if (on === undefined) return;
    const set = flags.includes('-o');
    for (const r of parse.roles) {
      if (r.role.role !== 'operand') continue;
      const name = staticWordValue(args[r.word]);
      if (name === undefined) this.blindFor('`shopt` is given an option name not known');
      if (set && on && name === 'allexport') this.exportAll = true;
      this.apply(optionRow(set ? SET_OPTIONS : SHOPT_OPTIONS, name, on));
    }
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
   * commands in it in turn, but not in an alias it comes from; when its text ends with a blank, also with the words
   * after it replaced by the texts of the aliases they name (6.6). Its text is foreign, and the rest of the command is
   * read where the command is, now as part of that tree: the facts of its statements are the walk's. An alias no
   * command names is read alone, as foreign text.
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
          // (With the words after it read as aliases too, when its text ends with a blank, and as they are: 6.6.)
          const values = (word: string): string[] => [...new Set(this.aliasDefs.filter((x) => x.name === word).map((x) => x.value))];
          // (Their number is the product of the definitions of each word: past `ALIAS_NEXT`, nothing is trusted.)
          const all = aliasTexts(c, d.value, values, true, ALIAS_NEXT);
          if (all.length > ALIAS_NEXT) this.blindFor('too many aliases after aliases');
          for (const { text, rest } of all) {
            const tree = this.strings.expansion(c, text, rest);
            if (this.strings.capped) this.blindFor('too many aliases expanded');
            this.expanding.set(tree, new Set([...from, name]));
            origin.set(tree, top);
            // (A command in an alias's text is foreign: so is the rest of it, in the tree of an alias expanded there.)
            const { rest: _, ...outer } = where;
            this.visit(tree, { fn: where.fn, foreign: true, now: false, rest: { at: text.length, where: outer } });
          }
        }
      }
    }
    for (const d of this.aliasDefs) if (!read.has(d)) this.foreign(this.strings.alias(d.word, d.value), 'an alias of text not known', d.where);
  }

  /**
   * The builtins given words whose values are not known where they stand (`unknownWords`), read once all the writes
   * of the script are known: as the fields each value bash may give their variables makes of each word (`valuesOf`),
   * with brace expansion on and off; as written where those values are not all listed (`deferredReadings`). The walk
   * reads those words as their fields where it knows them, and walks again with nothing trusted where they give the
   * builtin what the scan did not read, or where it does not know them (`Trust.deferred`). A variable they expand
   * must not be set by such a reading, nor become a nameref's target.
   */
  private readDeferred(): void {
    const plans = this.deferred.map((d) => ({ d, ...deferredReadings(d, (name) => this.valuesOf(name), this.writes.has('IFS'), this.shell, this.posix) }));
    const read = new Map<string, string>();
    const seen = (name: string): string => `${this.writes.get(name)?.length ?? 0} ${this.refTargets.has(name)}`;
    for (const { d } of plans) for (const name of [...d.words.flatMap((u) => u.names), ...(d.words.some((u) => u.unquoted) ? ['IFS'] : [])]) read.set(name, seen(name));
    for (const { d, plan, readings } of plans) {
      for (const fieldsOf of readings.length ? readings : [undefined]) this.builtinWords(d.c, d.name, d.args, d.spec, undefined, d.w, fieldsOf);
      for (const w of plan.words) this.plans.set(w, plan);
      this.planned.push(d.w);
    }
    for (const [name, was] of read) if (seen(name) !== was) this.blindFor('a builtin may set a variable whose value gives the words of a builtin');
  }

  /** The values the script gives the variable `name`, where the walk follows each (`valuesWritten`). */
  written(name: string): (string | null)[] | undefined {
    return valuesWritten(name, this.writes.get(name) ?? [], this.refTargets.has(name));
  }

  /**
   * Every value bash may give the variable `name` where a builtin's word reads it (`written`), for the scan's
   * readings; undefined also where the script gives it no text: its value there is the environment's.
   */
  private valuesOf(name: string): (string | null)[] | undefined {
    const texts = this.written(name);
    return texts && texts.length > 1 ? texts : undefined;
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
    // (A nameref that refers to one whose target is not known reads and assigns through it: `declare -n a=b` with
    // `declare -n b=$1`.)
    for (let more = true; more;) {
      more = false;
      for (const [r, targets] of this.refEdges) {
        if (!this.refUnknown.has(r) && [...targets].some((t) => this.refUnknown.has(t))) {
          this.refUnknown.add(r);
          more = true;
        }
      }
    }
    // A write through a nameref is one of its targets, also through a chain, by their rows (`declare -n r=BASH_COMPAT;
    // r=42`), and is read with their writes below (PS4, IFS).
    const via = new Map<string, Write[]>();
    for (const [r, targets] of this.refEdges) {
      const reached = new Set(targets);
      for (const todo = [...targets]; todo.length;) {
        for (const t of this.refEdges.get(todo.pop()!) ?? []) {
          if (reached.has(t)) continue;
          reached.add(t);
          todo.push(t);
        }
      }
      // (Each nameref has the write of its declaration.)
      for (const x of this.writes.get(r)!.filter((x) => !x.nameref)) {
        for (const t of reached) {
          this.variableRow(t, x.value);
          via.set(t, [...(via.get(t) ?? []), x]);
        }
      }
    }
    const writesOf = (name: string): Write[] => [...(this.writes.get(name) ?? []), ...(via.get(name) ?? [])];
    // An unquoted expansion in a word of `test` or `[`: each value the script gives it must stay one word, and not be
    // `-v`, with every IFS the script sets (a number, with no IFS of digits or `-`).
    if (this.testNumbers || this.testSplits.length) {
      const chain = testSplits((name) => writesOf(name).map((x) => (x.append && typeof x.value === 'object' ? { ...x.value, appended: true } : x.value)), this.testSplits.map((s) => s.name), this.testNumbers);
      if (!chain) this.blindFor('`-v` may test a variable name not known');
      // (The walk checks that each copy of a value into IFS, and each variable a word of `test` splits, reads one the
      // script set there: see `Trust.copied`. `[ -n "$z" ] && x=a; [ $x … ]` may split `x` from the environment.)
      const copied = [...this.copies.filter((c) => chain.has(c.target) && c.source !== 'IFS').map((c) => ({ owner: c.owner, name: c.source })), ...this.testSplits];
      for (const c of copied) {
        const set = this.copied.get(c.owner) ?? new Set<string>();
        set.add(c.name);
        this.copied.set(c.owner, set);
      }
    }
    const why = arithReads(this.arith, this.writes, this.refUnknown) ?? commandNames(this.commandVariables, this.writes, this.functions, this.callbacks) ?? ps4Writes(writesOf('PS4'));
    if (why) this.blindFor(why);
    // A nameref whose target is not known, assigned or unset: any variable may change. Read, too: bash expands the
    // target's subscript (`declare -n r=$1; : "$r"` with `$1` = `a[u=2]` sets `u`).
    for (const r of this.refUnknown) if (this.writes.get(r)!.some((w) => !w.nameref)) this.blindFor('a nameref whose target is not known is assigned');
    for (const r of this.refUnknown) if (this.reads.has(r)) this.blindFor('a nameref whose target is not known is read');
    const prompt = promptReads(this.prompts, this.writes, this.refUnknown, this.refTargets);
    if (prompt) this.blindFor(prompt);
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
    // (The walk checks the fields of a builtin's words where it runs the builtin: not in a trap's action, an alias's
    // text, or a function a callback runs, where their values are those of when bash runs it.)
    if (this.planned.some((w) => !w.now || (w.fn !== undefined && run.has(w.fn)))) this.blindFor('a builtin is given a word not known where the walk does not run it');
    if (this.foreignChanges || [...run].some((f) => this.changes.has(f))) this.blindFor('a trap, a callback or a foreign text changes options, functions or aliases');
  }
}


/**
 * The trust of the decisions of a model over the script `root`, whose strings have the trees `strings` gives (once
 * per model: the trees are the model's). The scan stops at the first reason to trust nothing. `host`: the functions
 * the file's host defines (a bats file: `run`, `load`…), read by their specs. `opening`: what the shebang starts bash
 * with (`#!/bin/bash -k`).
 */
export function scriptTrust(root: SyntaxNode, strings: StringTrees, host = NO_HOST, opening: Opening | undefined, shell: Shell | undefined, version?: BashVersion, posix = false): Trust {
  const scan = new Scan(root, strings, host, opening, shell, version, posix);
  if (scan.blind) return { ...BLIND, blind: scan.blind };
  const unseen = new Set<string>();
  for (const [name, ws] of scan.writes) if (ws.some((w) => w.foreign || (w.fn !== undefined && scan.callbacks.has(w.fn)))) unseen.add(name);
  // (Asked once per use of a variable, as the colouring does: kept per name, as the writes of a name are many.)
  const trusted = new Map<string, boolean>();
  const known = new Map<string, boolean>();
  return {
    blind: undefined,
    variable: (name) => trusted.get(name) ?? trusted.set(name, NAME.test(name) && !changedUnseen(name) && !scan.arith.has(name) && !unseen.has(name)
      && !scan.refTargets.has(name) && (scan.writes.get(name) ?? []).every((w) => w.plain)).get(name)!,
    closed: (name) => !scan.exportAll && !scan.exported.has(name) && !scan.callbacks.has(name),
    copied: (n) => {
      const names = scan.copied.get(n);
      return names && [...names];
    },
    arithNames: (n) => {
      const names = scan.pending.get(n);
      return names && [...names];
    },
    associative: (n) => {
      const names = scan.keys.get(n);
      return names && [...names];
    },
    mayFail: (n) => scan.fails.has(n),
    fdsMayClose: scan.fdsClose,
    deferred: (w) => scan.plans.get(w),
    valuesKnown: (name) => known.get(name) ?? known.set(name, !unseen.has(name) && !scan.arith.has(name) && scan.written(name) !== undefined).get(name)!,
  };
}
