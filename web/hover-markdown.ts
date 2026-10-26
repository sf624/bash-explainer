// The reader of the hover's Markdown on the web page (docs/design/hover.md, "Web page"). The cards are the very Markdown
// that VS Code shows (src/ui/hoverView.ts), so they have one source; this file turns it into DOM, as VS Code's hover
// does: Markdown into HTML, then only an allow-list of elements and attributes is kept.
//
// It reads the CommonMark that hoverView writes, by CommonMark's rules: paragraphs, thematic breaks, ATX and setext
// headings, quotes, fenced code and HTML blocks (`<table>`); inline, code spans of any length, backslash escapes,
// entities, raw HTML tags, links with a title, emphasis and strong emphasis by the rules of delimiter runs, and
// VS Code's `$(icon)`. Lists and indented code are not read: hoverView writes none in the cards.
import { REFERENCE_URLS } from '../src/references';
import { drawIcon } from './icons';

/*
 * The only web pages a card links to: the references, the manual's sections and the manual pages (`REFERENCE_URLS`, from
 * the tables hoverView and render.ts build the links from). The script is the reader's to share, so a link the script
 * could write is never kept; an href is kept only when it is exactly one of these.
 */

/** The Codicons the cards use (media/icons.js); another `$(name)` draws nothing, as an unknown icon in VS Code. */
export const CARD_ICONS = new Set(['warning', 'info', 'gear', 'list-tree', 'comment-discussion']);

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => escText(s).replace(/"/g, '&quot;');

/** ASCII punctuation, which a backslash escapes. */
const ASCII_PUNCT = /[!-/:-@[-`{-~]/;
const PUNCT = /[\p{P}\p{S}]/u;
const SPACE = /\s/;
/** A raw HTML tag (an open or a closing tag, with attributes). */
const TAG = /^(?:<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>)/;
const ENTITY = /^&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/;
const ICON = /^\$\(([A-Za-z0-9-]+)(?:~[A-Za-z]+)?\)/;

/** A run of `*` or `_`, with what it can still do (CommonMark 6.2). */
interface Delim { char: '*' | '_'; n: number; canOpen: boolean; canClose: boolean; open: string[]; close: string[] }
type Piece = string | Delim;

/** Where a code span that opens with `ticks` backticks at `from` closes, or -1. */
function closingTicks(s: string, from: number, ticks: number): number {
  for (let i = from; i < s.length;) {
    if (s[i] !== '`') {
      i++;
      continue;
    }
    let j = i;
    while (s[j] === '`') j++;
    if (j - i === ticks) return i;
    i = j;
  }
  return -1;
}

/** Where the `]` that closes the label opened at `from - 1` is (brackets nest; code spans and escapes are skipped), or -1. */
function closingBracket(s: string, from: number): number {
  let depth = 0;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') i++;
    else if (c === '`') {
      let j = i;
      while (s[j] === '`') j++;
      const end = closingTicks(s, j, j - i);
      i = end < 0 ? j - 1 : end + (j - i) - 1;
    } else if (c === '[') depth++;
    else if (c === ']' && depth-- === 0) return i;
  }
  return -1;
}

/** Inline Markdown to HTML. */
export function inline(s: string): string {
  const pieces: Piece[] = [];
  let text = '';
  const push = (html: string) => {
    text += html;
  };
  const flush = () => {
    if (text) pieces.push(text);
    text = '';
  };
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && ASCII_PUNCT.test(s[i + 1])) {
      push(escText(s[i + 1]));
      i += 2;
    } else if (c === '`') {
      let j = i;
      while (s[j] === '`') j++;
      const end = closingTicks(s, j, j - i);
      if (end < 0) {
        push(s.slice(i, j));
        i = j;
        continue;
      }
      let code = s.slice(j, end).replace(/\n/g, ' ');
      if (/^ [\s\S]* $/.test(code) && code.trim()) code = code.slice(1, -1);
      push(`<code>${escText(code)}</code>`);
      i = end + (j - i);
    } else if (c === '<') {
      const m = TAG.exec(s.slice(i));
      push(m ? m[0] : '&lt;');
      i += m ? m[0].length : 1;
    } else if (c === '&') {
      const m = ENTITY.exec(s.slice(i));
      push(m ? m[0] : '&amp;');
      i += m ? m[0].length : 1;
    } else if (c === '$' && ICON.test(s.slice(i))) {
      const m = ICON.exec(s.slice(i))!;
      if (CARD_ICONS.has(m[1])) push(`<span data-icon="${m[1]}"></span>`);
      i += m[0].length;
    } else if (c === '[') {
      const close = closingBracket(s, i + 1);
      const dest = close < 0 ? null : /^\(\s*(?:<([^<>\n]*)>|([^\s()<>]+))(?:\s+"([^"]*)")?\s*\)/.exec(s.slice(close + 1));
      if (!dest) {
        push('[');
        i++;
        continue;
      }
      const href = dest[1] ?? dest[2];
      const title = dest[3] === undefined ? '' : ` title="${escAttr(dest[3].replace(/\\([!-/:-@[-`{-~])/g, '$1'))}"`;
      push(`<a href="${escAttr(href)}"${title}>${inline(s.slice(i + 1, close))}</a>`);
      i = close + 1 + dest[0].length;
    } else if (c === '*' || c === '_') {
      let j = i;
      while (s[j] === c) j++;
      const before = i ? s[i - 1] : ' ';
      const after = j < s.length ? s[j] : ' ';
      const left = !SPACE.test(after) && (!PUNCT.test(after) || SPACE.test(before) || PUNCT.test(before));
      const right = !SPACE.test(before) && (!PUNCT.test(before) || SPACE.test(after) || PUNCT.test(after));
      flush();
      pieces.push({
        char: c, n: j - i,
        canOpen: c === '*' ? left : left && (!right || PUNCT.test(before)),
        canClose: c === '*' ? right : right && (!left || PUNCT.test(after)),
        open: [], close: [],
      });
      i = j;
    } else {
      push(c === '>' ? '&gt;' : c);
      i++;
    }
  }
  flush();
  emphasis(pieces);
  return pieces.map((p) => (typeof p === 'string' ? p : p.close.join('') + p.char.repeat(p.n) + p.open.join(''))).join('');
}

/** Matches the runs of `*` and `_` into `<em>` and `<strong>` (CommonMark's "process emphasis", without its shortcuts). */
function emphasis(pieces: Piece[]): void {
  for (let c = 0; c < pieces.length; c++) {
    const closer = pieces[c];
    if (typeof closer === 'string' || !closer.canClose) continue;
    while (closer.n > 0) {
      let o = c - 1;
      for (; o >= 0; o--) {
        const p = pieces[o];
        if (typeof p === 'string' || p.char !== closer.char || !p.canOpen || !p.n) continue;
        // The rule of three: a run that can both open and close does not pair with one whose sum is a multiple of 3.
        if ((p.canClose || closer.canOpen) && (p.n + closer.n) % 3 === 0 && (p.n % 3 || closer.n % 3)) continue;
        break;
      }
      if (o < 0) break;
      const opener = pieces[o] as Delim;
      const use = opener.n >= 2 && closer.n >= 2 ? 2 : 1;
      const tag = use === 2 ? 'strong' : 'em';
      opener.n -= use;
      closer.n -= use;
      opener.open.unshift(`<${tag}>`);
      closer.close.push(`</${tag}>`);
      // The runs between them stay text.
      for (let k = o + 1; k < c; k++) {
        const p = pieces[k];
        if (typeof p !== 'string') Object.assign(p, { canOpen: false, canClose: false });
      }
    }
  }
}

/** The tags that start an HTML block of CommonMark's kind 6 (it ends at a blank line); those hoverView writes, and a few more. */
const HTML_BLOCK = /^ {0,3}<\/?(?:table|thead|tbody|tfoot|tr|td|th|div|p|hr|blockquote|h[1-6]|ul|ol|li|details|summary)(?:\s|\/?>|$)/i;

/** hoverView's Markdown to HTML, block by block. */
export function markdownToHtml(md: string): string {
  const lines = md.split('\n');
  const html: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) html.push(`<p>${inline(para.join('\n').trim())}</p>`);
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    let m: RegExpExecArray | null;
    if (fence) {
      flush();
      const body: string[] = [];
      const close = new RegExp(`^ {0,3}${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}\\s*$`);
      while (++i < lines.length && !close.test(lines[i])) body.push(lines[i]);
      html.push(`<pre><code>${escText(body.join('\n'))}</code></pre>`);
    } else if (!line.trim()) flush();
    else if (para.length && (m = /^ {0,3}(=+|-+)\s*$/.exec(line))) {
      // A setext heading: the paragraph above is its text.
      const level = m[1][0] === '=' ? 1 : 2;
      html.push(`<h${level}>${inline(para.join('\n').trim())}</h${level}>`);
      para = [];
    } else if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      flush();
      html.push('<hr>');
    } else if ((m = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(line))) {
      flush();
      html.push(`<h${m[1].length}>${inline(m[2] ?? '')}</h${m[1].length}>`);
    } else if (HTML_BLOCK.test(line)) {
      // (A block of kind 6 can interrupt a paragraph.)
      flush();
      const body: string[] = [];
      for (; i < lines.length && lines[i].trim(); i++) body.push(lines[i]);
      html.push(body.join('\n'));
    } else if (/^ {0,3}>/.test(line)) {
      flush();
      // A quote, with its lazy lines (a paragraph's lines without the `>`).
      const body: string[] = [];
      for (; i < lines.length && lines[i].trim(); i++) body.push(lines[i].replace(/^ {0,3}> ?/, ''));
      i--;
      html.push(`<blockquote>${markdownToHtml(body.join('\n'))}</blockquote>`);
    } else para.push(line);
  }
  flush();
  return html.join('\n');
}

// ---- The allow-list ---------------------------------------------------------------------------------

/** The elements a card keeps (a subset of what VS Code's hover keeps: test/hover-view.test.ts); others leave their text. */
const ELEMENTS = new Set(['P', 'HR', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'CODE', 'B', 'STRONG', 'I', 'EM', 'SMALL', 'BR', 'SPAN', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'A']);
/** Elements dropped with what they hold. */
const DROPPED = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'TEXTAREA', 'SELECT', 'SVG', 'MATH']);
/** The one shape of `style` that VS Code's hover keeps on a span (src/ui/render.ts, `colored`). */
const STYLE = /^(color:(#[0-9a-fA-F]{3,8}|var\(--vscode(-[a-zA-Z0-9]+)+\));)?(background-color:(#[0-9a-fA-F]{3,8}|var\(--vscode(-[a-zA-Z0-9]+)+\));)?(display:inline-block;)?(border-radius:\d+px;)?$/;

/** Copies the nodes of `from` into `to`, with only the allowed elements and attributes. */
function sanitize(from: Node, to: Node): void {
  for (const n of Array.from(from.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE) to.appendChild(document.createTextNode(n.textContent ?? ''));
    if (n.nodeType !== Node.ELEMENT_NODE) continue;
    const el = n as Element;
    const tag = el.tagName.toUpperCase();
    if (DROPPED.has(tag)) continue;
    if (!ELEMENTS.has(tag)) {
      sanitize(el, to);
      continue;
    }
    const copy = document.createElement(tag.toLowerCase());
    const style = el.getAttribute('style');
    if (tag === 'SPAN' && style && STYLE.test(style)) copy.setAttribute('style', style);
    const title = el.getAttribute('title');
    if (title && (tag === 'SPAN' || tag === 'A')) copy.setAttribute('title', title);
    const icon = el.getAttribute('data-icon');
    if (tag === 'SPAN' && icon && CARD_ICONS.has(icon)) copy.setAttribute('data-icon', icon);
    if (tag === 'A') {
      const href = el.getAttribute('href') ?? '';
      // A page of a reference opens in a new tab; a command of the extension becomes the page's own action (web/hover.ts).
      // Any other link loses its address and keeps its text.
      if (REFERENCE_URLS.has(href)) Object.assign(copy, { href, target: '_blank', rel: 'noopener noreferrer' });
      else if (/^command:[\w.]+/.test(href)) {
        copy.setAttribute('data-command', /^command:([\w.]+)/.exec(href)![1]);
        copy.setAttribute('role', 'link');
        copy.tabIndex = 0;
      } else {
        sanitize(el, to);
        continue;
      }
    }
    to.appendChild(copy);
    sanitize(el, copy);
  }
}

/** The DOM of a card, from Markdown: read, kept to the allow-list, its icons drawn. */
export function renderCard(md: string): HTMLElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = markdownToHtml(md);
  const root = document.createElement('div');
  root.className = 'cm-bx-hover';
  sanitize(tpl.content, root);
  for (const span of Array.from(root.querySelectorAll<HTMLElement>('span[data-icon]'))) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('class', 'cm-bx-hover-icon');
    svg.setAttribute('aria-hidden', 'true');
    drawIcon(svg, span.dataset.icon!);
    span.replaceWith(svg);
  }
  return root;
}
