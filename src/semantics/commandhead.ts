// What the name of a simple command runs, and the spec its words are read with (docs/design/known-values.md, section 3: a
// slice of `commandRead(n)`, docs/design/sources.md, SC2). The explanation of the command (src/explain/commands.ts) says
// it in words; the reading of its words (src/semantics/commandread.ts) reads them with the spec. Both read these facts,
// so a line that explains the command and one that reads a word of it on another line read it the same way.
import type { Kind } from '../analyzer-types';
import type { CommandSpec, ShellVariant } from '../argv/spec';
import { type BashVersion, DEFAULT_BASH_VERSION } from '../bashversion';
import { lookupCommand } from '../dict/aliases';
import { customCommandSpec } from '../dict/custom';
import { type DistroAlias, distroAliases } from '../dict/distroAliases';
import { yqSpecsOf } from '../dict/yq';
import { judgeYq, type YqVerdict } from '../embedded/yq';
import type { HostId } from '../hosts';
import { lineListLabel } from '../i18n';
import { isProgram } from '../namefacts';
import { isBash, type RealShell } from '../shellfeatures';
import { isPlainWord, literalContent, plainText, staticWordValue, unquotedWord } from '../staticword';
import type { SyntaxNode } from '../syntax/tree';
import { braceExpansion } from './brace';
import { readAs } from './env';
import { type AliasResolution, type MaybeHashed, type Missed, type NameResolution, resolveName, testSpecOf } from './names';
import { docLine, option, type StateModel } from './state';
import { wordMeaning } from './words';

/** The spec of a command with none: no options, no operands. */
export const NO_SPEC: CommandSpec = { summary: { ja: '', en: '' } };

/**
 * What the lookup of a command's spec reads besides the model: the `customCommands` setting, the commands of the host
 * (bats' `run`), what tells the three yq apart (`judgeYq`: the document's text, its host, the `yqFlavor` setting), and
 * the bash release (the limits of a brace expansion's sequences). The text is the model's tree's, so it is not part of
 * a key (`lookupKey`).
 */
export interface CommandLookup {
  readonly customCommands?: Readonly<Record<string, unknown>>;
  readonly hostCommands?: Readonly<Record<string, CommandSpec>>;
  readonly yq: { readonly doc: string; readonly host?: HostId; readonly setting?: string };
  readonly bashVersion?: BashVersion;
}

/** A command the host defines (a function of bats, which a path does not name). */
export function hostSpecIn(lookup: CommandLookup, name: string): CommandSpec | undefined {
  const host = lookup.hostCommands;
  return host && Object.hasOwn(host, name) ? host[name] : undefined;
}

/** The spec of a command a wrapper runs: from the customCommands setting, the host, or the dictionary. */
export function specIn(lookup: CommandLookup, name: string): CommandSpec | undefined {
  return customSpecIn(lookup, name) ?? hostSpecIn(lookup, name) ?? lookupCommand(name);
}

/** The spec the customCommands setting gives the command `name` (by the last part of a path). */
export function customSpecIn(lookup: CommandLookup, name: string): CommandSpec | undefined {
  return customCommandSpec(lookup.customCommands?.[name.split('/').pop()!]);
}

/**
 * The program a file name runs when `hash -p` gave it a path or `enable -n` turned the builtin of its name off
 * (`form`): the path (when hashed by an absolute one), the spec of the program, from the dictionary (a builtin's
 * `program`). A relative path runs from the current directory (`hash -p tac sort`: `./tac`, `res.relative`), an empty
 * one runs nothing, and one not known is known only at run time (`hash -p "$p" sort`): no program the dictionary knows;
 * its words are read with `words`, which names no manual.
 */
export interface OffProgram {
  form: 'disabled' | 'unknown' | 'empty' | 'relative' | 'path';
  path: string | undefined; program: CommandSpec | undefined; words?: CommandSpec;
}

export function offProgram(res: Extract<NameResolution, { kind: 'file' }>): OffProgram {
  const name = res.name;
  // (Only a builtin is turned off: the program its entry describes.)
  if (!res.hashed) return { form: 'disabled', path: undefined, program: lookupCommand(name)!.program };
  const { value } = res.hashed;
  // (The commands that gave it, when several did: `hash -p /x a; [ c ] && hash -p /x a`.)
  const none = { path: undefined, program: undefined, words: hashedWords(res.hashed.may ? res.hashed.may.map((o) => o.at!) : [res.hashed.at], name) };
  if (value === undefined) return { form: 'unknown', ...none };
  if (value === '') return { form: 'empty', ...none };
  if (res.relative) return { form: 'relative', ...none };
  // (A path is never a builtin's entry: `/bin/echo` is the program.)
  return { form: 'path', path: value, program: lookupCommand(value) };
}

/** The lines of `nodes`: 1-based, in order, once each. */
export const linesIn = (nodes: readonly SyntaxNode[]): number[] => [...new Set(nodes.map((x) => docLine(x) + 1))].sort((x, y) => x - y);

/** The spec the words of a program `hash -p` gave `name` (on the lines of `by`) are read with, which the dictionary does not describe: no manual. */
function hashedWords(by: readonly SyntaxNode[], name: string): CommandSpec {
  const lines = linesIn(by);
  return { ...NO_SPEC, unknownOption: { ja: `${lineListLabel('ja', lines)} の \`hash -p\` で \`${name}\` が指すプログラムに渡す単語（辞書にない）`, en: `A word passed to the program \`hash -p\` on ${lineListLabel('en', lines)} gave \`${name}\`, which the dictionary does not describe` } };
}

/**
 * The table of `hash -p` that a name resolved to `res` may run from where it differs with the path taken, also through
 * the aliases it runs, and the name it is for: what makes it no plain command of its name (no example of it).
 */
export function maybeHashedOf(res: NameResolution | undefined): { name: string; m: MaybeHashed } | undefined {
  if (res?.kind === 'file' && res.maybeHashed) return { name: res.name, m: res.maybeHashed };
  if (res?.kind === 'alias') return maybeHashedOf(res.target) ?? maybeHashedOf(res.otherwise);
  return undefined;
}

/** An alias whose text is one plain word: the alias runs that command with the same words. */
function alias1(value: string): boolean {
  return /^[^\s;|&<>()'"`$\\=]+$/.test(value);
}

/**
 * How the name of a command is read, each with the facts its text says (src/explain/commands.ts, `headOf`):
 * - `expanded`: an expansion the model does not read, or a glob (`$cmd -x`, `f* -x`);
 * - `alias`: an alias, with what it runs (`runs`: through the aliases whose text is one word), the program of a builtin
 *   turned off or of a path `hash -p` gave (`other`), a table of `hash -p` that differs (`maybe`), the spec of what it runs
 *   (`target`), and whether a file with no shebang may not expand it (`maybeSourced`);
 * - `alias-off`, `alias-unexpanded`: an alias bash does not expand in a script (`shopt -u expand_aliases`, or off by default);
 * - `alias-later`: an alias defined after the use, or in the same unit, with a program of that name;
 * - `function`: a function of the script (`globs`: its name is a glob, which a file may match);
 * - `sourced`: a name the dictionary does not know after a `source`;
 * - `maybe-hashed`: a path of `hash -p` on every path, not the same one;
 * - `off`: a builtin turned off with `enable -n`, or a name `hash -p` gave a path;
 * - `custom`, `no-shell` (a builtin's or a keyword's name no shell reads), `not-builtin` (a builtin of other shells), `spec`
 *   (the host's or the dictionary's), `distro` (an alias or function of some systems; `interactive`: typed into a terminal),
 *   `path`, `unknown`.
 */
export type HeadHow =
  | { case: 'expanded' }
  | { case: 'alias'; alias: AliasResolution; runs: NameResolution | undefined; other?: OffProgram; maybe?: { name: string; m: MaybeHashed }; target?: CommandSpec; maybeSourced: boolean }
  | { case: 'alias-off' | 'alias-unexpanded'; first: number; value: string; unread: boolean }
  | { case: 'alias-later'; first: number }
  | { case: 'function'; res: Extract<NameResolution, { kind: 'function' }>; globs: boolean }
  | { case: 'sourced'; sourced: SyntaxNode }
  | { case: 'maybe-hashed'; m: MaybeHashed }
  | { case: 'off'; res: Extract<NameResolution, { kind: 'file' }>; off: OffProgram }
  | { case: 'custom' }
  | { case: 'no-shell'; skips: 'builtin' | 'keyword'; entry?: CommandSpec; program?: CommandSpec }
  | { case: 'not-builtin'; notBuiltin: { lacks: readonly RealShell[]; has: readonly RealShell[] } }
  | { case: 'spec' }
  | { case: 'distro'; distro: DistroAlias; interactive: boolean }
  | { case: 'path' }
  | { case: 'unknown' };

/**
 * An alias of the name that bash does not expand here, said before what the name runs instead: `not-expanded` (expand_aliases
 * off, `off` by the script, `maybe` where it may be on), `later` or `same-unit` (defined after the use, or in the line that uses it).
 */
export type AliasMiss =
  | { why: 'not-expanded'; value: string; off: boolean; maybe?: Missed['maybe'] }
  | { why: 'later' | 'same-unit'; first: number };

/** What the name of a simple command runs, and the spec of its words (see `HeadHow`). */
export interface HeadFacts {
  /** The name as bash reads it: the first word of its brace expansion, the text quotes spell, or the word. */
  readonly name: string;
  readonly how: HeadHow;
  /** What bash runs for the name (src/semantics/names.ts), whose facts the badge shows; none for an expansion, or a system's alias typed into a terminal. */
  readonly res?: NameResolution;
  readonly kind: Kind;
  /** The spec of the command's words, before the variant of the shell options (`variant`). */
  readonly base?: CommandSpec;
  /** The spec of the command's words: `base` with the fields of `variant`. */
  readonly spec?: CommandSpec;
  /** A call of a function defined in the script (`maybe`: on some paths only). */
  readonly fn?: true | 'maybe';
  /** The name is an expansion the model does not read: no name for the argument reader (`$cmd -x`). */
  readonly unnamed?: true;
  /** The command whose spec reads the words, when it is not `name`: what an alias runs (`alias g=grep`), a path `hash -p` gave. */
  readonly runs?: string;
  /** The spec of `test` or `[`, when the name runs one of them (src/semantics/names.ts, `testSpecOf`). */
  readonly test?: CommandSpec;
  /** The words a brace expansion of the name gives (`{echo,hi}`): the first is the command. */
  readonly braced?: readonly string[];
  /** An alias of the name that is not expanded here (`AliasMiss`). */
  readonly aliasMiss?: AliasMiss;
  /** A definition of the name that does not apply here, which the explanation notes (a function defined later…). */
  readonly missed?: Missed;
  /** Which of the three yq the command is, when its name is `yq`. */
  readonly yq?: YqVerdict;
  /** The variant of a builtin for the shell options on here (`kill` in POSIX mode, 6.11). */
  readonly variant?: ShellVariant;
}

/** Whether braces of the word `n` expand there: not in a shell without them, a context where they do not, or with `set +B` on every path. */
export function bracesHereIn(model: StateModel, n: SyntaxNode): boolean {
  const step = wordMeaning(n, model)?.steps.find((s) => s.kind === 'brace');
  return step?.why !== 'dialect' && step?.why !== 'context' && !(step?.why === 'braceexpand-off' && step.applies === false);
}

/** The words a word gives by brace expansion; undefined when it gives none (or too many to list). */
export function braceWordsIn(model: StateModel, n: SyntaxNode, version: BashVersion): string[] | undefined {
  return bracesHereIn(model, n) ? braceExpansion(n, version) ?? undefined : undefined;
}

/**
 * The variant of the builtin spec `spec` for the shell options on at `n` (`CommandSpec.inShell`: `kill` in POSIX mode,
 * 6.11), or undefined. Only bash's: another shell's builtin is its own.
 */
export function shellVariantIn(model: StateModel, n: SyntaxNode, spec: CommandSpec): ShellVariant | undefined {
  if (!spec.inShell || isBash(model.shell) !== 'yes') return undefined;
  const st = model.at(n).run;
  return spec.inShell.find((v) => (v.set ?? []).every((o) => option(st, 'set', o) === 'on') && (v.shopt ?? []).every((o) => option(st, 'shopt', o) === 'on'));
}

/**
 * What the name `nameNode` of the simple command `n` runs (`word`: the word of the name), and the spec its words `args`
 * are read with: a brace expansion's first word, the command bash resolves, the spec of yq's flavour, the variant of a
 * builtin for the shell options.
 */
export function headFacts(model: StateModel, lookup: CommandLookup, n: SyntaxNode, nameNode: SyntaxNode, args: readonly SyntaxNode[], word = nameNode.namedChildren[0]!): HeadFacts {
  // `{echo,hi}` is a brace expansion first: the command is the first word it gives (`echo`), with the others as arguments.
  const braced = unquotedWord(word) !== undefined ? braceWordsIn(model, word, lookup.bashVersion ?? DEFAULT_BASH_VERSION) : undefined;
  let head: HeadFacts = braced?.length ? { ...headOf(model, lookup, nameNode, word, braced[0]), braced } : headOf(model, lookup, nameNode, word);
  const yq = yqSpecsOf(head.name);
  if (yq) {
    // Three tools are called yq; the arguments are read as the one this command is for.
    const verdict = judgeYq(args.map((a) => literalContent(a)?.text), { doc: lookup.yq.doc, host: lookup.yq.host, setting: lookup.yq.setting });
    head = { ...head, base: yq[verdict.flavor], spec: yq[verdict.flavor], yq: verdict };
  }
  // (A builtin that reads its words otherwise in the shell options on here: `kill` in POSIX mode, 6.11.)
  const variant = head.kind === 'builtin' ? shellVariantIn(model, n, head.spec!) : undefined;
  return variant ? { ...head, spec: { ...head.spec!, ...variant.spec }, variant } : head;
}

function headOf(model: StateModel, lookup: CommandLookup, nameNode: SyntaxNode, word: SyntaxNode, as?: string): HeadFacts {
  const shell = model.shell;
  const resolve = (name: string, at: SyntaxNode, opts: { quoted?: boolean } = {}): NameResolution => resolveName(model, name, at, { shell, command: true, program: isProgram, ...opts });
  // Commands with an empty name (`FOO=1 2>/dev/null`) do not get here.
  // A name made of quotes, escapes or empty `$(:)` is the command it spells once they are removed (`e\c'h'"o"` is `echo`).
  const spelled = staticWordValue(word, false, shell);
  const sv = spelled && spelled !== word.text ? spelled : undefined;
  const name = as ?? sv ?? (isPlainWord(word) ? word.text : nameNode.text);
  // (A word of plain text with braces is the first word they give, `as`; where they do not expand, `{echo,hi}` in dash, it is a name as written.)
  const plain = isPlainWord(word) || (plainText(word) && (as !== undefined || !bracesHereIn(model, word)));
  // (A glob is read from the files, `f* -x`: the first match is the command and the others its words, as an expansion's.
  // But an alias is expanded before the glob, and a function of that name runs when no file matches: both are read as they are.)
  const globs = sv === undefined && as === undefined && plain && word.type !== 'raw_string' && !!wordMeaning(word, model)?.steps.some((st) => st.kind === 'glob' && st.applies !== false && st.parts.length > 0);
  const globbed = globs && !['alias', 'function'].includes(resolve(name, nameNode, { quoted: false }).kind);
  if (sv === undefined && (!plain || globbed) && word.type !== 'raw_string') return { name, how: { case: 'expanded' }, kind: 'command', unnamed: true };
  // What bash runs (src/semantics/names.ts). An alias over a known command that runs that command with more words
  // (`alias grep='grep --color=auto'`) is still read as that command; one that runs something else (`alias
  // echo=printf`, `alias [=echo`) is the alias. (A quoted name is never an alias.)
  const ran = resolve(name, nameNode, { quoted: sv !== undefined });
  const known = !!lookupCommand(name);
  // (Not `test` or `[` with more words, `alias [='[ -n x'`: they change the expression.)
  const same = ran.kind === 'alias' && ran.target?.name === name && (alias1(ran.alias.value) || !testSpecOf(ran.target));
  const res = same && known ? resolve(name, nameNode, { quoted: true }) : ran;
  if (res.kind === 'alias') {
    // The words after the name are read with the spec of the command the alias runs, when its text is that name
    // alone at each step (`alias g=grep`: `g -n x f`). With more words (`alias ll='ls -l'`), they go after those.
    let runs: NameResolution | undefined = res;
    while (runs?.kind === 'alias' && alias1(runs.alias.value)) runs = runs.target;
    // (What `hash -p` or `enable -n` makes of the name it runs: the program of that path or name, as when the name is not an alias.)
    const other = runs?.kind === 'file' && (runs.disabled || runs.hashed) ? offProgram(runs) : undefined;
    // (A name that may run a path of `hash -p` has no one spec.)
    const maybe = maybeHashedOf(runs);
    const target = runs && runs.kind !== 'alias' && res.sure && !maybe && (runs.kind === 'builtin' || runs.kind === 'file') && !testSpecOf(runs) ? (other ? other.program : specIn(lookup, runs.name)) : undefined;
    const alias = res.alias;
    const spec: CommandSpec = target ?? { ...NO_SPEC, unknownOption: { ja: `エイリアスの置き換え先 \`${alias.value}\` に渡す単語`, en: `A word passed on to \`${alias.value}\`, the text of the alias` } };
    // (A file with no shebang: aliases are expanded only when an interactive shell reads it, `.bashrc`; the model
    // starts it with expand_aliases not known, src/semantics/state.ts.)
    const maybeSourced = !res.sure && alias.state === 'on' && readAs(model.env(nameNode), model.read) === 'unknown';
    return {
      name, res: ran, kind: 'alias', base: spec, spec, ...(target ? { runs: runs!.name } : {}),
      how: { case: 'alias', alias: res, runs, ...(other ? { other } : {}), ...(maybe ? { maybe } : {}), ...(target ? { target } : {}), maybeSourced },
    };
  }
  // (The parser has read it as a command name: not a keyword.)
  const missed = (res as { missed?: Missed }).missed;
  const facts = { name, res: ran };
  // (An alias of the name that bash does not expand here, said before what runs instead.)
  let aliasMiss: AliasMiss | undefined;
  if (missed?.kind === 'alias' && !known) {
    const first = missed.def.startPosition.row + 1;
    // (Not where a function of that name surely runs instead, `ll() { …; }`. Where one may, or code not read may turn
    // expand_aliases on, the model says the miss may not happen: `Missed.maybe`, a caveat.)
    if (missed.why === 'expand_aliases' && !(res.kind === 'function' && res.sure)) {
      const value = model.at(nameNode).expand.aliases.get(name)!.value;
      // (Turned off by the script, `shopt -u expand_aliases`: also in an interactive shell.)
      const off = option(model.at(nameNode).expand, 'shopt', 'expand_aliases') === 'off';
      aliasMiss = { why: 'not-expanded', value, off, ...(missed.maybe ? { maybe: missed.maybe } : {}) };
      // (A function that may run instead: its own text says where it is defined.)
      if (res.kind !== 'function') return { ...facts, kind: 'alias', aliasMiss, how: { case: off ? 'alias-off' : 'alias-unexpanded', first, value, unread: missed.maybe === 'unread' } };
    } else if (missed.why === 'later' || missed.why === 'same-unit') {
      aliasMiss = { why: missed.why, first };
      if (res.kind === 'file') return { ...facts, kind: 'command', aliasMiss, how: { case: 'alias-later', first } };
    }
  }
  const head = res.kind === 'function' ? functionHead(facts, res, globs) : lateHead(model, lookup, nameNode, name, ran, res, sv, missed);
  return aliasMiss ? { ...head, aliasMiss } : head;
}

function functionHead(facts: { name: string; res: NameResolution }, res: Extract<NameResolution, { kind: 'function' }>, globs: boolean): HeadFacts {
  return { ...facts, kind: 'function', fn: res.sure || 'maybe', how: { case: 'function', res, globs } };
}

/** What a name runs that is no alias and no function (with the definition that does not apply, `missed`, which the explanation notes first). */
function lateHead(model: StateModel, lookup: CommandLookup, nameNode: SyntaxNode, name: string, ran: NameResolution, res: NameResolution, sv: string | undefined, missed: Missed | undefined): HeadFacts {
  const facts = { name, res: ran, ...(missed ? { missed } : {}) };
  const withSpec = (spec: CommandSpec | undefined) => (spec ? { base: spec, spec } : {});
  // After `source`, a name the dictionary does not know may be a function of the file read.
  if (res.kind === 'file' && res.sourced) return { ...facts, kind: 'command', how: { case: 'sourced', sourced: res.sourced } };
  // Where every path runs a path of `hash -p`, but not the same one, it runs one of them.
  if (res.kind === 'file' && res.maybeHashed && !res.maybeHashed.search) {
    return { ...facts, kind: 'command', ...withSpec(hashedWords(res.maybeHashed.by, name)), how: { case: 'maybe-hashed', m: res.maybeHashed } };
  }
  // A builtin turned off with `enable -n` runs the program of its name; `hash -p` gives a name a path.
  if (res.kind === 'file' && (res.disabled || res.hashed)) {
    const off = offProgram(res);
    // (The words are read as when the path is written out: the program is that file.)
    return { ...facts, kind: 'command', ...withSpec(off.program ?? off.words), ...(off.path ? { runs: off.path } : {}), ...testOf(res), how: { case: 'off', res, off } };
  }
  // A command described in the customCommands setting wins over the built-in dictionary.
  const custom = customSpecIn(lookup, name);
  if (custom) return { ...facts, kind: 'command', ...withSpec(custom), how: { case: 'custom' } };
  // (No shell reads the words, Docker's exec form: a builtin's name runs the program of its name.)
  if (res.kind === 'file' && res.noShell?.skips) {
    const spec = lookupCommand(name);
    const program = !spec ? undefined : spec.builtin ? spec.program : spec;
    return { ...facts, kind: 'command', ...withSpec(program), ...(program ? testOf(ran) : {}), how: { case: 'no-shell', skips: res.noShell.skips, ...(spec ? { entry: spec } : {}), ...(program ? { program } : {}) } };
  }
  // (A builtin the script's shell is not counted on to have, `source` in sh: the name is looked up in PATH.)
  if (res.kind === 'file' && res.notBuiltin) return { ...facts, kind: 'command', ...withSpec(lookupCommand(name)!), how: { case: 'not-builtin', notBuiltin: res.notBuiltin } };
  // (The host's function only where the name runs it: not after an `unset -f`, nor as a program `sudo` runs.)
  const spec = (res.kind === 'host' ? hostSpecIn(lookup, name) : undefined) ?? lookupCommand(name);
  if (spec) return { ...facts, kind: spec.builtin ? 'builtin' : 'command', ...withSpec(spec), ...testOf(res), how: { case: 'spec' } };
  // (A quoted name is never an alias: bash looks up no alias for `"ll"` or `\ll`, so only a function of a system stays.)
  const distro = Object.hasOwn(distroAliases, name) ? distroAliases[name] : undefined;
  if (distro && (sv === undefined || distro.kind === 'function')) {
    // In a README the commands are typed into a terminal, where the alias may exist.
    const interactive = readAs(model.env(nameNode), model.read) === 'terminal';
    const { res: _, ...rest } = facts;
    return { ...(interactive ? rest : facts), kind: 'command', ...withSpec(distro.command ? lookupCommand(distro.command) : undefined), how: { case: 'distro', distro, interactive } };
  }
  return { ...facts, kind: 'command', how: { case: name.includes('/') ? 'path' : 'unknown' } };
}

/** `test` or `[`, when `res` runs one of them (src/semantics/names.ts): its spec, for `HeadFacts.test`. */
function testOf(res: NameResolution): { test?: CommandSpec } {
  const test = testSpecOf(res);
  return test ? { test } : {};
}
