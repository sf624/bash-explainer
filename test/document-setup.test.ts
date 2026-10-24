// Opening a document and applying the diagnostics policy, shared by the four products (src/document-setup.ts,
// and diagnosticsFor and plain in src/document.ts).
import * as assert from 'assert';
import { diagnosticsFor, plain, ShellDocument, Shells } from '../src/document';
import {
  ACTIVATION_LANGUAGES, EMBEDDED_FILES, FILE_KINDS, HOST_FILES, HOST_KINDS, HOST_LANGUAGES, HOST_PATTERNS, kindOfDocument, openDocument, shellsOf,
} from '../src/document-setup';
import { extractShell } from '../src/hosts';
import { defaultSettings, mergeSettings, Settings, settingsFromEditor, Surface } from '../src/settings';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

const parser = createUnbashParser();
const parse = (text: string) => parser.parse(text);

describe('the kinds of file', () => {
  it('has one list, in the order of the embedded.files setting', () => {
    assert.deepStrictEqual(FILE_KINDS, ['shell', 'dockerfile', 'makefile', 'yaml', 'npm', 'markdown', 'python', 'jenkinsfile', 'bats']);
    assert.deepStrictEqual(HOST_KINDS, FILE_KINDS.slice(1));
    assert.deepStrictEqual(EMBEDDED_FILES, ['dockerfile', 'makefile', 'yaml', 'packageJson', 'markdown', 'python', 'jenkinsfile', 'bats']);
    assert.deepStrictEqual(defaultSettings()['embedded.files'], EMBEDDED_FILES);
    assert.deepStrictEqual(HOST_LANGUAGES, ['dockerfile', 'makefile', 'yaml', 'github-actions-workflow', 'markdown', 'python', 'groovy', 'jenkinsfile', 'bats']);
    assert.deepStrictEqual(HOST_PATTERNS, ['**/{Dockerfile,Containerfile}*', '**/{Makefile,GNUmakefile,*.mk}', '**/package.json', '**/*.bats']);
    assert.deepStrictEqual(ACTIVATION_LANGUAGES, ['shellscript', ...HOST_LANGUAGES.slice(0, 4), 'json', ...HOST_LANGUAGES.slice(4)]);
    assert.strictEqual(HOST_FILES.npm.setting, 'packageJson');
  });
});

describe('kindOfDocument', () => {
  const settings = defaultSettings();
  const kind = (languageId: string, fileName: string, text?: string, s = settings, shellLanguages?: string[]) => kindOfDocument({ languageId, fileName, text }, s, shellLanguages);

  it('tells a shell script, a host file, and a file with nothing for us', () => {
    assert.strictEqual(kind('shellscript', 'a.sh'), 'shell');
    assert.strictEqual(kind('dockerfile', 'Dockerfile'), 'dockerfile');
    assert.strictEqual(kind('json', '/p/package.json'), 'npm');
    assert.strictEqual(kind('json', '/p/tsconfig.json'), undefined);
    assert.strictEqual(kind('plaintext', 'notes.txt'), undefined);
  });

  it('lists a host file by the setting embedded.files, which names package.json files packageJson', () => {
    const without = mergeSettings({ 'embedded.files': ['yaml'] });
    assert.strictEqual(kind('json', '/p/package.json', undefined, without), undefined);
    assert.strictEqual(kind('yaml', 'ci.yml', undefined, without), 'yaml');
    assert.strictEqual(kind('dockerfile', 'Dockerfile', undefined, without), undefined);
  });

  it('reads a shell language as a shell script, but a bats file as bats', () => {
    const shellLike = mergeSettings({ languages: ['shellscript', 'yaml'] });
    assert.strictEqual(kind('yaml', 'ci.yml', undefined, shellLike), 'shell');
    assert.strictEqual(kind('shellscript', 'x.bats', undefined, shellLike), 'bats');
    assert.strictEqual(kind('shellscript', 'x', '#!/usr/bin/env bats\n'), 'bats');
    // With bats off, the file is a shell script.
    assert.strictEqual(kind('shellscript', 'x.bats', undefined, mergeSettings({ 'embedded.files': [] })), 'shell');
  });

  it('takes more shell languages from the caller, and calls a `make` file a Makefile', () => {
    assert.strictEqual(kind('zsh', 'x'), undefined);
    assert.strictEqual(kind('zsh', 'x', undefined, settings, ['zsh']), 'shell');
    assert.strictEqual(kind('make', 'x'), 'makefile');
  });
});

describe('openDocument', () => {
  it('splits the lines at LF and CRLF and parses a shell script', () => {
    const doc = openDocument('a\r\nb\nc', 'shell', parse);
    assert.deepStrictEqual(doc.lines, ['a', 'b', 'c']);
    assert.strictEqual(doc.extracted, undefined);
    assert.strictEqual(doc.tree.text.includes('b'), true);
  });

  it('extracts the shell code of a host file, or takes it ready', () => {
    const text = 'FROM x\nRUN echo hi\n';
    const doc = openDocument(text, 'dockerfile', parse);
    assert.deepStrictEqual(doc.extracted!.regions.map((r) => r.label[1]), ['Dockerfile RUN']);
    assert.strictEqual(doc.tree.text, doc.extracted!.text);
    const given = extractShell('dockerfile', text);
    assert.strictEqual(openDocument(text, 'dockerfile', parse, given).extracted, given);
    // The parser is called with the shell text, not the file.
    const seen: string[] = [];
    openDocument(text, 'dockerfile', (t) => (seen.push(t), parse(t)), given);
    assert.deepStrictEqual(seen, [given.text]);
  });
});

describe('shellsOf', () => {
  it('detects the shell from the first 50 lines and the file name, and keeps the one chosen', () => {
    assert.deepStrictEqual(shellsOf(['#!/bin/dash', 'echo'], 'a', undefined), { forced: undefined, detected: 'dash' });
    assert.deepStrictEqual(shellsOf(['echo'], 'a.zsh', 'sh'), { forced: 'sh', detected: 'zsh' });
    const late = [...Array(60).fill(''), '#!/bin/dash'];
    assert.strictEqual(shellsOf(late, 'a', undefined).detected, undefined);
  });
});

describe('diagnosticsFor', () => {
  const lang = 'en';
  const run = (d: ShellDocument | undefined, sh: Shells, s: Settings, surface: Surface) => diagnosticsFor(() => d, () => sh, lang, s, surface);
  const doc = openDocument('#!/bin/sh\necho $RANDOM\n[[ -n x ]]\n', 'shell', parse);
  const shells = shellsOf(doc.lines, 'a.sh', undefined);
  const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

  it('shows every problem by default', () => {
    const { all, shown } = run(doc, shells, defaultSettings(), 'vscode');
    assert.ok(all.length > 0);
    assert.deepStrictEqual(shown, all);
  });

  it('leaves out the codes of diagnostics.ignore, but keeps them in `all`', () => {
    const all = codes(run(doc, shells, defaultSettings(), 'web').all);
    const ignored = all[0];
    const r = run(doc, shells, mergeSettings({ 'diagnostics.ignore': [ignored] }), 'web');
    assert.deepStrictEqual(codes(r.all), all);
    assert.deepStrictEqual(codes(r.shown), all.filter((c) => c !== ignored));
  });

  it('shows none while diagnostics.enabled is off, on the surfaces that have the setting', () => {
    const off = mergeSettings({ 'diagnostics.enabled': false });
    for (const surface of ['vscode', 'web', 'lsp'] as const) assert.deepStrictEqual(run(doc, shells, off, surface).shown, [], surface);
    // The command-line tool has no such setting: --check reports.
    assert.ok(run(doc, shells, off, 'cli').shown.length > 0);
    // `all` is what the document has, whatever the settings say.
    assert.ok(run(doc, shells, off, 'web').all.length > 0);
  });

  it('opens (parses) the document only when its problems are looked at', () => {
    let opened = 0;
    const open = () => (opened++, doc);
    const off = mergeSettings({ 'diagnostics.enabled': false });
    assert.deepStrictEqual(diagnosticsFor(open, () => shells, lang, off, 'lsp').shown, []);
    assert.strictEqual(opened, 0);
    const on = diagnosticsFor(open, () => shells, lang, defaultSettings(), 'lsp');
    assert.ok(on.shown.length > 0 && on.all.length > 0);
    assert.strictEqual(opened, 1, 'once');
    // A document that cannot be opened has no problems.
    assert.deepStrictEqual(run(undefined, shells, defaultSettings(), 'lsp').shown, []);
  });

  it('shows none in the shell code of another file while diagnostics.embedded is off', () => {
    const text = 'FROM x\nRUN echo $RANDOM; [[ -n x ]]\n';
    const host = openDocument(text, 'dockerfile', parse);
    const hostShells = shellsOf(host.lines, 'Dockerfile', 'sh');
    const on = run(host, hostShells, defaultSettings(), 'cli');
    assert.ok(on.shown.length > 0);
    const off = run(host, hostShells, mergeSettings({ 'diagnostics.embedded': false }), 'cli');
    assert.deepStrictEqual(off.shown, []);
    assert.deepStrictEqual(off.all, on.all);
    // A shell script is not affected.
    assert.ok(run(doc, shells, mergeSettings({ 'diagnostics.embedded': false }), 'cli').shown.length > 0);
  });

  it('shows the pitfalls unless diagnostics.pitfalls or notes.pitfalls is off, and keeps them in `all`', () => {
    const bash = openDocument('#!/bin/bash\nx = 1\n[[ -n $a ]]\n', 'shell', parse);
    const sh = openDocument('#!/bin/sh\nx = 1\n[[ -n $a ]]\n', 'shell', parse);
    const shown = (d: ShellDocument, s: Settings) => codes(run(d, shellsOf(d.lines, 'a.sh', undefined), s, 'lsp').shown);
    assert.deepStrictEqual(shown(bash, defaultSettings()), ['assignment-with-spaces']);
    assert.deepStrictEqual(shown(sh, defaultSettings()), ['dbracket', 'assignment-with-spaces']);
    for (const off of [{ 'diagnostics.pitfalls': false }, { 'notes.pitfalls': false }]) {
      assert.deepStrictEqual(shown(bash, mergeSettings(off)), [], JSON.stringify(off));
      assert.deepStrictEqual(shown(sh, mergeSettings(off)), ['dbracket'], JSON.stringify(off));
      assert.deepStrictEqual(codes(run(sh, shellsOf(sh.lines, 'a.sh', undefined), mergeSettings(off), 'web').all), ['dbracket', 'assignment-with-spaces']);
    }
    // The file's directives apply to them too, in `all` as well.
    const quiet = openDocument('#!/bin/bash\n# bash-explainer disable=assignment-with-spaces\nx = 1\n', 'shell', parse);
    assert.deepStrictEqual(run(quiet, {}, defaultSettings(), 'web').all, []);
    // A dialect note that says it otherwise keeps a pitfall out, also when the note itself is turned off.
    const zsh = openDocument('#!/bin/zsh\n# bash-explainer disable=wordSplit\ncp $a b\n', 'shell', parse);
    assert.deepStrictEqual(run(zsh, shellsOf(zsh.lines, 'a.zsh', undefined), defaultSettings(), 'web').all, []);
  });
});

describe('plain', () => {
  it('drops the mark an explanation starts with, with or without a variation selector', () => {
    assert.strictEqual(plain('⚠ risky `x`'), 'risky `x`');
    assert.strictEqual(plain('ℹ️  note'), 'note');
    assert.strictEqual(plain('⚠️ x'), 'x');
    assert.strictEqual(plain('a ⚠ b'), 'a ⚠ b');
  });

  it('drops the backticks too when asked, as the command-line tool does', () => {
    assert.strictEqual(plain('⚠ use `[[` here', { backticks: false }), 'use [[ here');
    assert.strictEqual(plain('⚠ use `[[` here', { backticks: true }), 'use `[[` here');
  });
});

describe('settingsFromEditor', () => {
  it('reads each setting of the surface through the getter, and falls back to the default', () => {
    const asked: string[] = [];
    const set: Record<string, unknown> = {
      'notes.idioms': false, shell: 'dash', 'examples.placement': 'bottom', 'hover.maxDepth': 2, 'diagnostics.ignore': ['a'], 'editor.wrap': true,
      'examples.inHover': 'yes', language: 'fr', 'inline.maxLength': 5, customCommands: { x: 1 },
    };
    const s = settingsFromEditor((key) => (asked.push(key), set[key]));
    assert.strictEqual(s['notes.idioms'], false);
    assert.strictEqual(s.shell, 'dash');
    assert.strictEqual(s['examples.placement'], 'bottom');
    assert.strictEqual(s['hover.maxDepth'], 2);
    assert.deepStrictEqual(s['diagnostics.ignore'], ['a']);
    assert.deepStrictEqual(s.customCommands, { x: 1 });
    // A value that does not fit is the default, as is one that is missing.
    assert.strictEqual(s['examples.inHover'], true);
    assert.strictEqual(s.language, 'auto');
    assert.strictEqual(s['inline.maxLength'], 120);
    assert.strictEqual(s['hover.followDelay'], 400);
    // A setting VS Code does not have (the web page's) is not asked for.
    assert.strictEqual(s['editor.wrap'], false);
    assert.ok(!asked.includes('editor.wrap'));
  });

  it('keeps the known items of a list and drops the unknown ones, not the whole list', () => {
    const s = settingsFromEditor((key) => ({ 'embedded.files': ['dockerfile', 'typo'], 'examples.disabled': ['regex', 'nope'], 'diagnostics.ignore': ['anything'] } as Record<string, unknown>)[key]);
    assert.deepStrictEqual(s['embedded.files'], ['dockerfile']);
    assert.deepStrictEqual(s['examples.disabled'], ['regex']);
    assert.deepStrictEqual(s['diagnostics.ignore'], ['anything']);
    // A list of other things is still the default.
    assert.deepStrictEqual(settingsFromEditor((key) => (key === 'embedded.files' ? [1] : undefined))['embedded.files'], EMBEDDED_FILES);
  });

  it('takes the default for a number below its minimum, as the command-line tool does', () => {
    assert.strictEqual(settingsFromEditor((key) => (key === 'inline.maxLength' ? 10 : undefined))['inline.maxLength'], 120);
    assert.strictEqual(settingsFromEditor((key) => (key === 'inline.maxLength' ? 20 : undefined))['inline.maxLength'], 20);
  });

  it('copies lists and objects (VS Code gives read-only proxies, which structuredClone refuses)', () => {
    const list = new Proxy(['x'], {});
    const s = settingsFromEditor((key) => (key === 'diagnostics.ignore' ? list : undefined));
    assert.deepStrictEqual(s['diagnostics.ignore'], ['x']);
    assert.notStrictEqual(s['diagnostics.ignore'], list);
  });
});
