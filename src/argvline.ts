// (Prototype B) What a program receives: the words of a simple command after bash's expansions, quote removal, word
// splitting and globbing, without its assignments and redirections (bash manual 3.7.1). Every value comes from the
// word model (src/semantics/words.ts, `trustedFields`; src/semantics/values.ts, `expansionValue`): a known value is
// said as it is; a value the model does not know here is a labelled placeholder that says what bash puts there (the
// value of `$USER`, the output of `date +%F`, the names a glob matches).
import type { Span } from './analyzer-types';
import type { Lang } from './i18n';
import { ansiCValue, unquoteWord } from './staticword';
import { prefixAssignments, redirectionsOf, type SyntaxNode } from './syntax/tree';
import type { StateModel } from './semantics/state';
import { expansionValue } from './semantics/values';
import { partMeaning, trustedFields, wordMeaning, type WordMeaning } from './semantics/words';
import { parseExpansion } from './expansion';

/** A piece of a word the program receives: text as it is, or a placeholder (`ph`) for a value not known here, with what it is (`title`). */
export interface ArgvPart {
  text: string; ph?: true; title?: string;
  /** A placeholder for any number of words (the fields of an unquoted expansion). */
  many?: true;
  /** (In `condLine`) Glued to the part before it. */
  tight?: true;
  /** (In `condLine`) A word, as its parts. */
  word?: ArgvPart[];
}
/**
 * One word the program receives (or, for a placeholder of several, the words one source word gives), and the word it
 * comes from; `many`: the placeholder stands for any number of words (the names a glob matches, the fields of a split).
 */
export interface ArgvWord { span: Span; parts: ArgvPart[]; many?: true }
/**
 * A part of a simple command that bash handles itself, not in the program's arguments: an assignment, or a redirection
 * with what it does (`effect`: "stderr → `/dev/null`") and how the program finds it when it starts (`already`).
 */
export interface ArgvRemoved {
  text: string; span: Span; kind: 'redirect' | 'assignment'; effect?: string; already?: string;
  /** (Round 7) What a redirection to or from a file does, in one short sentence ("Write stderr (fd 2) to `/dev/null`"): its row's text. */
  say?: string;
}
/** The words a simple command's program receives, and what bash took out first: assignments, redirections, and quotes. */
export interface ArgvLine { words: ArgvWord[]; removed: ArgvRemoved[]; quotes: boolean; empty: string[] }

const T = {
  valueOf: { ja: (c: string) => `${c} の値`, en: (c: string) => `value of ${c}` },
  outputOf: { ja: (c: string) => `${c} の出力`, en: (c: string) => `output of ${c}` },
  fieldsOf: { ja: (c: string) => `${c} を分割した単語`, en: (c: string) => `words of ${c}` },
  meaning: { ja: (c: string, m: string) => `${c} の値: ${m}`, en: (c: string, m: string) => `value of ${c}: ${m}` },
  setOn: { ja: (c: string, n: number) => `${c} の値（${n} 行目で代入）`, en: (c: string, n: number) => `value of ${c}, set on line ${n}` },
  loop: { ja: (w: string) => `${w} を回るループの今の値`, en: (w: string) => `the loop's current item from ${w}` },
  home: { ja: 'ホームディレクトリ', en: 'home directory' },
  homeOf: { ja: (u: string) => `${u} のホームディレクトリ`, en: (u: string) => `home directory of ${u}` },
  pwd: { ja: '現在のディレクトリ', en: 'current directory' },
  oldpwd: { ja: '直前のディレクトリ', en: 'previous directory' },
  glob: {
    short: { ja: (p: string) => `${p} に一致する各名前`, en: (p: string) => `each name matching ${p}` },
    plain: { ja: (p: string) => `${p} に一致する名前。一致しなければ ${p} がそのまま渡る`, en: (p: string) => `The names matching ${p}; ${p} itself when none matches` },
    nullglob: { ja: (p: string) => `${p} に一致する名前。一致しなければ何も渡らない（nullglob）`, en: (p: string) => `The names matching ${p}; nothing when none matches (nullglob)` },
    failglob: { ja: (p: string) => `${p} に一致する名前。一致しなければエラー（failglob）`, en: (p: string) => `The names matching ${p}; an error when none matches (failglob)` },
    unknown: { ja: (p: string) => `${p} に一致する名前`, en: (p: string) => `The names matching ${p}` },
  },
  processFile: { ja: (c: string) => `${c} のファイル名`, en: (c: string) => `a file name for ${c}` },
  streams: { ja: ['標準入力', '標準出力', '標準エラー出力'], en: ['stdin', 'stdout', 'stderr'] },
  fd: { ja: (n: string) => `fd ${n}`, en: (n: string) => `fd ${n}` },
  both: { ja: '標準出力と標準エラー出力', en: 'stdout and stderr' },
  append: { ja: '（追記）', en: ' (appended)' },
  closed: { ja: '閉じる', en: 'closed' },
  heredoc: { ja: 'ヒアドキュメント', en: 'the here-document' },
  herestring: { ja: 'ヒアストリング', en: 'the here-string' },
  already: {
    ja: (name: string, stream: string, to: string) => `${name} の起動時には、${stream}がすでに${to.startsWith('`') ? ` ${to} ` : to}になっている`,
    en: (name: string, stream: string, to: string) => `${name}'s ${stream} is already ${to} when it starts`,
  },
  alreadyClosed: { ja: (name: string, stream: string) => `${name} の起動時には、${stream}がすでに閉じている`, en: (name: string, stream: string) => `${name}'s ${stream} is already closed when it starts` },
  assigned: { ja: '変数の代入', en: 'a variable assignment' },
  say: {
    write: { ja: (s: string, f: string) => `${s}を ${f} に書き込む`, en: (s: string, f: string) => `Write ${s} to ${f}` },
    append: { ja: (s: string, f: string) => `${s}を ${f} に追記する`, en: (s: string, f: string) => `Append ${s} to ${f}` },
    read: { ja: (s: string, f: string) => `${s}を ${f} から読む`, en: (s: string, f: string) => `Read ${s} from ${f}` },
  },
  fdOf: { ja: (s: string, n: string) => `${s}(fd ${n})`, en: (s: string, n: string) => `${s} (fd ${n})` },
};

/**
 * Text as a placeholder shows it: short (a long command or expansion is cut after a whole word, never inside one;
 * round 8). A text with no space early enough stays whole.
 */
const short = (s: string): string => {
  if (s.length <= 24) return s;
  const at = s.lastIndexOf(' ', 22);
  return at > 0 ? `${s.slice(0, at)} …` : s;
};

interface Ctx {
  model: StateModel;
  lang: Lang;
  /** What a well-known variable is (`$USER`: the user name), src/explain/words.ts `varDesc`. */
  describe(name: string, at: SyntaxNode): string | undefined;
}

const lower = (lang: Lang, s: string): string => (lang === 'en' && /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/** The source span of a node, in the panel's terms. */
const spanOf = (n: SyntaxNode): Span => ({ start: { line: n.startPosition.row, character: n.startPosition.column }, end: { line: n.endPosition.row, character: n.endPosition.column } });

/** The words the program of the simple command `cmd` receives, or undefined when it has no name. */
export function argvLine(cmd: SyntaxNode, model: StateModel, lang: Lang, describe: Ctx['describe']): ArgvLine | undefined {
  const name = cmd.children.find((c) => c.field === 'name');
  if (!name) return undefined;
  const cx: Ctx = { model, lang, describe };
  const words = [name.namedChildren[0] ?? name, ...cmd.children.filter((c) => c.field === 'argument')];
  const out: ArgvWord[] = [];
  const empty: string[] = [];
  let quotes = false;
  for (const w of words) {
    if (hasQuotes(w)) quotes = true;
    const got = wordArgv(w, cx);
    if (!got.length) empty.push(w.text);
    out.push(...got);
  }
  const prog = name.text;
  const removed = [...prefixAssignments(cmd), ...redirectionsOf(cmd)].sort((a, b) => a.startIndex - b.startIndex)
    .map((x): ArgvRemoved => (x.type === 'variable_assignment'
      ? { text: x.text, span: spanOf(x), kind: 'assignment', effect: T.assigned[lang] }
      : { text: x.text, span: spanOf(x), kind: 'redirect', ...redirEffect(x, prog, lang) }));
  return { words: out, removed, quotes, empty };
}

/**
 * What a redirection does (3.6), said short: the stream it changes and where it goes (`2>/dev/null`: stderr →
 * `/dev/null`; `>&2`: stdout → stderr), and how the program `prog` finds that stream when it starts.
 */
function redirEffect(r: SyntaxNode, prog: string, lang: Lang): { effect?: string; already?: string; say?: string } {
  const op = r.children.find((c) => !c.named)?.type ?? '';
  const fdText = r.children.find((c) => c.field === 'descriptor')?.text;
  const dest = r.children.find((c) => c.field === 'destination');
  const streamOf = (n: string): string => (/^[012]$/.test(n) ? T.streams[lang][Number(n)] : T.fd[lang](n));
  const code = (t: string) => `\`${t}\``;
  const name = code(prog);
  if (fdText !== undefined && !/^\d+$/.test(fdText)) return {};
  if (r.type === 'heredoc_redirect' || r.type === 'herestring_redirect') {
    const stream = streamOf(fdText ?? '0');
    const what = r.type === 'heredoc_redirect' ? T.heredoc[lang] : T.herestring[lang];
    return { effect: `${stream} ← ${what}`, already: T.already[lang](name, stream, what) };
  }
  if (r.type !== 'file_redirect' || !dest) return {};
  const to = dest.text;
  if (op === '&>' || op === '&>>') {
    const both = T.both[lang];
    return { effect: `${both} → ${code(to)}${op === '&>>' ? T.append[lang] : ''}`, already: T.already[lang](name, both, code(to)), say: T.say[op === '&>>' ? 'append' : 'write'][lang](both, code(to)) };
  }
  if (op === '>&' || op === '<&') {
    const stream = streamOf(fdText ?? (op === '<&' ? '0' : '1'));
    if (to === '-') return { effect: `${stream}: ${T.closed[lang]}`, already: T.alreadyClosed[lang](name, stream) };
    if (/^\d+$/.test(to)) return { effect: `${stream} → ${streamOf(to)}`, already: T.already[lang](name, stream, streamOf(to)) };
    return {};
  }
  if (op === '<') {
    const stream = streamOf(fdText ?? '0');
    return { effect: `${stream} ← ${code(to)}`, already: T.already[lang](name, stream, code(to)), say: T.say.read[lang](T.fdOf[lang](stream, fdText ?? '0'), code(to)) };
  }
  if (op === '>' || op === '>|' || op === '>>') {
    const stream = streamOf(fdText ?? '1');
    return { effect: `${stream} → ${code(to)}${op === '>>' ? T.append[lang] : ''}`, already: T.already[lang](name, stream, code(to)), say: T.say[op === '>>' ? 'append' : 'write'][lang](T.fdOf[lang](stream, fdText ?? '1'), code(to)) };
  }
  return {};
}

/**
 * (Prototype B) What bash evaluates in `[[ … ]]` once it has expanded the words (3.2.5.2: tilde, parameter and
 * variable expansion, arithmetic and command substitution, quote removal; no word splitting or globbing): its
 * operators as written, each word as the program's side shows a word, the right side of `==` and `!=` marked as a
 * pattern and that of `=~` as a regex.
 */
export function condLine(test: SyntaxNode, model: StateModel, lang: Lang, describe: Ctx['describe']): ArgvPart[] | undefined {
  const cx: Ctx = { model, lang, describe };
  const out: ArgvPart[] = [];
  const mark = { pattern: { ja: '（パターン）', en: ' (pattern)' }, regex: { ja: '（正規表現）', en: ' (regex)' } };
  const walk = (n: SyntaxNode): boolean => {
    if (['binary_expression', 'unary_expression', 'parenthesized_expression', 'negated_expression'].includes(n.type)) {
      const op = n.type === 'binary_expression' ? n.children.find((c) => c.field === 'operator')?.text : undefined;
      for (const c of n.children) {
        if (!walk(c)) return false;
        if (c.field === 'right' && op && ['==', '=', '!='].includes(op)) out.push({ text: mark.pattern[lang], tight: true });
        if (c.field === 'right' && op === '=~') out.push({ text: mark.regex[lang], tight: true });
      }
      return true;
    }
    if (n.type === '[[' || n.type === ']]') return true;
    if (!n.named || n.type === 'test_operator') {
      out.push({ text: n.text });
      return true;
    }
    if (n.type === 'regex') {
      out.push({ text: n.text });
      return true;
    }
    const parts = symbolic(n, cx, false, 0, wordMeaning(n, model));
    if (!parts.length) return false;
    out.push({ text: '', word: parts });
    return true;
  };
  for (const c of test.children) if (!walk(c)) return undefined;
  return out.length ? out : undefined;
}

/** Whether bash removes quotes (or backslashes) from the word. */
function hasQuotes(w: SyntaxNode): boolean {
  if (['string', 'raw_string', 'ansi_c_string', 'translated_string'].includes(w.type)) return true;
  if (w.type === 'word') return w.text.includes('\\');
  return w.children.some(hasQuotes);
}

/** The words one source word gives the program: its fields when the model knows them, else one word with placeholders. */
function wordArgv(w: SyntaxNode, cx: Ctx): ArgvWord[] {
  const span = spanOf(w);
  const m = wordMeaning(w, cx.model);
  if (m) {
    // (Known for sure: only from values the model trusts, and each parameter expansion one Meaning would show.)
    const parts = expansionsIn(w);
    const shown = parts.every((p) => (p.type === 'simple_expansion' || p.type === 'expansion') && expansionValue(p, cx.model) !== undefined);
    if (shown && cx.model.settled(w)) {
      const f = trustedFields(w, cx.model);
      if (f.fields) return f.fields.map((text) => ({ span, parts: [{ text }] }));
    }
  }
  const parts = symbolic(w, cx, false, 0, m);
  // Globbing: the names that match the pattern the word makes (3.5.8), unless pathname expansion is off there.
  const glob = m?.steps.find((s) => s.kind === 'glob');
  if (m && glob && glob.applies !== false && glob.parts.length > 0) {
    const p = parts.map((x) => (x.ph ? `‹${x.text}›` : x.text)).join('');
    const g = m.glob;
    const kind = g.failglob === 'on' ? 'failglob' : g.nullglob === 'on' ? 'nullglob' : g.nullglob === 'off' && g.failglob === 'off' ? 'plain' : 'unknown';
    return [{ span, parts: [{ text: T.glob.short[cx.lang](p), ph: true, title: T.glob[kind][cx.lang](p) }], many: true }];
  }
  return [{ span, parts, ...(parts.some((x) => x.many) ? { many: true as const } : {}) }];
}

/** The expansions of a word (not those inside a command substitution's script). */
function expansionsIn(w: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  const walk = (n: SyntaxNode): void => {
    if (['simple_expansion', 'expansion', 'command_substitution', 'arithmetic_expansion', 'process_substitution'].includes(n.type)) {
      out.push(n);
      return;
    }
    n.children.forEach(walk);
  };
  walk(w);
  return out;
}

/** The pieces of a word, its expansions as placeholders where their values are not known (`quoted`: inside double quotes). */
function symbolic(n: SyntaxNode, cx: Ctx, quoted: boolean, depth: number, m: WordMeaning | undefined): ArgvPart[] {
  const lang = cx.lang;
  switch (n.type) {
    case 'concatenation':
      return n.children.flatMap((c) => symbolic(c, cx, quoted, depth, m));
    case 'string': case 'translated_string':
      return n.namedChildren.flatMap((c) => symbolic(c, cx, true, depth, m));
    case 'string_content':
      return [{ text: unquoteWord(`"${n.text}"`) ?? n.text }];
    case 'raw_string':
      return [{ text: n.text.slice(1, -1) }];
    case 'ansi_c_string':
      return [{ text: ansiCValue(n.text.slice(2, -1)) ?? n.text }];
    case 'simple_expansion': case 'expansion':
      return parameter(n, cx, quoted, depth);
    case 'command_substitution': {
      const body = n.namedChildren.map((c) => c.text).join(' ').trim();
      const text = T.outputOf[lang](short(body));
      const splits = !quoted && split(n, cx);
      return [{ text: splits ? T.fieldsOf[lang](`$(${short(body)})`) : text, ph: true, title: T.outputOf[lang](n.text), ...(splits ? { many: true as const } : {}) }];
    }
    case 'arithmetic_expansion':
      return [{ text: T.valueOf[lang](short(n.text)), ph: true }];
    case 'process_substitution':
      return [{ text: T.processFile[lang](short(n.text)), ph: true }];
    case 'word': case 'number': case 'extglob_pattern': default: {
      if (n.namedChildren.length && n.type !== 'word') return n.children.flatMap((c) => symbolic(c, cx, quoted, depth, m));
      return literalWithTildes(n, m, lang);
    }
  }
}

/** Literal text after quote removal, with its tilde prefixes (3.5.2) as placeholders. */
function literalWithTildes(n: SyntaxNode, m: WordMeaning | undefined, lang: Lang): ArgvPart[] {
  const tildes = m?.tildes.filter((t) => t.node === n) ?? [];
  const out: ArgvPart[] = [];
  let at = 0;
  const plain = (s: string) => {
    if (s) out.push({ text: unquoteWord(s) ?? s });
  };
  for (const t of tildes) {
    plain(n.text.slice(at, t.start));
    const user = t.user;
    const text = user === '' ? T.home[lang] : user === '+' ? T.pwd[lang] : user === '-' ? T.oldpwd[lang] : T.homeOf[lang](user);
    out.push({ text, ph: true, title: n.text.slice(t.start, t.end) });
    at = t.end;
  }
  plain(n.text.slice(at));
  return out;
}

/** Whether bash splits the result of the unquoted expansion `p` where it is. */
function split(p: SyntaxNode, cx: Ctx): boolean {
  return partMeaning(p, cx.model)?.split.applies !== false;
}

/** A parameter expansion: its value when the model knows it, else what it is (a well-known variable, the value set on a line, a loop's item). */
function parameter(n: SyntaxNode, cx: Ctx, quoted: boolean, depth: number): ArgvPart[] {
  const lang = cx.lang;
  const v = expansionValue(n, cx.model);
  if (v && !v.glob && (quoted || v.joined || !v.words)) return [{ text: v.text }];
  const name = n.type === 'simple_expansion' ? n.text.slice(1) : parseExpansion(n.text)?.name;
  const plainForm = n.type === 'simple_expansion' || /^\$\{[A-Za-z_]\w*\}$/.test(n.text);
  const code = n.text;
  const splits = !quoted && split(n, cx);
  if (name && plainForm) {
    const meaning = cx.describe(name, n);
    if (meaning) {
      const text = lower(lang, meaning);
      return [{ text: splits ? T.fieldsOf[lang](code) : text, ph: true, title: T.meaning[lang](code, meaning), ...(splits ? { many: true as const } : {}) }];
    }
    if (/^[A-Za-z_]\w*$/.test(name) && !splits) {
      const st = cx.model.at(n).run.variables.get(name);
      // The loop variable of a `for` around the expansion: the item of this pass.
      const loop = st?.at.parent?.type === 'for_statement' && st.at.parent.startIndex <= n.startIndex && n.endIndex <= st.at.parent.endIndex ? st.at.parent : undefined;
      if (loop) {
        const items = loop.children.filter((c) => c.field === 'value').map((c) => c.text).join(' ');
        if (items) return [{ text: T.loop[lang](short(items)), ph: true, title: T.valueOf[lang](code) }];
      }
      // The value word of the plain assignment that set it on every path to here (`VariableState.source`), shown
      // the same way, where the model trusts the variable.
      if (st && st.set === 'on' && st.source && depth < 2 && cx.model.trusts(name)) {
        const line = st.at.startPosition.row + 1;
        const inner = symbolic(st.source, cx, true, depth + 1, wordMeaning(st.source, cx.model));
        return inner.map((p) => ({ ...p, title: p.title ?? T.setOn[lang](code, line) }));
      }
    }
  }
  return [{ text: splits ? T.fieldsOf[lang](code) : T.valueOf[lang](code), ph: true, ...(splits ? { many: true as const } : {}) }];
}
