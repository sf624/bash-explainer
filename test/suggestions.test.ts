// The inventory of the catalog's suggestions (docs/design/oracles.md, part B): every entry of src/messages.ts says
// whether it tells the user to write something else, and how a test could check that rewrite in bash.
//
// - `mechanical`: the rewrite follows from the span the fact is about (`"$x"` for `$x`, `((++i))` for `((i++))`):
//   a test can run the original and the rewrite in bash, over a set of states, and compare.
// - `scenario`: the rewrite is checkable in bash, but only with a set-up of its own (a stub for `ssh` or `sudo`, a
//   new shell, a file read by `source`, bats).
// - `prose`: advice no run can check (use another name, write out the function's body, use `find`), or advice
//   about another language (Python, a Dockerfile, a workflow).
// - `none`: the entry suggests no rewrite.
//
// The type makes every entry of the catalog appear here, so a new one is classified when it is added. The test
// checks the classification against the English text: an entry that reads as a suggestion is not `none`, and one
// classified as a suggestion reads as one (or names the parameter that carries it).
import * as assert from 'assert';
import { type FactId, MESSAGES } from '../src/messages';

type Kind = 'mechanical' | 'scenario' | 'prose' | 'none';
/** A suggestion the text does not spell out: `via` names the parameter that carries it (given by the analyzer), or says it is implied. */
type Param = { kind: Exclude<Kind, 'none'>; via: string };

const SUGGESTIONS: Record<FactId, Kind | Param> = {
  'exit-modulo': 'none',
  'exit-refused': 'none',
  'errexit-off-in-substitution': 'none',
  'errexit-set-called-where-ignored': 'none',
  'errexit-set-maybe-called-where-ignored': 'none',
  'errexit-set-in-ignored-subshell': 'none',
  'errexit-set-in-ignored-group': 'none',
  'errexit-function-called-only-where-ignored': 'none',
  'errexit-group-where-ignored': 'none',
  // `local x=$(…)` → `local x; x=$(…)`: the failure of `$(…)` is seen, and stops `set -e`.
  'declaration-masks-status': 'mechanical',
  // `set -o pipefail`: needs a pipeline whose first stage fails.
  'pipefail-missing': { kind: 'scenario', via: 'implied: `set -o pipefail`' },
  // `a && b` as the last command → `if a; then b; fi`: the function's status is 0.
  'function-last-test-returns-status': 'mechanical',
  'function-last-test-stops-script': 'mechanical',
  // `a && b` as the script's last command → `if a; then b; fi`: the script's status is 0.
  'script-last-test-returns-status': 'mechanical',
  // `cmd || echo "msg"` → `cmd || { echo "msg" >&2; exit 1; }`: the status is 1 when `cmd` fails.
  'failure-reported-as-success': 'mechanical',
  'keyword-needs-separator': 'none',
  'bracket-missing-close': 'none',
  // `[ -f $x]` → `[ -f $x ]`.
  'bracket-close-glued': 'mechanical',
  'test-malformed': 'none',
  'function-defined-later': 'none',
  'function-defined-in-subshell': 'none',
  'function-defined-in-uncalled-function': 'none',
  'function-defined-in-dead-branch': 'none',
  'function-removed-by-unset': 'none',
  'special-builtin-before-function': 'none',
  'unset-function-and-variable': 'none',
  'unset-readonly': 'none',
  'assign-readonly': 'none',
  'restricted-refused': 'none',
  'unset-ends-special': 'none',
  'local-outside-function': 'none',
  'posix-special-function-name': 'prose',
  'posix-special-function-name-maybe': 'prose',
  'posix-function-name': 'prose',
  'posix-function-name-maybe': 'prose',
  'posix-special-builtin-error': 'none',
  'posix-special-builtin-error-maybe': 'none',
  // `((i++))` → `((++i))` or `i=$((i+1))`: same value of `i`, status 0.
  'postfix-increment-status': 'mechanical',
  'postfix-decrement-status': 'none',
  'condition-always-false': 'none',
  'condition-always-true': 'none',
  'loop-never-runs': 'none',
  'loop-never-ends': 'none',
  'and-or-right-never-runs': 'none',
  'case-runs-only': 'none',
  'case-runs-none': 'none',
  'dead-code': 'none',
  // `shopt -s expand_aliases` first, or a function: needs a stub for the aliased command.
  'alias-not-expanded-in-script': 'scenario',
  'alias-maybe-not-expanded': 'scenario',
  'alias-defined-same-unit': 'none',
  // `$a[1]` → `${a[1]}`: the element, not `$a` and the text `[1]`.
  'unbraced-element': 'mechanical',
  'alias-defined-later': 'none',
  // Move `shopt -s extglob` out of the block: the block parses.
  'extglob-in-same-block': 'scenario',
  'extglob-maybe-on': 'none',
  'extglob-turned-off': 'none',
  'extglob-not-found': 'none',
  'extglob-maybe-on-trap': 'none',
  'extglob-not-in-new-shell': 'scenario',
  'globstar-maybe-on': 'none',
  'globstar-not-found': 'none',
  'globstar-unsupported': 'prose',
  // The remote or new shell is stubbed by a fresh `env -i bash -c`.
  'variable-not-in-remote-shell': 'scenario',
  'variable-not-passed-by-wrapper': 'scenario',
  'variable-not-exported': 'scenario',
  'function-not-in-container': 'prose',
  'builtin-or-function-as-program': { kind: 'scenario', via: 'fix' },
  'ssh-local-expansion': 'scenario',
  'function-not-on-remote': 'scenario',
  'function-not-in-new-shell-blocked': 'prose',
  'function-not-in-new-shell': 'prose',
  'function-not-imported': 'scenario',
  'function-not-in-new-shell-export': 'scenario',
  'function-not-imported-sh': 'scenario',
  // `sudo v=1 cmd $v` → `sudo v=1 sh -c '… "$v"'`, with `sudo` stubbed by `env`.
  'wrapper-assignment-expanded-first': 'mechanical',
  'bash-subshell-not-counted': 'none',
  'pipeline-subshell-variable': { kind: 'scenario', via: 'fix' },
  // `[ -e "$f" ] || continue`, or `shopt -s nullglob`: with and without matching files.
  'unmatched-glob-runs-once': 'mechanical',
  'stdin-not-read': 'prose',
  // `v=1 cmd $v` → `v=1 sh -c '… "$v"'`.
  'prefix-assignment-expanded-first': 'mechanical',
  // `$x` → `"$x"` (only the expansions: `"$d"/*`, PR #271).
  'unquoted-variable-as-path': 'mechanical',
  'for-over-ls-output': 'scenario',
  // `for a in $@` → `for a in "$@"`.
  'for-over-unquoted-args': 'mechanical',
  // `a=$@` → `a=("$@")`: the arguments stay apart.
  'array-joined-in-assignment': 'mechanical',
  'unquoted-variable-in-test': 'mechanical',
  // `${x:-}` for the unset variable (when the analyzer gives `fix`): `set -u` no longer stops and the value is empty.
  'nounset-unbound': 'mechanical',
  // Options of the shebang → `set …` on the next line: run the file directly (before: bash refuses; after: it runs).
  'shebang-refused': 'scenario',
  'shebang-bom': 'prose',
  // `… | sudo tee file`, with `sudo` stubbed.
  'redirect-by-your-shell': 'scenario',
  'bats-test': 'none',
  'bats-tags': 'none',
  'bats-tags-invalid': 'none',
  'bats-test-line-dropped': 'scenario',
  // bats-core is run by test/bats-real.test.ts.
  'bats-negation-ignored': 'scenario',
  'bats-run-in-pipeline-stage': 'scenario',
  'bats-run-in-pipeline': 'scenario',
  'bats-hook': 'none',
  'bats-setup-suite-in-test-file': 'scenario',
  // `[[ $x =~ \bfoo ]]` → `re='\bfoo'; [[ $x =~ $re ]]`: same matches over a set of strings.
  'regex-backslash-dropped': 'mechanical',
  'distro-alias-in-script': { kind: 'scenario', via: 'instead' },
  'distro-alias-interactive': 'scenario',
  'dockerfile-pipefail-missing': 'prose',
  'python-string-without-shell': 'prose',
  'python-shell-injection': 'prose',
  'actions-script-injection': 'prose',
};

/** Words of the English texts that tell the user what to write instead. */
const SUGGESTS = /\b(Write|write it|write `|Use|use `|use a|Put|Run `|Pass|Quote it|Split it|Start the body|Keep the regex|Turn it on|single-quote|go through a shell|instead\b|give status 0|needs a space before it|would make it|Save the file)/;

/** Any parameter: a string `X` wherever it is read (also as `{ ja, en }`, a list of one, or a call). */
const ANY: unknown = new Proxy(function () { /* placeholder */ }, {
  get: (_t, k) => (k === Symbol.toPrimitive ? () => 'X' : k === Symbol.iterator ? function* () { yield ANY; } : ANY),
  apply: () => ANY,
});

describe('the suggestions of the catalog (docs/design/oracles.md, B)', () => {
  const english = (id: FactId): string => (MESSAGES[id].text as (p: unknown) => readonly [string, string])(ANY)[1];

  it('classifies an entry as a suggestion exactly when its text suggests a rewrite', () => {
    const wrong = (Object.keys(MESSAGES) as FactId[]).filter((id) => {
      const k = SUGGESTIONS[id];
      const reads = SUGGESTS.test(english(id));
      return typeof k === 'string' ? reads !== (k !== 'none') : reads;
    });
    assert.deepStrictEqual(wrong, []);
  });

  // (docs/design/oracles.md, step 4: an entry whose suggestion is mechanical renders it from rewrites its fact carries,
  // `Entry.rewrite`, and test/rewrites.test.ts runs them in bash. The ids still without, until the list is empty.)
  it('gives the mechanical entries their rewrites, and only those', () => {
    const kind = (id: FactId): Kind => { const k = SUGGESTIONS[id]; return typeof k === 'string' ? k : k.kind; };
    const ids = Object.keys(MESSAGES) as FactId[];
    const rewrites = (id: FactId): boolean => 'rewrite' in MESSAGES[id];
    assert.deepStrictEqual(ids.filter((id) => rewrites(id) && kind(id) !== 'mechanical'), []);
    // (One per line: each PR that gives an id its rewrites removes its line.)
    assert.deepStrictEqual(ids.filter((id) => !rewrites(id) && kind(id) === 'mechanical').sort(), [
      'array-joined-in-assignment',
      'declaration-masks-status',
      'for-over-unquoted-args',
      'function-last-test-returns-status',
      'function-last-test-stops-script',
      'nounset-unbound',
      'postfix-increment-status',
      'prefix-assignment-expanded-first',
      'script-last-test-returns-status',
      'unquoted-variable-as-path',
      'unquoted-variable-in-test',
    ]);
  });

  it('counts them', () => {
    const count = (kind: Kind) => Object.values(SUGGESTIONS).filter((k) => (typeof k === 'string' ? k : k.kind) === kind).length;
    assert.deepStrictEqual({ mechanical: count('mechanical'), scenario: count('scenario'), prose: count('prose'), none: count('none') },
      { mechanical: 17, scenario: 25, prose: 14, none: 48 });
  });
});
