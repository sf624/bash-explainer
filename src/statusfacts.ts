// The notes and pitfalls on exit status and errexit (src/semantics/status.ts), for a whole script at once: one walk
// over its statements, kept per status model, gives each line its facts in both languages.
//
// They are said only where `set -e` does something few expect: a `set -e` that runs inside a group or a function
// where bash ignores it; a function, `( )` or `{ }` of several commands run where it is ignored; a `$( )` of several
// commands, where bash turns it off; a declaration that hides the status of its `$( )`; the first pipeline that
// hides a failure without pipefail; a function whose last command is `test && cmd`, called where `set -e` stops it.
import type { FactSpec, Words } from './messages';
import { featureWorks, type Shell } from './dialect';
import { STATEMENTS } from './semantics/env';
import { resolveName } from './semantics/names';
import type { StateModel } from './semantics/state';
import { type Ignored, lastStatements, type StatusModel, type StatusRule } from './semantics/status';
import { ancestor, descendants, field, fields, type SyntaxNode } from './syntax/tree';

export type StatusFact = FactSpec;

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
    out.set(line, [...(out.get(line) ?? []), spec]);
  };
  // A command whose failure `set -e` would catch: a simple command or a pipeline (not an assignment, `local` or a test).
  const plain = (body: SyntaxNode): boolean => statements(body).slice(0, -1).some((c) => {
    const b = c.type === 'redirected_statement' ? field(c, 'body') : c;
    return (b?.type === 'command' || b?.type === 'pipeline') && ['command', 'pipeline'].includes(status.status(b).kind);
  });
  const turnsOn = (body: SyntaxNode): boolean => statements(body).some((c) => status.turnsErrexitOn(c));
  let pipefailSaid = !featureWorks('pipefail', shell);

  for (const n of descendants(root, ['command', 'subshell', 'compound_statement', 'command_substitution', 'function_definition', 'declaration_command', 'pipeline', 'list'])) {
    switch (n.type) {
      case 'command_substitution': {
        // (The state of the `$( )` node is the one around it; its commands have the one inside.)
        const inner = statements(n);
        if (inner.length < 2 || status.errexit(n).errexit !== 'on' || status.errexit(inner[0]).errexitWhy !== 'off-in-substitution' || turnsOn(n)) break;
        const first = shorten(inner[0].text);
        add(n, { id: 'errexit-off-in-substitution', params: { first } });
        break;
      }
      case 'command': {
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
        if (ctx.errexit !== 'on' || !ig?.sure || ig.why === 'called-in-condition' || !plain(n) || turnsOn(n)) break;
        const what = n.type === 'subshell' ? '`( )`' : '`{ }`';
        const w = where(ig);
        add(n, { id: 'errexit-group-where-ignored', params: { what, where: w } });
        break;
      }
      case 'declaration_command': {
        if (!descendants(n, ['command_substitution']).length) break;
        const rule = status.status(n);
        if (rule.kind !== 'masked') break;
        // The keyword: local, export, declare, readonly or typeset.
        const kw = rule.by;
        const v = field(ancestor(rule.substitutions[0], (x) => x.type === 'variable_assignment')!, 'name')!.text;
        add(n, { id: 'declaration-masks-status', params: { kw, v } });
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
        // The last command of a function, `test && cmd`: when the test fails, the function returns its status.
        if (!n.children.some((c) => c.type === '&&') || n.children.some((c) => c.type === '||')) break;
        const def = ancestor(n, (x) => x.type === 'function_definition');
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
  return out;
}

/** Whether every command of an `&&` list but the last is a test: `[ ]`, `[[ ]]`, `(( ))`, `test`, `grep -q`. */
function tests(list: SyntaxNode, state: StateModel, status: StatusModel, shell?: Shell): boolean {
  // (`a && b && c` is `(a && b) && c`: every command of the left side.)
  const flat = (x: SyntaxNode): SyntaxNode[] => (x.type === 'list' ? x.namedChildren.flatMap(flat) : [x]);
  return flat(list.namedChildren[0]).every((c) => {
    const rule = status.status(c);
    if (rule.kind === 'test' || rule.kind === 'arith') return true;
    const name = c.type === 'command' ? field(c, 'name')?.text : undefined;
    if (!name || rule.kind !== 'command') return false;
    const kind = resolveName(state, name, field(c, 'name')!, { shell, command: true }).kind;
    return (name === 'test' && kind === 'builtin') || (name === 'grep' && kind === 'file' && fields(c, 'argument').some((a) => /^-[A-Za-z]*q|^--(quiet|silent)$/.test(a.text)));
  });
}
