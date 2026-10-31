import * as assert from 'assert';
import { type AutoShell, detectShell, readShell, saidShell, type Shell, SHELL_NAMES, type ShellReading, type ShellSource } from '../src/dialect';
import { autoShellAt, explainDocumentLine, shellOf } from '../src/document';
import { openDocument, shellsOf } from '../src/document-setup';
import type { FileKind } from '../src/hosts/detect';
import { scopeChip, shellChoices } from '../src/ui/scope';
import { Analyzer } from '../src/analyzer';
import { autoShellText } from '../src/messages-shell';
import { panelUpdate } from '../src/ui/panelView';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

// The automatic shell: `readShell` (src/dialect.ts) gives the shell and where it comes from, and every wording of
// "auto" is one function of it (src/messages-shell.ts; docs/design/sources.md, SB4).

describe('readShell: the shell a script says and where it says it', () => {
  const cases: [string, string, string, ShellReading][] = [
    ['a ShellCheck directive', '# shellcheck shell=dash\necho\n', 'a.sh', { shell: 'dash', source: 'directive' }],
    ['a directive wins over the shebang', '#!/bin/bash\n# shellcheck shell=ksh\n', '', { shell: 'ksh', source: 'directive' }],
    ['a directive wins over the file name', '# shellcheck shell=sh\n', 'a.zsh', { shell: 'sh', source: 'directive' }],
    ['a directive naming no shell is the default', '# shellcheck shell=fish\n#!/bin/zsh\n', 'a.zsh', { shell: 'bash', source: 'default' }],
    ['a shebang', '#!/bin/zsh\n', 'a.sh', { shell: 'zsh', source: 'shebang' }],
    ['a shebang through env', '#!/usr/bin/env -S ksh93 -e\n', '', { shell: 'ksh', source: 'shebang' }],
    ['a shebang wins over the file name', '#!/bin/sh\n', 'a.bash', { shell: 'sh', source: 'shebang' }],
    ['a shebang naming no shell is the default, whatever the file name', '#!/usr/bin/python3\n', 'a.zsh', { shell: 'bash', source: 'default' }],
    ['env with no program is the default', '#!/usr/bin/env -S\n', '', { shell: 'bash', source: 'default' }],
    ['a .zsh name', 'echo\n', 'dir\\a.zsh', { shell: 'zsh', source: 'filename' }],
    ['a .ksh name', 'echo\n', 'x.ksh', { shell: 'ksh', source: 'filename' }],
    ['a .mkshrc name', 'echo\n', '.mkshrc', { shell: 'mksh', source: 'filename' }],
    ['a .bashrc name', 'echo\n', '/home/u/.bashrc', { shell: 'bash', source: 'filename' }],
    ['nothing says a shell', 'echo\n', 'a.sh', { shell: 'bash', source: 'default' }],
    ['no file name either', 'echo\n', '', { shell: 'bash', source: 'default' }],
  ];
  for (const [what, text, file, expected] of cases) {
    it(what, () => {
      assert.deepStrictEqual(readShell(text, file), expected);
      // (`detectShell` is the same reading without the default.)
      assert.strictEqual(detectShell(text, file), expected.source === 'default' ? undefined : expected.shell);
    });
  }

  it('shellsOf keeps the reading, and saidShell says none for the default', () => {
    assert.deepStrictEqual(shellsOf(['#!/bin/dash'], 'a.sh', undefined), { forced: undefined, detected: { shell: 'dash', source: 'shebang' } });
    assert.deepStrictEqual(shellsOf(['echo'], 'a.zsh', 'sh'), { forced: 'sh', detected: { shell: 'zsh', source: 'filename' } });
    const none = shellsOf(['echo'], 'a.sh', undefined);
    assert.deepStrictEqual(none.detected, { shell: 'bash', source: 'default' });
    assert.strictEqual(saidShell(none.detected), undefined);
    assert.strictEqual(saidShell(undefined), undefined);
    assert.strictEqual(saidShell({ shell: 'bash', source: 'filename' }), 'bash');
    assert.strictEqual(shellOf({ forced: 'sh', detected: { shell: 'zsh', source: 'filename' } }), 'sh');
    assert.strictEqual(shellOf({ detected: { shell: 'zsh', source: 'filename' } }), 'zsh');
    assert.strictEqual(shellOf({ detected: none.detected }), undefined);
  });
});

describe('the wording of the automatic shell', () => {
  const r = (shell: ShellReading['shell'], source: ShellSource): ShellReading => ({ shell, source });
  it('short: the chip', () => {
    for (const [reading, ja, en] of [
      [r('bash', 'shebang'), 'bash（自動）', 'bash (auto)'], [r('zsh', 'filename'), 'zsh（自動）', 'zsh (auto)'],
      [r('sh', 'directive'), 'POSIX sh（自動）', 'POSIX sh (auto)'], [undefined, 'bash（自動）', 'bash (auto)'], [r('bash', 'default'), 'bash（自動）', 'bash (auto)'],
    ] as const) {
      assert.strictEqual(autoShellText('ja', 'short', reading), ja);
      assert.strictEqual(autoShellText('en', 'short', reading), en);
    }
  });

  it('long and setting forms say each source', () => {
    const long = (source: ShellSource) => [autoShellText('en', 'long', r('dash', source)), autoShellText('ja', 'long', r('dash', source))];
    assert.deepStrictEqual(long('shebang'), ['Auto: dash (from #!)', '自動: dash（#! 行から）']);
    assert.deepStrictEqual(long('directive'), ['Auto: dash (from a ShellCheck directive)', '自動: dash（ShellCheck の指示コメントから）']);
    assert.deepStrictEqual(long('filename'), ['Auto: dash (from the file name)', '自動: dash（ファイル名から）']);
    assert.strictEqual(autoShellText('en', 'long'), 'Auto: bash (default)');
    assert.strictEqual(autoShellText('ja', 'long', r('bash', 'default')), '自動: bash（既定）');
    assert.strictEqual(autoShellText('en', 'setting', r('bash', 'shebang')), 'Auto (now: bash, from #!)');
    assert.strictEqual(autoShellText('ja', 'setting', r('bash', 'shebang')), '自動（今: bash、#! 行から）');
    assert.strictEqual(autoShellText('en', 'setting'), 'Auto (now: bash, the default)');
    assert.strictEqual(autoShellText('ja', 'setting', r('bash', 'default')), '自動（今: 既定の bash）');
    assert.strictEqual(autoShellText('ja', 'setting', r('ksh', 'filename')), '自動（今: ksh93、ファイル名から）');
  });

  it("the panel's shell list says it, as it always did", () => {
    const ex = new Analyzer('en').explainLine(createUnbashParser().parse('echo hi'), 0);
    const auto = (lang: 'ja' | 'en', detected?: AutoShell) =>
      panelUpdate({ lang, explanation: ex, file: 'a.sh', line: 0, lineText: 'echo hi', choice: {}, detected, placement: 'first', animations: true }).dialect.shells[0];
    assert.deepStrictEqual(auto('en', r('zsh', 'filename')), ['auto', 'Auto (zsh)']);
    assert.deepStrictEqual(auto('ja', r('zsh', 'filename')), ['auto', '自動（zsh）']);
    assert.deepStrictEqual(auto('en'), ['auto', 'Auto']);
    assert.deepStrictEqual(auto('ja', r('bash', 'default')), ['auto', '自動']);
    // (A host file's part: the shell its host runs it in; a line in no part, when the parts differ, names none.)
    assert.deepStrictEqual(auto('en', r('sh', 'host')), ['auto', 'Auto (POSIX sh)']);
    assert.deepStrictEqual(auto('ja', 'parts'), ['auto', '自動']);
    // (Words the host runs with no shell: Docker's exec form.)
    assert.deepStrictEqual(auto('en', 'none'), ['auto', 'Auto (no shell)']);
    assert.deepStrictEqual(auto('ja', 'none'), ['auto', '自動（シェルなし）']);
  });
});

describe('the automatic shell of a host file: what the chip, its popover and the Shell setting say is what the explanation uses', () => {
  // The host decides the shell of each part (a Dockerfile's RUN runs in sh, a step in its `shell:`, a Markdown block in
  // its fence's language), not the file's #! line nor its name: `autoShellAt` reads the part of the line.
  const cases: [string, FileKind, string, string, string][] = [
    ['a Dockerfile', 'dockerfile', 'Dockerfile', 'Dockerfile', 'FROM alpine\nRUN apk add curl | tee log\n'],
    ['a Dockerfile with SHELL and an exec form', 'dockerfile', 'Dockerfile', 'Dockerfile', 'FROM alpine\nRUN echo hi | wc -c\nSHELL ["/bin/bash", "-c"]\nRUN echo $BASH_VERSION\nCMD ["npm", "start"]\n'],
    ['a Makefile', 'makefile', 'Makefile', 'Makefile', 'build:\n\tmake -C src\n'],
    ['a Makefile with SHELL', 'makefile', 'Makefile', 'Makefile', 'SHELL := /bin/bash\nbuild:\n\tmake -C src\n'],
    ['a GitHub Actions workflow with a step in sh', 'yaml', 'ci.yml', 'GitHub Actions / GitLab CI', 'on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n      - shell: sh\n        run: echo there\n'],
    ['a GitLab CI file', 'yaml', '.gitlab-ci.yml', 'GitHub Actions / GitLab CI', 'build:\n  script:\n    - make\n'],
    ['a package.json', 'npm', 'package.json', 'package.json', '{\n  "scripts": {\n    "build": "tsc && echo ok"\n  }\n}\n'],
    ['a Markdown file with bash, zsh and dash blocks', 'markdown', 'README.md', 'Markdown', '# T\n\n```bash\necho hi\n```\n\n```zsh\nprint -l a\n```\n\n```sh\n#!/bin/dash\necho\n```\n'],
    ['a Python file', 'python', 'a.py', 'Python', 'import os\nos.system("ls | wc -l")\n'],
    ['a Jenkinsfile with a #! in a step', 'jenkinsfile', 'Jenkinsfile', 'Jenkinsfile', "pipeline {\n  agent any\n  stages {\n    stage('b') {\n      steps {\n        sh 'make'\n        sh '''#!/bin/bash\n          echo hi\n        '''\n      }\n    }\n  }\n}\n"],
    ['a bats file', 'bats', 'a.bats', 'bats', '#!/usr/bin/env bats\n@test "a" {\n  run echo hi\n}\n'],
  ];
  const parser = createUnbashParser();
  const analyzer = new Analyzer('en');
  /** The shell `explainDocumentLine` gives the analyzer for each line (none: the line is in no part, nothing is explained). */
  const usedShells = (kind: FileKind, file: string, text: string, forced?: Shell) => {
    const doc = openDocument(text, kind, (t) => parser.parse(t));
    const shells = shellsOf(doc.lines, file, forced);
    return doc.lines.map((_, line) => {
      let used: { shell: Shell | undefined } | undefined;
      const spy = { explainLine: (tree, at, shell, opts) => ((used = { shell }), analyzer.explainLine(tree, at, shell, opts)) } as Pick<Analyzer, 'explainLine'>;
      explainDocumentLine(spy as Analyzer, doc, line, 'en', shells, {});
      return { line, used, auto: autoShellAt(doc, shells, line) };
    });
  };

  for (const [what, kind, file, name, text] of cases) {
    it(what, () => {
      let explained = 0;
      for (const { line, used, auto } of usedShells(kind, file, text)) {
        const say = (lang: 'ja' | 'en') => {
          const chip = scopeChip(lang, 'T', { name, short: name }, undefined, auto);
          return { chip: chip.forms[0].chip, popover: shellChoices(lang, auto)[0][1], setting: autoShellText(lang, 'setting', auto) };
        };
        if (!used) {
          // (A line of the host's own text: the shell of every part when they agree, else none named.)
          assert.ok(typeof auto === 'string' || auto.source === 'host', `line ${line}`);
          continue;
        }
        explained++;
        if (auto === 'none') {
          // (Docker's exec form and a Python list run with no shell: their words are explained as a program's, test/hosts.test.ts.)
          assert.ok(/\[/.test(text.split('\n')[line]), `line ${line}`);
          assert.deepStrictEqual(say('en'), { chip: `${name} · no shell`, popover: 'Auto: no shell (runs directly)', setting: 'Auto (now: no shell, runs directly)' }, `line ${line}`);
          assert.deepStrictEqual(say('ja'), { chip: `${name} · シェルなし`, popover: '自動: シェルなし（直接実行）', setting: '自動（今: シェルなし、直接実行）' }, `line ${line}`);
        } else {
          const shell = used.shell ?? 'bash';
          assert.deepStrictEqual(auto, { shell, source: 'host' }, `line ${line}`);
          assert.deepStrictEqual(say('en'), {
            chip: `${name} · ${SHELL_NAMES[shell]} (auto)`, popover: `Auto: ${SHELL_NAMES[shell]} (from the file type)`, setting: `Auto (now: ${SHELL_NAMES[shell]}, from the file type)`,
          }, `line ${line}`);
          assert.deepStrictEqual(say('ja'), {
            chip: `${name} · ${SHELL_NAMES[shell]}（自動）`, popover: `自動: ${SHELL_NAMES[shell]}（ファイルの種類から）`, setting: `自動（今: ${SHELL_NAMES[shell]}、ファイルの種類から）`,
          }, `line ${line}`);
        }
        // (A shell chosen wins over the part's, in the explanation as in the chip.)
        const chosen = usedShells(kind, file, text, 'zsh')[line];
        assert.strictEqual(chosen.used!.shell, 'zsh');
        assert.strictEqual(scopeChip('en', 'T', { name, short: name }, 'zsh', chosen.auto).forms[0].chip, `${name} · zsh`);
      }
      assert.ok(explained > 0);
    });
  }

  it('names the shell the host runs, not the default bash nor the file\'s #! line', () => {
    const at = (kind: FileKind, file: string, text: string, line: number) => usedShells(kind, file, text)[line].auto;
    const sh: AutoShell = { shell: 'sh', source: 'host' };
    assert.deepStrictEqual(at('dockerfile', 'Dockerfile', 'FROM alpine\nRUN make\n', 1), sh);
    // (Every part agrees: the host's own lines say it too.)
    assert.deepStrictEqual(at('dockerfile', 'Dockerfile', 'FROM alpine\nRUN make\n', 0), sh);
    assert.deepStrictEqual(at('makefile', 'Makefile', 'a:\n\tmake\n', 1), sh);
    assert.deepStrictEqual(at('npm', 'package.json', '{\n  "scripts": {\n    "a": "make"\n  }\n}\n', 0), sh);
    assert.deepStrictEqual(at('python', 'a.py', '#!/usr/bin/env zsh\nimport os\nos.system("make")\n', 2), sh);
    assert.deepStrictEqual(at('jenkinsfile', 'Jenkinsfile', "node {\n  sh 'make'\n}\n", 1), sh);
    assert.deepStrictEqual(at('yaml', 'ci.yml', 'jobs:\n  a:\n    steps:\n      - run: make\n', 3), { shell: 'bash', source: 'host' });
    assert.deepStrictEqual(at('bats', 'a.bats', '#!/usr/bin/env bats\n@test "a" {\n  run make\n}\n', 2), { shell: 'bash', source: 'host' });
    // (The parts differ, and the line is in none: no shell is named.)
    assert.strictEqual(at('markdown', 'README.md', '# T\n```bash\necho\n```\n```zsh\necho\n```\n', 0), 'parts');
    // (The exec form runs with no shell: CMD, ENTRYPOINT and RUN alike; but a script passed to `sh -c` runs in sh.)
    for (const instr of ['CMD ["npm", "start"]', 'ENTRYPOINT ["./run.sh"]', 'RUN ["apt-get", "install", "-y", "x"]']) {
      assert.strictEqual(at('dockerfile', 'Dockerfile', `FROM alpine\n${instr}\n`, 1), 'none', instr);
      // (Every part runs with none: the host's own lines say so too.)
      assert.strictEqual(at('dockerfile', 'Dockerfile', `FROM alpine\n${instr}\n`, 0), 'none', instr);
    }
    assert.deepStrictEqual(at('dockerfile', 'Dockerfile', 'FROM alpine\nCMD ["sh", "-c", "make"]\n', 1), sh);
    assert.strictEqual(at('dockerfile', 'Dockerfile', 'FROM alpine\nRUN make\nCMD ["npm", "start"]\n', 0), 'parts');
    assert.strictEqual(at('python', 'a.py', 'import subprocess\nsubprocess.run(["ls", "-l"])\n', 1), 'none');
    // (A script is the file's own reading.)
    assert.deepStrictEqual(at('shell', 'a.zsh', 'echo\n', 0), { shell: 'zsh', source: 'filename' });
    assert.deepStrictEqual(autoShellAt(openDocument('echo\n', 'shell', (t) => parser.parse(t)), {}, 0), { shell: 'bash', source: 'default' });
  });

  it('words a line in no part, when the parts differ, without a shell', () => {
    assert.deepStrictEqual(['option', 'short', 'long', 'setting'].map((f) => autoShellText('en', f as 'long', 'parts')), [
      'Auto', 'auto', 'Auto: set by each part (from the file type)', 'Auto (now: set by each part, from the file type)',
    ]);
    assert.deepStrictEqual(['option', 'short', 'long', 'setting'].map((f) => autoShellText('ja', f as 'long', 'parts')), [
      '自動', '自動', '自動: 部分ごとに決まる（ファイルの種類から）', '自動（今: 部分ごとに決まる、ファイルの種類から）',
    ]);
    const chip = scopeChip('en', 'File type and shell', { name: 'Markdown', short: 'md' }, undefined, 'parts');
    assert.deepStrictEqual(chip.forms.map((f) => f.chip), ['Markdown · auto', 'md · auto', 'md · auto', 'auto', 'auto']);
    assert.strictEqual(chip.tip, 'File type and shell: Markdown · Auto: set by each part (from the file type)');
    assert.deepStrictEqual(shellChoices('ja', 'parts')[0], ['auto', '自動: 部分ごとに決まる（ファイルの種類から）']);
  });

  it('words the exec form, which runs with no shell', () => {
    assert.deepStrictEqual(['option', 'short', 'long', 'setting'].map((f) => autoShellText('en', f as 'long', 'none')), [
      'Auto (no shell)', 'no shell', 'Auto: no shell (runs directly)', 'Auto (now: no shell, runs directly)',
    ]);
    assert.deepStrictEqual(['option', 'short', 'long', 'setting'].map((f) => autoShellText('ja', f as 'long', 'none')), [
      '自動（シェルなし）', 'シェルなし', '自動: シェルなし（直接実行）', '自動（今: シェルなし、直接実行）',
    ]);
    const chip = scopeChip('ja', 'ファイルの種類とシェル', { name: 'Dockerfile', short: 'Docker' }, undefined, 'none');
    assert.deepStrictEqual(chip.forms.map((f) => f.chip), ['Dockerfile · シェルなし', 'Docker · シェルなし', 'Docker · シェルなし', 'シェルなし', 'シェルなし']);
    assert.strictEqual(chip.tip, 'ファイルの種類とシェル: Dockerfile · 自動: シェルなし（直接実行）');
    assert.deepStrictEqual(shellChoices('en', 'none')[0], ['auto', 'Auto: no shell (runs directly)']);
    // (A shell chosen is still the chip's: the words are then explained as that shell reads them.)
    assert.strictEqual(scopeChip('en', 'T', { name: 'Dockerfile', short: 'Docker' }, 'sh', 'none').forms[0].chip, 'Dockerfile · POSIX sh');
  });
});
