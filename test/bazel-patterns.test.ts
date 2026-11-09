// bazel's target patterns (src/embedded/bazel.ts) against what bazel 9.3.2 takes of them: scripts/record-bazel.ts records,
// in test/fixtures/oracles/bazel.json, the targets of test/fixtures/bazel (`universe`) and the targets a query or a build
// takes of each row's patterns (`patterns`). Each pattern is read with `parseTargetPattern` and resolved here over the
// recorded targets: the packages are the directories of the labels, a wildcard of a build leaves out the `manual` targets
// (not a subtractive one), and a subtractive pattern takes targets out of those of the patterns before it. The reading
// must give what bazel gave.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { parseTargetPattern, type TargetPattern } from '../src/embedded/bazel';

interface Universe { all: string[]; rules: string[]; manual: string[] }
interface PatternRow { command: 'build' | 'query'; cwd?: string; words: string[]; targets?: string[]; error?: string }
const oracle = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'oracles', 'bazel.json'), 'utf8')) as { universe: Universe; patterns: PatternRow[] };
// (The main repository's names: `@//`, `@@//` and the main module's own, of test/fixtures/bazel/MODULE.bazel.)
const MODULE = /module\(name = "([^"]+)"\)/.exec(fs.readFileSync(path.join(__dirname, 'fixtures', 'bazel', 'MODULE.bazel'), 'utf8'))![1];

const pkgOf = (label: string): string => label.slice(2, label.indexOf(':'));
const join = (cwd: string, pkg: string): string => [cwd, pkg].filter(Boolean).join('/');

/** The targets bazel takes of one pattern, in the fixture workspace from `cwd` (no `-`: what it names). */
function resolve(p: TargetPattern, cwd: string, { all, rules, manual }: Universe, build: boolean): string[] | 'error' {
  // (The workspace has no other repository: `@@fixture` is none, the main repository's canonical name being empty.)
  if (p.refused || (p.repo && p.repo.name !== '' && (p.repo.canonical || p.repo.name !== MODULE))) return 'error';
  const packages = new Set(all.map(pkgOf));
  const base = p.absolute ? p.pkg : join(cwd, p.pkg);
  let picked: string[];
  if (p.recursive) {
    const under = [...packages].filter((q) => base === '' || q === base || q.startsWith(`${base}/`));
    if (!under.length) return 'error';
    picked = all.filter((l) => under.includes(pkgOf(l)));
  } else if (p.ambiguous) {
    // (The longest leading part that is a package, the rest the name; at least the current directory.)
    const dirs = base.split('/');
    const k = [...dirs.keys()].map((i) => dirs.length - i).find((n) => n >= (cwd ? cwd.split('/').length : 0) && packages.has(dirs.slice(0, n).join('/')));
    if (k === undefined) return 'error';
    const label = `//${dirs.slice(0, k).join('/')}:${k === dirs.length ? dirs.at(-1) : dirs.slice(k).join('/')}`;
    return all.includes(label) ? [label] : 'error';
  } else {
    if (!packages.has(base)) return 'error';
    if (!p.wildcard) return all.includes(`//${base}:${p.name}`) ? [`//${base}:${p.name}`] : 'error';
    picked = all.filter((l) => pkgOf(l) === base);
  }
  if (p.wildcard === 'rules') picked = picked.filter((l) => rules.includes(l));
  // (A subtractive wildcard takes the `manual` targets out too: `//app:debug -//app/...` builds nothing.)
  return build && !p.negative ? picked.filter((l) => !manual.includes(l)) : picked;
}

describe('bazel target patterns, as bazel 9.3.2 takes them (recorded)', () => {
  it('the workspace has rules, files and a `manual` target', () => {
    const { all, rules, manual } = oracle.universe;
    assert.ok(all.some((l) => !rules.includes(l)) && manual.length > 0 && manual.every((l) => rules.includes(l)));
  });
  for (const row of oracle.patterns) {
    const where = row.cwd ? ` (in ${row.cwd})` : '';
    it(`bazel ${row.command} ${row.words.join(' ')}${where}`, () => {
      let taken: string[] | 'error' = [];
      for (const word of row.words) {
        const p = parseTargetPattern(word);
        assert.ok(p, word);
        const got = resolve(p, row.cwd ?? '', oracle.universe, row.command === 'build');
        if (got === 'error') { taken = 'error'; break; }
        taken = p.negative ? taken.filter((l) => !got.includes(l)) : [...new Set([...taken, ...got])];
      }
      assert.deepStrictEqual(taken === 'error' ? 'error' : taken.sort(), row.targets ?? 'error', row.error);
    });
  }
});
