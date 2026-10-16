// The entry point VS Code for the Web runs in its extension host, a web worker.
// The browser build of mocha defines the global `mocha`.
require('mocha/mocha');

export function run(): Promise<void> {
  return new Promise((resolve, reject) => {
    mocha.setup({ ui: 'bdd', reporter: undefined, timeout: 60000 });
    require('./extension.webtest');
    mocha.run((failures) => (failures ? reject(new Error(`${failures} test(s) failed`)) : resolve()));
  });
}
