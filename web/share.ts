// Links that carry a script. A link carries the script after '#', which browsers keep to themselves:
// z= is deflated, t= plain.
import { Lang } from '../src/i18n';
import { Kind, KINDS } from './samples';
import { readSessionLink, writeSessionLink } from './storage';

/** What a link holds, as far as it could be read. */
export interface SharedScript { lang?: Lang; kind?: Kind; text?: string; deflated?: Uint8Array }

/** The parameters of a link for a script: `z` (deflated) where the browser can, else `t` (plain). */
export async function encodeText(text: string): Promise<Record<string, string>> {
  const bytes = new TextEncoder().encode(text);
  if (typeof CompressionStream === 'undefined') return { t: toBase64Url(bytes) };
  const deflated = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
  return { z: toBase64Url(new Uint8Array(deflated)) };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}

const OURS = ['lang', 'kind', 't', 'z'];

/**
 * Takes the link's fragment off the address bar and keeps it for a reload of this tab (session storage). For
 * a link pasted into the open page the page does not read it at once, but a reload does, as it did when the
 * fragment stayed in the address. Other fragments stay. Returns whether there was a link.
 */
export function takeLinkFromAddress(): boolean {
  const fragment = location.hash.slice(1);
  if (window.parent !== window || !OURS.some((k) => new URLSearchParams(fragment).has(k))) return false;
  writeSessionLink(fragment);
  window.history.replaceState(window.history.state, '', location.pathname + location.search);
  return true;
}

/**
 * The language, file kind and script of the link this page was opened with. The link's fragment is read once
 * and then taken off the address bar (`replaceState`: no new history entry; other fragments, such as an
 * in-page anchor, stay). It is kept in this tab's session storage, which a reload or a return through
 * history reads again; a plain visit of the page's address shows the sample. A copy of the page in a frame
 * (the compare page, the panel) reads its address and changes nothing.
 */
export function readHash(): SharedScript {
  const fragment = location.hash.slice(1);
  if (window.parent !== window) return parseParams(fragment);
  if (takeLinkFromAddress()) return parseParams(fragment);
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (nav?.type === 'reload' || nav?.type === 'back_forward') return parseParams(readSessionLink() ?? '');
  return {};
}

/** What a link's fragment holds (`lang=…&kind=…&z=…`), as far as it could be read. */
function parseParams(fragment: string): SharedScript {
  const p = new URLSearchParams(fragment);
  const out: SharedScript = {};
  const l = p.get('lang');
  if (l === 'en' || l === 'ja') out.lang = l;
  const k = p.get('kind');
  if (KINDS.some((x) => x.kind === k)) out.kind = k as Kind;
  try {
    const t = p.get('t');
    if (t) out.text = new TextDecoder().decode(fromBase64Url(t));
    const z = p.get('z');
    if (z) out.deflated = fromBase64Url(z);
  } catch {
    // A broken link opens the sample.
  }
  return out;
}

/** The script of a deflated link; undefined when the browser cannot inflate it or it is broken. */
export async function inflate(bytes: Uint8Array): Promise<string | undefined> {
  if (typeof DecompressionStream === 'undefined') return undefined;
  try {
    return await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  } catch {
    return undefined;
  }
}

/** What follows the '#' of a link to this script in this language and file kind. */
export function scriptParams(lang: Lang, kind: Kind, text: string): Promise<URLSearchParams> {
  return encodeText(text).then((enc) => new URLSearchParams({ lang, kind, ...enc }));
}
