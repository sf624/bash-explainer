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
  const levels: boolean[] = [];
  for (let p = n.parent; p; p = p.parent) {
    if (p.type !== 'command_substitution' || p.children[0]?.type !== '`') continue;
    // Is the backquote itself in double quotes? (Up to the substitution around it, if any.)
    let q = p.parent;
    while (q && q.type !== 'string' && q.type !== 'command_substitution') q = q.parent;
    levels.unshift(q?.type === 'string');
  }
  return levels.reduce((text, inDouble) => text.replace(inDouble ? /\\([$`\\"])/g : /\\([$`\\])/g, '$1'), n.text);
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
 * (bash mode). A prefix runs to the first `/` (or `:`, after `=` and `:` and in an assignment) and must be all unquoted
 * text: `~"x"`, `~$u`, `x="a:"~/b` and `x=a:"~/b"` have none.
 */
export function tildeSpots(parts: readonly { text: string; plain: boolean }[], mode: 'start' | 'assignment' | 'argument'): TildeSpot[] {
  const out: TildeSpot[] = [];
  const at = (p: number, i: number, after: TildeSpot['after'], colon: boolean): void => {
    const text = parts[p].text;
    const m = (colon ? /^~([^/:]*)/ : /^~([^/]*)/).exec(text.slice(i))!;
    const end = i + m[0].length;
    if ((end === text.length && p < parts.length - 1) || /[\\'"$`]/.test(m[1])) return;
    out.push({ part: p, start: i, end, user: m[1], after });
  };
  const first = parts[0];
  const plain = !!first?.plain;
  let from: number | undefined;
  if (mode === 'assignment') {
    if (plain && first.text[0] === '~') at(0, 0, '', true);
    from = 0;
  } else if (plain) {
    if (first.text[0] === '~') at(0, 0, '', false);
    const m = mode === 'argument' ? /^[A-Za-z_]\w*(?:\[[^\]]*\])?\+?=/.exec(first.text) : null;
    if (m) {
      if (first.text[m[0].length] === '~') at(0, m[0].length, '=', true);
      from = m[0].length;
    }
  }
  if (from === undefined) return out;
  parts.forEach((part, p) => {
    if (!part.plain) return;
    for (let i = part.text.indexOf(':', p === 0 ? from : 0); i >= 0; i = part.text.indexOf(':', i + 1)) {
      if (part.text[i + 1] === '~' && !escaped(part.text, i)) at(p, i + 1, ':', true);
    }
  });
  return out;
}

/** The parts of a word node, for `tildeSpots`. */
export const tildeParts = (nodes: readonly SyntaxNode[]): { node: SyntaxNode; text: string; plain: boolean }[] =>
  nodes.flatMap((n) => (n.type === 'concatenation' ? n.namedChildren : [n])).map((n) => ({ node: n, text: n.text, plain: n.type === 'word' }));

/**
 * What a word becomes after quote removal, when that is known without running anything:
 * `h\i` is `hi`, `"a"'b'` is `ab`, `$'\x24HOME'` is `$HOME`, `$(:)e` is `e`. Undefined if any part
 * depends on a variable, a command, a glob, a brace expansion or a tilde. `assignment`: the word is the value of an
 * assignment, where globs and braces are plain text and a tilde also expands after a `:`.
 */
export function staticWordValue(n: SyntaxNode, assignment = false): string | undefined {
  if (tildeSpots(tildeParts([n]), assignment ? 'assignment' : 'start').length) return undefined;
  return literalValue(n, assignment);
}

function literalValue(n: SyntaxNode, assignment: boolean): string | undefined {
  const text = decodedText(n);
  switch (n.type) {
    case 'word': case 'number': {
      // An unescaped glob or brace is not text yet; in the value of an assignment, they are text.
      if (!assignment && /(^|[^\\])(\\\\)*[*?[{]/.test(text)) return undefined;
      return text.replace(/\\\n/g, '').replace(/\\(.)/gs, '$1');
    }
    case 'raw_string': return text.slice(1, -1);
    case 'ansi_c_string': return ansiCValue(text.slice(2, -1));
    case 'string':
      if (!n.namedChildren.every((c) => c.type === 'string_content')) return undefined;
      // (One pass: in `"a\\<newline>"` the backslash is escaped, and the newline stays.)
      return text.slice(1, -1).replace(/\\([$`"\\\n])/g, (_m, c: string) => (c === '\n' ? '' : c));
    case 'command_substitution': return emptySubstitution(n) ? '' : undefined;
    case 'concatenation': {
      let out = '';
      for (const c of n.namedChildren) {
        const v = literalValue(c, assignment);
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

export function staticWordText(n: SyntaxNode): MappedText | undefined {
  if (decodedText(n) !== n.text || tildeSpots(tildeParts([n]), 'start').length) return undefined;
  const out: MappedText = { text: '', starts: [], ends: [] };
  return mappedValue(n, out) ? out : undefined;
}

function mappedValue(n: SyntaxNode, out: MappedText): boolean {
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
      if (/(^|[^\\])(\\\\)*[*?[{]/.test(src)) return false;
      unescape(0, src.length, /[\s\S]/);
      return true;
    case 'raw_string':
      for (let i = 1; i < src.length - 1; i++) put(src[i], i, i + 1);
      return true;
    case 'string':
      if (!n.namedChildren.every((c) => c.type === 'string_content')) return false;
      unescape(1, src.length - 1, /[$`"\\]/);
      return true;
    case 'ansi_c_string': {
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
    case 'concatenation': return n.namedChildren.every((c) => mappedValue(c, out));
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
