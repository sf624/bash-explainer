// The problem `syntax-error` against the real shells, off the tables of its reviews: the shapes of
// test/fixtures/syntax-tokens.json and valid scripts, with one token dropped, swapped or inserted at each position
// (test/support/syntax-mutations.ts). Where `-n` accepts the text, nothing is said; where a token is named, it is the shell's.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import type { BashVersion } from '../src/bashversion';
import type { Shell } from '../src/shellfeatures';
import { syntaxFault } from '../src/semantics/syntaxerror';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import type { SyntaxErrorWhat } from '../src/syntax/tree';
import { mutations } from './support/syntax-mutations';
import { agreesWithBash, agreesWithDash, shellSaysContained } from './support/syntax-shells';

/** A change of this number says that the table changed; it is what keeps the table from going empty. */
const ROWS = 5517;
/** What is named by each shell, at least: a rule that names nothing passes the rest. */
const NAMED = { bash: 2500, sh: 2000 };

const parser = createUnbashParser();
const rows = mutations();

async function compare(tool: string, shell: Shell, version: BashVersion | undefined, agrees: (what: SyntaxErrorWhat, message: string, row?: number) => boolean | undefined): Promise<{ named: number; wrong: string[]; accepted: string[] }> {
  const said = await shellSaysContained(tool, rows, 60000);
  const out = { named: 0, wrong: [] as string[], accepted: [] as string[] };
  rows.forEach((text, i) => {
    const fault = syntaxFault(parser.parse(text), shell, version);
    if (!fault) return;
    const shown = `${JSON.stringify(text)}: ${JSON.stringify(fault.what)}; ${said[i].message}`;
    if (said[i].status === 0) out.accepted.push(shown);
    if (fault.said) return;
    const agreed = agrees(fault.what, said[i].message, 'token' in fault.what ? fault.node.startPosition.row : undefined);
    if (agreed !== undefined) out.named++;
    if (agreed === false) out.wrong.push(shown);
  });
  return out;
}

describe('a syntax error, with one token of a script dropped, swapped or inserted', function () {
  this.timeout(120000);

  it('has its table', () => {
    assert.strictEqual(rows.length, ROWS);
  });

  it('says none that bash -n accepts, and names only what it names', async function () {
    if (!/version 5\.2/.test(spawnSync('bash', ['--version'], { encoding: 'utf8' }).stdout ?? '')) this.skip();
    const r = await compare('bash', 'bash', undefined, agreesWithBash);
    assert.strictEqual(r.accepted.join('\n'), '');
    assert.strictEqual(r.wrong.join('\n'), '');
    assert.ok(r.named > NAMED.bash, `${r.named} named`);
  });

  it('says none that dash -n accepts, and names only what it names, for sh', async () => {
    const r = await compare('dash', 'sh', undefined, agreesWithDash);
    assert.strictEqual(r.accepted.join('\n'), '');
    assert.strictEqual(r.wrong.join('\n'), '');
    assert.ok(r.named > NAMED.sh, `${r.named} named`);
  });

  it('says none that bash 5.3 -n accepts, and names only what it names, for bash 5.3', async function () {
    const bash53 = process.env.BASH_EXPLAINER_BASH53;
    if (!bash53) this.skip();
    const r = await compare(bash53!, 'bash', '5.3', agreesWithBash);
    assert.strictEqual(r.accepted.join('\n'), '');
    assert.strictEqual(r.wrong.join('\n'), '');
    assert.ok(r.named > NAMED.bash, `${r.named} named`);
  });
});
