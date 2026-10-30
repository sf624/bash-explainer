// The sequence expressions of brace expansion (`{1..10..3}`; manual 3.5.1), for src/explain/words.ts: their start,
// end and increment as bash reads them, and what the bash of the explanation leaves as written (src/braceseq.ts).
import type { EmbeddedToken } from '../embedded/types';
import { braceSequence } from '../examples/shellwords';
import { lastValue, parseSequence, sequenceRefusal } from '../braceseq';
import { ordinal } from '../i18n';
import { codeSpan } from '../label';
import { joinedText, type SyntaxNode } from '../syntax/tree';
import type { Explainer } from './context';

/**
 * What to add to a brace expansion of the sequences `sequences` that the bash of the explanation leaves as written,
 * with why (the parser makes a sequence of what bash 5.2 or 5.3 expands: `{1..3000000000}` only 5.3); else nothing.
 */
export function refusedNote(cx: Explainer, sequences: readonly SyntaxNode[]): string {
  const version = cx.bashVersion;
  const other = version === '5.2' ? '5.3' : '5.2';
  const kept = sequences.flatMap((s) => {
    const why = sequenceRefusal(joinedText(s).slice(1, -1), version);
    if (!why) return [];
    const x = codeSpan(joinedText(s));
    // (An increment it refuses is written: the sequence has one.)
    const z = (): string => codeSpan(joinedText(s.namedChildren[2]));
    return [why === 'words'
      ? cx.s(`${x} を、単語が 2147483645 個を超えるので展開せず、書いたまま残す`, `${x} as written, since it would make more than 2147483645 words`)
      : why === 'increment'
        ? cx.s(`${x} を、増分 ${z()} を受け付けないので展開せず、書いたまま残す`, `${x} as written, since it refuses the increment ${z()}`)
        : cx.s(`${x} を、開始と終わりが離れすぎているので展開せず、書いたまま残す`, `${x} as written, since its start and its end are too far apart for it`)];
  });
  return kept.length ? cx.s(`（bash ${version} は ${kept.join('。')}。bash ${other} は展開する）`,
    ` (bash ${version} leaves ${kept.join('; ')}; bash ${other} expands ${kept.length === 1 ? 'it' : 'them'})`) : '';
}

/**
 * The parts of a sequence expression of braces, `{1..10..3}` (3.5.1): its start, its end and its increment, at their
 * places in the text, with what bash makes of them (checked with bash 5.2): the sign of the increment does not count,
 * the order comes from the start and the end, an increment of 0 counts as 1, the last word is the last step that
 * does not pass the end, and a number with a leading 0 pads every word with zeros to the same width. None where the
 * bash of the explanation leaves it as it is (`braceWordToken` says so).
 */
export function sequenceParts(cx: Explainer, s: SyntaxNode): EmbeddedToken[] {
  const [xn, yn, zn] = s.namedChildren;
  // (As bash reads them, without line continuations: `{1..\<newline>3}`.)
  const [x, y] = [joinedText(xn), joinedText(yn)];
  const seq = parseSequence(joinedText(s).slice(1, -1), cx.bashVersion);
  if (!seq) return [];
  const numbers = !seq.letters;
  // (A sequence of the word expands to no more words than the word: they were listed.)
  const words = braceSequence(joinedText(s), seq.version)!;
  const kind = numbers ? 'number' : 'string';
  const down = seq.step < 0n;
  const padded = (v: string): string => (numbers && /^-?0\d/.test(v) ? cx.s('。先頭が 0 なので、すべての数を 0 で埋めて同じ桁数にする', '; it has a leading 0, so every number is padded with zeros to the same width') : '');
  const last = words[words.length - 1];
  // (Where the last value is the end, it lands on it, even when bash 5.2 prints it cut to an `int`: `{0001..2147483648..2147483647}`.)
  const stops = lastValue(seq) !== seq.end ? cx.s(`（増分で届かないので、最後の単語は \`${last}\`）`, ` (the steps do not land on it: the last word is \`${last}\`)`) : '';
  const out: EmbeddedToken[] = [
    { start: xn.startIndex, end: xn.endIndex, kind, explanation: cx.s(`開始: \`${x}\``, `Start: \`${x}\``) + padded(x), children: [] },
    { start: yn.startIndex, end: yn.endIndex, kind, explanation: cx.s(`終わり: \`${y}\``, `End: \`${y}\``) + stops + padded(y), children: [] },
  ];
  if (!zn) return out;
  const z = joinedText(zn);
  const step = seq.step < 0n ? -seq.step : seq.step;
  const sign = seq.written < 0n ? cx.s('。符号は使われず、向きは開始と終わりで決まる', '; its sign does not count: the start and the end set the direction') : seq.written === 0n ? cx.s('。0 は 1 として扱われる', '; 0 counts as 1') : '';
  out.push({
    start: zn.startIndex, end: zn.endIndex, kind: 'number',
    explanation: numbers
      ? cx.s(`増分: \`${z}\`（単語ごとに ${step} ${down ? '減る' : '増える'}）${sign}`, `Increment: \`${z}\` (each word is ${step} ${down ? 'less' : 'more'} than the one before)${sign}`)
      : cx.s(`増分: \`${z}\`（${step} 文字ごとに${down ? '逆向きに' : ''}進む）${sign}`, `Increment: \`${z}\` (${step === 1n ? 'each letter' : `every ${ordinal(step)} letter`}, counting ${down ? 'down' : 'up'})${sign}`),
    children: [],
  });
  return out;
}
