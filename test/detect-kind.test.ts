// The kind of a file from its content alone (src/hosts/detect.ts): what the web page decides when a script is pasted.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { detectKind, type FileKind } from '../src/hosts/detect';

const fixture = (f: string) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');

describe('detectKind', () => {
  it('finds the kind of every fixture, and of the shell tour', () => {
    const cases: [string, FileKind][] = [
      ['sample.sh', 'shell'],
      ['hosts/Dockerfile', 'dockerfile'],
      ['hosts/Makefile', 'makefile'],
      ['hosts/ci.yml', 'yaml'],
      ['hosts/workflow-defaults.yml', 'yaml'],
      ['hosts/circleci.yml', 'yaml'],
      ['hosts/azure-pipelines.yml', 'yaml'],
      ['hosts/action.yml', 'yaml'],
      ['hosts/package.json', 'npm'],
      ['hosts/README.md', 'markdown'],
      ['hosts/deploy.py', 'python'],
      ['hosts/Jenkinsfile', 'jenkinsfile'],
      ['hosts/test.bats', 'bats'],
    ];
    for (const [f, kind] of cases) assert.strictEqual(detectKind(fixture(f))?.kind, kind, f);
  });

  // [input, kind or undefined, what it shows]
  const table: [string, FileKind | undefined, string][] = [
    // Shebangs and directives.
    ['#!/bin/sh\necho hi\n', 'shell', 'sh'],
    ['#!/usr/bin/env -S bash -e\nFROM=x\n', 'shell', 'env -S bash'],
    ['#!/bin/zsh\nprint -l *(.)\n', 'shell', 'zsh'],
    ['\uFEFF#!/bin/bash\r\necho hi\r\n', 'shell', 'a BOM and CRLF'],
    ['#!/usr/bin/env bats\nload helper\n', 'bats', 'bats shebang without @test'],
    ['#!/usr/bin/env python3\nprint(1)\n', 'python', 'python shebang'],
    ['#!/usr/bin/perl\nprint 1;\n', undefined, 'another program'],
    ['# shellcheck shell=dash\nset -eu\n', 'shell', 'a ShellCheck directive'],
    // A shebang wins over what the lines look like.
    ['#!/bin/bash\nFROM debian\nRUN ls\n', 'shell', 'Dockerfile words in a shell script'],
    ['#!/bin/bash\ncat <<EOF > Makefile\nall:\n\techo hi\nEOF\n', 'shell', 'a Makefile in a here-document'],
    // bats.
    ['load helper\n\n@test "adds" {\n  run add 1 2\n}\n', 'bats', '@test without a shebang'],
    ["@test 'single quotes' {\n  true\n}\n", 'bats', "@test with ''"],
    ['echo "@test \\"x\\" {"\n', undefined, '@test inside a string'],
    // Dockerfile.
    ['FROM node:20\nRUN npm ci\nCMD ["node", "app.js"]\n', 'dockerfile', 'FROM, RUN, CMD'],
    ['# syntax=docker/dockerfile:1\nARG BASE=debian\nFROM ${BASE} AS build\nRUN make\n', 'dockerfile', 'ARG before FROM, a comment first'],
    ['FROM --platform=$BUILDPLATFORM golang:1.22 AS build\nWORKDIR /src\n', 'dockerfile', 'FROM --platform'],
    ['FROM scratch\n', undefined, 'FROM alone'],
    ['echo FROM debian\nRUN=1\necho RUN ls\n', undefined, 'FROM in an echo'],
    ['ls\nFROM debian\nRUN ls\n', undefined, 'FROM not first'],
    ['ARG X\nRUN ls\n', undefined, 'ARG without FROM'],
    ['FROM is where\nRUN ls\n', undefined, 'FROM followed by words'],
    // GitHub Actions and other CI.
    ['on:\n  push:\njobs:\n  a:\n    runs-on: ubuntu-latest\n', 'yaml', 'on/jobs/runs-on'],
    ['"on": push\njobs:\n  a:\n    steps:\n      - run: make\n', 'yaml', 'a quoted on'],
    ['stages: [build]\nbuild:\n  image: alpine\n  script:\n    - make\n', 'yaml', 'GitLab CI'],
    ['pool:\n  vmImage: ubuntu-latest\njobs:\n  - job: a\n', 'yaml', 'Azure Pipelines with jobs'],
    ['trigger:\n  - main\n', undefined, 'a trigger alone'],
    ['name: x\non: push\n', undefined, 'on without jobs'],
    ['jobs:\n  a:\n    runs-on: x\n', undefined, 'jobs without on'],
    ['apiVersion: v1\nkind: Pod\nspec:\n  containers:\n    - name: a\n', undefined, 'Kubernetes YAML'],
    ['version: 2\nservices:\n  web:\n    image: nginx\n', undefined, 'docker compose'],
    ['runs:\n  using: node20\n  main: index.js\n', undefined, 'a JavaScript action'],
    // Makefile.
    ['all: build\n\nbuild:\n\tgo build ./...\n', 'makefile', 'a TAB recipe'],
    ['%.o: %.c\n\t$(CC) -c $<\n', 'makefile', 'a pattern rule'],
    ['out/a b:: in\n\ttouch $@\n', 'makefile', 'a double-colon rule'],
    ['.PHONY: all\nall:\n    echo spaces\n', 'makefile', '.PHONY with a space-indented recipe'],
    ['build:\n    go build\n', undefined, 'spaces instead of a TAB (make rejects it; YAML looks the same)'],
    ['CC := gcc\n\techo x\n', undefined, ':= is not a rule'],
    ['see http://x\n\tindented\n', undefined, 'a URL is not a rule'],
    ['build:\n', undefined, 'a target with no recipe'],
    // Markdown.
    ['Run:\n\n```bash\nmake\n```\n', 'markdown', 'a bash block'],
    ['# Usage\n\n```python\nprint(1)\n```\n', 'markdown', 'a heading and a block of another language'],
    ['$ ls\n~~~console\n$ ls\nfile\n~~~\n', 'markdown', 'a console block with tildes'],
    ['# Title\n\nSome text.\n\n## More\n', undefined, 'no code blocks'],
    ['# comment\necho hi\n', undefined, 'a shell comment is not a heading'],
    ['```\nplain\n```\n', undefined, 'an untagged block without headings'],
    // Jenkinsfile.
    ["pipeline {\n  agent any\n  stages {\n  }\n}\n", 'jenkinsfile', 'pipeline with stages'],
    ["node('linux') {\n  sh 'make'\n}\n", 'jenkinsfile', 'a scripted node with sh'],
    ['pipeline {\n}\n', undefined, 'an empty pipeline'],
    ['node {\n  echo "x"\n}\n', undefined, 'node without a sh step'],
    // Python.
    ['import subprocess\n\nsubprocess.run(["ls"])\n', 'python', 'subprocess.run'],
    ['import os, sys\nos.system("ls")\n', 'python', 'os.system'],
    ['from subprocess import run\nimport os\nos.popen("ls")\n', 'python', 'os.popen'],
    ['import os\nprint(os.getcwd())\n', undefined, 'Python that runs nothing'],
    ['subprocess.run("ls")\n', undefined, 'a call without imports'],
    // package.json.
    ['{"name": "a", "scripts": {"test": "mocha"}}', 'npm', 'scripts'],
    ['{"name": "a"}', undefined, 'no scripts'],
    ['{"scripts": {}}', undefined, 'empty scripts'],
    ['{"scripts": {"a": 1}}', undefined, 'a script that is not a string'],
    ['{"scripts": ["a"]}', undefined, 'scripts as an array'],
    ['{ echo a; } > out\n', undefined, 'a shell group is not JSON'],
    // Nothing clear.
    ['', undefined, 'empty'],
    ['echo hello\nls -l | wc -l\n', undefined, 'a shell script without a shebang'],
  ];
  for (const [input, kind, what] of table) {
    it(`${what}: ${kind ?? 'nothing'}`, () => {
      const found = detectKind(input);
      assert.strictEqual(found?.kind, kind, JSON.stringify(found));
      if (found) assert.ok(found.why.length > 0);
    });
  }
});
