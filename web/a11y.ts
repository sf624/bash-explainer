// What the page does for a keyboard and a screen reader beyond its controls' own names: the summary of the line
// explained, said in a live region as the cursor moves to another line; the hint on how to leave the editor, which
// takes the Tab key; and the key that goes from the editor to the explanation and back (F6).
import type { EditorView } from '@codemirror/view';
import type { LineExplanation } from '../src/analyzer';
import { Lang } from '../src/i18n';
import { levelCounts } from '../src/levels';
import { notesByLevel, ui } from '../src/ui/render';
import { TEXT } from './text';

/** The start of an explanation, up to its first colon, semicolon or parenthesis outside code: what the part is. */
function head(text: string): string {
  let inCode = false;
  let end = text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '`') inCode = !inCode;
    else if (!inCode && (c === ':' || c === '：' || c === ';' || c === '；' || c === '（' || (c === '(' && text[i - 1] === ' '))) {
      end = i;
      break;
    }
  }
  const said = text.slice(0, end).replace(/`/g, '').trim();
  return said.length > 80 ? `${said.slice(0, 79)}…` : said;
}

/**
 * What the live region says of a line: its number, its first part (its label, and what it is), and how many notes of
 * the levels it counts the panel shows (the level table: "Line 20: (( count++ )), Arithmetic evaluation (( )); 1 warning").
 */
export function lineSummary(ex: LineExplanation, line: number, lang: Lang): string {
  const t = TEXT[lang];
  const first = ex.items[0];
  if (!first) return t.lineSummary(line + 1, ui[lang].empty, []);
  const what = head(first.explanation);
  const part = what && what !== first.label ? t.partSaid(first.label, what) : first.label;
  return t.lineSummary(line + 1, part, levelCounts(notesByLevel(ex).map((n) => n.level), lang));
}

/**
 * The live region: says the summary of the line once the cursor has rested on another line, while the focus is in the
 * editor (typing on a line says nothing; a move with the keys does).
 */
export class LineAnnouncer {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private said = -1;

  constructor(private readonly region: HTMLElement, private readonly view: EditorView) {}

  /** The panel shows `line` now. */
  shown(ex: LineExplanation, line: number, lang: Lang): void {
    clearTimeout(this.timer);
    if (line === this.said || !this.view.hasFocus) return;
    this.timer = setTimeout(() => {
      this.said = line;
      this.region.textContent = lineSummary(ex, line, lang);
    }, 500);
  }

  /** Says a short message at once (the card opened by the keyboard). */
  say(text: string): void {
    clearTimeout(this.timer);
    this.region.textContent = text;
  }
}

/**
 * The hint on how to leave the editor (CodeMirror takes Tab to indent; Escape then Tab moves the focus on): the editor's
 * description for a screen reader, and shown for a few seconds when the focus comes into the editor by the keyboard.
 */
export function editorHint(view: EditorView, hint: HTMLElement): void {
  /** Whether the last input was the pointer's (a click, a tap), not a key's. */
  let pointer = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hide = () => {
    clearTimeout(timer);
    hint.classList.remove('shown');
  };
  document.addEventListener('pointerdown', () => { pointer = true; }, true);
  document.addEventListener('keydown', () => { pointer = false; }, true);
  view.contentDOM.addEventListener('focus', () => {
    // (A focus that follows a click or a tap is the pointer's: the hint is for the keyboard.)
    if (pointer) return;
    hint.classList.add('shown');
    clearTimeout(timer);
    timer = setTimeout(hide, 6000);
  });
  view.contentDOM.addEventListener('blur', hide);
  view.contentDOM.addEventListener('pointerdown', hide);
}

/** The name of the editor's text box in the page's language, and its description where the page has the hint. */
export function editorAttributes(lang: Lang): Record<string, string> {
  return { 'aria-label': TEXT[lang].editor, ...(document.getElementById('editor-hint') ? { 'aria-describedby': 'editor-hint' } : {}) };
}

/** Whether a key is the one that goes between the editor and the explanation: F6, or Shift+F6 back (not while an input method composes: a Japanese one converts with F6 to F10). */
export const isPaneKey = (e: KeyboardEvent) => e.key === 'F6' && !e.isComposing && e.keyCode !== 229 && !e.ctrlKey && !e.metaKey && !e.altKey;
