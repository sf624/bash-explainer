// What the program of each simple command on a line receives (docs/design/panel-redesign.md, P4): its words after
// bash's expansions, quote removal, word splitting and pathname expansion (manual 3.5, 3.7.1), and what bash took out
// first, the prefix assignments and the redirections, with what they do. A word's fields come from the word model, through
// its one reader for this, `receivedFields` (src/semantics/fieldshape.ts): the fields of `wordFields` where they are
// known, else the fields with a hole for each part whose value is known only when the line runs, which this names in a
// placeholder (src/messages-argv.ts). Data on the explanation when `ExplainOptions.argv` asks for it, for the panel's
// switch "What the program receives" (P9). test/argv.test.ts checks it against the argv bash gives, over the capture's
// corpus.
import type { ArgvLine, ArgvPart, ArgvRemoved, ArgvWord } from './analyzer-types';
import { redirects } from './dict/syntax';
import { redirectParts } from './explain/redirections';
import type { Lang } from './i18n';
import { assignmentSaid, hereSaid, placeholderSaid } from './messages-argv';
import { spanOf } from './noteanchors';
import { receivedFields } from './semantics/fieldshape';
import { assignmentsOf, resolveName } from './semantics/names';
import type { StateModel } from './semantics/state';
import { descendants, field, fields, prefixAssignments, redirectionsOf, type SyntaxNode } from './syntax/tree';

/** What the program of each simple command with a name on `line` receives, in source order (also those in a substitution). */
export function argvLines(root: SyntaxNode, line: number, model: StateModel, lang: Lang): ArgvLine[] {
  return descendants(root, ['command'])
    .filter((c) => c.startPosition.row <= line && line <= c.endPosition.row)
    .flatMap((c) => argvOf(c, model, lang) ?? []);
}

/** What the program of the simple command `cmd` receives; undefined for a command with no name (`x=1`, `>f`), which runs none. */
export function argvOf(cmd: SyntaxNode, model: StateModel, lang: Lang): ArgvLine | undefined {
  const nameNode = field(cmd, 'name');
  if (!nameNode) return undefined;
  const nameWord = nameNode.namedChildren[0];
  const read = reader(model);
  const words = [nameWord, ...fields(cmd, 'argument')];
  const assignments = prefixAssignments(cmd);
  const redirections = redirectionsOf(cmd);
  // (Bash expands the words, then the values of the assignments, then the redirections, and stops at the first failure: manual 3.7.1.)
  const failing = [...words, ...assignments.flatMap((a) => fields(a, 'value')), ...redirections.flatMap((r) => r.namedChildren.filter((c) => c.field !== 'descriptor'))]
    .find((w) => read(w).error);
  const removed = [...assignments, ...redirections].sort((a, b) => a.startIndex - b.startIndex)
    .map((x): ArgvRemoved => (x.type === 'variable_assignment' ? assignment(x, cmd, nameWord, model, read, lang) : redirection(x, read, lang)));
  return { span: spanOf(cmd), words: words.flatMap((w) => wordArgv(w, read, lang)), removed, ...(failing ? { fails: { span: spanOf(failing), error: read(failing).error! } } : {}) };
}

/** The words the word `w` gives (`wordArgv`), read alone: a value or a target the sentence of the line says (src/linesentence.ts). */
export function argvWords(w: SyntaxNode, model: StateModel, lang: Lang): ArgvWord[] {
  return wordArgv(w, reader(model), lang);
}

/** What a word gives the program (`receivedFields`), read once for each word of a command. */
type Reader = (w: SyntaxNode) => ReturnType<typeof receivedFields>;
function reader(model: StateModel): Reader {
  const seen = new Map<SyntaxNode, ReturnType<typeof receivedFields>>();
  return (w) => seen.get(w) ?? seen.set(w, receivedFields(w, model)).get(w)!;
}

/**
 * The words the word `w` gives the program: its fields where the model knows them, else its fields with placeholders,
 * else one placeholder for the whole word. A word that gives none is one entry with no parts.
 */
function wordArgv(w: SyntaxNode, read: Reader, lang: Lang): ArgvWord[] {
  const from = spanOf(w);
  const { fields: known, holed } = read(w);
  if (known) {
    if (!known.length) return [{ from, parts: [], count: { min: 0, max: 0 } }];
    return known.map((text) => ({ from, parts: [{ text }], ...(known.length === 1 && text === w.text ? { asWritten: true as const } : {}) }));
  }
  if (!holed) return whole(w, lang);
  return holed.map((f): ArgvWord => {
    // (A pattern that is the whole word is shown as it is written: `"$d"/*.log`.)
    const pattern = f.pattern !== undefined && holed.length === 1 ? w.text : f.pattern;
    const parts: ArgvPart[] = pattern !== undefined
      ? [{ hole: 'names', code: pattern, label: placeholderSaid(lang, { kind: 'names', code: pattern }) }]
      : f.parts.map((p) => ('text' in p ? p : { hole: p.hole.kind, code: p.hole.code, label: placeholderSaid(lang, p.hole), ...(p.splits ? { splits: true as const } : {}) }));
    return { from, parts, ...(f.min === 1 && f.max === 1 ? {} : { count: { min: f.min, ...(f.max === undefined ? {} : { max: f.max }) } }) };
  });
}

/** One placeholder for the words of the whole word `w`, any number of them. */
const whole = (w: SyntaxNode, lang: Lang): ArgvWord[] => [{ from: spanOf(w), parts: [{ hole: 'word', code: w.text, label: placeholderSaid(lang, { kind: 'word', code: w.text }) }], count: { min: 0 } }];

/** A prefix assignment of `cmd`: what it does to the variable (`assignmentsOf`), and its value. */
function assignment(a: SyntaxNode, cmd: SyntaxNode, nameWord: SyntaxNode, model: StateModel, read: Reader, lang: Lang): ArgvRemoved {
  const name = read(nameWord).fields;
  const res = name?.length === 1 ? resolveName(model, name[0], field(cmd, 'name')!, { shell: model.shell, command: true, quoted: name[0] !== nameWord.text }) : 'dynamic';
  const meaning = assignmentsOf(model, cmd, res).find((m) => m.node === a)!;
  const how = meaning.scope !== 'persists' ? 'command' : meaning.sure ? 'stays' : 'maybe-stays';
  const v = field(a, 'value');
  // (No value, `x=`: the empty string. An array, `a=(1)`, is no word.)
  const value = v ? read(v).fields : [''];
  const word = v && v.type !== 'array' ? wordArgv(v, read, lang) : undefined;
  return { kind: 'assignment', span: spanOf(a), text: a.text, says: assignmentSaid(lang, how, meaning.name, value?.length === 1 ? value[0] : undefined), ...(word ? { word } : {}) };
}

/** A redirection: what it does (the dictionary's `redirects`, with its target expanded where that is known), and its target or here-string. */
function redirection(r: SyntaxNode, read: Reader, lang: Lang): ArgvRemoved {
  const fd = field(r, 'descriptor')?.text ?? '';
  const base = { kind: 'redirect' as const, span: spanOf(r), text: r.text };
  if (r.type === 'heredoc_redirect') return { ...base, says: hereSaid(lang, 'heredoc', fd) };
  if (r.type === 'herestring_redirect') {
    const word = r.namedChildren.filter((c) => c.field !== 'descriptor').flatMap((c) => wordArgv(c, read, lang));
    return { ...base, says: hereSaid(lang, 'herestring', fd), word };
  }
  const { op, dest } = redirectParts(r);
  // (One with no target yet, `ls >` while typing, has none.)
  const [target] = fields(r, 'destination');
  if (!target) return { ...base, says: redirects[op](fd, dest)[lang], word: [] };
  const one = read(target).fields;
  return { ...base, says: redirects[op](fd, one?.length === 1 ? one[0] : dest)[lang], word: wordArgv(target, read, lang) };
}
