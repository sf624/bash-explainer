// The public types of an explanation (src/analyzer.ts makes them; the products, the panel and the hosts read them).
import type { Fields } from './semantics/words';
import type { CommandSpec } from './argv/spec';
import type { Basis, TryIt } from './basis';
import type { BashVersion } from './bashversion';
import type { ScriptEvidence, Shell } from './dialect';
import type { SectionMarks } from './examples/marks';
import type { Interactive } from './examples/rerun';
import type { HostId, NoShell } from './hosts';
import type { LabelPart } from './label';
import type { NoteLevel } from './levels';
import type { Fact, FactId, Note, SpaceEnds, ValueSaid } from './messages';
import type { Quiet } from './semantics/scriptstops';
import type { TokenTextId } from './messages-tokens';
import type { TokenRole } from './roles';
import type { NameInfo } from './namefacts';
import type { ReadingNode } from './reading';
import type { ArgvHoleKind } from './messages-argv';
import type { Rewrite } from './rewrite';
import type { ExpansionValue } from './semantics/values';
import type { HostRun } from './semantics/walk/host';

export type Kind =
  | 'command' | 'subcommand' | 'builtin' | 'function' | 'alias' | 'keyword' | 'option' | 'argument' | 'operator'
  | 'redirect' | 'variable' | 'expansion' | 'substitution' | 'string' | 'number'
  | 'comment' | 'shebang' | 'assignment' | 'test' | 'pattern' | 'block' | 'error';

/**
 * Who reads the part of the line a token is about: `shell`, bash itself (its commands, words, quotes, expansions,
 * redirections, and the glob patterns and `$'…'` escapes it reads); `argv`, the command, from its spec (an option, an
 * operand, a subcommand, a command it runs, the expression of `test` and `[`); `embedded`, a language inside a word,
 * read by its own rules (a regex, a sed script, a jq filter, a printf format: src/embedded/registry.ts, and the regex
 * of `=~`); `script`, a shell reading a string a command gives it as a script (`bash -c '…'`, `eval`, `trap`, `ssh host
 * cmd`): the commands and words of that script (what its commands read of their words is `argv` again). The tree view
 * of the panel (src/reading.ts) sorts the tokens into its layers by it.
 */
export type TokenOrigin = 'shell' | 'argv' | 'embedded' | 'script';

/**
 * Which shell reads a string a command gives it as a script: `subshell`, a copy of this shell (the manual's term, 3.7.3: a
 * `$( )`, `<( )` or backquote; a `( )`, a pipeline stage or an asynchronous command); `shell`, a new shell process
 * (`bash -c`, `sh -c`, `su -c`); `same`, this shell, again (`eval`, a trap's action); `remote`, a shell on another machine
 * (`ssh host cmd`); `container`, a shell in a container (`docker exec c sh -c`).
 */
export type ScriptProcess = 'same' | 'subshell' | 'shell' | 'remote' | 'container';

export interface Pos { line: number; character: number }
export interface Span { start: Pos; end: Pos }

export interface Token {
  kind: Kind;
  /**
   * The colour role of its kind (src/roles.ts, `KIND_ROLES`), the same in both languages: set on every token of a
   * `LineExplanation` once the line is explained (`markTokens`, src/tokenmarks.ts), since a kind may still change while
   * it is (a word that is a keyword out of place becomes an error).
   */
  role?: TokenRole;
  /**
   * The facts of the message catalog the line says about this part (src/messages.ts ids, in the order said): those
   * said at its node (`cx.say`, `cx.note`), or at a part inside it that has no token of its own (`markTokens`). None
   * when there are none.
   */
  facts?: FactId[];
  /**
   * The texts of the catalog of token texts its explanation holds (src/messages-tokens.ts), outermost first. None for a text from
   * elsewhere: a spec's or an embedded language's, or one that src/explain/ still words in a helper (docs/design/sources.md, row 14).
   */
  texts?: TokenTextId[];
  /** The warnings among them: each with its level, and its text as `explanation` holds it. A row draws the level's mark (`markedText`). */
  marks?: TokenMark[];
  /**
   * Short label shown in lists: usually the source text of the span, truncated. A command is labelled with its
   * name (`grep`), since its explanation describes the program; a construct, with its skeleton (see `labelParts`).
   * The span stays the whole command or construct.
   */
  label: string;
  /**
   * The label as a skeleton, for a construct (`if` *condition* `then` *commands* `fi`): code and placeholders. Absent when
   * the label is one plain text. `label` is always its plain-text form (placeholders as ‹name›).
   */
  labelParts?: LabelPart[];
  explanation: string;
  span: Span;
  children: Token[];
  /** One-line summary used for the inline display; falls back to `explanation`. */
  summary?: string;
  /**
   * What bash's grammar makes of the part, where its kind does not say it: a list of commands (3.2.4: `;`, `&`), an
   * AND or OR list (`&&`, `||`; `a && b || c` is an OR list), or a pipeline, which have the kind `operator`. The reading
   * tree names the nodes of a string read as a script with it (`eval 'a; b'`).
   */
  grammar?: 'list' | 'andList' | 'orList' | 'pipeline';
  /**
   * What the part is to bash, where the panel draws a box around it: a simple command (3.2.2), or a compound command or a function's
   * definition (3.2.5, 3.3). From the node's type (`explain`, src/explain/dispatch.ts). What a command reads as a command (`sudo ls`)
   * has none: to bash it is a word. A pipeline's `time` and `!` (3.2.3) have none either: the commands under them have theirs.
   * For the panel: not in `--format json` (`tokenForJson`, cli/main.ts), as `plain` is not.
   */
  frame?: 'command' | 'compound';
  /**
   * What the part stands around, where bash's grammar makes it no part of its own: `redirections`, a command's redirections, whose parts are
   * the redirections and the one command they apply to (3.6; not a redirection itself, whose parts are the words of its target, nor those of
   * a command with no name, which apply to nothing: 3.7.1);
   * `pipeline`, a pipeline's `time` or `!`, whose parts hold the rest of that pipeline (3.2.3). From the node (src/explain/). For the
   * panel: not in `--format json`, as `frame` is not.
   */
  around?: 'redirections' | 'pipeline';
  /** It says no more than how bash reads the part (a loop's body, a variable that only expands): the panel shows it at depth 2. */
  plain?: true;
  /** Worked examples shown right under this token (see `placeExamples`). */
  examples?: Example[];
  /** A regex capture group (or a reference to one), coloured alike in the panel and the examples. */
  group?: number;
  /** The sections of the Bash manual it is about ('3.7.2'; src/manual.ts), shown as a link or a section number. */
  refs?: readonly string[];
  /**
   * Who reads this part (see `TokenOrigin`). Every token of a `LineExplanation` has one: the analyzer sets it where it
   * makes the token (the argument interpreter's roles, the embedded explainers) and gives the rest to `shell`.
   */
  origin?: TokenOrigin;
  /**
   * On the token of a word (or the characters of a word) the command reads as the value of an option: the option's name
   * as written (`-f`, `--file`). Every other word the command reads that is not an option is an operand.
   */
  valueFor?: string;
  /**
   * On the token of a word a command reads as an operand or an option's value: how bash makes the words the command gets
   * from it, when it makes several or other ones (`split`: the fields of an unquoted expansion, which bash then globs;
   * `glob`: the matching file names; `brace`: the words of a brace expansion; `elements`: one word per element, of
   * `"$@"`, `"${a[@]}"` and the like, none when there are none; in that order of precedence). The command
   * never sees the word as written. From the word's meaning (src/semantics/words.ts), which says that the step applies.
   * With `valueFor`, the first word that comes out is the value and the others are operands.
   */
  expands?: 'glob' | 'split' | 'brace' | 'elements';
  /** On the outermost tokens of an embedded language: which language (`regex`, `sed`, `jq`…; `EmbeddedLang`). */
  language?: string;
  /** On the tokens of a string read as a script (`origin` `script`): which shell reads it. */
  process?: ScriptProcess;
  /** With `ExplainOptions.reading`, on the first token of a string read as a script: the string's own reading (src/explain/scripts.ts). */
  reading?: ReadingNode[];
  /**
   * On the token of a command name (a simple command's, a command another runs, `[`, and the reserved words `time`
   * and `[[`): what the name is here, who looks it up, and what else the same name is (src/namefacts.ts).
   */
  name?: NameInfo;
  /**
   * On the token of a parameter expansion (`$msg`, `${msg%.*}`): its value where it runs, when the semantic model knows
   * it for sure (docs/design/expansion-values.md), with what the outputs say of it.
   */
  value?: ValueInfo;
  /**
   * What the text rests on where it states bash's behaviour that the manual does not state, or states otherwise
   * (src/tokenbases.ts, docs/design/basis.md): as `Fact.basis`. On a program's command token, the spec it was read
   * with (`{ kind: 'spec', command: 'grep' }`), on which the tokens it reads rest (`tokenBasisFor`). None with
   * `notes.basis` off.
   */
  basis?: Basis;
  /** A command that shows that behaviour, and what it printed (`Fact.tryIt`), with the basis. */
  tryIt?: TryIt;
}

/** A warning inside a token's text (`Token.marks`). */
export interface TokenMark { id: TokenTextId; level: NoteLevel; text: string }

/** The value of an expansion (`Token.value`): the model's (src/semantics/values.ts, `expansionValue`), and its texts. */
export interface ValueInfo extends ExpansionValue {
  said: ValueSaid;
}

export interface ContextEntry { label: string; line: number }

/** Context for explaining a line. */
export interface ExplainOptions {
  /** What the shell code is part of (the kind of file, and the CI system of a YAML step). */
  host?: HostId;
  /** The bash release the script is explained for (the `bashExplainer.bashVersion` setting; 5.2 when absent). */
  bashVersion?: BashVersion;
  /** The `bashExplainer.yq.flavor` setting. */
  yqFlavor?: string;
  /** Worked examples: off altogether, or off for some kinds. */
  examples?: { enabled: boolean; disabled: string[] };
  /** Notes about well-known idioms (strict mode…); on unless false. */
  idioms?: boolean;
  /** Notes about common mistakes (unquoted variables, `x = 1`…); on unless false. */
  pitfalls?: boolean;
  /** What a fact rests on where it is not the manual, with a command to try it (`Fact.basis`, `Fact.tryIt`); on unless false. */
  basis?: boolean;
  /** The `bashExplainer.customCommands` setting: commands the dictionary does not know. */
  customCommands?: Record<string, unknown>;
  /** Commands the host file defines for its scripts (a bats file: `run`, `load`…), read before the dictionary. */
  hostCommands?: Record<string, CommandSpec>;
  /** What the host runs of the script (a bats file: its tests, each in a process of its own, with `set -eET`). */
  hostRun?: HostRun;
  /** Variables the host gives the script, and the names of its placeholders (src/hosts/remap.ts, `hostProvided`). */
  hostProvided?: readonly string[];
  /**
   * The file is surely a script (`Shells.script`), so that a syntax error can be said: never a host's code, for now.
   */
  script?: ScriptEvidence;
  /**
   * Set for a string run by a command that the script does not surely read as it stands (`unread`: no reading of its text is said, `Explainer.evidenceAt`;
   * `unsure`: as a warning at most, as of the command), or does not get to (`unreached`: no fact of a command or of the dialect is said, `Explainer.reachedAt`).
   */
  unread?: boolean;
  unsure?: boolean;
  unreached?: boolean;
  /** Set for a string that may not run (`stringSurelyRuns`): an error of the dialect in it, or of its text, is a warning (`Explainer.stopAt`, `evidenceAt`). */
  sometimes?: boolean;
  /** Set for a string run by a command that discards its stderr, where a failure leaves the script going (`quietAt`): an error of the dialect in it is a warning. `status`: only a failure with a status (`eval`, in the script's own shell). */
  quiet?: Quiet;
  /** The row where the shell of this line started, in a host's text that holds several (`shellStart`, src/hosts/scripts.ts): a stop before it is another shell's (`stopBefore`). */
  stopsFrom?: number;
  /**
   * The host runs the line's words with no shell (`ShellRegion.noShell`: Docker's exec form, a Python list of
   * arguments): the model looks the name up as a program (`StateModel.noShell`), and each word is the host's string.
   */
  noShell?: NoShell;
  /** Also build the reading tree of the line (`LineExplanation.reading`), for the panel's tree view. */
  reading?: boolean;
  /** Also say which constructs on the line POSIX sh does not have (`LineExplanation.notPosix`). */
  notPosix?: boolean;
  /** Also give what the program of each simple command on the line receives (`LineExplanation.argv`, src/argvline.ts). */
  argv?: boolean;
  /** Also give the sentence of the line, "In short" (`LineExplanation.sentence`, src/linesentence.ts). */
  sentence?: boolean;
  /** The codes of the problems a host file adds to the line (src/hosts/remap.ts): the sentence says nothing they say (`problemCodes`). */
  hostProblems?: readonly string[];
  /**
   * Set by the analyzer for a string a shell runs (`sh -c '…' sh "$msg"`): the shell (`sh -c`) and the words its
   * `$0`, `$1`… start as, in order; `more`: words after them whose number is known only when it runs (`"$@"`).
   */
  positional?: { via: string; words: readonly string[]; more: boolean };
}

/**
 * A note of a line and the range it is about (`LineExplanation.anchors`); `code`: the code of the problem it is when
 * the editors show it as one (`DocumentIssue.code`: a fact's id, a style check, a dialect issue); `rewrite`: the
 * rewrites the note suggests at that place, with edits (`Fact.rewrite`, `StyleFinding.rewrite`), which the editors offer
 * as quick fixes of the problem (`DocumentIssue.fixes`).
 */
export interface NoteAnchor { text: string; span: Span; code?: string; rewrite?: readonly Rewrite[] }

export interface LineExplanation {
  line: number;
  summary: string;
  items: Token[];
  /** Enclosing constructs, outermost first (e.g. "for loop (line 3)"). */
  context: ContextEntry[];
  notes: string[];
  /**
   * The data of each note of `notes`, in the same order: its level, the word after its mark and the rest, and the code
   * of the problem it is (docs/design/note-levels.md). The views read the level from here, not from the text.
   */
  noteInfo: Note[];
  /**
   * The notes that are facts of the message catalog (src/messages.ts): their id and the sections of the manual
   * they cite. `text` is the note as it is in `notes`.
   */
  facts?: Fact[];
  /**
   * Where the notes are about, for the notes found on a node (a word, a command, a construct): each note's text as it
   * is in `notes` and that node's range; a note found on several nodes has several. A note with none is about the line.
   */
  anchors?: NoteAnchor[];
  /** Worked examples (e.g. input and output of a sed script), shown line by line. */
  examples: Example[];
  /** The shell the script is written for, when it is not bash (checked for unsupported features). */
  shell?: Shell;
  /** Who reads each part of the line, layer by layer (src/reading.ts); only when `ExplainOptions.reading` asks for it. */
  reading?: ReadingNode;
  /** The constructs shown on the line that POSIX sh does not have; only when `ExplainOptions.notPosix` asks for it. */
  notPosix?: NotPosix[];
  /** What the program of each simple command on the line receives, in source order (src/argvline.ts); only when `ExplainOptions.argv` asks for it. */
  argv?: ArgvLine[];
  /**
   * With `argv`: the keywords of bash on the lines shown that the script's shell reads as a command, or does not have (`[[ ]]`, `time`, `coproc` in dash):
   * bash's grammar does not handle them there (`keywordsNotIn`, src/dialect.ts).
   */
  plainWords?: Span[];
  /**
   * One sentence that says what the line does, "In short" (src/linesentence.ts; marked text: code in backticks); only
   * when `ExplainOptions.sentence` asks for it, and on a line with code.
   */
  sentence?: string;
}

/**
 * A part of a word a program receives (src/argvline.ts): text, or a placeholder for a value known only when the line
 * runs. `hole`: what it stands for, `code` its text in the script (for `names`, the pattern), `label` what the views
 * show between `‹` and `›` (marked text: code in backticks); `splits`: word splitting by IFS may cut the value into
 * several words, or none (not the elements of `"$@"`, which are words of their own unsplit).
 */
export type ArgvPart = { text: string } | { hole: ArgvHoleKind; code: string; label: string; splits?: true };

/**
 * One word the program receives, or a placeholder for several: its parts (none: the word of the script gives no word),
 * and the word of the script it comes from (`from`). `count`: how many words it stands for, when that is not exactly
 * one (`min` to `max`; no `max`: no bound). `asWritten`: the word is received as it is written (no quote to remove,
 * nothing expanded).
 */
export interface ArgvWord { from: Span; parts: ArgvPart[]; count?: { min: number; max?: number }; asWritten?: true }

/**
 * A part of a simple command that bash handles itself and the program never receives (manual 3.7.1): a prefix
 * assignment or a redirection, as written (`text`), what it does (`says`, marked text), and the word bash expands for
 * it where it has one: the value of the assignment, the target of the redirection, the text of a here-string.
 */
export interface ArgvRemoved { kind: 'assignment' | 'redirect'; span: Span; text: string; says: string; word?: ArgvWord[] }

/**
 * What the program of one simple command receives (docs/design/panel-redesign.md, P4): its words, the name's first,
 * after bash's expansions, quote removal, word splitting and pathname expansion (manual 3.5, 3.7.1); what bash took
 * out first (`removed`, in source order); `fails`: the first word bash fails on (`${x:?}`, `set -u`, failglob, an
 * ambiguous redirection), in the order bash expands them: the words, then the values of the assignments, then the
 * redirections; so the program does not run.
 */
export interface ArgvLine {
  span: Span;
  /**
   * The name surely runs in the shell itself, with no program started (`words[0]` is the name all the same): it gets its arguments only, not an `argv[0]`.
   * `sourced`: a name the dictionary does not know, after a `source` or `.`, which may be a function of the file read (`NameResolution.sourced`), or else a program.
   */
  inside?: 'builtin' | 'function' | 'sourced';
  words: ArgvWord[];
  removed: ArgvRemoved[];
  fails?: { span: Span; error: NonNullable<Fields['error']> };
}

/** A construct on a line that POSIX sh does not have (`collectFeatures`, src/dialect.ts): where, and what it says of it. A fact of the construct, whatever shell the script is for. */
export interface NotPosix { span: Span; says: string }

export interface ExampleSection {
  label: string;
  lines: string[];
  /** Shown instead when `lines` is empty (e.g. "(no output)"). */
  empty?: string;
  /**
   * The lines are separate words, not lines of text: the words bash makes of a word (brace expansion), which a command
   * gets as separate arguments, shown as `shownWord` makes them (`␣` at an end, `∅` for an empty one). The panel and the
   * hover draw them as chips in a row, the other outputs as code spans on one line. `ends`: the marks of a space at the
   * ends of each; `spaceLabel`: what a drawn mark is called; `after`: inline Markdown after the words (the cut, the marks).
   * A section of words with none has `empty`.
   */
  words?: { ends: SpaceEnds[]; spaceLabel?: string; after?: string };
  /** What the next stage of a pipeline reads of the lines (src/examples/marks.ts); the panel marks it. */
  marks?: SectionMarks;
}

/** What an example shows, so it can be turned off by kind (`bashExplainer.examples.disabled`). */
export type ExampleKind = 'regex' | 'sed' | 'awk' | 'jq' | 'yq' | 'perl' | 'textFilters' | 'pipeline' | 'expansion' | 'printf' | 'glob'
  | 'test' | 'xargs' | 'read' | 'getopt' | 'gitLog' | 'date';

export const EXAMPLE_KINDS: ExampleKind[] = ['regex', 'sed', 'awk', 'jq', 'yq', 'perl', 'textFilters', 'pipeline', 'expansion', 'printf', 'glob', 'test', 'xargs', 'read', 'getopt', 'gitLog', 'date'];

export interface Example {
  kind?: ExampleKind;
  title: string;
  /** The command the example is for, named in the title when the line has several commands. */
  target?: string;
  /** The source range the example belongs to; the example is shown under the token that covers it. */
  anchor?: Span;
  sections: ExampleSection[];
  /** Said once under the title: what the control pictures (␛ ⇥) in the lines stand for. */
  note?: string;
  /** For the panel: input the user can edit, and how to run the example again on it. */
  interactive?: Interactive;
}
