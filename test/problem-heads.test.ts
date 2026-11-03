import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import { documentIssues, type ShellDocument } from '../src/document';
import { isProblemNote, MESSAGES, problemText } from '../src/messages';
import { FACT_HEADS, type ProblemFactId, STYLE_HEADS } from '../src/messages-heads';
import type { StyleCase, StyleCode } from '../src/messages-levels';
import { TOKEN_TEXTS } from '../src/messages-tokens';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { boxProblems } from '../src/ui/panelProblems';

// The headline of each problem (docs/design/panel-redesign.md, P7b): one sentence, in both languages, for each case of its params.

const parser = createUnbashParser();
const doc = (text: string): ShellDocument => ({ lines: text.split('\n'), tree: parser.parse(text) });

/** The cases of each entry's params that its headline tells apart; the type makes the table complete. */
const CASES: { [K in ProblemFactId]: readonly unknown[] } = {
  'exit-refused': [{ why: 'too-many', word: 'a' }, { why: 'not-numeric', word: 'a', exits: true }, { why: 'not-numeric', word: 'a', exits: false }],
  'declaration-masks-status': [{ kw: 'local', v: 'x' }],
  'pipefail-missing': [{ last: 'wc' }],
  'function-last-test-returns-status': [{ name: 'f' }],
  'function-last-test-stops-script': [{ name: 'f' }],
  'script-last-test-returns-status': [{ left: 'a' }],
  'failure-reported-as-success': [{ where: 'function', name: 'f', left: 'a' }, { where: 'script', name: 'f', left: 'a' }, { where: 'fragment', name: 'f', left: 'a' }, { where: 'errexit', name: 'f', left: 'a' }],
  'keyword-needs-separator': [{ kw: 'then' }],
  'bracket-missing-close': [{}],
  'bracket-close-glued': [{ word: 'a]' }],
  'test-malformed': [{ name: '[' }],
  'unset-function-and-variable': [{}],
  'unset-readonly': [{ name: 'x' }],
  'assign-readonly': [{ name: 'x' }],
  'restricted-refused': [{ kind: 'builtin', name: 'cd' }, { kind: 'slash', name: '/bin/ls' }, { kind: 'redirect', name: '>' }],
  'local-outside-function': [{}],
  'posix-special-function-name': [{}],
  'posix-special-function-name-maybe': [{}],
  'posix-function-name': [{}],
  'posix-function-name-maybe': [{}],
  'posix-special-builtin-error': [{ name: 'set' }],
  'posix-special-builtin-error-maybe': [{ name: 'set' }],
  'postfix-increment-status': [{ v: 'i' }, { v: 'i', errexit: true }, { v: 'i', errexit: true, stops: 'subshell' }, { v: 'i', errexit: true, stops: 'unknown' }],
  'postfix-decrement-status': [{ v: 'i' }, { v: 'i', errexit: true, stops: 'script' }],
  'alias-not-expanded-in-script': [{ name: 'll' }, { name: 'll', off: true }, { name: 'll', unread: true }, { name: 'll', fn: true, off: true }],
  'alias-maybe-not-expanded': [{ name: 'll' }],
  'unbraced-element': [{ name: 'a', sub: '[0]' }],
  'extglob-in-same-block': [{ use: '@(a)' }, { use: '@(a)', reader: 'sourced' }],
  'extglob-maybe-on': [{ use: '@(a)' }],
  'extglob-turned-off': [{ use: '@(a)' }],
  'extglob-not-found': [{ use: '@(a)' }],
  'extglob-maybe-on-trap': [{ use: '@(a)' }],
  'extglob-not-in-new-shell': [{ use: '@(a)' }, { use: '@(a)', reader: 'interactive' }],
  'globstar-maybe-on': [{ on: 'shopt -s globstar' }],
  'globstar-not-found': [{ on: 'shopt -s globstar' }],
  'globstar-unsupported': [{ shell: 'dash' }],
  'variable-not-in-remote-shell': [{ v: 'x' }, { v: 'x', unread: true }, { v: 'x', sent: true }],
  'variable-not-passed-by-wrapper': [{ v: 'x', via: 'sudo' }],
  'variable-not-exported': [{ v: 'x', array: true }, { v: 'x', environment: 'maybe' }, { v: 'x', environment: 'unlikely' }, { v: 'x', unread: true }, { v: 'x' }],
  'function-not-in-container': [{ name: 'f' }],
  'builtin-or-function-as-program': [{ via: 'sudo', name: 'f', isFn: true }, { via: 'sudo', name: 'cd', isFn: false }],
  'ssh-local-expansion': [{ risky: '$x' }],
  'function-not-on-remote': [{ name: 'f' }],
  'function-not-in-new-shell-blocked': [{ via: 'bash -c', fn: 'f' }],
  'function-not-in-new-shell': [{ via: 'bash -c', fn: 'f' }],
  'function-not-imported': [{ shell: 'dash', fn: 'f' }],
  'function-not-in-new-shell-export': [{ via: 'bash -c', fn: 'f' }],
  'function-not-imported-sh': [{ fn: 'f' }],
  'function-shadowed-by-program': [{ name: 'f' }],
  'wrapper-assignment-expanded-first': [{ use: '$x', via: 'env', v: 'x' }],
  'pipeline-subshell-variable': [{ used: 'x' }, { used: 'x', partial: true }],
  'unmatched-glob-runs-once': [{ glob: '*.txt', v: 'f', how: { menu: true } }, { glob: '*.txt', v: 'f', how: { menu: false } }],
  'prefix-assignment-expanded-first': [{ v: 'x', name: 'a', use: '$x' }],
  'unquoted-variable-as-path': [{ bare: '$x', destroys: true }, { bare: '$x' }],
  'for-over-ls-output': [{ cmd: 'ls' }],
  'for-over-unquoted-args': [{ value: '$@' }],
  'array-joined-in-assignment': [{ v: 'x', args: true }, { v: 'x', args: false }],
  'unquoted-variable-in-test': [{ bare: '$x', zsh: true }, { bare: '$x' }],
  'nounset-unbound': [{ v: '$x', name: 'x', environment: 'no' }, { v: '$x', name: 'x', environment: 'maybe' }],
  'shebang-refused': [{ rest: '-x -y' }],
  'find-action-refused': [{ option: '-exec' }],
  'shebang-bom': [{}],
  'redirect-by-your-shell': [{ op: '>', file: '/etc/a' }, { op: '>' }],
  'bats-tags-invalid': [{ scope: 'test' }],
  'bats-test-line-dropped': [{ dropped: 'x' }],
  'bats-negation-ignored': [{ cmd: 'a' }],
  'bats-run-in-pipeline-stage': [{ cmd: 'a' }],
  'bats-run-in-pipeline': [{ cmd: 'a' }],
  'bats-setup-suite-in-test-file': [{}],
  'regex-backslash-dropped': [{ list: '`\\d`' }],
  'distro-alias-in-script': [{ name: 'll', what: { ja: 'エイリアス', en: 'an alias' } }],
  'dockerfile-pipefail-missing': [{}],
  'python-string-without-shell': [{}],
  'python-shell-injection': [{}],
  'actions-script-injection': [{ expr: '${{ x }}' }],
  'stderr-to-original-stdout': [{ dup: '2>&1', file: '>f', discards: true }, { dup: '2>&1', file: '>f', discards: false }],
};

const STYLE_CASES: Record<StyleCode, readonly StyleCase[]> = {
  'bracket-no-space': [{}], 'assignment-with-spaces': [{}], 'brace-no-space': [{}], 'brace-close-no-separator': [{}], 'rm-empty-variable-root': [{}], 'read-without-r': [{}],
  'redirect-in-bracket': [{}], 'bracket-close-in-word': [{}, { maybeEmpty: true }], 'and-or-in-bracket': [{}], 'download-run-by-shell': [{}], 'trap-goes-on': [{}],
  'source-searches-path': [{}], 'pattern-from-variable': [{}],
};

/** A headline, in both languages: one sentence, no fix. */
function assertHead([ja, en]: readonly [string, string], what: string): void {
  // (Code may hold any character: a sentence's end is looked for outside it.)
  const words = (t: string) => t.replace(/`[^`]*`/g, 'x');
  assert.match(ja, /。$/, `${what}: ja ends a sentence`);
  assert.match(en, /\.$/, `${what}: en ends a sentence`);
  assert.strictEqual(words(ja).split('。').length, 2, `${what}: ja is one sentence: ${ja}`);
  assert.strictEqual(words(en).split(/\.(?: |$)/).length, 2, `${what}: en is one sentence: ${en}`);
  assert.ok(en.length <= 120, `${what}: en is short: ${en}`);
  assert.ok(ja.length <= 90, `${what}: ja is short: ${ja}`);
  assert.doesNotMatch(ja, /ます。$|です。$/, `${what}: ja in the plain style`);
}

describe('the headline of each problem', () => {
  it('is there for every entry of the catalog that can be a problem, and for no other', () => {
    const problems = Object.entries(MESSAGES).filter(([, e]) => {
      const entry = e as { kind: string; level?: unknown };
      return entry.kind === 'pitfall' || entry.level !== undefined;
    }).map(([id]) => id).sort();
    assert.deepStrictEqual(Object.keys(FACT_HEADS).sort(), problems);
  });

  it('is one sentence for each case of the params', () => {
    for (const [id, cases] of Object.entries(CASES)) {
      for (const c of cases) assertHead((FACT_HEADS as unknown as Record<string, (p: unknown) => [string, string]>)[id](c), id);
    }
    for (const [code, cases] of Object.entries(STYLE_CASES)) {
      for (const c of cases) assertHead(STYLE_HEADS[code as StyleCode](c), code);
    }
    for (const [id, e] of Object.entries(TOKEN_TEXTS)) {
      const { level, problem } = e as { level?: string; problem?: { head: readonly [string, string] } };
      if (level === 'error') assertHead(problem!.head, id);
      else assert.strictEqual(problem, undefined, id);
    }
  });

  it('is on every problem note of the corpus, and "more" holds the same text as the Problems lists', function () {
    this.timeout(120000);
    const snippets = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'snippets.json'), 'utf8')) as string[];
    const sample = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.sh'), 'utf8');
    let seen = 0;
    for (const lang of ['en', 'ja'] as const) {
      const analyzer = new Analyzer(lang);
      // (Japanese has the same notes: a part of the corpus says so, at a fifth of the time.)
      for (const text of [sample, ...snippets.filter((_, i) => lang === 'en' || i % 5 === 0)]) {
        const d = doc(text);
        const messages = new Set(documentIssues(d, lang, {}).map((i) => i.message));
        for (let line = 0; line < d.lines.length; line++) {
          const ex = analyzer.explainLine(d.tree, line);
          for (const n of ex.noteInfo.filter(isProblemNote)) assert.ok(n.head, `${n.code} in ${JSON.stringify(text)}`);
          const box = boxProblems(ex, ex.items, lang);
          assert.deepStrictEqual(box.map((p) => p.text).sort(), ex.noteInfo.filter(isProblemNote).map((n) => problemText(n, lang)).sort());
          seen += box.length;
          // (A problem with a place is one of the document's problems, with the same text.)
          for (const p of box) if (p.rows.length) assert.ok(messages.has(p.text), `${p.text} in ${JSON.stringify(text)}`);
        }
      }
    }
    assert.ok(seen > 500, `${seen} problems`);
  });
});
