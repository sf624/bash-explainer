/**
 * A table read with words of the script (command names, variable names, file names, the names of an embedded
 * language): it has no prototype, so a word like `constructor` or `toString` finds nothing in it, not a method of
 * `Object`.
 */
export function wordTable<T>(entries: Record<string, T>): Record<string, T> {
  return Object.assign(Object.create(null) as Record<string, T>, entries);
}

/**
 * Sets the key `k` of the object `o` as its own, also `__proto__` (`o[k] = v` would set the prototype instead), and
 * returns `o`. A key `o` has keeps its place; a new one goes last.
 */
export function setOwn<T>(o: Record<string, T>, k: string, v: T): Record<string, T> {
  return Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
}
