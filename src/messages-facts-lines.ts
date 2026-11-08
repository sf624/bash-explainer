import { type Catalog, caveat, note } from './messages-entry';
import {
  type Alone, continuedText, heredocBodyText, heredocEndText, readSeparatorsText, redirectOrderText, stderrFirstText,
} from './messages-lines';
import { yqCompatText, yqFlavourText } from './messages-yq';
import type { YqVerdict } from './embedded/yq';
import type { RedirectOrder } from './idioms';

// The catalog's notes on redirections, where a line is in a statement, `read`'s separators and which yq runs. Spread
// into `MESSAGES` (src/messages.ts), with the idioms (src/messages-idioms.ts).

export const LINE_MESSAGES = {
  // ---------------------------------------------------------------- redirections, where a line is
  // (The texts: src/messages-lines.ts; plain notes before SB3a of docs/design/sources.md. 3.6: "Redirections
  // are processed in the order they appear, from left to right", and "the order of redirections is significant":
  // `ls 2>&1 > dirlist` sends only stdout to the file. A caveat, not a pitfall: the order is often meant; none where the
  // command's stdout goes somewhere known, where it is the way to send stderr alone there (`alone`, `stdoutAt` of
  // src/semantics/stdout.ts). No quick fix: `>f 2>&1` changes what the line does, and the author may mean either of two.)
  'redirections-in-order': note<RedirectOrder & { alone?: Alone }>(['3.6', '3.6.8'], redirectOrderText),
  'stderr-to-original-stdout': caveat<{ dup: string; file: string; discards: boolean }>(['3.6', '3.6.8'], stderrFirstText,
    ({ dup, file, discards }) => (discards
      ? [`\`${dup}\` が \`${file}\` より前なので、標準エラー出力は捨てられない。`, `\`${dup}\` comes before \`${file}\`, so stderr is not discarded.`]
      : [`\`${dup}\` が \`${file}\` より前なので、標準エラー出力はファイルに行かない。`, `\`${dup}\` comes before \`${file}\`, so stderr does not go to the file.`])),
  'heredoc-end-line': note<{ end: string; operator: string; line: number }>(['3.6.6'], heredocEndText),
  'heredoc-body-line': note<{ operator: string; line: number }>(['3.6.6'], heredocBodyText),
  'statement-continued': note<{ line: number }>(['3.1.2.1'], continuedText),
  'read-ifs-separators': note<{ ifs: string; seps: readonly string[] }>(['3.5.7', '4.2'], readSeparatorsText),
  // (yq: which of the three tools of that name this is, and which run the line: the name is looked up in PATH, 3.7.2.
  // The words are src/embedded/yq.ts's, `yqNoteTexts`.)
  'yq-flavour': note<{ verdict: YqVerdict }>(['3.7.2'], yqFlavourText),
  'yq-compat': note<{ verdict: YqVerdict }>(['3.7.2'], yqCompatText),
} satisfies Catalog;
