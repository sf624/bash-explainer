// The words of a command as the argument interpreter (src/argv/interpret.ts) takes them, and a short
// rendering of its result for the tests.
import type { ArgRole, ArgvParse, ArgWord } from '../../src/argv/interpret';
import { argWord } from '../../src/argv/words';
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
      case 'operand': return (r.spec ? `${r.spec.name}${r.assignment ? ' (assignment)' : ''}` : 'operand') + (r.uncertain ? ' (uncertain)' : '');
      case 'subcommand': return `subcommand ${r.name}`;
      case 'command': return `command ${r.slot.run}${r.slot.where ? `@${r.slot.where}` : ''}${r.of ? ` of ${r.of}` : ''}${r.name ? ` ${r.name}` : ''}${r.spec || !r.parse ? '' : ' (unknown)'}`;
    }
  };
  for (const { word, role } of parse.roles) {
    out.push(`${'  '.repeat(depth)}${texts[word]}: ${one(role)}`);
    if ((role.role === 'subcommand' || role.role === 'command') && role.parse) out.push(...render(role.parse, texts, depth + 1));
  }
  return out;
}
