// The normal-forms table (docs/design/oracles.md, 4.2 and step 7): for each function of src/ that maps several
// spellings to one key (4.1), groups of forms that bash runs the same (`same`) and near-misses it runs otherwise
// (`differ`). test/normal-forms.test.ts checks both sides of each row: the key each form gets here (`KEYS`), and
// what bash gives (`observe`), run with test/support/rewrite-states.ts's `runJobs` with no walls (the forms are
// hand-written, not the corpus), each batch contained (test/support/contained.ts).
//
// A row where the keys disagree with bash is a finding: a false merge (a `differ` row whose forms get one key: the
// explanation says the same of forms bash runs otherwise) or a missed match (a `same` row whose forms get different
// keys: the explanation misses what it knows of one of them). Each is recorded in its row (`known`, with the reason),
// as test/fixtures/bash-ast-known.json does; a row whose keys agree with bash while it says `known` is stale and fails.
import * as fs from 'fs';
import * as path from 'path';
import { canonicalName, impliedWords, lookupCommand } from '../../src/dict/aliases';
import { argWord } from '../../src/argv/words';
import { optionsBefore } from '../../src/argv/query';
import { type ArgRole, interpret } from '../../src/argv/interpret';
import { testChain } from '../../src/fixes';
import { nameOf, outputsOf } from '../../src/idioms';
import { commandName, runCommands } from '../../src/pitfalls';
import { findWords } from '../../src/embedded/find';
import { argWordIn } from '../../src/semantics/argwords';
import { commandName as staticName } from '../../src/semantics/effects';
import { type SlotLink, slotEnvs } from '../../src/semantics/env';
import { resolveRun, testSpecOf } from '../../src/semantics/names';
import { shellState } from '../../src/semantics/state';
import { staticWordValue } from '../../src/staticword';
import { commandTest, type TestExpr } from '../../src/testexpr';
import { createUnbashParser } from '../../src/syntax/adapters/unbash';
import { descendants, field, fields, type SyntaxNode, type SyntaxTree } from '../../src/syntax/tree';
import type { Job } from './rewrite-states';

const parser = createUnbashParser();

/** The normalizers of 4.1, by the function the key is read from. */
export const NORMALIZERS = ['canonicalName', 'lookupCommand', 'commandName', 'nameOf', 'staticWordValue', 'findWords', 'commandTest', 'outputsOf',
  'lookupOption', 'shellFromName', 'arithTrees', 'testChain'] as const;
export type Normalizer = typeof NORMALIZERS[number];

/** What a run gives that a row compares: its streams, its status, the files left in its directory. */
export type Observed = 'stdout' | 'stderr' | 'status' | 'files';

export interface Row {
  normalizer: Normalizer;
  /** Forms bash runs the same: each a script, whose subject (`subject`) the key reads. */
  same?: string[];
  /** Forms bash runs otherwise, each from every other. */
  differ?: string[];
  observe: Observed[];
  /** Files of the run's directory, with their text (one that starts with `#!` is executable). */
  files?: Record<string, string>;
  stdin?: string;
  /** Code before each form, in its tree too (`f() { …; }`): the key reads the form's last statement. */
  prelude?: string;
  /** Variables of the environment of each run. */
  env?: Record<string, string>;
  /** Code run after each form, on a line of its own, and not keyed: what the observation reads (`echo "$x"`). */
  epilogue?: string;
  /** Programs a form runs that may be missing here (`busybox`): the run is skipped without them, not the keys. */
  requires?: string[];
  /** What the row is about, for a reader of the table. */
  note?: string;
  /** Why the keys disagree with bash here: a finding, left to its own PR or accepted (see the top of this file). */
  known?: string;
}

export const TABLE = path.join(__dirname, '..', 'fixtures', 'oracles', 'normal-forms.json');
export const readTable = (): Row[] => JSON.parse(fs.readFileSync(TABLE, 'utf8')) as Row[];
export const formsOf = (row: Row): string[] => row.same ?? row.differ ?? [];

/**
 * The command a form is about: the first simple command of its last statement (what comes before sets the scene:
 * `cd() { …; }; cd sub`; a pipe after it shapes the output: `find . | sort`).
 */
export function subject(tree: SyntaxTree): SyntaxNode {
  const last = tree.root.namedChildren.filter((c) => c.type !== 'comment').at(-1);
  const first = last && (last.type === 'command' ? last : descendants(last, ['command'])[0]);
  if (!first) throw new Error(`no command in ${JSON.stringify(tree.root.text)}`);
  return first;
}

const nameWordOf = (c: SyntaxNode): SyntaxNode => {
  const n = field(c, 'name');
  if (!n) throw new Error(`no name in ${JSON.stringify(c.text)}`);
  return n.namedChildren[0] ?? n;
};
const argsOf = (c: SyntaxNode): SyntaxNode[] => fields(c, 'argument');
const valueOr = (w: SyntaxNode): string => staticWordValue(w) ?? `(${w.text})`;

/** The words the interpreter read, as `name=value` and `operand value`: what the parse means, whatever its spelling. */
function meaning(roles: readonly { word: number; role: ArgRole }[], values: readonly string[]): string[] {
  const out: string[] = [];
  const option = (r: ArgRole, word: number): void => {
    if (r.role === 'option') {
      const attached = r.value?.attached;
      out.push(`${r.spec.names[0]}${attached === undefined ? '' : `=${values[word].slice(attached)}`}${r.disables ? ' off' : ''}`);
    } else if (r.role === 'cluster') r.letters.forEach((l) => option(l, word));
    else if (r.role === 'unknown-option') out.push(`unknown ${r.flag}${r.ambiguous ? ` (${r.ambiguous.join(' ')})` : ''}`);
    else if (r.role === 'value') out[out.length - 1] += `=${values[word]}`;
    else if (r.role === 'operand') out.push(`operand ${values[word]}`);
    // (Another role, such as a word whose value is not known (`open-option`): with the word, which tells it from others.)
    else out.push(`${r.role} ${values[word]}`);
  };
  for (const { word, role } of roles) option(role, word);
  // (The options in any order, the operands in theirs: `-vi` is `-iv`.)
  return [...out.filter((x) => !x.startsWith('operand ')).sort(), ...out.filter((x) => x.startsWith('operand '))];
}

/** The value of `r` in the model's state where the subject runs (`echo "$r"`), or that it has none. */
function lastValue(tree: SyntaxTree, c: SyntaxNode): string {
  return shellState(tree, 'bash').at(c).run.variables.get('r')?.value ?? '(not known)';
}

/**
 * The key of each normalizer: what the function makes of the subject of a form. Forms that get one key are said to
 * be the same; the test compares the keys of a row's forms.
 */
export const KEYS: Record<Normalizer, (tree: SyntaxTree, c: SyntaxNode) => string> = {
  // (The program whose spec the name uses, with the words it implies: `egrep x` is `grep -E x`.)
  // (Given the name's value, as the product's callers give it, `src/semantics/status.ts` among them: a path stays one.)
  canonicalName: (_, c) => {
    const name = staticName(c) ?? `(${nameWordOf(c).text})`;
    return [canonicalName(name), ...impliedWords(name), ...argsOf(c).map(valueOr)].join(' ');
  },
  // (The spec the name is read with: a builtin's, or the program's of a path to one.)
  lookupCommand: (_, c) => {
    const spec = lookupCommand(valueOr(nameWordOf(c)));
    return spec ? `${spec.summary.en}${spec.builtin ? ' (builtin)' : ''}` : '(none)';
  },
  commandName: (_, c) => commandName(c) ?? '(none)',
  nameOf: (_, c) => nameOf(c) ?? '(none)',
  // (The value of the subject's last word.)
  staticWordValue: (_, c) => {
    const words = argsOf(c);
    return words.length ? staticWordValue(words[words.length - 1]) ?? '(not known)' : '(no word)';
  },
  // (The words of find's expression as src/explain/argv.ts reads them (`findWords`): from where find's spec says it starts.)
  findWords: (_, c) => {
    const args = argsOf(c);
    const parse = interpret(lookupCommand('find')!, args.map(argWord), { name: 'find', lookup: lookupCommand });
    return JSON.stringify(findWords(args.slice(parse.expression, parse.end)));
  },
  // (The expression of `test` or `[`, with the words it reads, as bash's builtin reads them; through `command`,
  // `builtin` and the other command slots.)
  commandTest: (tree, c) => {
    const model = shellState(tree, 'bash');
    const run = runCommands(c, model, 'bash').at(-1)!;
    const res = resolveRun(model, run, 'bash');
    const spec = res && testSpecOf(res);
    if (!spec) return '(no test)';
    const t = commandTest(spec, run.args, '5.2');
    // (No expression read, nor said to be wrong: the explanation says nothing of it.)
    if (!t.test && !t.unclosed && !t.malformed) return '(no expression)';
    // (A word whose text is not known, by its source: two such words are not said to be one.)
    const words = t.test?.words.map((w) => w.text ?? `(${w.nodes.map((n) => n.text).join('')})`);
    const expr = (e: TestExpr): unknown => JSON.parse(JSON.stringify(e, (k, v: unknown) => (typeof v === 'number' && words && k !== 'type' ? words[v] : v)));
    return JSON.stringify({ expr: t.test ? expr(t.test.expr) : null, unclosed: t.unclosed, malformed: t.malformed });
  },
  outputsOf: (_, c) => {
    const { out, err } = outputsOf(c);
    return `out ${out ?? '-'}, err ${err ?? '-'}`;
  },
  lookupOption: (_, c) => {
    const name = valueOr(nameWordOf(c));
    const spec = lookupCommand(name);
    if (!spec) return '(no spec)';
    const args = argsOf(c);
    const parse = interpret(spec, args.map(argWord), { name, lookup: lookupCommand });
    // (A value read as soon as its option (`sed -e`: `ValueSpec.inOrder`) with the modes chosen before it, as
    // `regexFlavor` reads them: `sed -e 's/a+/x/' -E` reads a BRE.)
    const inOrder = args.flatMap((_, i) => {
      const before = optionsBefore(parse, i);
      return before ? [`${valueOr(args[i])} after ${before.flatMap(({ role }) => (role.role === 'option' && role.spec.selects ? [role.spec.selects] : [])).join(' ') || 'no mode'}`] : [];
    });
    return [...meaning(parse.roles, args.map(valueOr)), ...inOrder].join(', ');
  },
  // (Through its caller, the command slot of a shell's `-c` (src/semantics/env.ts, `slotEnvs`): the shell of the string
  // and whether it is started with `-r`.)
  shellFromName: (tree, c) => {
    const model = shellState(tree, 'bash');
    const name = commandName(c);
    const spec = name === undefined ? undefined : lookupCommand(name);
    if (!spec) return '(no spec)';
    const args = argsOf(c);
    const parse = interpret(spec, args.map(argWordIn(model)), { name: name!, lookup: lookupCommand });
    const link = [...slotEnvs(model.env(c), parse, spec, args, 'bash', lookupCommand).values()]
      .flatMap((e) => e.links).find((l): l is SlotLink => l.kind === 'slot' && l.shell !== undefined);
    return link ? `${link.shell}${link.invocation?.some((o) => o.flag === '-r') ? ', restricted' : ''}` : '(no shell)';
  },
  arithTrees: lastValue,
  // (A `[[ ]]` as the `[ ]` the quick fix writes; a `[ ]` chain as itself.)
  testChain: (tree) => {
    const dbracket = descendants(tree.root, ['extended_test'])[0];
    return dbracket ? testChain(dbracket.namedChildren[0]) ?? '(no rewrite)' : tree.root.namedChildren.at(-1)!.text;
  },
};

const scriptOf = (row: Row, form: string): string => (row.prelude === undefined ? form : `${row.prelude}\n${form}`);

/** The key of a form. */
export function keyOf(row: Row, form: string): string {
  const tree = parser.parse(scriptOf(row, form));
  return KEYS[row.normalizer](tree, row.normalizer === 'testChain' ? tree.root : subject(tree));
}

/** The job that runs a form of a row. */
export function jobOf(row: Row, form: string): Job {
  return { script: `${scriptOf(row, form)}\n`, walls: false, contents: row.files, stdin: row.stdin, env: row.env, epilogue: row.epilogue };
}
