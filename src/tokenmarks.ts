// What the analyzer marks on the tokens it makes: who reads each part (`Token.origin`, src/analyzer-types.ts), for the
// tree view of the panel (src/reading.ts), and the labels their explanations need not repeat.
import type { LineExplanation, ScriptProcess, Token, TokenOrigin } from './analyzer-types';
import { sameSpan, spanWithin } from './noteanchors';
import { LEVELS } from './levels';
import { plainOf } from './messages-levels';
import { readSaid } from './messages-tokens';
import { KIND_ROLES } from './roles';
import { type ExecEnv, processOf, whereOf } from './semantics/env';

/** Marks `t` and the tokens under it that have no origin yet as read by `origin` (`Token.origin`). */
export function claim(t: Token, origin: TokenOrigin): Token {
  if (!t.origin) {
    t.origin = origin;
    for (const c of t.children) claim(c, origin);
  }
  return t;
}

/**
 * The tokens of a command's words as the command reads them (`Token.origin` `argv`): what its parse made, and the parts
 * under them no one else claimed. A word token bash's reading made (an operand with no description of its own: `eval
 * "ls"`, `set -- $(getopt …)`) stays bash's: the command takes the word as it is.
 */
export function readByCommand(ts: Token[]): Token[] {
  for (const t of ts) claim(t, 'argv');
  return ts;
}

/**
 * Marks the tokens of a string read as a script that its shell reads (`Token.origin` `script`; not its commands'
 * readings), and which shell that is (`process`, on the outermost).
 */
export function readAsScript(t: Token, process?: ScriptProcess): void {
  if (!t.origin || t.origin === 'shell') t.origin = 'script';
  if (process) t.process = process;
  for (const c of t.children) readAsScript(c);
}

/**
 * Which shell reads the string a slot runs, from where it runs (`env`, src/semantics/env.ts): this shell when the
 * slot starts no process (`eval`, a trap), else another shell, here or elsewhere.
 */
export function scriptProcess(env: ExecEnv): ScriptProcess {
  const where = whereOf(env);
  if (where !== 'local') return where;
  const slot = env.links[env.links.length - 1];
  // (A slot that reads a string as a script starts a new shell; a subshell is the `$( )` of the reading itself.)
  return processOf(env).link === slot ? 'shell' : 'same';
}

/**
 * Every renderer shows a token's label beside its explanation, so an explanation that opens with the label
 * quoted (`` `%s`: value 1 as a string ``) says it twice: remove that opening. The text stays when it only
 * mentions the label in a sentence. Done on the finished tree, since the same texts stand alone elsewhere
 * (notes, summaries, examples).
 */
export function dropLabelEcho(t: Token): void {
  const label = t.label.trim();
  const e = t.explanation;
  if (e.startsWith('`' + label + '`')) {
    const rest = e.slice(label.length + 2);
    const m = /^(?::\s+|：\s*)(?=\S)/.exec(rest);
    if (m) {
      t.explanation = rest.slice(m[0].length);
      // (A warning that opens with the label loses it too, and keeps its mark: `markedText` finds it by its text.)
      const opening = e.slice(0, e.length - t.explanation.length);
      if (t.marks) t.marks = t.marks.map((w) => (w.text.startsWith(opening) ? { ...w, text: w.text.slice(opening.length) } : w));
    }
  }
  for (const c of t.children) dropLabelEcho(c);
}

/**
 * Gives every token of a line its role (`Token.role`, from its kind: src/roles.ts) and the facts of the line about it
 * (`Token.facts`): a fact said at a node (`LineExplanation.anchors`) belongs to the outermost token of the same range,
 * else to the innermost token around that range; a fact said about the line belongs to none. Made again from the
 * anchors when it runs again (a host adds its own facts: src/hosts/remap.ts).
 */
export function markTokens(items: readonly Token[], ex: Pick<LineExplanation, 'facts' | 'anchors'>): void {
  const all: Token[] = [];
  const walk = (t: Token) => {
    t.role = KIND_ROLES[t.kind];
    delete t.facts;
    all.push(t);
    t.children.forEach(walk);
  };
  items.forEach(walk);
  const ids = new Map((ex.facts ?? []).map((f) => [f.text, f.id]));
  for (const a of ex.anchors ?? []) {
    const id = ids.get(a.text);
    if (!id) continue;
    const around = all.filter((t) => spanWithin(a.span, t.span));
    const exact = around.find((t) => sameSpan(a.span, t.span));
    // (The tokens around a range are a chain from the outermost in, in the order of the walk: the last is the innermost.)
    const at = exact ?? around.at(-1);
    // (Said at several nodes of one token, it is listed once.)
    if (at) at.facts = [...new Set([...at.facts ?? [], id])];
  }
}

/**
 * Takes the ids that the texts of the catalog of token texts carry (`carried`, src/messages-tokens.ts) out of a line's tokens, and gives each
 * token the ids it held (`Token.texts`) and, for those that warn, their levels (`Token.marks`). A token of a string read as a script has its
 * own from that line's explanation, and keeps them.
 */
export function markSaid(items: readonly Token[]): void {
  const walk = (t: Token) => {
    const { text, said } = readSaid(t.explanation);
    t.explanation = text;
    if (t.summary) t.summary = plainOf(t.summary);
    if (said.length) t.texts = [...new Set([...t.texts ?? [], ...said.map((s) => s.id)])];
    const marks = said.filter((s) => s.level).map((s) => ({ id: s.id, level: s.level!, text: s.text }));
    // (A text said twice in one token is marked once.)
    if (marks.length) t.marks = marks.filter((m, i) => marks.findIndex((o) => o.id === m.id && o.text === m.text) === i);
    t.children.forEach(walk);
  };
  items.forEach(walk);
}

/** Gives a token another text (a host's reading of a part: src/hosts/): the ids and the warnings of the text it had go with that text. */
export function sayInstead(t: Token, text: string): void {
  t.explanation = text;
  delete t.texts;
  delete t.marks;
}

/** A token's text as it is shown: the mark of each warning in it (`Token.marks`) before the warning, from the level table. */
export function markedText(t: Pick<Token, 'explanation' | 'marks'>): string {
  return (t.marks ?? []).reduce((text, m) => text.replace(m.text, () => `${LEVELS[m.level].mark} ${m.text}`), t.explanation);
}
