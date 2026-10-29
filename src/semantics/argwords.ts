// The words of a command line for the argument interpreter (src/argv/interpret.ts), with the fields the semantic model
// knows for each (`ArgWord.fields`), where the caller has the model.
import type { ArgWord } from '../argv/interpret';
import { untilWord } from '../argv/until';
import { argWordFor, countOf } from '../argv/words';
import { bracesWork } from '../shellfeatures';
import type { SyntaxNode } from '../syntax/tree';
import type { StateModel } from './state';
import { wordFields, wordMeaning } from './words';

/**
 * Whether brace expansion applies to the word of `n` where it runs (`set +B`; the model's brace step); where the model
 * reads no word (the `-p` of `time -p`, the tree's option of the keyword), where the shell has it.
 */
export const bracesIn = (model: StateModel) => (n: SyntaxNode): boolean | 'unknown' => wordMeaning(n, model)?.steps[0].applies ?? bracesWork(n, model.shell);

/** How many words the word of `n` gives (`countOf`), with brace expansion as the `model` says. */
export const countIn = (n: SyntaxNode, model: StateModel): ArgWord['count'] => countOf(n, model.shell, bracesIn(model)(n));

/**
 * The words of the command line as the interpreter reads them, with brace expansion as the `model` says (`set +B`),
 * each with its fields where the model knows them.
 */
export const argWordIn = (model: StateModel) => {
  const plain = argWordFor(model.shell, bracesIn(model));
  return (n: SyntaxNode): ArgWord => {
    let known: { fields?: readonly string[] } | undefined;
    return { ...plain(n), fields: () => (known ??= wordFields(n, model)).fields };
  };
};

/** What each word is to the end of an option's command (`untilWord`): the one word it gives, where that is known. */
export const untilWords = (words: readonly ArgWord[]): (string | undefined)[] => words.map(untilWord);
