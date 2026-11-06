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
import { leastOf, mostOf } from './lists';
import { isProgram } from './namefacts';
import { spanOf } from './noteanchors';
import { receivedFields } from './semantics/fieldshape';
import { aliasesAfter, assignmentsOf, runsFunction, type NameResolution, resolveName } from './semantics/names';
import type { StateModel } from './semantics/state';
import { option } from './semantics/shellstate';
import { descendants, field, fields, prefixAssignments, redirectionsOf, rootOf, type SyntaxNode, wordBraces } from './syntax/tree';

/**
 * What the program of each simple command with a name on `line` receives, in source order (also those in a substitution). `shown`: the
 * lines of the tokens the line shows, where a statement continued on other lines shows all its commands (`grep x \\`, then `| wc -l`).
 */
export function argvLines(root: SyntaxNode, line: number, model: StateModel, lang: Lang, shown: ReadonlySet<number> = new Set([line]), carriageReturns: readonly number[] = []): ArgvLine[] {
  let byLang = argvKept.get(model);
  if (!byLang) argvKept.set(model, (byLang = { en: new WeakMap(), ja: new WeakMap() }));
  const kept = byLang[lang];
  const rows = [line, ...shown];
  const range = { from: leastOf(rows), to: mostOf(rows) };
  // (All the lines of a statement over several lines ask for its range.)
  const key = `${range.from} ${range.to}`;
  let commands = commandsKept.get(model)?.get(key);
  if (!commands) {
    commands = descendants(root, ['command'], range);
    if (!commandsKept.has(model)) commandsKept.set(model, new Map());
    commandsKept.get(model)!.set(key, commands);
  }
  return commands
    .filter((c) => (c.startPosition.row <= line && line <= c.endPosition.row) || shown.has(c.startPosition.row))
    .flatMap((c) => {
      // (Each command once: all the lines of one over several lines ask.)
      if (!kept.has(c)) kept.set(c, argvOf(c, model, lang, carriageReturns));
      return kept.get(c) ?? [];
    });
}

const commandsKept = new WeakMap<StateModel, Map<string, SyntaxNode[]>>();
const argvKept = new WeakMap<StateModel, Record<Lang, WeakMap<SyntaxNode, ArgvLine | undefined>>>();

/**
 * What the program of the simple command `cmd` receives; undefined for a command with no name (`x=1`, `>f`), which runs none.
 * `carriageReturns`: where the tree read a CR before a LF as a blank (`SyntaxTree.carriageReturns`), which bash keeps in the last word of the line.
 */
export function argvOf(cmd: SyntaxNode, model: StateModel, lang: Lang, carriageReturns: readonly number[] = []): ArgvLine | undefined {
  const nameNode = field(cmd, 'name');
  if (!nameNode) return undefined;
  const nameWord = nameNode.namedChildren[0];
  const read = reader(model);
  const names = read(nameWord).fields;
  const words = [nameWord, ...fields(cmd, 'argument')];
  const lastWord = words[words.length - 1];
  const crAt = carriageReturnAfter(cmd, carriageReturns);
  const crOnWord = crAt === lastWord.endIndex;
  // (`echo\r`: bash looks for the command of that name, with the CR.)
  const res = names?.length === 1 && !(crOnWord && lastWord === nameWord) ? resolveName(model, names[0], nameNode, { shell: model.shell, command: true, program: isProgram, quoted: names[0] !== nameWord.text }) : 'dynamic';
  const assignments = prefixAssignments(cmd);
  const redirections = redirectionsOf(cmd);
  // (Bash expands the words, then the values of the assignments, then the redirections, and stops at the first failure: manual 3.7.1.)
  const failing = [...words, ...assignments.flatMap((a) => fields(a, 'value')), ...redirections.flatMap((r) => r.namedChildren.filter((c) => c.field !== 'descriptor'))]
    .find((w) => read(w).error);
  const removed = [...assignments, ...redirections].sort((a, b) => a.startIndex - b.startIndex)
    .map((x): ArgvRemoved => (x.type === 'variable_assignment' ? assignment(x, cmd, res, model, read, lang) : redirection(x, read, lang)));
  const inside = runsInside(res);
  // (`set -k`: a word in the form of an assignment is one for the command, wherever it stands; on some paths, it may be.)
  const keyword = option(model.at(cmd).run, 'set', 'keyword');
  const given = (w: SyntaxNode): ArgvWord[] => {
    if (w !== nameWord && keyword !== 'off' && keyword !== 'default' && ASSIGNMENT_WORD.test(w.text)) return keyword === 'on' ? [{ from: spanOf(w), parts: [], count: { min: 0, max: 0 } }] : whole(w, lang);
    return aliases.includes(w) ? whole(w, lang) : wordArgv(w, read, lang);
  };
  // (An alias is replaced by its text before bash reads the words: what they then are, the alias's text says, not its name. One that ends in a blank does so to the next word too.)
  const aliases = res !== 'dynamic' && res.kind === 'alias' ? [nameWord, ...aliasesAfter(cmd, res, (n, at) => resolveName(model, n, at, { shell: model.shell, command: true, program: isProgram })).map((a) => a.word)] : [];
  const argv = words.flatMap((w) => (w === lastWord && crOnWord ? withCarriageReturn(given(w), w, lang) : given(w)));
  // (A blank before the CR: to bash, the CR is a word of its own.)
  const crWord: ArgvWord[] = crAt !== undefined && crAt > cmd.endIndex ? [{ from: { start: spanOf(cmd).end, end: spanOf(cmd).end }, parts: [{ text: '\r' }] }] : [];
  return { span: spanOf(cmd), ...(inside ? { inside } : {}), words: [...argv, ...crWord], removed, ...(failing ? { fails: { span: spanOf(failing), error: read(failing).error! } } : {}) };
}

/** Where the name surely runs in the shell itself, with no program started: a builtin, or a function on every path (`resolveName`, which test/names-probes.test.ts compares with `type -t`). */
function runsInside(res: NameResolution | 'dynamic'): ArgvLine['inside'] {
  if (res === 'dynamic') return undefined;
  if (res.kind === 'builtin') return res.disabled ? undefined : 'builtin';
  if (res.kind === 'file' && res.sourced) return 'sourced';
  return runsFunction(res) ? 'function' : undefined;
}

/** A word in the form of an assignment, as bash reads one before quote removal (`a=b`, `a[1]+=b`; not `"a=b"`). */
const ASSIGNMENT_WORD = /^[A-Za-z_]\w*(?:\[[^\]]*\])?\+?=/;

/** The CR that ends the line of `cmd` with nothing but blanks after the command, if any. */
function carriageReturnAfter(cmd: SyntaxNode, carriageReturns: readonly number[]): number | undefined {
  const at = carriageReturns.find((i) => i >= cmd.endIndex);
  return at !== undefined && !/\S/.test(rootOf(cmd).text.slice(cmd.endIndex, at)) ? at : undefined;
}

/**
 * The words of `node`, the last word of a line that ends in CR LF: bash keeps the CR at its end (`a\r`, shown `a␍`), so nothing is as written. In each word of
 * a brace expansion (`{a,b}\r`); only in the last field otherwise. A pattern holds it too, which then matches little.
 */
function withCarriageReturn(words: ArgvWord[], node: SyntaxNode, lang: Lang): ArgvWord[] {
  const carried = (w: ArgvWord): ArgvWord => {
    const { asWritten: _a, count, ...rest } = w;
    const last = w.parts[w.parts.length - 1];
    const before = w.parts.slice(0, -1);
    if (last && 'hole' in last && last.hole === 'names') return { ...w, parts: [...before, { ...last, code: `${last.code}\r`, label: placeholderSaid(lang, { kind: 'names', code: `${last.code}␍` }) }] };
    // (`set -k`: an assignment, whose value holds it.)
    if (!last) return w;
    return { ...rest, ...(count ? { count } : {}), parts: 'text' in last ? [...before, { text: `${last.text}\r` }] : [...w.parts, { text: '\r' }] };
  };
  return wordBraces(node).length ? words.map(carried) : [...words.slice(0, -1), carried(words[words.length - 1])];
}

/** The words the word `w` gives (`wordArgv`), read alone: a value or a target the sentence of the line says (src/linesentence.ts), which leaves out what a pattern gives where nothing matches. */
export function argvWords(w: SyntaxNode, model: StateModel, lang: Lang): ArgvWord[] {
  return wordArgv(w, reader(model), lang, false);
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
function wordArgv(w: SyntaxNode, read: Reader, lang: Lang, saysUnmatched = true): ArgvWord[] {
  const from = spanOf(w);
  const { fields: known, holed } = read(w);
  if (known) {
    if (!known.length) return [{ from, parts: [], count: { min: 0, max: 0 } }];
    // (A CR read as text, as on a last line with no LF, is not to be seen as written: it shows as `␍`.)
    return known.map((text) => ({ from, parts: [{ text }], ...(known.length === 1 && text === w.text && !text.includes('\r') ? { asWritten: true as const } : {}) }));
  }
  if (!holed) return whole(w, lang);
  return holed.map((f): ArgvWord => {
    // (A pattern that is the whole word is shown as it is written: `"$d"/*.log`.)
    const pattern = f.pattern !== undefined && holed.length === 1 ? w.text : f.pattern;
    const parts: ArgvPart[] = pattern !== undefined
      ? [{ hole: 'names', code: pattern, label: placeholderSaid(lang, { kind: 'names', code: pattern, ...(f.unmatched && saysUnmatched ? { unmatched: f.unmatched } : {}) }) }]
      : f.parts.map((p) => ('text' in p ? p : { hole: p.hole.kind, code: p.hole.code, label: placeholderSaid(lang, p.hole), ...(p.splits ? { splits: true as const } : {}) }));
    return { from, parts, ...(f.min === 1 && f.max === 1 ? {} : { count: { min: f.min, ...(f.max === undefined ? {} : { max: f.max }) } }) };
  });
}

/** One placeholder for the words of the whole word `w`, any number of them. */
const whole = (w: SyntaxNode, lang: Lang): ArgvWord[] => [{ from: spanOf(w), parts: [{ hole: 'word', code: w.text, label: placeholderSaid(lang, { kind: 'word', code: w.text }) }], count: { min: 0 } }];

/** A prefix assignment of `cmd`: what it does to the variable (`assignmentsOf`), and its value. */
function assignment(a: SyntaxNode, cmd: SyntaxNode, res: NameResolution | 'dynamic', model: StateModel, read: Reader, lang: Lang): ArgvRemoved {
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
  if (!target) return { ...base, says: redirects[op].says(fd, dest)[lang], word: [] };
  const one = read(target).fields;
  return { ...base, says: redirects[op].says(fd, one?.length === 1 ? one[0] : dest)[lang], word: wordArgv(target, read, lang) };
}
