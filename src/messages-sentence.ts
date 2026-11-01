// The texts of the sentence of a line, "In short" (src/linesentence.ts; docs/design/panel-redesign.md, P5): the clauses
// a line is said with, the words that join them, and the sentences of the idioms (src/idioms.ts, `idiomSaid`). Part of
// the message catalog (src/messages.ts): each text in ja and en, Japanese after docs/japanese-style.md. Each clause is
// a phrase in English (lower case, joined with `; ` and capitalised at the start of the sentence), and a sentence in
// Japanese (joined with `。`). Code is in backticks, one shell word of the line at most in each span (the caller gives
// the words).
import { fdName, type RedirectKind } from './dict/syntax';
import type { Lang } from './i18n';

const pick = (lang: Lang, ja: string, en: string): string => (lang === 'ja' ? ja : en);
/** An English summary inside a sentence, after a name: `Sort lines` is `sort lines` (a first word in capitals, `SQL`, is kept). */
const lowerFirst = (s: string): string => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
/** Items of a list: `a`, `b` and `c`; `a`・`b`・`c`. */
export function listSaid(lang: Lang, items: readonly string[]): string {
  if (lang === 'ja') return items.join('・');
  return items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** A range of lines of the document (1-based). */
export function linesSaid(lang: Lang, a: number, b: number): string {
  if (a === b) return pick(lang, `行 ${a}`, `line ${a}`);
  return pick(lang, `行 ${a}〜${b}`, `lines ${a}–${b}`);
}

/** How a stream of a command is redirected: the kinds of `ioSaid` (an operator's, from the dictionary; a descriptor closed or moved; here-documents and here-strings). */
export type IoKind = RedirectKind | 'close' | 'move' | 'heredoc' | 'herestring';

/**
 * A descriptor's name in a sentence (`fdName`; `dflt`, the operator's default), with a space after a number before the
 * Japanese that follows (docs/japanese-style.md: `ファイルディスクリプタ 3 を`).
 */
function fdSaid(lang: Lang, fd: string, dflt: string): string {
  const name = fdName(fd, dflt)[lang];
  return lang === 'ja' && /\d$/.test(name) ? `${name} ` : name;
}

/**
 * One redirection, said short: the stream (`fd`, the operator's default `dflt`) and where it goes or comes from (`to`;
 * for `dup`, `dupIn` and `move`, the other descriptor).
 */
export function ioSaid(lang: Lang, kind: IoKind, fd: string, to: string): string {
  const ja = lang === 'ja';
  const both = pick(lang, '標準出力と標準エラー出力', 'stdout and stderr');
  const out = fdSaid(lang, fd, '1');
  const inp = fdSaid(lang, fd, '0');
  const other = fdSaid(lang, to, to);
  switch (kind) {
    case 'read': return ja ? `${inp}は${to}から` : `${inp} from ${to}`;
    case 'write': return ja ? `${out}は${to}へ` : `${out} to ${to}`;
    case 'append': return ja ? `${out}は${to}に追記` : `${out} appended to ${to}`;
    case 'readWrite': return ja ? `${inp}は${to}を読み書き両用で開く` : `${inp} open on ${to} for reading and writing`;
    // (`fd` is the descriptor closed, its default already given: `>&-` closes stdout.)
    case 'close': return ja ? `${fdSaid(lang, fd, fd)}を閉じて` : `${fdSaid(lang, fd, fd)} closed`;
    // (`n>&m-`: `fd` is n, its default given, and `to` is m.)
    case 'move': return ja ? `${other}は${fdSaid(lang, fd, fd)}に移す` : `${other} moved to ${fdSaid(lang, fd, fd)}`;
    case 'both': return ja ? `${both}は${to}へ` : `${both} to ${to}`;
    case 'bothAppend': return ja ? `${both}は${to}に追記` : `${both} appended to ${to}`;
    // (`to` is the descriptor copied: `2>&1`, `3<&0`.)
    case 'dup': return ja ? `${out}は${other}と同じ先へ` : `${out} to where ${other} goes`;
    case 'dupIn': return ja ? `${inp}は${other}と同じところから` : `${inp} from where ${other} reads`;
    case 'heredoc': return ja ? `${inp}はヒアドキュメントから` : `${inp} from the here-document`;
    case 'herestring': return ja ? `${inp}は${to}から（ヒアストリング）` : `${inp} from ${to} (a here-string)`;
  }
}

/** A value: the empty string. */
export const EMPTY = { ja: '空文字列', en: 'the empty string' };

/** The clauses of a sentence (`S.x(lang, …)`). */
export const S = {
  /** A command run: its name, what it does (its spec's summary), the options given and what they do, its redirections. */
  runs: (lang: Lang, noun: string, options: string, io: string, status?: number): string => (lang === 'ja'
    ? `${noun}を${options ? `${options}を付けて` : ''}実行する${status === undefined ? '' : `（終了ステータス ${status}）`}${io ? `（${io}）` : ''}`
    : `runs ${noun}${options ? ` using ${options}` : ''}${status === undefined ? '' : ` with status ${status}`}${io ? `, with ${io}` : ''}`),
  /** An assignment before a command's name: what the command runs with. */
  prefixSet: (lang: Lang, name: string, value: string): string => pick(lang, `${name}は${value}`, `${name} set to ${value}`),
  /** A command as a noun: its name and what it does. */
  noun: (lang: Lang, names: string, what: string | undefined): string => (what ? pick(lang, `${names}（${what}）`, `${names} (${lowerFirst(what)})`) : names),
  /** An option given, and what it does. */
  option: (lang: Lang, name: string, what: string): string => pick(lang, `${name}（${what}）`, `${name} (${what})`),
  calls: (lang: Lang, name: string, io: string): string => (lang === 'ja' ? `関数${name}を呼び出す${io ? `（${io}）` : ''}` : `calls the function ${name}${io ? `, with ${io}` : ''}`),
  /** `[ … ]` or `test`: the condition its words make. */
  tests: (lang: Lang, written: string, io: string): string => (lang === 'ja' ? `${written}の条件を判定する${io ? `（${io}）` : ''}` : `tests the condition in ${written}${io ? `, with ${io}` : ''}`),
  /** A command with no name: the variables it sets (`assigned`), or none and only its redirections. */
  sets: (lang: Lang, assigned: string, io: string): string => (lang === 'ja' ? `${assigned}代入する${io ? `（${io}）` : ''}` : `sets ${assigned}${io ? `, with ${io}` : ''}`),
  /** One variable set, and its value. */
  setTo: (lang: Lang, name: string, value: string): string => pick(lang, `${name}に${value}を`, `${name} to ${value}`),
  /** `x+=v`. */
  appendTo: (lang: Lang, name: string, value: string): string => pick(lang, `${name}に今の値のあとに${value}をつなげたものを`, `${name} to its value followed by ${value}`),
  /** The assignments of a declaration builtin (`local x=$1`), after its clause. */
  declares: (lang: Lang, clause: string, assigned: string): string => pick(lang, `${clause}。${assigned}代入する`, `${clause} and sets ${assigned}`),
  /** `a=(…)`: the words it is set to. */
  array: (lang: Lang, items: string): string => (items ? pick(lang, `配列（${items}）`, `an array of ${items}`) : pick(lang, '空の配列', 'an empty array')),
  /** A compound command with redirections after it, which apply to the whole of it. */
  withIo: (lang: Lang, clause: string, io: string): string => pick(lang, `全体の入出力: ${io}。${clause}`, `with ${io}: ${clause}`),
  onlyRedirects: (lang: Lang, io: string): string => pick(lang, `コマンドは実行せず、リダイレクトだけを行う（${io}）`, `runs no command, only its redirections: ${io}`),
  /** A pipeline: each stage's stdout is the next one's stdin. */
  pipe: (lang: Lang, stages: readonly string[]): string => (lang === 'ja'
    ? `${stages[0]}の出力を${stages.slice(1).join('に渡し、その出力を')}に渡す`
    : `pipes ${stages.join(' into ')}`),
  /**
   * A compound command that is a stage of a pipeline (`what`, named by its kind), where it runs (`where`: in a subshell
   * `on`, in the shell itself with `lastpipe` `off`, either `unknown`; undefined for `( )`, which says it), and what it
   * does.
   */
  stage: (lang: Lang, what: string, where: 'on' | 'off' | 'unknown' | undefined, does: string): string => {
    if (lang === 'ja') {
      const runs = where === undefined ? '' : { on: 'サブシェルで実行される', off: '（`lastpipe` で）シェル自体で実行される', unknown: 'サブシェルで実行される（`lastpipe` が有効ならシェル自体で）' }[where];
      return `${what}${runs ? `は${runs}。` : 'は、'}${does}`;
    }
    if (where === undefined) return `${what} ${does}`;
    return `${what} runs ${{ on: 'in a subshell', off: 'in the shell itself (`lastpipe`)', unknown: 'in a subshell, or in the shell itself with `lastpipe`' }[where]}: ${does}`;
  },
  /** A block that ends a stage of a pipeline: the stages it feeds. */
  pipesInto: (lang: Lang, stages: readonly string[]): string => (lang === 'ja'
    ? `その出力を${stages.join('に渡し、その出力を')}に渡す`
    : `pipes its output into ${stages.join(' into ')}`),
  /** The status of a pipeline: its last stage's (`last`), or with pipefail the last that failed; `!` negates it. */
  pipeStatus: (lang: Lang, last: string | undefined, negated: boolean): string => {
    const of = last ? pick(lang, `${last}のもの`, `that of ${last}`) : pick(lang, '最後に失敗したコマンドのもの（なければ 0）', 'that of the last command that fails, or 0');
    return lang === 'ja' ? `終了ステータスは${of}${negated ? 'を反転したもの' : ''}` : `its status is ${of}${negated ? ', negated' : ''}`;
  },
  /** `set -e` stops the shell when the statement fails: the script, a subshell, or one of them. */
  errexit: (lang: Lang, stops: 'subshell' | 'unknown'): string => {
    const shell = stops === 'subshell' ? pick(lang, 'サブシェル', 'the subshell') : pick(lang, 'シェル（スクリプトかサブシェル）', 'the shell it runs in (the script or a subshell)');
    return pick(lang, `失敗すると \`set -e\` で${shell}が止まる`, `if it fails, \`set -e\` stops ${shell}`);
  },
  /** An AND or OR list under `set -e` (manual 4.3.1): a failure of a command but the last does not stop the shell. */
  errexitList: (lang: Lang, stops: 'script' | 'subshell' | 'unknown'): string => {
    const shell = stops === 'script' ? pick(lang, 'スクリプト', 'the script') : pick(lang, 'シェル', 'the shell');
    return pick(lang, `\`set -e\` があっても、最後より前のコマンドが失敗したときは${shell}は止まらない`, `under \`set -e\`, a command that fails before the last one does not stop ${shell}`);
  },
  /** What joins two clauses of a list: `&&`, `||`, a newline or `;`. */
  then: (lang: Lang, op: '&&' | '||' | ';', clause: string): string => {
    const how = { '&&': pick(lang, '成功したら、', 'if that succeeds, '), '||': pick(lang, '失敗したら、', 'if that fails, '), ';': pick(lang, '続けて、', 'then ') }[op];
    return how + clause;
  },
  /** A statement started with `&`: the whole of it runs in the background. */
  background: (lang: Lang, clause: string): string => pick(lang, `バックグラウンドで: ${clause}`, `in the background, ${clause}`),
  negated: (lang: Lang, clause: string): string => pick(lang, `${clause}（終了ステータスは反転）`, `${clause}, and negates its status`),
  timed: (lang: Lang, clause: string): string => pick(lang, `${clause}。かかった時間を表示する`, `${clause}, and reports the time it takes`),
  subshell: (lang: Lang, clause: string): string => pick(lang, `サブシェルで: ${clause}`, `in a subshell, ${clause}`),
  group: (lang: Lang, clause: string): string => pick(lang, `1つのグループとして: ${clause}`, `as one group, ${clause}`),
  /** `(( … ))`; `[[ … ]]`. */
  arith: (lang: Lang): string => pick(lang, '`(( … ))` の算術式を評価する', 'evaluates the arithmetic in `(( … ))`'),
  testExt: (lang: Lang): string => pick(lang, '`[[ … ]]` の条件を判定する', 'tests the condition in `[[ … ]]`'),
  coproc: (lang: Lang, noun: string): string => pick(lang, `${noun}をコプロセスとして実行する`, `runs ${noun} as a coprocess`),

  // The condition of `if`, `while` and `until`, as a subject.
  testSubject: (lang: Lang, written: string): string => pick(lang, `テスト${written}`, `the test ${written}`),
  pipeSubject: (lang: Lang, names: string): string => pick(lang, `${names}のパイプライン`, `the pipeline of ${names}`),
  notSubject: (lang: Lang, subject: string): string => pick(lang, `${subject}の否定`, `the negation of ${subject}`),
  conditionOf: (lang: Lang, names: string): string => pick(lang, `条件（${names}）`, `its condition (${names})`),

  // A body: the lines of a block, or the commands of one on one line.
  bodyOf: (lang: Lang, names: string): string => (names ? pick(lang, `本体（${names}）`, `its body (${names})`) : pick(lang, '本体', 'its body')),
  runsBody: (lang: Lang, body: string): string => pick(lang, `${body}を実行する`, `runs ${body}`),
  nothing: (lang: Lang): string => pick(lang, '何もしない', 'does nothing'),

  // The constructs: what each does.
  ifThen: (lang: Lang, subject: string, then: string, otherwise: string | undefined): string => (lang === 'ja'
    ? `${subject}が成功したら、${then}${otherwise ? `。そうでなければ、${otherwise}` : ''}`
    : `if ${subject} succeeds, ${then}${otherwise ? `; otherwise, ${otherwise}` : ''}`),
  /** The branches of an `if` below its first, as an open `if` says them: `elif`, `else`. */
  branchesBelow: (lang: Lang, words: string): string => pick(lang, `下の${words}に進む`, `goes on to the ${words} below`),
  thenPart: (lang: Lang): string => pick(lang, '`then` 以下を実行する', 'runs what follows `then`'),
  /** `elif` and `else`: what runs when no condition before succeeded. */
  otherwise: (lang: Lang, clause: string): string => pick(lang, `そうでなければ、${clause}`, `otherwise, ${clause}`),
  whileLoop: (lang: Lang, until: boolean, subject: string, body: string): string => (lang === 'ja'
    ? `${subject}が成功する${until ? 'まで' : '間'}、${body}をくり返す`
    : `repeats ${body} ${until ? 'until' : 'while'} ${subject} succeeds`),
  forLoop: (lang: Lang, variable: string, values: string, body: string): string => pick(lang,
    `${variable}を${values}に順に設定して、${body}を実行する`, `runs ${body} with ${variable} set to ${values}, one at a time`),
  /** A `for` or `select` whose words give no word: bash runs its body no time. */
  noWords: (lang: Lang, body: string): string => pick(lang, `\`in\` の後の単語からは何も得られないので、${body}は実行されない`, `does not run ${body}: the words after \`in\` give none`),
  cFor: (lang: Lang, body: string): string => pick(lang, `\`(( … ))\` の条件が真の間、${body}を実行する`, `runs ${body} while the test in \`(( … ))\` is true`),
  select: (lang: Lang, variable: string, values: string, body: string): string => pick(lang,
    `${values}のメニューを表示し、選ばれた値を${variable}に設定して${body}を実行する`, `shows a menu of ${values} and runs ${body} with ${variable} set to the choice`),
  caseOf: (lang: Lang, value: string, lines: string | undefined): string => pick(lang,
    `${value}に最初に一致したパターンの分岐${lines ? `（${lines}）` : ''}を実行する`, `runs the first branch${lines ? ` (${lines})` : ''} whose pattern matches ${value}`),
  caseItem: (lang: Lang, patterns: string, clause: string): string => pick(lang, `値が${patterns}に一致したら、${clause}`, `if the value matches ${patterns}, ${clause}`),
  orPatterns: (lang: Lang, patterns: readonly string[]): string => patterns.join(pick(lang, 'か', ' or ')),
  defines: (lang: Lang, name: string, lines: string | undefined): string => pick(lang,
    `関数${name}を定義する${lines ? `（${lines}）` : ''}。本体は呼び出されるたびに実行される`, `defines the function ${name}${lines ? ` (${lines})` : ''}, whose body runs each time it is called`),
  groupLines: (lang: Lang, lines: string): string => pick(lang, `${lines}を1つのグループとして実行する`, `runs ${lines} as one group`),
  subshellLines: (lang: Lang, lines: string): string => pick(lang, `${lines}をサブシェルで実行する`, `runs ${lines} in a subshell`),

  // The words that end a construct, or go on with it, on a line of their own.
  /** What a construct is, as a closing word names it. */
  /** What a construct is, as a closing word names it (`a`: with the indefinite article, as a stage of a pipeline is first named). */
  construct: (lang: Lang, kind: 'if' | 'while' | 'until' | 'for' | 'select' | 'case' | 'branch' | 'group' | 'subshell', a = false): string => {
    const article = a ? 'a' : 'the';
    if (kind === 'group' || kind === 'subshell' || kind === 'branch') return pick(lang, { group: 'グループ', subshell: 'サブシェル', branch: '分岐' }[kind], `${article} ${kind}`);
    const loop = kind === 'while' || kind === 'until' || kind === 'for' || kind === 'select';
    return lang === 'ja' ? `\`${kind}\` ${loop ? 'ループ' : '文'}` : `${a && kind === 'if' ? 'an' : article} \`${kind}\`${loop ? ' loop' : ''}`;
  },
  /** A construct and the lines it spans, as a stage of a pipeline names it. */
  spanning: (lang: Lang, what: string, lines: string): string => pick(lang, `${what}（${lines}）`, `${what} (${lines})`),
  functionNamed: (lang: Lang, name: string): string => pick(lang, `関数${name}`, `the function ${name}`),
  ends: (lang: Lang, word: string, what: string, line: number, does: string | undefined): string => pick(lang,
    `${word}は行 ${line} からの${what}の終わり${does ? `。${does}` : ''}`, `${word} ends ${what} of line ${line}${does ? `: ${does}` : ''}`),
  /** The redirections of a compound command, which apply to it whole (they are written after its closing word). */
  wholeIo: (lang: Lang, what: string, io: string): string => pick(lang, `${what}全体の入出力: ${io}`, `the whole of ${what} runs with ${io}`),
  continues: (lang: Lang, word: string, what: string, line: number): string => pick(lang, `${word}は行 ${line} からの${what}の続き`, `${word} continues ${what} of line ${line}`),

  // The idioms with a sentence of their own (src/idioms.ts, `idiomSaid`).
  strictMode: (lang: Lang): string => pick(lang, '`errexit`・`nounset`・`pipefail` を有効にする（定番の strict mode）', 'turns on `errexit`, `nounset` and `pipefail`, the usual strict mode'),
  exitTrap: (lang: Lang): string => pick(lang, 'スクリプトがどう終わっても最後に実行するコマンドを登録する', 'registers a command that runs when the script exits, however it exits'),
  quietCheck: (lang: Lang): string => pick(lang, 'コマンドがインストールされているかを、何も表示せずに確かめる', 'checks, printing nothing, whether a command is installed'),
  endless: (lang: Lang, body: string): string => pick(lang, `\`break\` か \`exit\` で抜けるまで、${body}をくり返す`, `repeats ${body} until \`break\` or \`exit\` leaves the loop`),
  readLines: (lang: Lang, file: string, body: string): string => pick(lang, `${file}を1行ずつ読み、行ごとに${body}を実行する`, `reads ${file} one line at a time, running ${body} for each line`),
  /** `sort | uniq -c | sort -rn [| head]`: what it counts (`of`, the stages before it, or its input) and how many it keeps (`top`). */
  countLines: (lang: Lang, of: string | undefined, top: number | undefined | null): string => {
    const lines = of ? pick(lang, `${of}の出力の`, `of the output of ${of} `) : pick(lang, '入力の', 'of its input ');
    const keep = top === undefined ? '' : top === null ? pick(lang, '（先頭の行だけ）', ' (the first lines only)') : pick(lang, `（上位 ${top} 行）`, ` (the first ${top})`);
    return pick(lang, `${lines}各行の出現回数を数え、多い順に回数つきで並べる${keep}`, `counts how often each line ${lines}occurs and lists the lines from the most frequent, with their counts${keep}`);
  },
  /** A test of a bats file (src/hosts/bats.ts), which bats runs as a function, in a process of its own. */
  batsTest: (lang: Lang, lines: string | undefined): string => pick(lang, `bats のテストを定義する${lines ? `（${lines}）` : ''}。bats はテストごとに別のプロセスで本体を実行する`, `defines a bats test${lines ? ` (${lines})` : ''}, whose body bats runs in a process of its own`),
  errorMessage: (lang: Lang, name: string): string => pick(lang, `標準エラー出力にメッセージを出す（${name}）`, `prints a message on stderr (${name})`),
};

/**
 * A Japanese text with a space between each code span and the kana or kanji it touches (docs/japanese-style.md): the
 * clauses put a name next to a particle (`grep`を). A span is fenced by a run of backticks, closed by a run as long
 * (`codeSpan`: ``a`b``); a run that is never closed is text. A line number (`linesSaid`: 行 2, 行 2〜4) is spaced
 * from the kana after it too, as in 「行 1 から」.
 */
export function jaSpaced(text: string): string {
  const letter = /[ぁ-ゖァ-ヺー一-鿿]/;
  const lines = (t: string) => t.replace(/(行 \d+(?:〜\d+)?)(?=[ぁ-ゖァ-ヺー一-鿿])/g, '$1 ');
  let out = '';
  let i = 0;
  while (i < text.length) {
    const open = /`+/.exec(text.slice(i));
    if (!open) break;
    const close = text.indexOf(open[0], i + open.index + open[0].length);
    if (close < 0) break;
    const start = i + open.index;
    const end = close + open[0].length;
    const before = text.slice(i, start);
    const after = text.charAt(end);
    out += lines(before) + (letter.test(before.slice(-1)) ? ' ' : '') + text.slice(start, end) + (letter.test(after) ? ' ' : '');
    i = end;
  }
  return out + lines(text.slice(i));
}

/** The end of a sentence. */
export const sentenceEnd = (lang: Lang, clauses: readonly string[]): string => {
  if (lang === 'ja') return jaSpaced(`${clauses.join('。')}。`);
  const text = clauses.join('; ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
};
