import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type { BashParser as Parser } from '../src/parser';
import { Analyzer, Token } from '../src/analyzer';
import { explainHostedLine, extractShell, hostIssues, hostKind } from '../src/hosts';
import { createBashParser } from '../src/parser';

const root = path.join(__dirname, '..');
let parser: Parser;
before(async () => {
  parser = await createBashParser({
    runtimeDir: path.join(root, 'node_modules/web-tree-sitter'),
    bashWasm: path.join(root, 'node_modules/tree-sitter-bash/tree-sitter-bash.wasm'),
  });
});

/** Explain a line (1-based) of a fixture in test/fixtures/hosts. */
function explain(file: string, line: number, lang: 'ja' | 'en' = 'en') {
  const src = fs.readFileSync(path.join(root, 'test/fixtures/hosts', file), 'utf8');
  const kind = hostKind('', file)!;
  const extracted = extractShell(kind, src);
  const tree = parser.parse(extracted.text);
  const ex = explainHostedLine(new Analyzer(lang), tree, extracted, src.split('\n'), line - 1, lang);
  tree.delete();
  return ex;
}
const all = (ts: Token[]): Token[] => ts.flatMap((t) => [t, ...all(t.children)]);
const labels = (file: string, line: number) => all(explain(file, line)!.items).map((t) => `${t.label}@${t.span.start.character}`);

describe('hostKind', () => {
  it('recognises hosts by language id and file name', () => {
    assert.strictEqual(hostKind('plaintext', '/a/Dockerfile.dev'), 'dockerfile');
    assert.strictEqual(hostKind('makefile', 'x'), 'makefile');
    assert.strictEqual(hostKind('json', '/p/package.json'), 'npm');
    assert.strictEqual(hostKind('json', '/p/tsconfig.json'), undefined);
    assert.strictEqual(hostKind('github-actions-workflow', 'ci.yml'), 'yaml');
    assert.strictEqual(hostKind('markdown', 'README.md'), 'markdown');
  });
});

describe('Dockerfile', () => {
  it('explains RUN with its columns, across a comment in the continuation', () => {
    assert.ok(labels('Dockerfile', 3).includes('apk add --no-cache curl jq@4'));
    assert.ok(labels('Dockerfile', 5).includes('rm -rf /var/cache/apk/*@7'));
    assert.ok(!labels('Dockerfile', 5).some((l) => l.startsWith('&&@') === false && /error/.test(l)));
    assert.ok(!all(explain('Dockerfile', 5)!.items).some((t) => t.kind === 'error'));
  });
  it('skips flags and non-shell lines; reads here-documents', () => {
    assert.ok(labels('Dockerfile', 6)[0].endsWith('@43'));
    assert.strictEqual(explain('Dockerfile', 1), undefined);
    assert.deepStrictEqual(explain('Dockerfile', 9)!.context.map((c) => c.label), ['Dockerfile RUN (here-document)']);
  });
  it('explains the exec form as a command run without a shell', () => {
    const ex = explain('Dockerfile', 7)!;
    assert.match(ex.notes[0], /runs the command directly, without a shell/);
    assert.deepStrictEqual(all(ex.items).map((t) => [t.kind, t.label]), [['builtin', '"echo", "exec form is not a shell"'], ['argument', '"exec form is not a shell"'], ['string', '"exec form is not a shell"']]);
    const multi = labels('Dockerfile', 17);
    assert.ok(multi.includes('"--config"@24') && multi.includes('"--name"@12') && multi.includes('"$HOME/app.conf"@36'), multi.join());
  });
  it('explains SHELL, and the script of an exec-form `sh -c`', () => {
    const shell = explain('Dockerfile', 12)!;
    assert.match(shell.notes[0], /Later shell-form RUN, CMD and ENTRYPOINT instructions run with this command/);
    assert.ok(labels('Dockerfile', 12).includes('"pipefail"@26'));
    const script = explain('Dockerfile', 15)!;
    assert.strictEqual(script.context[0].label, 'Dockerfile CMD (a script passed to `sh -c` in exec form)');
    assert.ok(labels('Dockerfile', 15).includes('tee /var/log/app.log@64'));
  });
  it('warns about pipes in RUN until SHELL sets pipefail', () => {
    assert.match(explain('Dockerfile', 10)!.notes.join(), /If a command in the middle of the pipe fails/);
    assert.ok(!explain('Dockerfile', 18)!.notes.some((n) => /middle of the pipe/.test(n)));
    assert.ok(!explain('Dockerfile', 3)!.notes.some((n) => /middle of the pipe/.test(n)), 'no pipe, no warning');
  });
  it('checks for /bin/sh until SHELL switches to bash', () => {
    assert.match(explain('Dockerfile', 6)!.notes.join(), /`\[\[ \]\]` is not POSIX sh/);
    assert.ok(!explain('Dockerfile', 13)!.notes.some((n) => /POSIX/.test(n)));
  });
});

describe('Makefile', () => {
  it('turns make syntax into shell and explains it', () => {
    const ex = explain('Makefile', 7)!;
    assert.deepStrictEqual(ex.notes.slice(0, 3), [
      '`$(CC)` is the make variable `CC`, expanded by make before the shell runs.',
      '`$@` is make\'s automatic variable (the target name), expanded by make before the shell runs.',
      '`$^` is make\'s automatic variable (all prerequisites), expanded by make before the shell runs.',
    ]);
    assert.ok(labels('Makefile', 7).includes('$(CC) -o $@ $^@1'));
    assert.ok(labels('Makefile', 7).includes('$$(date +%F)@37'), labels('Makefile', 7).join());
    assert.ok(labels('Makefile', 6).includes('mkdir -p $(dir $@)@2'), 'the @ prefix is not part of the command');
  });
  it('checks recipes for /bin/sh', () => {
    assert.match(explain('Makefile', 9)!.notes.join(), /`\[\[ \]\]` is not POSIX sh/);
    assert.strictEqual(explain('Makefile', 1), undefined);
  });
});

describe('YAML', () => {
  it('explains run: blocks, GitHub expressions and the shell of each step', () => {
    assert.match(explain('ci.yml', 12)!.notes[0], /`\$\{\{ matrix\.node \}\}` is the GitHub Actions expression `matrix\.node`: the matrix value `node`/);
    assert.ok(labels('ci.yml', 10).includes('set -euo pipefail@10'));
    assert.ok(!explain('ci.yml', 10)!.notes.some((n) => /POSIX/.test(n)), 'run: defaults to bash');
    assert.match(explain('ci.yml', 15)!.notes.join(), /not POSIX sh/);
    assert.ok(labels('ci.yml', 15)[0].endsWith('@14'), 'inside the quotes');
    assert.strictEqual(explain('ci.yml', 8), undefined);
  });
});

describe('code that is not shell', () => {
  /** The lines (1-based) that are explained as shell. */
  const shellLines = (kind: 'yaml' | 'dockerfile', text: string) =>
    extractShell(kind, text).regions.flatMap((r) => Array.from({ length: r.end - r.start + 1 }, (_, k) => r.start + k + 1));

  it('skips the JavaScript of actions/github-script', () => {
    const wf = [
      'jobs:', '  a:', '    runs-on: ubuntu-latest', '    steps:',
      '      - uses: actions/github-script@v7', '        with:', '          script: |', '            const n = 1;', '            await github.rest.issues.list();',
      '      - run: echo hi',
    ].join('\n');
    assert.deepStrictEqual(shellLines('yaml', wf), [10]);
  });

  it('skips steps of Windows jobs (PowerShell by default), unless the step says bash', () => {
    const wf = [
      'jobs:', '  win:', '    runs-on: windows-2025', '    steps:', '      - run: Write-Host hi', '      - run: echo "$HOME"', '        shell: bash',
      '  linux:', '    runs-on: ubuntu-24.04', '    steps:', '      - run: echo hi',
      '  matrix:', '    runs-on: ${{ matrix.os }}', '    steps:', '      - run: echo hi',
    ].join('\n');
    assert.deepStrictEqual(shellLines('yaml', wf), [6, 11, 15]);
  });

  it('skips Dockerfile stages that run PowerShell or cmd, until the next FROM', () => {
    const df = [
      'FROM mcr.microsoft.com/windows/servercore:ltsc2022', 'RUN echo %PATH%',
      'SHELL ["powershell", "-Command"]', 'RUN Write-Host hi; `', '    Remove-Item x',
      'FROM alpine:3.20', 'RUN echo hi',
      'SHELL ["cmd", "/S", "/C"]', 'RUN dir',
    ].join('\n');
    assert.deepStrictEqual(shellLines('dockerfile', df), [7]);
  });
});

describe('package.json and Markdown', () => {
  it('reads npm scripts, undoing JSON escapes', () => {
    assert.ok(labels('package.json', 4).includes('cp -r \\"static/\\" dist/@41'), labels('package.json', 4).join());
    assert.match(explain('package.json', 4)!.context[0].label, /npm script `build`/);
    assert.strictEqual(explain('package.json', 2), undefined);
  });
  it('reads shell code blocks, and only the commands of console blocks', () => {
    assert.ok(labels('README.md', 8).includes('grep -c error app.log@2'));
    assert.strictEqual(explain('README.md', 9)!.items.length, 0);
    assert.strictEqual(explain('README.md', 15), undefined);
  });
});

describe('other CI systems', () => {
  const shellLines = (file: string) => {
    const src = fs.readFileSync(path.join(root, 'test/fixtures/hosts', file), 'utf8');
    return extractShell(hostKind('', file)!, src).regions.flatMap((r) => Array.from({ length: r.end - r.start + 1 }, (_, k) => r.start + k + 1));
  };

  it('reads Jenkinsfile sh steps in every quoting, leaving Groovy out', () => {
    assert.strictEqual(hostKind('groovy', '/p/Jenkinsfile'), 'jenkinsfile');
    assert.strictEqual(hostKind('plaintext', 'deploy.jenkinsfile'), 'jenkinsfile');
    assert.deepStrictEqual(shellLines('Jenkinsfile'), [6, 7, 9, 10, 13, 16]);
    assert.deepStrictEqual(labels('Jenkinsfile', 6).slice(0, 2), ['make -j"$(nproc)" build@12', '-j"$(nproc)"@17']);
  });

  it('marks Groovy interpolation in double quotes, and undoes \\$', () => {
    const ex = explain('Jenkinsfile', 16)!;
    assert.ok(ex.notes.some((n) => /Groovy fills in `\$name`/.test(n)), ex.notes.join('\n'));
    assert.ok(all(ex.items).some((t) => t.label === '$ver' && /Groovy expression `ver`/.test(t.explanation)));
    assert.ok(all(ex.items).some((t) => t.label === '\\$HOME' || t.label === '$HOME'));
    assert.deepStrictEqual(explain('Jenkinsfile', 6)!.notes.filter((n) => /Groovy/.test(n)), []);
  });

  it('reads CircleCI run steps, with name: and command: under run:', () => {
    assert.deepStrictEqual(shellLines('circleci.yml'), [8, 12, 13]);
    assert.match(explain('circleci.yml', 12)!.context[0]?.label ?? '', /CircleCI `run` step/);
  });

  it('reads Azure Pipelines script: and bash:, with $(var) macros, not PowerShell', () => {
    assert.deepStrictEqual(shellLines('azure-pipelines.yml'), [8, 11, 12]);
    const items = all(explain('azure-pipelines.yml', 8)!.items);
    assert.ok(items.some((t) => t.label === '$(buildConfiguration)' && /Azure Pipelines macro/.test(t.explanation)));
    assert.ok(!items.some((t) => t.label === 'buildConfiguration' && t.kind === 'command'));
    assert.ok(all(explain('azure-pipelines.yml', 11)!.items).some((t) => t.label === '$(Build.SourceBranchName)'));
  });
});

describe('GitHub Actions', () => {
  it('reads composite actions and the shell of each step, skipping pwsh', () => {
    assert.strictEqual(explain('action.yml', 13)!.context[0].label, 'GitHub Actions `run:` step');
    assert.strictEqual(explain('action.yml', 20), undefined);
    assert.ok(labels('action.yml', 23)[0].endsWith('@12'));
    assert.ok(!explain('action.yml', 23)!.notes.some((n) => /POSIX/.test(n)), 'custom bash command line');
  });
  it('warns about untrusted input pasted into a script', () => {
    const notes = explain('action.yml', 17)!.notes;
    assert.match(notes[0], /^⚠ Script injection risk: `github\.event\.pull_request\.title`/);
    assert.ok(!explain('action.yml', 13)!.notes.some((n) => /injection/.test(n)), 'inputs are not flagged');
  });
  it('explains the files GitHub provides', () => {
    assert.match(explain('action.yml', 14)!.notes.join(), /`\$GITHUB_PATH` is the path of a file GitHub Actions provides: directories written here are added to PATH/);
  });
  it('follows defaults: run: shell:, overridden by a step', () => {
    assert.match(explain('workflow-defaults.yml', 10)!.notes.join(), /`\$RANDOM` is not POSIX sh/);
    assert.strictEqual(explain('workflow-defaults.yml', 4), undefined);
    assert.match(explain('workflow-defaults.yml', 11)!.notes[0], /injection/);
  });
});

describe('Python', () => {
  it('explains a shell=True string as a /bin/sh script', () => {
    const ex = explain('deploy.py', 6)!;
    assert.strictEqual(ex.context[0].label, 'Python `sp.run` (a string the shell (/bin/sh) runs)');
    assert.ok(labels('deploy.py', 6).includes('tar -czf backup.tgz data/@8'));
    assert.ok(labels('deploy.py', 9).includes('ls *.log@11'), 'os.system');
  });
  it('explains a list as arguments run without a shell', () => {
    assert.match(explain('deploy.py', 7)!.notes[0], /run directly, without a shell/);
    assert.ok(labels('deploy.py', 7).includes('"--oneline"@19'));
    const ssh = all(explain('deploy.py', 18)!.items);
    assert.match(ssh.find((t) => t.label === 'host')!.explanation, /The value of the Python expression `host`/);
  });
  it('warns about f-strings with shell=True and strings without it', () => {
    assert.match(explain('deploy.py', 8)!.notes[0], /^⚠ Shell injection risk/);
    assert.match(explain('deploy.py', 10)!.notes[0], /^⚠ Without shell=True the whole string is taken as one program name/);
  });
  it('joins adjacent literals across lines, and skips comments and other strings', () => {
    assert.ok(labels('deploy.py', 12).includes('wc -l@10'));
    assert.ok(!all(explain('deploy.py', 12)!.items).some((t) => t.kind === 'error'));
    assert.strictEqual(explain('deploy.py', 17), undefined);
    assert.strictEqual(explain('deploy.py', 15), undefined);
  });
});

describe('issues for the Problems panel', () => {
  const issues = (file: string) => {
    const src = fs.readFileSync(path.join(root, 'test/fixtures/hosts', file), 'utf8');
    const extracted = extractShell(hostKind('', file)!, src);
    const tree = parser.parse(extracted.text);
    const out = hostIssues(tree, extracted, src.split('\n'), 'en');
    tree.delete();
    return out.map((i) => `${i.code}@${i.startLine + 1}:${i.startCol}-${i.endCol}`);
  };
  it('places Dockerfile issues at original columns', () => {
    assert.deepStrictEqual(issues('Dockerfile'), ['dbracket@6:43-62', 'dockerPipefail@10:55-56']);
  });
  it('reports injection risks and shell checks in GitHub Actions', () => {
    assert.deepStrictEqual(issues('action.yml'), ['injection@17:23-61']);
    assert.deepStrictEqual(issues('workflow-defaults.yml'), ['random@10:18-27', 'injection@11:19-41']);
  });
  it('reports Python strings without shell=True and f-strings run by a shell', () => {
    assert.deepStrictEqual(issues('deploy.py').filter((i) => i.startsWith('python')), ['pythonInjection@8:21-64', 'pythonNoShell@10:8-13']);
  });
});

/** Explain a line (0-based) of `src`, read as the file `file`. */
function explainHosted(file: string, src: string, line: number) {
  const extracted = extractShell(hostKind('', file)!, src);
  const tree = parser.parse(extracted.text);
  try {
    return explainHostedLine(new Analyzer('en'), tree, extracted, src.split('\n'), line, 'en');
  } finally {
    tree.delete();
  }
}

describe('variables of CI systems', () => {
  it('explains GitHub Actions contexts, Jenkins env and params, and CI environment variables', () => {
    const gh = explainHosted('.github/workflows/ci.yml', 'on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "${{ github.ref_name }} ${{ steps.b.outputs.dir }}" "$GITHUB_WORKSPACE"\n', 5);
    const all = JSON.stringify(gh);
    assert.match(all, /the branch or tag that triggered the workflow/);
    assert.match(all, /the output `dir` of the step with ID `b`/);
    assert.match(all, /set by GitHub Actions: the default working directory of steps/);
    const jk = JSON.stringify(explainHosted('Jenkinsfile', 'node {\n  sh "echo ${env.BRANCH_NAME}"\n}\n', 1));
    assert.match(jk, /the branch being built \(in multibranch pipelines\)/);
  });
});

describe('host files the other tests do not reach', () => {
  /** The notes and explanations of a line (0-based) of `src`, read as the file `file`. */
  const text = (file: string, src: string, line: number) => {
    const extracted = extractShell(hostKind('', file)!, src);
    const tree = parser.parse(extracted.text);
    try {
      const ex = explainHostedLine(new Analyzer('en'), tree, extracted, src.split('\n'), line, 'en');
      return ex ? [...ex.context.map((c) => c.label), ...ex.notes, ...all(ex.items).map((t) => `${t.label}: ${t.explanation}`)].join('\n') : '';
    } finally {
      tree.delete();
    }
  };
  it('Makefile: SHELL, and one-letter make variables', () => {
    assert.match(text('Makefile', 'SHELL := /bin/bash\nall:\n\techo $O\n', 2), /the make variable `O`, expanded by make before the shell runs/);
    const ex = extractShell('makefile', 'SHELL := /bin/zsh\nall:\n\techo hi\n');
    assert.strictEqual(ex.regions[0].shell, 'zsh');
  });
  it('YAML: a script: list of commands', () => {
    const src = 'build:\n  script:\n    - make\n    - |\n      echo done\n';
    assert.match(text('.gitlab-ci.yml', src, 2), /YAML `script:`/);
    assert.match(text('.gitlab-ci.yml', src, 4), /echo done: Print arguments/);
  });
  it('Azure Pipelines: template expressions', () => {
    const src = 'trigger: none\npool:\n  vmImage: ubuntu-latest\nsteps:\n  - bash: echo ${{ parameters.env }}\n';
    assert.match(text('azure-pipelines.yml', src, 4), /an Azure Pipelines template expression, replaced with the value of `parameters.env` when the pipeline is expanded/);
  });
  it('Python: shell=True with a list, and escapes in the script', () => {
    const src = 'import subprocess\nsubprocess.run(["echo \\x41 \\\\n $0", "arg"], shell=True)\n';
    const t = text('x.py', src, 1);
    assert.match(t, /With shell=True and a list, only the first item is the shell command/);
    assert.match(extractShell('python', src).text, /^echo A \\n \$0$/m);
  });
});
