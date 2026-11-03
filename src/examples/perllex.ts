// The words of a perl program, for the runner (src/examples/perlrun.ts).
import { Unsupported as RunnerUnsupported } from './unsupported';
export class Unsupported extends RunnerUnsupported {}
export const unfollowed = (what: string): never => { throw new Unsupported(what); };

// ---------------------------------------------------------------- lexer

export interface Tok {
  t: 'num' | 'str' | 'istr' | 'var' | 'word' | 'op' | 're' | 'subst' | 'tr' | 'qw';
  v: string;
  /** Regex/substitution parts. */
  pat?: string;
  rep?: string;
  flags?: string;
}

const OPS = ['<=>', '**=', '||=', '//=', '&&=', '...', '**', '++', '--', '+=', '-=', '*=', '/=', '.=', '%=', 'x=', '==', '!=', '<=', '>=', '=~', '!~', '&&', '||', '//', '..', '->', '=>',
  '+', '-', '*', '/', '%', '.', '<', '>', '=', '!', '?', ':', ',', ';', '(', ')', '{', '}', '[', ']', '\\'];
const PAIRS: Record<string, string> = { '{': '}', '(': ')', '[': ']', '<': '>' };

function readDelimited(src: string, i: number, open: string): [string, number] {
  const close = PAIRS[open] ?? open;
  let depth = 1;
  let j = i;
  let out = '';
  while (j < src.length) {
    const c = src[j];
    if (c === '\\' && j + 1 < src.length) {
      // Keep escapes, except an escaped delimiter which becomes the plain character.
      out += src[j + 1] === close || src[j + 1] === open ? (open === '/' ? '\\/' : src[j + 1]) : c + src[j + 1];
      j += 2;
      continue;
    }
    if (open !== close && c === open) depth++;
    else if (c === close && --depth === 0) return [out, j + 1];
    out += c;
    j++;
  }
  throw new Unsupported('unterminated');
}

export function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const operandExpected = () => {
    const p = out[out.length - 1];
    if (!p) return true;
    if (p.t === 'op') return !/^[)\]}]$/.test(p.v) && p.v !== '++' && p.v !== '--';
    if (p.t === 'word') return ['if', 'unless', 'and', 'or', 'not', 'split', 'grep', 'return', 'print', 'say', 'while', 'until', 'push', 'join'].includes(p.v);
    return false;
  };
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
    let m: RegExpExecArray | null;
    if ((m = /^\d+(\.\d+)?([eE][-+]?\d+)?/.exec(src.slice(i)))) { out.push({ t: 'num', v: m[0] }); i += m[0].length; continue; }
    if ((m = /^[$@%](\{\w+\}|\w+|[_.,\\/&0!])/.exec(src.slice(i)))) {
      out.push({ t: 'var', v: m[0][0] + m[1].replace(/^\{|\}$/g, '') });
      i += m[0].length;
      continue;
    }
    if (c === "'") { const [s, j] = readDelimited(src, i + 1, "'"); out.push({ t: 'str', v: s.replace(/\\(['\\])/g, '$1') }); i = j; continue; }
    if (c === '"') { const [s, j] = readDelimited(src, i + 1, '"'); out.push({ t: 'istr', v: s }); i = j; continue; }
    if ((m = /^(s|tr|y|m|qr|qw|q|qq)\s*([^\w\s])/.exec(src.slice(i))) && !/\w/.test(src[i - 1] ?? '') && (m[1] !== 'y' || operandExpected() || src[i + 1] !== ' ')) {
      const op = m[1];
      const open = m[2];
      let [a, j] = readDelimited(src, i + m[0].length, open);
      if (op === 's' || op === 'tr' || op === 'y') {
        let b: string;
        if (PAIRS[open]) {
          while (/\s/.test(src[j])) j++;
          [b, j] = readDelimited(src, j + 1, src[j]);
        } else [b, j] = readDelimited(src, j, open);
        const f = /^[a-z]*/.exec(src.slice(j))![0];
        out.push({ t: op === 's' ? 'subst' : 'tr', v: op, pat: a, rep: b, flags: f });
        i = j + f.length;
        continue;
      }
      const f = /^[a-z]*/.exec(src.slice(j))![0];
      if (op === 'qw') out.push({ t: 'qw', v: a });
      else if (op === 'q') out.push({ t: 'str', v: a });
      else if (op === 'qq') out.push({ t: 'istr', v: a });
      else out.push({ t: 're', v: op, pat: a, flags: f });
      i = j + f.length;
      continue;
    }
    if (c === '/' && operandExpected()) {
      const [a, j] = readDelimited(src, i + 1, '/');
      const f = /^[a-z]*/.exec(src.slice(j))![0];
      out.push({ t: 're', v: 'm', pat: a, flags: f });
      i = j + f.length;
      continue;
    }
    if ((m = /^[A-Za-z_]\w*(::\w+)*/.exec(src.slice(i)))) { out.push({ t: 'word', v: m[0] }); i += m[0].length; continue; }
    if (src.startsWith('<>', i) || src.startsWith('<STDIN>', i)) throw new Unsupported('reading input');
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new Unsupported(`char ${c}`);
    out.push({ t: 'op', v: op });
    i += op.length;
  }
  return out;
}
