// The words of a command line for the argument interpreter (src/argv/interpret.ts), with the fields the semantic model
// knows for each (`ArgWord.fields`), where the caller has the model.
import type { ArgWord } from '../argv/interpret';
import { untilWord } from '../argv/until';
import { argWordFor } from '../argv/words';
import type { SyntaxNode } from '../syntax/tree';
import type { StateModel } from './state';
import { wordFields } from './words';

/** The words of the command line as the interpreter reads them, each with its fields where the `model` knows them. */
export const argWordIn = (model: StateModel) => {
  const plain = argWordFor(model.shell);
  return (n: SyntaxNode): ArgWord => {
    let known: { fields?: readonly string[] } | undefined;
    return { ...plain(n), fields: () => (known ??= wordFields(n, model)).fields };
  };
};

/** What each word is to the end of an option's command (`untilWord`): the one word it gives, where that is known. */
export const untilWords = (words: readonly ArgWord[]): (string | undefined)[] => words.map(untilWord);
