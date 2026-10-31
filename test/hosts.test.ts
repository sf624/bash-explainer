import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import type { BashParser as Parser } from '../src/syntax/tree';
import type { Shell } from '../src/dialect';
import { Analyzer, Token } from '../src/analyzer';
import { batsTestName, explainHostedLine, extractShell, hostIssues, hostKind } from '../src/hosts';
import { githubContext } from '../src/dict/ciVariables';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { allTokens } from './support/explain';

const root = path.join(__dirname, '..');
let parser: Parser;
before(async () => {
  parser = createUnbashParser();
});

/** Explain a line (1-based) of a fixture in test/fixtures/hosts. */
function explain(file: string, line: number, lang: 'ja' | 'en' = 'en') {
  const src = fs.readFileSync(path.join(root, 'test/fixtures/hosts', file), 'utf8');
  const kind = hostKind('', file)!;
  const extracted = extractShell(kind, src);
  const tree = parser.parse(extracted.text);
  const ex = explainHostedLine(new Analyzer(lang), tree, extracted, src.split('\n'), line - 1, lang);
  return ex;
}
const labels = (file: string, line: number) => allTokens(explain(file, line)!.items).map((t) => `${t.label}@${t.span.start.character}`);

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
    assert.ok(labels('Dockerfile', 3).includes('apk@4'));
    assert.ok(labels('Dockerfile', 5).includes('rm@7'));
    assert.ok(!labels('Dockerfile', 5).some((l) => l.startsWith('&&@') === false && /error/.test(l)));
    assert.ok(!allTokens(explain('Dockerfile', 5)!.items).some((t) => t.kind === 'error'));
  });
  it('skips flags and non-shell lines; reads here-documents', () => {
    assert.ok(labels('Dockerfile', 6)[0].endsWith('@43'));
    assert.strictEqual(explain('Dockerfile', 1), undefined);
    assert.deepStrictEqual(explain('Dockerfile', 9)!.context.map((c) => c.label), ['Dockerfile RUN (here-document)']);
  });
  it('explains the exec form as a command run without a shell', () => {
    const ex = explain('Dockerfile', 7)!;
    assert.match(ex.notes[0], /runs the command directly, without a shell/);
    assert.deepStrictEqual(allTokens(ex.items).map((t) => [t.kind, t.label]), [['builtin', '"echo"'], ['argument', '"exec form is not a shell"'], ['string', '"exec form is not a shell"']]);
    const multi = labels('Dockerfile', 17);
    assert.ok(multi.includes('"--config"@24') && multi.includes('"--name"@12') && multi.includes('"$HOME/app.conf"@36'), multi.join());
  });
  it('explains SHELL, and the script of an exec-form `sh -c`', () => {
    const shell = explain('Dockerfile', 12)!;
    assert.match(shell.notes[0], /Later shell-form RUN, CMD and ENTRYPOINT instructions run with this command/);
    assert.ok(labels('Dockerfile', 12).includes('"pipefail"@26'));
    const script = explain('Dockerfile', 15)!;
    assert.strictEqual(script.context[0].label, 'Dockerfile CMD (a script passed to `sh -c` in exec form)');
    assert.ok(labels('Dockerfile', 15).includes('tee@64'));
  });
  it('warns about pipes in RUN until SHELL sets pipefail', () => {
    assert.match(explain('Dockerfile', 10)!.notes.join(), /If a command in the middle of the pipe fails/);
    assert.ok(!explain('Dockerfile', 18)!.notes.some((n) => /middle of the pipe/.test(n)));
    assert.ok(!explain('Dockerfile', 3)!.notes.some((n) => /middle of the pipe/.test(n)), 'no pipe, no warning');
  });
  it('reads set -o pipefail where it runs in the RUN, not a word pipefail anywhere', () => {
    const warns = (src: string, line: number, shell?: Shell) => {
      const extracted = extractShell('dockerfile', src);
      const tree = parser.parse(extracted.text);
      const ex = explainHostedLine(new Analyzer('en'), tree, extracted, src.split('\n'), line, 'en', shell)!;
      const issues = hostIssues(tree, extracted, src.split('\n'), 'en', shell).filter((i) => i.code === 'dockerPipefail' && i.startLine === line);
      const said = ex.notes.some((n) => /middle of the pipe/.test(n));
      assert.strictEqual(said, issues.length > 0);
      return said;
    };
    assert.ok(!warns('FROM x\nRUN set -o pipefail && a | b', 1));
    assert.ok(warns('FROM x\nRUN a | b && set -o pipefail', 1));
    assert.ok(warns('FROM x\n# set -o pipefail\nRUN a | b', 2));
    assert.ok(warns('FROM x\nRUN set -o pipefail\nRUN a | b', 2));
    assert.ok(!warns('FROM x\nRUN [ -n "$x" ] && set -o pipefail; a | b', 1));
    // (In the shell chosen, as the rest of the line: bash's `shopt -o` sets pipefail, sh has no `shopt`.)
    assert.ok(warns('FROM x\nRUN shopt -so pipefail; a | b', 1));
    assert.ok(!warns('FROM x\nRUN shopt -so pipefail; a | b', 1, 'bash'));
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
    assert.ok(labels('Makefile', 7).includes('$(CC)@1'));
    assert.ok(labels('Makefile', 7).includes('$$(date +%F)@37'), labels('Makefile', 7).join());
    assert.ok(labels('Makefile', 6).includes('mkdir@2'), 'the @ prefix is not part of the command');
  });
  it('checks recipes for /bin/sh', () => {
    assert.match(explain('Makefile', 9)!.notes.join(), /`\[\[ \]\]` is not POSIX sh/);
    assert.strictEqual(explain('Makefile', 1), undefined);
  });
});

describe('YAML', () => {
  it('explains run: blocks, GitHub expressions and the shell of each step', () => {
    assert.match(explain('ci.yml', 12)!.notes[0], /`\$\{\{ matrix\.node \}\}` is the GitHub Actions expression `matrix\.node`: the matrix value `node`/);
    assert.ok(labels('ci.yml', 10).includes('set@10'));
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
    assert.ok(labels('package.json', 4).includes('cp@41'), labels('package.json', 4).join());
    assert.match(explain('package.json', 4)!.context[0].label, /npm script `build`/);
    assert.strictEqual(explain('package.json', 2), undefined);
  });
  it('reads shell code blocks, and only the commands of console blocks', () => {
    assert.ok(labels('README.md', 8).includes('grep@2'));
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
    assert.deepStrictEqual(labels('Jenkinsfile', 6).slice(0, 2), ['make@12', '-j"$(nproc)"@17']);
  });

  it('marks Groovy interpolation in double quotes, and undoes \\$', () => {
    const ex = explain('Jenkinsfile', 16)!;
    assert.ok(ex.notes.some((n) => /Groovy fills in `\$name`/.test(n)), ex.notes.join('\n'));
    assert.ok(allTokens(ex.items).some((t) => t.label === '$ver' && /Groovy expression `ver`/.test(t.explanation)));
    assert.ok(allTokens(ex.items).some((t) => t.label === '\\$HOME' || t.label === '$HOME'));
    assert.deepStrictEqual(explain('Jenkinsfile', 6)!.notes.filter((n) => /Groovy/.test(n)), []);
  });

  it('reads CircleCI run steps, with name: and command: under run:', () => {
    assert.deepStrictEqual(shellLines('circleci.yml'), [8, 12, 13]);
    assert.match(explain('circleci.yml', 12)!.context[0]?.label ?? '', /CircleCI `run` step/);
  });

  it('reads Azure Pipelines script: and bash:, with $(var) macros, not PowerShell', () => {
    assert.deepStrictEqual(shellLines('azure-pipelines.yml'), [8, 11, 12]);
    const items = allTokens(explain('azure-pipelines.yml', 8)!.items);
    assert.ok(items.some((t) => t.label === '$(buildConfiguration)' && /Azure Pipelines macro/.test(t.explanation)));
    assert.ok(!items.some((t) => t.label === 'buildConfiguration' && t.kind === 'command'));
    assert.ok(allTokens(explain('azure-pipelines.yml', 11)!.items).some((t) => t.label === '$(Build.SourceBranchName)'));
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

describe('GitHub Actions expression contexts', () => {
  const wf = (...exprs: string[]) => `on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ${exprs.map((e) => `"\${{ ${e} }}"`).join(' ')}\n`;
  const explainSrc = (src: string, lang: 'ja' | 'en' = 'en') => {
    const kind = hostKind('', 'x.yml')!;
    const extracted = extractShell(kind, src);
    return explainHostedLine(new Analyzer(lang), parser.parse(extracted.text), extracted, src.split('\n'), 5, lang)!;
  };
  const en = (expr: string) => githubContext(expr)?.en;
  const ja = (expr: string) => githubContext(expr)?.ja;

  it('describes the payload fields of each event', () => {
    const table: [string, RegExp][] = [
      ['github.event.pull_request.title', /^the title of the pull request/],
      ['github.event.pull_request.body', /description of the pull request/],
      ['github.event.pull_request.html_url', /URL of the pull request/],
      ['github.event.pull_request.state', /`open` or `closed`/],
      ['github.event.pull_request.draft', /is a draft/],
      ['github.event.pull_request.merged', /has been merged/],
      ['github.event.pull_request.head.ref', /head branch/],
      ['github.event.pull_request.head.repo.full_name', /fork/],
      ['github.event.pull_request.base.ref', /target/],
      ['github.event.pull_request.base.sha', /target branch's head commit/],
      ['github.event.pull_request.user.login', /opened the pull request/],
      ['github.event.pull_request.labels', /list of labels/],
      ['github.event.pull_request.labels.*.name', /names of all labels/],
      ['github.event.number', /number of the pull request or issue/],
      ['github.event.action', /activity of the event/],
      ['github.event.issue.title', /`issues`, `issue_comment`/],
      ['github.event.issue.body', /issue or pull request/],
      ['github.event.issue.number', /number of the issue/],
      ['github.event.issue.user.login', /opened the issue/],
      ['github.event.issue.labels', /labels on the issue/],
      ['github.event.issue.labels.*.name', /names of all labels on the issue/],
      ['github.event.comment.body', /text of the comment/],
      ['github.event.comment.user.login', /wrote the comment/],
      ['github.event.before', /before the push/],
      ['github.event.after', /after the push/],
      ['github.event.ref', /full ref that was pushed/],
      ['github.event.forced', /force push/],
      ['github.event.head_commit.message', /message of the head commit/],
      ['github.event.head_commit.id', /SHA of the head commit/],
      ['github.event.head_commit.author.name', /anyone can choose/],
      ['github.event.commits', /commits in the push/],
      ['github.event.pusher.name', /who pushed/],
      ['github.event.release.tag_name', /tag name of the release/],
      ['github.event.release.name', /name of the release/],
      ['github.event.release.body', /description text of the release/],
      ['github.event.release.prerelease', /pre-release/],
      ['github.event.release.draft', /release is a draft/],
      ['github.event.workflow_run.conclusion', /result of the workflow run/],
      ['github.event.workflow_run.head_branch', /branch of the run/],
      ['github.event.workflow_run.head_sha', /SHA of the commit of the run/],
      ['github.event.workflow_run.id', /ID of the run/],
      ['github.event.schedule', /cron expression/],
      ['github.event.repository.full_name', /owner\/repository/],
      ['github.event.repository.name', /without the owner/],
      ['github.event.repository.default_branch', /default branch/],
      ['github.event.repository.html_url', /URL of the repository/],
      ['github.event.sender.login', /caused the event/],
      ['github.event', /whole webhook payload/],
      ['github.event.inputs.env', /the input `env`/],
      ['github.event.pull_request.head.sha', /SHA of the head commit of the pull request/],
    ];
    for (const [expr, re] of table) {
      assert.match(en(expr) ?? '', re, expr);
      assert.ok(ja(expr), expr);
    }
  });

  it('names the event of an unlisted payload field', () => {
    assert.match(en('github.event.pull_request.merge_commit_sha')!, /payload of the `pull_request` event/);
    assert.match(en('github.event.release.assets')!, /payload of the `release` event/);
    assert.match(en('github.event.x.y')!, /payload of the event that triggered the workflow/);
    assert.match(ja('github.event.x.y')!, /ペイロードの項目/);
    assert.strictEqual(githubContext('github.event.'), undefined);
  });

  it('describes the other contexts', () => {
    const table: [string, RegExp][] = [
      ['needs.build.outputs.tag', /output `tag` of the job `build`/],
      ['needs.build.result', /result of the job `build`/],
      ['steps.s1.outputs.v', /output `v` of the step with ID `s1`/],
      ['steps.s1.outcome', /result of the step/],
      ['steps.s1.conclusion', /result of the step/],
      ['env.X', /environment variable `X`/],
      ['vars.X', /configuration variable `X`/],
      ['inputs.X', /input `X`/],
      ['runner.os', /runner's OS/],
      ['runner.arch', /CPU architecture/],
      ['runner.temp', /temporary directory/],
      ['runner.tool_cache', /tool cache/],
      ['runner.name', /name of the runner/],
      ['job.status', /status of the job/],
      ['job.container.id', /job's container/],
      ['job.services', /service containers/],
      ['strategy.job-index', /from 0/],
      ['strategy.job-total', /number of jobs/],
      ['strategy.fail-fast', /fail-fast/],
      ['github.token', /token issued/],
      ['github.workflow', /name of the workflow/],
      ['github.workflow_ref', /reference of the workflow file/],
      ['github.triggering_actor', /re-ran it/],
      ['github.ref_type', /`branch` or `tag`/],
      ['github.event_path', /holding the triggering event/],
      ['github.action_path', /directory of the running action/],
      ['github.ref_protected', /protected/],
    ];
    for (const [expr, re] of table) {
      assert.match(en(expr) ?? '', re, expr);
      assert.ok(ja(expr), expr);
    }
  });

  it('shows the description in the note and on the token', () => {
    const ex = explainSrc(wf('github.event.pull_request.number', 'github.event.x.y'));
    assert.ok(ex.notes.some((n) => /^`\$\{\{ github\.event\.pull_request\.number \}\}` is the GitHub Actions expression .*: the pull request number; replaced/.test(n)), ex.notes.join('\n'));
    assert.ok(ex.notes.some((n) => /webhook payload of the event that triggered the workflow/.test(n)));
    assert.ok(allTokens(ex.items).some((t) => t.label === '${{ github.event.pull_request.number }}' && /the pull request number/.test(t.explanation)));
  });

  it('warns about the user-controlled fields, in English and Japanese', () => {
    const risky = [
      'github.event.pull_request.title', 'github.event.pull_request.body', 'github.event.pull_request.head.ref',
      'github.event.pull_request.labels.*.name', 'github.event.issue.title', 'github.event.issue.body',
      'github.event.issue.labels.*.name', 'github.event.comment.body', 'github.event.release.name', 'github.event.release.body',
      'github.event.head_commit.message', 'github.event.head_commit.author.name', 'github.event.head_commit.committer.email',
      'github.event.commits.*.message', 'github.event.commits[0].author.name', 'github.event.commits.0.committer.name',
      'github.event.workflow_run.head_branch', 'github.event.workflow_run.head_commit.committer.name', 'github.head_ref',
    ];
    const safe = ['github.event.pull_request.number', 'github.event.pull_request.head.sha', 'github.event.pull_request.user.login', 'github.event.release.tag_name', 'github.event.inputs.x', 'github.sha'];
    for (const expr of risky) {
      assert.match(explainSrc(wf(expr)).notes[0], /^⚠ Script injection risk/, expr);
      assert.match(explainSrc(wf(expr), 'ja').notes[0], /^⚠ スクリプトインジェクションの危険/, expr);
    }
    for (const expr of safe) assert.ok(!explainSrc(wf(expr)).notes.some((n) => /injection/.test(n)), expr);
  });
});

describe('Python', () => {
  it('explains a shell=True string as a /bin/sh script', () => {
    const ex = explain('deploy.py', 6)!;
    assert.strictEqual(ex.context[0].label, 'Python `sp.run` (a string the shell (/bin/sh) runs)');
    assert.ok(labels('deploy.py', 6).includes('tar@8'));
    assert.ok(labels('deploy.py', 9).includes('ls@11'), 'os.system');
  });
  it('explains a list as arguments run without a shell', () => {
    assert.match(explain('deploy.py', 7)!.notes[0], /run directly, without a shell/);
    assert.ok(labels('deploy.py', 7).includes('"--oneline"@19'));
    const ssh = allTokens(explain('deploy.py', 18)!.items);
    assert.match(ssh.find((t) => t.label === 'host')!.explanation, /The value of the Python expression `host`/);
  });
  it('warns about f-strings with shell=True and strings without it', () => {
    assert.match(explain('deploy.py', 8)!.notes[0], /^⚠ Shell injection risk/);
    assert.match(explain('deploy.py', 10)!.notes[0], /^ⓧ Without shell=True the whole string is taken as one program name/);
  });
  it('joins adjacent literals across lines, and skips comments and other strings', () => {
    assert.ok(labels('deploy.py', 12).includes('wc@10'));
    assert.ok(!allTokens(explain('deploy.py', 12)!.items).some((t) => t.kind === 'error'));
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
  return explainHostedLine(new Analyzer('en'), tree, extracted, src.split('\n'), line, 'en');
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
    const ex = explainHostedLine(new Analyzer('en'), tree, extracted, src.split('\n'), line, 'en');
    return ex ? [...ex.context.map((c) => c.label), ...ex.notes, ...allTokens(ex.items).map((t) => `${t.label}: ${t.explanation}`)].join('\n') : '';
  };
  it('Makefile: SHELL, and one-letter make variables', () => {
    assert.match(text('Makefile', 'SHELL := /bin/bash\nall:\n\techo $O\n', 2), /the make variable `O`, expanded by make before the shell runs/);
    const ex = extractShell('makefile', 'SHELL := /bin/zsh\nall:\n\techo hi\n');
    assert.strictEqual(ex.regions[0].shell, 'zsh');
  });
  it('YAML: a script: list of commands', () => {
    const src = 'build:\n  script:\n    - make\n    - |\n      echo done\n';
    assert.match(text('.gitlab-ci.yml', src, 2), /YAML `script:`/);
    assert.match(text('.gitlab-ci.yml', src, 4), /echo: Print arguments/);
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

describe('the shell of a Markdown code block', () => {
  const code = '[[ -n $name ]] && echo -e "hi\\t$name"';
  const codes = (fence: string, first?: string, forced?: 'sh') => {
    const src = ['# T', '', '```' + fence, ...(first ? [first] : []), code, '```', ''].join('\n');
    const extracted = extractShell('markdown', src);
    return hostIssues(parser.parse(extracted.text), extracted, src.split('\n'), 'en', forced).map((i) => i.code).sort();
  };
  it('reads sh as bash, unless a shebang says otherwise', () => {
    assert.deepStrictEqual(codes('sh'), []);
    assert.deepStrictEqual(codes('shell'), []);
    assert.deepStrictEqual(codes('sh', '#!/bin/bash'), []);
    assert.deepStrictEqual(codes('sh', '#!/bin/sh').length > 0, true);
    assert.deepStrictEqual(codes('sh', '# shellcheck shell=dash').length > 0, true);
  });
  it('lets the shebang win over a tag that names a shell', () => {
    assert.deepStrictEqual(codes('bash', '#!/bin/sh').length > 0, true);
    assert.deepStrictEqual(codes('zsh', '#!/bin/bash'), []);
    assert.deepStrictEqual(codes('bash', '#!/usr/bin/python3'), []);
  });
  it('keeps the shell a tag names', () => {
    for (const f of ['dash', 'posix', 'ksh', 'zsh']) {
      const want = { dash: 'dash', posix: 'sh', ksh: 'ksh', zsh: 'zsh' }[f];
      assert.strictEqual(extractShell('markdown', '```' + f + '\n' + code + '\n```\n').regions[0].shell, want, f);
    }
    assert.deepStrictEqual(codes('bash'), []);
  });
  it('lets an explicit shell win', () => {
    assert.ok(codes('sh', '#!/bin/bash', 'sh').length > 0);
    assert.ok(codes('sh', undefined, 'sh').length > 0);
  });
});

describe('bats', () => {
  /** The explanation of a line (1-based) of a bats file given as its lines. */
  const bats = (lines: string[], line: number, lang: 'ja' | 'en' = 'en', opts: { pitfalls?: boolean } = {}) => {
    const src = lines.join('\n');
    const extracted = extractShell('bats', src);
    return explainHostedLine(new Analyzer(lang), parser.parse(extracted.text), extracted, lines, line - 1, lang, undefined, opts)!;
  };
  const ids = (ex: { facts?: { id: string }[] }) => (ex.facts ?? []).map((f) => f.id).filter((id) => id.startsWith('bats-'));

  it('recognises a .bats file, the language id bats, and a bats shebang', () => {
    assert.strictEqual(hostKind('plaintext', '/t/test.bats'), 'bats');
    assert.strictEqual(hostKind('bats', 'x'), 'bats');
    assert.strictEqual(hostKind('', 'x', '#!/usr/bin/env bats\n@test "a" { :; }'), 'bats');
    assert.strictEqual(hostKind('shellscript', 'x', '#!/opt/bats/bin/bats --tap\n'), 'bats');
    assert.strictEqual(hostKind('', 'x', '#!/opt/bats/bin/bash\n'), undefined);
    assert.strictEqual(hostKind('', 'x', '#!/bin/sh\n# bats'), undefined);
  });

  it('rewrites @test into the function bats makes of it, column for column', () => {
    const e = extractShell('bats', ['@test "a b-c_d" {', '  true', '}', "  @test 'x.y' { }", '@test x {echo'].join('\n'));
    assert.deepStrictEqual(e.text.split('\n'), ['test_a_b-2dc-5fd() {', '  true', '}', '  test_x-2ey() { :; }', 'test_x() {echo']);
    // A `{` in the body does not end the test's name.
    assert.strictEqual(bats(['@test "a" { echo a{b,c}', '}'], 1).items[0].label, '@test "a" { ‹commands› }');
    // bats reads `@test "a" { echo {x}` as the test `a" { echo` with the body `x}`, which is not a function to bash.
    assert.strictEqual(extractShell('bats', '@test "a" { echo {x}\n}').text, 'test_a-22_-7b_echo() {x}\n}');
    assert.deepStrictEqual(ids(bats(['@test "a" { echo {x}', '}'], 1)), ['bats-test']);
    assert.deepStrictEqual(e.regions.map((r) => [r.start, r.end, r.label[1], r.tests]), [[0, 4, 'bats test file', [0, 3, 4]]]);
    // The function's name stands for `@test "a b-c_d"`.
    assert.strictEqual(e.maps[0][0], 0);
    assert.strictEqual(e.maps[0]['test_a_b-2dc-5fd()'.length], '@test "a b-c_d"'.length);
    assert.strictEqual(e.maps[3][2], 2);
  });

  it('names a test as bats does in a UTF-8 locale', () => {
    assert.strictEqual(batsTestName('café ü'), 'test_café_ü');
    assert.strictEqual(batsTestName('a_b-c.d→e'), 'test_a-5fb-2dc-2ed-2192e');
  });

  it('counts a rewritten line as a test only where bash reads a function: not in a here-document or a string', () => {
    const doc = ['@test "heredoc" {', '  cat <<EOF >/dev/null', '@test "inner" {', 'EOF', '}', "x='", '@test "in string" {', "'"];
    assert.deepStrictEqual(extractShell('bats', doc.join('\n')).regions[0].tests, [0, 2, 6]);
    assert.deepStrictEqual(ids(bats(doc, 1)), ['bats-test']);
    for (const line of [2, 3, 4, 6, 7, 8]) {
      const ex = bats(doc, line);
      assert.deepStrictEqual(ids(ex), [], `line ${line}`);
      assert.ok(!ex.summary.startsWith('bats test'), `line ${line}: ${ex.summary}`);
    }
    assert.deepStrictEqual(bats(doc, 3).context.map((c) => c.label), ['bats test file', '@test "heredoc"', '{ } group']);
    // A line that still holds the CR of a CRLF (split at LF only).
    const crlf = '@test "a" {\r\n  true\r\n}\r\n';
    const e = extractShell('bats', crlf);
    const ex = explainHostedLine(new Analyzer('en'), parser.parse(e.text), e, crlf.split('\n'), 0, 'en')!;
    assert.strictEqual(ex.items[0].label, '@test "a" { ‹commands› }');
  });

  it('explains a test as one, and says how bats runs it', () => {
    const ex = explain('test.bats', 9)!;
    assert.match(ex.summary, /^bats test: bats rewrites it into the function `test_addition_works`, which it calls to run the test \(lines 9–13\)$/);
    const def = ex.items[0];
    assert.strictEqual(def.label, '@test "addition works" { ‹commands› }');
    assert.strictEqual(def.labelParts![0].text.startsWith('@test "addition works"'), true);
    assert.deepStrictEqual(labels('test.bats', 9).slice(0, 2), ['@test "addition works" { ‹commands› }@0', '@test "addition works"@0']);
    assert.match(def.children[0].explanation, /function name `test_addition_works`/);
    assert.deepStrictEqual(ids(ex), ['bats-test']);
    assert.match(ex.notes[0], /^ℹ bats runs each test in a process of its own, with `set -e` on/);
    // Inside, the context is the test as written, not the function bash sees.
    assert.deepStrictEqual(explain('test.bats', 10)!.context.map((c) => c.label), ['bats test file', '@test "addition works"', '{ } group']);
    assert.deepStrictEqual(explain('test.bats', 5)!.context.map((c) => c.label), ['bats test file', 'function `setup`', '{ } group']);
    // A test on one line has no line range.
    assert.strictEqual(explain('test.bats', 26)!.summary, 'bats test: bats rewrites it into the function `test_empty`, which it calls to run the test');
    assert.match(explain('test.bats', 9, 'ja')!.summary, /^bats のテスト: bats はこれを関数 `test_addition_works` に書き換えて/);
    assert.strictEqual(allTokens(explain('test.bats', 9, 'ja')!.items)[1].explanation, 'テストの名前: bats はこの名前から関数名 `test_addition_works` を作る');
  });

  it('explains the tag comments: bash ignores them, bats reads them (ja and en)', () => {
    const doc = ['# bats file_tags=a, bats:focus', '# bats test_tags=', '#bats   test_tags=x,y', '@test "t" {', '  :', '}', '  # bats file_tags=', '# bats file_tags=,x', '# bats color=red'];
    const text = (line: number, lang: 'ja' | 'en' = 'en') => bats(doc, line, lang).notes.join('\n');
    assert.match(text(1), /^ℹ to bash this is a comment, and it is ignored\. bats reads the line and gives every later test of the file the tags `a`, `bats:focus` \(a later `# bats file_tags=` replaces them\); `bats --filter-tags TAGS` runs only the tests with the tags given\. When a test has `bats:focus`, bats runs only the focused tests, and exits with status 1/);
    assert.match(text(2), /gives the next test no tags \(an empty list\) \(it cancels an earlier `test_tags` before the same test\)$/);
    assert.match(text(3), /gives the next test only the tags `x`, `y` \(a later `# bats test_tags=` line before the same test replaces them; the tests after it do not get them\); `bats --filter-tags/);
    assert.match(text(7), /gives every later test of the file no tags \(an empty list\) \(it cancels an earlier `file_tags`\)$/);
    assert.match(text(8), /^ⓧ Error: The `file_tags` list is not valid, so bats runs none of the tests of this file and fails\..*A leading comma, or a list of only spaces, makes an empty tag \(for no tags, nothing follows the `=`\)$/);
    assert.match(text(1, 'ja'), /^ℹ bash にとってはコメントで、無視される。bats がこの行を読み、このファイルのこれ以降のすべてのテストにタグ `a`, `bats:focus` を付ける/);
    assert.match(text(3, 'ja'), /次のテストだけにタグ `x`, `y` を付ける（同じテストの前にあとの `# bats test_tags=` の行があると、そちらが置き換える。そのあとのテストには付かない）/);
    assert.match(text(8, 'ja'), /^ⓧ エラー: `file_tags` の書き方が正しくない/);
    // The comment token says it too (and the line's summary, when the comment is all of it); other comments are plain.
    assert.strictEqual(bats(doc, 1).summary, 'bats directive: bash ignores the comment, bats reads it and tags every later test');
    assert.strictEqual(bats(doc, 3, 'ja').summary, 'bats への指示コメント: bash は無視するが、bats が読んで次のテストだけにタグを付ける');
    assert.strictEqual(bats(doc, 7).items[0].explanation, 'bats directive: bash ignores the comment, bats reads it and tags every later test');
    assert.strictEqual(bats(doc, 9).summary, 'Comment: everything after `#` is ignored');
    assert.deepStrictEqual(ids(bats(doc, 9)), []);
    // (A tag command after code is no tag command: bats reads only lines that start with the comment.)
    assert.deepStrictEqual(bats(['echo x # bats test_tags=a'], 1).facts?.map((f) => f.id), undefined);
  });

  it('explains a function marked `# @test` as a test, renamed as bats renames it (ja and en)', () => {
    const doc = ['my-test() { # @test', '  true', '}', 'function other {   #   @test', '  true', '}', 'plain() { # @test later', '}'];
    assert.deepStrictEqual(extractShell('bats', doc.join('\n')).regions[0].tests, [0, 3]);
    const en = bats(doc, 1);
    assert.strictEqual(en.summary, `bats test: because of the comment \`# @test\`, bats runs this function as a test. It renames the function \`${batsTestName('my-test')}\`, so it can no longer be called as \`my-test\` (lines 1–3)`);
    assert.deepStrictEqual(ids(en), ['bats-test']);
    assert.deepStrictEqual(allTokens(en.items).filter((t) => t.kind === 'comment').map((t) => t.explanation), ['bats directive: bash ignores the comment, bats registers the function before it as a test']);
    assert.deepStrictEqual(en.items[0].label, 'my-test() { ‹commands› }');
    assert.match(allTokens(en.items)[1].explanation, /^The name bats gives the function of the test/);
    assert.deepStrictEqual(bats(doc, 2).context.map((c) => c.label), ['bats test file', 'my-test()', '{ } group']);
    assert.match(bats(doc, 4, 'ja').summary, /^bats のテスト: コメント `# @test` があるので、bats はこの関数をテストとして実行する。関数は `test_other` に改名されるので、`other` では呼べない（行 4〜6）$/);
    assert.deepStrictEqual(bats(doc, 4).items[0].label, 'function other { ‹commands› }');
    // Not a test: the comment has text after it. It is a plain function, and its comment a plain comment.
    assert.deepStrictEqual(ids(bats(doc, 7)), []);
    assert.match(bats(doc, 7).summary, /^Defines function `plain`/);
    // (A line split at LF only keeps its CR.)
    const crlf = ['f() { # @test\r', '  true\r', '}\r'];
    assert.deepStrictEqual(ids(explainHostedLine(new Analyzer('en'), parser.parse(extractShell('bats', crlf.join('\n')).text), extractShell('bats', crlf.join('\n')), crlf, 0, 'en')!), ['bats-test']);
  });

  it('explains the functions of bats-support, bats-assert and bats-file only where the file can have the library', () => {
    const body = (load: string[], cmd: string, lang: 'ja' | 'en' = 'en') => allTokens(bats([...load, '@test "a" {', `  ${cmd}`, '}'], load.length + 2, lang).items);
    const first = (load: string[], cmd: string) => body(load, cmd)[0].explanation;
    const ext = /^Run the external command/;
    // Each library, with the option forms.
    const lib = ['load test_helper/bats-assert/load'];
    const opts = (cmd: string) => body(lib, cmd).filter((t) => t.kind === 'option').map((t) => `${t.label}: ${t.explanation.slice(0, 16)}`);
    assert.match(first(lib, 'assert_output "x"'), /^bats-assert function: checks that `\$output` \(what `run` kept\) matches the text given; with no argument, it checks that it is not empty; the argument `-` reads the text from stdin; if it does not hold, it prints a report to stderr and returns 1, which fails the test/);
    assert.match(first(lib, 'refute_output'), /does not match the text given; with no argument, it checks that it is empty/);
    assert.deepStrictEqual(opts('assert_output -p x'), ['-p: the text only ha']);
    assert.deepStrictEqual(opts('assert_output --regexp x'), ['--regexp: match with the t']);
    assert.deepStrictEqual(opts('refute_output --partial -'), ['--partial: the text only ha']);
    assert.deepStrictEqual(opts('assert_output --stdin <<< x'), ['--stdin: read the text fr']);
    assert.deepStrictEqual(opts('assert_output -- -p'), ['--: End of options: ']);
    assert.match(first(lib, 'assert_line --index 1 x'), /a line of `\$lines` \(the output split into lines by `run`; empty lines are left out/);
    assert.deepStrictEqual(opts('assert_line -n 1 -e x'), ['-n: the number of th', '-e: match with the t']);
    assert.match(first(lib, 'refute_line --partial x'), /no line of `\$lines`/);
    assert.match(first(lib, 'assert_stderr_line x'), /`\$stderr_lines` .*needs `run --separate-stderr`/);
    assert.match(first(lib, 'refute_stderr x'), /does not match/);
    assert.match(first(lib, 'assert_stderr'), /`\$stderr` \(the stderr that `run --separate-stderr` kept/);
    assert.match(first(lib, 'assert_success'), /checks that `\$status` \(the exit status `run` kept\) is 0/);
    assert.match(first(lib, 'assert_failure 2'), /with a status given, that it equals it/);
    assert.match(body(lib, 'assert_failure 2')[1].explanation, /^the exit status expected/);
    assert.match(first(lib, 'assert_equal a b'), /^bats-assert function: checks that the two values are equal/);
    assert.match(first(lib, 'assert_not_equal a b'), /not equal/);
    assert.match(first(lib, 'assert [ -f x ]'), /fails the test if it is false/);
    assert.match(first(lib, 'refute true'), /fails the test if it is true/);
    assert.match(first(lib, 'assert_regex a b'), /sets `BASH_REMATCH`/);
    assert.match(first(lib, 'refute_regex a b'), /the opposite of `assert_regex`/);
    assert.match(body(lib, 'assert_output x', 'ja')[0].explanation, /^bats-assert の関数: `\$output`/);
    // bats-support and bats-file.
    const support = ['bats_load_library bats-support'];
    assert.match(first(support, 'fail "boo"'), /^bats-support function: prints the message .* always fails \(returns 1\)/);
    assert.match(first(support, 'batslib_is_caller --indirect setup'), /^bats-support function: looks at the call stack/);
    assert.strictEqual(body(support, 'batslib_is_caller --indirect setup')[1].kind, 'option');
    assert.match(first(support, 'batslib_decorate ERROR'), /^bats-support function: wraps the message/);
    const file = ["load '../bats-file/load'"];
    assert.match(first(file, 'assert_file_exists "$f"'), /^bats-file function: checks that a regular file exists at the path/);
    assert.match(first(file, 'assert_dir_not_exists "$f"'), /a directory does not exist at the path/);
    assert.match(first(file, 'assert_not_exists "$f"'), /a file or a directory does not exist/);
    assert.match(first(file, 'assert_file_contains f x egrep'), /matches the regular expression/);
    assert.match(first(file, 'assert_file_not_contains f x'), /does not match the regular expression/);
    assert.match(first(file, 'assert_file_empty f'), /is empty \(the report shows its content\)/);
    assert.match(first(file, 'assert_file_permission 755 f'), /has the permission given/);
    assert.match(first(file, 'assert_symlink_to t l'), /pointing to the target/);
    assert.match(first(file, 'assert_files_equal a b'), /the same content/);
    assert.match(first(file, 'assert_file_size_equals f 3'), /number of bytes/);
    assert.match(first(file, 'assert_sticky_bit d'), /sticky bit is set/);
    assert.match(first(file, 'assert_file_owner root f'), /owns the file/);
    assert.match(first(file, 'temp_del "$d"'), /^bats-file function: deletes a file or directory/);
    const make = body(file, 'd=$(temp_make -p x)');
    assert.deepStrictEqual(make.filter((t) => t.label === 'temp_make' || t.label === '-p').map((t) => t.kind), ['command', 'option']);
    assert.match(make.find((t) => t.label === 'temp_make')!.explanation, /^bats-file function: makes a temporary directory in `\$BATS_TMPDIR`/);
    // Only the library that is loaded: bats-assert alone does not give bats-file's functions.
    assert.match(first(lib, 'assert_file_exists f'), ext);
    assert.match(first(file, 'assert_output x'), ext);
    assert.match(first(support, 'assert_equal a b'), ext);
    // Without a load, none; with a load of something else, which may load them, all; a load in other places of a line.
    assert.match(first([], 'assert_output x'), ext);
    assert.match(first(['x=1'], 'fail x'), ext);
    for (const other of ["load 'test_helper/common-setup'", 'load helper; true', 'true && bats_load_library my-lib', '{ load helper; }', '(load helper)']) {
      assert.match(first([other], 'assert_output x'), /^bats-assert function/, other);
      assert.match(first([other], 'assert_file_exists f'), /^bats-file function/, other);
    }
    for (const named of ['load "bats-assert/load"', 'load bats-assert', 'load /usr/lib/bats-assert/load.bash', 'load test_helper/bats-support/load ; load x/bats-assert/load']) {
      assert.match(first([named], 'assert_output x'), /^bats-assert function/, named);
    }
    assert.match(first(['load test_helper/bats-support/load'], 'assert_output x'), ext);
    assert.match(first(['load test_helper/bats-support/load'], 'fail x'), /^bats-support function/);
    // A load in a comment is not one.
    assert.match(first(['# load helper'], 'assert_output x'), ext);
    // In a shell script (not a bats file), they are ordinary commands.
    const plain = new Analyzer('en').explainLine(parser.parse("load 'bats-assert/load'\nassert_output x"), 1);
    assert.match(plain.items[0].explanation, ext);
    // A function of the file with the same name stays the file's own.
    const own = ['load bats-assert/load', 'assert_output() { :; }', 'fail() { :; }', '@test "a" {', '  assert_output x', '  fail y', '}'];
    for (const line of [5, 6]) {
      assert.match(bats(own, line).items[0].explanation, /function/i);
      assert.doesNotMatch(bats(own, line).items[0].explanation, /^bats-/);
    }
  });

  it('reads run, load, skip and the other functions of bats with their specs', () => {
    const tokens = (line: number) => allTokens(explain('test.bats', line)!.items).map((t) => `${t.kind} ${t.label}: ${t.explanation.slice(0, 40)}`);
    assert.deepStrictEqual(tokens(16).slice(0, 3), [
      'command run: bats function: runs a command in a subsh',
      'option !: fail, and so fail the test, unless the c',
      'command cat: runs `cat`: Concatenate files and print ',
    ]);
    assert.match(tokens(17)[1], /^option -1: fail, and so fail the test, unless the /);
    assert.match(tokens(18)[1], /^option --separate-stderr: keep stderr out of `\$output`/);
    assert.match(tokens(5)[0], /^command load: bats function: reads the file/);
    assert.match(tokens(6)[0], /^command bats_require_minimum_version: bats function/);
    assert.match(tokens(29)[0], /^command skip: bats function: skips the rest/);
    // An option run does not know is an error; the options need bats 1.5.0.
    const unknown = allTokens(bats(['@test "a" {', '  run -x true', '}'], 2).items);
    assert.strictEqual(unknown[1].explanation, 'an option `run` does not know: bats says "unknown flag", and `run` fails');
    assert.match(unknown[0].explanation, /bats warns \(BW02\) unless `bats_require_minimum_version 1\.5\.0` comes first/);
    assert.match(allTokens(explain('test.bats', 5)!.items)[0].explanation, /at the top of the file this stops the whole test file; in `setup` or a test, only that test fails/);
    // A string run runs through bash -c is read in the new shell, which gets only what is exported.
    const nested = ['f() { :; }', 'x=1', '@test "a" {', "  run bash -c 'echo $x; f'", "  run eval 'f'", '}'];
    const viaBash = bats(nested, 4);
    assert.match(viaBash.notes.join('\n'), /`x` is a variable of this script that is not exported/);
    assert.match(viaBash.notes.join('\n'), /`bash -c` runs the command in a new shell, which does not have this script's function `f`/);
    assert.deepStrictEqual(allTokens(viaBash.items).filter((t) => t.label === 'f').map((t) => t.kind), ['command']);
    // (`run eval S`: the walk of the model does not know bats' run yet, so S stays one word: docs/design/bats.md.)
    assert.deepStrictEqual(allTokens(bats(nested, 5).items).map((t) => t.label), ['run', 'eval', "'f'"]);
    // run runs bats_pipe, whose words are not a command to the shell.
    assert.deepStrictEqual(tokens(22).slice(0, 3).map((t) => t.split(':')[0]), ['command run', 'command bats_pipe', 'argument printf']);
    // Outside a bats file, the names are ordinary commands.
    const plain = new Analyzer('en').explainLine(parser.parse('run ! true'), 0);
    assert.match(plain.items[0].explanation, /^Run the external command `run`/);
    // A function of the file wins over bats' own.
    assert.match(bats(['run() { :; }', '@test "a" {', '  run x', '}'], 3).items[0].explanation, /function/i);
  });

  it('warns about a `! cmd` that is not the last command of a test', () => {
    assert.deepStrictEqual(ids(explain('test.bats', 20)!), ['bats-negation-ignored']);
    assert.match(explain('test.bats', 20)!.notes.join('\n'), /Error: `set -e` ignores the status of a command after `!`, so unless it is the last command of the test, `! grep -q x \/dev\/null` does not fail the test/);
    // The last command of a test, a `!` in a condition or outside a test: no warning.
    assert.deepStrictEqual(ids(explain('test.bats', 30)!), []);
    const src = ['setup() {', '  ! true', '  :', '}', '@test "a" {', '  # c', '  if ! true; then :; fi', '  ! true && :', '  ! { true; } >/dev/null', '  :', '}'];
    for (const line of [2, 7, 8]) assert.deepStrictEqual(ids(bats(src, line)), [], `line ${line}`);
    assert.deepStrictEqual(ids(bats(src, 9)), ['bats-negation-ignored']);
    // (It fails every time: an error, said with the pitfalls off too.)
    assert.deepStrictEqual(ids(bats(src, 9, 'en', { pitfalls: false })), ['bats-negation-ignored']);
    // A long command is shortened.
    assert.match(bats(['@test "a" {', '  ! grep -q some-long-pattern /some/long/path/to/a/file', '  :', '}'], 2).notes.join('\n'), /`! grep -q some-long-pattern \/so…` does not fail/);
    assert.match(bats(src, 9, 'ja').notes.join('\n'), /エラー: `set -e` は `!` のあとのコマンドの結果を無視するので/);
    // The fix depends on what follows `!`: run takes one command; a pipeline needs bats_pipe; a group, `|| false`.
    const forms = ['@test "a" {', '  ! true', '  ! echo x | grep -q x', '  ! { true; }', '  ! x=1', '  :', '}'];
    assert.match(bats(forms, 2).notes.join('\n'), /Write `run ! true` \(since bats 1\.5\.0, with `bats_require_minimum_version 1\.5\.0`\) or `! true \|\| false`$/);
    assert.match(bats(forms, 3).notes.join('\n'), /Write `! echo x \| grep -q x \|\| false`, or run the pipeline with `run ! bats_pipe …`, each `\|` written `\\\|` \(since bats 1\.10\.0\)$/);
    assert.match(bats(forms, 4).notes.join('\n'), /Write `! \{ true; \} \|\| false`$/);
    // (`run ! x=1` would run a command named `x=1`.)
    assert.match(bats(forms, 5).notes.join('\n'), /Write `! x=1 \|\| false`$/);
    for (const line of [2, 3, 4, 5]) assert.match(bats(forms, line, 'ja').notes.join('\n'), /^ⓧ エラー: `set -e` は/);
  });

  it("reads bats' functions by their specs for the conditions it decides", () => {
    const decided = (lines: string[], line: number) => (bats(lines, line).facts ?? []).map((f) => f.id).filter((id) => id.startsWith('condition-'));
    const cond = 'if [ "$x" = 1 ]; then echo x; fi';
    // `load` may set `x` (a file the model does not read); `run` sets `$status`, `$output`, `$lines` (and may set `$stderr`).
    assert.deepStrictEqual(decided(['x=1', 'load helper', cond], 3), []);
    assert.deepStrictEqual(decided(['x=1', 'bats_load_library lib', cond], 3), []);
    // `bats_pipe` evals its pipeline here: with lastpipe, `read x` sets `x` (test/bats-real.test.ts).
    assert.deepStrictEqual(decided(['x=1', 'bats_pipe echo 2 \\| read x', cond], 3), []);
    for (const v of ['status', 'output', 'lines', 'stderr', 'BATS_RUN_COMMAND']) assert.deepStrictEqual(decided([`${v}=0`, 'run false', `if [ "$${v}" = 0 ]; then :; fi`], 3), [], v);
    // `run bash -c 'x=2'` runs in a subshell, and `skip` sets nothing (test/bats-real.test.ts, against bats).
    assert.deepStrictEqual(decided(['x=1', "run bash -c 'x=2'", cond], 3), ['condition-always-true']);
    assert.deepStrictEqual(decided(['x=1', '@test "a" {', '  skip', '}', cond], 5), ['condition-always-true']);
    // (`command run` runs no function, so not bats' run.)
    assert.deepStrictEqual(decided(['status=0', 'command run false', 'if [ "$status" = 0 ]; then :; fi'], 3), ['condition-always-true']);
    // Without them, or when the file defines its own `run`, conditions are decided as in any script.
    assert.deepStrictEqual(decided(['x=1', cond], 2), ['condition-always-true']);
    assert.deepStrictEqual(decided(['run() { :; }', 'x=1', 'run', cond], 4), ['condition-always-true']);
    // In a shell script, `load` and `run` are programs, which cannot set the script's variables.
    const plain = new Analyzer('en').explainLine(parser.parse(['x=1', 'load helper', cond].join('\n')), 2);
    assert.deepStrictEqual((plain.facts ?? []).map((f) => f.id), ['condition-always-true']);
  });

  it('warns about `run cmd | …`', () => {
    assert.deepStrictEqual(ids(explain('test.bats', 21)!), ['bats-run-in-pipeline']);
    assert.match(explain('test.bats', 21)!.notes.join('\n'), /Error: the pipe gets the output of `run`, but `run` writes nothing: it keeps the output of `printf 'a\\nb\\n'` in `\$output`/);
    const src = ['@test "a" {', '  run -- ! true 2>&1 | cat', '  run | cat', '  (run x) | cat', '  echo | run cat', '  run ! -1 cat 2>&1 | cat', '  >f | cat', '}'];
    assert.match(bats(src, 2).notes.join('\n'), /output of `! true`/);
    for (const line of [3, 4, 7]) assert.deepStrictEqual(ids(bats(src, line)), [], `line ${line}`);
    assert.deepStrictEqual(ids(bats(src, 5)), ['bats-run-in-pipeline-stage']);
    assert.match(bats(src, 6).notes.join('\n'), /output of `cat`/);
    assert.deepStrictEqual(ids(bats(['run() { :; }', 'run x | cat'], 2)), []);
    // run in a later stage: its variables are lost too, unless lastpipe runs the last stage in the shell.
    const later = ['@test "a" {', '  echo hi | run cat', '  echo hi | run cat | cat', '  shopt -s lastpipe', '  echo hi | run cat', '  echo | run', '}'];
    assert.deepStrictEqual(ids(bats(later, 2)), ['bats-run-in-pipeline-stage']);
    assert.match(bats(later, 2).notes.join('\n'), /the `\$status` and `\$output` that `run cat` sets are gone when the pipeline ends/);
    assert.deepStrictEqual(ids(bats(later, 3)), ['bats-run-in-pipeline-stage']);
    assert.deepStrictEqual(ids(bats(later, 5)), []);
    assert.deepStrictEqual(ids(bats(later, 6)), []);
    assert.match(bats(later, 2, 'ja').notes.join('\n'), /パイプラインが終わると消えます/);
  });
});

describe('one mapping from a program name to a shell (hosts)', () => {
  const regionShells = (kind: Parameters<typeof extractShell>[0], src: string) => extractShell(kind, src).regions.map((r) => r.shell);
  it('Dockerfile: SHELL and RUN in exec form agree', () => {
    assert.deepStrictEqual(regionShells('dockerfile', 'FROM x\nSHELL ["/bin/dash","-c"]\nRUN echo a\n').slice(1), ['dash']);
    assert.deepStrictEqual(regionShells('dockerfile', 'FROM x\nRUN ["dash","-c","echo a"]\n'), ['dash']);
    assert.deepStrictEqual(regionShells('dockerfile', 'FROM x\nSHELL ["/bin/ksh","-c"]\nRUN echo a\n').slice(1), ['ksh']);
    assert.deepStrictEqual(regionShells('dockerfile', 'FROM x\nSHELL ["/bin/busybox","sh","-c"]\nRUN echo a\n').slice(1), ['ash']);
  });
  it('Makefile SHELL and Python executable name ksh, not sh', () => {
    assert.deepStrictEqual(regionShells('makefile', 'SHELL=/bin/ksh\nall:\n\techo a\n'), ['ksh']);
    assert.deepStrictEqual(regionShells('python', "import subprocess\nsubprocess.run('echo a', shell=True, executable='/bin/ksh')\n"), ['ksh']);
    assert.deepStrictEqual(regionShells('python', "import subprocess\nsubprocess.run('echo a', shell=True, executable='/bin/dash')\n"), ['dash']);
    assert.deepStrictEqual(regionShells('makefile', 'SHELL=/bin/unknownsh\nall:\n\techo a\n'), ['sh']);
  });
  it('`[[ ]]` has no portability note for ksh, and is not available for dash (dash is checked against the real dash)', function () {
    const notes = (src: string, file: string, line: number) => {
      const extracted = extractShell(hostKind('', file)!, src);
      const ex = explainHostedLine(new Analyzer('en'), parser.parse(extracted.text), extracted, src.split('\n'), line, 'en')!;
      return ex.notes;
    };
    assert.deepStrictEqual(notes('SHELL=/bin/ksh\nall:\n\t[[ -n x ]]\n', 'Makefile', 2), []);
    assert.deepStrictEqual(notes('SHELL=/bin/dash\nall:\n\t[[ -n x ]]\n', 'Makefile', 2), ['ⓧ Error: `[[ ]]` is not available in dash. Instead, use `[ ]`.']);
    // posh is a POSIX sh: the note is the POSIX one.
    assert.match(notes('SHELL=/bin/posh\nall:\n\t[[ -n x ]]\n', 'Makefile', 2).join('\n'), /not POSIX sh/);
    const dash = spawnSync('dash', ['-c', '[[ -n x ]]']);
    if (dash.error) this.skip();
    assert.strictEqual(dash.status, 127);
  });
  it('posh, busybox and lksh are shells wherever a shell is named', () => {
    const regionShells2 = (kind: Parameters<typeof extractShell>[0], file: string, src: string) => extractShell(kind, src).regions.map((r) => r.shell);
    assert.deepStrictEqual(regionShells2('dockerfile', 'Dockerfile', 'FROM x\nRUN ["posh","-c","echo a"]\nRUN ["busybox","sh","-c","echo a"]\nRUN ["lksh","-c","echo a"]\nRUN ["pdksh","-c","echo a"]\n'), ['sh', 'ash', 'mksh', 'mksh']);
    // busybox starts a shell only as the applet `sh` or `ash` (applets.c, run_applet_and_exit: the first argument is the applet name; `busybox -c` is "applet not found").
    assert.deepStrictEqual(regionShells2('dockerfile', 'Dockerfile', 'FROM x\nRUN ["busybox","ash","-c","echo a"]\n'), ['ash']);
    assert.deepStrictEqual(regionShells2('dockerfile', 'Dockerfile', 'FROM x\nRUN ["busybox","-c","echo a"]\n'), regionShells2('dockerfile', 'Dockerfile', 'FROM x\nRUN ["myshell","-c","echo a"]\n'));
    assert.deepStrictEqual(regionShells2('dockerfile', 'Dockerfile', 'FROM x\nRUN ["busybox"]\n'), regionShells2('dockerfile', 'Dockerfile', 'FROM x\nRUN ["myshell"]\n'));
    assert.deepStrictEqual(regionShells2('dockerfile', 'Dockerfile', 'FROM x\nRUN ["myshell","-c","echo a"]\n'), ['bash']);
    // GitHub Actions: `shell: posh {0}` is a POSIX sh; the narrow rule (only bash and sh) stays for the others.
    const gh = (shell: string) => extractShell(hostKind('', 'ci.yml')!, `jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo a\n        shell: ${shell}\n`).regions.map((r) => r.shell);
    assert.deepStrictEqual(gh('posh {0}'), ['sh']);
    assert.deepStrictEqual(gh('busybox {0}'), []);
    assert.deepStrictEqual(gh('bash {0}'), ['bash']);
    // A Jenkins shebang, a ShellCheck directive.
    assert.deepStrictEqual(regionShells2('jenkinsfile', 'Jenkinsfile', "node {\n  sh '''#!/bin/busybox sh\n    echo a\n  '''\n}\n"), ['ash']);
    assert.deepStrictEqual(regionShells2('markdown', 'README.md', '```bash\n# shellcheck shell=busybox\necho a\n```\n'), ['ash']);
    assert.deepStrictEqual(regionShells2('markdown', 'README.md', '```bash\n# shellcheck shell=posh\necho a\n```\n'), ['sh']);
  });
  it('reads a GitHub Actions step\'s shell: in any key order, and its defaults by precedence', () => {
    const shells = (yml: string) => extractShell(hostKind('', 'ci.yml')!, yml).regions.map((r) => r.shell);
    const head = 'jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n';
    // shell: above run:, as the first key or after name:, and below run:.
    assert.deepStrictEqual(shells(`${head}      - shell: sh\n        run: echo a\n`), ['sh']);
    assert.deepStrictEqual(shells(`${head}      - name: x\n        shell: sh\n        run: echo a\n`), ['sh']);
    assert.deepStrictEqual(shells(`${head}      - shell: sh\n        name: x\n        run: echo a\n`), ['sh']);
    assert.deepStrictEqual(shells(`${head}      - name: x\n        run: echo a\n        shell: sh\n`), ['sh']);
    assert.deepStrictEqual(shells(`${head}      - run: echo a\n        shell: sh\n`), ['sh']);
    assert.deepStrictEqual(shells(`${head}      - shell: sh\n\n        run: echo a\n`), ['sh']);
    // A neighbouring step's shell: is not this step's.
    assert.deepStrictEqual(shells(`${head}      - shell: sh\n        run: echo a\n      - run: echo b\n`), ['sh', 'bash']);
    assert.deepStrictEqual(shells(`${head}      - run: echo a\n      - shell: sh\n        run: echo b\n`), ['bash', 'sh']);
    assert.deepStrictEqual(shells(`${head}      - name: y\n        run: echo a\n      - name: x\n        shell: sh\n        run: echo b\n`), ['bash', 'sh']);
    // Precedence: step, then the job's defaults, then the workflow's.
    const wf = 'defaults:\n  run:\n    shell: sh\n';
    const job = '    defaults:\n      run:\n        shell: bash\n';
    assert.deepStrictEqual(shells(`${wf}jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo a\n`), ['sh']);
    assert.deepStrictEqual(shells(`${wf}jobs:\n  a:\n    runs-on: ubuntu-latest\n${job}    steps:\n      - run: echo a\n`), ['bash']);
    assert.deepStrictEqual(shells(`${wf}jobs:\n  a:\n    runs-on: ubuntu-latest\n${job}    steps:\n      - shell: sh\n        run: echo a\n`), ['sh']);
    assert.deepStrictEqual(shells(`${wf}jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - shell: bash\n        run: echo a\n`), ['bash']);
    // Another document does not lend its defaults (after or before), and a marker ends the step search.
    const one = 'jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo a\n';
    assert.deepStrictEqual(shells(`${one}---\n${wf}`), ['bash']);
    assert.deepStrictEqual(shells(`${wf}---\n${one}`), ['bash']);
    assert.deepStrictEqual(shells(`${one}...\n---\n${wf}`), ['bash']);
    // Any key order inside run:, and comment lines at column 0 between the keys.
    const wd = 'defaults:\n  run:\n    working-directory: x\n    shell: sh\n';
    assert.deepStrictEqual(shells(`${wd}${one}`), ['sh']);
    assert.deepStrictEqual(shells(`${one}${wd}`), ['sh']);
    assert.deepStrictEqual(shells(`defaults:\n  run:\n    shell: sh\n# c\n\n${one}`), ['sh']);
    assert.deepStrictEqual(shells(`${head}      - shell: sh\n# c\n        run: echo a\n`), ['sh']);
    assert.deepStrictEqual(shells(`${head}      - run: echo a\n# c\n        shell: sh\n`), ['sh']);
    // runs-on: of a Windows job: found above or below the steps, and not from another document or job.
    const win = (on: string, run = '      - run: echo a\n') => `jobs:\n  a:\n${on}    steps:\n${run}`;
    assert.deepStrictEqual(shells(win('    runs-on: windows-latest\n')), []);
    assert.deepStrictEqual(shells(`${win('')}    runs-on: windows-latest\n`), []);
    assert.deepStrictEqual(shells(`${win('    runs-on: windows-latest\n')}---\n${one}`), ['bash']);
    assert.deepStrictEqual(shells(`${one}---\n${win('    runs-on: windows-latest\n')}`), ['bash']);
    assert.deepStrictEqual(shells(`${win('    runs-on: windows-latest\n')}  b:\n    steps:\n      - run: echo b\n`), ['bash']);
    // A shell: that is not under defaults: run: counts for nothing.
    assert.deepStrictEqual(shells(`shell: sh\n${one}`), ['bash']);
    assert.deepStrictEqual(shells(`run:\n  shell: sh\n${one}`), ['bash']);
    assert.deepStrictEqual(shells(`other:\n  run:\n    shell: sh\n${one}`), ['bash']);
    // Defaults written after steps: (job) or after jobs: (workflow), and not leaking to another job.
    const steps = '    runs-on: ubuntu-latest\n    steps:\n      - run: echo a\n';
    assert.deepStrictEqual(shells(`jobs:\n  a:\n${steps}${job}`), ['bash']);
    assert.deepStrictEqual(shells(`jobs:\n  a:\n${steps}${job.replace('bash', 'sh')}  b:\n${steps}`), ['sh', 'bash']);
    assert.deepStrictEqual(shells(`jobs:\n  a:\n${steps}${wf}`), ['sh']);
    assert.deepStrictEqual(shells(`jobs:\n  a:\n${steps}${job}${wf}`), ['bash']);
    assert.deepStrictEqual(shells(`jobs:\n  a:\n${steps}${job.replace('bash', 'sh')}  b:\n${steps.replace('echo a', 'echo b')}${job}${wf.replace('shell: sh', 'shell: zsh')}`), ['sh', 'bash']);
  });
  it('a region says what it is part of, apart from its label', () => {
    const ci = (file: string, src: string) => extractShell(hostKind('', file)!, src).regions.map((r) => r.host);
    assert.deepStrictEqual(ci('ci.yml', 'jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo a\n'), [{ kind: 'yaml', ci: 'github' }]);
    assert.deepStrictEqual(ci('.gitlab-ci.yml', 'build:\n  script:\n    - make\n'), [{ kind: 'yaml' }]);
    assert.deepStrictEqual(ci('azure-pipelines.yml', 'pool:\n  vmImage: ubuntu-latest\nsteps:\n  - script: echo a\n'), [{ kind: 'yaml', ci: 'azure' }]);
    assert.deepStrictEqual(ci('config.yml', 'version: 2.1\njobs:\n  b:\n    steps:\n      - run: echo a\n'), [{ kind: 'yaml', ci: 'circleci' }]);
    assert.deepStrictEqual(ci('README.md', '```bash\necho a\n```\n'), [{ kind: 'markdown' }]);
  });
});
