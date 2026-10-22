// How GNU env's `-S` (`--split-string`) splits its string into words (coreutils env.c, `build_argv`), so the
// interpreter can read them in place of the option (`env -S'-i A=1 bash -e' script`).
import type { ArgWord } from './interpret';

/** Why env refuses a string (it exits with 125 and runs nothing). */
export type EnvSplitError = 'quote' | 'backslash-end' | 'sequence' | 'c-in-quotes' | 'dollar';

/**
 * The words env makes of a `-S` string. Blanks separate words outside quotes, and so does `\_`; `'…'` keeps
 * the text (only `\\` and `\'` are escapes in it), `"…"` reads the escapes (`\_` is a space there); `#` at the
 * start of a word and `\c` end the string. `${NAME}` is replaced by the variable's value in the environment env
 * started with, which is not known here: such a word has only its known start, and one made of nothing else
 * may vanish (an unset variable gives no word). A `#` right after such a word starts a comment only when the
 * variables are unset (`${A}#x`), so the words are not known then (`unknown`).
 */
export function splitEnvString(s: string): { words: ArgWord[] } | { error: EnvSplitError; at: string } | { unknown: true } {
  const words: ArgWord[] = [];
  let cur: ArgWord | undefined;
  let sep = true;
  let sq = false;
  let dq = false;
  const start = (): ArgWord => {
    if (sep || !cur) {
      cur = { value: '' };
      words.push(cur);
      sep = false;
    }
    return cur;
  };
  /** Something that gives a word for sure: a character, or quotes. */
  const solid = (): ArgWord => {
    const w = start();
    delete w.count;
    return w;
  };
  let i = 0;
  scan: while (i < s.length) {
    const c = s[i];
    let ch = c;
    switch (c) {
      case "'":
        if (dq) break;
        sq = !sq;
        solid();
        i++;
        continue;
      case '"':
        if (sq) break;
        dq = !dq;
        solid();
        i++;
        continue;
      case ' ': case '\t': case '\n': case '\v': case '\f': case '\r':
        if (sq || dq) break;
        sep = true;
        while (i < s.length && ' \t\n\v\f\r'.includes(s[i])) i++;
        continue;
      case '#':
        if (sep) break scan;
        if (cur!.count) return { unknown: true };
        break;
      case '\\': {
        if (sq && s[i + 1] !== '\\' && s[i + 1] !== "'") break;
        const n = s[++i];
        switch (n) {
          case '"': case '#': case '$': case "'": case '\\': ch = n; break;
          case '_':
            if (!dq) { i++; sep = true; continue scan; }
            ch = ' ';
            break;
          case 'c':
            if (dq) return { error: 'c-in-quotes', at: '\\c' };
            break scan;
          case 'f': ch = '\f'; break;
          case 'n': ch = '\n'; break;
          case 'r': ch = '\r'; break;
          case 't': ch = '\t'; break;
          case 'v': ch = '\v'; break;
          case undefined: return { error: 'backslash-end', at: '\\' };
          default: return { error: 'sequence', at: '\\' + n };
        }
        break;
      }
      case '$': {
        if (sq) break;
        const m = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}/.exec(s.slice(i));
        if (!m) return { error: 'dollar', at: s.slice(i) };
        // The value is not known: the word keeps the text known before it. A variable that is set starts a
        // word, one that is not gives nothing.
        if (sep || !cur) {
          cur = { prefix: '', count: { min: 0, max: 1 } };
          words.push(cur);
          sep = false;
        } else if (cur.value !== undefined) {
          cur.prefix = cur.value;
          delete cur.value;
        }
        i += m[0].length;
        continue;
      }
    }
    const w = solid();
    if (w.value !== undefined) w.value += ch;
    i++;
  }
  // (`#` and `\c` end the string outside quotes only.)
  if (sq || dq) return { error: 'quote', at: s };
  return { words };
}
