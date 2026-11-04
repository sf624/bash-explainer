// What the tool says when it could not read a line or a file: a limit of the tool or a bug of it, never a finding about the script.
import type { Entry } from './messages';

/**
 * That a line or a file was not read: a warning, since no one can say that the line fails every time (an error says that),
 * though a check that could not read it has not passed (`isNotRead`: the command-line tool exits with status 2).
 */
const unreadable = <P = Record<string, never>>(text: (p: P) => readonly [string, string]): Entry<P> & { level: 'warning' } => ({ kind: 'note', refs: [], text, level: 'warning' });

export const UNREAD = {
  // (No bug, so nothing is logged, and a problem where the file or the line is, so that a check that could not read it does not pass: src/document.ts.)
  'line-too-deep': unreadable(() => ['この行は説明できなかった: 入れ子が深すぎて、このツールでは最後までたどれない。ツールの限界で、スクリプトの誤りではない', 'This line could not be explained: it nests too deep for this tool to follow to the end. That is a limit of the tool, not an error in the script']),
  'file-not-read': unreadable<{ why: 'too-deep' | 'failed' }>(({ why }) => (why === 'too-deep'
    ? ['このファイルは読めなかった: 入れ子が深すぎて、このツールでは構文を読み取れない。中身は説明しない。ツールの限界で、スクリプトの誤りではない', 'This file could not be read: it nests too deep for the parser of this tool, and nothing in it is explained. That is a limit of the tool, not an error in the script']
    : ['このファイルは読めなかった: Bash Explainer の不具合で読み取りに失敗した。スクリプトの誤りではない', 'This file could not be read: Bash Explainer failed while reading it, a bug of the tool, not a problem of the script'])),
};

/** Whether `code` says that a line or a file was not read: no finding about the script, so that no count of findings holds it. */
export const isNotRead = (code: string | undefined): boolean => code === 'line-too-deep' || code === 'file-not-read';
