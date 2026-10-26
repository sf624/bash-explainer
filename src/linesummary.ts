// (Prototype B) One sentence that says what the whole line does, only where the line is a pattern this file
// recognises: a frequency count (`sort | uniq -c | sort -rn | head`, after a `grep` of files), a tar archive made, a
// failure reported on stderr (`… || echo msg >&2`), a loop over the names a glob matches, a file sourced when a test
// finds it. Each sentence is built from the words of the line and the fixed meaning of the pattern; a line that
// matches none has no summary (never a guess). Round 7: the sentence leads with the result (what is shown, what file
// is made), then the effects the line's words and the models say: files read and written, error messages hidden, and
// the exit status where the status model gives it (`a || b`: the status of the last command run).
import type { Lang } from './i18n';
import { staticWordValue } from './staticword';
import type { StateModel } from './semantics/state';
import type { StatusModel } from './semantics/status';
import { wordMeaning } from './semantics/words';
import type { Shell } from './dialect';
import { pitfallFindings } from './pitfalls';
import { descendants, field, fields, redirectionsOf, type SyntaxNode } from './syntax/tree';

const code = (t: string): string => `\`${t}\``;
const nameOf = (c: SyntaxNode): string | undefined => {
  const n = c.type === 'command' ? field(c, 'name') : undefined;
  return n?.namedChildren[0] ? staticWordValue(n.namedChildren[0]) : undefined;
};
const argsOf = (c: SyntaxNode): SyntaxNode[] => fields(c, 'argument');
const words = (c: SyntaxNode): (string | undefined)[] => argsOf(c).map((w) => staticWordValue(w));
/** A word as code: `"$backup"` is said `$backup` (its quotes keep it one word; the reader knows it as the variable). */
const shown = (w: SyntaxNode): string => code(w.type === 'string' && w.namedChildren.length === 1 && /^(simple_)?expansion$/.test(w.namedChildren[0].type) ? w.namedChildren[0].text : w.text);
const flat = (s: string): string => s.replace(/\s+/g, ' ').trim();
const and = (lang: Lang, list: string[]): string => (lang === 'ja' ? list.join('・') : list.length < 3 ? list.join(' and ') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);

/** The well-known variables a pattern of `grep` may be, as the sentence names their values. */
const VALUES: Record<string, Record<Lang, string>> = {
  USER: { en: 'your user name', ja: 'あなたのユーザー名' },
  LOGNAME: { en: 'your user name', ja: 'あなたのユーザー名' },
  HOSTNAME: { en: 'the host name', ja: 'ホスト名' },
};

const S = {
  top: {
    en: (n: number | undefined, which: string) => (n === undefined ? `Lists ${which}from the most frequent, with their counts` : n === 1 ? `Shows the most frequent ${which.replace(/^the lines/, 'line')}with its count` : `Shows the ${n} most frequent ${which.replace(/^the /, '')}with their counts`),
    ja: (n: number | undefined, which: string) => `${which}${n === undefined ? 'を多い順に' : n === 1 ? 'のうち最も多い 1 行を' : `のうち最も多い ${n} 行を`}回数つきで表示する`,
  },
  linesOf: { en: (of: string) => `the lines ${of}, `, ja: (of: string) => `${of}の行` },
  ofOutput: { en: (c: string) => `of the output of ${c}`, ja: (c: string) => `${c} の出力` },
  ofInput: { en: 'of the input', ja: '入力' },
  mentioning: {
    en: (what: string, files: string, icase: boolean) => `the lines mentioning ${what}${icase ? ' (in any case)' : ''} in ${files}, `,
    ja: (what: string, files: string, icase: boolean) => `${files} で${what}を含む行${icase ? '（大文字・小文字を区別しない）' : ''}`,
  },
  tar: {
    en: (zip: string, file: string, paths: string, quiet: boolean) => `Creates ${file}, a ${zip}tar archive of ${paths}${quiet ? ", with tar's error messages hidden (stderr → `/dev/null`)" : ''}`,
    ja: (zip: string, file: string, paths: string, quiet: boolean) => `${paths} を${zip}tar アーカイブ ${file} にまとめる${quiet ? '（tar のエラーメッセージは `/dev/null` に捨てる）' : ''}`,
  },
  zip: { z: { en: 'gzip-compressed ', ja: ' gzip で圧縮した ' }, j: { en: 'bzip2-compressed ', ja: ' bzip2 で圧縮した ' }, J: { en: 'xz-compressed ', ja: ' xz で圧縮した ' } } as Record<string, Record<Lang, string>>,
  runs: { en: (c: string) => `Runs ${c}`, ja: (c: string) => `${c} を実行する` },
  orReport: {
    en: (first: string, name: string, msg: string) => `${first}; if ${name} fails, prints ${msg} on stderr.`,
    ja: (first: string, name: string, msg: string) => `${first}。${name} が失敗したら ${msg} を標準エラー出力に出す。`,
  },
  /** The status of `a || b` when `a` fails: `b`'s (the status model: the last command run). */
  orStatus: {
    en: (name: string) => ` The line's exit status is then that of ${name} (0): the failure is not passed on.`,
    ja: (name: string) => 'その場合この行の終了ステータスは ' + name + ' のもの（0）になり、失敗は呼び出し元に伝わらない。',
  },
  aMessage: { en: 'a message', ja: 'メッセージ' },
  loop: {
    en: (body: string, glob: string, v: string, plain: boolean) => `Runs ${body} once for each name matching ${glob}, with ${v} set to that name${plain ? ` (if none matches, once with ${glob} itself)` : ''}.`,
    ja: (body: string, glob: string, v: string, plain: boolean) => `${glob} に一致する名前ごとに、${v} をその名前にして ${body} を実行する${plain ? `（一致しなければ ${glob} そのもので1回）` : ''}。`,
  },
  /** `wc -l "$v"` in the loop: what it shows. */
  loopCount: {
    en: (glob: string, plain: boolean) => `Prints the number of lines of each file matching ${glob}, one file at a time (\`wc -l\`)${plain ? `; if none matches, \`wc\` is run once on the name ${glob} itself` : ''}.`,
    ja: (glob: string, plain: boolean) => `${glob} に一致する各ファイルの行数を、1つずつ表示する（\`wc -l\`）${plain ? `。一致しなければ、\`wc\` は名前 ${glob} そのもので1回実行される` : ''}。`,
  },
  /** `wc -l WORD` in a loop: the file counted. */
  counts: {
    en: (file: string) => `Counts the lines of ${file}.`,
    ja: (file: string) => `${file} の行数を数える。`,
  },
  currentFile: {
    en: (v: string, line: number) => `the current file ${v} (from the loop on line ${line})`,
    ja: (v: string, line: number) => `ループ（${line} 行目）の今のファイル ${v}`,
  },
  sets: {
    en: (name: string, value: string, remarks: string[]) => `Sets the variable ${name} to ${value}${remarks.length ? ` (${remarks.join('; ')})` : ''}.`,
    ja: (name: string, value: string, remarks: string[]) => `変数 ${name} に ${value} を代入する${remarks.length ? `（${remarks.join('。')}）` : ''}。`,
  },
  emptyValue: { en: 'an empty value', ja: '空' },
  substituted: {
    en: (sub: string, cmd: string) => `${sub} is replaced by the output of ${cmd}`,
    ja: (sub: string, cmd: string) => `${sub} は ${cmd} の出力に置き換わる`,
  },
  home: { en: (w: string) => `${w}: your home directory`, ja: (w: string) => `${w} はあなたのホームディレクトリ` },
  /**
   * A file named with no `/` in `source`: it is looked for in `$PATH` first (the caveat of that line). (Round 10: the
   * summary names it only; the risk is said in the list of risks, not here.)
   */
  namedFile: {
    en: (f: string) => `a file named ${f}`,
    ja: (f: string) => `${f} という名前のファイル`,
  },
  source: {
    en: (file: string, conds: string[]) => `Runs ${file} in this shell (\`source\`) if ${conds.join(' and ')}, so the variables and functions it sets stay; otherwise does nothing.`,
    ja: (file: string, conds: string[]) => `${file}${file.endsWith('`') ? ' ' : ''}をこのシェルで実行する（\`source\`）。実行するのは ${conds.join('で、かつ ')}${conds[conds.length - 1].endsWith('`') ? ' ' : ''}のときだけ。中で設定した変数や関数はこのシェルに残る。`,
  },
  tests: {
    '-f': { en: 'is an existing regular file', ja: '存在する通常のファイル' },
    '-e': { en: 'exists', ja: '存在するファイルやディレクトリ' },
    '-r': { en: 'is an existing readable file', ja: '存在して読めるファイル' },
    '-s': { en: 'is an existing file that is not empty', ja: '存在して空でないファイル' },
  } as Record<string, Record<Lang, string>>,
  fileIs: { en: (_f: string, t: string) => `it ${t}`, ja: (f: string, t: string) => `${f} が${t}` },
  equals: { en: (a: string, b: string) => `${a} is ${b}`, ja: (a: string, b: string) => `${a} が ${b}` },
  isTrue: { en: (t: string) => `${t} is true`, ja: (t: string) => `${t} が真` },
};

/** The summary of the line whose statements are `tops`, or undefined when it is not a pattern this file knows. */
export function lineSummary(tops: readonly SyntaxNode[], model: StateModel, lang: Lang, status?: StatusModel, shell?: Shell): string | undefined {
  if (tops.length !== 1) return undefined;
  const n = tops[0];
  const tar = tarCreate(n, lang);
  return countPipeline(n, lang) ?? orReport(n, lang, status) ?? (tar && `${tar}${lang === 'ja' ? '。' : '.'}`) ?? globLoop(n, model, lang) ?? sourceIf(n, lang, model, shell) ?? wcLoop(n, lang) ?? assignment(n, lang);
}

/** Options of a command, each a word `-abc` of the letters `allowed` (and no operand): its letters, or undefined. */
function letters(c: SyntaxNode, allowed: string): string | undefined {
  const w = words(c);
  if (w.some((x) => x === undefined || !new RegExp(`^-[${allowed}]+$`).test(x))) return undefined;
  return w.map((x) => x!.slice(1)).join('');
}

/**
 * `grep [-h] [-i] [-w] [-F] PATTERN FILE…` whose lines can be counted as they are: its pattern as the sentence names
 * it (a well-known variable's value, or a plain text: no regex character) and its files; with more than one file,
 * or a glob, `-h` (else each line starts with its file's name).
 */
function grepOf(c: SyntaxNode, lang: Lang): string | undefined {
  if (nameOf(c) !== 'grep' || redirectionsOf(c).length) return undefined;
  const args = argsOf(c);
  const opts: string[] = [];
  let i = 0;
  for (; i < args.length; i++) {
    const v = staticWordValue(args[i]);
    if (v === undefined || !v.startsWith('-')) break;
    if (!/^-[hiwF]+$/.test(v)) return undefined;
    opts.push(...v.slice(1));
  }
  const [pat, ...files] = args.slice(i);
  if (!pat || !files.length || files.some((f) => f.text.startsWith('-'))) return undefined;
  const glob = files.some((f) => /[*?[]/.test(f.text));
  if ((files.length > 1 || glob) && !opts.includes('h')) return undefined;
  const inner = pat.type === 'string' && pat.namedChildren.length === 1 ? pat.namedChildren[0] : pat;
  const variable = inner.type === 'simple_expansion' ? inner.text.slice(1) : /^\$\{(\w+)\}$/.exec(inner.text)?.[1];
  let what: string | undefined;
  if (variable) what = VALUES[variable]?.[lang];
  else {
    const v = staticWordValue(pat);
    if (v && (opts.includes('F') || !/[\\.*[\]^$+?(){}|]/.test(v))) what = code(v);
  }
  if (!what) return undefined;
  return S.mentioning[lang](what, and(lang, files.map(shown)), opts.includes('i'));
}

/** `… | sort | uniq -c | sort -rn [| head -N]`: the most frequent lines first, with their counts. */
function countPipeline(n: SyntaxNode, lang: Lang): string | undefined {
  if (n.type !== 'pipeline') return undefined;
  const st = n.namedChildren;
  if (st.some((c) => c.type !== 'command' || redirectionsOf(c).length)) return undefined;
  const i = st.findIndex((c, k) => nameOf(c) === 'sort' && k + 2 < st.length && nameOf(st[k + 1]) === 'uniq' && nameOf(st[k + 2]) === 'sort');
  if (i < 0) return undefined;
  const first = letters(st[i], 'bdfgiMhnrV');
  const counted = words(st[i + 1]).join(' ') === '-c';
  const last = letters(st[i + 2], 'bnr');
  if (first === undefined || first.includes('r') || !counted || !last || !last.includes('n') || !last.includes('r')) return undefined;
  let top: number | undefined;
  if (st.length === i + 4) {
    if (nameOf(st[i + 3]) !== 'head') return undefined;
    const w = words(st[i + 3]);
    const m = w.length === 0 ? '10' : w.length === 1 ? /^-(\d+)$/.exec(w[0] ?? '')?.[1] : w.length === 2 && w[0] === '-n' ? /^(\d+)$/.exec(w[1] ?? '')?.[1] : undefined;
    if (!m) return undefined;
    top = Number(m);
  } else if (st.length !== i + 3) return undefined;
  // Which lines: those a `grep` before finds in its files, when it is one this file can name; else the output of the
  // stages before, or the input.
  const grep = i === 1 ? grepOf(st[0], lang) : undefined;
  const before = st.slice(0, i).map((c) => flat(c.text)).join(' | ');
  const which = grep ?? S.linesOf[lang](!before ? S.ofInput[lang] : S.ofOutput[lang](before.length <= 44 ? code(before) : code(`${nameOf(st[0]) ?? '…'} …`)));
  return `${S.top[lang](top, which)}${lang === 'ja' ? '。' : '.'}`;
}

/** `tar -czf FILE PATH…`: a tar archive made (the first word the options, `f` last so that its value is the next). */
function tarCreate(n: SyntaxNode, lang: Lang): string | undefined {
  if (n.type !== 'command' || nameOf(n) !== 'tar') return undefined;
  const args = argsOf(n);
  const opts = args[0] && staticWordValue(args[0]);
  if (!opts || !/^-?[cvzjJ]*f$/.test(opts) || !opts.includes('c')) return undefined;
  const file = args[1];
  const paths = args.slice(2);
  if (!file || !paths.length || paths.some((p) => p.text.startsWith('-'))) return undefined;
  const reds = redirectionsOf(n).map((r) => r.text.replace(/\s+/g, ''));
  if (reds.some((r) => r !== '2>/dev/null')) return undefined;
  const zips = [...opts].filter((x) => S.zip[x]);
  if (zips.length > 1) return undefined;
  const zip = zips.length ? S.zip[zips[0]][lang] : (lang === 'ja' ? ' ' : '');
  return S.tar[lang](zip, shown(file), and(lang, paths.map(shown)), reds.length > 0);
}

/** `cmd || echo msg >&2`: a failure of `cmd` reported on stderr; the line's status then `echo`'s (the status model). */
function orReport(n: SyntaxNode, lang: Lang, status?: StatusModel): string | undefined {
  if (n.type !== 'list' || n.namedChildren.length !== 2 || !n.children.some((c) => c.type === '||')) return undefined;
  const [left, right] = n.namedChildren;
  if (right.type !== 'command' || !['echo', 'printf'].includes(nameOf(right) ?? '')) return undefined;
  const reds = redirectionsOf(right).map((r) => r.text.replace(/\s+/g, ''));
  if (reds.length !== 1 || !['>&2', '1>&2'].includes(reds[0])) return undefined;
  const w = words(right);
  if (nameOf(right) === 'echo' && w[0]?.startsWith('-')) return undefined;
  const msg = w.length && w.every((x) => x !== undefined) && nameOf(right) === 'echo' ? code(w.join(' ')) : S.aMessage[lang];
  const name = left.type === 'command' ? nameOf(left) : undefined;
  if (!name) return undefined;
  const first = tarCreate(left, lang) ?? S.runs[lang](code(flat(left.text)));
  // (The status of a list is that of the last command run: `echo`'s when the left side failed.)
  const said = status?.status(n).kind === 'last-run' && nameOf(right) === 'echo' ? S.orStatus[lang](code('echo')) : '';
  return S.orReport[lang](first, code(name), msg) + said;
}

/** `for v in GLOB; do cmd … "$v" …; done`: a command run on each name a glob matches. */
function globLoop(n: SyntaxNode, model: StateModel, lang: Lang): string | undefined {
  if (n.type !== 'for_statement') return undefined;
  const v = field(n, 'variable')?.text;
  const values = fields(n, 'value');
  const body = field(n, 'body');
  if (!v || values.length !== 1 || !body) return undefined;
  const m = wordMeaning(values[0], model);
  const glob = m?.steps.find((s) => s.kind === 'glob');
  if (!m || !glob || glob.applies === false || !glob.parts.length) return undefined;
  const cmds = body.namedChildren;
  const quoted = [`"$${v}"`, `"\${${v}}"`];
  if (cmds.length !== 1 || cmds[0].type !== 'command' || !argsOf(cmds[0]).some((a) => quoted.includes(a.text))) return undefined;
  const plain = m.glob.nullglob === 'off' && m.glob.failglob === 'off';
  // (`wc -l "$f"`: what it prints is known: the count of lines of the file.)
  const a = argsOf(cmds[0]).map((x) => x.text);
  if (nameOf(cmds[0]) === 'wc' && !redirectionsOf(cmds[0]).length && a.length === 2 && a[0] === '-l' && quoted.includes(a[1])) return S.loopCount[lang](code(values[0].text), plain);
  return S.loop[lang](code(flat(cmds[0].text)), code(values[0].text), code(`$${v}`), plain);
}

/** `if [[ -f F && … ]]; then source F; fi`: a file run in this shell when a test finds it. */
function sourceIf(n: SyntaxNode, lang: Lang, model: StateModel, shell?: Shell): string | undefined {
  if (n.type !== 'if_statement' || n.namedChildren.some((c) => c.type === 'elif_clause' || c.type === 'else_clause')) return undefined;
  const cond = n.namedChildren.find((c) => c.field === 'condition');
  const body = n.namedChildren.filter((c) => c !== cond && c.field !== 'condition');
  if (!cond || cond.type !== 'extended_test' || body.length !== 1 || body[0].type !== 'command' || !['source', '.'].includes(nameOf(body[0]) ?? '')) return undefined;
  const file = argsOf(body[0]);
  if (file.length !== 1) return undefined;
  // The terms joined by `&&`, in order.
  const terms: SyntaxNode[] = [];
  const split = (e: SyntaxNode): void => {
    if (e.type === 'binary_expression' && e.children.find((c) => c.field === 'operator')?.type === '&&') e.namedChildren.filter((c) => c.field === 'left' || c.field === 'right').forEach(split);
    else terms.push(e);
  };
  const inner = cond.namedChildren;
  if (inner.length !== 1) return undefined;
  split(inner[0]);
  const test = terms.find((t) => t.type === 'unary_expression' && S.tests[t.children[0]?.text] && t.namedChildren[1]?.text === file[0].text);
  if (!test) return undefined;
  let f = code(file[0].text);
  // (A name with no `/`: `source` looks in `$PATH` first, as the caveat on this line says; the summary must not say otherwise.)
  let root = n;
  while (root.parent) root = root.parent;
  const row = body[0].startPosition.row;
  if (pitfallFindings(root, lang, row, row, model, shell).some((x) => x.code === 'source-searches-path' && x.node.startIndex >= body[0].startIndex && x.node.endIndex <= body[0].endIndex)) f = S.namedFile[lang](f);
  // (`$X == word` with no glob character in the word: the pattern matches that text only, 3.2.5.2.)
  const conds = [test, ...terms.filter((t) => t !== test)].map((t) => {
    if (t === test) return S.fileIs[lang](code(file[0].text), S.tests[test.children[0].text][lang]);
    const op = t.type === 'binary_expression' ? t.children.find((c) => c.field === 'operator')?.text : undefined;
    const [l, r] = [t.children.find((c) => c.field === 'left'), t.children.find((c) => c.field === 'right')];
    if (op && ['==', '='].includes(op) && l && r && !r.namedChildren.length && /^[\w.\/-]+$/.test(r.text)) return S.equals[lang](code(l.text), code(r.text));
    return S.isTrue[lang](code(flat(t.text)));
  });
  return S.source[lang](f, conds);
}

/** `wc -l WORD` alone: the lines of a file counted; where the word is the variable of an enclosing `for`, which file. */
function wcLoop(n: SyntaxNode, lang: Lang): string | undefined {
  if (n.type !== 'command' || nameOf(n) !== 'wc' || redirectionsOf(n).length) return undefined;
  const args = argsOf(n);
  if (args.length !== 2 || args[0].text !== '-l' || args[1].text.startsWith('-')) return undefined;
  const w = args[1];
  const inner = w.type === 'string' && w.namedChildren.length === 1 && w.text === `"${w.namedChildren[0].text}"` ? w.namedChildren[0] : w;
  const v = /^\$(\w+)$/.exec(inner.text)?.[1] ?? /^\$\{(\w+)\}$/.exec(inner.text)?.[1];
  for (let x = v ? n.parent : null; x; x = x.parent) {
    if (x.type === 'for_statement' && field(x, 'variable')?.text === v) return S.counts[lang](S.currentFile[lang](code(`$${v}`), x.startPosition.row + 1));
  }
  return S.counts[lang](shown(w));
}

/** `name=value` alone: the variable set, to the value as written, with what its command substitutions and `$HOME` are. */
function assignment(n: SyntaxNode, lang: Lang): string | undefined {
  if (n.type !== 'command' || field(n, 'name') || redirectionsOf(n).length) return undefined;
  const sets = n.namedChildren.filter((c) => c.type === 'variable_assignment');
  if (sets.length !== 1 || n.namedChildren.length !== 1 || !sets[0].children.some((c) => c.type === '=')) return undefined;
  const name = field(sets[0], 'name')?.text;
  const value = field(sets[0], 'value');
  if (!name || (value && value.type === 'array')) return undefined;
  const remarks = value ? descendants(value, ['command_substitution']).filter((c) => c.text.startsWith('$(')).slice(0, 2).map((c) => S.substituted[lang](code(c.text), code(c.text.slice(2, -1).trim()))) : [];
  if (value) {
    const home = descendants(value, ['expansion', 'simple_expansion']).find((x) => x.text === '${HOME}' || x.text === '$HOME')?.text ?? (/^~(\/|$)/.test(value.text) ? '~' : undefined);
    if (home) remarks.push(S.home[lang](code(home)));
  }
  return S.sets[lang](code(name), value && value.text ? code(value.text) : S.emptyValue[lang], remarks);
}
