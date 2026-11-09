import type { Lang } from '../i18n';
import { codeSpan } from '../label';
import { tokenSaid } from '../messages-tokens';
import { type EmbeddedToken, hasHole, holeTokens, isHole, pick } from './types';

// bazel's target patterns, as `bazel help target-syntax` of bazel 9.3.2 describes them, each form checked with that release
// (test/fixtures/oracles/bazel.json, `patterns`, which test/bazel-patterns.test.ts resolves with `parseTargetPattern` over the
// fixture workspace): `//pkg:name`, `//pkg` (`//pkg:pkg`), the wildcards `:all` (the rules), `:*` and `:all-targets` (rules
// and files), `/...` (every package below), the forms relative to the current directory (`:foo`, `bar:wiz`, `...`), a
// repository before `//` (`@repo`, `@@canonical`; `@repo` alone is `@repo//:repo`), and a subtractive `-`, which takes
// targets out of those of the patterns before it (after `--`: before it, bazel reads the word as an option).

/** A wildcard after `:`: `all` takes the rules of a package, `*` and `all-targets` its files too. */
export type TargetWildcard = 'rules' | 'targets';

/** What bazel refuses in a pattern: a name after `...`, a `.` or `..` directory, a stray `/`, an empty name. */
export type TargetRefusal = 'dots-name' | 'dot-dir' | 'slash' | 'empty-name';

/** A target pattern read; the offsets are into its text. */
export interface TargetPattern {
  /** `-` before it. */
  negative: boolean;
  /** `@name` or `@@name` (canonical) before `//`: `name` '' is the main repository. */
  repo?: { name: string; canonical: boolean; at: [number, number] };
  /** From the top of a repository (`//`); else relative to the current directory. */
  absolute: boolean;
  /** The package's directories ('' at the top); with `recursive`, the directory below which. `at`: as written, with `//`. */
  pkg: string;
  pkgAt: [number, number];
  /** `/...` (or `...`): every package in the directory and below; `dotsAt`, where it is written. */
  recursive: boolean;
  dotsAt?: [number, number];
  /** The target's name; written after `:` (`nameAt`, from the `:`), or the last directory's (`//app`: `app`). */
  name?: string;
  nameAt?: [number, number];
  wildcard?: TargetWildcard;
  /** A relative pattern with no `:` (`main`, `a/b`): the target of the longest leading part that is a package. */
  ambiguous?: boolean;
  refused?: { why: TargetRefusal; at: [number, number] };
}

// (A repository's name: letters, digits and `._+~-`; a hole may stand in it.)
const REPO_CHAR = /[A-Za-z0-9._+~\-﷒-﷯]/;

/** Read a target pattern; undefined where the text is none (empty, blanks in it, `@repo` not followed by `//`). */
export function parseTargetPattern(text: string): TargetPattern | undefined {
  if (!text || /\s/.test(text)) return undefined;
  const negative = text[0] === '-';
  let i = negative ? 1 : 0;
  let repo: TargetPattern['repo'];
  if (text[i] === '@') {
    const canonical = text[i + 1] === '@';
    let j = i + (canonical ? 2 : 1);
    while (j < text.length && REPO_CHAR.test(text[j])) j++;
    const name = text.slice(i + (canonical ? 2 : 1), j);
    repo = { name, canonical, at: [i, j] };
    // (`@repo` alone: the target named like the repository, in its top package.)
    if (j === text.length && name) return { negative, repo, absolute: true, pkg: '', pkgAt: [j, j], recursive: false, name };
    if (!text.startsWith('//', j)) return undefined;
    i = j;
  }
  const absolute = text.startsWith('//', i);
  const start = i;
  if (absolute) i += 2;
  const colon = text.indexOf(':', i);
  const end = colon < 0 ? text.length : colon;
  const written = text.slice(i, end);
  const recursive = written === '...' || written.endsWith('/...');
  const pkg = recursive ? written.slice(0, Math.max(0, written.length - 4)) : written;
  const pkgEnd = i + pkg.length;
  if (!absolute && !pkg && !recursive && colon < 0) return undefined;
  const p: TargetPattern = { negative, ...(repo ? { repo } : {}), absolute, pkg, pkgAt: [start, pkgEnd], recursive };
  if (recursive) p.dotsAt = [pkgEnd, end];
  if (colon >= 0) {
    p.name = text.slice(colon + 1);
    p.nameAt = [colon, text.length];
    if (p.name === 'all') p.wildcard = 'rules';
    else if (p.name === '*' || p.name === 'all-targets') p.wildcard = 'targets';
  } else if (recursive) p.wildcard = 'rules';
  else if (absolute) {
    // (`//` alone, or `@repo//`, names no target.)
    if (!pkg) return undefined;
    p.name = pkg.slice(pkg.lastIndexOf('/') + 1);
  } else {
    p.name = pkg.slice(pkg.lastIndexOf('/') + 1);
    p.ambiguous = true;
  }
  const dirs = pkg ? pkg.split('/') : [];
  if (pkg.startsWith('/') || pkg.endsWith('/') || dirs.includes('')) p.refused = { why: 'slash', at: [start, pkgEnd] };
  else if (dirs.some((d) => d === '.' || d === '..')) p.refused = { why: 'dot-dir', at: [start, pkgEnd] };
  else if (p.nameAt && p.name === '') p.refused = { why: 'empty-name', at: p.nameAt };
  else if (recursive && p.nameAt && !p.wildcard) p.refused = { why: 'dots-name', at: p.nameAt };
  return p;
}

/** How a pattern is read: by a command whose wildcards leave out the `manual` targets (`build`), or by one that takes them (`query`). */
export type TargetFlavor = 'build' | 'query';

/**
 * The languages of target patterns, and how each reads them: the patterns of a command that builds (build, test, coverage,
 * run, fetch, vendor), the words of a query and a cquery expression, which take the `manual` targets, and those of an aquery
 * expression, which leaves them out as a build does (each checked with bazel 9.3.2: test/bazel-patterns.test.ts).
 */
export const TARGET_FLAVORS = { bazeltarget: 'build', bazelquery: 'query', bazelcquery: 'query', bazelaquery: 'build' } as const satisfies Record<string, TargetFlavor>;

/** The pattern's label as bazel writes it (`@repo//app:main`), for one target. */
export function labelOf(p: TargetPattern): string {
  const repo = p.repo ? `${p.repo.canonical ? '@@' : '@'}${p.repo.name}` : '';
  return `${repo}${p.absolute ? '//' : ''}${p.pkg}:${p.name}`;
}

/** Explain a target pattern: its parts, and what it selects. `query`: an unquoted word of a query expression, which a value can end (src/embedded/bazelquery.ts). */
export function explainTargetPattern(text: string, lang: Lang, flavor: TargetFlavor, query = false): { tokens: EmbeddedToken[]; note?: string } | undefined {
  const p = parseTargetPattern(text);
  if (!p) return undefined;
  const s = pick(lang);
  const tokens: EmbeddedToken[] = [];
  const holes = hasHole(text);
  // (A hole where the reading starts would decide it: `"$p/..."` may be absolute or relative, `"@$r//x"` any repository.)
  const at = p.negative ? 1 : 0;
  if (holes && (isHole(text[at]) || (p.repo && hasHole(text.slice(...p.repo.at))))) return { tokens: [] };
  // (A hole in the package's path, or in the target's name after `:`, which bazel reads apart: `/` and `...` are the package's.)
  const push = ([start, end]: [number, number], kind: EmbeddedToken['kind'], explanation: string, place: 'target-package' | 'target-name' = 'target-package'): void => {
    if (end > start) tokens.push({ start, end, kind, explanation, children: holeTokens(text, start, end, place, query ? { query } : {}) });
  };
  if (p.negative) push([0, 1], 'operator', s('除くパターン: このパターンのターゲットを、前のパターンで集めたターゲットから除く（順序に意味がある）', 'Subtractive: takes the targets of this pattern out of those the patterns before it gave (the order counts)'));
  if (p.repo) {
    const { name, canonical } = p.repo;
    push(p.repo.at, 'keyword', !name ? s(`メインのリポジトリ${canonical ? '（正規の名前が空のリポジトリ）' : ''}`, `The main repository${canonical ? ' (its canonical name is empty)' : ''}`)
      : canonical ? s(`正規の名前が ${codeSpan(name)} のリポジトリ`, `The repository whose canonical name is ${codeSpan(name)}`)
        : s(`リポジトリ ${codeSpan(name)}（メインのモジュールから見える名前。メインのモジュール自身の名前ならメインのリポジトリ）`, `The repository ${codeSpan(name)} (the name the main module sees it by; the main module's own name is the main repository)`));
  }
  const pkg = codeSpan(p.pkg);
  const ambiguous = (): string => {
    const [dir, last] = [p.pkg.slice(0, Math.max(0, p.pkg.lastIndexOf('/'))), p.name!];
    const instead = codeSpan(`${dir}:${last}`);
    return s(`今のディレクトリの下のパッケージ ${pkg} があれば、そのターゲット ${codeSpan(last)}（${codeSpan(`${p.pkg}:${last}`)}）。なければ、パッケージである最も長い前の部分の、残りを名前とするターゲット（${instead} など）`,
      `If ${pkg} below the current directory is a package, its target ${codeSpan(last)} (${codeSpan(`${p.pkg}:${last}`)}); else the target of the longest leading part that is a package, named by the rest (${instead} and so on)`);
  };
  if (p.refused?.why === 'slash' || p.refused?.why === 'dot-dir') {
    push(p.refused.at, 'error', p.refused.why === 'slash'
      ? s('パッケージの名前は `/` で始まったり終わったりできず、`//` も含められない。bazel は「invalid package name」で止まる', 'A package name cannot start or end with `/`, nor hold `//`: bazel stops with "invalid package name"')
      : s('パッケージの名前に `.`・`..` のディレクトリは書けない（今のディレクトリより上は指せない）。bazel は「invalid package name」で止まる', 'A package name cannot hold a `.` or `..` directory (nothing above the current directory can be named): bazel stops with "invalid package name"'));
  } else if (p.ambiguous) push(p.pkgAt, 'string', ambiguous());
  else if (p.absolute) {
    push(p.pkgAt, 'string', !p.pkg ? s('リポジトリの最上位', 'The top of the repository')
      : p.recursive ? s(`リポジトリの最上位からのディレクトリ ${pkg}`, `The directory ${pkg}, from the top of the repository`)
        : s(`パッケージ ${pkg}（リポジトリの最上位からのディレクトリ）`, `The package ${pkg} (its directory from the top of the repository)`));
  } else {
    push(p.pkgAt, 'string', p.recursive ? s(`今のディレクトリの下のディレクトリ ${pkg}`, `The directory ${pkg} below the current directory`)
      : s(`今のディレクトリの下のパッケージ ${pkg}`, `The package ${pkg} below the current directory`));
  }
  if (p.dotsAt) {
    push(p.dotsAt, 'operator', p.pkg || p.absolute ? s('このディレクトリとその下のすべてのパッケージ', 'Every package in this directory and below it')
      : s('今のディレクトリとその下のすべてのパッケージ', 'Every package in the current directory and below it'));
  }
  if (p.nameAt) {
    const why = p.refused && p.refused.at === p.nameAt ? p.refused.why : undefined;
    push(p.nameAt, why ? 'error' : p.wildcard ? 'operator' : 'string', hasHole(p.name!) ? s('ターゲットの名前（`:` の後）', 'The target\'s name (after `:`)')
      : why === 'empty-name' ? s('`:` の後に名前がない。bazel は「empty target name」で止まる', 'No name after `:`: bazel stops with "empty target name"')
      : why === 'dots-name' ? s('`...` の後には `:all`・`:*`・`:all-targets` だけを書ける。bazel は「\'...\' can only be used with wildcard targets」で止まる', 'After `...`, only `:all`, `:*` or `:all-targets` may stand: bazel stops with "\'...\' can only be used with wildcard targets"')
        : p.wildcard === 'rules' ? s(`${p.recursive ? '各' : ''}パッケージのすべてのルール（ファイルは含まない）`, `Every rule of ${p.recursive ? 'each' : 'the'} package (no files)`)
          : p.wildcard === 'targets' ? s(`${p.recursive ? '各' : ''}パッケージのすべてのターゲット（ルールとファイル）`, `Every target of ${p.recursive ? 'each' : 'the'} package: its rules and its files`)
            : s(`ターゲット ${codeSpan(p.name!)}`, `The target ${codeSpan(p.name!)}`), 'target-name');
  }
  // (With a hole, what the pattern selects depends on the value: only its parts are said.)
  if (holes || p.refused) return { tokens };
  const note = noteOf(p, lang, flavor, p.ambiguous ? ambiguous() : undefined);
  // (A word that is one part says it on the word.)
  return tokens.length === 1 && tokens[0].start === 0 && tokens[0].end === text.length ? { tokens: [], note } : { tokens, note };
}

/** Where no name is written (`//app`, `@repo`): whose name the target has. */
function implied(p: TargetPattern, lang: Lang): string {
  const s = pick(lang);
  if (p.nameAt) return '';
  return p.pkg ? s('（パッケージと同じ名前のターゲット）', ' (the target named like the package)')
    : s('（最上位のパッケージの、リポジトリと同じ名前のターゲット）', ' (the target named like the repository, in its top package)');
}

/** `a` and then `b`, with the blank Japanese text puts between a code span and a word after it. */
const then = (a: string, b: string): string => (a.endsWith('`') ? `${a} ${b}` : a + b);

/** What the pattern selects, said on the whole word (`ambiguous`: what a relative pattern with no `:` names). */
function noteOf(p: TargetPattern, lang: Lang, flavor: TargetFlavor, ambiguous: string | undefined): string {
  const s = pick(lang);
  if (ambiguous) {
    return p.negative ? s(`1つのターゲットを、前のパターンのターゲットから除く。${ambiguous}`, `Takes one target out of the targets of the patterns before it. ${ambiguous}`)
      : s(`1つのターゲット。${ambiguous}`, `One target. ${ambiguous}`);
  }
  const pkg = codeSpan(p.pkg);
  // (The repository, where one is named: a label names it itself.)
  const name = p.repo?.name ? codeSpan(`${p.repo.canonical ? '@@' : '@'}${p.repo.name}`) : undefined;
  const of = name ? s(`リポジトリ ${name} の`, ` of the repository ${name}`) : '';
  // (The top package has no name to show: `//:all`.)
  const top = s(`リポジトリ${name ? ` ${name} ` : ''}の最上位のパッケージ`, `the top package of the repository${name ? ` ${name}` : ''}`);
  const where = p.absolute ? (p.pkg ? s(`${of}パッケージ ${pkg}`, `the package ${pkg}${of}`) : top) : p.pkg ? s(`今のディレクトリの下のパッケージ ${pkg}`, `the package ${pkg} below the current directory`)
    : s('今のディレクトリのパッケージ', 'the package of the current directory');
  const below = p.pkg ? s(then(`${of}ディレクトリ ${pkg}${p.absolute ? '' : '（今のディレクトリから）'}`, 'とその下のパッケージ'), `the packages in the directory ${pkg}${of}${p.absolute ? '' : ' (from the current directory)'} and below`)
    : p.absolute ? s(`${name ? `リポジトリ ${name} ` : 'リポジトリ'}のすべてのパッケージ`, `every package of the repository${name ? ` ${name}` : ''}`) : s('今のディレクトリとその下のパッケージ', 'the packages in the current directory and below');
  const within = p.recursive ? below : where;
  const label = codeSpan(labelOf(p));
  const what = p.wildcard === 'rules' ? s(then(within, 'のすべてのルール'), `every rule of ${within}`)
    : p.wildcard === 'targets' ? s(then(within, 'のすべてのターゲット（ルールとファイル）'), `every target of ${within} (rules and files)`)
      : p.negative ? s(`ターゲット ${label}${p.absolute ? '' : '（今のディレクトリから）'}`, `the target ${label}${p.absolute ? '' : ' (from the current directory)'}`) + (p.absolute ? implied(p, lang) : '')
        : p.absolute ? s(`1つのターゲット ${label}`, `one target, ${label}`) + implied(p, lang) : s(`今のディレクトリからの1つのターゲット ${label}`, `one target, ${label} from the current directory`);
  if (p.negative) return s(then(what, 'を、前のパターンのターゲットから除く'), `Takes ${what} out of the targets of the patterns before it`);
  // (`manual` targets: left out of the wildcards of a command that builds, `bazel build //app/...`; a query takes them.)
  const manual = p.wildcard && flavor === 'build' ? s('。', '; ') + tokenSaid(lang, 'bazel-manual-wildcard') : '';
  return `${lang === 'ja' ? what : what[0].toUpperCase() + what.slice(1)}${manual}`;
}
