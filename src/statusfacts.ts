// The notes and pitfalls on exit status and errexit (src/semantics/status.ts), for a whole script at once: one walk
// over its statements, kept per status model, gives each line its facts in both languages.
//
// They are said only where `set -e` does something few expect: a `set -e` that runs inside a group or a function
// where bash ignores it; a function, `( )` or `{ }` of several commands run where it is ignored; a `$( )` of several
// commands, where bash turns it off; a declaration that hides the status of its `$( )`; the first pipeline that
// hides a failure without pipefail; a function whose last command is `test && cmd`, called where `set -e` stops it.
import { featureWorks, type Shell } from './dialect';
import { STATEMENTS } from './semantics/env';
import { resolveName } from './semantics/names';
import type { StateModel } from './semantics/state';
import { type Ignored, lastStatements, type StatusModel, type StatusRule } from './semantics/status';
import { ancestor, descendants, field, fields, type SyntaxNode } from './syntax/tree';

export interface StatusFact { readonly pitfall: boolean; readonly ja: string; readonly en: string }

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
function where(ig: Ignored): { ja: string; en: string } {
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
  const add = (n: SyntaxNode, pitfall: boolean, ja: string, en: string): void => {
    const line = n.startPosition.row;
    out.set(line, [...(out.get(line) ?? []), { pitfall, ja: pitfall ? `⚠ 落とし穴: ${ja}` : `ℹ ${ja}`, en: pitfall ? `⚠ Pitfall: ${en}` : `ℹ ${en}` }]);
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
        add(n, false, `bash は \`$( )\` の中では \`set -e\` を切る（\`shopt -s inherit_errexit\` が無いとき）。\`${first}\` が失敗しても、あとのコマンドは実行される`,
          `bash turns \`set -e\` off inside \`$( )\` (without \`shopt -s inherit_errexit\`): if \`${first}\` fails, the commands after it still run`);
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
          if (ig.sure) {
            add(n, false, `この \`set -e\` は \`${name}\` の呼び出しが終わるまで効かない: \`${name}\` は \`set -e\` が無視される所（行 ${row(ig.at)}）から呼ばれる`,
              `This \`set -e\` takes effect only when the call of \`${name}\` returns: \`${name}\` is called where \`set -e\` is ignored (line ${row(ig.at)})`);
          } else {
            add(n, false, `\`${name}\` は \`set -e\` が無視される所（行 ${row(ig.at)}）からも呼ばれ、そのときこの \`set -e\` は呼び出しが終わるまで効かない`,
              `\`${name}\` is also called where \`set -e\` is ignored (line ${row(ig.at)}); there this \`set -e\` takes effect only when the call returns`);
          }
          break;
        }
        // (A `set -e` that is itself left of `&&`, or the condition, takes effect at once: `set -e && cmd`.)
        if (!inGroup(n, ig.at)) break;
        const w = where(ig);
        if (ctx.stops === 'subshell') {
          add(n, false, `この \`set -e\` は効かない: このサブシェルは ${w.ja}にあり、そこでは \`set -e\` が無視される`, `This \`set -e\` has no effect: this subshell runs ${w.en}, where \`set -e\` is ignored`);
        } else {
          add(n, false, `この \`set -e\` は、それを含むコマンドが終わるまで効かない: ${w.ja}では \`set -e\` が無視される`, `This \`set -e\` takes effect only when the command that holds it ends: \`set -e\` is ignored ${w.en}`);
        }
        break;
      }
      case 'function_definition': {
        // A function called only where `set -e` is ignored: a failure before its last command does not stop it.
        const body = field(n, 'body');
        if (!body || statements(body).length < 2) break;
        const ig = status.errexit(statements(body)[0]).ignored;
        if (!ig?.sure || ig.why !== 'called-in-condition' || status.errexit(ig.at).errexit !== 'on' || !plain(body) || turnsOn(body)) break;
        const name = field(n, 'name')!.text;
        add(n, false, `\`${name}\` は \`set -e\` が無視される所（行 ${row(ig.at)}）からしか呼ばれないので、その中でも \`set -e\` は無視される。途中のコマンドが失敗しても止まらず、次のコマンドに進む`,
          `\`${name}\` is called only where \`set -e\` is ignored (line ${row(ig.at)}), so it is ignored in all of its body too: a command that fails in the middle does not stop it`);
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
        add(n, false, `${w.ja}で実行されるので、${what}の中でも \`set -e\` は無視される。途中のコマンドが失敗しても止まらず、次のコマンドに進む`,
          `\`set -e\` is ignored in this ${what}, since it runs ${w.en}: a command that fails in the middle does not stop it`);
        break;
      }
      case 'declaration_command': {
        if (!descendants(n, ['command_substitution']).length) break;
        const rule = status.status(n);
        if (rule.kind !== 'masked') break;
        // The keyword: local, export, declare, readonly or typeset.
        const kw = rule.by;
        const v = field(ancestor(rule.substitutions[0], (x) => x.type === 'variable_assignment')!, 'name')!.text;
        add(n, true, `\`${kw} ${v}=$(…)\` の終了ステータスは \`${kw}\` 自身のもの（成功）になり、\`$(…)\` の中の失敗が隠れます（\`set -e\` でも止まりません）。\`${kw} ${v}\` と \`${v}=$(…)\` の2行に分けます`,
          `the status of \`${kw} ${v}=$(…)\` is that of \`${kw}\` (success), which hides a failure inside \`$(…)\` (even from \`set -e\`). Split it: \`${kw} ${v}\`, then \`${v}=$(…)\``);
        break;
      }
      case 'pipeline': {
        // Said once, on the first pipeline that hides a failure.
        if (pipefailSaid || !status.hidesFailure(n) || status.errexit(n).active !== 'on') break;
        pipefailSaid = true;
        // (A pipeline that hides a failure has a pipeline's rule.)
        const rule = status.status(n) as Extract<StatusRule, { kind: 'pipeline' }>;
        const last = shorten(rule.stages[rule.stages.length - 1].text);
        add(n, true, `\`set -o pipefail\` が無いので、パイプラインの終了ステータスは最後のコマンド（\`${last}\`）のものだけになる。前のコマンドが失敗しても \`set -e\` では止まらない（このスクリプトのほかのパイプラインも同じ）`,
          `without \`set -o pipefail\`, the status of a pipeline is that of its last command (\`${last}\`) alone, so \`set -e\` does not stop the script when a command before it fails (the same holds for the other pipelines of the script)`);
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
        add(n, true, end
          ? `これは関数 \`${name}\` の最後のコマンドなので、\`&&\` の左側が失敗すると \`${name}\` はその終了ステータス（0 以外）を返し、行 ${row(call)} の呼び出しで終わるスクリプトもその終了ステータスになる。\`if …; then …; fi\` と書くか、最後に \`return 0\` を置く`
          : `これは関数 \`${name}\` の最後のコマンドなので、\`&&\` の左側が失敗すると \`${name}\` はその終了ステータス（0 以外）を返し、\`set -e\` により行 ${row(call)} の呼び出しでスクリプトが止まる。\`if …; then …; fi\` と書くか、最後に \`return 0\` を置く`,
        end
          ? `this is the last command of \`${name}\`, so when the left side of \`&&\` fails, \`${name}\` returns its non-zero status, and so does the script, which ends with the call on line ${row(call)}. Write \`if …; then …; fi\`, or end the function with \`return 0\``
          : `this is the last command of \`${name}\`, so when the left side of \`&&\` fails, \`${name}\` returns its non-zero status and \`set -e\` stops the script at the call on line ${row(call)}. Write \`if …; then …; fi\`, or end the function with \`return 0\``);
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
