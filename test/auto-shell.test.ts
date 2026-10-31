import * as assert from 'assert';
import { detectShell, readShell, saidShell, type ShellReading, type ShellSource } from '../src/dialect';
import { shellOf } from '../src/document';
import { shellsOf } from '../src/document-setup';
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
    const auto = (lang: 'ja' | 'en', detected?: ShellReading) =>
      panelUpdate({ lang, explanation: ex, file: 'a.sh', line: 0, lineText: 'echo hi', choice: {}, detected, placement: 'first', animations: true }).dialect.shells[0];
    assert.deepStrictEqual(auto('en', r('zsh', 'filename')), ['auto', 'Auto (zsh)']);
    assert.deepStrictEqual(auto('ja', r('zsh', 'filename')), ['auto', '自動（zsh）']);
    assert.deepStrictEqual(auto('en'), ['auto', 'Auto']);
    assert.deepStrictEqual(auto('ja', r('bash', 'default')), ['auto', '自動']);
  });
});
