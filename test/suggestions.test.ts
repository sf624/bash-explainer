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
// classified as a suggestion reads as one (or names the parameter that carries it). The style checks of
// src/pitfalls.ts are classified alike (`STYLE_SUGGESTIONS`, step 6), by their codes.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import { explainHostedLine, extractShell, hostKind } from '../src/hosts';
import { type FactId, MESSAGES } from '../src/messages';
import { STYLE_REWRITES, type StyleCode } from '../src/pitfalls';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { corpusFacts, MECHANICAL, type SuggestionId } from './support/rewrite-states';

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
  // `find . -exec rm {} ;` → `find . -exec rm {} \;`: the `;` the shell took for its own is the one find needs.
  'find-action-refused': 'mechanical',
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
  'function-shadowed-by-program': 'prose',
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
  // (`2>&1 >file` → `>file 2>&1`: the text shows the code of the rewrite, which the test above cannot read through its placeholder.)
  'stderr-to-original-stdout': { kind: 'mechanical', via: 'rewrite' },
  'redirections-in-order': 'none',
  'heredoc-end-line': 'none',
  'heredoc-body-line': 'none',
  'statement-continued': 'none',
  'read-ifs-separators': 'none',
  'yq-flavour': 'none',
  'yq-compat': 'none',
  'host-substitution': 'none',
  'github-file': 'none',
  'dockerfile-onbuild': 'none',
  'dockerfile-healthcheck': 'none',
  'dockerfile-exec-form': 'none',
  'yaml-folded-block': 'none',
  'dockerfile-shell': 'none',
  'jenkinsfile-groovy-interpolation': 'prose',
  'python-shell-list': 'none',
  'python-exec-list': 'none',
  'python-shell-expression': 'none',
  'python-string-partial': 'none',
  'idiom-ifs-read-raw': 'none',
  'idiom-script-dir': 'none',
  'idiom-cd-script-dir': 'none',
  'idiom-quiet-check': 'none',
  'idiom-run-directly': 'none',
  'idiom-strict-mode': 'none',
  'idiom-require-variable': 'none',
  'idiom-default-variable': 'none',
  'idiom-or-true': 'none',
  'idiom-exit-trap': 'none',
  'idiom-exec-tee': 'none',
  'idiom-endless-loop': 'none',
  'idiom-mktemp': 'none',
  'idiom-read-file-loop': 'none',
  'idiom-read-command-loop': 'none',
  'idiom-getopts-loop': 'none',
  'idiom-shift-optind': 'none',
  'idiom-getopt-loop': 'none',
  'idiom-getopt-args': 'none',
  'idiom-eval-set': 'none',
  'idiom-args-loop': 'none',
  'idiom-read-nul': 'prose',
  'idiom-find-print0': 'prose',
  'idiom-xargs-nul': 'none',
  'idiom-until': 'prose',
  'idiom-mapfile': 'prose',
  'idiom-glob-guard': 'none',
  'idiom-yes-no': 'none',
};

/**
 * The style checks (src/pitfalls.ts), by their codes: each suggests a rewrite. Two are advice whose rewrite changes what
 * runs, as the line means it (docs/design/oracles.md 3.1): a run checks them only with a set-up of their own.
 */
const STYLE_SUGGESTIONS: Record<StyleCode, Exclude<Kind, 'none'>> = {
  // `[-f x]` → `[ -f x ]`, `[[-f x]]` → `[[ -f x ]]`.
  'bracket-no-space': 'mechanical',
  // `x = 1` → `x=1` (where `=` and one word follow the name).
  'assignment-with-spaces': 'mechanical',
  // `{echo a;}` → `{ echo a;}`, `{echo a}` → `{ echo a; }`.
  'brace-no-space': 'mechanical',
  // `{ echo a; echo b }` → `echo b; }`.
  'brace-close-no-separator': 'mechanical',
  // `rm -rf $D/*` → `"${D:?}"/*`. (The check before the statement, `[ -n "${D%/}" ] || exit 1`, is said with no edits:
  // the warning would stay after it, docs/design/semantics.md 4.15.)
  'rm-empty-variable-root': 'mechanical',
  // `read x` → `read -r x`.
  'read-without-r': 'mechanical',
  // `[ $a < $b ]` → `[ $a \< $b ]`.
  'redirect-in-bracket': 'mechanical',
  // `[ -f $x]` → `[ -f $x ]`.
  'bracket-close-in-word': 'mechanical',
  // `[ a && b ]` → `[ a ] && [ b ]`.
  'and-or-in-bracket': 'mechanical',
  // Download to a file and read it before running it: a person reads it.
  'download-run-by-shell': 'prose',
  // `exit 130` last in the action, a string `trap` runs: needs the signal sent to the script.
  'trap-goes-on': 'scenario',
  // `source lib.sh` → `source "$(dirname "${BASH_SOURCE[0]}")"/lib.sh` (or `./lib.sh`): the file next to the script, not one
  // of `$PATH` (the panel redesign's P3; its runs in test/rewrites-advice.test.ts, with a PATH set up).
  'source-searches-path': 'mechanical',
  // `grep "$x"` → `grep -F "$x"`: the value as it is, with GNU grep over lines of a set-up.
  'pattern-from-variable': 'mechanical',
};

/** Words of the English texts that tell the user what to write instead. */
const SUGGESTS = /\b(Write|write it|write `|Use|use `|use a|Put|Run `|Pass|Quote it|Split it|Start the body|Keep the regex|Turn it on|single-quote|go through a shell|assign it first|instead\b|give status 0|needs a space before it|would make it|Save the file)/;

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
    // (Every mechanical id has them: step 4 of oracles.md is done.)
    assert.deepStrictEqual(ids.filter((id) => !rewrites(id) && kind(id) === 'mechanical'), []);
    // (The style checks: those whose findings carry rewrites are the mechanical ones, step 6.)
    const codes = Object.keys(STYLE_SUGGESTIONS) as StyleCode[];
    assert.deepStrictEqual(codes.filter((c) => STYLE_REWRITES[c] !== (STYLE_SUGGESTIONS[c] === 'mechanical')), []);
  });

  // (docs/design/oracles.md, step 5: every fact of a mechanical id the corpus raises carries its rewrites, but where
  // 3.1 and 3.2 give none: in a string another command reads as a script, where the code would need quoting; on the
  // right of `||` with a here-document, whose body the group would cut off; where 3.1 says "none"; in a host file.
  // Step 6: the same of the style checks whose findings carry rewrites.)
  const WITHOUT: { id: SuggestionId; input: string; why: 'string' | 'heredoc' | 'none' }[] = [
    { id: 'declaration-masks-status', input: "sh -c 'f() {\n  local x=$(false)\n}'", why: 'string' },
    { id: 'bracket-close-glued', input: '[ a = b\\]', why: 'none' },
    { id: 'unquoted-variable-as-path', input: "eval 'rm -rf $Q/*'", why: 'string' },
    { id: 'unquoted-variable-as-path', input: "trap 'rm -f $tmp' EXIT", why: 'string' },
    { id: 'nounset-unbound', input: "bash -c 'set -u; f() { echo \"$z\"; }; f'", why: 'string' },
    { id: 'regex-backslash-dropped', input: '[[ $x =~ ^[\\s]+$ ]]', why: 'none' },
    // (The style checks: several words after `=`, which have no one meaning as a value, or a redirection among them;
    // a `{` with no `}` after it; an escaped `]` or `}`, or a `]` that is not the opener's; a redirection that stands
    // for a comparison only by its target, a number (`[ $a 2>5 ]`), or with `>>`, another redirection, no word after it
    // or no `]`. The check before `rm`, which carries no edits, is apart.)
    { id: 'assignment-with-spaces', input: '! a = b -a -f c', why: 'none' },
    { id: 'assignment-with-spaces', input: 'a = b -a ( c -o d )', why: 'none' },
    { id: 'assignment-with-spaces', input: 'a = b -a c = d', why: 'none' },
    { id: 'assignment-with-spaces', input: 'x = >f 1', why: 'none' },
    { id: 'assignment-with-spaces', input: 'x = a b', why: 'none' },
    { id: 'assignment-with-spaces', input: 'x =a b', why: 'none' },
    { id: 'brace-no-space', input: '{oops', why: 'none' },
    { id: 'brace-no-space', input: '{echo a\\}', why: 'none' },
    { id: 'bracket-close-in-word', input: '[ "$x"\\]', why: 'none' },
    { id: 'bracket-close-in-word', input: '[ -n $(f)x\\]', why: 'none' },
    { id: 'bracket-no-space', input: '[-f x\\]', why: 'none' },
    { id: 'bracket-no-space', input: '[[-f x]', why: 'none' },
    { id: 'redirect-in-bracket', input: '[ $a 2>5 ]', why: 'none' },
    { id: 'redirect-in-bracket', input: '[ a < b > c ]', why: 'none' },
    { id: 'redirect-in-bracket', input: '[ $a < $b -a x', why: 'none' },
    { id: 'redirect-in-bracket', input: '[ a <  > c ]', why: 'none' },
    { id: 'redirect-in-bracket', input: '[ a > 5 c ]', why: 'none' },
    { id: 'redirect-in-bracket', input: '[ a >> b ]', why: 'none' },
  ];
  it('finds a rewrite on every fact of a mechanical id in the corpus, but where none is given', function () {
    // (Explaining every line of the 1,800 snippets and the fixtures takes 4.5 s, spread over the analyzer with no one hot
    // spot; 6.3 s alone and 7 s in a coverage run with three workers, against mocha's 10 s: too near for a loaded runner.)
    this.timeout(60000);
    const key = ({ id, input }: { id: SuggestionId; input: string }): string => `${id}: ${input}`;
    // (The check before `rm -rf ${D%/}/x`, said as code to write before it: no edits, since the warning would stay after
    // it, docs/design/semantics.md 4.15.)
    const checkBefore = (f: { fact: { id: SuggestionId; text: string } }): boolean => f.fact.id === 'rm-empty-variable-root' && /before it to stop when it is empty$/.test(f.fact.text);
    assert.deepStrictEqual(corpusFacts().filter((f) => !f.fact.rewrite && !checkBefore(f)).map((f) => key({ id: f.fact.id, input: f.input })).sort(), WITHOUT.map(key).sort());
    const checks = corpusFacts().filter(checkBefore);
    assert.ok(checks.length > 0);
    assert.deepStrictEqual(checks.filter((f) => f.fact.rewrite).map((f) => f.input), []);
    // (The facts of the host files carry none: their edits would be offsets in the extracted text.)
    const parser = createUnbashParser();
    const dir = path.join(__dirname, 'fixtures/hosts');
    const hosted = fs.readdirSync(dir).sort().flatMap((file) => {
      const src = fs.readFileSync(path.join(dir, file), 'utf8');
      const extracted = extractShell(hostKind('', file)!, src);
      const tree = parser.parse(extracted.text);
      const lines = src.split('\n');
      return lines.flatMap((_, i) => explainHostedLine(new Analyzer('en'), tree, extracted, lines, i, 'en')?.facts ?? []).filter((f) => MECHANICAL.includes(f.id));
    });
    assert.ok(hosted.length > 0);
    assert.deepStrictEqual(hosted.filter((f) => f.rewrite), []);
  });

  it('counts them', () => {
    const count = (kind: Kind) => Object.values(SUGGESTIONS).filter((k) => (typeof k === 'string' ? k : k.kind) === kind).length;
    assert.deepStrictEqual({ mechanical: count('mechanical'), scenario: count('scenario'), prose: count('prose'), none: count('none') },
      { mechanical: 19, scenario: 25, prose: 20, none: 90 });
    const style = (kind: Kind) => Object.values(STYLE_SUGGESTIONS).filter((k) => k === kind).length;
    assert.deepStrictEqual({ mechanical: style('mechanical'), scenario: style('scenario'), prose: style('prose') }, { mechanical: 11, scenario: 1, prose: 1 });
  });
});
