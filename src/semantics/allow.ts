// The allow-list of the trust (docs/design/trust-allow-list.md, section 2): each construct of a script, looked up in
// one table, with what it may change. src/semantics/trust.ts reads it: `all` trusts nothing, `names` makes the
// variables it writes not trusted, `followed` runs the scan's handler (the walk follows the construct, maybe with a
// precondition the handler checks), and `none` changes nothing a value, a decision or a dead mark reads.
//
// Each row holds the effect the scan gives the construct today. `next` is the effect the design gives it when the
// default flips (its step 4: the rows marked "new"), and a construct with no row then trusts nothing; until then, it
// changes nothing. A `followed` row names what checks it against bash (`tests`): rows of the probe tables
// (test/fixtures/probes/*.json) or constructs of the decisions' generator (test/support/decisions.ts), each a part of
// their text; test/allow-list.test.ts checks that each is there, and that every set is complete against bash.
import { field, type NodeType, type SyntaxNode } from '../syntax/tree';

/** What a construct may change. */
export type Effect =
  | { readonly kind: 'none' }
  | { readonly kind: 'followed' }
  | { readonly kind: 'names' }
  | { readonly kind: 'all'; readonly why: string };

export interface Row {
  readonly effect: Effect;
  /** The effect step 4 of the design gives it, where it differs from today's. */
  readonly next?: Effect;
  /**
   * What checks a `followed` row against bash: `kind: text`, where `kind` is a probe table (`state`, `values`…) and
   * `text` a part of one of its snippets, or `generator` and a part of a script the decisions' generator writes.
   */
  readonly tests?: readonly string[];
}

export const NONE: Effect = { kind: 'none' };
export const FOLLOWED: Effect = { kind: 'followed' };
const NAMES: Effect = { kind: 'names' };
export const all = (why: string): Effect => ({ kind: 'all', why });

export const none = (next?: Effect): Row => (next ? { effect: NONE, next } : { effect: NONE });
export const followed = (tests: readonly string[]): Row => ({ effect: FOLLOWED, tests });
export const names = (): Row => ({ effect: NAMES });

/** The row of a construct the table does not have: today, it changes nothing (step 4: it changes anything). */
export const UNLISTED: Row = none(all('a construct the allow-list does not have'));

/** The node types of the syntax tree (src/syntax/tree.ts). */
export const SYNTAX: Readonly<Record<NodeType, Row>> = {
  // The walk: statements and their parts.
  program: followed(['state: x=1']),
  comment: none(),
  command: followed(['state: x=1']),
  command_name: followed(['names: ']),
  variable_assignment: followed(['values: x=']),
  negated_command: followed(['status: ! ']),
  // (Its redirections: the redirection rows.)
  redirected_statement: followed(['words: } >']),
  pipeline: followed(['env: |']),
  list: followed(['status: &&', 'generator: &&']),
  command_list: followed(['status: ;']),
  time_statement: followed(['status: time ']),
  compound_statement: followed(['status: {', 'generator: { ']),
  subshell: followed(['env: (', 'generator: ( ']),
  do_group: followed(['generator: do ']),
  if_statement: followed(['status: if ', 'generator: if ']),
  elif_clause: followed(['generator: elif ']),
  else_clause: followed(['generator: else ']),
  case_item: followed(['generator: case ']),
  while_statement: followed(['status: while ', 'generator: while ', 'generator: until ']),
  c_style_for_statement: followed(['generator: for (( ']),
  arithmetic_command: followed(['status: (( i++ ))', 'generator: (( ']),
  extended_test: followed(['values: [[ ', 'generator: [[ ']),
  // A function: the walk walks each call it sees; one called otherwise is not closed (`Trust.closed`).
  function_definition: followed(['env: f() ', 'generator: () { ']),
  // The patterns after `;&` and `;;&`: expanded in the state before the `case` (step 3 of the design fixes the walk).
  case_statement: followed(['generator: case ']),
  // The loop variable; `select`'s is what the user types.
  for_statement: names(),
  select_statement: names(),
  // The coprocess's array and its `_PID`.
  coproc_statement: names(),
  // Words and their parts: the word model (src/semantics/words.ts).
  word: followed(['words: ']),
  concatenation: followed(['words: a$']),
  string: followed(['words: "']),
  string_content: followed(['words: "']),
  raw_string: followed(["words: '"]),
  ansi_c_string: followed(["words: $'"]),
  number: followed(['values: 1']),
  regex: followed(['generator: =~ ']),
  array: followed(['values: =(']),
  // (Never given as a value: `$"…"`, a brace expansion, a glob.)
  translated_string: none(),
  brace_expression: none(),
  extglob_pattern: none(),
  // Expansions: the operators below.
  simple_expansion: followed(['values: "$x"']),
  expansion: followed(['values: "${']),
  variable_name: followed(['values: "$x"']),
  special_variable_name: followed(['values: "$#"']),
  subscript: followed(['values: [']),
  // (`${ …; }` of bash 5.3, which the scan reads as `all`, runs in this shell; `$( )` in a subshell.)
  command_substitution: followed(['values: $(', 'generator: $( ']),
  // (A subshell: its own commands are looked up as well.)
  process_substitution: none(),
  arithmetic_expansion: followed(['values: $((']),
  // Expressions of tests and arithmetic.
  binary_expression: followed(['generator: [[ $']),
  unary_expression: followed(['generator: [[ -z']),
  parenthesized_expression: followed(['state: (( (']),
  ternary_expression: followed(['values: ?']),
  postfix_expression: followed(['generator: ++ ))']),
  test_operator: followed(['generator: [[ -z']),
  // Redirections: the rows of REDIRECTIONS.
  file_redirect: followed(['words: >']),
  file_descriptor: followed(['words: 2>']),
  heredoc_redirect: followed(['words: <<']),
  heredoc_start: followed(['words: <<']),
  heredoc_body: followed(['words: <<']),
  heredoc_content: followed(['words: <<']),
  heredoc_end: followed(['words: <<']),
  herestring_redirect: followed(['words: <<<', 'generator: <<< ']),
  // Text our parser could not read: bash may read it otherwise.
  error: none(all('text the parser could not read')),
};

/**
 * A builtin: its own row, that of an option its spec does not know (bash may take it), and those of options that do
 * more than the builtin's row says (`jobs -x`), by flag.
 */
export interface BuiltinRow extends Row {
  readonly unknownOption: Row;
  readonly options?: Readonly<Record<string, Row>>;
}

const ANY_OPTION = all('an option of a builtin that the spec does not know');
const builtin = (row: Row, unknownOption: Row = none(ANY_OPTION), options?: Readonly<Record<string, Row>>): BuiltinRow => ({ ...row, unknownOption, ...(options ? { options } : {}) });
/** `ulimit -n` and `-u` may lower a limit: then a redirection (even to /dev/null), a pipe of `$( )` or a fork fails. */
const LIMITS = { effect: all('`ulimit -n` or `-u` may make a redirection, a pipe or a fork fail') };
/** `mapfile -C` runs its text in this shell, as `eval` does (with the index and the line after it). */
const MAPFILE_CALLBACK = { '-C': { effect: all('`mapfile -C` runs code in this shell') } };

/**
 * Each of bash's 61 builtins (`compgen -b`, the same in 5.2 and 5.3). What their specs say is read from them, for
 * every builtin: the variables an option or operand names (`read x`, `printf -v x`: names), the functions run later
 * (`complete -F f`: not closed), a file or command line run unread (`source`: all), and what they alter
 * (`shellEffect`). The rows say the rest.
 */
export const BUILTINS: Readonly<Record<string, BuiltinRow>> = {
  // They change nothing a value or a decision reads.
  ':': builtin(none(), none()), true: builtin(none(), none()), false: builtin(none(), none()),
  echo: builtin(none(), none()), printf: builtin(none(), none()),
  pwd: builtin(none()), type: builtin(none()), help: builtin(none()), times: builtin(none()), caller: builtin(none()),
  dirs: builtin(none()), disown: builtin(none()), suspend: builtin(none()), logout: builtin(none()),
  ulimit: builtin(none(), none(ANY_OPTION), { '-n': LIMITS, '-u': LIMITS }),
  umask: builtin(none()), hash: builtin(none()), bind: builtin(none()), history: builtin(none()), kill: builtin(none()),
  wait: builtin(none()), bg: builtin(none()), fg: builtin(none()),
  // (A function named as a callback, `complete -F f`, is not closed. `complete -C` and `-F` run when a command is
  // completed, in an interactive shell only.)
  complete: builtin(none()), compopt: builtin(none()),
  // `jobs -x` runs its command in this shell (its spec's command slot).
  jobs: builtin(none(), none(ANY_OPTION), { '-x': { effect: all('`jobs -x` runs a command in this shell') } }),
  // PWD, OLDPWD and DIRSTACK; the positional parameters (never trusted).
  cd: builtin(names()), pushd: builtin(names()), popd: builtin(names()), shift: builtin(names()),
  read: builtin(names()), mapfile: builtin(names(), none(ANY_OPTION), MAPFILE_CALLBACK), readarray: builtin(names(), none(ANY_OPTION), MAPFILE_CALLBACK),
  getopts: builtin(names()),
  // Jumps (a count not known takes both paths).
  exit: builtin(followed(['status: exit', 'generator: exit'])), return: builtin(followed(['status: return', 'generator: return'])),
  break: builtin(followed(['generator: break'])), continue: builtin(followed(['generator: continue'])),
  // `x=w` with no option but -r, -x and -g; names for the other options; the nameref rule for -n; all for a name not known.
  declare: builtin(followed(['values: declare ']), names()), typeset: builtin(followed(['state: typeset']), names()),
  local: builtin(followed(['values: local ', 'generator: local ']), names()), export: builtin(followed(['values: export ', 'generator: export ']), names()),
  readonly: builtin(followed(['values: readonly ']), names()),
  unset: builtin(followed(['values: unset ', 'generator: unset '])),
  let: builtin(followed(['status: let i=0', 'generator: let '])),
  // The string the walk reads; else all.
  eval: builtin(followed(['values: eval '])),
  source: builtin({ effect: all('a file is sourced') }), '.': builtin({ effect: all('a file is sourced') }),
  // An action the walk reads (foreign text); all for DEBUG, RETURN, or an action not known.
  trap: builtin(followed(['values: trap '])),
  alias: builtin(followed(['state: alias '])), unalias: builtin(followed(['state: unalias'])),
  // `-n NAME`, `-ns NAME`, `-n -s NAME`, `-n -a NAME`, `NAME`; all for -f or a name not known.
  enable: builtin(followed(['values: enable -n'])),
  set: builtin(followed(['state: set -', 'generator: set -'])), shopt: builtin(followed(['state: shopt -s', 'generator: shopt -s'])),
  // Precondition: no word may be `-v` with an operand that has a subscript.
  test: builtin(followed(['generator: test '])), '[': builtin(followed(['generator: [ '])),
  command: builtin(followed(['env: command @PROBE'])), builtin: builtin(followed(['env: builtin eval'])),
  // A quiet word list and no -F or -C; else all.
  compgen: builtin(followed(['values: compgen']), { effect: all('`compgen` expands a word list or runs a command the model does not read') }),
  // `fc -l` lists; else all.
  fc: builtin(followed(['values: fc '])),
  exec: builtin(followed(['status: exec'])),
};

/** The options of `set -o` (the same 27 in bash 5.2 and 5.3), by what turning them on does (and off, `off`). */
export interface OptionRow extends Row {
  /** The effect when the option is turned off, where it differs. */
  readonly off?: Row;
}

export const SET_OPTIONS: Readonly<Record<string, OptionRow>> = {
  allexport: followed(['state: set -a']), errexit: followed(['status: set -e', 'generator: set -e']), nounset: followed(['status: set -u', 'generator: set -u']),
  noglob: followed(['words: set -f']), pipefail: followed(['status: pipefail', 'generator: set -o pipefail']), monitor: followed(['env: set -m']),
  braceexpand: followed(['words: set +B']),
  // (With the PS4 rule.)
  xtrace: followed(['values: set -x']),
  // (errtrace and functrace only change where the ERR, DEBUG and RETURN traps run.)
  emacs: none(), vi: none(), ignoreeof: none(), nolog: none(), notify: none(), verbose: none(), hashall: none(), physical: none(),
  privileged: none(), 'interactive-comments': none(), errtrace: none(), functrace: none(),
  // `!!` runs an earlier line.
  histexpand: none(all('history expansion may run an earlier line')), history: none(all('history expansion may run an earlier line')),
  // An assignment word anywhere in a command is an assignment for it.
  keyword: none(all('`set -k` makes every assignment word one for its command')),
  // With it, a `>` may fail on any file (step 3: a redirection that may fail).
  noclobber: none(FOLLOWED),
  // The commands after it do not run.
  noexec: none(all('`set -n` or `set -t` stops running commands')), onecmd: none(all('`set -n` or `set -t` stops running commands')),
  // Until the POSIX-mode rows of docs/design/bash-versions.md, step 6.
  posix: none(all('POSIX mode')),
};

/** The options of `shopt` (57 in bash 5.2; 5.3 adds `array_expand_once` and `bash_source_fullpath`, SINCE in src/bashversion.ts). */
export const SHOPT_OPTIONS: Readonly<Record<string, OptionRow>> = {
  expand_aliases: followed(['state: expand_aliases']), extglob: followed(['words: extglob']), nocasematch: followed(['generator: nocasematch']),
  lastpipe: followed(['env: lastpipe']), inherit_errexit: followed(['status: inherit_errexit']), failglob: followed(['words: failglob']),
  // A value with a glob character is never given, and no decision reads a glob.
  nullglob: none(), dotglob: none(), globstar: none(), globskipdots: none(), nocaseglob: none(),
  // What they change is never given as a value, only printed, only interactive, or a variable bash sets itself.
  patsub_replacement: none(), noexpand_translation: none(), promptvars: none(), xpg_echo: none(), sourcepath: none(), execfail: none(),
  checkwinsize: none(), varredir_close: none(), shift_verbose: none(), gnu_errfmt: none(), huponexit: none(), checkhash: none(),
  checkjobs: none(), cmdhist: none(), lithist: none(), histappend: none(), histreedit: none(), histverify: none(), hostcomplete: none(),
  progcomp: none(), progcomp_alias: none(), complete_fullquote: none(), direxpand: none(), dirspell: none(), cdspell: none(),
  cdable_vars: none(), autocd: none(), mailwarn: none(), no_empty_cmd_completion: none(), force_fignore: none(),
  interactive_comments: none(), login_shell: none(), restricted_shell: none(), bash_source_fullpath: none(),
  // Turned on, they change what words and arithmetic do in ways the walk does not follow.
  ...Object.fromEntries(['compat31', 'compat32', 'compat40', 'compat41', 'compat42', 'compat43', 'compat44', 'extdebug', 'localvar_inherit', 'localvar_unset',
    'assoc_expand_once', 'array_expand_once'].map((o) => [o, { ...none(all(`\`shopt -s ${o}\``)), off: none() }])),
  // Turned off: `$'…'` inside `"${x:-…}"`, and ranges in patterns by the locale.
  ...Object.fromEntries(['extquote', 'globasciiranges'].map((o) => [o, { ...none(), off: none(all(`\`shopt -u ${o}\``)) }])),
};

/**
 * The operators of a parameter expansion (3.5.3), as `expansionOperator` names them: `$x` and `${x}` (''), the length
 * `${#x}`, the forms after the name (`:-`, `#`, `/`, `^`…), the offset `:`, the transformations `@Q`…, and the
 * indirections `!` (`${!x}`), `!@` and `!*` (the names with a prefix) and `![@]` (the keys of an array).
 */
export const EXPANSION_OPERATORS: Readonly<Record<string, Row>> = {
  '': followed(['values: "$x"']), length: none(),
  '-': none(), ':-': none(), '+': none(), ':+': none(), '?': none(), ':?': none(),
  '#': none(), '##': none(), '%': none(), '%%': none(), '/': none(), '//': none(), '/#': none(), '/%': none(),
  '^': none(), '^^': none(), ',': none(), ',,': none(), '~': none(), '~~': none(),
  // The variable (`${x:=w}`): names. A set `x` keeps its value, which may come from the environment.
  '=': names(), ':=': names(),
  // Arithmetic.
  ':': followed(['generator: ${s:']),
  '@Q': none(), '@E': none(), '@A': none(), '@a': none(), '@K': none(), '@k': none(), '@U': none(), '@u': none(), '@L': none(),
  // Precondition: every value the script gives it is quiet (step 4: and none is made with `+=`).
  '@P': followed(['values: @P']),
  // `${!x}` and the other indirections: all; the keys and the names with a prefix, with nothing after them: none.
  '!': followed(['values: ${!']), '!@': none(), '!*': none(), '![@]': none(),
};

/** The redirection operators (3.6), as the parser gives them. */
export const REDIRECTIONS: Readonly<Record<string, Row>> = {
  // A here-document and a here-string do not fail; their words are looked up as words.
  '<<': followed(['words: <<']), '<<-': followed(['words: <<-E']), '<<<': followed(['words: <<<']),
  // The others may fail, and then their command does not run (step 3 of the design: today the walk takes them as made).
  // `{fd}>…`: names `fd`.
  '<': followed(['words: <']), '>': followed(['words: >']), '>>': followed(['test/tests-redirections-real.test.ts: >>']), '<>': followed(['test/tests-redirections-real.test.ts: <>']),
  '>|': followed(['test/tests-redirections-real.test.ts: >|']), '&>': followed(['test/tests-redirections-real.test.ts: &>']), '&>>': followed(['test/redirections.test.ts: &>>']), '<&': followed(['env: <&']),
  '>&': followed(['state: >&']),
};

const rowOf = <R>(table: Readonly<Record<string, R>>, key: string, unlisted: R): R => (Object.hasOwn(table, key) ? table[key] : unlisted);

/** The row of a node type (one the table does not have: `UNLISTED`). */
export const syntaxRow = (type: string): Row => rowOf<Row>(SYNTAX, type, UNLISTED);

const UNLISTED_BUILTIN: BuiltinRow = { ...UNLISTED, unknownOption: UNLISTED };
/** The row of a builtin (a name of the dictionary that is no builtin of bash, zsh's `setopt`: `UNLISTED`). */
export const builtinRow = (name: string): BuiltinRow => rowOf(BUILTINS, name, UNLISTED_BUILTIN);

/** The row of an option of `set -o` or `shopt` (`table`), turned on or off. */
export function optionRow(table: Readonly<Record<string, OptionRow>>, name: string, on: boolean): Row {
  const row = rowOf<OptionRow>(table, name, UNLISTED);
  return on ? row : row.off ?? row;
}

/**
 * The operator of the parameter expansion `n`, as EXPANSION_OPERATORS names it: the token after the name (the first,
 * with the letter of `@`), `length` for `${#x}`, `!` and its forms for an indirection, '' for none.
 */
export function expansionOperator(n: SyntaxNode): string {
  const kids = n.children.filter((c) => c.type !== '${' && c.type !== '}');
  const at = kids.findIndex((c) => c.named);
  const before = kids.slice(0, Math.max(at, 0)).map((c) => c.type).join('');
  const after = kids.slice(at + 1);
  if (before === '#') return 'length';
  if (before === '!') {
    const name = kids[at];
    if (!after.length && name.type === 'subscript' && ['@', '*'].includes(field(name, 'index')!.text)) return '![@]';
    if (after.length === 1 && ['@', '*'].includes(after[0].type)) return `!${after[0].type}`;
    return '!';
  }
  const op = after.find((c) => !c.named);
  if (!op) return '';
  return op.type === '@' ? `@${after[after.indexOf(op) + 1]?.type ?? ''}` : op.type;
}

/** The row of the operator of the parameter expansion `n`. */
export const expansionRow = (n: SyntaxNode): Row => rowOf<Row>(EXPANSION_OPERATORS, expansionOperator(n), UNLISTED);

/** The row of a redirection, by its operator. */
export const redirectionRow = (n: SyntaxNode): Row => rowOf<Row>(REDIRECTIONS, n.children.find((c) => !c.named)!.type, UNLISTED);

// The preconditions of the expansion rows `@P` and `!`, which the scan checks.

/** A parameter that expanding changes nothing: `$x`, `${x}`, `${#x}`, `${x[0]}`, `${x:-w}`, `${x:+w}` (w with no `$`). */
const QUIET_PARAMETER = /\$(?:[A-Za-z_]\w*|[0-9@*#?$!_-]|\{#?(?:[A-Za-z_]\w*|[0-9@*#?$!_-])(?:\[(?:\d+|@|\*)\])?(?::?[-+?][^$`{}]*)?\})/g;
/**
 * Whether the text of a prompt (`PS4`, `${x@P}`) runs nothing and assigns nothing when bash expands it: only
 * `QUIET_PARAMETER`s, nested in each other, and no octal escape (bash decodes `\044` to a `$` before it expands the
 * prompt: `x='\044((u=2))'; : "${x@P}"` sets `u`).
 */
export function quietPrompt(text: string): boolean {
  if (/\\[0-7]/.test(text)) return false;
  for (let before = ''; before !== text;) [before, text] = [text, text.replace(QUIET_PARAMETER, '')];
  return !/[$`]/.test(text);
}

/**
 * Whether the expansion `n` is an indirection (`${!v}`, `${!1}`, `${!a[1]}`, `${!v@Q}`, `${!v:-x}`, `${!a[@]:-x}`): the
 * value it reads names the variable, and a subscript there is arithmetic, which may assign any variable. Not the keys
 * of an array (`${!a[@]}`) or the names with a prefix (`${!v@}`) with nothing after them, nor a special parameter
 * whose value is a number or the option letters (`${!#}`, `${!?}`, `${!-}`); `${!@}` and `${!*}` take `$1`'s value.
 */
export function indirect(n: SyntaxNode): boolean {
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
