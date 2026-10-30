// The words of a command line for the argument interpreter (src/argv/interpret.ts), with the fields the semantic model
// knows for each (`ArgWord.fields`), and whether it may give none (`count.min` 0, `mayGiveNoField`), where the caller has
// the model.
import type { ArgWord } from '../argv/interpret';
import { untilWord } from '../argv/until';
import { argWordFor, countOf } from '../argv/words';
import { bracesWork } from '../shellfeatures';
import type { SyntaxNode } from '../syntax/tree';
import { mayGiveNoField } from './nofield';
import { attribute, refTarget, type ShellState, type StateModel } from './state';
import { wordFields, wordMeaning } from './words';

/**
 * Whether brace expansion applies to the word of `n` where it runs (`set +B`; the model's brace step); where the model
 * reads no word (the `-p` of `time -p`, the tree's option of the keyword), where the shell has it.
 */
export const bracesIn = (model: StateModel) => (n: SyntaxNode): boolean | 'unknown' => wordMeaning(n, model)?.steps[0].applies ?? bracesWork(n, model.shell);

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
 * How many words the word of `n` gives (`countOf`), with brace expansion as the `model` says; where that is not one
 * known number, the number of its fields where the model knows them (`x=p; cp {a,$x} d`: two; `y=a; cp $y c`: one;
 * `z=; cp $z c`: none).
 */
export function countIn(n: SyntaxNode, model: StateModel): ArgWord['count'] {
  const count = countOf(n, model.shell, bracesIn(model)(n));
  if (!count || count.min === count.max) return count;
  const fields = fieldsIn(n, model);
  return !fields ? count : fields.length === 1 ? undefined : { min: fields.length, max: fields.length };
}

/**
 * The words of the command line as the interpreter reads them, with brace expansion as the `model` says (`set +B`),
 * each with its fields where the model knows them, which the interpreter reads in its place (`interpret`), and none as
 * the fewest it gives only where the model says it may give none (`x=1; cp $x b`: one at least; with nullglob,
 * `*.txt` none). (A word with no count is one word.) What a word may assign, and the parameter whose words it gives,
 * are those the attributes in effect say (`attributed`).
 */
export const argWordIn = (model: StateModel) => {
  const plain = argWordFor(model.shell, bracesIn(model), (n) => countIn(n, model));
  return (n: SyntaxNode): ArgWord => {
    const w = plain(n);
    // (A word with a count is one of a command's words, which the model reads: an argument, or its name after a wrapper.)
    if (w.count) w.count = { ...w.count, min: mayGiveNoField(n, model) ? 0 : Math.max(w.count.min, 1) };
    return { ...attributed(w, model.at(n).run), fields: () => fieldsIn(n, model) };
  };
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
