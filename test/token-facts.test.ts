// What each token of a line says it is and which facts it states (docs/design/sources.md, SB3a): its colour role, from
// its kind (`Token.role`, src/roles.ts), the same in both languages and the same as the panel's style sheet; and the
// catalog's facts said at its node (`Token.facts`). And the note on the order of redirections, a fact of the catalog:
// the table, and `2>&1` before `>file` as a caveat that says both things it may mean, but not before a pipe.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Analyzer, type Token } from '../src/analyzer';
import { documentIssues, type ShellDocument } from '../src/document';
import { explainHostedLine, extractShell, hostKind } from '../src/hosts';
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

  it('says where each descriptor goes, as a note, and `2>&1` before `>file` as a caveat that says both meanings, with no fix', () => {
    const ex = explain('make 2>&1 >build.log');
    assert.deepStrictEqual(ex.facts!.map((f) => [f.id, f.level]), [['redirections-in-order', 'note'], ['stderr-to-original-stdout', 'info']]);
    assert.strictEqual(ex.notes[0], 'ℹ Redirections apply left to right. In the end: stdout → build.log, stderr → the original stdout');
    assert.strictEqual(ex.notes[1], 'ⓘ Caveat: `2>&1` comes before `>build.log`, so stderr goes where stdout went before, not to the file. To send both to the file, write `>build.log 2>&1`; to send only stdout there, `>build.log` is enough');
    assert.strictEqual(explain('make 2>&1 >/dev/null').notes[1], 'ⓘ Caveat: `2>&1` comes before `>/dev/null`, so stderr goes where stdout went before stdout was discarded. To hide both, write `>/dev/null 2>&1`; to keep only the errors, `>/dev/null` is enough');
    assert.strictEqual(explain('make 2>&1 >/dev/null', 0, 'ja').notes[1], 'ⓘ 注意: `2>&1` が `>/dev/null` より先にあるので、標準エラー出力は、標準出力が捨てられる前の行き先に出る。両方を捨てるなら `>/dev/null 2>&1` と書く。エラーだけを残すなら `>/dev/null` だけでよい');
    const found = issue('make 2>&1 >build.log')!;
    assert.strictEqual(found.severity, 'info');
    assert.strictEqual(found.fixes, undefined);
    // (`>>` and the last file stdout goes to, as written.)
    assert.match(explain('echo a 2>&1 >a >>b').notes[1], /write `>>b 2>&1`; to send only stdout there, `>>b` is enough$/);
  });

  it('says no caveat where stdout is a pipe or a command substitution, which then gets only the errors, nor where stderr goes elsewhere in the end', () => {
    // (Where the stdout comes from `stdoutAt`: a stage before `|`, `$( )`, `<( )`, a group or a loop piped on.)
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

  it('reads a function\'s stdout from all its calls, a slot\'s command from the slot, and leaves what the host calls alone', () => {
    const caveat = (src: string, line: number) => explain(src, line).facts!.filter((f) => f.id.startsWith('stderr')).length;
    // (Every call captures it, or pipes it: also from a function that a function calls.)
    assert.strictEqual(caveat('f() { make 2>&1 >/dev/null; }\nerr=$(f)', 0), 0);
    assert.strictEqual(caveat('f() { make 2>&1 >/dev/null; }\nf | grep x', 0), 0);
    assert.strictEqual(caveat('g() { make 2>&1 >/dev/null; }\nf() { g; }\nerr=$(f)', 0), 0);
    // (Two commands of one body read the calls once; the note holds for both.)
    assert.strictEqual(explain('f() { make 2>&1 >/dev/null; ls 2>&1 >/dev/null; }\nerr=$(f)').facts!.filter((x) => x.id.startsWith('stderr')).length, 0);
    // (A plain call; calls that differ; no call seen: the caveat stays.)
    assert.strictEqual(caveat('f() { make 2>&1 >o; }\nf', 0), 1);
    assert.strictEqual(caveat('f() { make 2>&1 >o; }\nf\nerr=$(f)', 0), 1);
    assert.strictEqual(caveat('f() { make 2>&1 >o; }', 0), 1);
    // (A string a shell runs writes where that command does: into the pipe here, on the script's stdout there.)
    assert.ok(explain("bash -c 'make 2>&1 >/dev/null' | grep x").notes.some((n) => n.endsWith('(only the error messages go into the pipe)')));
    assert.strictEqual(caveat("bash -c 'make 2>&1 >o'", 0), 1);
    // (A bats test, in a process the host starts: what it does with stdout is not this script's.)
    const bats = '@test "a" {\n  make 2>&1 >o\n}\n';
    const extracted = extractShell(hostKind('', 't.bats', bats)!, bats);
    const hosted = explainHostedLine(new Analyzer('en'), parser.parse(extracted.text), extracted, bats.split('\n'), 1, 'en')!;
    assert.ok(hosted.facts!.some((f) => f.id === 'stderr-to-original-stdout'));
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
    // (The caveat's two meanings: `>/dev/null 2>&1` hides both; `>/dev/null` keeps only the errors; as written, stderr goes on stdout.)
    const streams = (code: string) => { const r = runBash(`${f}${code}`); return [r.stdout, r.stderr]; };
    assert.deepStrictEqual(streams('f 2>&1 >/dev/null'), ['err\n', '']);
    assert.deepStrictEqual(streams('f >/dev/null 2>&1'), ['', '']);
    assert.deepStrictEqual(streams('f >/dev/null'), ['', 'err\n']);
    assert.deepStrictEqual(runBash(`${f}f 2>&1 >o.txt; echo "file: $(<o.txt)"`, { files: [] }).stdout, 'err\nfile: out\n');
    assert.deepStrictEqual(runBash(`${f}f 2>&1 >/dev/null | sed 's/^/pipe: /'`).stdout, 'pipe: err\n');
    assert.deepStrictEqual(runBash(`${f}f >o.txt 2>&1; echo "file: $(<o.txt)"`, { files: [] }).stdout, 'file: out\nerr\n');
    assert.deepStrictEqual(runBash(`${f}f 2>&1 >o.txt 2>e.txt; echo "o: $(<o.txt) e: $(<e.txt)"`, { files: [] }).stdout, 'o: out e: err\n');
    // (A command substitution gets the errors alone; `|&` comes after the command's redirections.)
    assert.deepStrictEqual(runBash(`${f}g() { f 2>&1 >/dev/null; }; e=$(g); echo "[$e]"`).stdout, '[err]\n');
    assert.deepStrictEqual(runBash(`bash -c 'echo out; echo err >&2' 2>&1 | sed 's/^/pipe: /'`).stdout, 'pipe: out\npipe: err\n');
    assert.deepStrictEqual(runBash(`bash -c '{ echo out; echo err >&2; } 2>&1 >/dev/null' | sed 's/^/pipe: /'`).stdout, 'pipe: err\n');
    assert.deepStrictEqual(runBash(`${f}e=$(f 2>&1 >/dev/null); echo "[$e]"`).stdout, '[err]\n');
    assert.deepStrictEqual(runBash(`${f}f 2>&1 >o.txt |& sed 's/^/pipe: /'; echo "file: $(<o.txt)"`, { files: [] }).stdout, 'file: out\nerr\n');
  });
});
