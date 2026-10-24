// How a run's time grows with its input, measured in the same process: tests that guard linear (not quadratic or
// exponential) growth compare a large input with a small one, never with a fixed time, which a loaded CI runner
// (parallel workers, coverage) may exceed.
import * as assert from 'assert';

/**
 * The shortest of `runs` runs of `run`, in ms. The first runs are slow while the code warms up, and on a busy machine a
 * garbage collection or another process can make any one run slow; the shortest is the one that was not slowed.
 */
export function fastest(run: () => unknown, runs = 5): number {
  let min = Infinity;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    run();
    min = Math.min(min, performance.now() - t0);
  }
  return min;
}

/**
 * Asserts that `large` takes less than `bound` times as long as `small`: each the fastest of `runs` runs, `small` warmed
 * up first, and the runs taken in turn (small, large, small…), so that both see the same load when other processes
 * come and go. Choose the inputs so that the growth guarded against gives far more than `bound`, and the growth
 * expected far less: 8 times the input, linear, gives about 8 times as long and quadratic 64 times, so a bound of 16
 * tells them apart with room for noise.
 */
export function assertGrowth(what: string, small: () => unknown, large: () => unknown, bound: number, runs = 5): void {
  small();
  let a = Infinity;
  let b = Infinity;
  for (let i = 0; i < runs; i++) {
    a = Math.min(a, fastest(small, 1));
    b = Math.min(b, fastest(large, 1));
  }
  assert.ok(b < bound * a, `${what}: ${a.toFixed(1)} ms, then ${b.toFixed(1)} ms (more than ${bound} times as long)`);
}
