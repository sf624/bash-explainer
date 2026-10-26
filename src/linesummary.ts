// (Prototype B) One sentence that says what the whole line does, only where the line is a pattern this file
// recognises: a frequency count (`sort | uniq -c | sort -rn | head`), a tar archive made, a failure reported on
// stderr (`… || echo msg >&2`), a loop over the names a glob matches, a file sourced when a test finds it. Each
// sentence is built from the words of the line and the fixed meaning of the pattern; a line that matches none has
// no summary (never a guess).
import type { Lang } from './i18n';
import { staticWordValue } from './staticword';
import type { StateModel } from './semantics/state';
import { wordMeaning } from './semantics/words';
import { field, fields, redirectionsOf, type SyntaxNode } from './syntax/tree';

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

const S = {
  count: {
    en: (of: string, n: number | undefined) => `Counts how many times each line ${of} occurs, and ${n === undefined ? 'lists the lines from the most frequent, with their counts' : n === 1 ? 'shows the most frequent line with its count' : `shows the ${n} most frequent lines with their counts`}.`,
    ja: (of: string, n: number | undefined) => `${of}同じ行が何回現れるかを数え、${n === undefined ? '多い順に回数つきで表示する' : n === 1 ? 'いちばん多い行を回数つきで表示する' : `多い順に上位 ${n} 行を回数つきで表示する`}。`,
  },
  ofOutput: { en: (c: string) => `of the output of ${c}`, ja: (c: string) => `${c} の出力で、` },
  ofInput: { en: 'of the input', ja: '入力で、' },
  tar: {
    en: (zip: string, file: string, paths: string, quiet: boolean) => `Creates the ${zip}tar archive ${file} from ${paths}${quiet ? ', with its error messages discarded' : ''}`,
    ja: (zip: string, file: string, paths: string, quiet: boolean) => `${paths} から${zip} tar アーカイブ ${file} を作る${quiet ? '（エラーメッセージは捨てる）' : ''}`,
  },
  zip: { z: { en: 'gzip-compressed ', ja: ' gzip で圧縮した' }, j: { en: 'bzip2-compressed ', ja: ' bzip2 で圧縮した' }, J: { en: 'xz-compressed ', ja: ' xz で圧縮した' } } as Record<string, Record<Lang, string>>,
  runs: { en: (c: string) => `Runs ${c}`, ja: (c: string) => `${c} を実行する` },
  orReport: {
    en: (first: string, name: string, msg: string) => `${first}; if ${name} fails, prints ${msg} on stderr (the usual way to report an error).`,
    ja: (first: string, name: string, msg: string) => `${first}。${name} が失敗したら、${msg} を標準エラー出力に出す（エラーを知らせる定番の書き方）。`,
  },
  aMessage: { en: 'a message', ja: 'メッセージ' },
  loop: {
    en: (body: string, glob: string, v: string, plain: boolean) => `Runs ${body} once for each name matching ${glob}, with ${v} set to that name${plain ? ` (if none matches, once with ${glob} itself)` : ''}.`,
    ja: (body: string, glob: string, v: string, plain: boolean) => `${glob} に一致する名前ごとに、${v} をその名前にして ${body} を実行する${plain ? `（一致しなければ ${glob} そのもので1回）` : ''}。`,
  },
  source: {
    en: (file: string, test: string, rest: string[]) => `If ${file} ${test}${rest.map((r) => ` and ${r} is true`).join('')}, runs it in this shell (\`source\`), so the variables and functions it sets stay.`,
    ja: (file: string, test: string, rest: string[]) => `${file} が${test}${rest.map((r) => `、かつ ${r} が真`).join('')}なら、それをこのシェルで実行する（\`source\`）。中で設定した変数や関数が残る。`,
  },
  tests: {
    '-f': { en: 'is an existing regular file', ja: '存在する通常のファイル' },
    '-e': { en: 'exists', ja: '存在する' },
    '-r': { en: 'is an existing readable file', ja: '存在して読めるファイル' },
    '-s': { en: 'is an existing file that is not empty', ja: '存在して空でないファイル' },
  } as Record<string, Record<Lang, string>>,
};

/** The summary of the line whose statements are `tops`, or undefined when it is not a pattern this file knows. */
export function lineSummary(tops: readonly SyntaxNode[], model: StateModel, lang: Lang): string | undefined {
  if (tops.length !== 1) return undefined;
  const n = tops[0];
  const tar = tarCreate(n, lang);
  return countPipeline(n, lang) ?? orReport(n, lang) ?? (tar && `${tar}${lang === 'ja' ? '。' : '.'}`) ?? globLoop(n, model, lang) ?? sourceIf(n, lang);
}

/** Options of a command, each a word `-abc` of the letters `allowed` (and no operand): its letters, or undefined. */
function letters(c: SyntaxNode, allowed: string): string | undefined {
  const w = words(c);
  if (w.some((x) => x === undefined || !new RegExp(`^-[${allowed}]+$`).test(x))) return undefined;
  return w.map((x) => x!.slice(1)).join('');
}

/** `… | sort | uniq -c | sort -rn [| head -N]`: how often each line occurs, the most frequent first. */
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
  const before = st.slice(0, i).map((c) => flat(c.text)).join(' | ');
  const of = !before ? S.ofInput[lang] : S.ofOutput[lang](before.length <= 44 ? code(before) : code(`${nameOf(st[0]) ?? '…'} …`));
  return S.count[lang](of, top);
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
  const zip = zips.length ? S.zip[zips[0]][lang] : '';
  return S.tar[lang](zip, shown(file), paths.map(shown).join(lang === 'ja' ? '・' : ' and '), reds.length > 0);
}

/** `cmd || echo msg >&2`: a failure of `cmd` reported on stderr. */
function orReport(n: SyntaxNode, lang: Lang): string | undefined {
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
  return S.orReport[lang](first, code(name), msg);
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
  if (cmds.length !== 1 || cmds[0].type !== 'command' || !argsOf(cmds[0]).some((a) => a.text === `"$${v}"` || a.text === `"\${${v}}"`)) return undefined;
  const plain = m.glob.nullglob === 'off' && m.glob.failglob === 'off';
  return S.loop[lang](code(flat(cmds[0].text)), code(values[0].text), code(`$${v}`), plain);
}

/** `if [[ -f F && … ]]; then source F; fi`: a file run in this shell when a test finds it. */
function sourceIf(n: SyntaxNode, lang: Lang): string | undefined {
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
  const rest = terms.filter((t) => t !== test).map((t) => code(flat(t.text)));
  return S.source[lang](code(file[0].text), S.tests[test.children[0].text][lang], rest);
}
