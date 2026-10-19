import { SyntaxNode, field, fields } from './syntax/tree';

/**
 * The label of a construct (`if`, `for`, a pipeline, a redirection…) is its skeleton: the keywords and operators,
 * the short parts that say something (a loop variable, a command name, a redirect target) as they are written,
 * and a named placeholder for what is left out (`if` *condition* `then` *commands* `fi`).
 */
export interface LabelPart {
  /** What is shown: source text for a code part, an English word for a placeholder. */
  text: string;
  /** A part that stands for text left out. The names are English in every language; only explanations are translated. */
  placeholder?: true;
}

/**
 * A part of the source that is longer than this (in characters) is left out of a skeleton and replaced by a
 * placeholder, and so is a test, an arithmetic command or an assignment, which keep their whole text when they are shorter.
 */
export const LABEL_LIMIT = 30;

/** The marks that set a placeholder off in plain text: not `<` and `>`, which would read as redirections. */
export const PLACEHOLDER_OPEN = '‹';
export const PLACEHOLDER_CLOSE = '›';

export const code = (text: string): LabelPart => ({ text });
export const placeholder = (name: string): LabelPart => ({ text: name, placeholder: true });

/** The plain-text form of a label: the parts apart by a space, each placeholder as ‹name›. */
export function labelText(parts: readonly LabelPart[]): string {
  return parts.map((p) => (p.placeholder ? `${PLACEHOLDER_OPEN}${p.text}${PLACEHOLDER_CLOSE}` : p.text)).join(' ');
}

/** The parts of a token's label: its skeleton, or its text as one code part. */
export function labelParts(t: { label: string; labelParts?: LabelPart[] }): readonly LabelPart[] {
  return t.labelParts ?? [code(t.label)];
}

const flat = (text: string) => text.replace(/\s*\n\s*/g, ' ').trim();

/** The text as a code part if it is short and on one line, else the placeholder. */
function keep(text: string, name: string): LabelPart {
  return text.length <= LABEL_LIMIT && !text.includes('\n') ? code(text) : placeholder(name);
}

/** What the placeholder after a keyword is called. */
const AFTER: Record<string, string> = {
  if: 'condition', elif: 'condition', while: 'condition', until: 'condition',
  then: 'commands', do: 'commands', else: 'commands', '{': 'commands', '(': 'commands',
};

const KEYWORDS = new Set(['if', 'then', 'elif', 'else', 'fi', 'while', 'until', 'do', 'done', 'for', 'select', 'in', 'case', 'esac', '{', '}', '(', ')']);

const STRUCTURE = new Set(['elif_clause', 'else_clause', 'do_group']);

/** The skeleton of a compound statement: its keywords and brackets, with a placeholder for each run of what is between them. */
function compound(n: SyntaxNode): LabelPart[] {
  const out: LabelPart[] = [];
  let next = 'commands';
  let last: string | undefined;
  const isCase = n.type === 'case_statement';
  for (const c of n.children) {
    if (!c.named) {
      if (!KEYWORDS.has(c.type)) continue;
      out.push(code(c.type));
      next = c.type === 'in' ? (isCase ? 'patterns' : 'words') : AFTER[c.type] ?? 'commands';
      last = undefined;
    } else if (STRUCTURE.has(c.type)) {
      out.push(...skeleton(c));
      last = undefined;
    } else if (c.field === 'variable') {
      out.push(keep(c.text, 'name'));
    } else if (isCase && c.field === 'value') {
      out.push(keep(flat(c.text), 'word'));
    } else if (c.type === 'case_item') {
      if (last !== 'patterns') out.push(placeholder('patterns'));
      last = 'patterns';
    } else if (last !== next) {
      out.push(placeholder(next));
      last = next;
    }
  }
  return out;
}

function cStyleFor(n: SyntaxNode): LabelPart[] {
  const out: LabelPart[] = [];
  let closed = false;
  for (const c of n.children) {
    if (!c.named) {
      // (The `;` after the `))` is not one of the loop's.)
      if (c.type === '))') closed = true;
      if (['for', '((', '))'].includes(c.type) || (c.type === ';' && !closed)) out.push(code(c.type));
    } else if (c.type === 'do_group') out.push(...skeleton(c));
    else out.push(placeholder(c.field === 'initializer' ? 'init' : c.field === 'condition' ? 'test' : 'update'));
  }
  return out;
}

function caseItem(n: SyntaxNode): LabelPart[] {
  const patterns = fields(n, 'value').map((p) => flat(p.text)).join('|');
  const close = n.children.find((c) => !c.named && c.type === ')');
  // The `)` is written against the pattern.
  const out: LabelPart[] = patterns.length + 1 <= LABEL_LIMIT && !patterns.includes('\n') && close ? [code(patterns + ')')] : [placeholder('pattern'), ...(close ? [code(')')] : [])];
  if (n.namedChildren.some((c) => c.field === null)) out.push(placeholder('commands'));
  const end = n.children.find((c) => !c.named && /^;[;&]/.test(c.type));
  if (end) out.push(code(end.type));
  return out;
}

function functionDef(n: SyntaxNode): LabelPart[] {
  const out: LabelPart[] = [];
  if (n.children.some((c) => !c.named && c.type === 'function')) out.push(code('function'));
  const parens = n.children.some((c) => !c.named && c.type === '(');
  const name = field(n, 'name')!;
  out.push(code(flat(name.text) + (parens ? '()' : '')));
  const body = field(n, 'body');
  if (body) out.push(...skeleton(body));
  return out;
}

/** The redirection as written, or its operator and a placeholder for a long target. */
export function redirectParts(r: SyntaxNode): LabelPart[] {
  const text = flat(r.text);
  if (r.type === 'heredoc_redirect') {
    const start = r.namedChildren.find((c) => c.type === 'heredoc_start');
    const head = start ? flat(r.text.slice(0, start.endIndex - r.startIndex)) : r.children.find((c) => !c.named)!.type;
    return [head.length <= LABEL_LIMIT ? code(head) : code(r.children.find((c) => !c.named)!.type), ...(head.length <= LABEL_LIMIT ? [] : [placeholder('delimiter')])];
  }
  if (text.length <= LABEL_LIMIT && !r.text.includes('\n')) return [code(text)];
  if (r.type === 'herestring_redirect') return [code('<<<'), placeholder('string')];
  const dest = field(r, 'destination');
  const op = dest ? flat(r.text.slice(0, dest.startIndex - r.startIndex)) : text;
  return [code(op), placeholder('file')];
}

/** The skeleton of a command inside a pipeline, list or negation: its name only. */
function stage(n: SyntaxNode): LabelPart[] {
  switch (n.type) {
    case 'command': return [code(flat(field(n, 'name')!.text))];
    case 'declaration_command': return [code(n.children[0].type)];
    case 'unset_command': return [code('unset')];
    // The redirections of a stage are left to its own explanation.
    // (A redirection with nothing to redirect, `a | >f`, is only the redirection.)
    case 'redirected_statement': return field(n, 'body') ? stage(field(n, 'body')!) : skeleton(n);
    case 'pipeline': case 'list': case 'negated_command': case 'time_statement': case 'coproc_statement': return skeleton(n);
    default: {
      const own = skeleton(n);
      return labelText(own).length <= LABEL_LIMIT ? own : [placeholder('command')];
    }
  }
}

function sequence(n: SyntaxNode): LabelPart[] {
  const out: LabelPart[] = [];
  const walk = (x: SyntaxNode) => {
    for (const c of x.children) {
      if (c.type === 'list' && x.type === 'list') walk(c);
      else if (c.named) out.push(...stage(c));
      else if (c.type === '|' || c.type === '|&' || c.type === '&&' || c.type === '||') out.push(code(c.type));
    }
  };
  walk(n);
  return out;
}

/** A test, an arithmetic command or an assignment: whole when short, else its brackets or name with a placeholder. */
function whole(n: SyntaxNode, make: () => LabelPart[]): LabelPart[] {
  const text = flat(n.text);
  return text.length <= LABEL_LIMIT && !n.text.includes('\n') ? [code(text)] : make();
}

/** The skeleton of `n`: the label of the token that explains it as a whole. */
export function skeleton(n: SyntaxNode): LabelPart[] {
  switch (n.type) {
    case 'if_statement': case 'elif_clause': case 'else_clause': case 'while_statement': case 'do_group':
    case 'compound_statement': case 'subshell': case 'for_statement': case 'select_statement': case 'case_statement':
      return compound(n);
    case 'c_style_for_statement': return cStyleFor(n);
    case 'case_item': return caseItem(n);
    case 'function_definition': return functionDef(n);
    case 'pipeline': case 'list': return sequence(n);
    case 'redirected_statement': {
      const body = field(n, 'body');
      return [...(body ? skeleton(body) : []), ...n.namedChildren.filter((c) => c !== body && c.children.length).flatMap(redirectParts)];
    }
    case 'command': case 'declaration_command': {
      // `>f echo x`: the redirections inside the node are the command's own.
      const redirs = n.children.filter((c) => c.type.endsWith('redirect'));
      return [...stage(n), ...redirs.flatMap(redirectParts)];
    }
    case 'negated_command': return [code('!'), ...n.namedChildren.flatMap(stage)];
    case 'time_statement': {
      const body = field(n, 'body');
      const option = field(n, 'option');
      return [code('time'), ...(option ? [code(option.text)] : []), ...(body ? stage(body) : [])];
    }
    case 'coproc_statement': {
      const name = field(n, 'name');
      const body = field(n, 'body');
      return [code('coproc'), ...(name ? [code(name.text)] : []), ...(body ? stage(body) : [])];
    }
    case 'test_command': return whole(n, () => [code('['), placeholder('expression'), code(']')]);
    case 'extended_test': return whole(n, () => [code('[['), placeholder('expression'), code(']]')]);
    case 'arithmetic_command': return whole(n, () => [code('(('), placeholder('expression'), code('))')]);
    case 'variable_assignment': return whole(n, () => {
      const op = n.children.find((c) => !c.named && (c.type === '=' || c.type === '+='))!.type;
      return [code(field(n, 'name')!.text + op), placeholder('value')];
    });
    default: return [keep(flat(n.text), 'word')];
  }
}
