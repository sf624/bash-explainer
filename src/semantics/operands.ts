// The operands of `${x:-word}`, `${x#pattern}` and `${x/p/r}` read from their text, for the word model
// (src/semantics/words.ts): what bash makes of their quotes, backslashes and the variables in them (manual 3.5.3).
import { sameInEveryLocale } from './chars';
import type { Shell } from '../shellfeatures';
import { ansiCWordValue } from '../staticword';

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
