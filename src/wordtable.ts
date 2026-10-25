/**
 * A table read with words of the script (command names, variable names, file names, the names of an embedded
 * language): it has no prototype, so a word like `constructor` or `toString` finds nothing in it, not a method of
 * `Object`.
 */
export function wordTable<T>(entries: Record<string, T>): Record<string, T> {
  return Object.assign(Object.create(null) as Record<string, T>, entries);
}
