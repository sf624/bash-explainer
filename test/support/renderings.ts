// The renderings and the roles (docs/design/oracles.md, 2.5, 2.8 and step 9): on top of the argv capture
// (test/support/argv.ts), what the explanation shows of each word is compared with the argv bash gave the recorder.
//
// - **Renderings.** Some parts of the explanation state how many words bash makes of a word (`claimsOf`): the value of
//   an expansion and the words it splits into (`Token.value`), a brace expansion (its token and its example), a
//   double-quoted string that "stays one argument", a concatenation "joined into one word", and the token of an argument
//   with no `Token.expands` (the panel shows it as one argument). Each must be the number of fields bash gave the word,
//   in every run. Where the model knows the word's fields, they are bash's (the argv check confirmed them); where it
//   does not (2.3: then the explanation must state no count bash can contradict), bash's are those between the known
//   words around it, when it is the only word not known (`wordCounts`). A glob example is shown only where the model
//   says the glob step may apply.
// - **Roles.** The argument interpreter (src/argv/) reads the words as written, not their fields. Where the model knows
//   the fields of every word and some word gives other than one, the interpreter reads bash's argv, and the role of each
//   field must be one the explanation shows on its word: an option, the value of the same option, or an operand whose
//   text from the spec the word's token says (alone, or in the hedge "… when `$x` expands to a single word; … when it
//   expands to more" that src/explain/argv.ts makes of `ArgRole.otherwise` and `several`).
//
// The counts come from the facts the tokens carry (`Token.value`, `Token.expands`, `Token.origin`, the refs and the
// words of a brace expansion, the sections of an example); only the string and the concatenation are told by their
// sentence, which is the one thing that differs between their two forms. Differences are listed in
// test/fixtures/renderings-known.json with their reasons, as in argv-known.json.
import * as path from 'path';
import { Analyzer, type Example, type Span, type Token } from '../../src/analyzer';
import { type ArgRole, interpret } from '../../src/argv/interpret';
import { lookupCommand } from '../../src/dict/aliases';
import { isGlob } from '../../src/examples/shellwords';
import { braceExpansion } from '../../src/explain/words';
import { spanOf } from '../../src/noteanchors';
import { resolveName } from '../../src/semantics/names';
import { type Fields, wordFields, wordMeaning } from '../../src/semantics/words';
import { field, type SyntaxNode } from '../../src/syntax/tree';
import { type ArgvEnvName, ARGV_ENVS, type ArgvInput, type ArgvMarker, type ArgvPlanRun, compareMarker, runEnv, splitTargets } from './argv';

// ---------------------------------------------------------------------------------------------------
// What the explanation shows of each word.

/** The tokens and the examples of an input's explanation, by their span (`spanKey`). */
export interface Shown { tokens: Map<string, Token[]>; examples: Map<string, Example[]> }

export const spanKey = (s: Span): string => `${s.start.line}:${s.start.character}-${s.end.line}:${s.end.character}`;

const allTokens = (ts: readonly Token[]): Token[] => ts.flatMap((t) => [t, ...allTokens(t.children)]);

/** Explains every line of an input in English, as the extension does (a host's region with its options). */
export function explainInput(input: ArgvInput, analyzer = new Analyzer('en')): Shown {
  const shown: Shown = { tokens: new Map(), examples: new Map() };
  const add = <T>(map: Map<string, T[]>, k: string, v: T): void => { map.set(k, [...(map.get(k) ?? []), v]); };
  const rows = input.tree.root.endPosition.row + 1;
  for (let row = 0; row < rows; row++) {
    const e = analyzer.explainLine(input.tree, row, input.explain?.shell ?? 'bash', input.explain?.opts ?? {});
    for (const t of allTokens(e.items)) add(shown.tokens, spanKey(t.span), t);
    for (const x of e.examples) if (x.anchor) add(shown.examples, spanKey(x.anchor), x);
  }
  return shown;
}

/** Where a count of words is said: see the head of this file. */
export type ClaimSource = 'value' | 'brace' | 'brace-example' | 'string' | 'argument' | 'concatenation';

/** A number of words the explanation says bash makes of a word. */
export interface Claim { source: ClaimSource; count: number }

const BRACE_REF = '3.5.1';

/**
 * The numbers of words the explanation says bash makes of the word `w` (its tokens and examples over the whole word):
 * - `value`: the value of an expansion that is the whole word, and the words it splits into; none where bash then globs it;
 * - `brace`: the token of a brace expansion, where the model says the braces expand, and none of the words is a glob;
 * - `brace-example`: the words of the example of a brace expansion ("N separate arguments"), unless cut;
 * - `string`: a double-quoted string that "stays one argument" (not the one of `"$@"`, one word per element);
 * - `concatenation`: a word of several parts that are "joined into one word" (not one with `"$@"` in it, which says
 *   it is not one word);
 * - `argument`: the token of an argument or an option's value with no `Token.expands`, which the panel shows as one argument.
 */
export function claimsOf(w: SyntaxNode, shown: Shown, input: ArgvInput): Claim[] {
  const key = spanKey(spanOf(w));
  const out: Claim[] = [];
  const steps = wordMeaning(w, input.model)?.steps ?? [];
  const applies = (k: string) => steps.find((s) => s.kind === k)?.applies;
  for (const t of shown.tokens.get(key) ?? []) {
    if (t.value && !t.value.glob && !t.value.joined) out.push({ source: 'value', count: t.value.words?.length ?? 1 });
    if (t.kind === 'expansion' && t.refs?.includes(BRACE_REF) && applies('brace') === true) {
      const words = braceExpansion(w);
      if (words && !words.some(isGlob)) out.push({ source: 'brace', count: words.length });
    }
    // (The rendered sentence: which of the two `string` of src/explain/words.ts chose.)
    if (t.kind === 'string' && t.explanation.includes('(stays one argument)')) out.push({ source: 'string', count: 1 });
    if (t.kind === 'argument' && t.origin === 'argv' && !t.expands) out.push({ source: 'argument', count: 1 });
    if (t.kind === 'argument' && t.origin === 'shell' && t.explanation.startsWith('Concatenation: the parts below are joined into one word')) {
      out.push({ source: 'concatenation', count: 1 });
    }
  }
  for (const x of shown.examples.get(key) ?? []) {
    const words = x.kind === 'glob' ? x.sections.find((s) => s.words) : undefined;
    if (words && !words.words!.after) out.push({ source: 'brace-example', count: words.lines.length });
  }
  return out;
}

/** Whether the explanation shows an example of the files a glob matches on the word `w` (not one of a brace expansion). */
export function globExampleOn(w: SyntaxNode, shown: Shown): boolean {
  // (Not the example of a pattern a command matches, find's `-name '*.log'`: the files are those of a glob alone.)
  return (shown.examples.get(spanKey(spanOf(w))) ?? []).some((x) => x.kind === 'glob' && !x.sections.some((s) => s.words)
    && (x.interactive ? x.interactive.spec.kind === 'glob' && x.interactive.spec.mode === 'file' : x.title.startsWith('Example (glob ')));
}

// ---------------------------------------------------------------------------------------------------
// Comparing.

/** A difference: the input, the environment, the command, the word, which check, and what differs. */
export interface RenderFinding { input: string; env: ArgvEnvName; command: string; word: string; check: 'count' | 'glob-example' | 'role'; source?: ClaimSource; what: string }

/**
 * What the checks went over, in each environment: the words with a count said and bash's known (`words`; `unknown`: of
 * them, those the model gives no fields), the counts compared (`claims`), the glob examples, and the commands whose
 * argv the interpreter read again (`roleCommands`) with the fields compared (`roleFields`).
 */
export interface RenderCounts { words: number; unknown: number; claims: number; globExamples: number; roleCommands: number; roleFields: number }

/**
 * The number of fields bash gave each word of a marker in one run (`argv`), where it is known: the model's, with the
 * run's environment, for a word it knows; for the only word it does not know, what lies between the known words
 * around it. Undefined where more than one word is not known.
 */
export function wordCounts(results: readonly Fields[], argv: readonly string[]): (number | undefined)[] {
  const unknown = results.filter((r) => !r.fields).length;
  const known = results.reduce((n, r) => n + (r.fields?.length ?? 0), 0);
  return results.map((r) => r.fields?.length ?? (unknown === 1 ? argv.length - known : undefined));
}

/** `-x` as the texts write it (`+x` of `set +x`). */
const dash = (flag: string): string => flag.replace(/^\+/, '-');
/** A text with its `$N` numbers made alike (`$3` in a token, `$N` in the spec). */
const plain = (s: string): string => s.replace(/`\$(\d+|N)`/g, '`$N`');

/**
 * Whether one of the tokens shown on a word shows the role bash's argv gives one of its fields: an option as an option,
 * the value of an option as that option's value, an operand as an argument whose text says the spec's text of it.
 * Undefined for the roles not compared (a command another runs, a subcommand, a terminator…).
 */
function showsRole(role: ArgRole, tokens: readonly Token[], first: boolean): boolean | undefined {
  // (The value of an option that bash expands into several words: the first is the value, the others operands,
  // `Token.valueFor` with `Token.expands`.)
  const spliced = !first && tokens.some((t) => t.valueFor && t.expands);
  switch (role.role) {
    case 'option': case 'cluster': case 'pattern-option': case 'unknown-option': case 'end-of-options':
      return tokens.some((t) => t.kind === 'option');
    case 'value':
      return tokens.some((t) => t.valueFor === dash(role.of));
    case 'operand':
      if (role.spec?.assignment || role.assignment) return undefined;
      if (spliced) return true;
      // (Or as the role of one of the words of a brace expansion: `destination: the new name…`, `eachText`.)
      return tokens.some((t) => t.kind === 'argument' && !t.valueFor
        && (!role.spec || [role.spec.text.en, role.spec.text.en.replace(/ \((.*)\)$/, ': $1')].some((x) => plain(t.explanation).includes(plain(x)))));
    default:
      return undefined;
  }
}

/** The role as the report says it. */
function roleName(role: ArgRole): string {
  switch (role.role) {
    case 'option': return `option ${role.flag}`;
    case 'value': return `value of ${role.of}`;
    case 'operand': return role.spec ? `operand "${role.spec.text.en}"` : 'operand';
    default: return role.role;
  }
}

/**
 * The roles of the fields of a marker whose words the model all knows, with some word giving other than one field:
 * the interpreter reads bash's argv (`fields`, per word) with the spec of its command, and each field's role must be
 * shown on its word. Nothing for a command of no spec, a function, a name that is not one field.
 */
function compareRoles(m: ArgvMarker, fields: readonly string[][], input: ArgvInput, shown: Shown, counts: RenderCounts): { word: string; what: string }[] {
  if (fields.every((f) => f.length === 1) || fields[0].length < 1) return [];
  const name = fields[0][0];
  // (`[` and `test` read their words as an expression, src/explain/tests.ts, not with the interpreter.)
  if (name === '[' || name === 'test') return [];
  const resolved = resolveName(input.model, name, field(m.command, 'name')!, { command: true });
  if (resolved.kind !== 'builtin' && resolved.kind !== 'file') return [];
  const spec = lookupCommand(name);
  if (!spec) return [];
  const argv = fields.flat().slice(1);
  // (The word of each field, and whether it is the first of its word.)
  const owner = fields.flatMap((f, k) => f.map((_, j) => ({ k, first: j === 0 }))).slice(1);
  const tokensOf = (w: SyntaxNode): Token[] => (shown.tokens.get(spanKey(spanOf(w))) ?? []).filter((t) => t.kind === 'argument' || t.kind === 'option');
  const parse = interpret(spec, argv.map((value) => ({ value })), { name, lookup: lookupCommand });
  counts.roleCommands++;
  const out: { word: string; what: string }[] = [];
  for (const { word, role } of parse.roles) {
    // (The words a name gives after the first, `{ls,-l}`: the token of the name says what it runs.)
    if (owner[word].k === 0) continue;
    const w = m.words[owner[word].k];
    const ok = showsRole(role, tokensOf(w), owner[word].first);
    if (ok === undefined) continue;
    counts.roleFields++;
    if (!ok) out.push({ word: w.text, what: `bash gives it \`${argv[word]}\`, ${roleName(role)}; shown: ${JSON.stringify(tokensOf(w).map((t) => t.explanation))}` });
  }
  return out;
}

/**
 * Compares what the explanation shows with bash's runs (`plans`, from `runArgv`): the counts said, the glob examples,
 * and the roles. A marker whose argv differs from the model's (the argv check reports it) is left out.
 */
export function checkRenderings(plans: readonly ArgvPlanRun[]): { found: RenderFinding[]; counts: Record<ArgvEnvName, RenderCounts> } {
  const counts = Object.fromEntries(ARGV_ENVS.map((e) => [e, { words: 0, unknown: 0, claims: 0, globExamples: 0, roleCommands: 0, roleFields: 0 }])) as Record<ArgvEnvName, RenderCounts>;
  const found: RenderFinding[] = [];
  const analyzer = new Analyzer('en');
  const explained = new Map<ArgvInput, Shown>();
  for (const p of plans) {
    const shown = explained.get(p.input) ?? explainInput(p.input, analyzer);
    explained.set(p.input, shown);
    const env = runEnv(p);
    const c = counts[p.env];
    for (const m of p.inst.markers) {
      const records = p.run.records.get(m.id) ?? [];
      const scratch = { commands: 0, ran: 0, words: 0, unknown: 0, failing: 0 };
      if (!records.length || compareMarker(m, p.input.model, env, records, scratch).length || scratch.failing) continue;
      const push = (word: string, check: RenderFinding['check'], what: string, source?: ClaimSource): void => {
        found.push({ input: p.input.name, env: p.env, command: m.command.text, word, check, ...(source ? { source } : {}), what });
      };
      const results = m.words.map((w) => wordFields(w, p.input.model, env));
      const argvs = records.map((r) => splitTargets(r).argv);
      m.words.forEach((w, k) => {
        if (globExampleOn(w, shown)) {
          c.globExamples++;
          const glob = wordMeaning(w, p.input.model)?.steps.find((s) => s.kind === 'glob');
          if (glob?.applies === false) push(w.text, 'glob-example', `a glob example where the glob step does not apply (${glob.why})`);
        }
        const claims = claimsOf(w, shown, p.input);
        const got = [...new Set(argvs.map((a) => wordCounts(results, a)[k]))];
        if (!claims.length || got.includes(undefined)) return;
        c.words++;
        if (!wordFields(w, p.input.model).fields) c.unknown++;
        for (const claim of claims) {
          c.claims++;
          const other = got.find((g) => g !== claim.count);
          if (other !== undefined) push(w.text, 'count', `${claim.source} says ${claim.count}, bash gave ${other}`, claim.source);
        }
      });
      if (results.every((r) => r.fields)) {
        for (const r of compareRoles(m, results.map((r) => r.fields!), p.input, shown, c)) push(r.word, 'role', r.what);
      }
    }
  }
  return { found, counts };
}

// ---------------------------------------------------------------------------------------------------
// The accepted differences (test/fixtures/renderings-known.json).

/**
 * An accepted difference: the input (its name), the command, the word, the check, the source of the count (`count`),
 * the environment (both when absent), why. An entry with no input accepts every difference of its check and source: a
 * class of them with one cause (it is stale when none of the inputs run has one).
 */
export interface RenderKnown { input?: string; command?: string; word?: string; check: RenderFinding['check']; source?: ClaimSource; env?: ArgvEnvName; reason: string }

/** The known differences and the pinned counts of each set of inputs the test runs (`fixtures`, `snippets`: the sample). */
export interface RenderKnownFile { counts: Record<string, Record<ArgvEnvName, RenderCounts>>; known: RenderKnown[] }

export const RENDER_KNOWN = path.join(__dirname, '..', 'fixtures', 'renderings-known.json');

/**
 * The differences no entry of `known` accepts, the entries of an input that are stale (those of an input in `inputs`
 * that accept no difference; entries of inputs not run are neither), and the entries of a class that accepted one
 * (`classes`, their indices: one is stale when no set of inputs used it).
 */
export function matchRenderKnown(found: readonly RenderFinding[], known: readonly RenderKnown[], inputs: readonly ArgvInput[]): { unexplained: string[]; stale: string[]; classes: number[] } {
  const used = new Set<number>();
  const accepts = (e: RenderKnown, f: RenderFinding): boolean => e.check === f.check && (!e.source || e.source === f.source) && (!e.env || e.env === f.env)
    && (e.input === undefined || (e.input === f.input && e.command === f.command && e.word === f.word));
  const unexplained = found.filter((f) => {
    const k = known.findIndex((e) => accepts(e, f));
    if (k >= 0) used.add(k);
    return k < 0;
  }).map((f) => `${JSON.stringify(f.input)} (${f.env}): ${f.command} [${f.word}, ${f.check}]\n    ${f.what}`);
  const names = new Set(inputs.map((i) => i.name));
  const stale = known.filter((e, k) => e.input !== undefined && names.has(e.input) && !used.has(k)).map((e) => `${JSON.stringify(e.input)}: ${e.command} [${e.word}, ${e.check}]`);
  return { unexplained, stale, classes: [...used].filter((k) => known[k].input === undefined) };
}

/** The entries of a class that no set used (`matchRenderKnown`'s `classes` of each set). */
export function staleClasses(known: readonly RenderKnown[], used: Iterable<number>): string[] {
  const all = new Set(used);
  return known.flatMap((e, k) => (e.input === undefined && !all.has(k) ? [`${e.check} ${e.source ?? ''}`] : []));
}
