// The public types of an explanation (src/analyzer.ts makes them; the products, the panel and the hosts read them).
import type { CommandSpec } from './argv/spec';
import type { BashVersion } from './bashversion';
import type { Shell } from './dialect';
import type { Interactive } from './examples/rerun';
import type { HostId } from './hosts';
import type { LabelPart } from './label';
import type { Fact } from './messages';
import type { NameInfo } from './namefacts';
import type { ReadingNode } from './reading';

export type Kind =
  | 'command' | 'subcommand' | 'builtin' | 'function' | 'alias' | 'keyword' | 'option' | 'argument' | 'operator'
  | 'redirect' | 'variable' | 'expansion' | 'substitution' | 'string' | 'number'
  | 'comment' | 'assignment' | 'test' | 'pattern' | 'block' | 'error';

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
  /** On the outermost tokens of an embedded language: which language (`regex`, `sed`, `jq`…; `EmbeddedLang`). */
  language?: string;
  /** On the tokens of a string read as a script (`origin` `script`): which shell reads it. */
  process?: ScriptProcess;
  /**
   * On the token of a command name (a simple command's, a command another runs, `[`, and the reserved words `time`
   * and `[[`): what the name is here, who looks it up, and what else the same name is (src/namefacts.ts).
   */
  name?: NameInfo;
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
  /** The `bashExplainer.customCommands` setting: commands the dictionary does not know. */
  customCommands?: Record<string, unknown>;
  /** Commands the host file defines for its scripts (a bats file: `run`, `load`…), read before the dictionary. */
  hostCommands?: Record<string, CommandSpec>;
  /** Also build the reading tree of the line (`LineExplanation.reading`), for the panel's tree view. */
  reading?: boolean;
}

/** A note of a line and the range it is about (`LineExplanation.anchors`). */
export interface NoteAnchor { text: string; span: Span }

export interface LineExplanation {
  line: number;
  summary: string;
  items: Token[];
  /** Enclosing constructs, outermost first (e.g. "for loop (line 3)"). */
  context: ContextEntry[];
  notes: string[];
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
}

export interface ExampleSection {
  label: string;
  lines: string[];
  /** Shown instead when `lines` is empty (e.g. "(no output)"). */
  empty?: string;
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
