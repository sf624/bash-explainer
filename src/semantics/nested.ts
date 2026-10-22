// Nested scripts (docs/design/semantics.md, 4.13): a string that a command slot runs as a script (`eval S`,
// `bash -c S`, `trap S INT`, `ssh host S`), read as the script it is. This file reads the string's text, with the
// source range of each character, and says which shell reads it; src/semantics/state.ts parses it and gives it a
// model (`StateModel.script`).
import type { Shell } from '../dialect';
import { type MappedText, staticWordText } from '../staticword';
import type { SyntaxNode, SyntaxTree } from '../syntax/tree';
import type { ExecEnv, SlotLink } from './env';
import type { StateModel } from './state';

/** How many strings in strings are read (deeper ones stay opaque). */
export const NESTED_DEPTH = 8;

/**
 * A string read as a script. `kind`: run now by this shell (`eval`), later by this shell (a trap's action), or by
 * another shell (`bash -c`, `ssh`). `starts` and `ends` give the source range of each character of `text` in the
 * text of the tree its words are in. `shell` is the shell that reads it (`undefined`: bash); `known` is false when
 * the shell is not known (`su -c`, ssh: the user's login shell), which is then read as bash. `model` is the model
 * its nodes are in: the outer one for `eval` and a trap (the walk runs them), one of its own for another shell.
 */
export interface NestedScript {
  readonly kind: 'current' | 'later' | 'child';
  readonly words: readonly SyntaxNode[];
  readonly text: string;
  readonly starts: readonly number[];
  readonly ends: readonly number[];
  readonly tree: SyntaxTree;
  readonly shell: Shell | undefined;
  readonly known: boolean;
  readonly depth: number;
  readonly outer: StateModel;
  readonly model: StateModel;
  /** Where it runs: the slot's chain (src/semantics/env.ts). */
  readonly env: ExecEnv;
}

/**
 * Why a string is not read: an expansion, a glob or a tilde in it (or backquotes around it), too many levels of
 * strings, or no shell runs it (`sudo eval s`: sudo cannot run a builtin).
 */
export interface NotRead { readonly why: 'not-static' | 'too-deep' | 'not-run' }

/** The text of `words` joined with spaces (`eval a b`), each character with its source range; a space spans the gap between two words. */
export function scriptText(words: readonly SyntaxNode[]): MappedText | undefined {
  const out: MappedText = { text: '', starts: [], ends: [] };
  for (const [i, w] of words.entries()) {
    const part = staticWordText(w);
    if (!part) return undefined;
    if (i > 0) {
      out.text += ' ';
      out.starts.push(words[i - 1].endIndex);
      out.ends.push(w.startIndex);
    }
    out.text += part.text;
    out.starts.push(...part.starts);
    out.ends.push(...part.ends);
  }
  return out;
}

/** The shell that reads a string run through `link` (a `shell-string` slot), and whether it is known. */
export function slotShell(link: SlotLink): { shell: Shell | undefined; known: boolean } {
  // (slotEnvs names the shell of every `shell-string` slot.)
  const kind = link.shell!;
  return kind === 'unknown' ? { shell: undefined, known: false } : { shell: kind === 'bash' ? undefined : kind, known: true };
}

/**
 * Where offset `i` of a script's text is in the text of the tree its words are in: the start of character `i`, or
 * (`end`) the end of character `i - 1`, so that a range of the text maps to the source of its characters.
 */
export function scriptSourceIndex(script: Pick<NestedScript, 'starts' | 'ends' | 'words'>, i: number, end: boolean): number {
  const { starts, ends } = script;
  if (end && i > 0) return ends[i - 1];
  return i < starts.length ? starts[i] : ends[ends.length - 1] ?? script.words[0].startIndex;
}
