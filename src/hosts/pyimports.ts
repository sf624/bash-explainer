// The names a Python file's imports bind (docs/design/python-regex.md, 4.1; docs/design/sources.md, row 31), read from the
// lexer's tokens: `import subprocess as sp` binds `sp` to `subprocess`, `from subprocess import run as r` binds `r` to
// `subprocess.run`. A call is then resolved by its written name (`sp.run` is `subprocess.run`) and looked up in a table of
// full names as a string: `PY_CALLS` (src/hosts/python.ts), and the `re` functions later.
import { isName, isOp, type PyToken } from './pylex';

/** What each name bound by an import stands for, as a full dotted name. */
export type PyImports = ReadonlyMap<string, string>;

/** The dotted name of the tokens from `i` (`a.b.c`), and the index after it; undefined when `i` is no name. */
export function dottedAt(src: string, tokens: readonly PyToken[], i: number): { name: string; next: number } | undefined {
  if (tokens[i]?.kind !== 'name') return undefined;
  let name = src.slice(tokens[i].start, tokens[i].end);
  let k = i + 1;
  while (isOp(src, tokens[k], '.') && tokens[k + 1]?.kind === 'name') {
    name += `.${src.slice(tokens[k + 1].start, tokens[k + 1].end)}`;
    k += 2;
  }
  return { name, next: k };
}

/** The bindings of the `import` and `from … import` statements of a file's top-level tokens (comments left out). */
export function pyImports(src: string, tokens: readonly PyToken[]): PyImports {
  const names = new Map<string, string>();
  const code = tokens.filter((t) => t.kind !== 'comment');
  /** `name [as alias]` at `i`: the alias (or the name) and the index after it. */
  const bound = (i: number): { name: string; as: string; next: number } | undefined => {
    const d = dottedAt(src, code, i);
    if (!d) return undefined;
    if (!isName(src, code[d.next], 'as')) return { name: d.name, as: d.name, next: d.next };
    const alias = code[d.next + 1];
    return alias?.kind === 'name' ? { name: d.name, as: src.slice(alias.start, alias.end), next: d.next + 2 } : undefined;
  };
  for (let i = 0; i < code.length; i++) {
    // At the start of a statement: the file's, or after a newline or a `;`.
    if (i > 0 && code[i - 1].kind !== 'newline' && !isOp(src, code[i - 1], ';')) continue;
    if (isName(src, code[i], 'import')) {
      // `import a.b` binds `a`; `import a.b as c` binds `c` to `a.b`.
      for (let k = i + 1; ; k++) {
        const b = bound(k);
        if (!b) break;
        if (b.as === b.name) names.set(b.name.split('.')[0], b.name.split('.')[0]);
        else names.set(b.as, b.name);
        k = b.next;
        if (!isOp(src, code[k], ',')) break;
      }
    } else if (isName(src, code[i], 'from')) {
      const mod = dottedAt(src, code, i + 1);
      if (!mod || !isName(src, code[mod.next], 'import')) continue;
      let k = mod.next + 1;
      if (isOp(src, code[k], '(')) k++;
      for (;;) {
        const b = bound(k);
        if (!b) break;
        names.set(b.as, `${mod.name}.${b.name}`);
        k = b.next;
        if (!isOp(src, code[k], ',')) break;
        k++;
      }
    }
  }
  return names;
}

/** The full name of the dotted name `written` (`sp.run`), by the file's imports; undefined when its first part is not imported. */
export function pyResolve(imports: PyImports, written: string): string | undefined {
  const dot = written.indexOf('.');
  const head = imports.get(dot < 0 ? written : written.slice(0, dot));
  return head === undefined ? undefined : dot < 0 ? head : head + written.slice(dot);
}
