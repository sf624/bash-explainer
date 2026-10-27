// The allow-list of the trust (docs/design/trust-allow-list.md, section 2): each construct of a script, looked up in
// one table, with what it may change. src/semantics/trust.ts reads it: `all` trusts nothing, `names` makes the
// variables it writes not trusted, `followed` runs the scan's handler (the walk follows the construct, maybe with a
// precondition the handler checks), and `none` changes nothing a value, a decision or a dead mark reads.
//
// A construct with no row trusts nothing (`unlisted`): the scan fails toward "no value" for what it does not know. A
// `followed` row names what checks it against bash (`tests`): a row of a probe table
// (test/fixtures/probes/*.json, by its `id`), a construct of the decisions' generator (test/support/decisions.ts, by its
// key in `GENERATED`), or a test of a test file (by its title); test/allow-list.test.ts checks that each names exactly
// one, and that every set is complete against bash.
import { field, type NodeType, type SyntaxNode } from '../syntax/tree';

/** What a construct may change. */
export type Effect =
  | { readonly kind: 'none' }
  | { readonly kind: 'followed' }
  | { readonly kind: 'names' }
  | { readonly kind: 'all'; readonly why: string };

export interface Row {
  readonly effect: Effect;
  /**
   * What checks a `followed` row against bash, in one of three forms:
   * - `kind#id`: the row of the probe table `kind` (`state`, `env`, `names`, `words`, `status` or `values`) whose `id`
   *   is `id`;
   * - `test/file.test.ts: title`: the `it` of that file with exactly that title;
   * - `generator: name`: the construct `name` of the decisions' generator, a key of `GENERATED` in
   *   test/support/decisions.ts.
   */
  readonly tests?: readonly string[];
}

export const NONE: Effect = { kind: 'none' };
export const FOLLOWED: Effect = { kind: 'followed' };
const NAMES: Effect = { kind: 'names' };
export const all = (why: string): Effect => ({ kind: 'all', why });

export const none = (): Row => ({ effect: NONE });
export const followed = (tests: readonly string[]): Row => ({ effect: FOLLOWED, tests });
export const names = (): Row => ({ effect: NAMES });
/** A row that trusts nothing, for `why`. */
export const blinds = (why: string): Row => ({ effect: all(why) });

/** The row of a construct the table does not have (`what` says which): it may change anything. */
export const unlisted = (what: string): Row => blinds(`${what}, which the allow-list does not have`);

/** The node types of the syntax tree (src/syntax/tree.ts). */
export const SYNTAX: Readonly<Record<NodeType, Row>> = {
  // The walk: statements and their parts.
  program: followed(['state#prefix-assign']),
  comment: none(),
  command: followed(['state#prefix-assign']),
  command_name: followed(['names#function-over-builtin']),
  variable_assignment: followed(['values#assign-chain']),
  negated_command: followed(['status#negation']),
  // (Its redirections: the redirection rows.)
  redirected_statement: followed(['words#brace-redirect']),
  pipeline: followed(['env#pipeline-stages']),
  list: followed(['status#and-list', 'generator: list']),
  command_list: followed(['status#status-after-false']),
  time_statement: followed(['status#time-false']),
  compound_statement: followed(['status#brace-group', 'generator: brace group']),
  subshell: followed(['env#subshell-paren', 'generator: subshell']),
  do_group: followed(['generator: do']),
  if_statement: followed(['status#if-while-false', 'generator: if']),
  elif_clause: followed(['generator: elif']),
  else_clause: followed(['generator: else']),
  case_item: followed(['generator: case']),
  while_statement: followed(['status#while-until', 'generator: while', 'generator: until']),
  c_style_for_statement: followed(['generator: for (( ))']),
  arithmetic_command: followed(['status#arith-command', 'generator: (( ))']),
  extended_test: followed(['values#test-n', 'generator: [[']),
  // A function: the walk walks each call it sees; one called otherwise is not closed (`Trust.closed`).
  function_definition: followed(['env#function-call', 'generator: function definition']),
  // (The patterns after `;&` and `;;&`: expanded in the state after the list before them.)
  case_statement: followed(['generator: case']),
  // The loop variable; `select`'s is what the user types.
  for_statement: names(),
  select_statement: names(),
  // The coprocess's array and its `_PID`.
  coproc_statement: names(),
  // Words and their parts: the word model (src/semantics/words.ts).
  word: followed(['words#split-quoting']),
  concatenation: followed(['words#concat-empty']),
  string: followed(['words#split-quoting']),
  string_content: followed(['words#split-quoting']),
  raw_string: followed(['words#split-quoting']),
  ansi_c_string: followed(['words#ansi-c-ifs']),
  number: followed(['values#assign-chain']),
  regex: followed(['generator: =~']),
  array: followed(['values#array-declare-i']),
  // (Never given as a value: `$"…"`, a brace expansion, a glob.)
  translated_string: none(),
  brace_expression: none(),
  extglob_pattern: none(),
  // Expansions: the operators below.
  simple_expansion: followed(['values#split-unquoted']),
  expansion: followed(['values#param-forms']),
  variable_name: followed(['values#split-unquoted']),
  special_variable_name: followed(['values#special-params']),
  subscript: followed(['values#test-v-subscript']),
  // (`$( )` runs in a subshell; `${ …; }` and `${| …; }` of bash 5.3 in this shell, which the walk follows.)
  command_substitution: followed(['values#command-subst', 'generator: command substitution', 'state#funsub-keeps', 'state#funsub-scope', 'state#valsub-reply',
    'state#funsub-return', 'env#funsub-shell', 'status#funsub-errexit', 'words#valsub-value']),
  // (A subshell: its own commands are looked up as well.)
  process_substitution: none(),
  arithmetic_expansion: followed(['values#arith-expansion']),
  // Expressions of tests and arithmetic.
  binary_expression: followed(['generator: [[ $v op']),
  unary_expression: followed(['generator: [[ -z']),
  parenthesized_expression: followed(['state#arith-parens']),
  ternary_expression: followed(['words#arith-ternary']),
  postfix_expression: followed(['generator: (( v++ ))']),
  test_operator: followed(['generator: [[ -z']),
  // Redirections: the rows of REDIRECTIONS.
  file_redirect: followed(['words#redirect-word-split']),
  file_descriptor: followed(['words#redirect-fd-word']),
  heredoc_redirect: followed(['words#heredoc-body']),
  heredoc_start: followed(['words#heredoc-body']),
  heredoc_body: followed(['words#heredoc-body']),
  heredoc_content: followed(['words#heredoc-body']),
  heredoc_end: followed(['words#heredoc-body']),
  herestring_redirect: followed(['words#herestring', 'generator: <<<']),
  // Text our parser could not read: bash may read it otherwise.
  error: blinds('text the parser could not read'),
};

/**
 * A builtin: its own row, that of an option its spec does not know (bash may take it), and those of options that do
 * more than the builtin's row says (`jobs -x`), by flag.
 */
export interface BuiltinRow extends Row {
  readonly unknownOption: Row;
  readonly options?: Readonly<Record<string, Row>>;
}

type BuiltinRowOf = Row & { readonly unknownOption?: Row; readonly options?: Readonly<Record<string, Row>> };
const builtin = (row: Row, unknownOption?: Row, options?: Readonly<Record<string, Row>>): BuiltinRowOf => ({ ...row, ...(unknownOption ? { unknownOption } : {}), ...(options ? { options } : {}) });
/** `ulimit -n` and `-u` may lower a limit: then a redirection (even to /dev/null), a pipe of `$( )` or a fork fails. */
const LIMITS = blinds('`ulimit -n` or `-u` may make a redirection, a pipe or a fork fail');
/** `mapfile -C` runs its text in this shell, as `eval` does (with the index and the line after it). */
const MAPFILE_CALLBACK = { '-C': blinds('`mapfile -C` runs code in this shell') };

/**
 * Each of bash's 61 builtins (`compgen -b`, the same in 5.2 and 5.3). What their specs say is read from them, for
 * every builtin: the variables an option or operand names (`read x`, `printf -v x`: names), the functions run later
 * (`complete -F f`: not closed), a file or command line run unread (`source`: all), and what they alter
 * (`shellEffect`). The rows say the rest.
 */
const BUILTIN_ROWS: Readonly<Record<string, BuiltinRowOf>> = {
  // They change nothing a value or a decision reads. (`echo`, `printf`, `:`, `true` and `false` print or ignore a word
  // that looks like an option.)
  ':': builtin(none(), none()), true: builtin(none(), none()), false: builtin(none(), none()),
  echo: builtin(none(), none()), printf: builtin(none(), none()),
  pwd: builtin(none()), type: builtin(none()), help: builtin(none()), times: builtin(none()), caller: builtin(none()),
  dirs: builtin(none()), disown: builtin(none()), suspend: builtin(none()), logout: builtin(none()),
  ulimit: builtin(none(), undefined, { '-n': LIMITS, '-u': LIMITS }),
  umask: builtin(none()), hash: builtin(none()), bind: builtin(none()), history: builtin(none()), kill: builtin(none()),
  wait: builtin(none()), bg: builtin(none()), fg: builtin(none()),
  // (A function named as a callback, `complete -F f`, is not closed. `complete -C` and `-F` run when a command is
  // completed, in an interactive shell only.)
  complete: builtin(none()), compopt: builtin(none()),
  // `jobs -x` runs its command in this shell (its spec's command slot).
  jobs: builtin(none(), undefined, { '-x': blinds('`jobs -x` runs a command in this shell') }),
  // PWD, OLDPWD and DIRSTACK; the positional parameters (never trusted).
  cd: builtin(names()), pushd: builtin(names()), popd: builtin(names()), shift: builtin(names()),
  read: builtin(names()), mapfile: builtin(names(), undefined, MAPFILE_CALLBACK), readarray: builtin(names(), undefined, MAPFILE_CALLBACK),
  getopts: builtin(names()),
  // Jumps (a count not known takes both paths).
  exit: builtin(followed(['status#exit-status', 'generator: exit'])), return: builtin(followed(['status#return-status', 'generator: return'])),
  break: builtin(followed(['generator: break'])), continue: builtin(followed(['generator: continue'])),
  // `x=w` with no option but -r, -x and -g; names for the other options; the nameref rule for -n; all for a name not known,
  // and for an option the spec does not know.
  declare: builtin(followed(['values#declare-export-readonly'])), typeset: builtin(followed(['state#declare-attributes'])),
  local: builtin(followed(['values#local-shadow', 'generator: local'])), export: builtin(followed(['values#declare-export-readonly', 'generator: export'])),
  readonly: builtin(followed(['values#declare-export-readonly'])),
  unset: builtin(followed(['values#unset-ifs', 'generator: unset'])),
  let: builtin(followed(['status#let-assign', 'generator: let'])),
  // The string the walk reads; else all.
  eval: builtin(followed(['values#eval-string'])),
  source: builtin(blinds('a file is sourced')), '.': builtin(blinds('a file is sourced')),
  // An action the walk reads (foreign text); all for DEBUG, RETURN, or an action not known.
  trap: builtin(followed(['values#trap-action'])),
  alias: builtin(followed(['state#alias-unalias'])), unalias: builtin(followed(['state#alias-unalias'])),
  // `-n NAME`, `-ns NAME`, `-n -s NAME`, `-n -a NAME`, `NAME`; all for -f or a name not known.
  enable: builtin(followed(['values#enable-n-exit'])),
  set: builtin(followed(['state#set-euo-pipefail', 'generator: set option'])), shopt: builtin(followed(['state#shopt-extglob-nullglob', 'generator: shopt -s'])),
  // Precondition: no word may be `-v` with an operand that has a subscript. (Their words are the expression's, which
  // the handler reads: `[ -a file ]` is no option.)
  test: builtin(followed(['generator: test']), none()), '[': builtin(followed(['generator: [ test']), none()),
  command: builtin(followed(['env#command-builtin-time'])), builtin: builtin(followed(['env#command-builtin-time'])),
  // A quiet word list and no -F or -C; else all.
  compgen: builtin(followed(['values#compgen-word-list']), blinds('`compgen` expands a word list or runs a command the model does not read')),
  // `fc -l` lists; else all.
  fc: builtin(followed(['values#fc-substitute'])),
  exec: builtin(followed(['words#exec-redirect'])),
};

/**
 * Each of bash's 61 builtins, with the row of an option its spec does not know: bash may take it, and the scan cannot
 * say what it does (all), unless the row says otherwise.
 */
export const BUILTINS: Readonly<Record<string, BuiltinRow>> = Object.fromEntries(Object.entries(BUILTIN_ROWS).map(([name, row]) =>
  [name, { ...row, unknownOption: row.unknownOption ?? blinds(`\`${name}\` is given an option its spec does not know`) }]));

/** The options of `set -o` (the same 27 in bash 5.2 and 5.3), by what turning them on does (and off, `off`). */
export interface OptionRow extends Row {
  /** The effect when the option is turned off, where it differs. */
  readonly off?: Row;
}

/** An option that trusts nothing when it is turned on, for `why`. */
const onOnly = (why: string): OptionRow => ({ ...blinds(why), off: none() });

export const SET_OPTIONS: Readonly<Record<string, OptionRow>> = {
  allexport: followed(['state#set-allexport']), errexit: followed(['status#errexit-subshell', 'generator: set -e']), nounset: followed(['status#nounset-expansion', 'generator: set -u']),
  noglob: followed(['words#noglob']), pipefail: followed(['status#pipefail', 'generator: set -o pipefail']), monitor: followed(['env#monitor-lastpipe']),
  braceexpand: followed(['words#no-braceexpand']),
  // (With the PS4 rule.)
  xtrace: followed(['values#xtrace-ps4']),
  // (errtrace and functrace only change where the ERR, DEBUG and RETURN traps run.)
  emacs: none(), vi: none(), ignoreeof: none(), nolog: none(), notify: none(), verbose: none(), hashall: none(), physical: none(),
  privileged: none(), 'interactive-comments': none(), errtrace: none(), functrace: none(),
  // `!!` runs an earlier line.
  // (Turned off, these change nothing.)
  histexpand: onOnly('`set -H` (histexpand): history expansion may run an earlier line'), history: onOnly('`set -o history`: history expansion may run an earlier line'),
  // An assignment word anywhere in a command is an assignment for it.
  keyword: onOnly('`set -k` (keyword) makes every assignment word one for its command'),
  // With it, a `>` may fail on an existing file: the walk takes every redirection to a file as one that may fail.
  noclobber: followed(['values#noclobber-declare']),
  // The commands after it do not run.
  noexec: onOnly('`set -n` (noexec) stops running commands'), onecmd: onOnly('`set -t` (onecmd) stops running commands'),
  // Until the POSIX-mode rows of docs/design/bash-versions.md, step 6. (A script that starts in POSIX mode, `sh` or
  // `#!/bin/bash --posix`, is walked so from its start.)
  posix: blinds('`set -o posix` turns on POSIX mode, which the walk does not follow from there'),
};

/** The options of `shopt` (57 in bash 5.2; 5.3 adds `array_expand_once` and `bash_source_fullpath`, SINCE in src/bashversion.ts). */
export const SHOPT_OPTIONS: Readonly<Record<string, OptionRow>> = {
  expand_aliases: followed(['state#expand-aliases']), extglob: followed(['words#extglob']), nocasematch: followed(['generator: nocasematch']),
  lastpipe: followed(['env#lastpipe']), inherit_errexit: followed(['status#inherit-errexit']), failglob: followed(['words#failglob']),
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
    'assoc_expand_once', 'array_expand_once'].map((o) => [o, onOnly(`\`shopt -s ${o}\` changes what bash does in ways the walk does not follow`)])),
  // Turned off: `$'…'` inside `"${x:-…}"`, and ranges in patterns by the locale.
  ...Object.fromEntries(['extquote', 'globasciiranges'].map((o) => [o, { ...none(), off: blinds(`\`shopt -u ${o}\` changes what bash does in ways the walk does not follow`) }])),
};

/**
 * The operators of a parameter expansion (3.5.3), as `expansionOperator` names them: `$x` and `${x}` (''), the length
 * `${#x}`, the forms after the name (`:-`, `#`, `/`, `^`…), the offset `:`, the transformations `@Q`…, and the
 * indirections `!` (`${!x}`), `!@` and `!*` (the names with a prefix) and `![@]` (the keys of an array).
 */
export const EXPANSION_OPERATORS: Readonly<Record<string, Row>> = {
  '': followed(['values#split-unquoted']), length: none(),
  '-': none(), ':-': none(), '+': none(), ':+': none(), '?': none(), ':?': none(),
  '#': none(), '##': none(), '%': none(), '%%': none(), '/': none(), '//': none(), '/#': none(), '/%': none(),
  '^': none(), '^^': none(), ',': none(), ',,': none(), '~': none(), '~~': none(),
  // The variable (`${x:=w}`): names. A set `x` keeps its value, which may come from the environment.
  '=': names(), ':=': names(),
  // Arithmetic.
  ':': followed(['generator: substring expansion']),
  '@Q': none(), '@E': none(), '@A': none(), '@a': none(), '@K': none(), '@k': none(), '@U': none(), '@u': none(), '@L': none(),
  // Precondition: every value the script gives it is quiet, and none is made with `+=` (it joins texts that are quiet alone).
  '@P': followed(['values#prompt-expansion']),
  // `${!x}` and the other indirections: all; the keys and the names with a prefix, with nothing after them: none.
  '!': followed(['values#indirect']), '!@': none(), '!*': none(), '![@]': none(),
};

/** The redirection operators (3.6), as the parser gives them. */
export const REDIRECTIONS: Readonly<Record<string, Row>> = {
  // A here-document and a here-string do not fail; their words are looked up as words.
  '<<': followed(['words#heredoc-body']), '<<-': followed(['words#heredoc-tab']), '<<<': followed(['words#herestring']),
  // The others may fail, and then their command does not run (the walk takes it as one that may not run).
  // `{fd}>…`: names `fd`; `{a[i]}>…`: names `a`, and `i` is arithmetic.
  '<': followed(['words#redirect-input']), '>': followed(['words#redirect-word-split']), '>>': followed(['test/tests-redirections-real.test.ts: a file is still opened, created or emptied']), '<>': followed(['test/tests-redirections-real.test.ts: a file is still opened, created or emptied']),
  '>|': followed(['test/tests-redirections-real.test.ts: is not replaced when a redirection between copies it, or sets another descriptor']), '&>': followed(['test/tests-redirections-real.test.ts: is not replaced when a redirection between copies it, or sets another descriptor']), '&>>': followed(['test/redirections.test.ts: are explained with the command, wherever they are written']), '<&': followed(['env#process-subst-fd']),
  '>&': followed(['state#redirect-dup-exec']),
};

const rowOf = <R>(table: Readonly<Record<string, R>>, key: string, missing: () => R): R => (Object.hasOwn(table, key) ? table[key] : missing());

/** The row of a node type (one the table does not have trusts nothing). */
export const syntaxRow = (type: string): Row => rowOf<Row>(SYNTAX, type, () => unlisted(`the node type \`${type}\``));

/**
 * A name of the dictionary that is no builtin of bash (zsh's `setopt`): bash runs a program of that name in a child
 * process, or finds none, which changes nothing of this shell.
 */
export const PROGRAM: BuiltinRow = { effect: NONE, unknownOption: { effect: NONE } };
/** The row of a builtin (`PROGRAM` for a name of the dictionary that is no builtin of bash). */
export const builtinRow = (name: string): BuiltinRow => rowOf(BUILTINS, name, () => PROGRAM);

/** The row of an option of `set -o` or `shopt` (`table`), turned on or off (one the table does not have trusts nothing). */
export function optionRow(table: Readonly<Record<string, OptionRow>>, name: string, on: boolean): Row {
  const row = rowOf<OptionRow>(table, name, () => unlisted(table === SET_OPTIONS ? `\`set ${on ? '-' : '+'}o ${name}\`` : `\`shopt ${on ? '-s' : '-u'} ${name}\``));
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
export function expansionRow(n: SyntaxNode): Row {
  const op = expansionOperator(n);
  return rowOf<Row>(EXPANSION_OPERATORS, op, () => unlisted(n.text.length <= 40 ? `the parameter expansion \`${n.text}\`` : `the operator \`${op}\` of a parameter expansion`));
}

/** The row of a redirection, by its operator. */
export function redirectionRow(n: SyntaxNode): Row {
  const op = n.children.find((c) => !c.named)!.type;
  return rowOf<Row>(REDIRECTIONS, op, () => unlisted(`the redirection operator \`${op}\``));
}

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
