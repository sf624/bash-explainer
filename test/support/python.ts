import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { PYTHON_REFERENCE } from '../../src/hosts/pylex';

// The reference Python of the tests that compare with it (docs/design/python-regex.md, section 7): found at
// $BASH_EXPLAINER_PYTHON, or as `python3` when that is the release. Without it the comparisons are skipped, and
// BASH_EXPLAINER_PYTHON_REQUIRED=1 (CI's Python job) makes that fail. Python is only run as a separate program.

/** The reference Python, or why there is none. */
export function pythonReference(): { python: string } | { skip: string } {
  const python = process.env.BASH_EXPLAINER_PYTHON || 'python3';
  const r = spawnSync(python, ['-I', '-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf8', timeout: 20000 });
  const version = r.status === 0 ? r.stdout.trim() : undefined;
  return version === PYTHON_REFERENCE ? { python } : { skip: `${python} is ${version ?? 'not found'}, not Python ${PYTHON_REFERENCE}` };
}

/** In a mocha `before`: skips the suite without the reference, or fails when it is required. */
export function needPython(ctx: Mocha.Context, ref: ReturnType<typeof pythonReference>): void {
  if (!('skip' in ref)) return;
  if (process.env.BASH_EXPLAINER_PYTHON_REQUIRED) assert.fail(`BASH_EXPLAINER_PYTHON_REQUIRED is set, but ${ref.skip}`);
  ctx.skip();
}
