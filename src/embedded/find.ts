import type { Lang } from '../i18n';
import { describeGlob, globParts } from '../expansion';
import { pick } from './types';

/** A find expression, with word indices relative to the first expression word. */
export type FindNode =
  | { type: 'primary'; from: number; to: number; name: string; args: string[] }
  | { type: 'not'; op: number; child: FindNode }
  | { type: 'and'; children: FindNode[]; ops: number[] }
  | { type: 'or'; children: FindNode[]; ops: number[] }
  | { type: 'group'; open: number; close: number; child: FindNode };

/** How many words a primary takes: a count, or everything up to `;`/`+`. */
export type Arity = (primary: string) => number | 'until';

const TERMINATORS = new Set([';', '+']);

/** The text find sees for a word: quotes and a leading backslash removed (`\(` → `(`). */
export function unquote(word: string): string {
  if (/^'.*'$/.test(word) || /^".*"$/.test(word)) return word.slice(1, -1);
  return word.replace(/^\\/, '');
}

export function isExpressionStart(word: string): boolean {
  const w = unquote(word);
  return (w.startsWith('-') && w.length > 1) || w === '(' || w === '!' || w === ',';
}

class Parser {
  i = 0;
  constructor(private words: string[], private arity: Arity) {}

  private peek(): string | undefined {
    return this.words[this.i];
  }

  or(): FindNode {
    const children = [this.and()];
    const ops: number[] = [];
    while (this.peek() === '-o' || this.peek() === '-or') {
      ops.push(this.i++);
      children.push(this.and());
    }
    return children.length === 1 ? children[0] : { type: 'or', children, ops };
  }

  private and(): FindNode {
    const children = [this.unary()];
    const ops: number[] = [];
    for (;;) {
      const w = this.peek();
      if (w === undefined || w === ')' || w === '-o' || w === '-or' || w === ',') break;
      if (w === '-a' || w === '-and') ops.push(this.i++);
      children.push(this.unary());
    }
    return children.length === 1 ? children[0] : { type: 'and', children, ops };
  }

  private unary(): FindNode {
    const w = this.peek();
    if (w === undefined) throw new Error('missing expression');
    if (w === '!' || w === '-not') {
      const op = this.i++;
      return { type: 'not', op, child: this.unary() };
    }
    if (w === '(') {
      const open = this.i++;
      const child = this.or();
      if (this.peek() !== ')') throw new Error('missing )');
      return { type: 'group', open, close: this.i++, child };
    }
    const from = this.i++;
    const n = this.arity(w);
    if (n === 'until') {
      while (this.i < this.words.length && !TERMINATORS.has(this.words[this.i])) this.i++;
      this.i = Math.min(this.i + 1, this.words.length);
    } else {
      this.i = Math.min(this.i + n, this.words.length);
    }
    return { type: 'primary', from, to: this.i - 1, name: w, args: this.words.slice(from + 1, this.i) };
  }
}

/** Parse the expression words (already unquoted). Returns undefined if they do not form an expression. */
export function parseFind(words: string[], arity: Arity): FindNode | undefined {
  const p = new Parser(words, arity);
  try {
    const node = p.or();
    return p.i === words.length ? node : undefined;
  } catch {
    return undefined;
  }
}

const ACTIONS = new Set(['-print', '-print0', '-printf', '-fprint', '-fprint0', '-fprintf', '-ls', '-fls', '-delete', '-exec', '-execdir', '-ok', '-okdir', '-quit']);

function hasAction(n: FindNode): boolean {
  switch (n.type) {
    case 'primary': return ACTIONS.has(n.name);
    case 'not': return hasAction(n.child);
    case 'group': return hasAction(n.child);
    default: return n.children.some(hasAction);
  }
}

/** A short phrase for a primary, e.g. `-mtime +7` → "modified more than 7 days ago". */
function phrase(p: Extract<FindNode, { type: 'primary' }>, lang: Lang): string {
  const s = pick(lang);
  const a = p.args[0] ?? '';
  const age = (unitJa: string, unitEn: string, what: [string, string]) => {
    const n = a.replace(/^[+-]/, '');
    if (a.startsWith('+')) return s(`${n}${unitJa}より前に${what[0]}`, `${what[1]} more than ${n} ${unitEn} ago`);
    if (a.startsWith('-')) return s(`${n}${unitJa}以内に${what[0]}`, `${what[1]} less than ${n} ${unitEn} ago`);
    return s(`ちょうど${n}${unitJa}前に${what[0]}`, `${what[1]} exactly ${n} ${unitEn} ago`);
  };
  const types: Record<string, [string, string]> = { f: ['通常ファイル', 'a regular file'], d: ['ディレクトリ', 'a directory'], l: ['シンボリックリンク', 'a symlink'], p: ['名前付きパイプ', 'a named pipe'], s: ['ソケット', 'a socket'], b: ['ブロックデバイス', 'a block device'], c: ['キャラクタデバイス', 'a character device'] };
  switch (p.name) {
    case '-name': return s(`名前が ${a} に一致`, `name matches ${a}`);
    case '-iname': return s(`名前が ${a} に一致（大小文字区別なし）`, `name matches ${a} (any case)`);
    case '-path': case '-wholename': return s(`パスが ${a} に一致`, `path matches ${a}`);
    case '-ipath': return s(`パスが ${a} に一致（大小文字区別なし）`, `path matches ${a} (any case)`);
    case '-regex': return s(`パス全体が正規表現 ${a} に一致`, `the whole path matches the regex ${a}`);
    case '-type': return a.split(',').map((t) => (types[t] ? s(types[t][0], types[t][1]) : t)).join(s('か', ' or '));
    case '-mtime': return age('日', 'days', ['更新', 'modified']);
    case '-mmin': return age('分', 'minutes', ['更新', 'modified']);
    case '-atime': return age('日', 'days', ['アクセス', 'accessed']);
    case '-amin': return age('分', 'minutes', ['アクセス', 'accessed']);
    case '-ctime': return age('日', 'days', ['状態変更', 'changed']);
    case '-cmin': return age('分', 'minutes', ['状態変更', 'changed']);
    case '-newer': return s(`${a} より新しい`, `newer than ${a}`);
    case '-size': {
      const n = a.replace(/^[+-]/, '');
      return a.startsWith('+') ? s(`サイズが ${n} より大きい`, `larger than ${n}`) : a.startsWith('-') ? s(`サイズが ${n} より小さい`, `smaller than ${n}`) : s(`サイズがちょうど ${n}`, `exactly ${n}`);
    }
    case '-empty': return s('空', 'empty');
    case '-user': return s(`所有者が ${a}`, `owned by ${a}`);
    case '-group': return s(`グループが ${a}`, `group ${a}`);
    case '-perm': return s(`権限が ${a}`, `permissions ${a}`);
    case '-maxdepth': return s(`深さ ${a} まで`, `at most ${a} levels deep`);
    case '-mindepth': return s(`深さ ${a} 以上`, `at least ${a} levels deep`);
    case '-readable': return s('読み取り可能', 'readable');
    case '-writable': return s('書き込み可能', 'writable');
    case '-executable': return s('実行可能', 'executable');
    case '-true': return s('常に真', 'always true');
    case '-false': return s('常に偽', 'always false');
    case '-prune': return s('その中には入らずスキップ', 'skip it without descending');
    case '-print': return s('表示', 'print it');
    case '-print0': return s('NUL 区切りで表示', 'print it NUL-terminated');
    case '-printf': return s(`書式 ${a} で表示`, `print it with the format ${a}`);
    case '-ls': return s('詳細を表示', 'list it in detail');
    case '-delete': return s('削除', 'delete it');
    case '-quit': return s('すぐに終了', 'quit');
    case '-exec': case '-execdir': case '-ok': {
      const cmd = p.args.slice(0, -1).join(' ');
      const batch = p.args[p.args.length - 1] === '+';
      return s(`「${cmd}」を${batch ? 'まとめて' : '1件ずつ'}実行`, `run "${cmd}"${batch ? ' on all at once' : ' for each'}`);
    }
    default: return p.name + (a ? ` ${a}` : '');
  }
}

function describe(n: FindNode, lang: Lang): string {
  const s = pick(lang);
  switch (n.type) {
    case 'primary': return phrase(n, lang);
    case 'not': return s(`「${describe(n.child, lang)}」ではない`, `not (${describe(n.child, lang)})`);
    case 'group': return s(`（${describe(n.child, lang)}）`, `(${describe(n.child, lang)})`);
    // Only at the top or in `( )`: `-o` binds the loosest.
    case 'or': return n.children.map((c) => describe(c, lang)).join(s('、または ', '; or '));
    case 'and': {
      // Conditions followed by actions read as "if <conditions>: <actions>".
      const conds = n.children.filter((c) => !(c.type === 'primary' && (ACTIONS.has(c.name) || c.name === '-prune')));
      const acts = n.children.filter((c) => !conds.includes(c));
      const condText = conds.map((c) => describe(c, lang)).join(s(' かつ ', ' and '));
      if (!acts.length) return condText;
      const actText = acts.map((c) => describe(c, lang)).join(s('して', ', then '));
      return condText ? s(`${condText}なら${actText}`, `if ${condText}: ${actText}`) : actText;
    }
  }
}

/** One sentence for the whole expression, including find's implicit -print. */
export function describeFind(n: FindNode, lang: Lang): string {
  const s = pick(lang);
  const body = describe(n, lang);
  const pruneIdiom = n.type === 'or' && n.children[0].type === 'and'
    && n.children[0].children.some((c) => c.type === 'primary' && c.name === '-prune');
  const idiom = pruneIdiom ? s('（`-prune -o` は、特定のディレクトリを探索から除外する定番の書き方）', ' (`-prune -o` is the usual way to exclude a directory)') : '';
  if (hasAction(n)) return s(`検索条件と処理: ${body}${idiom}`, `Conditions and actions: ${body}${idiom}`);
  return s(`「${body}」に当てはまるものを表示する（処理の指定が無いので \`-print\` が補われる）${idiom}`, `Print what matches: ${body} (no action is given, so \`-print\` is implied)${idiom}`);
}

/** For `-name`-style patterns: what the glob means. */
export function describeFindPattern(pattern: string, lang: Lang): string | undefined {
  const parts = globParts(pattern);
  if (!parts || !parts.some((p) => p.type !== 'text')) return undefined;
  return pick(lang)('パターン: ', 'pattern: ') + describeGlob(parts, lang);
}
