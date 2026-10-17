import type { Lang } from '../i18n';
import { EmbeddedToken, pick } from './types';

type S = (ja: string, en: string) => string;

const WHO: Record<string, [string, string]> = {
  u: ['所有者', 'the owner'], g: ['グループ', 'the group'], o: ['その他のユーザー', 'others'], a: ['全員', 'everyone'],
};

function permWords(d: number, s: S): string {
  const w = [d & 4 && s('読み', 'read'), d & 2 && s('書き', 'write'), d & 1 && s('実行', 'execute')].filter(Boolean);
  return w.length ? w.join(s('・', '/')) : s('なし', 'none');
}

function rwx(mode: number): string {
  const bits = 'rwxrwxrwx';
  let out = '';
  for (let i = 0; i < 9; i++) out += mode & (1 << (8 - i)) ? bits[i] : '-';
  return out;
}

/** `rwxr-xr-x` with setuid/setgid/sticky shown as s/s/t. */
function rwxWithSpecial(mode: number): string {
  const r = rwx(mode).split('');
  if (mode & 0o4000) r[2] = r[2] === 'x' ? 's' : 'S';
  if (mode & 0o2000) r[5] = r[5] === 'x' ? 's' : 'S';
  if (mode & 0o1000) r[8] = r[8] === 'x' ? 't' : 'T';
  return r.join('');
}

export interface ModeResult {
  tokens: EmbeddedToken[];
  note?: string;
}

/** Explain a chmod/mkdir -m mode (octal or symbolic). */
export function explainMode(src: string, lang: Lang): ModeResult | undefined {
  const s = pick(lang);
  if (/^[0-7]{1,4}$/.test(src)) return octal(src, s, false);
  return symbolic(src, s);
}

/** Explain a umask value: the permission bits it removes from new files and directories. */
export function explainUmask(src: string, lang: Lang): ModeResult | undefined {
  const s = pick(lang);
  if (/^[0-7]{1,4}$/.test(src)) return octal(src, s, true);
  const sym = symbolic(src, s);
  if (sym) sym.note = s('記号で指定した場合は「新規作成時に許可する権限」を表す', 'in symbolic form it sets the permissions that new files may have');
  return sym;
}

function octal(src: string, s: S, umask: boolean): ModeResult {
  const digits = src.padStart(3, '0').split('').map(Number);
  const offset = src.length - digits.length; // negative when padded
  const tokens: EmbeddedToken[] = [];
  const special = digits.length === 4 ? digits[0] : 0;
  const triplet = digits.slice(-3);
  const who = [s('所有者', 'owner'), s('グループ', 'group'), s('その他', 'others')];
  if (digits.length === 4 && offset >= 0) {
    const bits = [
      special & 4 && s('setuid（4: 実行時に所有者の権限で動く）', 'setuid (4: runs with the owner\'s privileges)'),
      special & 2 && s('setgid（2: グループの権限で動く。ディレクトリなら中のファイルがグループを継承）', 'setgid (2: runs with the group\'s privileges; in a directory, new files inherit the group)'),
      special & 1 && s('スティッキービット（1: ディレクトリ内のファイルは所有者しか削除できない。/tmp など）', 'sticky bit (1: in a directory, only owners can delete files, as in /tmp)'),
    ].filter(Boolean);
    tokens.push({
      start: 0, end: 1, kind: 'number', children: [],
      explanation: special
        ? s(`\`${special}\`: 特殊ビット ${bits.join('、')}`, `\`${special}\`: special bits ${bits.join(', ')}`)
        : s('`0`: 特殊ビット（setuid / setgid / スティッキー）なし', '`0`: no special bits (setuid/setgid/sticky)'),
    });
  }
  triplet.forEach((d, k) => {
    const pos = src.length - 3 + k;
    if (pos < 0) return;
    tokens.push({
      start: pos, end: pos + 1, kind: 'number', children: [],
      explanation: umask
        ? s(`\`${d}\`: ${who[k]}から外す権限: ${permWords(d, s)}`, `\`${d}\`: removed from ${who[k]}: ${permWords(d, s)}`)
        : s(`\`${d}\`: ${who[k]}の権限: ${permWords(d, s)}${k === 0 ? '（4=読み、2=書き、1=実行 の合計）' : ''}`, `\`${d}\`: ${who[k]} may ${permWords(d, s)}${k === 0 ? ' (4=read, 2=write, 1=execute, added up)' : ''}`),
    });
  });
  const value = parseInt(src, 8);
  if (umask) {
    const file = 0o666 & ~value;
    const dir = 0o777 & ~value;
    const o = (n: number) => n.toString(8).padStart(3, '0');
    return { tokens, note: s(`新しいファイルは ${o(file)} (${rwx(file)})、ディレクトリは ${o(dir)} (${rwx(dir)}) になる`, `new files get ${o(file)} (${rwx(file)}), directories ${o(dir)} (${rwx(dir)})`) };
  }
  return { tokens, note: `${rwxWithSpecial(value)}` };
}

function symbolic(src: string, s: S): ModeResult | undefined {
  const tokens: EmbeddedToken[] = [];
  let pos = 0;
  for (const clause of src.split(',')) {
    // `o=u` copies another class's bits, so `[ugo]` must be tried before the (possibly empty) letter list.
    const m = /^([ugoa]*)((?:[-+=](?:[ugo](?![rwxXst])|[rwxXst]*))+)$/.exec(clause);
    if (!m) return undefined;
    const who = m[1] ? m[1].split('').map((c) => s(WHO[c][0], WHO[c][1])).join(s('と', ' and ')) : s('全員（umask で外される分を除く）', 'everyone (minus what umask removes)');
    const actions: string[] = [];
    for (const [, op, perms] of m[2].matchAll(/([-+=])([ugo](?![rwxXst])|[rwxXst]*)/g)) {
      const names = /^[ugo]$/.test(perms)
        ? [s(`${WHO[perms][0]}と同じ権限`, `the same permissions as ${WHO[perms][1]}`)]
        : perms.split('').map((p) => ({
          r: s('読み取り', 'read'), w: s('書き込み', 'write'), x: s('実行', 'execute'),
          X: s('実行（ディレクトリか、既に誰かが実行可能なファイルのみ）', 'execute (directories, or files already executable by someone)'),
          s: s('setuid/setgid', 'setuid/setgid'), t: s('スティッキービット', 'the sticky bit'),
        }[p]!));
      const list = names.join(s('・', ', '));
      actions.push(op === '+' ? s(`${list}権限を追加する`, `add ${list}`)
        : op === '-' ? s(`${list}権限を外す`, `remove ${list}`)
          : /^[ugo]$/.test(perms) ? s(`権限を${list}にする`, `set ${list}`)
          : perms ? s(`権限を${list}だけにする`, `set exactly ${list}`) : s('権限をすべて外す', 'remove all permissions'));
    }
    tokens.push({
      start: pos, end: pos + clause.length, kind: 'operator', children: [],
      explanation: s(`\`${clause}\`: ${who}に対して${actions.join('、')}`, `\`${clause}\`: for ${who}, ${actions.join(', then ')}`),
    });
    pos += clause.length + 1;
  }
  return { tokens };
}
