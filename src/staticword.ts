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
      out += String.fromCharCode(body[++i].charCodeAt(0) & 0x1f);
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
  if (cmds.length !== 1 || cmds[0].type !== 'command') return false;
  const cmd = cmds[0];
  // No arguments or redirections: only the name.
  return cmd.namedChildren.length === 1 && cmd.namedChildren[0].type === 'command_name'
    && cmd.text === cmd.namedChildren[0].text && [':', 'true', 'false', ''].includes(cmd.text);
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

/**
 * What a word becomes after quote removal, when that is known without running anything:
 * `h\i` is `hi`, `"a"'b'` is `ab`, `$'\x24HOME'` is `$HOME`, `$(:)e` is `e`. Undefined if any part
 * depends on a variable, a command, a glob or a brace expansion.
 */
export function staticWordValue(n: SyntaxNode): string | undefined {
  const text = decodedText(n);
  switch (n.type) {
    case 'word': case 'number': {
      // An unescaped glob, brace or tilde is not text yet.
      if (/(^|[^\\])(\\\\)*[*?[{]/.test(text) || /^~/.test(text)) return undefined;
      return text.replace(/\\\n/g, '').replace(/\\(.)/gs, '$1');
    }
    case 'raw_string': return text.slice(1, -1);
    case 'ansi_c_string': return ansiCValue(text.slice(2, -1));
    case 'string':
      if (!n.namedChildren.every((c) => c.type === 'string_content')) return undefined;
      return text.slice(1, -1).replace(/\\\n/g, '').replace(/\\([$`"\\])/g, '$1');
    case 'command_substitution': return emptySubstitution(n) ? '' : undefined;
    case 'concatenation': {
      let out = '';
      for (const c of n.namedChildren) {
        const v = staticWordValue(c);
        if (v === undefined) return undefined;
        out += v;
      }
      return out;
    }
    default: return undefined;
  }
}

/**
 * `["a b"]=1`, `[']']+=2`: the key, `+` if it appends, and the value of an array element written with a subscript.
 * The closing `]` is the first one outside quotes, expansions and nested `[ ]`, as bash finds it (the text may be
 * a word that a parser has cut into pieces at the quotes).
 */
export function splitElement(text: string): { key: string; plus: string; value: string } | undefined {
  const skip = /\\.|'[^']*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\$\{[^}]*\}|\$\([^)]*\)/y;
  if (text[0] !== '[') return undefined;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    skip.lastIndex = i;
    const m = skip.exec(text);
    if (m) i += m[0].length - 1;
    else if (text[i] === '[') depth++;
    else if (text[i] === ']' && --depth === 0) {
      const rest = /^(\+?)=(.*)$/s.exec(text.slice(i + 1));
      return rest ? { key: text.slice(1, i), plus: rest[1], value: rest[2] } : undefined;
    }
  }
  return undefined;
}
