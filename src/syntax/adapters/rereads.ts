// What the unbash adapter (./unbash.ts) reads in unbash's AST before it builds the tree: the errors of a script, and the
// process substitutions that unbash ends a word at, which the adapter has it read again. It works on the shape of the
// AST only (given the walk of its children), since only ./unbash.ts may import unbash.

/** A node of unbash's AST, as far as this module reads it. */
export interface AstNode {
  readonly type: string;
  readonly pos: number;
  readonly end: number;
  readonly text?: string;
  readonly parts?: readonly { readonly type: string; readonly pos: number }[];
  /** A script: its errors, and the text it was read from when that is not the script's own (a backquote with escapes). */
  readonly errors?: readonly AstError[];
  readonly source?: string;
}
export interface AstError { readonly message: string; readonly pos: number }
/** unbash's `forEachChild`, on the nodes as this module reads them. */
export type Children = (n: AstNode, visit: (c: AstNode) => void) => void;

/**
 * Calls `visit` on each node of `script`, but not inside the script of a backquote with escapes, which is parsed
 * apart (by the adapter's `decoded`), so that its positions are in the text without the escapes.
 */
export function walk(script: AstNode, children: Children, visit: (n: AstNode) => void): void {
  const go = (n: AstNode): void => {
    if (n.type === 'Script' && n !== script && n.source !== undefined) return;
    visit(n);
    children(n, go);
  };
  go(script);
}

/** The errors of a script and of the scripts of the substitutions in it (but those of a backquote with escapes). */
export function scriptErrors<E extends AstError>(script: AstNode, children: Children): E[] {
  const errors: E[] = [];
  walk(script, children, (n) => {
    if (n.type === 'Script') errors.push(...((n.errors ?? []) as E[]));
  });
  return errors;
}

/**
 * Where a process substitution is part of a longer word that unbash does not read as one: bash reads a `<(` or
 * `>(` in a word as it reads a `$(` (`a<(:)`, `<(:)b` and `<(:)<(:)` are each one word; `<(:)2>x` is the word
 * `<(:)2` and `>x`). unbash makes two words of them (and of `x=a<(:)` an assignment and a word), a plain word of
 * `2>(:)` and `{fd}<(:)`, and an unexpected token of the `<(:)` of `[[ a<(:) ]]`. The places are those of the `<`
 * or `>`; not of one before `((`, which would read as `$((` (`a<((:))` stays two words: README, Limitations).
 */
export function attachedSubstitutions(script: AstNode, children: Children, text: string): number[] {
  const starts = new Set<number>();
  const ends = new Set<number>();
  const words: AstNode[] = [];
  walk(script, children, (n) => {
    if (n.type === 'Word' || n.type === 'Assignment') {
      starts.add(n.pos);
      ends.add(n.end);
    }
    // (A redirection with a descriptor written before its operator starts with a word character.)
    if (n.type === 'Redirect' && /^[\w{]/.test(text[n.pos])) starts.add(n.pos);
    if (n.type === 'Word') words.push(n);
  });
  const places: number[] = [];
  for (const w of words) {
    const first = w.parts?.[0];
    if (first?.type === 'ProcessSubstitution' && first.pos === w.pos && (ends.has(w.pos) || starts.has(w.end))) places.push(w.pos);
    const fd = w.parts ? null : /^(?:\d+|\{[A-Za-z_]\w*\})[<>]\(/.exec(w.text!);
    if (fd) places.push(w.pos + fd[0].length - 2);
  }
  for (const e of scriptErrors(script, children)) if (/^unexpected token '[<>]\(/.test(e.message) && ends.has(e.pos)) places.push(e.pos);
  return places.filter((i) => text[i + 2] !== '(');
}
