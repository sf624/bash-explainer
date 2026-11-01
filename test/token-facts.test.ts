// What each token of a line says it is and which facts it states (docs/design/sources.md, SB3a): its colour role, from
// its kind (`Token.role`, src/roles.ts), the same in both languages and the same as the panel's style sheet; and the
// catalog's facts said at its node (`Token.facts`). And the note on the order of redirections, a fact of the catalog:
// the table, and `2>&1` before `>file` as a caveat with the rewrite `>file 2>&1`, but not before a pipe.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type { Token } from '../src/analyzer';
import { documentIssues, type ShellDocument } from '../src/document';
import { KIND_ROLES } from '../src/roles';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { runBash } from './support/bash';
import { allTokens, explain } from './support/explain';

const parser = createUnbashParser();
const doc = (text: string): ShellDocument => ({ lines: text.split('\n'), tree: parser.parse(text) });

/** The tokens of a line that state facts, as `label: ids`. */
const stated = (src: string, line = 0): string[] => allTokens(explain(src, line).items).filter((t) => t.facts).map((t) => `${t.label}: ${t.facts!.join(' ')}`);

describe('the role and the facts of each token', () => {
  it('gives every token the role of its kind, in both languages alike', () => {
    for (const src of ['if [ -f a ]; then echo "$x" > out; fi', 'ls -l | grep -c x 2>&1', 'f() { local y=1; }', 'git commit -m "a b" # c', 'for i in *; do :; done']) {
      const roles = (lang: 'ja' | 'en') => allTokens<Token>(explain(src, 0, lang).items).map((t) => [t.kind, t.role]);
      assert.deepStrictEqual(roles('ja'), roles('en'), src);
      for (const [kind, role] of roles('en')) assert.strictEqual(role, KIND_ROLES[kind as Token['kind']], src);
    }
    // (A word that a keyword out of place made an error has the error's role: the kind as it is at the end.)
    const stray = allTokens(explain('if [ -f a ] then echo x; fi').items).find((t) => t.kind === 'error')!;
    assert.strictEqual(stray.role, 'error');
  });

  it('colours each kind in the panel\'s style sheet with its role (media/panel.css)', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'media', 'panel.css'), 'utf8');
    const wrong = Object.entries(KIND_ROLES).filter(([kind, role]) => !new RegExp(`\\.kind-${kind}\\b[^{]*\\{ color: var\\(--c-${role}\\b`).test(css));
    assert.deepStrictEqual(wrong, []);
  });

  it('lists the facts said at a token\'s node on that token, in the order said', () => {
    assert.deepStrictEqual(stated('rm -rf $d/'), ['$d/: unquoted-variable-as-path']);
    // (A fact the token's text states too.)
    assert.deepStrictEqual(stated('if [ -f a ] then echo x; fi'), ['if ‹condition› fi: keyword-needs-separator']);
    // (At a node with no token of its own: the innermost token around it; the stage of a pipeline is in the pipe's.)
    assert.deepStrictEqual(stated('echo x 2>&1 >out.log'), ['2>&1: redirections-in-order stderr-to-original-stdout', '>out.log: redirections-in-order']);
    // (A fact about the line, where a statement goes on, is on no token.)
    const continued = explain('echo a \\\n  b', 1);
    assert.ok(continued.facts!.some((f) => f.id === 'statement-continued'));
    assert.deepStrictEqual(allTokens(continued.items).filter((t) => t.facts?.includes('statement-continued')), []);
  });

  it('gives no token a fact the line does not say: with the pitfalls off, a caveat is on none', () => {
    const ex = explain('echo x 2>&1 >out.log', 0, 'en', { pitfalls: false });
    assert.deepStrictEqual(allTokens(ex.items).flatMap((t) => t.facts ?? []).sort(), ['redirections-in-order', 'redirections-in-order']);
  });
});

describe('the order of redirections (3.6)', () => {
  const issue = (text: string) => documentIssues(doc(text), 'en', {}).find((i) => i.code === 'stderr-to-original-stdout');

  it('says where each descriptor goes, as a note, and `2>&1` before `>file` as a caveat with the rewrite `>file 2>&1`', () => {
    const ex = explain('make 2>&1 >build.log');
    assert.deepStrictEqual(ex.facts!.map((f) => [f.id, f.level]), [['redirections-in-order', 'note'], ['stderr-to-original-stdout', 'info']]);
    assert.strictEqual(ex.notes[0], 'ℹ Redirections apply left to right. In the end: stdout → build.log, stderr → the original stdout');
    assert.strictEqual(ex.notes[1], 'ⓘ Caveat: `2>&1` comes before `>build.log`, so stderr goes to the original stdout, not to the file. To send both to the file, write `>build.log 2>&1`');
    const found = issue('make 2>&1 >build.log')!;
    assert.strictEqual(found.severity, 'info');
    assert.deepStrictEqual(found.fixes!.map((f) => [f.title[1], f.edits]), [['Rewrite as `>build.log 2>&1`', [{ startLine: 0, startCol: 5, endLine: 0, endCol: 20, text: '>build.log 2>&1' }]]]);
    // (What is between them stays before: `2>&1 b >f` becomes `b >f 2>&1`; `>>` and the last file stdout goes to.)
    assert.strictEqual(issue('echo a 2>&1 b >f')!.fixes![0].edits[0].text, 'b >f 2>&1');
    assert.strictEqual(issue('echo a 2>&1 >a >>b')!.fixes![0].edits[0].text, '>a >>b 2>&1');
  });

  it('says no caveat where stdout is a pipe or a command substitution, which then gets only the errors, nor where stderr goes elsewhere in the end', () => {
    // (Where the stdout comes from the environment model: a stage before `|`, `$( )`, `<( )`, a group or a loop piped on.)
    const pipe = ['find / -name x 2>&1 >/dev/null | grep -v denied', 'diff <(make 2>&1 >/dev/null) expected', '{ make 2>&1 >/dev/null; } | grep x',
      'while read -r h; do ssh "$h" true 2>&1 >/dev/null; done < hosts | sort'];
    for (const src of [...pipe, 'err=$(make 2>&1 >/dev/null)']) {
      const ex = explain(src);
      assert.deepStrictEqual(ex.facts!.filter((f) => f.id.startsWith('stderr')), [], src);
      assert.ok(ex.notes.some((n) => n.endsWith(pipe.includes(src) ? '(only the error messages go into the pipe)' : '(only the error messages make the substitution\'s value)')), src);
      assert.strictEqual(issue(src), undefined, src);
    }
    // (The last stage writes into no pipe of its own.)
    assert.ok(issue('cat f | make 2>&1 >build.log'));
    // (`2>e` after: stderr goes to `e`, not to the original stdout.)
    assert.deepStrictEqual(explain('make 2>&1 >o 2>e').facts!.map((f) => f.id), ['redirections-in-order']);
    assert.match(explain('make 2>&1 >o 2>e').notes[0], /stdout → o, stderr → e$/);
  });

  it('applies the `2>&1` of `|&` after the command\'s redirections (3.2.3): stderr goes where stdout goes', () => {
    for (const src of ['make 2>&1 >build.log |& tee errors.log', 'make >build.log |& tee errors.log']) {
      const ex = explain(src);
      assert.deepStrictEqual(ex.facts!.map((f) => f.id), ['redirections-in-order'], src);
      assert.strictEqual(ex.notes[0], 'ℹ Redirections apply left to right. In the end: stdout → build.log, stderr → build.log', src);
    }
    // (The commands inside a stage joined by `|&` write into the pipe: the stage's stderr is the pipe too.)
    assert.strictEqual(issue('{ make 2>&1 >/dev/null; } |& grep x'), undefined);
  });

  it('says what bash does: stderr to the original stdout, to the pipe; both to the file once swapped', () => {
    const f = 'f() { echo out; echo err >&2; }\n';
    assert.deepStrictEqual(runBash(`${f}f 2>&1 >o.txt; echo "file: $(<o.txt)"`, { files: [] }).stdout, 'err\nfile: out\n');
    assert.deepStrictEqual(runBash(`${f}f 2>&1 >/dev/null | sed 's/^/pipe: /'`).stdout, 'pipe: err\n');
    assert.deepStrictEqual(runBash(`${f}f >o.txt 2>&1; echo "file: $(<o.txt)"`, { files: [] }).stdout, 'file: out\nerr\n');
    assert.deepStrictEqual(runBash(`${f}f 2>&1 >o.txt 2>e.txt; echo "o: $(<o.txt) e: $(<e.txt)"`, { files: [] }).stdout, 'o: out e: err\n');
    // (A command substitution gets the errors alone; `|&` comes after the command's redirections.)
    assert.deepStrictEqual(runBash(`${f}e=$(f 2>&1 >/dev/null); echo "[$e]"`).stdout, '[err]\n');
    assert.deepStrictEqual(runBash(`${f}f 2>&1 >o.txt |& sed 's/^/pipe: /'; echo "file: $(<o.txt)"`, { files: [] }).stdout, 'file: out\nerr\n');
  });
});
