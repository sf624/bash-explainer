// The file kind of the editor and its samples: choosing a kind (the editor header's chip, the compare page's picker),
// a pasted script that brings its own kind, whether the user's text gives way to the new kind's sample, and loading
// a sample with an Undo. web/main.ts holds the rest of the page's state and gives this module what it needs.
import { undo } from '@codemirror/commands';
import type { ViewUpdate } from '@codemirror/view';
import { detectKind } from '../src/hosts/detect';
import type { Lang } from '../src/i18n';
import type { Editor } from './editor';
import type { FileState } from './file-state';
import { askReplaceWithSample } from './kind-dialog';
import { Picker } from './picker';
import { Kind, KINDS } from './samples';
import { TEXT } from './text';
import type { ToastIcon, ToastSpec, ToastText } from './toast';

/** A kind's name, file name, sample and the line its cursor starts on (a shell script for an unknown kind). */
export const kindInfo = (k: Kind) => KINDS.find((x) => x.kind === k) ?? KINDS[0];

/**
 * Whether the editor holds no text of the user's: nothing, or a sample exactly as the page loads it. Read from
 * the text itself rather than from a record of edits, so that it also holds after an undo back to a sample.
 */
export const untouched = (text: string) => !text.trim() || KINDS.some((k) => k.sample === text);

/** What the kind's choices read from the page, and ask of it. */
export interface KindHost {
  lang(): Lang;
  editor(): Editor;
  files(): FileState<FileSystemFileHandle>;
  /** Shows the file's name and state (a new kind gives an unnamed file its name). */
  showFile(): void;
  /** Explains the cursor's line again. */
  explain(): void;
  status(icon: ToastIcon, words: ToastText | string, action?: ToastSpec['action']): void;
  /** Hides the toast whose Undo goes back over an edit: another text is put in. */
  dropUndo(): void;
  /** Closes the menu's sheet and the popovers, so that the question and the toast after it are not under them. */
  closeSheets(): void;
  focusHome(): void;
}

export class KindControl {
  /** While the page itself puts a text in (a sample, or nothing): the edit is not the user's, so the Undo toast stays. */
  puttingText = false;
  /** The compare page's picker of the file kind (the editor page has the chip, web/scope-chip.ts). */
  private readonly picker?: Picker;

  constructor(private readonly host: KindHost, public kind: Kind) {
    const button = document.getElementById('kind');
    const list = document.getElementById('kind-list');
    if (button instanceof HTMLButtonElement && list) this.picker = new Picker(button, list, (v) => this.choose(v as Kind));
  }

  /** The current kind's name, file name and sample. */
  info() {
    return kindInfo(this.kind);
  }

  /** Words the picker in the page's language. */
  showLanguage(): void {
    const t = TEXT[this.host.lang()];
    this.picker?.set(KINDS.map((k) => ({ value: k.kind, name: t.kinds[k.kind] ?? k.name })), this.kind, t.kind);
  }

  /** Whether the editor holds the user's own text: a file's (even an empty one), or text that is no sample. */
  own(): boolean {
    return this.host.files().own(this.host.editor().text, untouched);
  }

  /** The user chose `k`: a sample, or nothing, gives way to its sample; whether the user's own text does is theirs to say. */
  choose(k: Kind): void {
    const own = this.own();
    this.set(k, () => {
      if (!own) this.loadSample(false);
    });
    if (own) this.ask(k);
  }

  /** Makes `k` the file kind, with the text as it is (`then` may change it before the script is explained again). */
  set(k: Kind, then?: () => void): void {
    const editor = this.host.editor();
    this.kind = k;
    this.picker?.show(k);
    editor.setKind(k);
    this.host.showFile();
    then?.();
    editor.shade();
    this.host.explain();
    editor.recheck();
  }

  /** Puts `text` in as the page's own edit, not the user's (`line`: where the cursor goes). */
  putText(text: string, line: number): void {
    this.puttingText = true;
    try { this.host.editor().setText(text, line); } finally { this.puttingText = false; }
  }

  /**
   * A paste (or a drop) that brings a whole script decides the file kind from its content (src/hosts/detect.ts): when it
   * makes most of the text (80% or more), or the editor held only a sample or nothing. A few lines pasted into the user's
   * own script never change it. The text stays as pasted; the toast says what was detected and can undo the change of kind.
   */
  detectPasted(u: ViewUpdate): void {
    const pasted = u.transactions.filter((tr) => tr.isUserEvent('input.paste') || tr.isUserEvent('input.drop'));
    if (!pasted.length) return;
    let text = '';
    for (const tr of pasted) tr.changes.iterChanges((_fa, _ta, _fb, _tb, inserted) => { text += inserted.toString(); });
    const whole = text.trim().length >= 0.8 * u.state.doc.toString().trim().length;
    if (!whole && !untouched(u.startState.doc.toString())) return;
    const found = detectKind(text);
    if (!found || found.kind === this.kind) return;
    const before = this.kind;
    // The editor is still in its update: change its mode after it.
    queueMicrotask(() => {
      this.set(found.kind);
      const t = TEXT[this.host.lang()];
      this.host.status('undo', t.detected(t.kinds[found.kind] ?? kindInfo(found.kind).name), { label: t.undo, run: () => this.set(before) });
    });
  }

  /** Asks whether the user's text gives way to the sample of the kind just chosen (the kind has changed either way). */
  private ask(k: Kind): void {
    const t = TEXT[this.host.lang()];
    const name = t.kinds[k] ?? kindInfo(k).name;
    // The control that was used (the kind picker, in the phone's sheet or not): the focus goes back to it, or to the
    // button of the sheet it was in (web/kind-dialog.ts, `focusTarget`). The sheet closes first, so that the toast after
    // the choice is not under it.
    const back = document.activeElement as HTMLElement | null;
    this.host.closeSheets();
    void askReplaceWithSample({ title: t.askTitle(name), message: t.askMessage(name), replace: t.askReplace, keep: t.askKeep }, back, () => this.host.focusHome())
      .then((replace) => {
        if (replace) this.loadSample(true);
      });
  }

  /** Puts in the current kind's sample; when it replaced the user's own text (`own`), the toast offers to undo it. */
  loadSample(own: boolean): void {
    const { host } = this;
    const editor = host.editor();
    const files = host.files();
    const info = this.info();
    // Already there (a second click on the button): nothing to replace, so nothing to undo, and the file stays as it is.
    if (editor.text === info.sample) return;
    // An Undo offered before (a sample loaded over the user's text) would undo nothing now: the text is another's.
    host.dropUndo();
    const before = files.snapshot();
    this.putText(info.sample, info.cursorLine);
    const set = editor.text;
    files.sampleLoaded(editor.text);
    host.showFile();
    // Undo brings back the text, and the file it was (its name, its handle, its line ends); only while the text is still
    // the sample as it was put in, so that it never puts a file's name over a text that is not the file's.
    const back = () => {
      if (editor.text !== set) return;
      undo(editor.view);
      files.restore(before);
      host.showFile();
      host.focusHome();
    };
    const t = TEXT[host.lang()];
    if (own) host.status('undo', t.sampleLoaded, { label: t.undo, run: back, untilEdit: true });
  }
}
