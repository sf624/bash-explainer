// unused_deps (src/dict/unused_deps.ts): the explanation of a call, and, with the real binary of bazel-contrib/buildtools
// (found in $UNUSED_DEPS or on PATH; CI does not install it), the flags of its usage. The analysis itself needs a bazel
// workspace and is not run.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { Analyzer, lookupCommand, Token } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

const which = (): string | undefined => {
  if (process.env.UNUSED_DEPS) return process.env.UNUSED_DEPS;
  const r = spawnSync('bash', ['--norc', '-c', 'command -v unused_deps'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : undefined;
};
const BIN = which();
const real = (BIN ? it : it.skip) as typeof it;

const parser = createUnbashParser();
/** The words after `unused_deps`, each with its text. */
const parts = (src: string, lang: 'en' | 'ja' = 'en'): string[] => {
  const out: Token[] = [];
  const walk = (t: Token) => (out.push(t), t.children.forEach(walk));
  new Analyzer(lang).explainLine(parser.parse(src), 0).items.forEach(walk);
  return out.filter((t) => t.kind === 'argument' || t.kind === 'option').map((t) => `${t.label}: ${t.explanation}`);
};

describe('unused_deps', () => {
  it('reads its options, and its operands as target patterns', () => {
    const p = parts('unused_deps -cquery -build_tool=bazelisk //app:main //lib/...');
    assert.match(p[0], /^-cquery: use `cquery` instead of `query`/);
    assert.match(p[1], /^-build_tool=bazelisk: .*the build executable to run/);
    assert.match(p[2], /^\/\/app:main: target pattern \(`\/\/app:main`\), `\/\/\.\.\.` when none is given — One target, `\/\/app:main`/);
    assert.match(p[3], /^\/\/lib\/\.\.\.: target pattern .* Every rule of the packages in the directory `lib`/);
    assert.match(parts('unused_deps //app:main', 'ja')[0], /^\/\/app:main: ターゲットのパターン（`\/\/app:main`。省略すると `\/\/\.\.\.`）/);
  });

  it('says in its summary that it prints buildozer commands and changes nothing', () => {
    const s = lookupCommand('unused_deps')!.summary;
    assert.match(String(s.en), /Java-like rules .*kt.*java.*android.*print the buildozer commands.*changes nothing itself/);
    assert.match(String(s.ja), /`kt`、`java`、`android`.*buildozer コマンドを標準出力に表示する（自分では何も書き換えない）/);
  });

  real('every flag of the usage is in the spec, and every option of the spec is a flag', () => {
    const r = spawnSync(BIN!, ['-h'], { encoding: 'utf8', timeout: 30000, env: { ...process.env, HOME: '/nonexistent' } });
    assert.strictEqual(r.status, 2);
    const flags = [...(r.stdout + r.stderr).matchAll(/^ {2}-([A-Za-z_]+)/gm)].map((m) => m[1]);
    assert.ok(flags.length >= 7, flags.join(' '));
    const known = new Set(lookupCommand('unused_deps')!.options!.flatMap((o) => o.names));
    for (const f of flags) assert.ok(known.has('-' + f), f);
    for (const n of known) if (n !== '-help' && n !== '-h') assert.ok(flags.includes(n.slice(1)), n);
  });

  real('-version prints the version whatever the targets, and a call that needs bazel shows the query it runs', () => {
    const run = (args: string[]) => spawnSync(BIN!, args, { encoding: 'utf8', timeout: 30000, env: { ...process.env, HOME: '/nonexistent', PATH: '/nonexistent' } });
    const v = run(['-version', '//app:main']);
    assert.strictEqual(v.status, 0);
    assert.match(v.stdout, /^unused_deps version: 10\.2\.0/);
    assert.match(run(['//app:main']).stderr, / query --tool_tag=unused_deps .* kind\('\(kt\|java\|android\)_\*', \/\/app:main\)/);
    assert.match(run(['-cquery', '//app:main']).stderr, / cquery --tool_tag=unused_deps .* kind\('\(kt\|java\|android\)_\*', \/\/app:main\)/);
    assert.match(run([]).stderr, /kind\('\(kt\|java\|android\)_\*', \/\/\.\.\.\)/);
  });
});
