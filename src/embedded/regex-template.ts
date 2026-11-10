// The replacement template of Python's `re.sub` and `re.subn` (docs/design/python-regex.md, section 6): `re.sub(p, r'\2 at \1', s)`.
// It is read as `parse_template` of Python's `re._parser` reads it, by the same tokenizer (an escape is a backslash and the
// character after it), with the groups of the pattern: its parts, which the example puts together for each match, and its
// items, which become the tokens. One reading serves both, so that the example applies what the tokens say.
import type { Lang } from '../i18n';
import { tokenSaid } from '../messages-tokens';
import { groupNameRefused, pyRepr, Refusal, Tokens } from './regex-python';
import { type EmbeddedToken, hasHole, holeStop, holeToken, isHole } from './types';

/** A part of a template as Python applies it: text, or the number of a group whose text goes there (0, the whole match). */
export type TemplatePart = string | number;

/** The capture groups of the pattern a template is for: how many, and the number of each named one (`readRegex`). */
export interface TemplateGroups { count: number; names: ReadonlyMap<string, number> }

/**
 * What a template is made of, in the order written: plain text, a character by an escape (`\n`, `\\`, `\012`), an escape Python
 * keeps as written as it is no ASCII letter (`\-`), a group (by number, or by name: `group` not known where the pattern's groups
 * are not), the refusal Python raises (an exception: `re.error` or, for a name the pattern lacks, `IndexError`), a field of an
 * f-string, and an escape whose reading the value of a field after it decides (`\{n}`, `\1{n}`).
 */
type Item = { start: number; end: number } & (
  | { kind: 'text' | 'kept' | 'hole' | 'stop' }
  | { kind: 'char'; code: number }
  | { kind: 'group'; group?: number; name?: string }
  | { kind: 'error'; message: string; raises: 're.error' | 'IndexError' });

/** A template read: its items, and its parts where Python applies it (no error, no field, the groups known). */
export interface Template { items: Item[]; parts?: TemplatePart[] }

/** The escapes of one character of a template (`ESCAPES` of Python's `re._parser`). */
const ESCAPES: Readonly<Record<string, number>> = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, '\\': 92 };

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
const isOctal = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '7';

/**
 * The template `src` (the value of the literal; a field of an f-string is a hole) of a pattern with the groups `groups` (none where they
 * are not known), as Python reads it; `bytes`, a bytes template, whose messages write a character past ASCII as `\xNN`.
 */
export function readTemplate(src: string, groups: TemplateGroups | undefined, bytes: boolean): Template {
  const items: Item[] = [];
  const s = new Tokens(src);
  let stopped = false;
  let at = 0;
  const add = (item: Item) => {
    const last = items[items.length - 1];
    if (item.kind === 'text' && last?.kind === 'text' && last.end === item.start) last.end = item.end;
    else items.push(item);
  };
  const group = (start: number, index: number, offset: number, name?: string) => {
    if (groups && index > groups.count) throw s.error(`invalid group reference ${index}`, offset);
    add({ start, end: s.tell(), kind: 'group', group: index, ...(name !== undefined ? { name } : {}) });
  };
  try {
    s.advance();
    for (;;) {
      const start = (at = s.tell());
      const t = s.get();
      if (t === undefined) break;
      if (t.length === 1) {
        add({ start, end: start + 1, kind: isHole(t) ? 'hole' : 'text' });
        continue;
      }
      const c = t[1];
      // (A field's value would be read with the escape: `\{n}`, `\g<{n}>`, `\1{n}`, whose digits may go on.)
      if (isHole(c) || ((isDigit(c) || c === 'g') && isHole(s.next))) {
        add({ start, end: start + 2, kind: 'stop' });
        stopped = true;
        break;
      }
      if (c === 'g') {
        if (s.next !== '<') throw s.error('missing <');
        s.get();
        let name = '';
        for (;;) {
          const n = s.get();
          if (n === undefined) throw name ? s.error('missing >, unterminated name', name.length) : s.error('missing group name');
          if (n === '>') {
            if (!name) throw s.error('missing group name', 1);
            break;
          }
          if ([...n].some(isHole)) {
            add({ start, end: s.tell(), kind: 'stop' });
            stopped = true;
            break;
          }
          name += n;
        }
        if (stopped) break;
        if (/^[0-9]+$/.test(name)) {
          // (`\g<007>` is group 7, said as Python's `int` writes it.)
          const index = name.replace(/^0+(?=.)/, '');
          if (groups && (index.length > 15 || Number(index) > groups.count)) throw s.error(`invalid group reference ${index}`, name.length + 1);
          add({ start, end: s.tell(), kind: 'group', group: Number(index) });
          continue;
        }
        const bad = groupNameRefused(name, bytes);
        if (bad) throw s.error(bad, name.length + 1);
        if (!groups) {
          add({ start, end: s.tell(), kind: 'group', name });
          continue;
        }
        const index = groups.names.get(name);
        if (index === undefined) throw new Refusal(`unknown group name ${pyRepr(name, false)}`, 'IndexError');
        group(start, index, name.length + 1, name);
      } else if (c === '0') {
        let digits = '0';
        if (isOctal(s.next)) digits += s.get();
        if (isOctal(s.next)) digits += s.get();
        if (digits.length < 3 && isHole(s.next)) {
          add({ start, end: s.tell(), kind: 'stop' });
          stopped = true;
          break;
        }
        add({ start, end: s.tell(), kind: 'char', code: parseInt(digits, 8) & 0xff });
      } else if (isDigit(c)) {
        let digits = c;
        if (isDigit(s.next)) {
          digits += s.get();
          // (`\12{n}`: a third digit of the value would make it a character.)
          if (isOctal(c) && isOctal(digits[1]) && isHole(s.next)) {
            add({ start, end: s.tell(), kind: 'stop' });
            stopped = true;
            break;
          }
          if (isOctal(c) && isOctal(digits[1]) && isOctal(s.next)) {
            digits += s.get();
            const code = parseInt(digits, 8);
            if (code > 0o377) throw s.error(`octal escape value \\${digits} outside of range 0-0o377`, digits.length + 1);
            add({ start, end: s.tell(), kind: 'char', code });
            continue;
          }
        }
        group(start, Number(digits), digits.length);
      } else if (c in ESCAPES) {
        add({ start, end: start + 2, kind: 'char', code: ESCAPES[c] });
      } else if (/[A-Za-z]/.test(c)) {
        throw s.error(`bad escape ${t}`, 2);
      } else {
        add({ start, end: start + 2, kind: 'kept' });
      }
    }
  } catch (e) {
    /* c8 ignore next */
    if (!(e instanceof Refusal)) throw e;
    // (At the escape being read, to where the reading stopped; a backslash at the end, itself.)
    const from = e.at ?? at;
    items.push({ start: from, end: Math.min(src.length, e.at === undefined ? Math.max(s.tell(), from + 1) : from + 1), kind: 'error', message: e.message, raises: e.raises });
  }
  const applies = !stopped && items.every((i) => i.kind !== 'error' && i.kind !== 'hole' && (i.kind !== 'group' || i.group !== undefined));
  return { items, ...(applies && groups ? { parts: partsOf(src, items) } : {}) };
}

/** The parts Python applies, with the runs of text joined. */
function partsOf(src: string, items: readonly Item[]): TemplatePart[] {
  const parts: TemplatePart[] = [];
  for (const i of items) {
    const part = i.kind === 'group' ? i.group! : i.kind === 'char' ? String.fromCharCode(i.code) : src.slice(i.start, i.end);
    if (typeof part === 'string' && typeof parts[parts.length - 1] === 'string') parts[parts.length - 1] += part;
    else parts.push(part);
  }
  return parts;
}

/**
 * The tokens of a template read: none for one with no backslash and no field, which Python puts in as it is; else each item's, from the catalog.
 * A refusal takes the rest of the template, as Python reads no further.
 */
export function templateTokens(src: string, t: Template, lang: Lang): EmbeddedToken[] {
  if (!src.includes('\\') && !hasHole(src)) return [];
  return t.items.map((i): EmbeddedToken => {
    const written = src.slice(i.start, i.end);
    const tok = (kind: EmbeddedToken['kind'], explanation: string, extra: Partial<EmbeddedToken> = {}): EmbeddedToken => ({ start: i.start, end: i.end, kind, explanation, children: [], ...extra });
    switch (i.kind) {
      case 'text': return tok('string', tokenSaid(lang, 'python-template-text', { text: written }));
      case 'char': return tok('string', tokenSaid(lang, 'python-template-char', { written, code: i.code }));
      case 'kept': return tok('string', tokenSaid(lang, 'python-template-kept', { written }));
      case 'group': return tok('variable', i.group === 0 ? tokenSaid(lang, 'python-template-match', { written }) : tokenSaid(lang, 'python-template-group', { written, group: i.group, name: i.name }), i.group ? { group: i.group } : {});
      case 'error': return tok('error', tokenSaid(lang, 'regex-python-template-error', { message: i.message, raises: i.raises }));
      case 'hole': return holeToken(i.start, 'python-template');
      case 'stop': return holeStop(i.start);
    }
  });
}
