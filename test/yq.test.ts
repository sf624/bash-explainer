import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { judgeYq, yqNotes } from '../src/embedded/yq';

const words = (s: string) => (s.match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map((w) => w.replace(/^'(.*)'$/, '$1'));

describe('judgeYq', () => {
  const cases: [string, string, boolean][] = [
    ["'.a.b' config.yml", 'mikefarah4', false],
    ["e -i '.version = \"1\"' c.yml", 'mikefarah4', true],
    ["-o json '.items[] | .kind' p.yml", 'mikefarah4', true],
    ["-y '.spec | add' x.yml", 'kislyuk', true],
    ["-r '.users[] | ascii_downcase' u.yml", 'kislyuk', true],
    ["r deploy.yml 'spec.(name==web).image'", 'mikefarah3', true],
    ["w -i deploy.yml spec.replicas 3", 'mikefarah3', true],
    ["'.a line_comment = \"x\"' f.yml", 'mikefarah4', true],
    ["--arg v 1 '.a = $v' f.yml", 'kislyuk', true],
  ];
  for (const [cmd, flavor, decided] of cases) {
    it(`yq ${cmd}`, () => {
      const v = judgeYq(words(cmd));
      assert.strictEqual(v.flavor, flavor);
      assert.strictEqual(v.decided, decided);
    });
  }
  it('treats .kind as a field, not the kind function', () => {
    assert.ok(!judgeYq(words("-o json '.kind' f.yml")).reasons.some((r) => /kind/.test(r[1])));
  });
  it('uses hints in the file and the host', () => {
    assert.strictEqual(judgeYq(words("'.a' f.yml"), { doc: 'RUN pip install yq\n' }).flavor, 'kislyuk');
    assert.strictEqual(judgeYq(words("'.a' f.yml"), { doc: 'RUN apt-get install -y yq\n' }).flavor, 'kislyuk');
    assert.strictEqual(judgeYq(words("'.a' f.yml"), { doc: 'brew install yq\n' }).flavor, 'mikefarah4');
    assert.strictEqual(judgeYq(words("'.a' f.yml"), { doc: 'wget https://github.com/mikefarah/yq/releases/download/v4.44.3/yq_linux_amd64' }).flavor, 'mikefarah4');
    assert.strictEqual(judgeYq(words("'.a' f.yml"), { host: 'GitHub Actions `run:` step' }).flavor, 'mikefarah4');
    assert.strictEqual(judgeYq(words("'.a' f.yml"), { setting: 'kislyuk' }).flavor, 'kislyuk');
  });
  it('says what it is explained as, why, and where it works', () => {
    const [head, compat] = yqNotes(judgeYq(words("-o json '.a | pick([\"b\"])' f.yml")), 'en');
    assert.strictEqual(head, 'yq: explained as mikefarah/yq v4 (v4.22.1 or later). Because: `-o json` is a mikefarah/yq v4 option; `pick` is a mikefarah/yq function (jq has none)');
    assert.strictEqual(compat, 'Works with: mikefarah/yq v4 (v4.22.1 or later) ✓ / kislyuk/yq ✗ (no `-o json`, `pick`) / mikefarah/yq v3 ✗ (no jq-style expressions, `-o json`)');
    assert.match(yqNotes(judgeYq(words("'.a' f.yml")), 'en')[0], /cannot be told, so it is explained as mikefarah\/yq v4/);
  });
});

/** Directory with yq-<version> binaries (mikefarah) and yq-kislyuk, from $BASH_EXPLAINER_YQ. */
const dir = process.env.BASH_EXPLAINER_YQ;
(dir ? describe : describe.skip)('minimum versions agree with the yq releases', () => {
  const vkey = (v: string) => v.split('.').map(Number).reduce((a, n) => a * 1000 + n, 0);
  const versions = dir ? fs.readdirSync(dir).filter((f) => /^yq-4\./.test(f)).map((f) => f.slice(3)).sort((a, b) => vkey(a) - vkey(b)) : [];
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'yqv-'));
  fs.writeFileSync(path.join(work, 'in.yml'), 'a:\n  b: 1\n  c: [x, y]\nname: web\n');
  const run = (bin: string, args: string[]) => {
    const r = spawnSync(path.join(dir!, bin), args, { cwd: work, timeout: 10000, env: { ...process.env, HOME: '/home/u' } });
    return `${r.status}:${r.stdout.toString().replace(/\s+/g, ' ').trim()}`;
  };
  // Each command uses one dated feature; `e` keeps "eval omitted" (v4.18) out of it.
  const cmds = [
    "e -o json '.a' in.yml", "e -o xml '.a' in.yml", "e -o csv '.a.c' in.yml", "e -o shell '.a' in.yml", "e -P '.a' in.yml",
    "e '.a.b |= . + 1' in.yml", "e '.a | keys' in.yml", "e '.a | to_entries' in.yml", "e '.a.c | map(. + \"!\")' in.yml",
    "e '[1,1,2] | unique' in.yml", "e '.x = env(HOME)' in.yml", "e '\"${HOME}\" | envsubst' in.yml", "e '.a | pick([\"b\"])' in.yml",
    "e '.a | omit([\"b\"])' in.yml", "e '.name | test(\"^w\")' in.yml", "e '.name | upcase' in.yml", "e '\"1\" | to_number' in.yml",
    "e '.name | @base64' in.yml", "e '.name | @sh' in.yml", "e '.name line_comment = \"hi\"' in.yml", "e '.a | kind' in.yml",
    "e '[1,2] | min' in.yml", "e 'with(.a; .b = 9)' in.yml", "e '.a.c[] as $x ireduce (\"\"; . + $x)' in.yml", "e '.a.b | to_string' in.yml",
    "e '.a.c[0:1]' in.yml", "e 'if .a.b == 1 then \"one\" else \"other\" end' in.yml", "'.a.b' in.yml", "ea '.a' in.yml",
  ];
  for (const cmd of cmds) {
    it(cmd, () => {
      const w = words(cmd);
      const min = judgeYq(w).compat.mikefarah4.min!;
      const latest = run(`yq-${versions[versions.length - 1]}`, w);
      assert.ok(latest.startsWith('0:'), `latest fails: ${latest}`);
      assert.strictEqual(run(`yq-${min}`, w), latest, `works in v${min}`);
      const before = versions.filter((v) => vkey(v) < vkey(min)).pop();
      if (before) assert.notStrictEqual(run(`yq-${before}`, w), latest, `already in v${before}`);
    });
  }
  it('kislyuk/yq runs what is judged compatible with it, and fails otherwise', () => {
    for (const cmd of ["'.a | keys' in.yml", "'.a | pick([\"b\"])' in.yml", "'.a.c | add' in.yml", "'.a | to_entries' in.yml", "'[.a.c[] | ascii_upcase]' in.yml"]) {
      const w = words(cmd);
      const ok = judgeYq(w).compat.kislyuk.ok;
      assert.strictEqual(run('yq-kislyuk', w).startsWith('0:'), ok, cmd);
    }
  });
});

(dir ? describe : describe.skip)('yq examples agree with the yq tools', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Analyzer } = require('../src/analyzer');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createUnbashParser } = require('../src/syntax/adapters/unbash');
  let parser: { parse(s: string): { root: unknown } };
  before(async () => {
    const root = path.join(__dirname, '..');
    parser = createUnbashParser();
  });
  const cmds = [
    "yq '.items[] | select(.kind == \"Pod\") | .metadata.name' pods.yml", "yq e '.spec.replicas = 3' d.yml", "yq -i '.version = \"1.2\"' chart.yaml",
    "yq '.a.b |= . + 1' f.yml", "yq '.users | map(.name)' u.yml", "yq '.tags | join(\",\")' f.yml", "yq '.items | length' f.yml",
    "yq -o json '.metadata' f.yml", "yq '.a // \"default\"' f.yml", "yq 'del(.status)' f.yml", "yq '.list | sort | unique' f.yml",
    "yq '.items[] | select(.enabled)' f.yml", "yq '.a | has(\"b\")' f.yml", "yq '.items | sort_by(.name) | .[0]' f.yml", "yq '.name | test(\"^web\")' f.yml",
    "yq '.users[] | select(.age > 30) | .name' f.yml", "yq '[.items[].name]' f.yml", "yq '.a | split(\"-\")' f.yml", "yq '.items | group_by(.kind)' f.yml",
    "yq -y '.spec | add' x.yml", "yq -y '.users | map(.name)' u.yml", "yq -r '.users[].name' u.yml", "yq -y 'del(.a)' f.yml", "yq -y '.config.timeout // 30' f.yml",
    "yq '.users[] | .name' u.yml", "yq '.spec.containers[] | .image' deploy.yaml", "yq -y '.spec.containers[] | .image' deploy.yaml",
    "yq '.users | map(.age) | add / length' u.yml", "yq -r '.items[] | select(.price > 10) | .name' f.yml", "yq -y '.items | map(.name) | sort' f.yml",
  ];
  for (const cmd of cmds) {
    it(cmd, () => {
      const tree = parser.parse(cmd);
      const ex = new Analyzer('en').explainLine(tree, 0);
      const e = ex.examples[0];
      assert.ok(e, 'has an example');
      const kislyuk = /explained as kislyuk/.test(ex.notes[0]);
      const ws = words(cmd).slice(1).filter((w) => !/\.ya?ml$/.test(w) && w !== '-i');
      const args = kislyuk && !ws.includes('-y') ? ['-c', ...ws] : ws;
      const exe = path.join(dir!, kislyuk ? 'yq-kislyuk' : `yq-${fs.readdirSync(dir!).filter((f) => /^yq-4\./.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop()!.slice(3)}`);
      const filter = ws.find((w) => /[.[]/.test(w))!;
      const input = e.sections[0].lines.join('\n') + '\n';
      // Every section after the input is what yq prints for the stages up to there.
      const texts = e.sections.slice(1).map((sec: { label: string }) => /`(.*)`/.exec(sec.label)?.[1]);
      e.sections.slice(1).forEach((sec: { lines: string[] }, i: number) => {
        const expr = e.sections.length > 2 ? texts.slice(0, i + 1).join(' | ') : filter;
        assert.ok(!expr.includes('…'), expr);
        const r = spawnSync(exe, args.map((w) => (w === filter ? expr : w)), { input });
        assert.strictEqual(sec.lines.join('\n'), r.stdout.toString().replace(/\n$/, ''), expr);
      });
    });
  }
});
