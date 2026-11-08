import { interpret } from './argv/interpret';
import { BASH_VERSIONS, type BashVersion, DEFAULT_BASH_VERSION, earlier, lacks, laterOption, laterShellOption, SHELL_OPTIONS_SINCE, SINCE, unclosedBraceBody } from './bashversion';
import { givenOptions, has, operands, values } from './argv/query';
import { argWord } from './argv/words';
import { builtins } from './dict/builtins';
import { pick } from './embedded/types';
import { parseExpansion } from './expansion';
import { Lang } from './i18n';
import { leastOf, mostOf, pushAll } from './lists';
import { failsCheck, severityOf } from './levels';
import { type Note, problemNote } from './messages';
import { SUBSHELL_STOPS } from './messages-shfail';
import type { Head } from './messages-levels';
import { ancestor, braceKind, braceTakenAsWord, childrenOnRows, descendants, field, fields, nameText, prefixAssignments, substitutionForm, wordBraces } from './syntax/tree';
import { dupTarget, networkPath, networkTarget } from './dict/syntax';
import { VARIABLE_SECTIONS } from './manual';
import { testStatus } from './semantics/conditions';
import { processOf } from './semantics/env';
import { isFunction, resolveName } from './semantics/names';
import { type Fault, keptQuiet, quietAt, readWith, readWithItsLine, type Stop, surelyRuns } from './semantics/scriptstops';
import { shellState, type StateModel } from './semantics/state';
import { variableWrites } from './semantics/effects';
import { optionOn } from './semantics/status';
import { testWordShape } from './semantics/testwords';
import { testedFirst } from './semantics/unbound';
import { bracesInContext, wordFields, type WordEnv } from './semantics/words';
import { staticWordValue } from './staticword';
import { builtinRow, type Case, COMMON_SH, type Failure, type Feature, FEATURES, featureWorks, failureOf, type InShell, isFailure, LETTER, type Measured, type RealShell, saidShell, type ScriptEvidence, type Shell, type ShellReading, type ShellSource, works } from './shellfeatures';
import type { Point, SyntaxNode, SyntaxTree } from './syntax/tree';
import { binaryOperators, parseTest, writtenTestWords } from './testexpr';

// (The shells and the table of features are in src/shellfeatures.ts, a leaf module that src/staticword.ts reads too.)
export { type AutoShell, bracesWork, FEATURES, featureWorks, saidShell, type ScriptEvidence, type Shell, type ShellReading, type ShellSource } from './shellfeatures';

export const SHELL_NAMES: Record<Shell, string> = {
  bash: 'bash', sh: 'POSIX sh', dash: 'dash', ash: 'busybox ash', yash: 'yash', ksh: 'ksh93', mksh: 'mksh', zsh: 'zsh',
};

/**
 * The shell a script is written for, from a ShellCheck directive, its shebang or its file name, with where that comes
 * from. The first of the three that is there decides, even when it names no shell we know (`#!/usr/bin/python`):
 * the reading is then the default. The one reader the panel's and the page's "auto" wording stands on
 * (src/messages-shell.ts).
 */
export function readShell(text: string, fileName = ''): ShellReading {
  const head = text.slice(0, 2000);
  const found = (shell: Shell | undefined, source: ShellSource): ShellReading => (shell ? { shell, source } : { shell: 'bash', source: 'default' });
  const directive = /^#\s*shellcheck\s+shell=(\w+)/m.exec(head)?.[1];
  if (directive) return found(shellFromName(directive), 'directive');
  const shebang = shebangOf(head);
  if (shebang) return found(shebang.name === undefined ? undefined : shellFromName(shebang.name), 'shebang');
  const base = baseName(fileName);
  if (/\.zsh(?:-theme)?$|^\.?z(shrc|profile|login|logout|shenv)$/.test(base)) return { shell: 'zsh', source: 'filename' };
  if (/\.ksh$|^\.?m?kshrc$/.test(base)) return { shell: base.includes('mksh') ? 'mksh' : 'ksh', source: 'filename' };
  if (/^\.?yash(?:rc|_profile)$/.test(base)) return { shell: 'yash', source: 'filename' };
  if (/\.bash$|^\.?bash(rc|_profile|_login|_logout|_aliases)$/.test(base)) return { shell: 'bash', source: 'filename' };
  return { shell: 'bash', source: 'default' };
}

/**
 * The program a first line `#!…` names, and whether it does so through `env` (`#!/usr/bin/env bash`, `#!/usr/bin/env -S ksh93 -e`:
 * `name` is undefined when `env` is given none); undefined for a text with no shebang. The one reader of the line.
 */
function shebangOf(head: string): { name: string | undefined; env: boolean } | undefined {
  const shebang = /^#!\s*(.*)/.exec(head);
  if (!shebang) return undefined;
  const words = shebang[1].trim().split(/\s+/);
  const prog = words[0].split('/').pop()!;
  if (prog !== 'env') return { name: prog, env: false };
  const arg = words.slice(1).find((w) => !w.startsWith('-') && !w.includes('='));
  return { name: arg?.split('/').pop(), env: true };
}

/** Whether the first line of a text names its shell through `env` (`#!/usr/bin/env bash`), not by a path (`#!/bin/bash`). */
export const shebangThroughEnv = (text: string): boolean => shebangOf(text)?.env === true;

const baseName = (fileName: string): string => fileName.split(/[\\/]/).pop()!;

/** A file name of a shell with another language, which the reading above has no shell for: fish, csh and tcsh, all in VS Code's `shellscript` language. */
const OTHER_LANGUAGE_NAME = /\.(?:fish|t?csh)$|^\.?t?cshrc$/;

/**
 * Whether a text is surely a script, so that what the parser cannot read in it is the script's fault, and how that is known.
 * A first line that names another program says no (`#!/usr/bin/env node`, `#!/usr/bin/fish`), as a name of another language does
 * (`x.fish`). Otherwise the first line or a ShellCheck directive says so (`said`); the caller does (`given`: `said` for the
 * user's `--shell` or `-e`, or the web page, `name` for `--kind` or an editor's language); or the name does: `.sh`, what `readShell`
 * reads as a shell's. When in doubt, no.
 */
export function surelyScript(text: string, fileName: string, given?: ScriptEvidence): ScriptEvidence | undefined {
  if (text.startsWith('#!')) return readShell(text.split('\n', 1)[0]).source === 'shebang' ? 'said' : undefined;
  if (OTHER_LANGUAGE_NAME.test(baseName(fileName))) return undefined;
  const { source } = readShell(text, fileName);
  if (given === 'said' || source === 'directive') return 'said';
  return given || fileName.endsWith('.sh') || source !== 'default' ? 'name' : undefined;
}

/** The shell a script says it is written for (`readShell`'s, undefined when it says none): the callers that only need the shell. */
export function detectShell(text: string, fileName = ''): Shell | undefined {
  return saidShell(readShell(text, fileName));
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
interface Behaviour { differs: string; ja: (shell: string) => string; en: (shell: string) => string; head: (shell: string) => Head }

export const BEHAVIOURS: Record<string, Behaviour> = {
  echoEscape: {
    differs: 'dymz',
    ja: (sh) => `${sh} の \`echo\` は引数の \`\\t\` や \`\\n\` などを解釈します（bash は文字のまま表示）。どちらでも同じにするには \`printf\` を使います。`,
    en: (sh) => `${sh}'s \`echo\` interprets \`\\t\`, \`\\n\` and the like in its arguments (bash prints them as they are). Use \`printf\` to get the same result everywhere.`,
    head: (sh) => [`${sh} の \`echo\` は \`\\t\` や \`\\n\` などを解釈する。`, `${sh}'s \`echo\` interprets \`\\t\`, \`\\n\` and the like.`],
  },
  wordSplit: {
    differs: 'z',
    ja: (sh) => `${sh} ではクォートしない \`$変数\` も単語分割・グロブ展開されません（bash では空白で分かれます）。`,
    en: (sh) => `In ${sh} an unquoted \`$var\` is not split into words or globbed (bash splits it on spaces).`,
    head: (sh) => [`${sh} ではクォートしない \`$変数\` も分かれない。`, `In ${sh} an unquoted \`$var\` is not split.`],
  },
  typesetScope: {
    differs: 'k',
    ja: (sh) => `${sh} では \`name() { … }\` の形の関数の中の \`typeset\` はローカル変数になりません（グローバル変数を変更します）。ローカルにするには \`function name { … }\` の形で定義します。`,
    en: (sh) => `In ${sh}, \`typeset\` inside a function written \`name() { … }\` does not make a local variable (it changes the global one); define the function as \`function name { … }\` for local scope.`,
    head: (sh) => [`${sh} では、この形の関数の中の \`typeset\` はグローバル変数を変更する。`, `In ${sh}, \`typeset\` in a function of this form changes the global variable.`],
  },
  arrayBase: {
    differs: 'yz',
    ja: (sh) => `${sh} の配列の添字は 1 から始まります（bash は 0 から）。この解説は bash の数え方です。`,
    en: (sh) => `Array subscripts start at 1 in ${sh} (bash starts at 0); this explanation counts the bash way.`,
    head: (sh) => [`${sh} の配列の添字は 1 から始まる。`, `Array subscripts start at 1 in ${sh}.`],
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

/** The constructs on the lines `rows` that a sh may not have (each feature of FEATURES: not in POSIX, or only since its 2024 edition), each with what the problems of a sh script say of it, in `lang`. A fact of the construct, for a mark, whatever shell the script is for. */
export function notPosixOn(root: SyntaxNode, rows: ReadonlySet<number>, lang: Lang): { node: SyntaxNode; says: string }[] {
  const on = [...rows];
  return collectFeatures(root, leastOf(on), mostOf(on)).filter((f) => rows.has(f.node.startPosition.row)).map((f) => ({ node: f.node, says: featureMessage(f.id, 'sh', lang)! }));
}

/**
 * The keywords of bash on the lines `rows` that `shell` reads as a command, or does not have, where the table says so: `[[ ]]`, `coproc`, and `time`,
 * which is no keyword in dash and busybox ash (`time rec a` runs a program there, or an applet). A shell with them has none here.
 */
export function keywordsNotIn(root: SyntaxNode, rows: ReadonlySet<number>, shell: Shell | undefined): SyntaxNode[] {
  if (!shell || shell === 'bash') return [];
  const on = [...rows];
  const lacks = (id: string): boolean => !featureWorks(id, shell);
  const types = [...(lacks('dbracket') ? ['extended_test'] : []), ...(lacks('coproc') ? ['coproc_statement'] : []), ...(shell === 'sh' || shell === 'dash' || shell === 'ash' ? ['time_statement'] : [])];
  return types.length ? descendants(root, types, { from: leastOf(on), to: mostOf(on) }).filter((n) => rows.has(n.startPosition.row)) : [];
}

/** A redirection to `/dev/tcp/host/port` (or `/dev/udp/…`), as the value of its word: quoted, it connects too. */
function redirectsToNetwork(n: SyntaxNode): boolean {
  const dests = fields(n, 'destination');
  const target = (dests.length === 1 ? staticWordValue(dests[0]) : undefined) ?? dests.map((d) => d.text).join(' ');
  // (With a target, the redirection has its operator.)
  return !!networkPath(target) && !!networkTarget(n.children.find((c) => !c.named)!.type, field(n, 'descriptor')?.text ?? '', target);
}

/** Whether the test `n` reads a word as the operator `==` (`[ a == b ]`, `test a == b`): not as an operand (`[ "$1" = == ]`). */
function eqeqOperator(n: SyntaxNode): boolean {
  const texts = writtenTestWords(n)?.map((w) => staticWordValue(w) ?? null);
  const test = texts && parseTest(texts);
  return !!test && binaryOperators(test).some((op) => texts[op] === '==');
}

/** Whether `n` is in a `$(( ))`, not in an `(( ))` or a `for (( ))` (features of their own) in it. */
function inArithmeticExpansion(n: SyntaxNode): boolean {
  return ancestor(n, (a) => a.type === 'arithmetic_expansion' || a.type === 'arithmetic_command' || a.type === 'c_style_for_statement')?.type === 'arithmetic_expansion';
}

/** Whether the redirection `n` is `>& file` (or `1>& file`): a known target that is no descriptor (`dupTarget`), which bash takes as a file for stdout and stderr, as `&>`. */
function dupsToFile(n: SyntaxNode, kids: string[]): boolean {
  const fd = field(n, 'descriptor')?.text;
  if (!kids.includes('>&') || (fd !== undefined && fd !== '1')) return false;
  const dests = fields(n, 'destination');
  const target = dests.length === 1 ? staticWordValue(dests[0]) : undefined;
  return target !== undefined && dupTarget(target).kind === 'word';
}

function classify(n: SyntaxNode, kids: string[], add: (id: string) => void): void {
  switch (n.type) {
    case 'arithmetic_command': add('arithCommand'); return;
    case 'extended_test':
      add('dbracket');
      if (descendants(n, ['=~']).length) add('regex');
      return;
    case 'command': {
      if (eqeqOperator(n)) add('eqeqTest');
      const name = field(n, 'name');
      // (A command with no name has only assignments: their own case.)
      if (!name) return;
      const prefix = prefixAssignments(n);
      commandFeatures(name.text, n.namedChildren.filter((c) => c !== name && !prefix.includes(c) && c.field !== 'redirect'), add);
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
    // (A `'` in the body is a `\'`, where dash's quote ends.)
    case 'ansi_c_string': add(n.text.slice(2, -1).includes("'") ? 'ansiCQuote' : 'ansiC'); return;
    case 'translated_string': add('translated'); return;
    case 'process_substitution': add('procSub'); return;
    case 'file_redirect':
      if (kids.includes('&>')) add('ampRedirect');
      if (dupsToFile(n, kids)) add('dupFile');
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
      if (field(n, 'name')?.type === 'subscript') add('arrayElement');
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
    case 'simple_expansion': variableFeature(nameText(n).slice(1), add); return;
    // (A name in `$(( ))`, read as a number. `(( ))` is a feature of its own.)
    case 'variable_name':
      if (/expression$|^arithmetic_expansion$/.test(n.parent!.type) && inArithmeticExpansion(n)) variableFeature(n.text, add);
      return;
    // (`++` and `--`, and `**`, in `$(( ))`: `(( ))` and `for (( ))` are features of their own.)
    case 'postfix_expression': case 'unary_expression': {
      const op = field(n, 'operator')?.type;
      if ((op === '++' || op === '--') && inArithmeticExpansion(n)) add(n.type === 'postfix_expression' ? 'postIncrement' : 'preIncrement');
      return;
    }
    case 'binary_expression': if (field(n, 'operator')?.type === '**' && inArithmeticExpansion(n)) add('power'); return;
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

/** The rows of the variables of bash (a row's `vars`; the rest are the manual's names: `BASH_TSTOUT` is a script's own). */
function variableFeature(name: string, add: (id: string) => void): void {
  const row = Object.keys(FEATURES).find((id) => FEATURES[id].vars?.includes(name));
  if (row) add(row);
  else if (name.startsWith('BASH') && Object.hasOwn(VARIABLE_SECTIONS, name)) add('bashVar');
}

/** The features of a builtin's options and operands, read from the parse of its words with the builtin's spec. */
function commandFeatures(name: string, nodes: SyntaxNode[], add: (id: string) => void): void {
  // (Every name below is a builtin's.)
  if (!Object.hasOwn(builtins, name)) return;
  const parse = interpret(builtins[name], nodes.map(argWord), { name });
  const on = (...names: string[]): boolean => has(parse, ...names);
  // The values of `set -o NAME` and `set +o NAME` (dash refuses a name it lacks either way), also bundled as in `set -euo pipefail`.
  const setOption = (option: string): boolean => values(parse, '-o').some(({ word }) => argWord(nodes[word]).value === option);
  const own = builtinRow(name);
  // (A variable it sets when no word names one, which some shells do not: `read` with no name, `REPLY`.)
  const unnamed = variableWrites(builtins[name], { parse, node: (i) => nodes[i], text: (i) => argWord(nodes[i]).value, field: () => false, size: nodes.length }).find((v) => !v.node && v.feature);
  if (unnamed) add(unnamed.feature!);
  if (own) add(on('-A') && (name === 'declare' || name === 'typeset') ? 'assoc' : own);
  switch (name) {
    case 'export': if (on('-f')) add('exportF'); break;
    case 'wait': if (on('-n')) add('waitN'); break;
    case 'type': if (on('-t')) add('typeT'); break;
    case 'printf':
      if (on('-v')) add('printfV');
      // (The format's value, as a word not known says nothing, and `%%` is a percent sign: `%5q`, `%-5q` are refused too.)
      if (operands(parse, 'FORMAT').some(({ word }) => /%[-+ #0']*[\d*]*(?:\.[\d*]*)?q/.test((argWord(nodes[word]).value ?? '').replace(/%%/g, '')))) add('printfQ');
      break;
    case 'echo':
      if (on('-e')) add('echoE');
      if (on('-n')) add('echoN');
      break;
    case 'read':
      if (on('-a')) add('readA');
      if (on('-p')) add('readP');
      if (on('-n', '-s', '-t')) add('readOpts');
      if (on('-d')) add('readD');
      break;
    case 'set':
      if (setOption('pipefail')) add('pipefail');
      if (on('-E') || setOption('errtrace')) add('errtrace');
      break;
    case 'trap': if (operands(parse, 'SIGNAL').some(({ word }) => argWord(nodes[word]).value === 'ERR')) add('trapErr'); break;
  }
}

/** The note of a construct the target shell lacks: an error ("Error:", the word of its level), since the line fails there every time. */
function unsupported(lang: Lang, id: string, body: string, head: Head = [body, body]): Note & { code: string } {
  return problemNote(lang, 'unsupported', id, body, head);
}

/** A problem in a script for its target shell, with where it is. */
export interface Issue {
  id: string;
  /**
   * `unsupported`: fails in the shell (an error); `differs`: in sh, dash and busybox ash, status 0 with another result, a variable
   * the environment may set, a failure that is not surely reached, or one the script discards (`quietAt`) (a warning, "Portability"); `behaviour`: works differently, or, in sh, is not
   * POSIX but dash and busybox ash run it (information, "Portability"); `parse`: zsh-only syntax (information: the line is
   * not explained).
   */
  kind: 'unsupported' | 'differs' | 'behaviour' | 'parse';
  /** What the explanations say of it, and the problems: its text, level and word (src/messages.ts). */
  note: Note & { code: string };
  /** Where it is: the lines and columns the construct, or the syntax error, covers. */
  place: Place;
  /** The construct, for the issues about one (not `parse`). */
  node?: SyntaxNode;
  /** How a shell that was run fails at it, the worst of them. */
  fault?: Fault;
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

/** The shells run for what they do with what they lack: `sh` is either, a common `/bin/sh`. */
const MEASURED: Partial<Record<Shell, readonly Measured[]>> = { sh: COMMON_SH, dash: ['dash'], ash: ['ash'] };

/** The common `/bin/sh` implementations that lack a feature: dash (Debian's and Ubuntu's) and busybox ash. */
function shFails(f: Feature): RealShell[] {
  return MEASURED.sh!.filter((sh) => !works(f, sh));
}

/**
 * A feature that is not POSIX sh, but that dash and busybox ash run (`local`, `echo -n`, `read -p`, `set -E`): in a sh
 * script, information with the word "Portability", not an error (docs/design/three-levels.md, section 10, item 2).
 */
function portableInSh(id: string, shell: Shell): boolean {
  return shell === 'sh' && shFails(FEATURES[id]).length === 0;
}

function featureHead(id: string, shell: Shell): Head {
  const { ja, en, posixSince } = FEATURES[id];
  if (shell === 'sh' && posixSince) return [`${jaJoin(ja, `は POSIX では ${posixSince} 年版から`)}。`, `${en} is POSIX only since ${posixSince}.`];
  return shell === 'sh' ? [`${jaJoin(ja, 'は POSIX sh にない')}。`, `${en} is not POSIX sh.`]
    : [`${jaJoin(ja, 'は')} ${SHELL_NAMES[shell]} では使えない。`, `${en} is not available in ${SHELL_NAMES[shell]}.`];
}

/**
 * What a shell does at a construct it lacks. `fails`: status not 0, or a syntax error. A variable it does not set: `stops` the shell here
 * (`set -u`, `${x:?}`, no operand in `$(( ))`), or only the `subshell` it is read in; `test`: `[` reports an error (status 2); `empty`,
 * `zero`: its value is nothing, or 0 in arithmetic, status 0. Or what the row of FEATURES says, status 0.
 */
type Does = 'stops' | 'subshell' | 'test' | 'empty' | 'zero' | Exclude<InShell, 'empty' | 'refused' | 'stops'>;
type Doing = Partial<Record<Measured, Does>>;

/** What follows "does not set it, so". */
const UNSET_THEN: Readonly<Record<'stops' | 'subshell' | 'test' | 'empty' | 'zero', readonly [string, string]>> = {
  stops: ['ここでシェルが止まります', 'the shell stops here'],
  subshell: SUBSHELL_STOPS,
  test: ['テストはエラー（終了ステータス 2）になり、偽として扱われます', 'the test reports an error (status 2), and counts as false'],
  empty: ['展開すると空になります', 'it expands to nothing'],
  zero: ['算術式では 0 になります', 'it counts as 0 in arithmetic'],
};

/** What each shell does, in brackets (`（…）`, ` (…)`). Shells that do the same are named together; `alone`: only one shell is meant, which is named around the text, so a failure does not name it again. */
function doingText(how: Doing, lang: Lang, alone = false): string {
  const s = pick(lang);
  const same = new Map<Does, Measured[]>();
  for (const sh of MEASURED.sh!) {
    const does = how[sh];
    if (does) same.set(does, [...(same.get(does) ?? []), sh]);
  }
  return [...same].map(([does, shells]) => {
    const names = shells.map((sh) => SHELL_NAMES[sh]);
    const named = names.join(s('・', ' and '));
    if (typeof does === 'object') return s(does.ja(alone && isFailure(does) ? '' : named), does.en(alone && isFailure(does) ? '' : named));
    return s(`${named} には設定されないので、${UNSET_THEN[does][0]}`, `${named} ${names.length > 1 ? 'do' : 'does'} not set it, so ${UNSET_THEN[does][1]}`);
  }).join(s('。', '; '));
}

/** What a row says a shell that lacks it does there, in the words of its text. */
function doesOf(f: Feature, sh: Measured, cases: readonly Case[] = []): Does {
  const row = f[sh];
  // (A row that fails has how: `failureOf` finds it, and test/dialect-dash.test.ts checks that every one does.)
  return row === 'empty' || (typeof row === 'object' && !isFailure(row)) ? row : failureOf(f, sh, cases)!;
}

/** What the shells of `shell` do with feature `f` when nothing around it says more. */
function usualDoing(f: Feature, shell: Shell): Doing {
  const how: Doing = {};
  for (const sh of MEASURED[shell] ?? []) {
    if (!works(f, sh)) how[sh] = doesOf(f, sh);
  }
  return how;
}

function featureMessage(id: string, shell: Shell, lang: Lang, how: Doing = usualDoing(FEATURES[id], shell)): string | undefined {
  const s = pick(lang);
  const f = FEATURES[id];
  const label = s(f.ja, f.en);
  const alt = f.altJa ? s(`${jaJoin('代わりに', f.altJa)}。`, ` Instead, ${f.altEn}.`) : '';
  if (shell === 'sh') {
    // Name the common /bin/sh implementations it breaks on.
    const lacks = shFails(f).length > 0;
    // (Not POSIX before its 2024 edition: what fails is what a sh of today does.)
    if (f.posixSince) return s(`${jaJoin(label, `は POSIX では ${f.posixSince} 年版からの書き方です`)}（${doingText(how, lang)}）。${alt}`, `${label} is POSIX only since ${f.posixSince} (${doingText(how, lang)}).${alt}`);
    return s(
      `${jaJoin(label, 'は POSIX sh にない書き方です')}${lacks ? `（${doingText(how, lang)}）` : '（dash・busybox ash では動きますが、POSIX にはありません）'}。${alt}`,
      `${label} is not POSIX sh${lacks ? ` (${doingText(how, lang)})` : ' (dash and busybox ash accept it, but POSIX does not have it)'}.${alt}`,
    );
  }
  if (shell === 'bash' || works(f, shell)) return undefined;
  // (A shell that fails says how, without naming itself again.)
  const more = how[shell as Measured];
  return s(`${jaJoin(label, 'は')} ${SHELL_NAMES[shell]} では使えません${more ? `（${doingText(how, lang, true)}）` : ''}。${alt}`, `${label} is not available in ${SHELL_NAMES[shell]}${more ? ` (${doingText(how, lang, true)})` : ''}.${alt}`);
}

/** What bash `version` does with feature `id`, which came in a later release (SINCE). */
function versionMessage(id: string, version: BashVersion, lang: Lang): string {
  const s = pick(lang);
  const f = FEATURES[id];
  const { version: since, before } = SINCE[id];
  const alt = s(`${jaJoin('代わりに', f.altJa!)}。`, ` Instead, ${f.altEn}.`);
  return s(`${jaJoin(f.ja, 'は')} bash ${since} からの書き方です。bash ${version} では${before[0]}。${alt}`, `${f.en} is bash ${since} syntax: bash ${version} ${before[1]}.${alt}`);
}

function versionHead(id: string): Head {
  const f = FEATURES[id];
  const { version: since } = SINCE[id];
  return [`${jaJoin(f.ja, 'は')} bash ${since} からの書き方。`, `${f.en} is bash ${since} syntax.`];
}

/** Every text the dialect checks can say of a construct in `lang`, for each shell and bash version (checked by test/ja-style.test.ts). */
export function dialectTexts(lang: Lang): string[] {
  const shells = Object.keys(SHELL_NAMES) as Shell[];
  return [
    ...Object.keys(FEATURES).flatMap((id) => shells.flatMap((sh) => [featureMessage(id, sh, lang), ...(isVariableRow(FEATURES[id]) ? UNSET_CASES.map((does) => featureMessage(id, sh, lang, { dash: does, ...(FEATURES[id].ash === 'empty' ? { ash: does } : {}) })) : []), featureHead(id, sh)[lang === 'ja' ? 0 : 1]])),
    ...Object.keys(BEHAVIOURS).flatMap((id) => shells.flatMap((sh) => [behaviourMessage(id, sh, lang), behaviourHead(id, sh)[lang === 'ja' ? 0 : 1]])),
    ...Object.keys(SINCE).flatMap((id) => [...BASH_VERSIONS.filter((v) => earlier(v, SINCE[id].version)).map((v) => versionMessage(id, v, lang)), versionHead(id)[lang === 'ja' ? 0 : 1]]),
  ].filter((t): t is string => t !== undefined);
}

/** The names of the shells among `shell` (for POSIX sh, the common /bin/sh implementations) where a behaviour differs. */
function behaviourIn(id: string, shell: Shell): string {
  const b = BEHAVIOURS[id];
  // For POSIX sh, name the common /bin/sh implementations that differ.
  const differ = shell === 'sh' ? (['dash', 'ash'] as RealShell[]).filter((sh) => b.differs.includes(LETTER[sh])) : shell !== 'bash' && b.differs.includes(LETTER[shell]) ? [shell] : [];
  return differ.map((x) => SHELL_NAMES[x]).join(' / ');
}

function behaviourMessage(id: string, shell: Shell, lang: Lang): string | undefined {
  const s = pick(lang);
  const b = BEHAVIOURS[id];
  const shells = behaviourIn(id, shell).split(' / ');
  return shells[0] ? s(b.ja(shells.join('・')), b.en(shells.join(' and '))) : undefined;
}

const behaviourHead = (id: string, shell: Shell): Head => BEHAVIOURS[id].head(behaviourIn(id, shell).split(' / ').join(' and '));

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
  for (const e of descendants(tree.root, ['expansion'], { from, to })) if (ZSH_FORMS.flag.re.test(e.text)) add(e);
  return out;
}

/**
 * The parameter forms zsh reads otherwise than bash, also in double quotes (zshexpn, "Parameter Expansion" and
 * "Modifiers"), as patterns on the text of a word after an unescaped `$` (single-quoted text left out): a flag,
 * `${(f)x}`; a prefix, with braces or not: `$=x` splits (in quotes too), `$~x` globs, `$^x` joins elements to the text
 * around, `$+x` is 1 or 0, `$#x` a length (bash reads `$#`, then `x`); after a bare name, a subscript `$x[1]` or a
 * modifier `$x:h`; `$10`, the tenth argument (bash: `${1}0`). Also `=ls` at the start of a word, the path of `ls`
 * (EQUALS). The word model reads bash's syntax, so it knows nothing of a word with one of them in zsh. Each pattern
 * starts at an unescaped `$`: after no backslash, or after pairs of them.
 */
export const ZSH_FORMS = {
  flag: { form: '${(f)x}', re: /(?<!\\)(?:\\\\)*\$\{\(/ },
  prefix: { form: '$=x', re: /(?<!\\)(?:\\\\)*\$\{?[=~^+]/ },
  length: { form: '$#x', re: /(?<!\\)(?:\\\\)*\$#[\w{]/ },
  subscript: { form: '$x[1]', re: /(?<!\\)(?:\\\\)*\$(?:[A-Za-z_]\w*|\d)[[:]/ },
  tenth: { form: '$10', re: /(?<!\\)(?:\\\\)*\$\d\d/ },
} as const satisfies Record<string, { form: string; re: RegExp }>;

/**
 * Whether the word of `nodes` is for zsh and has a form zsh reads otherwise than bash (`ZSH_FORMS`: `"$#x"`,
 * `"$x[1]"`), or a `=` first (EQUALS: `=ls`), in its text out of single quotes. The word model reads bash's syntax,
 * so it knows nothing of such a word there (src/semantics/words.ts).
 */
export function zshOtherwise(nodes: readonly SyntaxNode[], shell?: Shell): boolean {
  if (shell !== 'zsh') return false;
  const blank = (x: SyntaxNode): string => descendants(x, ['raw_string']).reduce((t, q) => t.slice(0, q.startIndex - x.startIndex) + ' '.repeat(q.endIndex - q.startIndex) + t.slice(q.endIndex - x.startIndex), x.text);
  const text = nodes.map(blank).join('');
  return text.startsWith('=') || Object.values(ZSH_FORMS).some(({ re }) => re.test(text));
}

/** The note on a line with zsh syntax that cannot be read (the issue `zshSyntax`). */
const zshSyntax = (lang: Lang): Note & { code: string } => problemNote(lang, 'parse', 'zshSyntax', ZSH_SYNTAX[lang === 'ja' ? 0 : 1], ['この行には解析できない部分がある。', 'Part of this line could not be parsed.']);
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
  return descendants(tree.root, ['command'], { from, to }).flatMap((c) => laterOptionsOf(c, version, lang));
}

/** What `laterOptions` finds in the command `c`, once for it: each line of a command over several lines asks. */
const laterKept = new WeakMap<SyntaxNode, Map<string, Issue[]>>();
function laterOptionsOf(c: SyntaxNode, version: BashVersion, lang: Lang): Issue[] {
  const name = field(c, 'name');
  if (!name || !Object.hasOwn(builtins, name.text)) return [];
  let byKey = laterKept.get(c);
  if (!byKey) laterKept.set(c, (byKey = new Map()));
  const key = `${version} ${lang}`;
  const known = byKey.get(key);
  if (known) return known;
  const out: Issue[] = [];
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
  byKey.set(key, out);
  return out;
}

/**
 * Problems on lines [from, to] of a script written for `shell`; for bash, the constructs that bash `version` lacks
 * (src/bashversion.ts), and in a version that has `${ …; }`, the ones it does not close (`braceTakenAsWord`).
 */
export function dialectIssues(tree: SyntaxTree, shell: Shell, lang: Lang, from = 0, to = tree.root.endPosition.row, version: BashVersion = DEFAULT_BASH_VERSION, stopAt?: (n: SyntaxNode, fault?: Fault) => Stop | undefined): Issue[] {
  return issuesFound(tree, shell, lang, from, to, version).flatMap((i) => {
    // (A problem says the shell fails on the construct: whatever its kind, by its level. Not where it does not get to, after an `exit`
    // or in a polyglot's other language: `print(x)` of Python is not `print` of ksh. The command a construct is in, not the construct: `source -p dir f` is read, and `-p` is its error.)
    if (!i.node || !failsCheck(severityOf(i.note.level), true)) return [i];
    // (What the shell refuses while it reads the text fails even where the text never runs: only what keeps the shell from reading that line counts.)
    const read = i.fault === 'read';
    const stop = stopAt?.(read ? readWith(i.node) : ancestor(i.node, (a) => a.type === 'command') ?? i.node, i.fault);
    if (stop === 'sure') return [];
    // (Any other error of the dialect is said only where the shell surely gets there. Elsewhere it may be a test's other branch, or the shell may have stopped: the same words, as a warning.)
    return i.kind === 'unsupported' && (stop || (!read && !surelyRuns(i.node))) ? [{ ...i, kind: 'differs' as const, note: problemNote(lang, 'differs', i.note.code, i.note.body, [i.note.head!, i.note.head!]) }] : [i];
  });
}

function issuesFound(tree: SyntaxTree, shell: Shell, lang: Lang, from: number, to: number, version: BashVersion): Issue[] {
  if (shell === 'bash') {
    const lacking = collectFeatures(tree.root, from, to).filter((f) => lacks(f.id, version))
      .map((f): Issue => ({ id: f.id, kind: 'unsupported', note: unsupported(lang, f.id, versionMessage(f.id, version, lang), versionHead(f.id)), node: f.node, place: f.node }));
    // (Where bash lacks `${ …; }`, the issue above says what it does.)
    const unclosed = lacks('funsub', version) ? [] : descendants(tree.root, ['command_substitution'], { from, to }).flatMap((n): Issue[] => {
      const how = braceTakenAsWord(n);
      const text = how && unclosedBraceBody(how, substitutionForm(n) === '${' ? '${ …; }' : '${| …; }', true)[lang === 'ja' ? 0 : 1];
      return text ? [{ id: 'funsubBrace', kind: 'unsupported', note: unsupported(lang, 'funsubBrace', `${text}${lang === 'ja' ? '。' : '.'}`), node: n, place: n.children[n.children.length - 1] }] : [];
    });
    return [...lacking, ...unclosed, ...laterOptions(tree, from, to, version, lang)];
  }
  const issues: Issue[] = [];
  if (shell === 'zsh') {
    for (const place of zshSyntaxPlaces(tree, from, to)) {
      issues.push({
        id: 'zshSyntax', kind: 'parse', place, note: zshSyntax(lang),
      });
    }
  }
  // (A construct that works differently, and in sh one that dash and busybox ash run, is "Portability"; one the shell lacks, an error.)
  const features = collectFeatures(tree.root, from, to);
  const measured = MEASURED[shell];
  // (`${UID:0:1}`, `${FUNCNAME[0]}`: that it fails is what dash does there, not that the variable is empty.)
  const failing = new Set(features.filter((f) => !isVariableRow(FEATURES[f.id]) && measured?.some((sh) => !works(FEATURES[f.id], sh))).map((f) => f.node));
  const found = [
    ...collectBehaviours(tree.root, from, to).map((f) => ({ f, kind: 'behaviour' as const, fault: undefined, body: behaviourMessage(f.id, shell, lang), head: () => behaviourHead(f.id, shell) })),
    ...features.flatMap((f) => {
      // (A name in `$(( ))` is read only where it was run.)
      const reading = measured ? measuredReading(f, tree, shell, failing, measured) : f.node.type === 'variable_name' ? undefined : { kind: 'unsupported' as const };
      return reading ? [{ f, kind: reading.kind, fault: reading.fault, body: featureMessage(f.id, shell, lang, reading.how), head: () => featureHead(f.id, shell) }] : [];
    }),
  ];
  for (const { f, kind, fault, body, head } of found) {
    if (!body) continue;
    const note = kind === 'unsupported' ? unsupported(lang, f.id, body, head()) : problemNote(lang, kind, f.id, body, head());
    issues.push({ id: f.id, kind, note, node: f.node, place: f.node, fault });
  }
  return issues;
}

/** A row of a variable a shell does not set: dash sets the fewest. */
const isVariableRow = (f: Feature): boolean => f.dash === 'empty';

const UNSET_CASES = ['stops', 'subshell', 'test', 'empty', 'zero'] as const;

/** The name a node of `$x`, `${x…}` or a name in `$(( ))` reads, and the operator it has. */
function parameterRead(n: SyntaxNode): { name: string; op?: string } {
  if (n.type === 'simple_expansion') return { name: nameText(n).slice(1) };
  if (n.type === 'variable_name') return { name: n.text };
  // (`variableFeature` found its name.)
  const p = parseExpansion(n.text)!;
  return { name: p.name, op: p.op };
}

/** `${x:?}` of a variable not set where it is. */
function unsetAtOwnTest(n: SyntaxNode, model: StateModel): boolean {
  const { name, op } = parameterRead(n);
  return !!op && /^:?\?$/.test(op) && !model.at(n).run.variables.get(name);
}

/** Where a shell stops at `n`: the script's shell, or a subshell of it, and the script goes on. */
function stopsWhere(n: SyntaxNode, model: StateModel): Does {
  const p = processOf(model.env(n));
  return p.kind === 'subshell' && p.sure ? 'subshell' : 'stops';
}

/** Whether the tree has a `(` or `)` the shell reads as its own syntax in the `[[ ]]` `n`: a grouping, or in a regex or a pattern, as dash and busybox ash read it, not escaped or quoted. */
function parenthesesIn(n: SyntaxNode): boolean {
  const walk = (x: SyntaxNode): boolean => {
    if (x.type === '(' || x.type === ')') return true;
    // (A leaf is a run of unquoted text: a quoted part is a `string` of its own, and a substitution has its own syntax. A backslash escapes.)
    if (x.type === 'regex' || x.type === 'extglob_pattern') return /(?<!\\)(?:\\\\)*[()]/.test(x.text);
    return ['extended_test', 'binary_expression', 'unary_expression', 'parenthesized_expression', 'concatenation'].includes(x.type) && x.children.some(walk);
  };
  return walk(n);
}

/** The cases of its row (`Feature.cases`) that the node `n` of a feature is in, read from the tree and the names. */
function casesAt(n: SyntaxNode, shell: Shell, model: StateModel): Case[] {
  const cases: Case[] = [];
  if (n.type === 'extended_test' && parenthesesIn(n)) cases.push('parenthesis');
  const owner = n.type === 'file_redirect' && n.parent?.type === 'command' ? n.parent : undefined;
  const name = owner && field(owner, 'name');
  // (A redirection that fails at a special builtin ends the shell: POSIX 2.8.1.)
  const run = owner && name ? resolveName(model, name.text, owner, { shell, command: true }) : undefined;
  if (run?.kind === 'builtin' && run.special) cases.push('special');
  return cases;
}

/** How `sh` fails at `n`: the row's, in the cases `n` is in; a failure that stops the shell stops only a subshell where `n` runs in one (`stopsWhere`). */
function doesAt(row: Feature, sh: Measured, n: SyntaxNode, shell: Shell, model: StateModel): Does {
  const does = doesOf(row, sh, casesAt(n, shell, model));
  return isFailure(does as InShell) && (does as Failure).subshell && stopsWhere(n, model) === 'subshell' ? (does as Failure).subshell! : does;
}

/** Whether `[` or `test`, read as `sh` runs it with what it does not set unset, reports an error (status 2): `[ "$UID" -ne 0 ]`, `[ $UID = 0 ]`. */
function testFails(n: SyntaxNode, sh: Measured, model: StateModel): boolean {
  const c = ancestor(n, (a) => a.type === 'command');
  const words = c && writtenTestWords(c);
  // (A word of the test: a redirection's is no operand, and a command in `$( )` has its own.)
  if (!words?.some((w) => w.startIndex <= n.startIndex && n.endIndex <= w.endIndex)) return false;
  const env: WordEnv = { unset: (name) => { let row: string | undefined; variableFeature(name, (id) => { row = id; }); return !!row && FEATURES[row][sh] === 'empty'; } };
  const args: (string | null)[] = [];
  for (const w of words) {
    const known = wordFields(w, model, env).fields;
    // (An unquoted empty expansion gives no word: `[ $UID = 0 ]` is `[ = 0 ]`.)
    if (known) pushAll(args, known);
    else if (testWordShape(w) === 'one') args.push(null);
    else return false;
  }
  return testStatus(args, { option: () => undefined }) === 2;
}

/**
 * What `sh` does at a variable it does not set (`n`), from the words around it. Nothing, where the word gives another value for it (`${UID:-0}`). It stops where
 * `set -u` is on, unless a test of the name comes first, as `nounset-unbound` reads it (`testedFirst`), and at `${x:?}` or an operand missing in `$(( ))` (`$(($x + 1))` is `$(( + 1))`, and `$((1$x))` is `$((1))`: both read).
 */
function unsetDoes(n: SyntaxNode, sh: Measured, tree: SyntaxTree, model: StateModel): Does | undefined {
  if (n.type === 'variable_name') return 'zero';
  const { name, op } = parameterRead(n);
  if (op && /^:?[-+=]$/.test(op)) return undefined;
  if (op && /^:?\?$/.test(op)) return stopsWhere(n, model);
  const st = model.at(n).run;
  if (optionOn(st, 'set', 'nounset') === 'on' && !st.opaque && !testedFirst(n, name)) return stopsWhere(n, model);
  const around = ancestor(n, (a) => a.type === 'arithmetic_expansion' || a.type === 'command_substitution');
  if (around?.type === 'arithmetic_expansion') {
    const before = tree.text.slice(around.startIndex + 3, n.startIndex);
    const after = tree.text.slice(n.endIndex, around.endIndex - 2);
    // (`$(($x))` alone is `$(())`: 0 in busybox ash.)
    if (!/[\w$]$/.test(before) && !/^(?:\s*[-+]|[\w$])/.test(after) && (sh === 'dash' || before.trim() || after.trim())) return stopsWhere(n, model);
  }
  return testFails(n, sh, model) ? 'test' : 'empty';
}

/** How a shell that fails as `failure` says does so at `n`: `${a[0]}`, of a row whose `a=(…)` is refused, is read when it runs. */
function faultOf({ fault }: Failure, n: SyntaxNode): Fault {
  return fault === 'read' && readWithItsLine(n) ? 'read' : fault === 'status' ? 'status' : 'stop';
}

const FAULTS: readonly Fault[] = ['read', 'stop', 'status'];

/**
 * The kind of the issue of a feature in a shell that was run, from what the shell does with it, and what its text adds; none where
 * the script itself sets the variable or defines the command there, or where another feature of the node (`failing`) is what the shell does. Another result with status 0 is a warning,
 * and so is a variable the shell does not set, whatever follows without it: the environment may set it (`UID=7 dash`; docs/design/three-levels.md, section 2). What fails, an error,
 * unless the script discards its message and the failure leaves it going (`quietAt`).
 */
function measuredReading(f: Found, tree: SyntaxTree, shell: Shell, failing: ReadonlySet<SyntaxNode>, shells: readonly Measured[]): { kind: 'unsupported' | 'differs' | 'behaviour'; how?: Doing; fault?: Fault } | undefined {
  const row = FEATURES[f.id];
  if (portableInSh(f.id, shell)) return { kind: 'behaviour' };
  const model = shellState(tree, shell);
  // (`${UID:?}` counts as the script's setting it, past itself: it is the read that fails.)
  if (isVariableRow(row) && (failing.has(f.node) || (model.assigned.has(parameterRead(f.node).name) && !unsetAtOwnTest(f.node, model)))) return undefined;
  if (f.node.type === 'command' && isFunction(resolveName(model, field(f.node, 'name')!.text, f.node, { shell, command: true }))) return undefined;
  const how: Doing = {};
  for (const sh of shells) {
    const does = works(row, sh) ? undefined : row[sh] === 'empty' ? unsetDoes(f.node, sh, tree, model) : doesAt(row, sh, f.node, shell, model);
    if (does) how[sh] = does;
  }
  const done = Object.values(how);
  if (!done.length) return undefined;
  const failed = (Object.keys(how) as Measured[]).filter((sh) => isFailure(how[sh] as InShell)).map((sh) => faultOf(how[sh] as Failure, f.node));
  if (!failed.length) return { kind: 'differs', how };
  const fault = FAULTS.find((x) => failed.includes(x))!;
  return { kind: fault !== 'read' && keptQuiet(quietAt(f.node, model), fault) ? 'differs' : 'unsupported', how, fault };
}

/** Notes for the line: features the target shell lacks, and behaviour that differs. */
export function dialectNotes(tree: SyntaxTree, line: number, shell: Shell, lang: Lang, version?: BashVersion): string[] {
  return [...new Set(dialectFound(tree, line, shell, lang, version).map((f) => f.text))];
}

/** The notes of `dialectNotes`, each with the place of its construct and its issue's id (the note on zsh syntax is about the line: none). */
export function dialectFound(tree: SyntaxTree, line: number, shell: Shell, lang: Lang, version?: BashVersion, stopAt?: (n: SyntaxNode, fault?: Fault) => Stop | undefined): (Note & { code: string; node?: Place })[] {
  const issues = dialectIssues(tree, shell, lang, line, line, version, stopAt).filter((i) => i.kind !== 'parse');
  // On every line a zsh parse error covers, not only where it starts.
  const parse = shell === 'zsh' && zshSyntaxPlaces(tree, 0, tree.root.endPosition.row).some((e) => e.startPosition.row <= line && e.endPosition.row >= line)
    ? [zshSyntax(lang)] : [];
  return [...parse, ...issues.map((i) => ({ ...i.note, node: i.place }))];
}
