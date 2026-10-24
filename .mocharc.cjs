// Parallel mode (three workers: the GitHub runner has four cores) needs Node.js 20; mocha's worker pool does not start on 18.
const parallel = Number(process.versions.node.split('.')[0]) >= 20;

module.exports = {
  spec: 'test/**/*.test.ts',
  'node-option': ['import=tsx'],
  timeout: 10000,
  ...(parallel ? { parallel: true, jobs: 3 } : {}),
};
