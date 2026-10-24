// PROTOTYPE (src/basis.ts): the basis of an explanation stays true. Every fact and token text marked as bash's
// behaviour names probe rows that exist (test/probe.test.ts runs them again in bash, and the B steps compare the
// model with them); every try-it names a row too, and bash prints what it says, when it is run as the reader would
// run it, in a terminal.
import * as assert from 'assert';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { BasisSpec, ProbeRef, TryIt } from '../src/basis';
import { MESSAGES, TOKEN_BASES } from '../src/messages';
import { PROBE_BASH, PROBE_KINDS, type ProbeKind, probeSkipReason, readProbeTable } from './support/probe';

type Meta = { basis?: BasisSpec; tryIt?: TryIt | ((p: unknown) => TryIt) };

/** The params a try-it that depends on them is run with: each kind of value it handles. */
const SAMPLES: Record<string, unknown[]> = {
  'declaration-masks-status': ['local', 'export', 'declare', 'readonly', 'typeset'].map((kw) => ({ kw, v: 'x' })),
};

const metas: [string, Meta][] = [...Object.entries(MESSAGES), ...Object.entries(TOKEN_BASES)].filter(([, m]) => (m as Meta).basis || (m as Meta).tryIt) as [string, Meta][];

/** The try-its of an entry: one, or one per sample of its params. */
function tryIts(id: string, m: Meta): TryIt[] {
  if (!m.tryIt) return [];
  if (typeof m.tryIt !== 'function') return [m.tryIt];
  const samples = SAMPLES[id];
  assert.ok(samples, `${id}: a try-it that depends on its params needs samples in SAMPLES`);
  return samples.map((p) => (m.tryIt as (p: unknown) => TryIt)(p));
}

function row(ref: ProbeRef): unknown {
  const [table, id] = ref.split('#') as [ProbeKind, string];
  assert.ok(PROBE_KINDS.includes(table), `${ref}: no table ${table}`);
  const rows = readProbeTable(table).filter((r) => r.id === id);
  assert.strictEqual(rows.length, 1, `${ref}: ${rows.length} rows with this id`);
  return rows[0];
}

describe('basis: what an explanation rests on', () => {
  it('marks some facts, and each names its probe rows', () => {
    assert.ok(metas.length >= 4);
    for (const [id, m] of metas) {
      if (m.basis) {
        assert.ok(m.basis.probes.length, `${id}: a basis of bash's behaviour names the probes that verify it`);
        for (const p of m.basis.probes) row(p);
      }
      for (const t of tryIts(id, m)) row(t.probe);
    }
  });

  it('gives each probe id to one row only', () => {
    for (const kind of PROBE_KINDS) {
      const ids = readProbeTable(kind).map((r) => r.id).filter(Boolean);
      assert.deepStrictEqual(ids, [...new Set(ids)], kind);
    }
  });

  (probeSkipReason ? describe.skip : describe)(`try-its print what they say in bash${probeSkipReason ? ` (${probeSkipReason})` : ''}`, () => {
    // (The code calls `bash` itself, as in a terminal: the probes' bash, first on PATH.)
    let bin = '';
    before(() => {
      bin = fs.mkdtempSync(path.join(os.tmpdir(), 'basis-'));
      const real = PROBE_BASH.includes('/') ? PROBE_BASH : execFileSyncWhich(PROBE_BASH);
      fs.symlinkSync(real, path.join(bin, 'bash'));
    });
    after(() => fs.rmSync(bin, { recursive: true, force: true }));
    for (const [id, m] of metas) {
      it(id, async () => {
        for (const t of tryIts(id, m)) {
          const out = await new Promise<string>((resolve, reject) => execFile(path.join(bin, 'bash'), ['--norc', '--noprofile', '-c', t.code],
            { cwd: bin, env: { PATH: `${bin}:/usr/bin:/bin`, HOME: bin, LC_ALL: 'C' }, timeout: 5000, encoding: 'utf8' },
            (err, stdout) => (err && err.killed ? reject(err) : resolve(stdout))));
          assert.strictEqual(out.replace(/\n$/, ''), t.output, t.code);
        }
      });
    }
  });
});

/** The path of a program on PATH. */
function execFileSyncWhich(name: string): string {
  for (const dir of (process.env.PATH ?? '').split(':')) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`${name} is not on PATH`);
}
