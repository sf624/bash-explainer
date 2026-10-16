// Runs the web integration tests: the extension's web bundle in VS Code for the Web, in Chromium.
// Usage: node --import tsx integration/run-web.ts   (needs Chromium: npx playwright install chromium)
import { runTests } from '@vscode/test-web';
import { execFileSync } from 'child_process';
import * as esbuild from 'esbuild';
import * as path from 'path';

const root = path.join(__dirname, '..');

async function main(): Promise<void> {
  // What is published: the production bundles.
  execFileSync(process.execPath, ['esbuild.mjs', '--production'], { cwd: root, stdio: 'inherit' });
  const out = path.join(root, 'out', 'integration', 'web');
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'web', 'suite.ts')],
    outfile: path.join(out, 'suite.js'),
    bundle: true,
    platform: 'browser',
    format: 'cjs',
    target: 'es2020',
    external: ['vscode'],
    logLevel: 'warning',
  });
  await runTests({
    browserType: 'chromium',
    headless: true,
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(out, 'suite.js'),
    folderPath: path.join(root, 'test', 'fixtures'),
    quality: 'stable',
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
