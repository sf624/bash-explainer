// Runs the integration tests: the production build of the extension in a real VS Code.
// Usage: node --import tsx integration/run.ts [--version=stable|1.85.0] [--download-only] [--executable=<path>]
//   --download-only  download VS Code (into .vscode-test/) and print the executable's path
//   --executable     use that VS Code, without looking anything up online (for runs with no network)
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';
import { execFileSync } from 'child_process';
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.join(__dirname, '..');
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

async function main(): Promise<void> {
  let executable = option('executable');
  if (executable === '') throw new Error('--executable is empty: VS Code was not downloaded');
  if (!executable) executable = await downloadAndUnzipVSCode({ version: option('version') ?? 'stable', cachePath: path.join(root, '.vscode-test') });
  if (process.argv.includes('--download-only')) {
    console.log(executable);
    return;
  }

  // What is published: the production bundle.
  execFileSync(process.execPath, ['esbuild.mjs', '--production'], { cwd: root, stdio: 'inherit' });
  const out = path.join(root, 'out', 'integration');
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'suite.ts'), path.join(__dirname, 'extension.itest.ts')],
    outdir: out,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['vscode', 'mocha'],
    logLevel: 'warning',
  });

  // Run from inside VS Code (its terminal, an extension), this makes the test VS Code start as plain Node.js.
  delete process.env.ELECTRON_RUN_AS_NODE;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-vscode-'));
  try {
    await runTests({
      vscodeExecutablePath: executable,
      extensionDevelopmentPath: root,
      extensionTestsPath: path.join(out, 'suite.js'),
      extensionTestsEnv: { BASH_EXPLAINER_NO_NETWORK: process.env.BASH_EXPLAINER_NO_NETWORK ?? '' },
      launchArgs: [
        path.join(root, 'test', 'fixtures'),
        `--user-data-dir=${userData}`,
        '--disable-extensions',
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-gpu',
      ],
    });
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
