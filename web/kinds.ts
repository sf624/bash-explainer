// The file kind of the editor and its samples: choosing a kind (the editor header's chip, the compare page's picker),
// a pasted script that brings its own kind, whether the user's text gives way to the new kind's sample, and loading
// a sample with an Undo. web/main.ts holds the rest of the page's state and gives this module what it needs.
import { undo } from '@codemirror/commands';
import type { StateEffect, Transaction } from '@codemirror/state';
import type { ViewUpdate } from '@codemirror/view';
import { detectKind } from '../src/hosts/detect';
import type { Lang } from '../src/i18n';
import type { Editor } from './editor';
import type { Showing } from '../src/ui/firstRun';
import type { FileState } from './file-state';
import { askReplaceWithSample } from './kind-dialog';
import { Picker } from './picker';
import { Kind, KINDS, kindInfo } from './samples';
import { scriptChange, type ScriptChange } from './script-state';
import { TEXT } from './text';
import type { ToastIcon, ToastSpec, ToastText } from './toast';

export { kindInfo };

/** Whether a text is a sample exactly as the page loads it. Read from the text itself rather than from a record of edits, so that it also holds after an undo back to a sample. */
export const isSample = (text: string): boolean => KINDS.some((k) => k.sample === text);

/** Whether the editor holds no text of the user's: nothing, or a sample. */
export const untouched = (text: string) => !text.trim() || isSample(text);

/** What the editor holds, as the page's start reads it (src/ui/firstRun.ts). */
export const showing = (text: string): Showing => (!text ? 'empty' : isSample(text) ? 'sample' : 'script');

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
  /**
   * The change a new script of the kind `k` makes (docs/design/usability-9.md, Q8): the editor page forgets the file and
   * puts the shell chosen back to Auto. Nothing where the page keeps them (the compare page).
   */
  newScript(k: Kind): ScriptChange | undefined;
  /** What the toast says that `c` set back, after `said` (`kindSaid`: those words name the kind). */
  scriptWords(c: ScriptChange, kindSaid: boolean): string;
  /** Puts the state of `c.from` back, the text as it is, and out of the history (the paste's toast: its Undo). */
  revertScript(c: ScriptChange): void;
}

/** The text that transactions inserted. */
const insertedBy = (trs: readonly Transaction[]): string => {
  let text = '';
  for (const tr of trs) tr.changes.iterChanges((_fa, _ta, _fb, _tb, inserted) => { text += inserted.toString(); });
  return text;
};

/** Whether a pasted `text` makes most of the document (80% or more): a whole script, not a few lines into one. */
const wholeOf = (text: string, doc: string): boolean => text.trim().length >= 0.8 * doc.trim().length;

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

  /** Puts `text` in as the page's own edit, not the user's (`line`: where the cursor goes; `effects`: into the same step of the history). */
  putText(text: string, line: number, effects?: StateEffect<unknown>[]): void {
    this.puttingText = true;
    try { this.host.editor().setText(text, line, effects); } finally { this.puttingText = false; }
  }

  /**
   * The new script a paste starts (docs/design/usability-9.md, Q8), as an effect of the paste's own transaction, so
   * that the paste and its reset are one step of the history (`scriptChange`, web/script-state.ts): only a paste that
   * replaces the whole of the untouched sample, with no file open. Its kind comes from the text (the plain shell script
   * when nothing says another), the script is untitled, the shell back to Auto. Nothing else does: an empty editor was
   * made new by Clear already (a shell chosen since stays), and a file open stays the file. (EditorState.transactionExtender.)
   */
  startedBy(tr: Transaction): StateEffect<ScriptChange>[] {
    if (!tr.docChanged || !(tr.isUserEvent('input.paste') || tr.isUserEvent('input.drop'))) return [];
    const start = tr.startState.doc.toString();
    if (!isSample(start) || this.host.files().own(start, untouched)) return [];
    const text = insertedBy([tr]);
    if (!wholeOf(text, tr.newDoc.toString())) return [];
    const change = this.host.newScript(detectKind(text)?.kind ?? 'shell');
    return change ? [scriptChange.of(change)] : [];
  }

  /**
   * A paste (or a drop) that brings a whole script decides the file kind from its content (src/hosts/detect.ts): when it
   * makes most of the text (80% or more), or the editor held only a sample or nothing. A few lines pasted into the user's
   * own script never change it. The text stays as pasted; the toast says what was detected and can undo the change of kind.
   * A paste that started a new script (`startedBy`) says what it set back; its Undo puts that back, the text as pasted.
   */
  detectPasted(u: ViewUpdate): void {
    const pasted = u.transactions.filter((tr) => tr.isUserEvent('input.paste') || tr.isUserEvent('input.drop'));
    if (!pasted.length) return;
    const text = insertedBy(pasted);
    const found = detectKind(text);
    const started = pasted.flatMap((tr) => tr.effects).find((e) => e.is(scriptChange))?.value;
    if (started) {
      const kindSaid = !!found && found.kind !== started.from.kind;
      // (After the editor's update, and after the change is applied: web/main.ts applies it in a microtask too.)
      queueMicrotask(() => {
        const t = TEXT[this.host.lang()];
        const words = t.andThen(kindSaid ? t.detected(t.kinds[found.kind] ?? kindInfo(found.kind).name) : '', this.host.scriptWords(started, kindSaid));
        if (words) this.host.status('undo', words, { label: t.undo, run: () => this.host.revertScript(started) });
      });
      return;
    }
    if (!wholeOf(text, u.state.doc.toString()) && !untouched(u.startState.doc.toString())) return;
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
