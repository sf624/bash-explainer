// Links that carry a script. A link carries the script after '#', which browsers keep to themselves:
// z= is deflated, t= plain.
import { Lang } from '../src/i18n';
import { Kind, KINDS } from './samples';

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

/** The language, file kind and script in the page's address (`#lang=…&kind=…&z=…`). */
export function readHash(): SharedScript {
  const p = new URLSearchParams(location.hash.slice(1));
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
