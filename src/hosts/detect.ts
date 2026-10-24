// Which kind of file a text is, from its content alone (the web page's paste has no file name). Only strong
// signals count: a text that is not clearly one kind gives undefined, and the caller keeps the kind it has.
import { detectShell } from '../dialect';
import { BATS_SHEBANG, extractShell, type HostKind } from './index';

/** A kind of file: a shell script, or a host file with shell code in it. */
export type FileKind = 'shell' | HostKind;

/** The kind found, and the signal it was found by (English, for people and tests). */
export interface DetectedKind { kind: FileKind; why: string }

/** The first line that is neither blank nor a `#` comment. */
const firstStatement = (lines: string[]) => lines.find((l) => l.trim() && !/^\s*#/.test(l));

// Dockerfile instructions, written in capitals as everyone does (Docker also takes `run`, but so would a guess).
const DOCKER_INSTRUCTION = /^(FROM|RUN|CMD|ENTRYPOINT|COPY|ADD|WORKDIR|ENV|ARG|EXPOSE|USER|LABEL|VOLUME|SHELL|HEALTHCHECK|ONBUILD|STOPSIGNAL)\s+\S/;
const DOCKER_FROM = /^FROM\s+(--platform=\S+\s+)?[\w.\-/:@${}]+(\s+AS\s+\w[\w.-]*)?\s*$/i;

// A Makefile rule: targets, one or two colons, then prerequisites (not `:=`, not `http://`), and a recipe line after it that starts
// with a TAB. make takes only a TAB there (a space is "missing separator"); YAML, which also has `key:` lines, forbids TABs in indentation.
const MAKE_RULE = /^[^\s#=:][^#=:]*::?(?![=:/])([ \t]|$)/;

/**
 * The kind of file `text` is, when it says so clearly: a shebang (`#!/bin/bash`, `#!/usr/bin/env bats`, python), a
 * ShellCheck `shell=` directive, bats' `@test "…" {`, a Dockerfile that starts with `FROM`, a GitHub Actions workflow
 * (`on:` and `jobs:` with `runs-on:` or `steps:`), a GitLab CI file, a Makefile rule with a TAB recipe or `.PHONY:`,
 * Markdown with a shell code block (or headings and a code block), a Jenkinsfile with a `sh` step, a Python script that runs
 * commands, a package.json with `scripts`. Undefined when nothing is that clear (a shell script without a shebang among them).
 */
export function detectKind(text: string): DetectedKind | undefined {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const head = lines[0];
  // The first line names the program: it wins over everything below.
  if (head.startsWith('#!')) {
    if (BATS_SHEBANG.test(head)) return { kind: 'bats', why: 'a bats shebang' };
    if (/^#![^\n]*[ \t/]python[\d.]*(?=[ \t]|$)/.test(head)) return { kind: 'python', why: 'a python shebang' };
    if (detectShell(head)) return { kind: 'shell', why: 'a shell shebang' };
  }
  if (lines.some((l) => /^\s*@test\s+(['"]).*\1\s*\{\s*$/.test(l))) return { kind: 'bats', why: 'a bats @test' };
  if (/^#\s*shellcheck\s+shell=\w+/m.test(text.slice(0, 2000))) return { kind: 'shell', why: 'a ShellCheck shell= directive' };

  const npm = packageJson(text);
  if (npm) return npm;

  const first = firstStatement(lines) ?? '';
  // A Dockerfile starts with FROM (an ARG may come before it, for the image's name).
  const instructions = lines.filter((l) => DOCKER_INSTRUCTION.test(l));
  if ((DOCKER_FROM.test(first) || (/^ARG\s/.test(first) && lines.some((l) => DOCKER_FROM.test(l)))) && instructions.length >= 2) {
    return { kind: 'dockerfile', why: 'a Dockerfile starting with FROM' };
  }

  const key = (k: string) => lines.some((l) => new RegExp(`^(${k})\\s*:(\\s|$)`).test(l));
  const nested = (k: string) => lines.some((l) => new RegExp(`^\\s+(-\\s+)?(${k})\\s*:(\\s|$)`).test(l));
  if (key(`on|"on"|'on'|true`) && key('jobs') && nested('runs-on|steps')) return { kind: 'yaml', why: 'a GitHub Actions workflow' };
  if (nested('script') && key('stages|image|default|variables|before_script')) {
    return { kind: 'yaml', why: 'a GitLab CI file' };
  }
  if (/^version\s*:\s*['"]?2(\.\d)?['"]?\s*$/m.test(text) && key('jobs') && nested('steps')) return { kind: 'yaml', why: 'a CircleCI config' };
  if (key('trigger|pool') && key('steps|jobs|stages')) return { kind: 'yaml', why: 'an Azure Pipelines file' };
  if (key('runs') && /^\s+using\s*:\s*['"]?composite['"]?\s*$/m.test(text)) return { kind: 'yaml', why: 'a composite action' };

  if (/^\s*(pipeline|node(\s*\([^)]*\))?)\s*\{\s*$/.test(first) && /^\s*(sh|bat|powershell)\s*(\(|'|")|^\s*stages\s*\{/m.test(text)) {
    return { kind: 'jenkinsfile', why: 'a Jenkins pipeline' };
  }

  if (lines.some((l) => /^\.PHONY\s*:/.test(l))) return { kind: 'makefile', why: 'a .PHONY rule' };
  if (lines.some((l, i) => MAKE_RULE.test(l) && /^\t\S/.test(lines[i + 1] ?? ''))) return { kind: 'makefile', why: 'a rule with a TAB recipe' };

  const fence = /^\s*(`{3,}|~{3,})/;
  if (extractShell('markdown', text).regions.length) return { kind: 'markdown', why: 'a shell code block' };
  if (lines.some((l) => /^#{1,6}\s+\S/.test(l)) && lines.filter((l) => fence.test(l)).length >= 2) return { kind: 'markdown', why: 'headings and a code block' };

  const imports = lines.filter((l) => /^(import\s+[\w.]+(\s*,\s*[\w.]+)*(\s+as\s+\w+)?|from\s+[\w.]+\s+import\s+.+)\s*$/.test(l));
  if (imports.some((l) => /\b(subprocess|os)\b/.test(l)) && /\b(subprocess\.\w+|os\.system|os\.popen)\s*\(/.test(text)) {
    return { kind: 'python', why: 'a Python script that runs commands' };
  }
  return undefined;
}

/** package.json: a JSON object whose `scripts` is an object of strings. */
function packageJson(text: string): DetectedKind | undefined {
  if (!/^\s*\{/.test(text)) return undefined;
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return undefined;
  }
  const scripts = (v as { scripts?: unknown }).scripts;
  const ok = !!scripts && typeof scripts === 'object' && !Array.isArray(scripts) && Object.values(scripts).length > 0 && Object.values(scripts).every((s) => typeof s === 'string');
  return ok ? { kind: 'npm', why: 'a package.json with scripts' } : undefined;
}
