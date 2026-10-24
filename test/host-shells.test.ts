// The shell code of a YAML block scalar is what the runner gets (PyYAML loads the value, bash runs both), and each
// step, RUN instruction or recipe line of a host file is a shell of its own: what one sets, the next does not see.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { Analyzer } from '../src/analyzer';
import { explainHostedLine, extractShell, hostIssues, type HostKind } from '../src/hosts';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { run } from './support/run';

const parser = createUnbashParser();

/** The script of each region of a host file, as the shell text we read. */
function scripts(kind: HostKind, src: string): string[] {
  const ex = extractShell(kind, src);
  const lines = ex.text.split('\n');
  return ex.regions.map((r) => lines.slice(r.start, r.end + 1).join('\n') + '\n');
}

/** What bash prints for a script. */
const bash = (script: string) => {
  const r = run('bash', ['--norc', '--noprofile', '-s'], { input: script, env: { PATH: process.env.PATH, LC_ALL: 'C' }, timeout: 10000 });
  return `${r.stdout.toString()}|${r.stderr.toString()}|${r.status}`;
};

const hasYaml = spawnSync('python3', ['-I', '-c', 'import yaml'], { stdio: 'ignore' }).status === 0;

/** The `run:` values of a workflow, as PyYAML loads them. */
function runValues(src: string): string[] {
  const r = run('python3', ['-I', '-c', 'import json, sys, yaml\nd = yaml.safe_load(sys.stdin)\nprint(json.dumps([s["run"] for j in d["jobs"].values() for s in j["steps"]]))'], { input: src, check: true });
  return JSON.parse(r.stdout.toString());
}

const workflow = (...steps: string[]) => `on: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n${steps.join('')}`;

const BLOCKS: [string, string][] = [
  ['an indented EOF ends a here-document', '      - run: |\n          cat <<EOF\n          hello\n          EOF\n          echo after\n'],
  ['<<- strips tabs after the indentation', '      - run: |\n          cat <<-EOF\n          \thello\n          \tEOF\n          echo after\n'],
  ['blank lines in a here-document', '      - run: |\n          cat <<EOF\n          a\n\n          b\n          EOF\n'],
  ['more-indented lines keep their spaces', '      - run: |\n          if true; then\n            echo "  in"\n          fi\n'],
  ['|- and |+', '      - run: |-\n          echo a\n      - run: |+\n          echo b\n\n'],
  ['|2 with a more-indented first line', '      - run: |2\n            echo indented\n          cat <<EOF\n          x\n          EOF\n'],
  ['> joins lines into one command', '      - run: >\n          echo a\n          b\n          c\n'],
  ['a header with a trailing space', '      - run: | \n          cat <<EOF\n          x\n          EOF\n          echo after\n'],
  ['> keeps a newline at a blank line and around more-indented lines', '      - run: >\n          echo a\n          b\n\n          echo c\n            echo d\n          echo e\n'],
];

/**
 * Folded blocks we read apart from YAML: a join is read as ` \` and a newline, which bash does not join inside single
 * quotes, and which ends a `#` comment, where YAML joins the next line into the string or the comment. (The region's
 * note says so.) If one of these comes out the same, take it out of here.
 */
const FOLD_DIFFERENCES: [string, string][] = [
  ['> inside a single-quoted string', "      - run: >\n          echo 'a\n          b'\n"],
  ['> after a comment', '      - run: >\n          echo a # c\n          echo b\n'],
];

describe('YAML block scalars as the runner gets them (PyYAML, bash)', () => {
  // CI sets BASH_EXPLAINER_PYYAML=1, so that a missing PyYAML fails instead of skipping.
  if (!hasYaml) {
    it('needs PyYAML', function () {
      if (process.env.BASH_EXPLAINER_PYYAML) assert.fail('BASH_EXPLAINER_PYYAML is set, but python3 cannot import yaml');
      this.skip();
    });
    return;
  }
  for (const [name, step] of FOLD_DIFFERENCES) {
    it(`known difference: ${name}`, () => {
      const src = workflow(step);
      assert.notStrictEqual(bash(scripts('yaml', src)[0]), bash(runValues(src)[0]));
    });
  }
  for (const [name, step] of BLOCKS) {
    it(name, () => {
      const src = workflow(step);
      const ours = scripts('yaml', src);
      const theirs = runValues(src);
      assert.strictEqual(ours.length, theirs.length);
      ours.forEach((s, i) => assert.strictEqual(bash(s), bash(theirs[i]), `step ${i + 1}:\n${s}`));
    });
  }
});

function explain(kind: HostKind, src: string, line: number) {
  const ex = extractShell(kind, src);
  return explainHostedLine(new Analyzer('en'), parser.parse(ex.text), ex, src.split('\n'), line, 'en')!;
}

describe('a here-document in a YAML block', () => {
  it('ends at the indented delimiter', () => {
    const src = workflow('      - run: |\n          cat <<EOF\n          hello\n          EOF\n          echo done\n      - run: echo next\n');
    const notes = (line: number) => explain('yaml', src, line).notes.join('\n');
    assert.match(notes(7), /part of the here-document started by `<<EOF` on line 7/);
    assert.match(notes(8), /`EOF` marks the end of the here-document/);
    assert.doesNotMatch(notes(9), /here-document/);
    assert.strictEqual(explain('yaml', src, 9).summary.split(':')[0], 'echo');
    assert.doesNotMatch(notes(10), /here-document/);
  });
  it('reads a block whose header ends in a space', () => {
    assert.deepStrictEqual(scripts('yaml', workflow('      - run: | \n          echo a\n      - run: |-  # c\n          echo b\n')), ['echo a\n', 'echo b\n']);
    assert.deepStrictEqual(scripts('yaml', 'build:\n  script:\n    - | \n      echo a\n'), ['echo a\n']);
  });
  it('makes no region of an empty block', () => {
    assert.deepStrictEqual(scripts('yaml', workflow('      - run: |\n      - run: echo a\n')), ['echo a\n']);
  });
  it('says that a folded block joins its lines', () => {
    const src = workflow('      - run: >\n          echo a\n          b\n');
    assert.ok(explain('yaml', src, 6).notes.some((n) => /folded block/.test(n)));
    assert.ok(!explain('yaml', workflow('      - run: >\n          echo a\n'), 6).notes.some((n) => /folded block/.test(n)));
  });
});

describe('each step is a shell of its own', () => {
  const unset = (kind: HostKind, src: string, line: number) => explain(kind, src, line).notes.some((n) => /is not set here: with `set -u` on/.test(n));
  it('GitHub Actions: `set -u` of one step does not reach the next', () => {
    const src = workflow('      - run: |\n          set -euo pipefail\n          f=1\n', '      - run: echo "$f" "$g"\n');
    assert.ok(!unset('yaml', src, 8));
    // In one step it does.
    assert.ok(unset('yaml', workflow('      - run: |\n          set -u\n          echo "$g"\n'), 7));
  });
  it('GitHub Actions: a function of one step is not one in the next', () => {
    const src = workflow('      - run: |\n          f() { :; }\n', '      - run: f\n');
    assert.notStrictEqual(explain('yaml', src, 7).items[0].name?.said.kind, 'function');
  });
  it('Dockerfile: each RUN', () => {
    const src = 'FROM alpine\nRUN set -u\nRUN echo "$x"\n';
    assert.ok(!unset('dockerfile', src, 2));
    assert.ok(unset('dockerfile', 'FROM alpine\nRUN set -u; echo "$x"\n', 1));
  });
  it('Makefile: each recipe line, unless .ONESHELL', () => {
    const src = 'all:\n\tset -u\n\techo "$$x"\n';
    assert.ok(!unset('makefile', src, 2));
    assert.ok(unset('makefile', '.ONESHELL:\n' + src, 3));
    // With .ONESHELL, one recipe is one shell, not the next rule's.
    assert.ok(!unset('makefile', '.ONESHELL:\na:\n\tset -u\nb:\n\techo "$$x"\n', 4));
  });
  it('package.json: each script', () => {
    const src = '{\n  "scripts": {\n    "a": "set -u",\n    "b": "echo \\"$x\\""\n  }\n}\n';
    assert.ok(!unset('npm', src, 3));
  });
  it('Markdown: the blocks share one shell, as typed into one terminal', () => {
    const src = '```bash\nset -u\n```\n\n```bash\necho "$x"\n```\n';
    assert.ok(unset('markdown', src, 5));
  });
  it('GitLab CI: a job\'s before_script and script are one shell, after_script another, the next job another', () => {
    const src = 'build:\n  script:\n    - set -u\n    - X=1\n    - f() { echo hi; }\n    - echo "$X"\n    - f\n';
    assert.strictEqual(explain('yaml', src, 6).items[0].name?.said.kind, 'function');
    assert.ok(unset('yaml', 'build:\n  before_script:\n    - set -u\n  script:\n    - echo "$x"\n', 4));
    // script above before_script in the file: still one shell (read in the order of the file, a limit).
    const swapped = extractShell('yaml', 'build:\n  script:\n    - echo "$x"\n  before_script:\n    - set -u\n  after_script:\n    - echo\n').regions;
    assert.strictEqual(swapped[0].script, swapped[1].script);
    assert.notStrictEqual(swapped[2].script, swapped[0].script);
    assert.ok(!unset('yaml', 'build:\n  script:\n    - set -u\n  after_script:\n    - echo "$x"\n', 4));
    assert.ok(unset('yaml', 'build:\n  after_script:\n    - set -u\n    - echo "$x"\n', 3));
    assert.ok(!unset('yaml', 'a:\n  script:\n    - set -u\nb:\n  script:\n    - echo "$x"\n', 5));
  });
  it('Bitbucket Pipelines: a step\'s script list is one shell, the next step another', () => {
    const step = (cmds: string) => `      - step:\n          name: s\n          script:\n${cmds}`;
    const src = `pipelines:\n  default:\n${step('            - set -u\n            - echo "$x"\n')}${step('            - echo "$y"\n')}`;
    assert.ok(unset('yaml', src, 6));
    assert.ok(!unset('yaml', src, 10));
  });
  it('Travis CI: the phases of the build are one shell', () => {
    const src = 'language: shell\nbefore_script:\n  - set -u\nscript:\n  - echo "$x"\nafter_script:\n  - echo "$y"\n';
    assert.ok(unset('yaml', src, 4));
    assert.ok(unset('yaml', src, 6));
  });
  it('Taskfile: each command of cmds is a shell of its own', () => {
    const src = 'version: \'3\'\ntasks:\n  a:\n    cmds:\n      - set -u\n      - echo "$x"\n';
    assert.ok(!unset('yaml', src, 5));
  });
  it('Azure Pipelines and CircleCI: each step', () => {
    const azure = 'trigger: [main]\npool:\n  vmImage: ubuntu-latest\nsteps:\n  - script: set -u\n  - bash: echo "$x"\n';
    assert.ok(!unset('yaml', azure, 5));
    const circle = 'version: 2.1\njobs:\n  a:\n    steps:\n      - run: set -u\n      - run:\n          command: echo "$x"\n';
    assert.ok(!unset('yaml', circle, 6));
  });
  it('the Problems panel reads each step apart too', () => {
    const src = 'FROM alpine\nRUN set -o pipefail\nRUN a | b\n';
    const ex = extractShell('dockerfile', src);
    assert.ok(hostIssues(parser.parse(ex.text), ex, src.split('\n'), 'en').some((i) => i.code === 'dockerPipefail' && i.startLine === 2));
  });
});
