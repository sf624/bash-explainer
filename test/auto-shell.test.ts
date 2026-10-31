import * as assert from 'assert';
import { detectShell, readShell, type ShellReading } from '../src/dialect';
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

  it('shellsOf keeps the source beside the shell, and none for the default', () => {
    assert.deepStrictEqual(shellsOf(['#!/bin/dash'], 'a.sh', undefined), { forced: undefined, detected: 'dash', detectedFrom: 'shebang' });
    assert.deepStrictEqual(shellsOf(['echo'], 'a.zsh', 'sh'), { forced: 'sh', detected: 'zsh', detectedFrom: 'filename' });
    assert.deepStrictEqual(shellsOf(['echo'], 'a.sh', undefined), { forced: undefined, detected: undefined, detectedFrom: 'default' });
  });
});

describe('the wording of the automatic shell', () => {
  const rows: [Parameters<typeof autoShellText>[2], Parameters<typeof autoShellText>[3], string, string][] = [
    // shell, source, then the short form in ja, en
    ['bash', 'shebang', 'bash（自動）', 'bash (auto)'],
    ['zsh', 'filename', 'zsh（自動）', 'zsh (auto)'],
    ['sh', 'directive', 'POSIX sh（自動）', 'POSIX sh (auto)'],
    [undefined, 'default', 'bash（自動）', 'bash (auto)'],
  ];
  for (const [shell, source, ja, en] of rows) {
    it(`short: ${en}`, () => {
      assert.strictEqual(autoShellText('ja', 'short', shell, source), ja);
      assert.strictEqual(autoShellText('en', 'short', shell, source), en);
    });
  }

  it('long and setting forms say each source', () => {
    const long = (source: Parameters<typeof autoShellText>[3]) => [autoShellText('en', 'long', 'dash', source), autoShellText('ja', 'long', 'dash', source)];
    assert.deepStrictEqual(long('shebang'), ['Auto: dash (from #!)', '自動: dash（#! 行から）']);
    assert.deepStrictEqual(long('directive'), ['Auto: dash (from a shellcheck directive)', '自動: dash（shellcheck の指示行から）']);
    assert.deepStrictEqual(long('filename'), ['Auto: dash (from the file name)', '自動: dash（ファイル名から）']);
    assert.deepStrictEqual(autoShellText('en', 'long', undefined), 'Auto: bash (default)');
    assert.deepStrictEqual(autoShellText('ja', 'long', undefined), '自動: bash（既定）');
    assert.strictEqual(autoShellText('en', 'setting', 'bash', 'shebang'), 'Auto (now: bash, from #!)');
    assert.strictEqual(autoShellText('ja', 'setting', 'bash', 'shebang'), '自動（今: bash、#! 行から）');
    assert.strictEqual(autoShellText('en', 'setting', undefined), 'Auto (now: bash, default)');
    assert.strictEqual(autoShellText('ja', 'setting', 'ksh', 'filename'), '自動（今: ksh93、ファイル名から）');
  });

  it("the panel's shell list says it, as it always did", () => {
    const ex = new Analyzer('en').explainLine(createUnbashParser().parse('echo hi'), 0);
    const auto = (lang: 'ja' | 'en', detected?: 'zsh', detectedFrom?: 'filename') =>
      panelUpdate({ lang, explanation: ex, file: 'a.sh', line: 0, lineText: 'echo hi', choice: {}, detected, detectedFrom, placement: 'first', animations: true }).dialect.shells[0];
    assert.deepStrictEqual(auto('en', 'zsh', 'filename'), ['auto', 'Auto (zsh)']);
    assert.deepStrictEqual(auto('ja', 'zsh', 'filename'), ['auto', '自動（zsh）']);
    assert.deepStrictEqual(auto('en'), ['auto', 'Auto']);
    assert.deepStrictEqual(auto('ja'), ['auto', '自動']);
  });
});
