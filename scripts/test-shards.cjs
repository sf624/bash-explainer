// Splits the unit test files into shards of about the same running time, for CI's shard jobs
// (.github/workflows/test.yml) and .mocharc.cjs, which runs one shard when MOCHA_SHARD is `i/n`.
// The times are in scripts/test-timings.json: the seconds each file takes run alone, on Node.js 18 and on
// Node.js 20 or later ("24"), measured, since they differ (the web page tests need Node.js 20, and skip on 18).
// A file not listed there counts as the median, so a new file lands in a shard by itself. The split is greedy
// (the longest file first, to the shard with the least time so far) and depends only on the list of
// files and the timings, so every job computes the same shards. test/shards.test.ts checks that each
// file is in exactly one shard.
//
//   node scripts/test-shards.cjs 2/4         the files of shard 2 of 4, one per line
//   node scripts/test-shards.cjs --plan 4 [18|24]  the shards of 4, with their estimated times
//   node scripts/test-shards.cjs --measure   run each file alone (as many at a time as mocha) and rewrite the
//                                            timings of this Node.js (run it with Node.js 18, and with 24)
//
// Measure again when the shards drift apart (the CI jobs "Unit tests" show their times). The times are CI's:
// on a branch, for one run, make the shard jobs run `node scripts/test-shards.cjs --measure` instead of mocha
// (each job then measures its own files, on the coverage job with NODE_V8_COVERAGE as there), and gather the
// lines the jobs print (seconds, file) into the file. A local machine is faster, and not by the same factor
// for every file.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TIMINGS = path.join(__dirname, 'test-timings.json');

/** The unit test files, as .mocharc.cjs's spec `test/**\/*.test.ts` finds them, relative to the root. */
function testFiles(root = ROOT) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith('.test.ts')) out.push(rel);
    }
  };
  walk('test');
  return out.sort();
}

/** The column of the timings for a version of Node.js: "18" below 20, where mocha runs the files one after another and the web tests skip, else "24". */
function column(version = process.versions.node) {
  return Number(version.split('.')[0]) < 20 ? '18' : '24';
}

/** The seconds of each file in a column of the timings. */
function readTimings(col = column()) {
  const all = JSON.parse(fs.readFileSync(TIMINGS, 'utf8'));
  return Object.fromEntries(Object.entries(all).filter(([, t]) => typeof t[col] === 'number').map(([f, t]) => [f, t[col]]));
}

/** The files split into n shards: an array of n arrays of files, each sorted. */
function split(files, timings, n) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`bad shard count: ${n}`);
  const known = files.map((f) => timings[f]).filter((t) => typeof t === 'number').sort((a, b) => a - b);
  const fallback = known.length ? known[Math.floor(known.length / 2)] : 1;
  const weight = (f) => (typeof timings[f] === 'number' ? timings[f] : fallback);
  const order = [...files].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b));
  const shards = Array.from({ length: n }, () => ({ files: [], time: 0 }));
  for (const f of order) {
    let best = shards[0];
    for (const s of shards) if (s.time < best.time) best = s;
    best.files.push(f);
    best.time += weight(f);
  }
  return shards.map((s) => ({ files: s.files.sort(), time: s.time }));
}

/** `i/n` (1-based) into its numbers. */
function parseShard(spec) {
  const m = /^(\d+)\/(\d+)$/.exec(spec);
  if (!m || +m[1] < 1 || +m[1] > +m[2]) throw new Error(`bad shard "${spec}": expected i/n, 1 <= i <= n`);
  return { index: +m[1], count: +m[2] };
}

/** The files of shard `i/n`. */
function shardFiles(spec, root = ROOT) {
  const { index, count } = parseShard(spec);
  return split(testFiles(root), readTimings(), count)[index - 1].files;
}

/**
 * Runs each test file alone on this Node.js, as many at a time as mocha runs (three on Node.js 20 or later, else
 * one), and writes the seconds each took to its column of the timings. With MOCHA_SHARD, only the files of that
 * shard (a CI job can measure its own); else every file, and the files no longer there leave the column.
 */
async function measure() {
  const { spawn } = require('node:child_process');
  const mocha = require.resolve('mocha/bin/mocha.js');
  const shard = process.env.MOCHA_SHARD;
  const queue = shard ? shardFiles(shard) : testFiles();
  const timings = {};
  const one = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const start = process.hrtime.bigint();
      const status = await new Promise((resolve) => {
        spawn(process.execPath, [mocha, '--no-config', '--node-option', 'import=tsx', '--timeout', '10000', '--reporter', 'dot', f], { cwd: ROOT, stdio: 'ignore' })
          .on('exit', resolve);
      });
      timings[f] = Math.round(Number(process.hrtime.bigint() - start) / 1e8) / 10;
      console.log(`${timings[f]}\t${f}${status ? ` (failed: ${status})` : ''}`);
    }
  };
  await Promise.all(Array.from({ length: column() === '18' ? 1 : 3 }, one));
  const col = column();
  const all = JSON.parse(fs.readFileSync(TIMINGS, 'utf8'));
  for (const f of Object.keys(all)) {
    if (!shard && !(f in timings)) delete all[f][col];
    if (!Object.keys(all[f]).length) delete all[f];
  }
  for (const [f, t] of Object.entries(timings)) all[f] = { ...all[f], [col]: t };
  writeTimings(all);
}

/** Writes the timings, one file per line. */
function writeTimings(all) {
  const line = (f) => `  ${JSON.stringify(f)}: ${JSON.stringify({ 18: all[f][18], 24: all[f][24] })}`;
  fs.writeFileSync(TIMINGS, `{\n${Object.keys(all).sort().map(line).join(',\n')}\n}\n`);
}

module.exports = { testFiles, column, readTimings, writeTimings, split, parseShard, shardFiles, TIMINGS };

if (require.main === module) {
  const [arg, value] = process.argv.slice(2);
  if (arg === '--plan') {
    split(testFiles(), readTimings(process.argv[4] ?? column()), Number(value)).forEach((s, i) => {
      console.log(`shard ${i + 1}: ${s.files.length} files, ${s.time.toFixed(0)} s`);
    });
  } else if (arg === '--measure') {
    measure().catch((e) => {
      console.error(e);
      process.exit(1);
    });
  } else if (arg) {
    console.log(shardFiles(arg).join('\n'));
  } else {
    console.error('usage: node scripts/test-shards.cjs i/n | --plan n [18|24] | --measure');
    process.exit(2);
  }
}
