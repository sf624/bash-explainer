// The entry point VS Code runs in its extension host: start watching, then run the tests.
import Mocha = require('mocha');
import * as path from 'path';
import * as vscode from 'vscode';
import { install } from './watch';

export async function run(): Promise<void> {
  const root = path.resolve(__dirname, '../..');
  // Before anything opens a file that would start the extension.
  install(path.join(root, 'dist', 'extension.js'), !!vscode.extensions.getExtension('shun-fujioka.bash-explainer')?.isActive);
  const mocha = new Mocha({ ui: 'bdd', timeout: 60000, color: true });
  mocha.addFile(path.join(__dirname, 'extension.itest.js'));
  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) => (failures ? reject(new Error(`${failures} test(s) failed`)) : resolve()));
  });
}
