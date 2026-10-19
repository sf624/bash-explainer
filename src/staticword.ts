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
export function unquoteWord(text: string): string | undefined {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && i + 1 < text.length) out += text[++i];
    else if (c === "'") {
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
 * What a word becomes after quote removal, when that is known without running anything:
 * `h\i` is `hi`, `"a"'b'` is `ab`, `$'\x24HOME'` is `$HOME`, `$(:)e` is `e`. Undefined if any part
 * depends on a variable, a command, a glob or a brace expansion.
 */
export function staticWordValue(n: SyntaxNode): string | undefined {
  switch (n.type) {
    case 'word': case 'number': {
      // An unescaped glob, brace or tilde is not text yet.
      if (/(^|[^\\])(\\\\)*[*?[{]/.test(n.text) || /^~/.test(n.text)) return undefined;
      return n.text.replace(/\\\n/g, '').replace(/\\(.)/gs, '$1');
    }
    case 'raw_string': return n.text.slice(1, -1);
    case 'ansi_c_string': return ansiCValue(n.text.slice(2, -1));
    case 'string':
      if (!n.namedChildren.every((c) => c.type === 'string_content')) return undefined;
      return n.text.slice(1, -1).replace(/\\\n/g, '').replace(/\\([$`"\\])/g, '$1');
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
