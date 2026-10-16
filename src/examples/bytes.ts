// UTF-8 and base64 helpers that work in Node.js and in browsers alike (no Buffer).

/** Length of a string in UTF-8 bytes. */
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Base64 of a string's UTF-8 bytes. */
export function base64Encode(text: string): string {
  let binary = '';
  for (const b of new TextEncoder().encode(text)) binary += String.fromCharCode(b);
  return btoa(binary);
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
