// Opening a file into the editor and saving the editor's text to a file. Everything stays in the browser: a file
// opened is read here and uploaded nowhere, and a save writes to the user's own disk.
//
// Where the browser has the File System Access API (Chromium), opening keeps the file's handle, and a save writes
// back to it (the first save of a script that came from no file asks where, with the browser's Save dialog).
// Elsewhere, opening uses <input type=file> or a drop, and a save is a download.
//
// The text is saved as the editor holds it, byte for byte, with the file's line ends: CodeMirror keeps every line
// end as "\n", so a file that ended its lines with CRLF is written with CRLF again (and is explained with them, so the
// `crlf` warning shows). A file that mixed them is written with the more common one, and the toast says so.
import { hostKind } from '../src/hosts';
import { detectKind } from '../src/hosts/detect';
import { detectShell } from '../src/dialect';
import { Kind, KINDS } from './samples';

/**
 * The largest file the page opens: 1 MiB. Far beyond hand-written scripts, and the page explains the whole text again
 * after every change: at 1 MiB (36,000 lines of the sample) that takes about 4 s on a desktop (parse 0.9 s, colours 1.6 s,
 * problems 1.8 s), so a larger file would leave the page frozen. A bigger file is most likely a log or an archive.
 */
export const MAX_BYTES = 1024 * 1024;

/** How a file holds its text, besides the text itself: its line end, and whether it starts with a BOM. */
export interface FileFormat {
  eol: '\n' | '\r\n';
  bom: boolean;
}

/** A file's text (without its BOM) and its format. */
export interface FileText extends FileFormat {
  text: string;
  /** The file had both CRLF and LF line ends: a save writes `eol` throughout. */
  mixed: boolean;
}

/** The format of a script that came from no file. */
export const PLAIN: FileFormat = { eol: '\n', bom: false };

/**
 * The text of a file's bytes, or why the page does not open it: `binary` for one that is not UTF-8 text (a NUL byte, as
 * git and grep take it, or bytes that are not UTF-8); `cr` for a CR that ends no line (CodeMirror would make it a line
 * break, and a save would then change the script).
 */
export function decodeText(bytes: Uint8Array): FileText | 'binary' | 'cr' {
  if (bytes.includes(0)) return 'binary';
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return 'binary';
  }
  if (/\r(?!\n)/.test(text)) return 'cr';
  // The BOM is no part of the script (bash and the kernel would read it as one: VS Code leaves it out too); a save writes it back.
  const bom = text.startsWith('﻿');
  if (bom) text = text.slice(1);
  const crlf = text.match(/\r\n/g)?.length ?? 0;
  const lf = text.match(/(?<!\r)\n/g)?.length ?? 0;
  return { text, eol: crlf > lf ? '\r\n' : '\n', bom, mixed: crlf > 0 && lf > 0 };
}

/** The editor's text (lines ended by "\n") with the file's line ends, as the explainers read it. */
export function withEol(text: string, eol: FileFormat['eol']): string {
  return eol === '\n' ? text : text.replace(/\n/g, eol);
}

/** The editor's text as the file holds it: its line ends, and its BOM. */
export function fileContent(text: string, format: FileFormat): string {
  return (format.bom ? '﻿' : '') + withEol(text, format.eol);
}

/**
 * The kind of a file opened: from its name as the VS Code extension reads it (src/hosts: `Dockerfile`, `*.mk`,
 * `*.yml`, `package.json`, `*.bats` or a bats shebang…), a shell script by its extension (`.sh`, `.bash`, `.zsh`…),
 * else from its content (a shebang, `FROM`, `jobs:`: src/hosts/detect.ts), else a shell script.
 */
export function kindForFile(name: string, text: string): Kind {
  const host = hostKind('', name, text);
  if (host) return host;
  if (/\.(sh|bash|zsh|ksh|mksh|dash|ash)$/i.test(name) || detectShell('', name)) return 'shell';
  return detectKind(text)?.kind ?? 'shell';
}

/** The name a save suggests for a script that came from no file: the kind's sample's (`script.sh`, `Dockerfile`, `ci.yml`, `test.bats`…). */
export function defaultName(kind: Kind): string {
  return (KINDS.find((k) => k.kind === kind) ?? KINDS[0]).fileName.split('/').pop()!;
}

/** Whether the page runs on a Mac (or an iPad with a keyboard): the shortcuts are ⌘S and ⌘O there, Ctrl+S and Ctrl+O elsewhere. */
export function isMac(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

/** The part of the File System Access API the page uses (not in TypeScript's DOM types: Chromium only). */
interface Pickers {
  showOpenFilePicker?(options?: { multiple?: boolean }): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?(options?: { suggestedName?: string }): Promise<FileSystemFileHandle>;
}
const pickers = () => window as unknown as Pickers;

/** A file chosen to open: its name and bytes, and its handle when the browser gives one (a save then writes to it). */
export interface ChosenFile { file: File; handle?: FileSystemFileHandle }

/** The user closed a picker without choosing. */
const cancelled = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/**
 * Asks for a file to open: the browser's own picker (File System Access) where there is one, else an
 * <input type=file>. Resolves undefined when the user cancels.
 */
export async function chooseFile(input: HTMLInputElement): Promise<ChosenFile | undefined> {
  const open = pickers().showOpenFilePicker;
  if (open) {
    let handle: FileSystemFileHandle | undefined;
    try {
      [handle] = await open.call(window, { multiple: false });
    } catch (e) {
      if (cancelled(e)) return undefined;
      // Not allowed here (a frame, a policy): the plain input still works.
    }
    // A file that cannot be read now (changed or gone since it was picked) is the caller's to report.
    if (handle) return { file: await handle.getFile(), handle };
  }
  return new Promise((resolve) => {
    input.value = '';
    // (Assigned, not added: a browser without the `cancel` event leaves the last call waiting, and the next replaces it.)
    input.onchange = () => resolve(input.files?.[0] ? { file: input.files[0] } : undefined);
    input.oncancel = () => resolve(undefined);
    input.click();
  });
}

/** How a save went. */
export type Saved =
  | { how: 'written'; name: string; handle: FileSystemFileHandle }
  | { how: 'downloaded'; name: string }
  | { how: 'cancelled' }
  /** Not written: the caller forgets the handle, so that the next save asks where (the same failure would come again). */
  | { how: 'refused'; name: string };

/**
 * Saves `text` (UTF-8, as it is): to `handle` when there is one, else to a file the user picks with the browser's Save
 * dialog, else as a download named `name`. Called at once from the key press or the click, which lets the browser
 * open its dialog or ask for the permission to write.
 */
export async function saveText(text: string, name: string, handle: FileSystemFileHandle | undefined): Promise<Saved> {
  const bytes = new TextEncoder().encode(text);
  if (!handle) {
    const save = pickers().showSaveFilePicker;
    if (save) {
      try {
        handle = await save.call(window, { suggestedName: name });
      } catch (e) {
        if (cancelled(e)) return { how: 'cancelled' };
        // Not allowed here: a download still works.
      }
    }
  }
  if (handle) {
    let out: FileSystemWritableFileStream | undefined;
    try {
      out = await handle.createWritable();
      await out.write(bytes as BlobPart);
      await out.close();
      return { how: 'written', name: handle.name, handle };
    } catch (e) {
      // The user refused the permission to write, the file is read-only, or it went away. A write begun is given up,
      // so that the browser lets the file go.
      await out?.abort().catch(() => undefined);
      if (cancelled(e)) return { how: 'cancelled' };
      return { how: 'refused', name: handle.name };
    }
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { how: 'downloaded', name };
}
