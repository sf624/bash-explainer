import type { Shell } from '../dialect';
import type { HostKind, NoShell, RegionNote, ShellRegion, HostSubstitution, Extracted } from './index';

/** Japanese text followed by more: a space after a closing backtick, so the code span ends. */
export const spaced = (ja: string) => (ja.endsWith('`') ? `${ja} ` : ja);

/** Builds the shell text of one line from pieces of the original line and inserted text. */
export class LineOut {
  text = '';
  map: number[] = [];
  /** Original end (exclusive) of each character. */
  ends: number[] = [];
  /** Ranges [start, end) of the shell text that stand in for host syntax, with what it means. */
  inserted: [number, number, [string, string]?][] = [];
  /** Copy original columns [from, to). */
  copy(line: string, from: number, to: number): void {
    for (let i = from; i < to; i++) {
      this.text += line[i];
      this.map.push(i);
      this.ends.push(i + 1);
    }
  }
  /** Insert `text` standing for original columns [from, to). */
  insert(text: string, from: number, to: number, meaning?: [string, string]): void {
    if (text.length > 1) this.inserted.push([this.text.length, this.text.length + text.length, meaning]);
    for (let i = 0; i < text.length; i++) {
      this.text += text[i];
      this.map.push(from);
      this.ends.push(to);
    }
  }
  finish(end: number): number[] {
    // The end of the shell text is just after the last character it came from.
    return [...this.map, this.ends.length ? this.ends[this.ends.length - 1] : end];
  }
}

export class Builder {
  lines: string[];
  outs: (LineOut | undefined)[];
  regions: ShellRegion[] = [];
  substitutions: HostSubstitution[] = [];
  /** Azure Pipelines: variables whose `$(name)` macros the pipeline replaces before the script runs. */
  azure?: { vars: Set<string> };
  /** Variables the host sets for every script of the file (`ShellRegion.provided`). */
  provided: string[] = [];
  constructor(text: string, readonly kind: HostKind) {
    this.lines = text.split(/\r?\n/);
    this.outs = this.lines.map(() => undefined);
  }
  /** Use original columns [from, to) of `line` as shell code, unchanged. */
  plain(line: number, from = 0, to = this.lines[line].length): LineOut {
    const o = (this.outs[line] ??= new LineOut());
    o.copy(this.lines[line], from, to);
    return o;
  }
  region(start: number, end: number, label: [string, string], shell?: Shell, notes?: RegionNote[], warnPipefail?: boolean): void {
    if (end >= start) this.regions.push({ start, end, label, host: { kind: this.kind }, shell, notes, warnPipefail });
  }
  /**
   * A region of words run with no shell (`ShellRegion.noShell`), written by `execWords`; its code is read as bash's
   * words. `word`: what each word is in the file (a JSON string).
   */
  execRegion(start: number, end: number, label: [string, string], notes: RegionNote[], word: NoShell['word']): void {
    if (end >= start) this.regions.push({ start, end, label, host: { kind: this.kind }, shell: 'bash', notes, noShell: { word } });
  }
  build(): Extracted {
    const provided = [...new Set(this.provided)];
    if (provided.length) for (const r of this.regions) r.provided = provided;
    const maps = this.lines.map((l, i) => this.outs[i]?.finish(l.length) ?? [l.length]);
    return { text: this.outs.map((o) => o?.text ?? '').join('\n'), maps, inserted: this.outs.map((o) => o?.inserted ?? []), regions: this.regions, substitutions: this.substitutions };
  }
}

export function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}
