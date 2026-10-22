import type { HostKind } from '../src/hosts';

/** The kinds of file the page explains: a shell script, or a file with shell code in it. */
export type Kind = 'shell' | HostKind;

/** test/fixtures/sample.sh, the tour of every feature, put in by scripts/build-web.ts (esbuild `define`). */
declare const __SAMPLE_SH__: string;

export const KINDS: { kind: Kind; name: string; fileName: string; cursorLine: number; sample: string }[] = [
  {
    kind: 'shell',
    name: 'Shell script',
    fileName: 'script.sh',
    cursorLine: 8,
    sample: __SAMPLE_SH__,
  },
  {
    kind: 'dockerfile',
    name: 'Dockerfile',
    fileName: 'Dockerfile',
    cursorLine: 3,
    sample: `FROM debian:bookworm-slim

RUN apt-get update \\
 && apt-get install -y --no-install-recommends curl ca-certificates \\
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://example.com/install.sh | sh

ENTRYPOINT ["sh", "-c", "exec myapp --port \${PORT:-8080}"]
`,
  },
  {
    kind: 'makefile',
    name: 'Makefile',
    fileName: 'Makefile',
    cursorLine: 5,
    sample: `SRC := $(wildcard src/*.c)

build: $(SRC)
\tmkdir -p out
\t$(CC) -O2 -o out/app $^ 2>&1 | tee build.log

clean:
\trm -rf out && find . -name '*.o' -delete
`,
  },
  {
    kind: 'yaml',
    name: 'GitHub Actions / GitLab CI',
    fileName: '.github/workflows/ci.yml',
    cursorLine: 11,
    sample: `name: CI
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: |
          set -euo pipefail
          npm ci && npm test -- --reporter dot
      - run: echo "Title: \${{ github.event.pull_request.title }}"
`,
  },
  {
    kind: 'npm',
    name: 'package.json',
    fileName: 'package.json',
    cursorLine: 3,
    sample: `{
  "scripts": {
    "build": "rm -rf dist && tsc -p . && cp -r assets dist/",
    "test": "NODE_ENV=test mocha 'test/**/*.test.js' || exit 1",
    "lint": "eslint . --ext .ts 2>&1 | tee lint.log"
  }
}
`,
  },
  {
    kind: 'markdown',
    name: 'Markdown',
    fileName: 'README.md',
    cursorLine: 6,
    sample: `# Install

Run:

\`\`\`sh
curl -fsSL https://example.com/install.sh | sudo bash -s -- --prefix /opt/app
export PATH="/opt/app/bin:$PATH"
\`\`\`
`,
  },
  {
    kind: 'python',
    name: 'Python',
    fileName: 'deploy.py',
    cursorLine: 4,
    sample: `import os
import subprocess

subprocess.run("git fetch --all && git reset --hard origin/main", shell=True, check=True)
subprocess.run(["rsync", "-az", "--delete", "build/", "server:/srv/app/"])
os.system(f"tar -czf {name}.tar.gz dist/")
`,
  },
  {
    kind: 'jenkinsfile',
    name: 'Jenkinsfile',
    fileName: 'Jenkinsfile',
    cursorLine: 7,
    sample: `pipeline {
  agent any
  stages {
    stage('Build') {
      steps {
        sh 'make -j"$(nproc)" build'
        sh "docker build -t app:\${env.BUILD_NUMBER} ."
        sh '''
          set -eu
          for f in dist/*.tar.gz; do sha256sum "$f"; done
        '''
      }
    }
  }
}
`,
  },
  {
    kind: 'bats',
    name: 'bats',
    fileName: 'test.bats',
    cursorLine: 5,
    sample: `#!/usr/bin/env bats
bats_require_minimum_version 1.5.0

@test "greets by name" {
  run ./greet.sh Ada
  [ "$status" -eq 0 ]
  [ "\${lines[0]}" = "Hello, Ada" ]
}

@test "fails without a name" {
  run ! ./greet.sh
  ! grep -q Ada greet.log
  run ./greet.sh --help | grep -q Usage
}
`,
  },
];
