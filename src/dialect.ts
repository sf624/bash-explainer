import { interpret } from './argv/interpret';
import { BASH_VERSIONS, type BashVersion, DEFAULT_BASH_VERSION, earlier, lacks, laterOption, laterShellOption, SHELL_OPTIONS_SINCE, SINCE, unclosedBrace } from './bashversion';
import { givenOptions, has, operands, values } from './argv/query';
import { argWord } from './argv/words';
import { builtins } from './dict/builtins';
import { pick } from './embedded/types';
import { parseExpansion } from './expansion';
import { Lang } from './i18n';
import { marked, type Note, plainNote, PORTABILITY } from './messages';
import { ancestor, braceKind, braceTakenAsWord, childrenOnRows, descendants, field, fields, prefixAssignments, substitutionForm, wordBraces } from './syntax/tree';
import { networkPath, networkTarget } from './dict/syntax';
import { bracesInContext } from './semantics/words';
import { staticWordValue } from './staticword';
import { FEATURES, featureWorks, LETTER, type RealShell, type Shell, works } from './shellfeatures';
import type { Point, SyntaxNode, SyntaxTree } from './syntax/tree';
import { bracketWords, writtenAsBracket } from './testexpr';

// (The shells and the table of features are in src/shellfeatures.ts, a leaf module that src/staticword.ts reads too.)
export { bracesWork, FEATURES, featureWorks, type Shell } from './shellfeatures';

export const SHELL_NAMES: Record<Shell, string> = {
  bash: 'bash', sh: 'POSIX sh', dash: 'dash', ash: 'busybox ash', yash: 'yash', ksh: 'ksh93', mksh: 'mksh', zsh: 'zsh',
};

/** The shell a script is written for, from its shebang, a ShellCheck directive or its file name. */
export function detectShell(text: string, fileName = ''): Shell | undefined {
  const head = text.slice(0, 2000);
  const directive = /^#\s*shellcheck\s+shell=(\w+)/m.exec(head)?.[1];
  if (directive) return shellFromName(directive);
  const shebang = /^#!\s*(.*)/.exec(head);
  if (shebang) {
    const words = shebang[1].trim().split(/\s+/);
    const prog = words[0].split('/').pop()!;
    // `#!/bin/busybox sh`, `#!/usr/bin/env bash`, `#!/usr/bin/env -S ksh93 -e`.
    if (prog === 'env') {
      const arg = words.slice(1).find((w) => !w.startsWith('-') && !w.includes('='));
      return arg ? shellFromName(arg.split('/').pop()!) : undefined;
    }
    return shellFromName(prog);
  }
  const base = fileName.split(/[\\/]/).pop()!;
  if (/\.zsh$|^\.?z(shrc|profile|login|logout|shenv)$/.test(base)) return 'zsh';
  if (/\.ksh$|^\.?mkshrc$/.test(base)) return base.includes('mksh') ? 'mksh' : 'ksh';
  if (/\.bash$|^\.?bash(rc|_profile|_login|_logout|_aliases)$/.test(base)) return 'bash';
  return undefined;
}

/** The shell a program name stands for (`dash`, `ksh93`, `lksh`, `busybox`, `posh`…); the one mapping every reader uses. */
export function shellFromName(name: string): Shell | undefined {
  const n = name.replace(/\d+(\.\d+)*$/, '');
  if (n === 'bash' || restrictedByName(n)) return 'bash';
  if (n === 'sh' || n === 'posh') return 'sh';
  if (n === 'dash') return 'dash';
  if (n === 'ash' || n === 'busybox') return 'ash';
  if (n === 'yash') return 'yash';
  if (n === 'ksh') return 'ksh';
  if (n === 'mksh' || n === 'lksh' || n === 'pdksh' || n === 'oksh') return 'mksh';
  if (n === 'zsh') return 'zsh';
  return undefined;
}

/** Whether bash started with this program name is a restricted shell: `rbash` (Bash manual 6.10), as `bash -r`. */
export function restrictedByName(name: string): boolean {
  return name.slice(name.lastIndexOf('/') + 1) === 'rbash';
}

/**
 * Constructs that work everywhere but behave differently from bash in some shells (the letters
 * in `differs`, measured like FEATURES).
 */
interface Behaviour { differs: string; ja: (shell: string) => string; en: (shell: string) => string }

export const BEHAVIOURS: Record<string, Behaviour> = {
  echoEscape: {
    differs: 'dymz',
    ja: (sh) => `${sh} の \`echo\` は引数の \`\\t\` や \`\\n\` などを解釈します（bash は文字のまま表示）。どちらでも同じにするには \`printf\` を使います。`,
    en: (sh) => `${sh}'s \`echo\` interprets \`\\t\`, \`\\n\` and the like in its arguments (bash prints them as they are). Use \`printf\` to get the same result everywhere.`,
  },
  wordSplit: {
    differs: 'z',
    ja: (sh) => `${sh} ではクォートしない \`$変数\` も単語分割・グロブ展開されません（bash では空白で分かれます）。`,
    en: (sh) => `In ${sh} an unquoted \`$var\` is not split into words or globbed (bash splits it on spaces).`,
  },
  typesetScope: {
    differs: 'k',
    ja: (sh) => `${sh} では \`name() { … }\` の形の関数の中の \`typeset\` はローカル変数になりません（グローバル変数を変更します）。ローカルにするには \`function name { … }\` の形で定義します。`,
    en: (sh) => `In ${sh}, \`typeset\` inside a function written \`name() { … }\` does not make a local variable (it changes the global one); define the function as \`function name { … }\` for local scope.`,
  },
  arrayBase: {
    differs: 'yz',
    ja: (sh) => `${sh} の配列の添字は 1 から始まります（bash は 0 から）。この解説は bash の数え方です。`,
    en: (sh) => `Array subscripts start at 1 in ${sh} (bash starts at 0); this explanation counts the bash way.`,
  },
};

/** A construct found in the tree: what it is, and the node where it starts. */
export interface Found { id: string; node: SyntaxNode }

/** Calls `check` for every node starting on lines [from, to]. */
function walk(root: SyntaxNode, from: number, to: number, check: (n: SyntaxNode) => void): void {
  const visit = (n: SyntaxNode) => {
    if (n.startPosition.row > to || n.endPosition.row < from) return;
    if (n.startPosition.row >= from) check(n);
    childrenOnRows(n.children, from, to).forEach(visit);
  };
  visit(root);
}

/** Behaviours used on lines [from, to] (see BEHAVIOURS). */
export function collectBehaviours(root: SyntaxNode, from: number, to: number): Found[] {
  const found: Found[] = [];
  walk(root, from, to, (n) => {
    const add = (id: string) => found.push({ id, node: n });
    if (n.type === 'command' && field(n, 'name')?.text === 'echo'
      && n.namedChildren.slice(1).some((a) => /\\[abcefnrtv\\0]/.test(a.type === 'raw_string' ? a.text : a.type === 'string' ? a.text.replace(/\\\\/g, '\\') : ''))) add('echoEscape');
    // An unquoted `$var` used as a word of a command.
    if (n.type === 'simple_expansion' && (n.parent?.type === 'command' || n.parent?.type === 'concatenation' && n.parent.parent?.type === 'command')) add('wordSplit');
    if (n.type === 'command' && field(n, 'name')?.text === 'typeset') {
      const f = ancestor(n, (a) => a.type === 'function_definition');
      if (f && f.children[0].type !== 'function') add('typesetScope');
    }
    if (n.type === 'expansion') {
      const p = parseExpansion(n.text);
      if (p?.subscript && /^\d+$/.test(p.subscript)) add('arrayBase');
    }
  });
  return found;
}

const ids = (found: Found[]) => [...new Set(found.map((f) => f.id))];

/** Behaviours used on the line (see BEHAVIOURS). */
export function behavioursOnLine(root: SyntaxNode, line: number): string[] {
  return ids(collectBehaviours(root, line, line));
}

/** Features used by the constructs starting on lines [from, to]. */
export function collectFeatures(root: SyntaxNode, from: number, to: number): Found[] {
  const found: Found[] = [];
  walk(root, from, to, (n) => classify(n, n.children.map((c) => c.type), (id) => found.push({ id, node: n })));
  return found;
}

/** Features used by the parts of `root` on `line` (a construct counts on the line where it starts). */
export function featuresOnLine(root: SyntaxNode, line: number): string[] {
  return ids(collectFeatures(root, line, line));
}

/** A redirection to `/dev/tcp/host/port` (or `/dev/udp/…`), as the value of its word: quoted, it connects too. */
function redirectsToNetwork(n: SyntaxNode): boolean {
  const dests = fields(n, 'destination');
  const target = (dests.length === 1 ? staticWordValue(dests[0]) : undefined) ?? dests.map((d) => d.text).join(' ');
  // (With a target, the redirection has its operator.)
  return !!networkPath(target) && !!networkTarget(n.children.find((c) => !c.named)!.type, field(n, 'descriptor')?.text ?? '', target);
}

function classify(n: SyntaxNode, kids: string[], add: (id: string) => void): void {
  switch (n.type) {
    case 'arithmetic_command': add('arithCommand'); return;
    case 'extended_test':
      add('dbracket');
      if (descendants(n, ['=~']).length) add('regex');
      return;
    case 'command': {
      // (`[ a == b ]`, by its spelling.)
      if (writtenAsBracket(n) && bracketWords(n).words.some((w) => w.text === '==')) add('eqeqTest');
      const name = field(n, 'name');
      // (A command with no name has only assignments: their own case.)
      if (!name) return;
      const prefix = prefixAssignments(n);
      commandFeatures(name.text, n.namedChildren.filter((c) => c !== name && !prefix.includes(c)), add);
      return;
    }
    case 'coproc_statement': add('coproc'); return;
    case 'command_substitution': {
      const form = substitutionForm(n);
      if (form === '${') add('funsub');
      else if (form === '${|') add('valsub');
      return;
    }
    case 'c_style_for_statement': add('cFor'); return;
    case 'select_statement': add('select'); return;
    case 'function_definition': if (kids[0] === 'function') add('funcKeyword'); return;
    case 'herestring_redirect': add('herestring'); return;
    case 'ansi_c_string': add('ansiC'); return;
    case 'process_substitution': add('procSub'); return;
    case 'file_redirect':
      if (kids.includes('&>')) add('ampRedirect');
      if (kids.includes('&>>')) add('ampAppend');
      if (redirectsToNetwork(n)) add('netRedirect');
      return;
    case 'pipeline': if (kids.includes('|&')) add('pipeAmp'); return;
    case 'case_item':
      if (kids.includes(';&')) add('caseFall');
      if (kids.includes(';;&')) add('caseCont');
      return;
    case 'extglob_pattern': if (/[@!?*+]\(/.test(n.text)) add('extglob'); return;
    case 'variable_assignment': {
      const value = field(n, 'value');
      if (value?.type === 'array') add('array');
      if (kids.includes('+=')) add('plusAssign');
      return;
    }
    case 'expansion': {
      const p = parseExpansion(n.text);
      if (!p) return;
      if (p.subscript !== undefined) add(/^-\d/.test(p.subscript) ? 'negIndex' : 'array');
      if (p.prefix === '!') add(p.op === '*' || p.op === '@' ? 'prefixNames' : p.subscript === '@' || p.subscript === '*' ? 'arrayKeys' : 'indirect');
      if (p.op === '/' || p.op === '//') add('replace');
      if (p.op === '/#' || p.op === '/%') add('replaceAnchor');
      if (p.op && /^[\^,]{1,2}$/.test(p.op)) add('caseMod');
      if (p.op === ':') add('substr');
      if (p.op === '@') add('transform');
      variableFeature(p.name, add);
      return;
    }
    case 'simple_expansion': variableFeature(n.text.slice(1), add); return;
    case 'brace_expression': case 'word': case 'concatenation': {
      // (Only where bash expands braces: not in `x={1..3}`, a here-string or the word of `case`.)
      const braces = n.type !== 'word' && bracesInContext(n);
      if (braces && n.type === 'brace_expression' && braceKind(n) === 'sequence') add('braceRange');
      if (n.parent?.type === 'string' || n.parent?.type === 'concatenation' || n.parent?.type === 'brace_expression') return;
      // (The lists of a word, once for the word: `{a,b}{c,d}`.)
      if (braces && wordBraces(n).some((b) => braceKind(b) === 'list')) add('braceList');
      const t = n.type === 'word' ? n.text : n.children.filter((c) => c.type === 'word').map((c) => c.text).join('');
      if (/[@!?+]\([^)]*\)/.test(t)) add('extglob');
      return;
    }
  }
}

function variableFeature(name: string, add: (id: string) => void): void {
  if (name === 'RANDOM') add('random');
  else if (name === 'SECONDS') add('seconds');
  else if (name === 'PIPESTATUS') add('pipestatus');
  else if (name === 'FUNCNAME') add('funcname');
  else if (name === 'UID' || name === 'EUID') add('uid');
  else if (name === 'HOSTNAME') add('hostname');
  else if (/^BASH_|^BASHPID$|^BASHOPTS$|^EPOCH(SECONDS|REALTIME)$/.test(name)) add('bashVar');
}

/** The features of a builtin's options and operands, read from the parse of its words with the builtin's spec. */
function commandFeatures(name: string, nodes: SyntaxNode[], add: (id: string) => void): void {
  // (Every name below is a builtin's.)
  if (!Object.hasOwn(builtins, name)) return;
  const parse = interpret(builtins[name], nodes.map(argWord), { name });
  const on = (...names: string[]): boolean => has(parse, ...names);
  // The values of `set -o NAME` (not `set +o NAME`), also bundled as in `set -euo pipefail`.
  const setOption = (option: string): boolean => values(parse, '-o').some(({ word, role }) => role.of.startsWith('-') && argWord(nodes[word]).value === option);
  switch (name) {
    case 'declare': add(on('-A') ? 'assoc' : 'declare'); break;
    case 'typeset': add(on('-A') ? 'assoc' : 'typeset'); break;
    case 'local': add('local'); break;
    case 'readarray': case 'mapfile': add('readarray'); break;
    case 'source': add('source'); break;
    case 'let': add('let'); break;
    case 'shopt': add('shopt'); break;
    case 'pushd': case 'popd': case 'dirs': add('pushd'); break;
    case 'print': add('print'); break;
    case 'whence': add('whence'); break;
    case 'export': if (on('-f')) add('exportF'); break;
    case 'wait': if (on('-n')) add('waitN'); break;
    case 'type': if (on('-t')) add('typeT'); break;
    case 'printf':
      if (on('-v')) add('printfV');
      if (nodes.some((w) => /%q/.test(w.text))) add('printfQ');
      break;
    case 'echo':
      if (on('-e')) add('echoE');
      if (on('-n')) add('echoN');
      break;
    case 'read':
      if (on('-a')) add('readA');
      if (on('-p')) add('readP');
      if (on('-n', '-s', '-t', '-d')) add('readOpts');
      break;
    case 'set':
      if (setOption('pipefail')) add('pipefail');
      if (on('-E') || setOption('errtrace')) add('errtrace');
      break;
    case 'trap': if (operands(parse, 'SIGNAL').some(({ word }) => argWord(nodes[word]).value === 'ERR')) add('trapErr'); break;
  }
}

/** The note of a construct the target shell lacks: a warning with no word, since its first words say that it fails, and where. */
function unsupported(lang: Lang, id: string, body: string): Note {
  return marked(lang, 'warning', body, { code: id });
}

/** A problem in a script for its target shell, with where it is. */
export interface Issue {
  id: string;
  /**
   * `unsupported`: fails in the shell (a warning); `behaviour`: works differently (information, "Portability");
   * `parse`: zsh-only syntax (a plain fact, which is still a problem: the line is not explained).
   */
  kind: 'unsupported' | 'behaviour' | 'parse';
  /** What the explanations say of it, and the problems: its text, level and word (src/messages.ts). */
  note: Note;
  /** Where it is: the lines and columns the construct, or the syntax error, covers. */
  place: Place;
  /** The construct, for the issues about one (not `parse`). */
  node?: SyntaxNode;
}

export interface Place { startPosition: Point; endPosition: Point }

/**
 * Japanese text joined as docs/japanese-style.md writes it: a space between code or a word in Latin letters and
 * Japanese (`` `local` は ``, `代わりに \`.\` を使う`), none between Japanese (`代わりに一時ファイル`).
 */
function jaJoin(a: string, b: string): string {
  const japanese = /[぀-ヿ一-鿿]/;
  const latin = /[`\w)]/;
  const gap = (latin.test(a.slice(-1)) && japanese.test(b.charAt(0))) || (japanese.test(a.slice(-1)) && latin.test(b.charAt(0)));
  return a + (gap ? ' ' : '') + b;
}

function featureMessage(id: string, shell: Shell, lang: Lang): string | undefined {
  const s = pick(lang);
  const f = FEATURES[id];
  const label = s(f.ja, f.en);
  const alt = f.altJa ? s(`${jaJoin('代わりに', f.altJa)}。`, ` Instead, ${f.altEn}.`) : '';
  if (shell === 'sh') {
    // Name the common /bin/sh implementations it breaks on.
    const fails = (['dash', 'ash'] as RealShell[]).filter((sh) => !works(f, sh)).map((sh) => SHELL_NAMES[sh]);
    return s(
      `${jaJoin(label, 'は POSIX sh にない書き方です')}${fails.length ? `（${fails.join('・')} では動きません）` : '（dash・busybox ash では動きますが、POSIX にはありません）'}。${alt}`,
      `${label} is not POSIX sh${fails.length ? ` (it fails in ${fails.join(' and ')})` : ' (dash and busybox ash accept it, but POSIX does not have it)'}.${alt}`,
    );
  }
  if (shell === 'bash' || works(f, shell)) return undefined;
  return s(`${jaJoin(label, 'は')} ${SHELL_NAMES[shell]} では使えません。${alt}`, `${label} is not available in ${SHELL_NAMES[shell]}.${alt}`);
}

/** What bash `version` does with feature `id`, which came in a later release (SINCE). */
function versionMessage(id: string, version: BashVersion, lang: Lang): string {
  const s = pick(lang);
  const f = FEATURES[id];
  const { version: since, before } = SINCE[id];
  const alt = s(`${jaJoin('代わりに', f.altJa!)}。`, ` Instead, ${f.altEn}.`);
  return s(`${jaJoin(f.ja, 'は')} bash ${since} からの書き方です。bash ${version} では${before[0]}。${alt}`, `${f.en} is bash ${since} syntax: bash ${version} ${before[1]}.${alt}`);
}

/** Every text the dialect checks can say of a construct in `lang`, for each shell and bash version (checked by test/ja-style.test.ts). */
export function dialectTexts(lang: Lang): string[] {
  const shells = Object.keys(SHELL_NAMES) as Shell[];
  return [
    ...Object.keys(FEATURES).flatMap((id) => shells.map((sh) => featureMessage(id, sh, lang))),
    ...Object.keys(BEHAVIOURS).flatMap((id) => shells.map((sh) => behaviourMessage(id, sh, lang))),
    ...Object.keys(SINCE).flatMap((id) => BASH_VERSIONS.filter((v) => earlier(v, SINCE[id].version)).map((v) => versionMessage(id, v, lang))),
  ].filter((t): t is string => t !== undefined);
}

function behaviourMessage(id: string, shell: Shell, lang: Lang): string | undefined {
  const s = pick(lang);
  const b = BEHAVIOURS[id];
  // For POSIX sh, name the common /bin/sh implementations that differ.
  const differ = shell === 'sh' ? (['dash', 'ash'] as RealShell[]).filter((sh) => b.differs.includes(LETTER[sh])) : shell !== 'bash' && b.differs.includes(LETTER[shell]) ? [shell] : [];
  return differ.length ? s(b.ja(differ.map((x) => SHELL_NAMES[x]).join('・')), b.en(differ.map((x) => SHELL_NAMES[x]).join(' and '))) : undefined;
}

/** The line and column of an offset in the text. */
function pointAt(text: string, index: number): Point {
  const before = text.slice(0, index);
  return { row: before.split('\n').length - 1, column: index - (before.lastIndexOf('\n') + 1) };
}

/**
 * Where zsh-only syntax may be, in lines [from, to], the first on each line: text the parser could not
 * read, where it left out a token it expected (a place of no width), and words with `*(…)` and the like,
 * which the parser reads as ksh's extended globs but zsh takes as glob qualifiers (`*(.)`, `*(/om)`).
 */
function zshSyntaxPlaces(tree: SyntaxTree, from: number, to: number): Place[] {
  const places: (Place & { index: number })[] = tree.errors.map((e) => ({
    index: e.startIndex, startPosition: pointAt(tree.text, e.startIndex), endPosition: pointAt(tree.text, e.endIndex),
  })).sort((a, b) => a.index - b.index);
  const out: Place[] = [];
  const add = (p: Place): void => {
    if (p.startPosition.row >= from && p.startPosition.row <= to && !out.some((e) => e.startPosition.row === p.startPosition.row)) out.push(p);
  };
  places.forEach(add);
  for (const w of descendants(tree.root, ['word'], { from, to })) if (/(^|[^\\])[?*+@!]\(/.test(w.text)) add(w);
  // Parameter flags, `${(f)var}`: bash reads them as an expansion and reports "bad substitution" only when it runs.
  for (const e of descendants(tree.root, ['expansion'], { from, to })) if (e.text.startsWith('${(')) add(e);
  return out;
}

const ZSH_SYNTAX: [string, string] = [
  'この行には解析できない部分があります。zsh 独自の書き方（グロブ修飾子 `*(.)`、パラメータフラグ `${(f)var}` など）は解説できません。',
  'Part of this line could not be parsed. zsh-only syntax (glob qualifiers like `*(.)`, parameter flags like `${(f)var}`…) is not explained.',
];

/**
 * The options of bash's builtins on lines [from, to] that bash `version` lacks (`OptionSpec.since`): bash reports
 * "invalid option" there, and the builtin does nothing. Also the names of shell options it lacks
 * (`SHELL_OPTIONS_SINCE`, in an operand of type `shell-option`: `shopt -s NAME`).
 */
function laterOptions(tree: SyntaxTree, from: number, to: number, version: BashVersion, lang: Lang): Issue[] {
  const out: Issue[] = [];
  for (const c of descendants(tree.root, ['command'], { from, to })) {
    const name = field(c, 'name');
    if (!name || !Object.hasOwn(builtins, name.text)) continue;
    const prefix = prefixAssignments(c);
    const args = c.namedChildren.filter((x) => x !== name && !prefix.includes(x) && x.field !== 'redirect');
    const parse = interpret(builtins[name.text], args.map(argWord), { name: name.text });
    const add = (word: number, text: [string, string]): void => {
      out.push({ id: 'laterOption', kind: 'unsupported', note: unsupported(lang, 'laterOption', `${text[lang === 'ja' ? 0 : 1]}${lang === 'ja' ? '。' : '.'}`), node: args[word], place: args[word] });
    };
    for (const { word, role } of givenOptions(parse)) {
      const since = role.role === 'option' ? role.spec.since : undefined;
      if (since && earlier(version, since)) add(word, laterOption(name.text, role.flag, since, version, builtins[name.text].builtin === 'special'));
    }
    for (const { word, role } of parse.roles) {
      const option = role.role === 'operand' && role.spec?.type === 'shell-option' ? argWord(args[word]).value : undefined;
      const since = option !== undefined && Object.hasOwn(SHELL_OPTIONS_SINCE, option) ? SHELL_OPTIONS_SINCE[option] : undefined;
      if (since && earlier(version, since)) add(word, laterShellOption(option!, since, version));
    }
  }
  return out;
}

/**
 * Problems on lines [from, to] of a script written for `shell`; for bash, the constructs that bash `version` lacks
 * (src/bashversion.ts), and in a version that has `${ …; }`, the ones it does not close (`braceTakenAsWord`).
 */
export function dialectIssues(tree: SyntaxTree, shell: Shell, lang: Lang, from = 0, to = tree.root.endPosition.row, version: BashVersion = DEFAULT_BASH_VERSION): Issue[] {
  if (shell === 'bash') {
    const lacking = collectFeatures(tree.root, from, to).filter((f) => lacks(f.id, version))
      .map((f): Issue => ({ id: f.id, kind: 'unsupported', note: unsupported(lang, f.id, versionMessage(f.id, version, lang)), node: f.node, place: f.node }));
    // (Where bash lacks `${ …; }`, the issue above says what it does.)
    const unclosed = lacks('funsub', version) ? [] : descendants(tree.root, ['command_substitution'], { from, to }).flatMap((n): Issue[] => {
      const how = braceTakenAsWord(n);
      const text = how && unclosedBrace(how, substitutionForm(n) === '${' ? '${ …; }' : '${| …; }', true)[lang === 'ja' ? 0 : 1];
      return text ? [{ id: 'funsubBrace', kind: 'unsupported', note: unsupported(lang, 'funsubBrace', `${text}${lang === 'ja' ? '。' : '.'}`), node: n, place: n.children[n.children.length - 1] }] : [];
    });
    return [...lacking, ...unclosed, ...laterOptions(tree, from, to, version, lang)];
  }
  const issues: Issue[] = [];
  if (shell === 'zsh') {
    for (const place of zshSyntaxPlaces(tree, from, to)) {
      issues.push({
        id: 'zshSyntax', kind: 'parse', place, note: { ...plainNote(ZSH_SYNTAX[lang === 'ja' ? 0 : 1]), code: 'zshSyntax' },
      });
    }
  }
  for (const f of collectBehaviours(tree.root, from, to)) {
    const body = behaviourMessage(f.id, shell, lang);
    if (body) issues.push({ id: f.id, kind: 'behaviour', note: marked(lang, 'info', body, { heading: PORTABILITY, code: f.id }), node: f.node, place: f.node });
  }
  for (const f of collectFeatures(tree.root, from, to)) {
    const body = featureMessage(f.id, shell, lang);
    if (body) issues.push({ id: f.id, kind: 'unsupported', note: unsupported(lang, f.id, body), node: f.node, place: f.node });
  }
  return issues;
}

/** Notes for the line: features the target shell lacks, and behaviour that differs. */
export function dialectNotes(tree: SyntaxTree, line: number, shell: Shell, lang: Lang, version?: BashVersion): string[] {
  return [...new Set(dialectFound(tree, line, shell, lang, version).map((f) => f.text))];
}

/** The notes of `dialectNotes`, each with the place of its construct and its issue's id (the note on zsh syntax is about the line: none). */
export function dialectFound(tree: SyntaxTree, line: number, shell: Shell, lang: Lang, version?: BashVersion): (Note & { node?: Place })[] {
  const issues = dialectIssues(tree, shell, lang, line, line, version).filter((i) => i.kind !== 'parse');
  // On every line a zsh parse error covers, not only where it starts.
  const parse = shell === 'zsh' && zshSyntaxPlaces(tree, 0, tree.root.endPosition.row).some((e) => e.startPosition.row <= line && e.endPosition.row >= line)
    ? [plainNote(ZSH_SYNTAX[lang === 'ja' ? 0 : 1])] : [];
  return [...parse, ...issues.map((i) => ({ ...i.note, node: i.place }))];
}
