// The operands of `${x:-word}`, `${x#pattern}` and `${x/p/r}` read from their text, for the word model
// (src/semantics/words.ts): what bash makes of their quotes, backslashes, tildes and the variables in them (manual 3.5.3).
import { sameInEveryLocale } from './chars';
import type { Shell } from '../shellfeatures';
import { ansiCWordValue } from '../staticword';
import { hasExtglob } from '../examples/shellwords';

/** A piece of the text of a `${…}` operand: quoted or not, from the source or from an expansion in it. */
export interface Seg { text: string; quoted: boolean }

/**
 * The operand of `${x:-word}`, `${x#pattern}` or `${x/p/r}`, read from its text: quotes, backslashes, `$'…'` and
 * `$name` / `${name}` (with `param`). Undefined when it holds another expansion. `quoted`: the `${…}` is in double
 * quotes, where a backslash quotes only `$`, `` ` ``, `"`, `\` and `}`, and a single quote is a plain character.
 * `shell`: the shell the script is for (`$'…'` as `ansiCWordValue` reads it there).
 */
export function operandSegs(text: string, quoted: boolean, param: (name: string) => string | undefined, shell?: Shell): Seg[] | undefined {
  const out: Seg[] = [];
  const name = /^\$(?:([A-Za-z_]\w*)|\{([A-Za-z_]\w*)\})/;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '$') {
      const m = name.exec(text.slice(i));
      if (m) {
        const v = param(m[1] ?? m[2]);
        if (v === undefined) return undefined;
        out.push({ text: v, quoted });
        i += m[0].length - 1;
        continue;
      }
      if (!quoted && text[i + 1] === "'") {
        const end = text.indexOf("'", i + 2);
        const v = end < 0 ? undefined : ansiCWordValue(text.slice(i, end + 1), shell);
        if (v === undefined || !sameInEveryLocale(v)) return undefined;
        out.push({ text: v, quoted: true });
        i = end;
        continue;
      }
      return undefined;
    }
    if (c === '`') return undefined;
    if (c === '\\' && i + 1 < text.length) {
      if (quoted && !'$`"\\}'.includes(text[i + 1])) out.push({ text: c, quoted: true });
      out.push({ text: text[++i], quoted: true });
    } else if (c === "'" && !quoted) {
      const end = text.indexOf("'", i + 1);
      if (end < 0) return undefined;
      out.push({ text: text.slice(i + 1, end), quoted: true });
      i = end;
    } else if (c === '"') {
      const end = text.indexOf('"', i + 1);
      if (end < 0) return undefined;
      const inner = operandSegs(text.slice(i + 1, end), true, param, shell);
      if (!inner) return undefined;
      out.push({ text: '', quoted: true }, ...inner);
      i = end;
    } else out.push({ text: c, quoted });
  }
  return out;
}

/** What the operands read: the value of `$name` (undefined when not known), what a tilde prefix `~user` becomes, and the shell. */
export interface OperandValues {
  param(name: string): string | undefined;
  tilde(user: string): string | undefined;
  readonly w: { readonly shell?: Shell };
}

/**
 * The word of `${x:-word}`: split and globbed where the `${…}` is. An unquoted tilde prefix at its start expands, and
 * with `assigned` (the word of an assignment's value: `a=${x:+x:~}`) one after each `:` of its text that is not quoted.
 */
export function operandWord(text: string, quoted: boolean, ev: OperandValues, assigned: boolean): { text: string; quoted: boolean; expanded: boolean }[] | undefined {
  const out: { text: string; quoted: boolean; expanded: boolean }[] = [];
  const segs = (t: string): boolean => {
    const got = operandSegs(t, quoted, ev.param, ev.w.shell);
    out.push(...(got ?? []).map((g) => ({ text: g.text, quoted: g.quoted || quoted, expanded: true })));
    return !!got;
  };
  let at = 0;
  for (const start of quoted ? [] : operandColons(text, assigned)) {
    const m = (assigned ? /^~([^/:]*)/ : /^~([^/]*)/).exec(text.slice(start));
    if (!m) continue;
    const home = /[\\'"$`]/.test(m[1]) ? undefined : ev.tilde(m[1]);
    if (home === undefined || !segs(text.slice(at, start))) return undefined;
    out.push({ text: home, quoted: true, expanded: false });
    at = start + m[0].length;
  }
  return segs(text.slice(at)) ? out : undefined;
}

/** Where a tilde prefix may start in the word of `${x:-word}`: at its start, and with `colons` after each `:` that is not quoted. */
function operandColons(text: string, colons: boolean): number[] {
  const out = [0];
  if (!colons) return out;
  const skip = /\\.|'[^']*'|"(?:\\.|[^"\\])*"/sy;
  for (let i = 0; i < text.length; i++) {
    skip.lastIndex = i;
    const m = skip.exec(text);
    if (m) i += m[0].length - 1;
    else if (text[i] === ':') out.push(i + 1);
  }
  return out;
}

/**
 * A pattern of `${x#p}` as a glob for globToRegex: quoted characters escaped (but letters and digits). Its quotes count
 * also when the `${…}` is in double quotes (`"${x#'a'}"` removes an `a`), and so does the pattern `$p` gives (`"${x#$p}"`).
 */
export function operandPattern(text: string, ev: OperandValues): string | undefined {
  const segs = hasExtglob(text) ? undefined : operandSegs(text, false, ev.param, ev.w.shell);
  return segs?.map((g) => (g.quoted ? g.text.replace(/\W/g, '\\$&') : g.text)).join('');
}

/** The replacement of `${x/p/r}` (its quotes count as in a pattern); undefined with an unquoted `&` (the match, with patsub_replacement). */
export function operandReplacement(text: string, ev: OperandValues): string | undefined {
  const segs = operandSegs(text, false, ev.param, ev.w.shell);
  return !segs || segs.some((g) => !g.quoted && g.text.includes('&')) ? undefined : segs.map((g) => g.text).join('');
}
