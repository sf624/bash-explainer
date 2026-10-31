// The name of the script on the web page (the editor's header and the menu's first row, web/file-name.ts):
// what it shows, and how a rename is read. docs/design/chrome-redesign.md, C4. The page only draws the result.

/** The kinds' file names that are a convention of their tool: a script never saved keeps them ("Dockerfile"). */
const FIXED_NAMES = new Set(['Dockerfile', 'Makefile', 'Jenkinsfile', 'package.json', 'README.md']);

/**
 * The name of a script never saved or opened, as editors name one: "untitled" with the kind's extension
 * (`script.sh` gives `untitled.sh`), or the kind's own name where the tool fixes it (`Dockerfile`).
 */
export function untitledName(kindName: string): string {
  const base = kindName.split('/').pop()!;
  if (FIXED_NAMES.has(base)) return base;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? `untitled${base.slice(dot)}` : 'untitled';
}

/** What the page knows of the script's name. */
export interface FileFacts {
  /** The name of the file the script was opened from or last saved to; undefined while it never was. */
  file?: string;
  /** The name given by a rename before the script was ever saved or opened. */
  draft?: string;
  /** Whether the file was renamed since it was opened or saved (the new name is not on disk yet). */
  renamed: boolean;
  /** Whether the text differs from the one last opened or saved. */
  dirty: boolean;
  /** The kind's file name (`script.sh`, `Dockerfile`), for a script that has no other. */
  kindName: string;
}

/** How the page shows the name. */
export interface FileNameView {
  /** The name shown, and the one a first save suggests. */
  name: string;
  /** Muted: the script was never saved or opened. */
  muted: boolean;
  /** ● after the name: a file with changes not saved to it (its text, or its name). */
  dot: boolean;
}

/**
 * The name's state: the file's name, else the name given, else "untitled" (src/ui `untitledName`). A script never saved
 * is muted and has no dot (it has nothing on disk to differ from); a file has the dot while its text or its name differs
 * from what was opened or saved.
 */
export function fileNameView(f: FileFacts): FileNameView {
  if (f.file === undefined) return { name: f.draft ?? untitledName(f.kindName), muted: true, dot: false };
  return { name: f.file, muted: false, dot: f.dirty || f.renamed };
}

/** The longest name a rename takes, in characters (most file systems hold 255). */
export const MAX_NAME = 255;

/**
 * The name typed into the rename field, as the page takes it: trimmed, without the characters a file name cannot
 * hold (`/`, `\`, control characters), cut to `MAX_NAME` characters. Undefined when nothing is left, when it is `.` or
 * `..` (the directory itself and its parent), or when it is the name already shown: the rename then changes nothing.
 */
export function typedName(typed: string, current: string): string | undefined {
  const clean = [...typed].filter((c) => c >= ' ' && c !== '\u007f' && c !== '/' && c !== '\\').join('').trim();
  const name = [...clean].slice(0, MAX_NAME).join('').trim();
  return name && name !== '.' && name !== '..' && name !== current ? name : undefined;
}

/** Where the rename field's selection ends: the stem, so that typing keeps the extension (`deploy|.sh`); a name without one, whole. */
export function stemEnd(name: string): number {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? dot : name.length;
}

/**
 * The name cut in two for the header, so that a long name loses the middle of its stem and keeps its extension
 * ("very-long-dep….sh"): the stem, which may be cut with "…", and the extension, which is not.
 */
export function nameParts(name: string): [stem: string, ext: string] {
  const end = stemEnd(name);
  return [name.slice(0, end), name.slice(end)];
}
