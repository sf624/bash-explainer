// The chip of the file type and the shell as data (src/ui/scope.ts; docs/design/chrome-redesign.md, decision 12, step
// C5): its forms, widest first, its names, and the Shell list of its popover. The page measures the forms and takes the
// first that fits (test/web-scope.test.ts).
import * as assert from 'assert';
import { readShell } from '../src/dialect';
import { scopeChip, shellChoices } from '../src/ui/scope';

const SHELL = { name: 'Shell script', short: 'Script' };

describe('the file type and shell chip as data', () => {
  it('gives the whole chip, then without "(auto)", the shorter type, Open and Save as icons, the shell alone, and the name in the menu', () => {
    const chip = scopeChip('en', 'File type and shell', SHELL, undefined, readShell('#!/usr/bin/env bash\n'));
    assert.deepStrictEqual(chip.forms, [
      { chip: 'Shell script · bash (auto)', tools: 'words', name: true },
      { chip: 'Shell script · bash', tools: 'words', name: true },
      { chip: 'Script · bash', tools: 'words', name: true },
      { chip: 'Script · bash', tools: 'icons', name: true },
      { chip: 'bash', tools: 'icons', name: true },
      { chip: 'bash', tools: 'icons', name: false },
    ]);
    assert.strictEqual(chip.name, 'File type and shell: Shell script · bash (auto)');
    assert.strictEqual(chip.tip, 'File type and shell: Shell script · Auto: bash (from #!)');
  });

  it('says the shell in Japanese with the same forms', () => {
    const chip = scopeChip('ja', 'ファイルの種類とシェル', { name: 'シェルスクリプト', short: 'スクリプト' }, undefined, readShell('#!/bin/sh\n'));
    assert.deepStrictEqual(chip.forms.map((f) => f.chip), ['シェルスクリプト · POSIX sh（自動）', 'シェルスクリプト · POSIX sh', 'スクリプト · POSIX sh', 'スクリプト · POSIX sh', 'POSIX sh', 'POSIX sh']);
    assert.strictEqual(chip.name, 'ファイルの種類とシェル: シェルスクリプト · POSIX sh（自動）');
    assert.strictEqual(chip.tip, 'ファイルの種類とシェル: シェルスクリプト · 自動: POSIX sh（#! 行から）');
  });

  it('leaves out a form that says what the one before says: a shell chosen has no "(auto)", a short type name no shorter word', () => {
    const chip = scopeChip('en', 'File type and shell', { name: 'Makefile', short: 'Makefile' }, 'zsh', readShell('#!/bin/bash\n'));
    assert.deepStrictEqual(chip.forms, [
      { chip: 'Makefile · zsh', tools: 'words', name: true },
      { chip: 'Makefile · zsh', tools: 'icons', name: true },
      { chip: 'zsh', tools: 'icons', name: true },
      { chip: 'zsh', tools: 'icons', name: false },
    ]);
    // (The chosen shell, not where the file's would come from.)
    assert.strictEqual(chip.tip, 'File type and shell: Makefile · zsh');
  });

  it('reads bash by default when there is no reading', () => {
    const chip = scopeChip('en', 'File type and shell', SHELL, undefined);
    assert.strictEqual(chip.forms[0].chip, 'Shell script · bash (auto)');
    assert.strictEqual(chip.tip, 'File type and shell: Shell script · Auto: bash (default)');
  });

  it('names the chip with words that contain the text of every form (WCAG 2.5.3, Label in Name)', () => {
    const kinds = [SHELL, { name: 'GitHub Actions / GitLab CI', short: 'CI' }, { name: 'シェルスクリプト', short: 'スクリプト' }];
    for (const lang of ['en', 'ja'] as const) {
      for (const kind of kinds) {
        for (const forced of [undefined, 'dash'] as const) {
          for (const text of ['', '#!/bin/sh\n', '# shellcheck shell=ksh\n']) {
            const chip = scopeChip(lang, 'T', kind, forced, readShell(text, 'a.zsh'));
            for (const f of chip.forms) assert.ok(chip.name.toLowerCase().includes(f.chip.toLowerCase()), `${chip.name} / ${f.chip}`);
          }
        }
      }
    }
  });

  it('lists Auto first in the Shell list, with the shell and where it comes from, then every shell', () => {
    assert.deepStrictEqual(shellChoices('en', readShell('', 'x.zsh')), [
      ['auto', 'Auto: zsh (from the file name)'], ['bash', 'bash'], ['sh', 'POSIX sh'], ['dash', 'dash'], ['ash', 'busybox ash'],
      ['yash', 'yash'], ['ksh', 'ksh93'], ['mksh', 'mksh'], ['zsh', 'zsh'],
    ]);
    assert.deepStrictEqual(shellChoices('ja', readShell('# shellcheck shell=dash\n'))[0], ['auto', '自動: dash（ShellCheck の指示コメントから）']);
    assert.deepStrictEqual(shellChoices('ja')[0], ['auto', '自動: bash（既定）']);
  });
});
