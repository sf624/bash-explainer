// A word of a host file that no shell reads (`StateModel.noShell`: Docker's exec form, a Python list of arguments). The
// host writes it as a quoted shell word so that the command is explained (src/hosts/dockerfile.ts, `execWords`); its
// token is the host's string it is in the file, not that quoting.
import type { Token } from '../analyzer-types';
import { pictureList, visible } from '../ctlchars';
import { wordFields } from '../semantics/words';
import type { SyntaxNode } from '../syntax/tree';
import type { Explainer } from './context';

/**
 * The token of the quoted word `n` where no shell reads it: the host's string (`ExplainOptions.noShell`, a JSON string),
 * with its value, the word's one field. Undefined where a shell reads it.
 */
export function hostString(cx: Explainer, n: SyntaxNode): Token | undefined {
  const host = cx.state.noShell ? cx.opts.noShell : undefined;
  if (!host) return undefined;
  // (A newline is shown as `␊`, as `valueNote` shows it; each picture is told once.)
  const value = visible(wordFields(n, cx.state).fields![0]).replace(/\n/g, '␊');
  const pictures = pictureList([value], (ja, en) => cx.s(ja, en));
  // (It cites no section of bash's manual: no shell reads it.)
  return {
    ...cx.tok(n, 'string', cx.s(`${host.word[0]}: \`${value}\` がそのまま1つの単語としてコマンドに渡る${pictures ? `（制御文字は記号で表している: ${pictures}）` : ''}。先にシェルが \`$\`・\`*\`・クォート・空白を読むことはない`,
      `${host.word[1]}: \`${value}\` goes to the command as one word, as it is${pictures ? ` (control characters are shown as symbols: ${pictures})` : ''}. No shell reads its \`$\`, \`*\`, quotes or spaces first`)),
    refs: [],
  };
}
