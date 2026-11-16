// The words of a command line for the argument interpreter (src/argv/interpret.ts), read from the view of each word in
// the finished model (src/semantics/wordview.ts), with the fields the semantic model knows for each (`ArgWord.fields`),
// where the caller has the model.
import type { ArgWord } from '../argv/interpret';
import { untilWord } from '../argv/until';
import { argWordFor, viewCount } from '../argv/words';
import type { SyntaxNode } from '../syntax/tree';
import { attribute, refTarget, type ShellState, type StateModel } from './state';
import { wordView } from './wordview';
import { wordFields } from './words';

const known = new WeakMap<StateModel, WeakMap<SyntaxNode, { fields?: readonly string[] }>>();
/** The fields of the word of `n` where the model knows them (`wordFields`), computed once for each word of a model. */
export function fieldsIn(n: SyntaxNode, model: StateModel): readonly string[] | undefined {
  let byNode = known.get(model);
  if (!byNode) known.set(model, (byNode = new WeakMap()));
  let f = byNode.get(n);
  if (!f) byNode.set(n, (f = { fields: wordFields(n, model).fields }));
  return f.fields;
}

/**
 * How many words the word of `n` gives where it runs in the `model` (`WordView.count`; none where that is one): its
 * fields where the model knows them (`x=p; cp {a,$x} d`: two; `y=a; cp $y c`: one; `z=; cp $z c`: none), else what
 * the field domain says (`cp $# d`: one; `cp *.txt d`: one or more, none with nullglob).
 */
export function countIn(n: SyntaxNode, model: StateModel): ArgWord['count'] {
  const v = wordView(n, model);
  return v && viewCount(v);
}

/** The words of the command line as the interpreter reads them, from the view of each in the `model` alone: no fields, and what they assign as written. */
export const viewedIn = (model: StateModel): ((n: SyntaxNode) => ArgWord) => argWordFor((n) => wordView(n, model));

/**
 * The words of the command line as the interpreter reads them, from the view of each in the `model` (`set +B`, `set -f`,
 * the IFS, nullglob), each with its fields where the model knows them, which the interpreter reads in its place
 * (`interpret`). (A word with no count is one word.) What a word may assign, and the parameter whose words it gives, are
 * those the attributes in effect say (`attributed`).
 */
export const argWordIn = (model: StateModel) => {
  const plain = viewedIn(model);
  return (n: SyntaxNode): ArgWord => ({ ...attributed(plain(n), model.at(n).run), fields: () => fieldsIn(n, model) });
};

/**
 * A word with what it may assign, and the parameter whose words it gives (`ArgWord.assigns`, `param`), as the attributes
 * in effect say: an assignment to a nameref is one to the variable it names (`declare -n r=b; ${r:=x}` assigns b), and
 * one to an integer runs the value as arithmetic, which may assign any name (`declare -i n; ${n:=b=3}` assigns b);
 * `$r` gives the words of `b`. Checked with bash 5.2 (test/readings.test.ts).
 */
function attributed(w: ArgWord, st: ShellState): ArgWord {
  const names = w.assigns?.flatMap((name) => {
    if (name === '*' || name === '?' || name === '!') return [name];
    const target = refTarget(st, name);
    return target === '*' || attribute(st, target, 'i') !== 'off' ? ['*'] : [target];
  });
  const assigns = names?.includes('*') ? ['*'] : names && [...new Set(names)];
  const param = w.param !== undefined && /^[A-Za-z_]\w*$/.test(w.param) ? refTarget(st, w.param) : w.param;
  const { param: _, assigns: __, ...rest } = w;
  // (Reading a nameref whose target is not known may run arithmetic: `r='a[i=5]'`.)
  return { ...rest, ...(param !== undefined && param !== '*' ? { param } : {}), ...(param === '*' ? { assigns: ['*'] } : assigns ? { assigns } : {}) };
}

/** What each word is to the end of an option's command (`untilWord`): the one word it gives, where that is known. */
export const untilWords = (words: readonly ArgWord[]): (string | undefined)[] => words.map(untilWord);
