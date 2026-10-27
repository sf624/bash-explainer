// The notes and pitfalls on exit status and errexit (src/semantics/status.ts), for a whole script at once: one walk
// over its statements, kept per status model, gives each line its facts in both languages.
//
// They are said only where `set -e` does something few expect: a `set -e` that runs inside a group or a function
// where bash ignores it; a function, `( )` or `{ }` of several commands run where it is ignored; a `$( )` of several
// commands, where bash turns it off; a declaration that hides the status of its `$( )`; the first pipeline that
// hides a failure without pipefail; a function whose last command is `test && cmd`, called where `set -e` stops it,
// and a script that ends with one; `cmd || echo "msg"` where its status is the function's or the script's, or where
// `set -e` would have stopped it.
import { canonicalName, lookupCommand } from './dict/aliases';
import type { FactSpec, Words } from './messages';
import { featureWorks, type Shell } from './dialect';
import { outputsOf } from './idioms';
import { replaceNode } from './rewrite';
import { commandName } from './semantics/effects';
import { readAs, STATEMENTS } from './semantics/env';
import { resolveName } from './semantics/names';
import type { Decision, StateModel } from './semantics/state';
import { type Ignored, lastStatements, type StatusModel, type StatusRule } from './semantics/status';
import { staticWordValue } from './staticword';
import { ancestor, descendants, field, fields, isShebang, redirectionsOf, substitutionForm, type SyntaxNode } from './syntax/tree';

/** A fact and the statement it is about (where the part hover shows it). */
export type StatusFact = FactSpec & { node: SyntaxNode };

const shorten = (text: string): string => {
  const one = text.replace(/\s*\n\s*/g, ' ');
  return one.length > 30 ? `${one.slice(0, 29)}…` : one;
};
const statements = (n: SyntaxNode): SyntaxNode[] => n.namedChildren.filter((c) => STATEMENTS.has(c.type));
const row = (n: SyntaxNode): number => n.startPosition.row + 1;

/**
 * Where bash ignores `set -e`, in words: `in the condition of \`if\``, `on the left side of \`||\``, `after \`!\``. (A
 * function called there has notes of its own, which name the call.)
 */
function where(ig: Ignored): Words {
  if (ig.why === 'condition') {
    const kw = ig.at.type === 'if_statement' ? 'if' : ig.at.children[0].type;
    return { ja: `\`${kw}\` の条件（行 ${row(ig.at)}）`, en: `in the condition of \`${kw}\` (line ${row(ig.at)})` };
  }
  if (ig.why === 'and-or') {
    const op = ig.at.children.find((c) => c.type === '&&' || c.type === '||')!.type;
    return { ja: `\`${op}\` の左側`, en: `on the left side of \`${op}\`` };
  }
  if (ig.why === 'called-by-host') {
    const name = field(ig.at, 'name')!.text;
    return { ja: `\`${name}\` の中（\`||\` の左側で呼ばれる）`, en: `in \`${name}\`, which is called on the left of \`||\`` };
  }
  return { ja: '`!` のあと', en: 'after `!`' };
}

/** Whether a compound command or a function body lies between `n` and `at` (where bash ignores `set -e`). */
function inGroup(n: SyntaxNode, at: SyntaxNode): boolean {
  for (let x = n.parent; x && x !== at; x = x.parent) {
    // (`ignored` is the nearest reason: a `set -e` in the condition of an `if` here has that `if` as `at`.)
    if (['compound_statement', 'subshell', 'if_statement', 'while_statement', 'for_statement', 'c_style_for_statement', 'select_statement', 'case_statement'].includes(x.type)) return true;
  }
  return false;
}

/** The facts of every line of the script, from its models. */
export function statusFacts(root: SyntaxNode, state: StateModel, status: StatusModel, shell?: Shell): Map<number, StatusFact[]> {
  const out = new Map<number, StatusFact[]>();
  const add = (n: SyntaxNode, spec: FactSpec): void => {
    const line = n.startPosition.row;
    out.set(line, [...(out.get(line) ?? []), { ...spec, node: n }]);
  };
  // A command whose failure `set -e` would catch: a simple command or a pipeline (not an assignment, `local` or a test).
  const plain = (body: SyntaxNode): boolean => statements(body).slice(0, -1).some((c) => (c.type === 'command' || c.type === 'pipeline') && ['command', 'pipeline'].includes(status.status(c).kind));
  const turnsOn = (body: SyntaxNode): boolean => statements(body).some((c) => status.turnsErrexitOn(c));
  let pipefailSaid = !featureWorks('pipefail', shell);

  for (const n of descendants(root, ['command', 'subshell', 'compound_statement', 'command_substitution', 'function_definition', 'pipeline', 'list'])) {
    switch (n.type) {
      case 'command_substitution': {
        // (The state of the `$( )` node is the one around it; its commands have the one inside.)
        const inner = statements(n);
        if (inner.length < 2 || status.errexit(n).errexit !== 'on' || status.errexit(inner[0]).errexitWhy !== 'off-in-substitution' || turnsOn(n)) break;
        const first = shorten(inner[0].text);
        // (Also in bash 5.3's `${ …; }` and `${| …; }`, which run in the shell itself.)
        const form = substitutionForm(n);
        add(n, { id: 'errexit-off-in-substitution', params: { first, form: form === '${' ? '${ …; }' : form === '${|' ? '${| …; }' : '$( )' } });
        break;
      }
      case 'command': {
        // `local x=$(cmd)`: the declaration's status hides the substitution's.
        if (descendants(n, ['command_substitution']).length) {
          const rule = status.status(n);
          if (rule.kind === 'masked') {
            // The keyword: local, export, declare, readonly or typeset.
            const kw = rule.by;
            add(n, { id: 'declaration-masks-status', params: { kw, v: rule.name } });
          }
        }
        // (The cheap tests first: this runs on every command of the script.)
        if (state.setWrites(n).get('errexit') !== 'on' || !status.turnsErrexitOn(n)) break;
        const ctx = status.errexit(n);
        const ig = ctx.ignored;
        if (!ig) break;
        if (ig.why === 'called-in-condition') {
          const name = field(ig.at, 'name')!.text;
          add(n, { id: ig.sure ? 'errexit-set-called-where-ignored' : 'errexit-set-maybe-called-where-ignored', params: { name, line: row(ig.at) } });
          break;
        }
        // (A `set -e` that is itself left of `&&`, or the condition, takes effect at once: `set -e && cmd`.)
        if (!inGroup(n, ig.at)) break;
        const w = where(ig);
        add(n, { id: ctx.stops === 'subshell' ? 'errexit-set-in-ignored-subshell' : 'errexit-set-in-ignored-group', params: { where: w } });
        break;
      }
      case 'function_definition': {
        // A function called only where `set -e` is ignored: a failure before its last command does not stop it.
        const body = field(n, 'body');
        if (!body || statements(body).length < 2) break;
        const ig = status.errexit(statements(body)[0]).ignored;
        if (!ig?.sure || ig.why !== 'called-in-condition' || status.errexit(ig.at).errexit !== 'on' || !plain(body) || turnsOn(body)) break;
        const name = field(n, 'name')!.text;
        add(n, { id: 'errexit-function-called-only-where-ignored', params: { name, line: row(ig.at) } });
        break;
      }
      case 'subshell': case 'compound_statement': {
        // (A function body has the note of its definition.)
        if (statements(n).length < 2 || n.parent?.type === 'function_definition') break;
        const ctx = status.errexit(n);
        const ig = ctx.ignored;
        // (A function called where it is ignored has a note on its definition: the host's, bats' `teardown`, too.)
        if (ctx.errexit !== 'on' || !ig?.sure || ig.why === 'called-in-condition' || ig.why === 'called-by-host' || !plain(n) || turnsOn(n)) break;
        const what = n.type === 'subshell' ? '`( )`' : '`{ }`';
        const w = where(ig);
        add(n, { id: 'errexit-group-where-ignored', params: { what, where: w } });
        break;
      }
      case 'pipeline': {
        // Said once, on the first pipeline that hides a failure.
        if (pipefailSaid || !status.hidesFailure(n) || status.errexit(n).active !== 'on') break;
        pipefailSaid = true;
        // (A pipeline that hides a failure has a pipeline's rule.)
        const rule = status.status(n) as Extract<StatusRule, { kind: 'pipeline' }>;
        const last = shorten(rule.stages[rule.stages.length - 1].text);
        add(n, { id: 'pipefail-missing', params: { last } });
        break;
      }
      case 'list': {
        const reported = failureReported(n, root, state, status, shell);
        if (reported) add(n, reported);
        // The last command of a function, `test && cmd`: when the test fails, the function returns its status.
        if (!n.children.some((c) => c.type === '&&') || n.children.some((c) => c.type === '||')) break;
        const def = ancestor(n, (x) => x.type === 'function_definition');
        // The last command of a script run as a program (it has a shebang): its status is the script's.
        // (Not one started with `&`, whose status is not waited for: `( … ) &`.)
        const background = status.status(n).kind === 'background' || !!ancestor(n, (x) => STATEMENTS.has(x.type) && status.status(x).kind === 'background');
        if (!def && isShebang(root.namedChildren[0]) && lastStatements(root).includes(n) && !background && tests(n, state, status, shell)) {
          add(n, { id: 'script-last-test-returns-status', params: { left: shorten(n.namedChildren[0].text) } });
          break;
        }
        const body = def && field(def, 'body');
        if (!body || !lastStatements(body).includes(n) || !tests(n, state, status, shell)) break;
        const call = [...state.calls.get(def)?.keys() ?? []].find((c) => status.errexit(c).active === 'on' && status.errexit(c).checked === true);
        if (!call) break;
        const name = field(def, 'name')!.text;
        // (The script's last command: its status is the script's.)
        const end = lastStatements(root).some((s) => s === call || s === call.parent);
        add(n, { id: end ? 'function-last-test-returns-status' : 'function-last-test-stops-script', params: { name, line: row(call) } });
        break;
      }
    }
  }
  for (const [n, spec] of conditionFacts(root, state)) add(n, spec);
  return out;
}

/**
 * The variables a decision read, in words: "`$x` is `2`", "`$y` is empty", "`$z` is not set". Undefined when it read
 * none (a condition of literals says nothing: its meaning is plain) or a value that does not fit in a note.
 */
function readWords(d: Decision): Words | undefined {
  if (!d.reads.size || [...d.reads.values()].some((v) => v?.includes('`'))) return undefined;
  const parts = [...d.reads].map(([k, v]) => (v === null
    ? { ja: `\`$${k}\` は未設定`, en: `\`$${k}\` is not set` }
    : v === '' ? { ja: `\`$${k}\` は空`, en: `\`$${k}\` is empty` } : { ja: `\`$${k}\` は \`${shorten(v)}\``, en: `\`$${k}\` is \`${shorten(v)}\`` }));
  // (A space after code, before the Japanese that follows: "`$x` は `2` なので".)
  const ja = parts.map((p) => p.ja).join('、');
  return { ja: ja.endsWith('`') ? `${ja} ` : ja, en: parts.map((p) => p.en).join(', ') };
}

/** Whether `n` is in the condition of an `if`, `elif`, `while` or `until` that is itself decided (its note says it). */
function inDecidedCondition(n: SyntaxNode, state: StateModel): boolean {
  for (let x = n.parent; x; x = x.parent) {
    if (!['if_statement', 'elif_clause', 'while_statement'].includes(x.type) || !state.condition(x)) continue;
    const end = x.children.find((c) => c.type === 'then' || c.field === 'body');
    if (end && n.endIndex <= end.startIndex) return true;
  }
  return false;
}

/**
 * The notes on conditions the state model decides (docs/design/semantics.md, 4.14) from values the script set: a
 * branch that never runs, a loop that never runs or never ends by its condition, the side of `&&` or `||` that never
 * runs, the branches of a `case` that run.
 */
function conditionFacts(root: SyntaxNode, state: StateModel): [SyntaxNode, FactSpec][] {
  const out: [SyntaxNode, FactSpec][] = [];
  for (const n of descendants(root, ['if_statement', 'elif_clause', 'while_statement', 'c_style_for_statement', 'list', 'case_statement'])) {
    const d = state.condition(n);
    const values = d && readWords(d);
    if (!values) continue;
    switch (n.type) {
      case 'if_statement': case 'elif_clause': {
        const top = n.type === 'if_statement' ? n : n.parent!;
        // (The kinds of the branches after it, as they are written: `elif`, `else`.)
        const after = top.namedChildren.filter((c) => (c.type === 'elif_clause' || c.type === 'else_clause') && c.startIndex > n.startIndex);
        const rest = { kinds: [...new Set(after.map((c) => (c.type === 'elif_clause' ? 'elif' : 'else')))], count: after.length };
        // (With an `if` and an `elif` on one line, say which condition.)
        const row = (x: SyntaxNode): number => x.startPosition.row;
        const shared = top.namedChildren.some((c) => c.type === 'elif_clause' && c !== n && row(c) === row(n)) || (n !== top && row(top) === row(n));
        const which = shared ? (n === top ? 'if' : 'elif') : '';
        out.push([n, d!.outcome === 'true' ? { id: 'condition-always-true', params: { values, rest, which } } : { id: 'condition-always-false', params: { values, which } }]);
        break;
      }
      case 'list': {
        const op = n.children.find((c) => c.type === '&&' || c.type === '||')!.type;
        if ((d!.outcome === 'true') === (op === '||') && !inDecidedCondition(n, state)) out.push([n, { id: 'and-or-right-never-runs', params: { values, op } }]);
        break;
      }
      case 'case_statement': {
        const items = n.namedChildren.filter((c) => c.type === 'case_item');
        const runs = d!.outcome ? d!.outcome.split(',').map((i) => items[Number(i)]) : [];
        const names = runs.map((item) => `\`${fields(item, 'value').map((v) => v.text).join('|')})\``);
        // ("`a)`, `b)` and `c)`"; in Japanese, joined by と.)
        const en = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
        out.push([n, runs.length ? { id: 'case-runs-only', params: { values, branches: { ja: names.join(' と '), en }, several: names.length > 1 } } : { id: 'case-runs-none', params: { values } }]);
        break;
      }
      default:
        out.push([n, { id: d!.outcome === 'true' ? 'loop-never-ends' : 'loop-never-runs', params: { values } }]);
    }
  }
  return out;
}

/**
 * `cmd || echo "msg"`: the list's status is that of the command on the right, which prints a message and succeeds, so a
 * failure of `cmd` is seen as a success where the status matters: at the end of a function (called, and not only in
 * `$( )`, where what it prints is a value: `v=$(cat f || echo none)`), at the end of a script run as a program (it has
 * a shebang, or a host runs it) or of a file with no shebang, which may be run as one, or where `set -e` is on and
 * would have stopped the script. Not when the left side is a test (`[ -f x ]
 * || echo none`), nor for `|| true` or `|| :`, which mean to ignore the failure.
 */
function failureReported(n: SyntaxNode, root: SyntaxNode, state: StateModel, status: StatusModel, shell?: Shell): FactSpec | undefined {
  const ops = n.children.filter((c) => c.type === '&&' || c.type === '||');
  // (A list has an operator, and a parent: the script at least.)
  if (ops.at(-1)!.type !== '||' || n.parent!.type === 'list') return undefined;
  // (While it is typed, `a ||` has no right side.)
  const [left, right] = n.namedChildren.filter((c) => STATEMENTS.has(c.type));
  const prints = right ? lastStatements(right) : [];
  if (!prints.length || !prints.every((c) => printsAndSucceeds(c, state, shell)) || status.succeeds(left) || tests(n, state, status, shell)) return undefined;
  const background = status.status(n).kind === 'background' || !!ancestor(n, (x) => STATEMENTS.has(x.type) && status.status(x).kind === 'background');
  if (background) return undefined;
  const def = ancestor(n, (x) => x.type === 'function_definition');
  const body = def && field(def, 'body');
  // (How the file is read: run as a script, typed into a terminal, or either run or sourced; a string another shell runs is a script.)
  const read = readAs(state.env(n), state.read);
  let where: 'function' | 'script' | 'fragment' | 'errexit';
  if (body && lastStatements(body).includes(n)) {
    const calls = [...state.calls.get(def)?.keys() ?? []];
    if (!calls.length || calls.some((c) => ancestor(c, (x) => x.type === 'command_substitution' || x.type === 'process_substitution'))) return undefined;
    where = 'function';
  } else if (!def && read !== 'terminal' && lastStatements(root).includes(n)) {
    where = read === 'script' ? 'script' : 'fragment';
  } else if (status.errexit(n).active === 'on') {
    where = 'errexit';
  } else return undefined;
  // The rewrite: the right side in a group that passes the failure on, with its message on stderr unless its output is
  // sent somewhere already (`echo m >> log`, `{ echo m; } > log`). It ends with `return 1` in a function, `exit 1` in a file run as a script.
  // In a file that may be sourced, `exit 1` would end the shell that sources it: in a function, `return 1` (where
  // `set -e` is on, it then stops at the call); outside, `return 1`, which fails when the file is run, then `exit 1`.
  const msg = prints[prints.length - 1];
  const at = msg.endIndex - right.startIndex;
  const sent = (x: SyntaxNode): boolean => redirectionsOf(x).length > 0 || (x !== right && sent(x.parent!));
  const said = sent(msg) ? right.text : `${right.text.slice(0, at)} >&2${right.text.slice(at)}`;
  const sourced = !def && read !== 'script';
  const end = sourced ? 'return 1 2>/dev/null || exit 1' : where === 'function' || read !== 'script' ? 'return 1' : 'exit 1';
  const quiet = (left.type === 'command' || left.type === 'redirected_statement') && outputsOf(left).err === '/dev/null' ? redirectionsOf(left).map((r) => r.text).join(' ') : '';
  return { id: 'failure-reported-as-success', params: { where, name: def ? field(def, 'name')!.text : '', left: shorten(left.text), right: shorten(msg.text), quiet, sourced, rewrite: [replaceNode(right, `{ ${said}; ${end}; }`)] } };
}

/**
 * Whether command `c` prints its words and surely succeeds (`CommandSpec.prints`: `echo "msg"`; `printf 'msg\n'`, whose
 * format is known and has no conversion that fails on a bad value, `%d`, nor `-v`, which prints nothing). The builtin
 * or the program, not a function of that name.
 */
function printsAndSucceeds(c: SyntaxNode, state: StateModel, shell?: Shell): boolean {
  if (c.type !== 'command') return false;
  const name = commandName(c);
  const prints = name === undefined ? undefined : lookupCommand(name)?.prints;
  if (!prints) return false;
  const kind = resolveName(state, field(c, 'name')!.text, field(c, 'name')!, { shell, command: true }).kind;
  if (kind !== 'builtin' && kind !== 'file') return false;
  if (prints === 'words') return true;
  const format = fields(c, 'argument')[0];
  const text = format && staticWordValue(format);
  return text !== undefined && !text.startsWith('-') && !/%(?![sb])/.test(text.replace(/%%/g, ''));
}

/** Whether every command of an `&&` list but the last is a test: `[ ]`, `[[ ]]`, `(( ))`, `test`, `grep -q`. */
function tests(list: SyntaxNode, state: StateModel, status: StatusModel, shell?: Shell): boolean {
  // (`a && b && c` is `(a && b) && c`: every command of the left side.)
  const flat = (x: SyntaxNode): SyntaxNode[] => (x.type === 'list' ? x.namedChildren.flatMap(flat) : [x]);
  return flat(list.namedChildren[0]).every((c) => {
    const rule = status.status(c);
    if (rule.kind === 'test' || rule.kind === 'arith') return true;
    // (A command with no name has the status of a substitution, `last-substitution`.)
    if (rule.kind !== 'command' || c.type !== 'command') return false;
    const name = field(c, 'name')!.text;
    const kind = resolveName(state, name, field(c, 'name')!, { shell, command: true }).kind;
    return (canonicalName(name) === 'grep' && kind === 'file' && fields(c, 'argument').some((a) => /^-[A-Za-z]*q|^--(quiet|silent)$/.test(a.text)));
  });
}
