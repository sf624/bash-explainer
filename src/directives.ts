/**
 * `# bash-explainer disable=code,…` comments, like ShellCheck's directives: on a line of its own
 * it applies to the next line with code, after code to its own line, and `disable-file=` to the
 * whole file. `all` matches every warning. Markdown can use `<!-- bash-explainer disable=… -->`.
 */
export interface Directives {
  file: Set<string>;
  lines: Map<number, Set<string>>;
}

export const DIRECTIVE = /(?:#|<!--)\s*bash-explainer\s+(disable|disable-file)=([\w*,-]+)/;

export function parseDirectives(lines: string[]): Directives {
  const d: Directives = { file: new Set(), lines: new Map() };
  const add = (line: number, codes: string[]) => {
    const set = d.lines.get(line) ?? new Set<string>();
    codes.forEach((c) => set.add(c));
    d.lines.set(line, set);
  };
  lines.forEach((text, i) => {
    const m = DIRECTIVE.exec(text);
    if (!m) return;
    const codes = m[2].split(',').filter(Boolean);
    if (m[1] === 'disable-file') {
      codes.forEach((c) => d.file.add(c));
      return;
    }
    // After code: this line. On a line of its own: the next line that is not blank or a comment.
    if (text.slice(0, m.index).trim()) return add(i, codes);
    let j = i + 1;
    while (j < lines.length && (!lines[j].trim() || /^\s*(#|<!--)/.test(lines[j]))) j++;
    if (j < lines.length) add(j, codes);
  });
  return d;
}

/** Whether a warning with this code on this line is turned off by a directive. */
export function suppressed(d: Directives, line: number, code: string): boolean {
  const hit = (set?: Set<string>) => !!set && (set.has(code) || set.has('all'));
  return hit(d.file) || hit(d.lines.get(line));
}
