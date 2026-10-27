// What the tests of the catalog's rewrites share (docs/design/oracles.md, 3.2 and 3.3; test/rewrites*.test.ts): the
// facts of an id in a script, their rewrites applied, and a run of a script in bash, in a cgroup, with recorders in
// place of the commands that would act, defined through BASH_ENV.
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Analyzer } from '../../src/analyzer';
import type { Shell } from '../../src/dialect';
import type { Fact, FactId } from '../../src/messages';
import type { Rewrite } from '../../src/rewrite';
import { createUnbashParser } from '../../src/syntax/adapters/unbash';
import { runBash } from './bash';
import { runContained } from './contained';

const parser = createUnbashParser();
const BASH53 = process.env.BASH_EXPLAINER_BASH53;
/** The bashes to run in: bash 5.2 on PATH, and bash 5.3 when `$BASH_EXPLAINER_BASH53` names one. */
export const programs = [...(runBash('true').status === 0 ? [{ name: 'bash 5.2', program: 'bash' }] : []), ...(BASH53 ? [{ name: 'bash 5.3', program: BASH53 }] : [])];

/** The facts of id `id` on every line of `src`, in `lang`. */
export function factsOf(src: string, id: FactId, shell?: Shell, lang: 'en' | 'ja' = 'en'): Fact[] {
  const tree = parser.parse(src);
  return src.split('\n').flatMap((_, i) => new Analyzer(lang).explainLine(tree, i, shell).facts ?? []).filter((f) => f.id === id);
}

/** `text` with the edits of `r` made. */
export function applied(text: string, r: Rewrite): string {
  return [...r.edits].sort((a, b) => b.start - a.start).reduce((t, e) => t.slice(0, e.start) + e.text + t.slice(e.end), text);
}

/** The rewritten scripts of the one fact of `id` in `src`, each with the code its note shows. */
export function rewrites(src: string, id: FactId, shell?: Shell): [code: string, script: string][] {
  const facts = factsOf(src, id, shell);
  assert.strictEqual(facts.length, 1, `one fact of ${id} in ${JSON.stringify(src)}`);
  return facts[0].rewrite!.map((r) => [r.code, applied(src, r)]);
}

/** The recorders: they say what they were given, and `cp` and `tar` fail when `RW_FAIL` is 1. */
export const RECORDERS = 'cp() { echo "@cp $*"; return "${RW_FAIL:-0}"; }\ntar() { echo "@tar"; return "${RW_FAIL:-0}"; }\nrm() { echo "@rm $*"; }\n';

export interface Ran { out: string; err: string; status: number | null }

/**
 * Runs `driver` in bash `program`, in a new directory holding `f.sh` (`script`), the empty files `files`, and the
 * recorders (`recorders`, read through BASH_ENV by every bash started there).
 */
export async function run(program: string, script: string, driver: string, { env = {}, files = [], recorders = RECORDERS }: { env?: Record<string, string>; files?: readonly string[]; recorders?: string } = {}): Promise<Ran> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-rewrites-'));
  try {
    fs.writeFileSync(path.join(dir, 'f.sh'), script);
    fs.writeFileSync(path.join(dir, 'rec.sh'), recorders);
    for (const f of files) fs.writeFileSync(path.join(dir, f), '');
    const r = await runContained([program, '--norc', '--noprofile', '-c', driver], dir, { BASH_ENV: path.join(dir, 'rec.sh'), ...env });
    return { out: r.stdout, err: r.stderr, status: r.status };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
