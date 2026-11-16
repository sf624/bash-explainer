// UTF-8 and base64 helpers that work in Node.js and in browsers alike (no Buffer).

/** Length of a string in UTF-8 bytes. */
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * A string's UTF-8 bytes as a string of one character per byte (U+0000 to U+00FF), for a tool that works on bytes
 * (GNU `tr`, `cut`, `head -c`): an ASCII text is the same string.
 */
export function utf8Bytes(text: string): string {
  let out = '';
  for (const b of new TextEncoder().encode(text)) out += String.fromCharCode(b);
  return out;
}

/** The text of bytes `utf8Bytes` gives (or a tool made of them), or undefined where they are not valid UTF-8. */
export function utf8Text(bytes: string): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes, (c) => c.charCodeAt(0)));
  } catch {
    return undefined;
  }
}

/** The whole characters of such bytes, in order: the bytes of no character are left out. */
export function utf8Lossy(bytes: string): string {
  return new TextDecoder().decode(Uint8Array.from(bytes, (c) => c.charCodeAt(0))).split('\ufffd').join('');
}

/** Base64 of a string's UTF-8 bytes. */
export function base64Encode(text: string): string {
  return btoa(utf8Bytes(text));
}

/**
 * Decodes base64 (standard or URL-safe) to a UTF-8 string, as leniently as Node.js's Buffer:
 * other characters are skipped, padding is optional, and invalid UTF-8 becomes U+FFFD.
 */
export function base64Decode(text: string): string {
  let clean = text.replace(/-/g, '+').replace(/_/g, '/').replace(/=.*$/s, '').replace(/[^A-Za-z0-9+/]/g, '');
  // A single leftover character carries no whole byte.
  if (clean.length % 4 === 1) clean = clean.slice(0, -1);
  const binary = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}
