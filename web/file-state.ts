// The file the script is: where it came from or was saved to, how that file holds its text, the text as it was last
// opened, saved or loaded, and the name shown (docs/design/chrome-redesign.md, C4, "file identity"). web/main.ts holds
// one of these and moves it with the transitions below; what the name looks like is src/ui/fileName.ts's, and each fact
// is decided here once: the name shown, the handle a save writes to, whether there are changes not saved.
import { fileNameView, FileNameView } from '../src/ui/fileName';

/** How a file holds its text, besides the text itself: its line end, and whether it starts with a BOM. */
export interface FileFormat {
  eol: '\n' | '\r\n';
  bom: boolean;
}

/** The format of a script that came from no file. */
export const PLAIN: FileFormat = { eol: '\n', bom: false };

/** A file the script was opened from or saved to: its name, and its handle where the browser gives one (a save writes to it). */
export interface OpenFile<H> { name: string; handle?: H }

/** What a transition changes, kept to be put back (the sample's Undo). */
export interface FileSnapshot<H> {
  file: OpenFile<H> | undefined;
  format: FileFormat;
  clean: string;
  draft: string | undefined;
  pending: string | undefined;
}

/** `H`: the type of a file handle (the page's: `FileSystemFileHandle`, which the unit tests, without the DOM, do not name). */
export class FileState<H> {
  /** The file the script was opened from or last saved to; undefined while it never was. */
  file: OpenFile<H> | undefined;
  /**
   * How that file holds its text: the editor keeps "\n" and no BOM; the file has its own line end (the explainers read
   * it too, so a CRLF file gets the `crlf` warning) and its BOM back.
   */
  format: FileFormat = PLAIN;
  /** The text as it was last opened, saved or loaded: the editor has changes not saved while it differs. */
  clean = '';
  /** The name given by a rename before the script was ever saved or opened. */
  private draft: string | undefined;
  /**
   * The name given by a rename of a file since it was opened or saved (the new name is not on disk). The file keeps its
   * own name and handle, so that a rename back to it is no rename at all.
   */
  private pending: string | undefined;
  /** Counts the transitions: a save that sees it change while the browser asked is not the save of this state. */
  private serial = 0;

  /** What the page shows of the name (src/ui/fileName.ts): the name, muted until saved or opened, ● for changes not saved. */
  view(text: string, untouched: (text: string) => boolean, kindName: string): FileNameView {
    return fileNameView({ file: this.pending ?? this.file?.name, draft: this.draft, renamed: this.pending !== undefined, dirty: this.unsaved(text, untouched), kindName });
  }

  /** The name shown, with `kindName`: the file name of the kind, for a script that has no other. */
  name(kindName: string): string {
    return fileNameView({ file: this.pending ?? this.file?.name, draft: this.draft, renamed: false, dirty: false, kindName }).name;
  }

  /** Whether the script has a name of its own (a file's, or one given): the page's title then says it. */
  named(): boolean {
    return this.file !== undefined || this.draft !== undefined;
  }

  /** Whether the editor holds the user's own text: a file's (even an empty one), or text that is no sample (`untouched`). */
  own(text: string, untouched: (text: string) => boolean): boolean {
    return this.file !== undefined || !untouched(text);
  }

  /** Whether opening a file would lose text: `text` differs from `clean` and is the user's own. Read from the text, so that an undo back to it counts. */
  unsaved(text: string, untouched: (text: string) => boolean): boolean {
    return text !== this.clean && this.own(text, untouched);
  }

  /** The handle a save writes to: none once the file was renamed (the save then asks where). */
  handle(): H | undefined {
    return this.pending === undefined ? this.file?.handle : undefined;
  }

  /** A number that changes with every transition: a save that sees it change while the browser asked is not this state's. */
  version(): number {
    return this.serial;
  }

  /** A file was opened, with `text` as it holds it. */
  opened(file: OpenFile<H>, format: FileFormat, text: string): void {
    this.set(file, format, text);
  }

  /** The text was saved: to the file `file` (the browser may have asked for another name or place). */
  saved(file: OpenFile<H>, text: string): void {
    this.set(file, this.format, text);
  }

  /** A sample (or the text the page starts with) is the script: no file's, so a save asks where, and never writes it into the file opened before. */
  sampleLoaded(text: string): void {
    this.set(undefined, PLAIN, text);
  }

  /** The write was refused: the same write would fail again, so the next save asks where. */
  refused(): void {
    if (this.file) this.file = { name: this.file.name };
    this.serial++;
  }

  /** Gives the script the name typed (a file's next save then asks where); the file's own name again is no rename. */
  rename(next: string): void {
    if (this.file) this.pending = next === this.file.name ? undefined : next;
    else this.draft = next;
    this.serial++;
  }

  snapshot(): FileSnapshot<H> {
    return { file: this.file, format: this.format, clean: this.clean, draft: this.draft, pending: this.pending };
  }

  restore(s: FileSnapshot<H>): void {
    ({ file: this.file, format: this.format, clean: this.clean, draft: this.draft, pending: this.pending } = s);
    this.serial++;
  }

  private set(file: OpenFile<H> | undefined, format: FileFormat, text: string): void {
    this.file = file;
    this.format = format;
    this.clean = text;
    this.draft = undefined;
    this.pending = undefined;
    this.serial++;
  }
}
