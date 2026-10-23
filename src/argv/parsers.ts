// The families of option parsers (`CommandSpec.parser`): each preset is the rules of one real parser, which
// test/parsers-real.test.ts checks against a tool that uses it (docs/design/refactor.md, step 3.5).
import type { CommandSpec } from './spec';

/**
 * - `gnu` (the default): getopt_long's rules without abbreviations. Short options cluster (`-xvf`) and take a
 *   value attached or as the next word (`-n5`, `-n 5`); long ones start with `--` and take `--name=value` or the
 *   next word; options may follow operands. An entry has it when its list of long options is not checked complete,
 *   so that a prefix could stand for an option it lacks (decision 3 of docs/design/semantics.md), and a tool of
 *   another family with the same rules (Python's argparse without `allow_abbrev`).
 * - `getopt_long`: GNU getopt_long, with a unique prefix of a long option for it (`--pres` for `--preserve-status`;
 *   a prefix of several is refused). For an entry that lists every long option of the tool's `--help`.
 * - `single-dash`: every option is one word, with one dash (`-name`, `-var-file x`), and never clusters; a known
 *   option takes `-name=value` (gcc, find's tests, Java).
 * - `openssl`: OpenSSL's opt.c: the rules of `single-dash`, and `--name` is `-name` (`openssl rand --hex 4`). Go's
 *   flag package reads `--name` so too; its tools (go, terraform, shfmt) keep `single-dash` until compared with one.
 * - `letters`: a word is an option only when each of its letters is a known option, and the first operand ends
 *   the options (bash's `echo`: `echo -ne` reads two options, `echo -nx` prints `-nx`).
 * - `cobra`: Go's cobra with pflag: the rules of `gnu`, and `-f=x` gives `-f` the value `x`. The program finds its
 *   subcommand as cobra does (kubectl, helm, gh): options may come before the subcommand's name, its own as
 *   well as the program's (`kubectl -o yaml get pods`). The subcommand is the first word that is not an option
 *   or its value, where an option not known at that level, written without `=`, takes the next word as its value
 *   (`-x VALUE`, `--name VALUE`), as cobra guesses. The subcommands of a subcommand are found the same way, and
 *   read with these rules unless their spec names another parser.
 * - `iproute2`: `ip`'s own: options of one dash, and any prefix of a name selects the first option in the list
 *   that has such a name, also when written with `--` (`ip -stat`, `ip -b` is `-batch`; `matches()` in iproute2).
 * - `jq`: jq's own: the rules of `gnu`, but no `--name=value` (`--arg=x` is an unknown option).
 * - `git`: git's own, before its subcommand: a short option is a whole word, with no cluster (`git -pP`) and no
 *   attached value (`-C.`, `-c=x`); long options keep `--name=value`.
 * - `dpkg`: dpkg's own (`myopt`): the rules of `gnu`, and `-f=x` gives `-f` the value `x` (`dpkg-query -f=…`).
 */
export type OptionParser = 'gnu' | 'getopt_long' | 'single-dash' | 'openssl' | 'letters' | 'cobra' | 'iproute2' | 'jq' | 'git' | 'dpkg';

/** What a preset does, as the interpreter (src/argv/interpret.ts) reads it. */
export interface ParserRules {
  /** A long option may be a prefix of its name: a unique one (`unique`), or the first option it starts (`first`). */
  longPrefixes: false | 'unique' | 'first';
  /** `--name=value` gives a long option its value. */
  longEquals: boolean;
  /** Short options cluster and take a value in the same word (`-xvf`, `-n5`). */
  shortClusters: boolean;
  /** `-f=x` is `-f` with the value `x`, not `=x`. */
  shortEquals: boolean;
  /** Every option is one word with one dash (`-name`), which may take `-name=value`. */
  singleDash: boolean;
  /** `--name` is read as `-name` (with `singleDash`). */
  doubleDash: boolean;
  /** A word is an option only when each of its letters is one. */
  letters: boolean;
  /** The first operand ends the options, whatever the spec's `optionsFirst`. */
  optionsFirst: boolean;
  /** The subcommand is found as cobra does. */
  cobra: boolean;
}

const GNU: ParserRules = {
  longPrefixes: false, longEquals: true, shortClusters: true, shortEquals: false, singleDash: false, doubleDash: false, letters: false, optionsFirst: false, cobra: false,
};

export const PARSERS: Record<OptionParser, ParserRules> = {
  gnu: GNU,
  getopt_long: { ...GNU, longPrefixes: 'unique' },
  'single-dash': { ...GNU, singleDash: true },
  openssl: { ...GNU, singleDash: true, doubleDash: true },
  letters: { ...GNU, letters: true, optionsFirst: true },
  cobra: { ...GNU, shortEquals: true, cobra: true },
  iproute2: { ...GNU, singleDash: true, longPrefixes: 'first' },
  jq: { ...GNU, longEquals: false },
  git: { ...GNU, shortClusters: false },
  dpkg: { ...GNU, shortEquals: true },
};

/**
 * The rules a spec is read with: its parser's, with `optionsFirst`. `cobra`: a parent finds its subcommands as
 * cobra does, so a subcommand that names no parser is read with cobra's rules.
 */
export function rulesOf(spec: CommandSpec, cobra = false): ParserRules {
  const rules = PARSERS[spec.parser ?? (cobra ? 'cobra' : 'gnu')];
  return spec.optionsFirst ? { ...rules, optionsFirst: true } : rules;
}
