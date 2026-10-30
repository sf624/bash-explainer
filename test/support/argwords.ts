// The words of a command as the argument interpreter (src/argv/interpret.ts) takes them, and a short
// rendering of its result for the tests.
import type { ArgRole, ArgvParse, ArgWord, ValueRole } from '../../src/argv/interpret';
import { squeeze, type Role } from '../../src/argv/profiles';
import { dependsText, readingsText } from '../../src/argv/profiletexts';
import { argWord } from '../../src/argv/words';
import { tx } from '../../src/i18n';
import { createUnbashParser } from '../../src/syntax/adapters/unbash';
import { descendants, field } from '../../src/syntax/tree';

const parser = createUnbashParser();

/** The argument words (the name left out) of the first command of `line`, and their source texts. */
export function argWords(line: string): { name: string; words: ArgWord[]; texts: string[] } {
  const c = descendants(parser.parse(line).root, ['command'])[0];
  const nameNode = field(c, 'name')!;
  const args = c.namedChildren.filter((x) => x !== nameNode && !x.type.endsWith('redirect') && x.startIndex > nameNode.startIndex);
  return { name: nameNode.text, words: args.map(argWord), texts: args.map((a) => a.text) };
}

/** One line per word: `text: role`, with the words of a subcommand or of a command slot indented. */
export function render(parse: ArgvParse, texts: string[], depth = 0): string[] {
  const out: string[] = [];
  const one = (r: ArgRole): string => {
    switch (r.role) {
      case 'option': return `${r.flag}${r.value ? `=${r.value.attached}` : ''}${r.disables ? ' (off)' : ''}${r.missing ? ' (no value)' : ''} ${r.text.en}`;
      case 'unknown-option': return `${r.flag}?${r.value ? `=${r.value.attached}` : ''}`;
      case 'open-option': return `open ${r.prefix}`;
      case 'expression': return 'expression';
      case 'joined': return 'joined';
      case 'cluster': return `cluster ${r.letters.map(one).join(' | ')}`;
      case 'pattern-option': return `pattern${r.open ? ' (open)' : ''} ${r.text.en}`;
      case 'value': return `value ${r.index} of ${r.of}${r.spec ? ` ${r.spec.name}` : ''}`;
      case 'old-style': return `old ${r.letters.map(one).join(' | ')}`;
      case 'end-of-options': return 'end of options';
      case 'terminator': return 'terminator';
      case 'operand': return (r.spec ? `${r.spec.name}${r.assignment ? ' (assignment)' : ''}` : 'operand') + (hedged(r) ? ' (hedged)' : '');
      case 'subcommand': return `subcommand ${r.name}`;
      case 'command': return `command ${r.slot.run}${r.slot.where ? `@${r.slot.where}` : ''}${r.of ? ` of ${r.of}` : ''}${r.name ? ` ${r.name}` : ''}${r.spec || !r.parse ? '' : ' (unknown)'}`;
      case 'fields': return `fields ${r.words.length}`;
    }
  };
  for (const { word, role } of parse.roles) {
    out.push(`${'  '.repeat(depth)}${texts[word]}: ${one(role)}`);
    // The words a value splices in (`env -S'…'`), marked `»`, or why the program refuses them.
    const v = valueOf(role);
    if (v?.split) out.push(...render({ command: '', roles: v.split.roles, end: 0, unmatched: [] }, v.split.words.map((w) => w.value ?? `${w.prefix}…`), depth + 1).map((l) => l.replace(/^(\s*)/, '$1» ')));
    // The fields of a word the model knows (`x='-r a'`), marked `·`.
    if (role.role === 'fields') out.push(...render({ command: '', roles: role.roles, end: 0, unmatched: [] }, role.words.map((w) => w.value!), depth + 1).map((l) => l.replace(/^(\s*)/, '$1· ')));
    if (v?.refused) out.push(`${'  '.repeat(depth + 1)}refused: ${v.refused.error} ${v.refused.at}`);
    if ((role.role === 'subcommand' || role.role === 'command') && role.parse) out.push(...render(role.parse, texts, depth + 1));
  }
  return out;
}

/**
 * Whether an operand's readings say more than its role as written: a clause, a folded text, the text past the cap, or
 * other roles for its own counts (`cp *.txt dir`).
 */
const hedged = (r: Extract<ArgRole, { role: 'operand' }>): boolean => {
  const x = r.readings;
  return !!x && (x.kind === 'depends' || !!x.clauses.length || !!x.folded || !x.base.places || squeeze(x.base.places).length > 1);
};

/**
 * What the readings of the command's word `k` say (src/argv/profiletexts.ts), in English, with the words named by their
 * texts and each role by its spec's text (an operand's), `value for X`, `option X` or its kind; undefined where it has none.
 */
export function said(role: ArgRole, k: number, texts: readonly string[]): string | undefined {
  const r = role.role === 'operand' || role.role === 'fields' ? role.readings : undefined;
  if (!r) return undefined;
  const name = ({ role: x }: Role): string => (x.role === 'operand' ? x.spec?.text.en ?? 'argument' : x.role === 'value' ? `value for ${x.of}` : 'flag' in x ? `option ${x.flag}` : x.role);
  const names = { word: (j: number): string => `\`${texts[j]}\``, role: (x: Role) => tx(name(x), name(x)) };
  return (r.kind === 'depends' ? dependsText(r, names) : readingsText(r, k, names)).en;
}

/** An option's value, in its own word or attached (the letter of a cluster that has one). */
function valueOf(r: ArgRole): ValueRole | undefined {
  if (r.role === 'value') return r;
  if (r.role === 'option' || r.role === 'unknown-option') return r.value;
  return r.role === 'cluster' ? r.letters.map(valueOf).find((v) => v?.split || v?.refused) : undefined;
}
