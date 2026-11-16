// The text of the catalog's fact about a command line its tool refuses (`command-refused`, in src/messages-facts-commands.ts),
// apart from the catalog's modules. What is refused, and what the tool prints, come from the spec (src/argv/spec.ts,
// `Refused`) through the parse (`ArgvParse.refused`, src/argv/refusals.ts).
import type { Text } from './i18n';
import { codeSpan } from './label';
import type { Head } from './messages-levels';

/**
 * `command-refused`: the program, why it refuses its line (`kind`, with the words of the case) and what it prints (`says`,
 * with the program's name before it unless `bare`; `also`, its second line), in English, as the tool of `impl` (GNU's by
 * default) prints it; its exit status; whether only GNU's tool refuses it (`gnu`); what to write instead (`why`); and the
 * node of a manual on the tool's words (`ref`), as the spec gives them.
 */
export interface RefusedParams {
  program: string;
  kind: 'modes' | 'value' | 'needs' | 'operand';
  /** `modes`: the option at fault, and the first one given (`again`: the same option); `value`: the option and its value; `operand`: the word. */
  word?: string;
  after?: string;
  again?: boolean;
  option?: string;
  /** `operand`: alone where it needs another (`tr a`), or refused for its text (`date -d now x`); else an extra one. */
  as?: 'alone' | 'operand';
  /** `needs`: the options of which one is needed. */
  options?: readonly string[];
  says: string;
  bare?: boolean;
  also?: string;
  status: number;
  gnu?: boolean;
  impl?: string;
  why?: Text;
  ref?: string;
}

/** `a`, `b` or `c` (ja: `a`・`b`・`c`): the options of the modes, of which a spec has two or more. */
const anyOf = (names: readonly string[], ja: boolean): string => {
  const codes = names.map((n) => codeSpan(n));
  return ja ? codes.join('・') : `${codes.slice(0, -1).join(', ')} or ${codes.at(-1)}`;
};

/** What the tool refuses, after its name (`refuses the value … of …`, `` `-d` の値 … を受け付けない ``). */
function refusedWhat(p: RefusedParams): readonly [string, string] {
  const w = p.word === undefined ? '' : codeSpan(p.word);
  if (p.kind === 'modes') return p.again ? [`2つ目の ${w} を受け付けない`, `refuses a second ${w}`] : [`${codeSpan(p.after!)} と ${w} を一緒には受け付けない`, `refuses ${w} with ${codeSpan(p.after!)}`];
  if (p.kind === 'value') return [`${codeSpan(p.option!)} の値 ${w} を受け付けない`, `refuses the value ${w} of ${codeSpan(p.option!)}`];
  if (p.kind === 'needs') return [`${anyOf(p.options!, true)} のどれかがないと受け付けない`, `refuses to run without one of ${anyOf(p.options!, false)}`];
  return p.as === 'alone' ? [`${w} 1つだけでは受け付けない`, `refuses ${w} alone`]
    : p.as === 'operand' ? [`オペランド ${w} を受け付けない`, `refuses the operand ${w}`] : [`余分なオペランド ${w} を受け付けない`, `refuses the extra operand ${w}`];
}

/**
 * Who refuses (the tool, or GNU's where only it does), what, and then what the tool of `impl` prints, named as its English
 * message, and its status: other implementations refuse with other words, and a locale may translate GNU's.
 */
export function refusedText(p: RefusedParams): readonly [string, string] {
  const [wj, we] = refusedWhat(p);
  const [tj, te] = p.gnu ? [`GNU の ${p.program}`, `GNU ${p.program}`] : [p.program, p.program];
  const impl = p.impl ?? 'GNU';
  const message = codeSpan(p.bare ? p.says : `${p.program}: ${p.says}`);
  const also = p.also ? codeSpan(p.also) : '';
  const [mj, me] = also ? [`英語のメッセージ ${message}、続けて ${also}`, `prints ${message}, then ${also} (its messages in English),`] : [`英語のメッセージ ${message}`, `prints ${message} (its message in English)`];
  const [sj, se] = p.gnu ? [`${mj} を表示し`, `: it ${me}`] : [`${impl} の ${p.program} は${mj} を表示し`, `. ${impl} ${p.program} ${me}`];
  const [hj, he] = p.why ? [`。${p.why.ja}`, `. ${p.why.en}`] : ['', ''];
  return [`${tj} は${wj.startsWith('`') ? ' ' : ''}${wj}。${sj}、何もせずに終了ステータス ${p.status} で終わる${hj}`, `${te} ${we}${se} and exits with status ${p.status}, doing nothing${he}`];
}

export const refusedHead = ({ program, gnu }: RefusedParams): Head =>
  [`${gnu ? 'GNU の ' : ''}${program} はこのコマンドラインを受け付けず、何もしない。`, `${gnu ? 'GNU ' : ''}${program} refuses this command line and does nothing.`];

/** The manual's node on the tool's words, where the spec names one; else the section on exit statuses. */
export const refusedRefs = ({ ref }: RefusedParams): readonly string[] => (ref ? [ref] : ['3.7.5']);
