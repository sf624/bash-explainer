// What a script is besides its text: its file kind, the file it is (its name, where Save writes) and the shell chosen
// for it. A new script resets them (docs/design/usability-9.md, Q8); Clear puts that reset into the editor's undo
// history with the text, so that Ctrl+Z, Ctrl+Shift+Z and the toast's Undo take back or make again the whole change.
// This module reads the state, applies it (`scriptStates`, for web/main.ts) and carries it through the history.
import { invertedEffects } from '@codemirror/commands';
import { StateEffect } from '@codemirror/state';
import { type FileSnapshot, type FileState, newScriptFile } from './file-state';
import type { KindControl } from './kinds';
import type { Lang } from '../src/i18n';
import { type Kind, kindInfo } from './samples';
import { TEXT } from './text';

/** The state of the script beside its text. */
export interface ScriptState {
  kind: Kind;
  file: FileSnapshot<FileSystemFileHandle>;
  /** The shell setting: 'auto', or the shell chosen. */
  shell: string;
}

/** A change of the script's state, from `from` to `to`. */
export interface ScriptChange { from: ScriptState; to: ScriptState }

/** The script's state changes (applied by web/main.ts wherever the effect comes from: the change itself, an undo, a redo, the paste's toast). */
export const scriptChange = StateEffect.define<ScriptChange>();

/** Keeps `scriptChange` in the undo history: an undo carries it back, from and to swapped, and a redo again. */
export const scriptHistory = invertedEffects.of((tr) => tr.effects.filter((e) => e.is(scriptChange)).map((e) => scriptChange.of({ from: e.value.to, to: e.value.from })));

/** What the script's state is read from and written to (web/main.ts). */
export interface ScriptHost {
  kinds(): KindControl;
  files(): FileState<FileSystemFileHandle>;
  /** The shell setting, and a choice of it (the chip's). */
  shell(): string;
  setShell(value: string): void;
  showFile(): void;
  lang(): Lang;
  /** Whether the page has files and its own shell (the editor page; the compare page has neither). */
  withFiles: boolean;
}

/** The script's state, read and applied, and a new script's (docs/design/usability-9.md, Q8). */
export function scriptStates(host: ScriptHost) {
  const now = (): ScriptState => ({ kind: host.kinds().kind, file: host.files().snapshot(), shell: host.shell() });
  /** Makes `s` the script's state: its file (the name shown, where Save writes), the shell chosen and its kind. */
  const apply = (s: ScriptState): void => {
    host.files().restore(s.file);
    if (s.shell !== host.shell()) host.setShell(s.shell);
    if (s.kind !== host.kinds().kind) host.kinds().set(s.kind);
    else host.showFile();
  };
  /** A new script of the kind `k`: untitled, with the shell at Auto. The compare page has no file and keeps its shell: the kind alone. */
  const fresh = (k: Kind): ScriptState => (host.withFiles ? { kind: k, file: newScriptFile(), shell: 'auto' } : { ...now(), kind: k });
  /** What a toast says that a new script set back: its kind, unless the toast's first words name it (`kindSaid`), and the shell. */
  const words = (from: ScriptState, to: ScriptState, kindSaid: boolean): string => {
    const t = TEXT[host.lang()];
    return t.newScript(to.kind !== from.kind && !kindSaid ? (t.kinds[to.kind] ?? kindInfo(to.kind).name) : undefined, to.shell !== from.shell);
  };
  return {
    now, apply, fresh, words,
    /** The change of a whole script pasted over the untouched sample (`KindHost.newScript`): none on the compare page. */
    pasted: (k: Kind): ScriptChange | undefined => (host.withFiles ? { from: now(), to: fresh(k) } : undefined),
  };
}
