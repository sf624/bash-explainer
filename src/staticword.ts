import { bracketEnd } from './bracket';
import { visible } from './ctlchars';
import type { EmbeddedLang } from './embedded/types';
import { bracesMayWork, featureWorks, type Shell } from './shellfeatures';
import type { SyntaxNode } from './syntax/tree';

/** The characters `$'…'` turns a one-letter escape into. */
const ANSI_ESCAPES: Record<string, string> = {
  a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?',
};

/**
 * The text `$'…'` stands for (the part between the quotes), cut at a NUL as bash does.
 * Undefined when it holds a byte above 0x7f (`\xe3`): only the shell's encoding says what that is.
 */
export function ansiCValue(body: string): string | undefined {
  let out = '';
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '\\' || i + 1 >= body.length) { out += body[i]; continue; }
    const c = body[++i];
    // (bash 5.2 also reads `\x{H…}`: not followed.)
    if (body.startsWith('x{', i)) return undefined;
    const num = /^(?:x([0-9A-Fa-f]{1,2})|u([0-9A-Fa-f]{1,4})|U([0-9A-Fa-f]{1,8})|([0-7]{1,3}))/.exec(body.slice(i));
    if (num) {
      i += num[0].length - 1;
      const code = num[1] ? parseInt(num[1], 16) : num[2] ? parseInt(num[2], 16) : num[3] ? parseInt(num[3], 16) : parseInt(num[4], 8) & 0xff;
      if (code === 0) return out;
      if (code > 0x10ffff || (code > 0x7f && (num[1] || num[4]))) return undefined;
      out += String.fromCodePoint(code);
    } else if (c === 'c' && i + 1 < body.length) {
      // (`\c?` is DEL; `\c\\` reads the escaped backslash; `\c@` is NUL, which ends the string.)
      const ch = body[++i];
      if (ch === '\\' && body[i + 1] === '\\') i++;
      const code = ch === '?' ? 0x7f : ch.charCodeAt(0) & 0x1f;
      if (code === 0) return out;
      out += String.fromCharCode(code);
    } else out += Object.hasOwn(ANSI_ESCAPES, c) ? ANSI_ESCAPES[c] : '\\' + c;
  }
  return out;
}

/**
 * What the `$'…'` string `text` (with its `$'` and `'`) is in a script for `shell` (bash when absent): its escapes
 * decoded where the shell has `$'…'`. dash has not: there `$` is text and `'…'` a single-quoted string, so
 * `$'a\tb'` is `$a\tb` (dash 0.5.12). Undefined in POSIX sh, which may be dash or a shell that decodes it, in the
 * other shells without it, and in dash when the body holds a `\'`, where dash's quote ends earlier than the tree's.
 */
export function ansiCWordValue(text: string, shell?: Shell): string | undefined {
  const body = text.slice(2, -1);
  if (featureWorks('ansiC', shell)) return ansiCValue(body);
  return shell === 'dash' && !body.includes("'") ? `$${body}` : undefined;
}

/**
 * The text of a pattern replacement or similar piece of a word after quote removal, from its source text
 * (`\}` is `}`, `"a b"` is `a b`). Undefined if it holds an expansion (`$x`, `$(…)`, backticks).
 */
export function unquoteWord(text: string, inDouble = false): string | undefined {
  let out = '';
  // Inside a double-quoted `${u-…}`, a backslash only escapes `$`, a backtick, `"`, `\` and `}`, a single quote is plain text,
  // and a double quote opens a string of its own.
  const escapes = inDouble ? '$`"\\}' : '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && i + 1 < text.length) {
      if (inDouble && !escapes.includes(text[i + 1])) out += c;
      else out += text[++i];
    } else if (c === "'" && !inDouble) {
      const end = text.indexOf("'", i + 1);
      if (end < 0) return undefined;
      out += text.slice(i + 1, end);
      i = end;
    } else if (c === '"') {
      let j = i + 1;
      for (; j < text.length && text[j] !== '"'; j++) {
        if (text[j] === '\\' && /[$`\\"]/.test(text[j + 1] ?? '')) j++;
        else if (text[j] === '$' || text[j] === '`') return undefined;
        out += text[j];
      }
      if (j >= text.length) return undefined;
      i = j;
    } else if (c === '$' || c === '`') return undefined;
    else out += c;
  }
  return out;
}

/**
 * The text a word gives as a message (`${x:?"msg"}` prints `msg`): without its quotes; when it expands something
 * (`"no $f"`), without the outer quotes of a word that is one double-quoted string. A word that is one `$'…'` is
 * the text it stands for, with its control characters as pictures (`$'a\tb'` is `a⇥b`).
 */
export function messageText(text: string): string {
  const ansi = /^\$'((?:[^'\\]|\\.)*)'$/s.exec(text);
  const value = ansi ? ansiCValue(ansi[1]) : undefined;
  if (value !== undefined) return visible(value).replace(/\n/g, '␊');
  return unquoteWord(text) ?? (/^"(?:[^"\\]|\\.)*"$/.test(text) ? text.slice(1, -1) : text);
}

/** A `$(…)` or backtick substitution that cannot print anything: empty, or a bare `:` / `true` / `false`. */
function emptySubstitution(n: SyntaxNode): boolean {
  const cmds = n.namedChildren;
  if (cmds.length === 0) return true;
  if (cmds.length !== 1 || cmds[0].type !== 'command') return false;
  const cmd = cmds[0];
  // No arguments or redirections: only the name.
  return cmd.namedChildren.length === 1 && cmd.namedChildren[0].type === 'command_name'
    && cmd.text === cmd.namedChildren[0].text && [':', 'true', 'false'].includes(cmd.text);
}

/**
 * The command names of the substitutions in `n` (itself included) that `staticWordValue` takes to print nothing (`:`,
 * `true`, `false`): they print nothing only when that name runs the builtin, not a function, an alias or a program
 * after `enable -n`, which the caller decides from the shell state.
 */
export function substitutionNames(n: SyntaxNode): string[] {
  const out: string[] = [];
  const visit = (m: SyntaxNode): void => {
    if (m.type === 'command_substitution' && m.namedChildren.length === 1 && emptySubstitution(m)) out.push(m.namedChildren[0].text);
    else m.namedChildren.forEach(visit);
  };
  visit(n);
  return out;
}

/**
 * The text of a node as the shell reads it. Inside a backquote substitution the text is the source, which
 * bash reads once before the command in it is parsed: a backslash before `$`, a backquote and a backslash
 * (and a double quote, when the backquote itself is in double quotes) is removed, once for each
 * backquote around the node, the outermost first.
 */
export function decodedText(n: SyntaxNode): string {
  return decodedSlice(n, 0, n.text.length);
}

/** What bash reads of `n.text.slice(from, to)`, as `decodedText`: the characters of that part of the source it keeps. */
export function decodedSlice(n: SyntaxNode, from: number, to: number): string {
  const levels: boolean[] = [];
  for (let p = n.parent; p; p = p.parent) {
    if (p.type !== 'command_substitution' || p.children[0]?.type !== '`') continue;
    // Is the backquote itself in double quotes? (Up to the substitution around it, if any.)
    let q = p.parent;
    while (q && q.type !== 'string' && q.type !== 'command_substitution') q = q.parent;
    levels.unshift(q?.type === 'string');
  }
  if (!levels.length) return n.text.slice(from, to);
  // The offsets in `n.text` of the characters bash keeps.
  let kept = Array.from({ length: n.text.length }, (_, i) => i);
  for (const inDouble of levels) {
    const escapable = inDouble ? '$`\\"' : '$`\\';
    const next: number[] = [];
    for (let k = 0; k < kept.length; k++) {
      if (n.text[kept[k]] === '\\' && k + 1 < kept.length && escapable.includes(n.text[kept[k + 1]])) k++;
      next.push(kept[k]);
    }
    kept = next;
  }
  return kept.filter((i) => i >= from && i < to).map((i) => n.text[i]).join('');
}

/** A tilde prefix bash expands: `parts[part].text.slice(start, end)` (`~`, `~+`, `~user`), at the start or after `=` or `:`. */
export interface TildeSpot { part: number; start: number; end: number; user: string; after: '' | '=' | ':' }

/** Whether the character at `i` is escaped by a backslash. */
function escaped(text: string, i: number): boolean {
  let k = 0;
  while (i - k - 1 >= 0 && text[i - k - 1] === '\\') k++;
  return k % 2 === 1;
}

/**
 * The tilde prefixes bash expands in a word, given as its parts (`plain`: unquoted text of the source, as a `word`
 * node). `start`: at the start of the word; `assignment`: also after each unquoted `:` (manual 3.4); `argument`: in a
 * word that looks like an assignment (`x=~/a:~/b`, `a[1]=~`, `n+=~`), also after the `=` and after each unquoted `:`
 * (bash mode); `element`: an element of an array's list with a subscript (`[1]=~/a:~/b`), after its `=` and after
 * each unquoted `:` (bash mode). A prefix runs to the first `/` (or `:`, after `=` and `:` and in an assignment) and
 * must be all unquoted text: `~"x"`, `~$u`, `x="a:"~/b` and `x=a:"~/b"` have none.
 */
export function tildeSpots(parts: readonly { text: string; plain: boolean }[], mode: 'start' | 'assignment' | 'argument' | 'element'): TildeSpot[] {
  const out: TildeSpot[] = [];
  // (bash removes a line continuation before it reads the word: `~\<newline>/x` is `~/x`, `x=\<newline>~` has a prefix.)
  const tilde = (text: string, i: number): number | undefined => {
    while (text.startsWith('\\\n', i)) i += 2;
    return text[i] === '~' ? i : undefined;
  };
  const at = (p: number, from: number, after: TildeSpot['after'], colon: boolean): void => {
    const text = parts[p].text;
    const i = tilde(text, from);
    if (i === undefined) return;
    const m = (colon ? /^~((?:\\\n|[^/:])*)/ : /^~((?:\\\n|[^/])*)/).exec(text.slice(i))!;
    const end = i + m[0].length;
    const user = m[1].replace(/\\\n/g, '');
    if ((end === text.length && p < parts.length - 1) || /[\\'"$`]/.test(user)) return;
    out.push({ part: p, start: i, end, user, after });
  };
  const first = parts[0];
  const plain = !!first?.plain;
  // Where the `:` that are looked at start: the part, and the index in it.
  let from: [number, number] | undefined;
  if (mode === 'assignment') {
    if (plain) at(0, 0, '', true);
    from = [0, 0];
  } else if (mode === 'element') {
    // (After the `=` that follows the subscript's `]`, which may be in another part than the `[`: `["k"]=~`. The word is such an element.)
    const close = elementClose(parts.map((x) => x.text).join(''))!;
    let eq = close.close + close.plus.length + 2;
    const p = parts.findIndex((x) => eq < x.text.length || ((eq -= x.text.length), false));
    if (p >= 0 && parts[p].plain) {
      at(p, eq, '=', true);
      from = [p, eq];
    }
  } else if (plain) {
    at(0, 0, '', false);
    // (A name, a subscript, `+` and `=`, which line continuations may part: `a\<newline>=~`.)
    const m = mode === 'argument' ? /^[A-Za-z_](?:\\\n|\w)*(?:\[[^\]]*\])?(?:\\\n)*\+?(?:\\\n)*=/.exec(first.text) : null;
    if (m) {
      at(0, m[0].length, '=', true);
      from = [0, m[0].length];
    }
  }
  if (from === undefined) return out;
  const [fp, fi] = from;
  parts.forEach((part, p) => {
    if (!part.plain || p < fp) return;
    for (let i = part.text.indexOf(':', p === fp ? fi : 0); i >= 0; i = part.text.indexOf(':', i + 1)) {
      if (!escaped(part.text, i)) at(p, i + 1, ':', true);
    }
  });
  return out;
}

/**
 * The entry of the directory stack a tilde prefix names (`~1`, `~+1`: from the left of `dirs`; `~-1`: from the right;
 * from 0): `n`, and `at`, the operand of `dirs` that shows it (`+1`, `-1`); undefined for another prefix (3.5.2, 6.8).
 */
export function stackTilde(user: string): { n: string; right: boolean; at: string } | undefined {
  const m = /^([+-]?)(\d+)$/.exec(user);
  // (A number past bash's intmax_t is none: the word stays as it is.)
  if (!m || BigInt(m[2]) > 0x7fffffffffffffffn) return undefined;
  const n = String(BigInt(m[2]));
  return { n, right: m[1] === '-', at: `${m[1] === '-' ? '-' : '+'}${n}` };
}

/** The parts of a word node, for `tildeSpots`. */
export const tildeParts = (nodes: readonly SyntaxNode[]): { node: SyntaxNode; text: string; plain: boolean }[] =>
  nodes.flatMap((n) => (n.type === 'concatenation' ? n.namedChildren : [n])).map((n) => ({ node: n, text: n.text, plain: n.type === 'word' }));

/**
 * Whether the text of the word part `n` has an unescaped `*` or `?`, or a `[` with a `]` after it: a glob that may
 * change the word. (A brace expansion is a node of its own: `brace_expression`.) (bash's `glob_pattern_p`: a `[` with
 * no `]` after it is no pattern, and stays as it is: `[ -f x ]`, `echo [`. In a part of a concatenation, the `]` may
 * be in another part: `a["x"]`.)
 */
function globbed(n: SyntaxNode, text: string): boolean {
  return /(^|[^\\])(\\\\)*([*?]|\[.*\])/s.test(text) || (n.parent?.type === 'concatenation' && /(^|[^\\])(\\\\)*\[/.test(text));
}

/**
 * Whether the word surely holds a `/` once bash expands it: one in its own text, quoted or not (`"$d/lib.sh"`, `~/x`,
 * `\/z`), never one inside an expansion or a substitution (`${t#…}`, `$(dirname x)`), whose result may have none.
 */
export function surelyHasSlash(n: SyntaxNode): boolean {
  switch (n.type) {
    case 'word': case 'raw_string': case 'string_content': case 'ansi_c_string': return n.text.includes('/');
    case 'string': case 'concatenation': return n.namedChildren.some(surelyHasSlash);
    default: return false;
  }
}

/**
 * What a word becomes after quote removal, when that is known without running anything:
 * `h\i` is `hi`, `"a"'b'` is `ab`, `$'\x24HOME'` is `$HOME`, `$(:)e` is `e`. Undefined if any part
 * depends on a variable, a command, a glob, a brace expansion or a tilde. `assignment`: the word is the value of an
 * assignment, where globs and braces are plain text and a tilde also expands after a `:`.
 */
export function staticWordValue(n: SyntaxNode, assignment = false, shell?: Shell): string | undefined {
  if (tildeSpots(tildeParts([n]), assignment ? 'assignment' : 'start').length) return undefined;
  return literalValue(n, assignment, shell);
}

function literalValue(n: SyntaxNode, assignment: boolean, shell: Shell | undefined): string | undefined {
  const text = decodedText(n);
  switch (n.type) {
    case 'word': case 'number': {
      // An unescaped glob is not text yet; in the value of an assignment, it is text.
      if (!assignment && globbed(n, text)) return undefined;
      return text.replace(/\\\n/g, '').replace(/\\(.)/gs, '$1');
    }
    case 'brace_expression': {
      // (Braces the shell may expand are not text yet: `{x,EXIT}` is text in dash, `{1..3}` in mksh; in an assignment's value too.)
      if (!assignment && bracesMayWork(n, shell)) return undefined;
      let out = '';
      for (const c of n.children) {
        const v = c.named ? literalValue(c, assignment, shell) : c.type;
        if (v === undefined) return undefined;
        out += v;
      }
      return out;
    }
    case 'raw_string': return text.slice(1, -1);
    case 'ansi_c_string': return ansiCWordValue(text, shell);
    case 'string':
      if (!n.namedChildren.every((c) => c.type === 'string_content')) return undefined;
      // (One pass: in `"a\\<newline>"` the backslash is escaped, and the newline stays.)
      return text.slice(1, -1).replace(/\\([$`"\\\n])/g, (_m, c: string) => (c === '\n' ? '' : c));
    case 'command_substitution': return emptySubstitution(n) ? '' : undefined;
    case 'concatenation': {
      let out = '';
      for (const c of n.namedChildren) {
        const v = literalValue(c, assignment, shell);
        if (v === undefined) return undefined;
        out += v;
      }
      return out;
    }
    default: return undefined;
  }
}

/**
 * The static value of a word as `staticWordValue` gives it (not in an assignment), with the source range of each of
 * its characters: character `i` comes from `starts[i]` to `ends[i]` in the tree's text (`\$` in double quotes is two
 * characters of source for one of text). Undefined when the value is not known, or inside backquotes, where bash
 * removes another level of backslashes first.
 */
export interface MappedText { text: string; starts: number[]; ends: number[] }

export function staticWordText(n: SyntaxNode, shell: Shell | undefined): MappedText | undefined {
  if (decodedText(n) !== n.text || tildeSpots(tildeParts([n]), 'start').length) return undefined;
  const out: MappedText = { text: '', starts: [], ends: [] };
  return mappedValue(n, out, shell) ? out : undefined;
}

function mappedValue(n: SyntaxNode, out: MappedText, shell: Shell | undefined): boolean {
  const src = n.text;
  const put = (text: string, start: number, end: number): void => {
    out.text += text;
    for (let k = 0; k < text.length; k++) {
      out.starts.push(n.startIndex + start);
      out.ends.push(n.startIndex + end);
    }
  };
  // `\x` is `x` (in double quotes only before `$`, a backquote, `"` and `\`); a backslash-newline is removed.
  const unescape = (from: number, to: number, escapes: RegExp): void => {
    for (let i = from; i < to; i++) {
      if (src[i] === '\\' && src[i + 1] === '\n' && i + 1 < to) i++;
      else if (src[i] === '\\' && i + 1 < to && escapes.test(src[i + 1])) put(src[++i], i - 1, i + 1);
      else put(src[i], i, i + 1);
    }
  };
  switch (n.type) {
    case 'word': case 'number':
      if (globbed(n, src)) return false;
      unescape(0, src.length, /[\s\S]/);
      return true;
    case 'brace_expression':
      // (Braces the shell does not expand are text, with what is in them: `{x,EXIT}` in dash.)
      if (bracesMayWork(n, shell)) return false;
      return n.children.every((c) => (c.named ? mappedValue(c, out, shell) : (put(c.type, c.startIndex - n.startIndex, c.endIndex - n.startIndex), true)));
    case 'raw_string':
      for (let i = 1; i < src.length - 1; i++) put(src[i], i, i + 1);
      return true;
    case 'string':
      if (!n.namedChildren.every((c) => c.type === 'string_content')) return false;
      unescape(1, src.length - 1, /[$`"\\]/);
      return true;
    case 'ansi_c_string': {
      // (Where the shell does not decode it: dash's `$` and single-quoted text, or nothing known.)
      if (!featureWorks('ansiC', shell)) {
        if (ansiCWordValue(src, shell) === undefined) return false;
        put('$', 0, 1);
        for (let i = 2; i < src.length - 1; i++) put(src[i], i, i + 1);
        return true;
      }
      // Each escape decoded on its own (`ansiCValue`), over the source of the escape.
      const body = src.slice(2, -1);
      for (let i = 0; i < body.length; i++) {
        let len = 1;
        if (body[i] === '\\' && i + 1 < body.length) {
          const num = /^(?:x[0-9A-Fa-f]{1,2}|u[0-9A-Fa-f]{1,4}|U[0-9A-Fa-f]{1,8}|[0-7]{1,3})/.exec(body.slice(i + 1));
          len = 1 + (num ? num[0].length : body[i + 1] === 'c' && i + 2 < body.length ? (body.startsWith('\\\\', i + 2) ? 3 : 2) : 1);
        }
        const piece = ansiCValue(body.slice(i, i + len));
        if (piece === undefined) return false;
        // (A NUL ends the string: bash cuts it there.)
        if (!piece.length) return true;
        put(piece, i + 2, i + 2 + len);
        i += len - 1;
      }
      return true;
    }
    case 'command_substitution': return emptySubstitution(n);
    case 'concatenation': return n.namedChildren.every((c) => mappedValue(c, out, shell));
    default: return false;
  }
}

/**
 * Where the key of an array element written with a subscript ends: the index of its closing `]` in `text`,
 * which starts with `[`, and `+` if the `=` after it appends. The `]` is the first one outside quotes,
 * expansions and nested `[ ]`, as bash finds it, and must be followed by `=` or `+=`. White space inside
 * the brackets belongs to the key (`[1 + 1]=x`).
 */
export function elementClose(text: string): { close: number; plus: string } | undefined {
  const skip = /\\.|'[^']*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\$\{[^}]*\}|\$\([^)]*\)/y;
  if (text[0] !== '[') return undefined;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    skip.lastIndex = i;
    const m = skip.exec(text);
    if (m) i += m[0].length - 1;
    else if (text[i] === '[') depth++;
    else if (text[i] === ']' && --depth === 0) {
      const rest = /^(\+?)=/.exec(text.slice(i + 1));
      return rest ? { close: i, plus: rest[1] } : undefined;
    }
  }
  return undefined;
}

/**
 * `["a b"]=1`, `[']']+=2`: the key, `+` if it appends, and the value of an array element written with a subscript
 * (the text may be a word that a parser has cut into pieces at the quotes).
 */
export function splitElement(text: string): { key: string; plus: string; value: string } | undefined {
  const e = elementClose(text);
  return e && { key: text.slice(1, e.close), plus: e.plus, value: text.slice(e.close + 2 + e.plus.length) };
}

/**
 * Whether the value `e` of a compound assignment sets an element by its index or key (`[k]=v`, 6.7), in the list of an
 * associative array (`assoc`) or of an indexed one. In an associative array's, the first value decides: with no `[k]=`
 * there, every value is a key or a value, in turn (`m=(k1 v1 [k2]=v2)` has the key `[k2]=v2`).
 */
export function setsElement(e: SyntaxNode, assoc: boolean): boolean {
  return !!elementClose(e.text) && (!assoc || !!elementClose(e.parent!.namedChildren.find((c) => c.type !== 'comment')!.text));
}

/** The plain words (unquoted text) of a word. */
export function plainWords(nodes: readonly SyntaxNode[]): SyntaxNode[] {
  return nodes.flatMap((n) => (n.type === 'concatenation' ? n.namedChildren : [n]))
    .filter((n) => n.type === 'word' || n.type === 'extglob_pattern' || n.type === 'brace_expression');
}

/**
 * A bracket expression that spans several parts of a word: opened in a plain part (`open`, an index into the parts),
 * closed in a later one (`close`), from the `[` at `start` to after the `]` at `end` (offsets in the script). The quotes
 * and expansions between are characters of its set, and the word is a pattern (3.5.8.1): `[$x]`, `["$x"].c`.
 */
export interface BracketSpan { open: number; close: number; start: number; end: number }

/** The bracket expressions that span several of `parts`, the parts of one word in order (`BracketSpan`). */
export function bracketSpans(parts: readonly SyntaxNode[]): BracketSpan[] {
  // (Each part that is not plain text stands as one character that is neither `]` nor special.)
  let text = '';
  const owner: number[] = [];
  const at: number[] = [];
  parts.forEach((c, i) => {
    const plain = c.type === 'word' || c.type === 'number' || c.type === 'extglob_pattern';
    const t = plain ? c.text : '_';
    text += t;
    for (let k = 0; k < t.length; k++) {
      owner.push(i);
      at.push(c.startIndex + (plain ? k : 0));
    }
  });
  const out: BracketSpan[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '[') {
      const end = bracketEnd(text, i);
      if (owner[end] > owner[i]) out.push({ open: owner[i], close: owner[end], start: at[i], end: at[end] + 1 });
    }
  }
  return out;
}

/** The plain parts of a word (its nodes, as `plainWords` takes them) that open a bracket expression a later part closes (`bracketSpans`). */
export function bracketsAcross(nodes: readonly SyntaxNode[]): SyntaxNode[] {
  const parts = nodes.length > 1 ? nodes : nodes[0].type === 'concatenation' ? nodes[0].namedChildren : [];
  return bracketSpans(parts).map((b) => parts[b.open]);
}

/** A plain word or a number: no quotes, expansions or other parts. */
export const isPlainWord = (n: SyntaxNode): boolean => n.type === 'word' || n.type === 'number';

/**
 * The text a command receives for a word, and where each of its characters sits in the word's
 * source: either a fixed `base` offset, or per-character `offsets` when quotes are interleaved
 * (`--pretty=format:'%h %s'`).
 */
export interface Literal {
  text: string;
  base?: number;
  offsets?: number[];
}

/** The literal text inside a raw string, plain double-quoted string, plain word, or a concatenation of those. */
export function literalContent(a: SyntaxNode, lang?: EmbeddedLang): Literal | undefined {
  // (In backquotes, `'a\$b'` is `a$b`: bash removes the backslash first, and the characters no longer sit one to one.)
  if (a.type === 'raw_string') return decodedText(a) === a.text ? { text: a.text.slice(1, -1), base: 1 } : undefined;
  // `echo -e "\e[1m"`: the shell keeps a backslash before any character but `$`, a backtick, `"` and `\`.
  if (lang === 'echo') {
    return a.type === 'string' && a.namedChildren.every((c) => c.type === 'string_content') && !/[$`]|\\[\\"\n]/.test(a.text) ? { text: a.text.slice(1, -1), base: 1 } : undefined;
  }
  if (a.type === 'string' && a.namedChildren.every((c) => c.type === 'string_content') && !/[\\$`]/.test(a.text)) {
    return { text: a.text.slice(1, -1), base: 1 };
  }
  if (isPlainWord(a) && !/[\\'"$`]/.test(a.text)) return { text: a.text, base: 0 };
  // `$"…"` is a double-quoted string (a translation, when the locale has one for it).
  if (a.type === 'translated_string' && a.namedChildren.length === 1) {
    const inner = literalContent(a.namedChildren[0]);
    return inner && !inner.offsets ? { text: inner.text, base: inner.base! + 1 } : undefined;
  }
  if (a.type === 'concatenation' && a.startPosition.row === a.endPosition.row) {
    let text = '';
    const offsets: number[] = [];
    for (const c of a.namedChildren) {
      const lit = literalContent(c);
      if (!lit || lit.offsets) return undefined;
      const at = c.startIndex - a.startIndex + lit.base!;
      for (let k = 0; k < lit.text.length; k++) offsets.push(at + k);
      text += lit.text;
    }
    return { text, offsets };
  }
  return undefined;
}

/** Position in the node's source of character `offset` of a literal (an end offset maps past the previous character). */
export function sourceIndex(lit: Literal, offset: number, isEnd: boolean): number {
  // A literal has a base or offsets, one for each character (tokens lie within its text).
  if (!lit.offsets) return lit.base! + offset;
  if (isEnd) return lit.offsets[offset - 1] + 1;
  return lit.offsets[offset];
}
