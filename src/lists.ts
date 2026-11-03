// Lists that grow with the input (docs/design/line-budget.md). A spread in a call puts each item on the stack, and about 120,000 of them
// fill it: `out.push(...rows)` of an example of 1e5 rows, `Math.min(...nodes)` of a script of 250,000 lines. So nothing in src/ or cli/
// spreads a list into a call (test/line-budget.test.ts looks for it).

/** Adds the items of `items` to the end of `to`. */
export function pushAll<T>(to: T[], items: readonly T[]): void {
  for (const x of items) to.push(x);
}

/** The smallest of `items`, as `Math.min` gives it: Infinity for none, NaN if one is. */
export function leastOf(items: readonly number[]): number {
  let least = Infinity;
  for (const x of items) least = Math.min(least, x);
  return least;
}

/** The largest of `items`, as `Math.max` gives it: -Infinity for none, NaN if one is. */
export function mostOf(items: readonly number[]): number {
  let most = -Infinity;
  for (const x of items) most = Math.max(most, x);
  return most;
}

/** The first of the items of each key, in order. */
export function onceBy<T>(all: readonly T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  return all.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
