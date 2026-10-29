// Parallel mode (three workers: the GitHub runner has four cores) needs Node.js 20; mocha's worker pool does not start on 18.
const parallel = Number(process.versions.node.split('.')[0]) >= 20;

module.exports = {
  // MOCHA_SHARD=i/n runs only the files of shard i of n (CI runs the shards in jobs of their own; scripts/test-shards.cjs).
  spec: process.env.MOCHA_SHARD ? require('./scripts/test-shards.cjs').shardFiles(process.env.MOCHA_SHARD) : 'test/**/*.test.ts',
  'node-option': ['import=tsx'],
  timeout: 10000,
  ...(parallel ? { parallel: true, jobs: 3 } : {}),
};
