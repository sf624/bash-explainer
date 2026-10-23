import type { Lang } from '../i18n';
import type { HostId } from '../hosts';
import { lex, ParseError } from './jq';
import { JQ_ONLY, YQ_ONLY } from './yqfuncs';

/** The three tools called `yq`. */
export type YqFlavor = 'mikefarah4' | 'kislyuk' | 'mikefarah3';

export const YQ_NAMES: Record<YqFlavor, [string, string]> = {
  mikefarah4: ['mikefarah/yq v4', 'mikefarah/yq v4'],
  kislyuk: ['kislyuk/yq（Python 版。jq のラッパー）', 'kislyuk/yq (the Python jq wrapper)'],
  mikefarah3: ['mikefarah/yq v3', 'mikefarah/yq v3'],
};

/** A reason for the verdict, and how strongly it points at a flavor. */
interface Clue { flavor: YqFlavor; weight: number; why: [string, string] }

/** Something the command uses, and where it works. `v4` is the first mikefarah/yq v4 release with it (null: none). */
interface Use { label: string; v4: string | null; kislyuk: boolean; v3: boolean }

export interface YqVerdict {
  flavor: YqFlavor;
  /** False when nothing pointed at a flavor and mikefarah/yq v4 was assumed. */
  decided: boolean;
  reasons: [string, string][];
  /** Per flavor: whether everything used works there, the first v4 release that has it all, and what is missing. */
  compat: Record<YqFlavor, { ok: boolean; min?: string; missing: string[] }>;
  /** Index (in the words) of the expression or path, if any. */
  expression?: number;
}

/**
 * First mikefarah/yq v4 release (of those tested: the latest patch of every 4.x minor) where each
 * feature works, measured by running the same probe on every release (see test/yq.test.ts).
 */
const V4_OPTION: Record<string, string> = {
  '-P': '4.5.1', '--prettyPrint': '4.5.1', '-I': '4.0.0', '--indent': '4.0.0', '-i': '4.0.0', '--inplace': '4.0.0',
  '-n': '4.3.2', '--null-input': '4.3.2', '-f': '4.11.2', '--front-matter': '4.11.2', '-0': '4.33.3', '--nul-output': '4.33.3',
  '-e': '4.0.0', '--exit-status': '4.0.0', '-N': '4.0.0', '--no-doc': '4.0.0', '-M': '4.0.0', '-C': '4.0.0', '-r': '4.0.0',
};
const V4_OUTPUT: Record<string, string> = {
  json: '4.12.2', j: '4.12.2', props: '4.12.2', p: '4.12.2', yaml: '4.12.2', y: '4.12.2', xml: '4.17.2', x: '4.17.2',
  csv: '4.16.2', c: '4.16.2', tsv: '4.16.2', t: '4.16.2', toml: '4.52.5', shell: '4.34.2', s: '4.34.2', lua: '4.40.7', l: '4.40.7',
};
const V4_INPUT: Record<string, string> = {
  json: '4.27.5', j: '4.27.5', xml: '4.17.2', x: '4.17.2', csv: '4.27.5', c: '4.27.5', tsv: '4.27.5', t: '4.27.5',
  toml: '4.33.3', props: '4.20.2', p: '4.20.2', ini: '4.46.1', i: '4.46.1', yaml: '4.17.2', y: '4.17.2', lua: '4.40.7', l: '4.40.7',
};
const V4_FUNCTION: Record<string, string> = {
  keys: '4.4.1', del: '4.1.0', to_entries: '4.8.0', from_entries: '4.8.0', with_entries: '4.8.0', map: '4.16.2', map_values: '4.16.2',
  sort_by: '4.16.2', sort: '4.16.2', unique: '4.9.8', unique_by: '4.9.8', group_by: '4.14.2', flatten: '4.14.2', env: '4.3.2', strenv: '4.3.2',
  envsubst: '4.18.1', load: '4.15.1', load_str: '4.17.2', pick: '4.22.1', omit: '4.43.1', split: '4.4.1', join: '4.4.1', test: '4.10.0',
  sub: '4.7.1', match: '4.10.0', capture: '4.10.0', downcase: '4.21.1', upcase: '4.21.1', to_number: '4.40.7', to_json: '4.14.2',
  to_yaml: '4.14.2', from_yaml: '4.14.2', line_comment: '4.20.2', head_comment: '4.20.2', foot_comment: '4.20.2', parent: '4.15.1',
  key: '4.15.1', kind: '4.40.7', split_doc: '4.20.2', document_index: '4.20.2', di: '4.20.2', filename: '4.3.2', eval: '4.19.1',
  shuffle: '4.31.2', min: '4.44.6', max: '4.44.6', any: '4.9.8', all: '4.9.8', reverse: '4.21.1', pivot: '4.44.6', with: '4.13.5',
  tostring: '4.43.1', to_string: '4.43.1', trim: '4.27.5', contains: '4.13.5', sort_keys: '4.16.2', now: '4.25.3', ireduce: '4.6.3',
  '@base64': '4.21.1', '@base64d': '4.21.1', '@json': '4.16.2', '@csv': '4.16.2', '@tsv': '4.16.2', '@yaml': '4.16.2', '@sh': '4.31.2',
};

/** Options only kislyuk/yq (or the jq inside it) has. */
const KISLYUK_OPTIONS = new Set([
  '-y', '--yaml-output', '--yml-output', '-Y', '--yaml-roundtrip', '--yml-roundtrip', '--indentless-lists', '--indentless',
  '--explicit-start', '--explicit-end', '-w', '--width', '--yaml-output-grammar-version', '--yml-out-ver', '-F', '--yaml-frontmatter',
  '--in-place', '-S', '--sort-keys', '--arg', '--argjson', '--slurpfile', '--rawfile', '--args', '--jsonargs', '-R', '--raw-input',
  '-a', '--ascii-output', '--tab', '--seq', '--stream', '-j', '--join-output', '--slurp',
]);
/** Options only mikefarah/yq v4 has. */
const V4_ONLY_OPTIONS = new Set([
  '-o', '--output-format', '-p', '--input-format', '-P', '--prettyPrint', '-I', '--front-matter', '-0', '--nul-output',
  '-N', '--no-doc', '--expression', '--header-preprocess', '--xml-attribute-prefix', '--xml-content-name', '--csv-separator',
  '--properties-separator', '--properties-array-brackets', '--shell-key-separator', '--lua-prefix', '--lua-suffix', '--lua-globals',
  '--lua-unquoted', '--split-exp', '--split-exp-file', '--security-disable-env-ops', '--security-disable-file-ops',
  '--security-enable-system-operator', '--string-interpolation', '--yaml-compact-seq-indent', '--inplace',
]);
/** v4 options that take a value. */
const V4_VALUE = new Set(['-o', '--output-format', '-p', '--input-format', '-I', '--indent', '-f', '--front-matter', '-s', '--split-exp', '--expression', '--from-file', '--xml-attribute-prefix', '--xml-content-name', '--csv-separator', '--properties-separator', '--shell-key-separator', '--lua-prefix', '--lua-suffix', '--split-exp-file']);
/** kislyuk/jq options that take values: name → count. */
const KISLYUK_VALUE: Record<string, number> = { '--arg': 2, '--argjson': 2, '--slurpfile': 2, '--rawfile': 2, '-w': 1, '--width': 1, '--indent': 1, '--yaml-output-grammar-version': 1, '--yml-out-ver': 1, '-L': 1, '-f': 1, '--from-file': 1 };
const V3_COMMANDS: Record<string, string> = {
  r: 'read', read: 'read', w: 'write', write: 'write', d: 'delete', delete: 'delete', m: 'merge', merge: 'merge', n: 'new', new: 'new',
  p: 'prefix', prefix: 'prefix', x: 'compare', compare: 'compare', v: 'validate', validate: 'validate',
};

const versionKey = (v: string) => v.split('.').map(Number).reduce((a, n) => a * 1000 + n, 0);
const later = (a: string, b: string) => (versionKey(a) >= versionKey(b) ? a : b);

/** Decide which yq the command is for, and where what it uses works. */
export function judgeYq(words: (string | undefined)[], ctx: { doc?: string; host?: HostId; setting?: string } = {}): YqVerdict {
  const clues: Clue[] = [];
  const uses: Use[] = [];
  const code = (w: string) => `\`${w}\``;
  let expression: number | undefined;
  let sub: string | undefined;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === undefined) continue;
    if (w === '--') { if (expression === undefined && words[i + 1] !== undefined) expression = i + 1; break; }
    if (w.startsWith('-') && w.length > 1) {
      // `--output-format=json`, `-o=json`, `-ojson`.
      const eq = /^(--?[\w-]+)=(.*)$/.exec(w);
      const attached: [string, string] | undefined = !w.startsWith('--') && /^-[opI]./.test(w) ? [w.slice(0, 2), w.slice(2)] : undefined;
      const [name, inline]: [string, string | undefined] = eq ? [eq[1], eq[2]] : attached ?? [w, undefined];
      // Options after a v3 command are not read (the loop stops there), so these are v4's or kislyuk's.
      if (KISLYUK_OPTIONS.has(name)) {
        clues.push({ flavor: 'kislyuk', weight: 3, why: [`${code(name)} は kislyuk/yq（jq）のオプション`, `${code(name)} is a kislyuk/yq (jq) option`] });
        uses.push({ label: code(name), v4: null, kislyuk: true, v3: false });
        i += KISLYUK_VALUE[name] && inline === undefined ? KISLYUK_VALUE[name] : 0;
        continue;
      }
      if (V4_ONLY_OPTIONS.has(name)) {
        const value = inline ?? (V4_VALUE.has(name) ? words[i + 1] : undefined);
        let min = V4_OPTION[name] ?? '4.0.0';
        if ((name === '-o' || name === '--output-format') && value) min = V4_OUTPUT[value] ?? '4.12.2';
        if ((name === '-p' || name === '--input-format') && value) min = V4_INPUT[value] ?? '4.17.2';
        clues.push({ flavor: 'mikefarah4', weight: 3, why: [`${code(value && inline === undefined ? `${name} ${value}` : w)} は mikefarah/yq v4 のオプション`, `${code(value && inline === undefined ? `${name} ${value}` : w)} is a mikefarah/yq v4 option`] });
        uses.push({ label: code(value && inline === undefined ? `${name} ${value}` : w), v4: min, kislyuk: false, v3: name === '-P' || name === '--prettyPrint' || name === '-I' });
        if (V4_VALUE.has(name) && inline === undefined) i++;
        continue;
      }
      if (V4_OPTION[name]) uses.push({ label: code(name), v4: V4_OPTION[name], kislyuk: ['-i', '-n', '-e', '-r', '-C', '-M'].includes(name), v3: ['-i', '-I', '-P', '-C'].includes(name) });
      if (V4_VALUE.has(name) && inline === undefined) i++;
      continue;
    }
    if (expression === undefined) {
      if (sub === undefined && V3_COMMANDS[w] && words.length > i + 1) {
        sub = w;
        clues.push({ flavor: 'mikefarah3', weight: 4, why: [`${code(w)}（${V3_COMMANDS[w]}）は mikefarah/yq v3 のサブコマンド`, `${code(w)} (${V3_COMMANDS[w]}) is a mikefarah/yq v3 subcommand`] });
        uses.push({ label: code(w), v4: null, kislyuk: false, v3: true });
        // v3: `yq r FILE PATH`; the path is the second word after the command.
        const rest = words.slice(i + 1).map((x, k) => ({ x, k: i + 1 + k })).filter(({ x }) => x !== undefined && !x.startsWith('-'));
        expression = rest[w === 'n' || w === 'new' ? 0 : 1]?.k;
        break;
      }
      if (sub === undefined && (w === 'e' || w === 'eval' || w === 'ea' || w === 'eval-all')) {
        sub = w;
        clues.push({ flavor: 'mikefarah4', weight: 4, why: [`${code(w)} は mikefarah/yq v4 のサブコマンド`, `${code(w)} is a mikefarah/yq v4 subcommand`] });
        uses.push({ label: code(w), v4: '4.0.0', kislyuk: false, v3: false });
        continue;
      }
      expression = i;
      // `yq EXPR FILE` without `eval` needs v4.18.
      if (sub === undefined) uses.push({ label: code(`yq '${w.length > 16 ? w.slice(0, 15) + '…' : w}'`), v4: '4.18.1', kislyuk: true, v3: true });
    }
  }
  // The expression itself.
  const expr = expression !== undefined ? words[expression] : undefined;
  if (expr !== undefined && !(sub && V3_COMMANDS[sub])) {
    // Function names only: not `.kind` (a field) or `$x` (a variable).
    let idents: string[] = [];
    try {
      idents = lex(expr).filter((t) => t.type === 'ident' || t.type === 'fmt').map((t) => t.text);
    } catch (e) {
      // An expression jq's lexer cannot read (an open string): no names to check (`idents` stays empty). Anything
      // else is a bug, which shows.
      /* c8 ignore next */
      if (!(e instanceof ParseError)) throw e;
    }
    for (const id of new Set(idents)) {
      // `pick([...])` and `explode(.)` are yq's; jq has functions of these names that take other arguments.
      const yqStyle = (id === 'pick' && /\bpick\s*\(\s*\[/.test(expr)) || (id === 'explode' && /\bexplode\s*\(/.test(expr));
      if (YQ_ONLY.has(id) || id === 'ireduce' || yqStyle) {
        clues.push({ flavor: 'mikefarah4', weight: 2, why: [`${code(id)} は mikefarah/yq の関数（jq にはない）`, `${code(id)} is a mikefarah/yq function (jq has none)`] });
        uses.push({ label: code(id), v4: V4_FUNCTION[id] ?? '4.0.0', kislyuk: false, v3: false });
      } else if (JQ_ONLY.has(id)) {
        clues.push({ flavor: 'kislyuk', weight: 2, why: [`${code(id)} は jq の関数（mikefarah/yq にはない）`, `${code(id)} is a jq function (mikefarah/yq has none)`] });
        uses.push({ label: code(id), v4: null, kislyuk: true, v3: false });
      } else if (V4_FUNCTION[id]) {
        uses.push({ label: code(id), v4: V4_FUNCTION[id], kislyuk: true, v3: false });
      }
    }
    if (/(^|[^.])\.\.\.(?!\.)/.test(expr)) {
      clues.push({ flavor: 'mikefarah4', weight: 2, why: ['`...` は mikefarah/yq の演算子', '`...` is a mikefarah/yq operator'] });
      uses.push({ label: '`...`', v4: '4.2.1', kislyuk: false, v3: false });
    }
    if (/\bif\b[\s\S]*\bthen\b/.test(expr)) uses.push({ label: '`if … then`', v4: '4.54.1', kislyuk: true, v3: false });
    if (/\[\s*-?\d*\s*:\s*-?\d*\s*\]/.test(expr)) uses.push({ label: '`.[m:n]`', v4: '4.53.6', kislyuk: true, v3: false });
    if (/\|=|\+=|-=/.test(expr)) uses.push({ label: '`|=`', v4: '4.3.2', kislyuk: true, v3: false });
    if (/\bas\s+\$/.test(expr)) uses.push({ label: '`as $x`', v4: '4.5.1', kislyuk: true, v3: false });
  }
  // Hints elsewhere in the file: how yq was installed.
  const doc = ctx.doc ?? '';
  const install = (re: RegExp, flavor: YqFlavor, ja: string, en: string) => {
    const m = re.exec(doc);
    if (m) clues.push({ flavor, weight: 1, why: [`同じファイルの ${code(m[0].trim().slice(0, 60))} から ${ja}`, `${code(m[0].trim().slice(0, 60))} in the same file suggests ${en}`] });
  };
  const pinned = /mikefarah\/yq[^\s'"]*?[/:@]v?([34])(?:\.\d+){0,2}/.exec(doc);
  if (pinned) clues.push({ flavor: pinned[1] === '3' ? 'mikefarah3' : 'mikefarah4', weight: 1, why: [`同じファイルの ${code(pinned[0])} から`, `from ${code(pinned[0])} in the same file`] });
  install(/\b(pip3?|pipx)\s+install\b[^\n]*\byq\b/, 'kislyuk', 'kislyuk/yq と判断', 'kislyuk/yq');
  install(/\bapt(-get)?\s+(?:-\S+\s+)*install\b[^\n]*\byq\b/, 'kislyuk', 'kislyuk/yq と判断（Debian・Ubuntu の yq パッケージは kislyuk/yq）', 'kislyuk/yq (the Debian/Ubuntu yq package is kislyuk/yq)');
  install(/\bbrew\s+install\b[^\n]*\bpython-yq\b/, 'kislyuk', 'kislyuk/yq と判断', 'kislyuk/yq');
  install(/\b(brew|snap)\s+install\b(?![^\n]*python-yq)[^\n]*\byq\b/, 'mikefarah4', 'mikefarah/yq と判断', 'mikefarah/yq');
  if (ctx.host?.ci === 'github') clues.push({ flavor: 'mikefarah4', weight: 1, why: ['GitHub Actions のランナーには mikefarah/yq v4 が入っている', 'GitHub Actions runners come with mikefarah/yq v4'] });

  let flavor: YqFlavor = 'mikefarah4';
  let decided = false;
  const reasons: [string, string][] = [];
  if (ctx.setting && ctx.setting !== 'auto' && ctx.setting in YQ_NAMES) {
    flavor = ctx.setting as YqFlavor;
    decided = true;
    reasons.push(['設定 `bashExplainer.yq.flavor` の指定', 'the `bashExplainer.yq.flavor` setting']);
  } else if (clues.length) {
    const score = (f: YqFlavor) => clues.filter((c) => c.flavor === f).reduce((a, c) => a + c.weight, 0);
    flavor = (['mikefarah4', 'kislyuk', 'mikefarah3'] as YqFlavor[]).reduce((a, b) => (score(b) > score(a) ? b : a));
    decided = true;
  }
  reasons.push(...clues.filter((c) => c.flavor === flavor).map((c) => c.why));

  const compat = {} as YqVerdict['compat'];
  for (const f of ['mikefarah4', 'kislyuk', 'mikefarah3'] as YqFlavor[]) {
    const missing = uses.filter((u) => (f === 'mikefarah4' ? u.v4 === null : f === 'kislyuk' ? !u.kislyuk : !u.v3)).map((u) => u.label);
    // v3 takes no jq-like expression at all.
    if (f === 'mikefarah3' && expr !== undefined && !(sub && V3_COMMANDS[sub])) missing.unshift(JQ_STYLE);
    const min = f === 'mikefarah4' ? uses.reduce((m, u) => (u.v4 ? later(u.v4, m) : m), '4.0.0') : undefined;
    compat[f] = { ok: !missing.length, min, missing: [...new Set(missing)] };
  }
  return { flavor, decided, reasons, compat, expression };
}

/** Marks "a jq-style expression" in the missing features of v3. */
const JQ_STYLE = '\u0000jq-style';

/** The verdict as notes: what the explanation follows, why, and where the command works. */
export function yqNotes(v: YqVerdict, lang: Lang): string[] {
  const s = (ja: string, en: string) => (lang === 'ja' ? ja : en);
  const name = (f: YqFlavor) => YQ_NAMES[f][lang === 'ja' ? 0 : 1];
  const short = (f: YqFlavor) => (f === 'kislyuk' ? 'kislyuk/yq' : name(f));
  const item = (m: string) => (m === JQ_STYLE ? s('jq 形式の式', 'jq-style expressions') : m);
  const ver = (f: YqFlavor) => (f === 'mikefarah4' && v.compat.mikefarah4.min && v.compat.mikefarah4.min !== '4.0.0' ? s(`（v${v.compat.mikefarah4.min} 以降）`, ` (v${v.compat.mikefarah4.min} or later)`) : '');
  const head = v.decided
    ? s(`yq: ${name(v.flavor)}${ver(v.flavor) || (name(v.flavor).endsWith('）') ? '' : ' ')}として解説。根拠: ${v.reasons.map((r) => r[0]).join('、')}`, `yq: explained as ${name(v.flavor)}${ver(v.flavor)}. Because: ${v.reasons.map((r) => r[1]).join('; ')}`)
    : s(`yq: どの yq か判定できないため、${name('mikefarah4')}${ver('mikefarah4') || ' '}として解説（利用者が多いため）`, `yq: which yq this is cannot be told, so it is explained as ${name('mikefarah4')}${ver('mikefarah4')} (the most common one)`);
  const compat = (['mikefarah4', 'kislyuk', 'mikefarah3'] as YqFlavor[]).map((f) => {
    const c = v.compat[f];
    if (c.ok) {
      const extra = f === 'kislyuk' && v.flavor !== 'kislyuk' ? s('。出力は JSON（YAML にするには `-y`）', '; output is JSON (`-y` for YAML)') : '';
      return `${short(f)}${f === 'mikefarah4' ? ver(f) : ''} ✓${extra}`;
    }
    const list = c.missing.slice(0, 2).map(item);
    return `${short(f)} ✗${s(`（${list.join('・')} が使えない）`, ` (no ${list.join(', ')})`)}`;
  });
  return [head, s(`互換性: ${compat.join(' ／ ')}`, `Works with: ${compat.join(' / ')}`)];
}

/** Explain a mikefarah/yq v3 path such as `a.b[0].c`, `a.(name==x).c`, `a.**` or `a.[+]`. */
export function explainYq3Path(src: string, lang: Lang): { tokens: import('./types').EmbeddedToken[] } | undefined {
  const s = (ja: string, en: string) => (lang === 'ja' ? ja : en);
  const tokens: import('./types').EmbeddedToken[] = [];
  let i = 0;
  while (i < src.length) {
    if (src[i] === '.') {
      tokens.push({ start: i, end: i + 1, kind: 'operator', children: [], explanation: s('`.`: 1段下の階層へ', '`.`: one level down') });
      i++;
      continue;
    }
    let m: RegExpExecArray | null;
    const rest = src.slice(i);
    let len = 0;
    let kind: import('./types').EmbeddedToken['kind'] = 'variable';
    let expl = '';
    if ((m = /^\[(\d+)\]/.exec(rest))) { len = m[0].length; expl = s(`配列の ${Number(m[1]) + 1} 番目の要素（0 始まり）`, `element ${m[1]} of the array (from 0)`); }
    else if ((m = /^\[\*\]/.exec(rest))) { len = 3; kind = 'pattern'; expl = s('配列のすべての要素', 'every element of the array'); }
    else if ((m = /^\[\+\]/.exec(rest))) { len = 3; kind = 'operator'; expl = s('配列の末尾に追加する位置（write で使う）', 'a new element at the end of the array (for write)'); }
    else if ((m = /^\(\.==([^)]*)\)/.exec(rest))) { len = m[0].length; kind = 'pattern'; expl = s(`値が \`${m[1]}\` の要素`, `the elements equal to \`${m[1]}\``); }
    else if ((m = /^\(([^)]*?)(==|!=)([^)]*)\)/.exec(rest))) { len = m[0].length; kind = 'pattern'; expl = s(`\`${m[1]}\` が \`${m[3]}\` ${m[2] === '==' ? 'に一致する' : 'でない'}要素（\`*\` はワイルドカード）`, `the elements whose \`${m[1]}\` ${m[2] === '==' ? 'matches' : 'does not match'} \`${m[3]}\` (\`*\` is a wildcard)`); }
    else if ((m = /^\*\*/.exec(rest))) { len = 2; kind = 'pattern'; expl = s('`**`: 任意の深さのすべての子孫', '`**`: every descendant at any depth'); }
    else if ((m = /^"([^"]*)"/.exec(rest))) { len = m[0].length; expl = s(`キー \`${m[1]}\`（\`.\` を含むキーはクォートする）`, `the key \`${m[1]}\` (keys containing \`.\` are quoted)`); }
    else if ((m = /^[^.[(]+/.exec(rest))) {
      len = m[0].length;
      if (m[0].includes('*')) { kind = 'pattern'; expl = s(`\`${m[0]}\` に一致するキー（\`*\` はワイルドカード）`, `keys matching \`${m[0]}\` (\`*\` is a wildcard)`); }
      else expl = s(`キー \`${m[0]}\``, `the key \`${m[0]}\``);
    }
    if (!len) return undefined;
    tokens.push({ start: i, end: i + len, kind, children: [], explanation: expl });
    i += len;
  }
  return tokens.length ? { tokens } : undefined;
}

/**
 * Operations that behave in mikefarah/yq v4 as in jq (compared with the yq release in
 * test/yq.test.ts), so the jq runner can show what the expression does.
 */
const SAME_AS_JQ = new Set(['select', 'map', 'has', 'length', 'to_entries', 'with_entries', 'from_entries', 'sort', 'sort_by', 'unique', 'unique_by',
  'group_by', 'flatten', 'split', 'join', 'test', 'any', 'all', 'reverse', 'contains', 'del', 'not', 'min', 'max', 'map_values', 'type', 'tostring']);

/** Whether the jq runner shows what this mikefarah/yq v4 expression does. */
export function yqSameAsJq(expr: string): boolean {
  let toks;
  try {
    toks = lex(expr);
  } catch (e) {
    // An expression jq's lexer cannot read: not shown. Anything else is a bug, which shows.
    if (e instanceof ParseError) return false;
    /* c8 ignore next */
    throw e;
  }
  if (toks.some((t) => t.type === 'fmt' || t.type === 'kw' && !['and', 'or', 'as'].includes(t.text))) return false;
  if (toks.some((t) => t.type === 'op' && t.text === '...')) return false;
  return toks.filter((t) => t.type === 'ident').every((t) => SAME_AS_JQ.has(t.text) || t.text === 'true' || t.text === 'false' || t.text === 'null');
}
