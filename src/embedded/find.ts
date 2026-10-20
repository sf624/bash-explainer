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
  const age = (unitJa: string, unitEn: string, what: [string, string], wholeDays = false) => {
    const n = a.replace(/^[+-]/, '');
    const k = Number(n);
    if (wholeDays && /^\d+$/.test(n)) {
      // find counts the age in whole days (24 hours each), dropping the fraction.
      if (a.startsWith('+')) return s(`${k + 1}日以上前に${what[0]}（日数は端数を切り捨てて数えるので \`+${k}\` は ${k + 1} 日以上前）`, `${what[1]} at least ${k + 1} days ago (age is counted in whole days, fraction dropped: \`+${k}\` means more than ${k} whole days)`);
      if (a.startsWith('-')) return s(`${k}日（${k * 24}時間）未満の間に${what[0]}`, `${what[1]} less than ${k} days (${k * 24} hours) ago`);
      return k === 0
        ? s(`直近24時間以内に${what[0]}`, `${what[1]} within the last 24 hours`)
        : s(`${k}日以上${k + 1}日未満前に${what[0]}`, `${what[1]} between ${k} and ${k + 1} days ago`);
    }
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
    case '-mtime': return age('日', 'days', ['更新', 'modified'], true);
    case '-mmin': return age('分', 'minutes', ['更新', 'modified']);
    case '-atime': return age('日', 'days', ['アクセス', 'accessed'], true);
    case '-amin': return age('分', 'minutes', ['アクセス', 'accessed']);
    case '-ctime': return age('日', 'days', ['状態変更', 'changed'], true);
    case '-cmin': return age('分', 'minutes', ['状態変更', 'changed']);
    case '-newer': return s(`${a} より新しい`, `newer than ${a}`);
    case '-anewer': return s(`アクセス時刻が ${a} の更新時刻より新しい`, `accessed more recently than ${a} was modified`);
    case '-cnewer': return s(`状態変更時刻が ${a} の更新時刻より新しい`, `status changed more recently than ${a} was modified`);
    case '-size': {
      const m = /^([+-]?)(\d+)([bcwkMGTP]?)$/.exec(a);
      if (!m) return s(`サイズが ${a}`, `size ${a}`);
      const [, sign, num, u] = m;
      const k = Number(num);
      const unit: Record<string, [string, string]> = {
        '': ['512バイトのブロック', '512-byte blocks'], b: ['512バイトのブロック', '512-byte blocks'], c: ['バイト', 'bytes'], w: ['2バイトの単位', '2-byte words'],
        k: ['KiB', 'KiB'], M: ['MiB', 'MiB'], G: ['GiB', 'GiB'], T: ['TiB', 'TiB'], P: ['PiB', 'PiB'],
      };
      const [uj, ue] = unit[u];
      // find rounds the size UP to whole units before comparing.
      if (sign === '+') return s(`サイズが ${k} ${uj}を超える（単位に切り上げて比べる）`, `size over ${k} ${ue} (rounded up to whole units before comparing)`);
      if (sign === '-') {
        return k === 1
          ? s(`サイズが 0（空）のものだけ（\`-1${u}\` は単位に切り上げて 1 未満、つまり空ファイルだけ）`, `empty files only (\`-1${u}\`: size rounded up to ${ue} is less than 1, so only size 0)`)
          : s(`サイズが ${Math.max(k - 1, 0)} ${uj}以下（単位に切り上げて ${k} 未満）`, `size at most ${Math.max(k - 1, 0)} ${ue} (rounded up to whole units, less than ${k})`);
      }
      return s(`サイズが切り上げて ${k} ${uj}ちょうど`, `size of exactly ${k} ${ue} after rounding up to whole units`);
    }
    case '-empty': return s('空', 'empty');
    case '-user': return s(`所有者が ${a}`, `owned by ${a}`);
    case '-group': return s(`グループが ${a}`, `group ${a}`);
    case '-perm': {
      if (a.startsWith('-')) return s(`権限に ${a.slice(1)} のビットがすべて立っている（他のビットは問わない）`, `permissions include all the bits of ${a.slice(1)} (other bits do not matter)`);
      if (a.startsWith('/') || a.startsWith('+')) return s(`権限に ${a.slice(1)} のビットが1つでも立っている`, `permissions have at least one of the bits of ${a.slice(1)}`);
      return s(`権限がちょうど ${a}`, `permissions exactly ${a}`);
    }
    case '-links': {
      const k = a.replace(/^[+-]/, '');
      return a.startsWith('+') ? s(`ハードリンク数が ${k} より多い`, `more than ${k} hard links`) : a.startsWith('-') ? s(`ハードリンク数が ${k} より少ない`, `fewer than ${k} hard links`) : s(`ハードリンク数がちょうど ${k}`, `exactly ${k} hard links`);
    }
    case '-samefile': return s(`${a} と同じファイル（同じ inode）`, `the same file as ${a} (same inode)`);
    case '-maxdepth': return s(`深さ ${a} まで`, `at most ${a} level${a === '1' ? '' : 's'} deep`);
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
    default: {
      // -newerXY REF: the X time of the file is newer than the Y time of REF (or than the date, with t).
      const nm = /^-newer([acBm])([acBmt])$/.exec(p.name);
      if (nm) {
        const x: Record<string, [string, string]> = { a: ['アクセス', 'accessed'], c: ['状態変更', 'status changed'], B: ['作成', 'created'], m: ['更新', 'modified'] };
        return nm[2] === 't'
          ? s(`${x[nm[1]][0]}が ${a} より後`, `${x[nm[1]][1]} after ${a}`)
          : s(`${x[nm[1]][0]}時刻が ${a} の${x[nm[2]][0]}時刻より新しい`, `${x[nm[1]][1]} more recently than ${a} was ${x[nm[2]][1]}`);
      }
      return p.name + (a ? ` ${a}` : '');
    }
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

const GLOBAL_OPTIONS = new Set(['-maxdepth', '-mindepth', '-depth', '-xdev', '-mount', '-noleaf']);

/** A global option (`-maxdepth`) written after a test, which find warns about; undefined if none. */
function lateGlobalOption(n: FindNode): string | undefined {
  const flat: string[] = [];
  const walk = (x: FindNode) => {
    if (x.type === 'primary') flat.push(x.name);
    else if (x.type === 'not' || x.type === 'group') walk(x.child);
    else x.children.forEach(walk);
  };
  walk(n);
  const firstTest = flat.findIndex((x) => !GLOBAL_OPTIONS.has(x));
  return firstTest < 0 ? undefined : flat.slice(firstTest).find((x) => GLOBAL_OPTIONS.has(x));
}

/** One sentence for the whole expression, including find's implicit -print. */
export function describeFind(n: FindNode, lang: Lang): string {
  const s = pick(lang);
  const body = describe(n, lang);
  const pruneIdiom = n.type === 'or' && n.children[0].type === 'and'
    && n.children[0].children.some((c) => c.type === 'primary' && c.name === '-prune');
  const idiom = pruneIdiom ? s('（`-prune -o` は、特定のディレクトリを探索から除外する定番の書き方）', ' (`-prune -o` is the usual way to exclude a directory)') : '';
  const late = lateGlobalOption(n);
  const pitfall = late ? s(`（\`${late}\` は検索全体に効くオプションで、書いた位置より後の条件にだけ効くわけではない。条件より後に書くと find が警告する。先頭に書く）`, ` (\`${late}\` is a global option: it limits the whole search, not only the tests after it; find warns when it follows a test, so put it first)`) : '';
  if (hasAction(n)) return s(`検索条件と処理: ${body}${idiom}${pitfall}`, `Conditions and actions: ${body}${idiom}${pitfall}`);
  return s(`「${body}」に当てはまるものを表示する（処理の指定が無いので \`-print\` が補われる）${idiom}${pitfall}`, `Print what matches: ${body} (no action is given, so \`-print\` is implied)${idiom}${pitfall}`);
}

/** For `-name`-style patterns: what the glob means. */
export function describeFindPattern(pattern: string, lang: Lang): string | undefined {
  const parts = globParts(pattern);
  if (!parts || !parts.some((p) => p.type !== 'text')) return undefined;
  return pick(lang)('パターン: ', 'pattern: ') + describeGlob(parts, lang);
}
