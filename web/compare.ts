// The two ends of the compare page.
//  - compare mode (compare.html): the editor and two frames, each holding a copy of this page in panel mode,
//    this build's and another build's. The page sends them the script and the cursor and shows their explanations.
//  - panel mode (`?view=panel`): the copy in a frame. It receives the script and asks the page around it to
//    reveal or mark a span, or to change the shell.
// The messages are in protocol.ts.
import { Span } from '../src/analyzer';
import { Lang } from '../src/i18n';
import { CHANNEL, UP } from './build-info';
import { $ } from './dom';
import { CopyInfo, CopyState, FromCopy, THEMES, ToCopy } from './protocol';
import { TEXT } from './text';

/** Which copy to compare with: main from a preview, the release from main, main from the release; `?with=` decides. */
const withParam = new URLSearchParams(location.search).get('with');
const otherTarget: 'release' | 'next' = withParam === 'release' || withParam === 'next' ? withParam : CHANNEL === 'next' ? 'release' : 'next';
/** How long a copy has to answer the handshake. */
const HANDSHAKE_MS = 4000;

interface Copy { column: HTMLElement; head: HTMLElement; frame: HTMLIFrameElement; note: HTMLElement; info?: CopyInfo; own: boolean }

function copyName(lang: Lang, c: CopyInfo): string {
  const t = TEXT[lang];
  return c.channel === 'pr' ? `PR #${c.pr} (${c.commit})` : c.channel === 'next' ? `main (${c.commit})` : `${t.otherNames.release} v${c.version}`;
}

/** What the compare page asks of the page's editor and state. */
export interface CompareHost {
  lang(): Lang;
  /** Everything a copy needs: the script, the cursor, the language, the theme and the settings. */
  state(): CopyState;
  /** A click in a copy's panel: select the span in the script. */
  reveal(span: Span, preserveFocus?: boolean): void;
  /** The pointer on a part of a copy's explanation (null: no longer). */
  highlight(span: Span | null): void;
  /** The shell or yq chosen in a copy's panel: the choice is for both copies. */
  choose(key: 'shell' | 'yq', value: string): void;
}

/** The compare page's two frames. */
export class Compare {
  private readonly copies: Copy[] = [true, false].map((own) => {
    const id = own ? 'this' : 'other';
    return { own, column: $(`col-${id}`), head: $(`head-${id}`), frame: $<HTMLIFrameElement>(`frame-${id}`), note: $(`note-${id}`) };
  });

  constructor(private readonly host: CompareHost) {
    window.addEventListener('message', (e) => {
      const c = this.copies.find((x) => x.frame.contentWindow === e.source);
      if (!c || e.origin !== location.origin) return;
      const m = e.data as FromCopy;
      switch (m?.type) {
        case 'bx-ready': {
          c.info = { channel: m.channel, version: m.version, pr: m.pr, commit: m.commit };
          c.frame.hidden = false;
          c.note.hidden = true;
          this.showHeads();
          return this.sendState();
        }
        case 'bx-reveal':
          return host.reveal(m.span, m.preserveFocus);
        case 'bx-highlight':
          return host.highlight(m.span);
        case 'bx-choice':
          return host.choose(m.key, m.value);
      }
    });
    for (const c of this.copies) {
      c.frame.hidden = true;
      c.frame.src = c.own ? './?view=panel' : `${UP}${otherTarget === 'next' ? 'next/' : ''}?view=panel`;
    }
    this.showHeads();
    // A copy built before panel mode existed (or a page that is not there) never answers: say so.
    setTimeout(() => {
      for (const c of this.copies) if (!c.info) c.note.hidden = false;
    }, HANDSHAKE_MS);
  }

  showHeads(): void {
    const lang = this.host.lang();
    const t = TEXT[lang];
    for (const c of this.copies) {
      c.head.textContent = c.info ? copyName(lang, c.info) : c.own ? t.loading : `${t.otherNames[otherTarget]}…`;
      c.note.textContent = t.cannot;
    }
  }

  /** Sends the script, the cursor and the rest to the copies that have answered the handshake. */
  sendState(): void {
    const m: ToCopy = { type: 'bx-state', ...this.host.state() };
    for (const c of this.copies) if (c.info) c.frame.contentWindow?.postMessage(m, location.origin);
  }
}

/** In panel mode: says something to the page around. */
export function toParent(message: FromCopy): void {
  if (window.parent !== window) window.parent.postMessage(message, location.origin);
}

/** In panel mode: hands every state the page around sends to `apply`. */
export function receiveState(apply: (m: CopyState) => void): void {
  window.addEventListener('message', (e) => {
    const m = e.data as ToCopy | undefined;
    if (window.parent === window || e.source !== window.parent || e.origin !== location.origin || m?.type !== 'bx-state') return;
    if (THEMES.includes(m.theme)) apply(m);
  });
}
