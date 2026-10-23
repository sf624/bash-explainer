import { Lang } from './i18n';
import { pick } from './embedded/types';
import { interpret } from './argv/interpret';
import type { ArgvParse } from './argv/interpret';
import { has, values } from './argv/query';
import { argWord } from './argv/words';
import { lookupCommand } from './dict/aliases';
import { staticWordValue } from './staticword';
import { descendants, field, fields } from './syntax/tree';
import type { SyntaxNode } from './syntax/tree';
import { bracketWords, writtenAsBracket } from './testexpr';

export interface Redirect {
  op: string;
  /** Explicit file descriptor, or '' for the operator's default. */
  fd: string;
  dest: string;
}

/**
 * Apply redirections left to right, as bash does, and describe where each file descriptor ends
 * up. Only returned when the order matters (several redirections including a duplication).
 */
export function simulateRedirects(redirs: Redirect[], lang: Lang): string | undefined {
  const s = pick(lang);
  if (redirs.length < 2 || !redirs.some((r) => r.op === '>&' || r.op === '<&')) return undefined;
  const orig = (fd: number) => [s('元の標準入力', 'the original stdin'), s('元の標準出力', 'the original stdout'), s('元の標準エラー出力', 'the original stderr')][fd] ?? s(`元の fd ${fd}`, `the original fd ${fd}`);
  const table = new Map<number, string>([[0, orig(0)], [1, orig(1)], [2, orig(2)]]);
  const touched: number[] = [];
  const set = (fd: number, to: string) => {
    table.set(fd, to);
    if (!touched.includes(fd)) touched.push(fd);
  };
  let pitfall = false;
  redirs.forEach((r, idx) => {
    // `{name}>…` takes a free descriptor of its own (10 or higher), which this table of the first ones leaves out.
    if (/^\{.*\}$/.test(r.fd)) return;
    const fd = r.fd !== '' ? Number(r.fd) : r.op.startsWith('<') ? 0 : 1;
    switch (r.op) {
      case '>&': case '<&':
        if (r.dest === '-') set(fd, s('閉じた状態', 'closed'));
        else if (/^\d+-$/.test(r.dest)) {
          // `n>&m-` moves m to n: a copy, then m is closed.
          const from = Number(r.dest.slice(0, -1));
          set(fd, table.get(from) ?? orig(from));
          set(from, s('閉じた状態', 'closed'));
        } else if (/^\d+$/.test(r.dest)) {
          set(fd, table.get(Number(r.dest)) ?? orig(Number(r.dest)));
          // `2>&1 >file`: stderr copied stdout before stdout was redirected.
          if (fd === 2 && r.dest === '1' && redirs.slice(idx + 1).some((later) => (later.fd === '' || later.fd === '1') && /^>>?$|^>\|$/.test(later.op))) pitfall = true;
        } else {
          set(1, r.dest);
          set(2, r.dest);
        }
        break;
      case '&>': case '&>>':
        set(1, r.dest);
        set(2, r.dest);
        break;
      case '<<': case '<<-': case '<<<':
        set(0, s('ヒアドキュメント／文字列', 'the here-document/string'));
        break;
      default:
        set(fd, r.dest);
    }
  });
  if (!touched.length) return undefined;
  const name = (fd: number) => [s('標準入力', 'stdin'), s('標準出力', 'stdout'), s('標準エラー出力', 'stderr')][fd] ?? `fd ${fd}`;
  const result = touched.sort((a, b) => a - b).map((fd) => `${name(fd)} → ${table.get(fd)}`).join(s('、', ', '));
  let text = s(`リダイレクトは左から順に適用される。最終的に: ${result}`, `Redirections apply left to right. In the end: ${result}`);
  if (table.get(1) === '/dev/null' && table.get(2) === '/dev/null') {
    text += s('（通常の出力もエラー出力もすべて捨てる）', ' (all output, including errors, is discarded)');
  }
  if (table.get(1) === orig(2) && table.get(2) === orig(1)) {
    text += s('（標準出力と標準エラー出力が入れ替わる）', ' (stdout and stderr are swapped)');
  }
  if (pitfall) {
    text += s(
      '。注意: `2>&1` がファイルへのリダイレクトより先にあるので、標準エラー出力はファイルではなく元の標準出力に出る（両方をファイルに送るなら `>file 2>&1` の順にする）',
      '. Note: `2>&1` comes before the file redirection, so stderr goes to the original stdout, not the file (write `>file 2>&1` to send both)',
    );
  }
  return text;
}

// The idioms are read from the tree, not from a statement's text: a word is what bash makes of it
// (`IFS="" read`, `"$#"`), the options of a command come from its argv parse (`read -rd '' f`, `xargs -n 1 -0`),
// and a command in quotes is not run (`echo '$(mktemp)'`).

/** What a command runs, when its name is written plainly (`true`, `"true"`, `\true`). */
const nameOf = (c: SyntaxNode | null | undefined): string | undefined => (c?.type === 'command' && field(c, 'name') ? staticWordValue(field(c, 'name')!.namedChildren[0]) : undefined);
const argsOf = (c: SyntaxNode): SyntaxNode[] => fields(c, 'argument');
/** The values of a command's arguments, undefined where they are not known without running anything. */
const wordsOf = (c: SyntaxNode): (string | undefined)[] => argsOf(c).map((w) => staticWordValue(w));
/** The argv parse of a command (src/argv/), when its name and spec are known. */
const parseOf = (c: SyntaxNode): ArgvParse | undefined => {
  const name = nameOf(c);
  const spec = name === undefined ? undefined : lookupCommand(name);
  return spec && interpret(spec, argsOf(c).map(argWord), { name, lookup: lookupCommand });
};
/** The parses of a command and of the commands it runs with its words (`sudo -u w xargs -0 rm`: sudo's, xargs's, rm's) named `name`. */
const parsesOf = (c: SyntaxNode, name: string): ArgvParse[] => {
  const out: ArgvParse[] = [];
  const visit = (parse: ArgvParse | undefined, n: string | undefined): void => {
    if (!parse) return;
    if (n === name) out.push(parse);
    for (const { role } of parse.roles) if (role.role === 'command') visit(role.parse, role.name);
  };
  visit(parseOf(c), nameOf(c));
  return out;
};
/** The values the option `name` is given, as bash passes them (`-d ''` and `-rd ''` give '', `-rd'' f` gives `f`). */
const optionValues = (c: SyntaxNode, name: string): (string | undefined)[] => {
  const args = argsOf(c);
  return values(parseOf(c)!, name).map((v) => staticWordValue(args[v.word])?.slice(v.at ?? 0));
};
const commandIs = (c: SyntaxNode, ...names: string[]): boolean => names.includes(nameOf(c)!);
/** The tokens of a node (its operators and keywords), in order. */
const tokensOf = (n: SyntaxNode): string[] => n.children.filter((c) => !c.named).map((c) => c.text);

/** A word that is one expansion alone, with or without double quotes around it (`$x`, `"${x}"`). */
const expansionOf = (w: SyntaxNode | undefined): SyntaxNode | undefined => {
  const e = w?.type === 'string' && w.children.length === 3 ? w.namedChildren[0] : w;
  return e?.type === 'simple_expansion' || e?.type === 'expansion' ? e : undefined;
};
/**
 * The parameter a word expands to when it is that parameter alone (`$0`, `"$#"`, `${f}`, `"${BASH_SOURCE[0]}"`),
 * with its subscript; not `${#x}`, `${!x}` or `${x:-y}`, which give other text.
 */
const parameterOf = (w: SyntaxNode | undefined): { name: string; index?: string } | undefined => {
  const e = expansionOf(w);
  if (e?.type === 'simple_expansion') return { name: e.namedChildren[0].text };
  // (`${#}` is `$#`: the adapter reads its `#` as an operator.)
  if (e?.children.length === 3 && e.children[1].text === '#') return { name: '#' };
  if (e?.children.length !== 3 || !e.children[1].named) return undefined;
  const v = e.children[1];
  return v.type === 'subscript' ? { name: field(v, 'name')!.text, index: field(v, 'index')!.text } : { name: v.text };
};
/** The path the script was started by: `$0`, or `$BASH_SOURCE` (its first element) when it is sourced. */
const isScriptPath = (w: SyntaxNode | undefined): boolean => {
  const p = parameterOf(w);
  return !!p && (p.name === '0' ? p.index === undefined : p.name === 'BASH_SOURCE' && (p.index === undefined || p.index === '0'));
};
/** The only command of a `$( )`, when it is one. */
const substitutedCommand = (w: SyntaxNode | undefined): SyntaxNode | undefined => {
  const e = w?.type === 'string' && w.children.length === 3 ? w.namedChildren[0] : w;
  return e?.type === 'command_substitution' && e.namedChildren.length === 1 ? e.namedChildren[0] : undefined;
};
/** Whether `c` is the only command of a `$( )`. */
const isSubstituted = (c: SyntaxNode): boolean => c.parent!.type === 'command_substitution' && c.parent!.namedChildren.length === 1;
/** The arguments after a leading `--` (`dirname -- "$0"`). */
const operandsOf = (c: SyntaxNode): SyntaxNode[] => (wordsOf(c)[0] === '--' ? argsOf(c).slice(1) : argsOf(c));
/** `$(dirname "$0")`, `"$(dirname -- "${BASH_SOURCE[0]}")"`: the directory of the script. */
const isScriptDir = (w: SyntaxNode | undefined): boolean => {
  const c = substitutedCommand(w);
  return !!c && commandIs(c, 'dirname') && operandsOf(c).length === 1 && isScriptPath(operandsOf(c)[0]);
};
/** `cd "$(dirname "$0")"`, `cd -- "$(dirname -- "$0")"`. */
const cdScriptDir = (c: SyntaxNode): boolean => commandIs(c, 'cd') && operandsOf(c).length === 1 && isScriptDir(operandsOf(c)[0]);
const isPwd = (c: SyntaxNode | undefined): boolean => !!c && commandIs(c, 'pwd') && ['', '-P'].includes(wordsOf(c).join(' '));
/**
 * `$(cd "$(dirname "$0")" && pwd)` (or `; pwd`, `pwd -P`, and `cd … &> /dev/null`, which hides only what `cd` prints):
 * the absolute path of the script's directory.
 */
const scriptDirPath = (c: SyntaxNode): boolean => {
  if (!cdScriptDir(c)) return false;
  // (Redirections of `cd` alone leave what `pwd` prints.)
  const st = c.parent!.type === 'redirected_statement' ? c.parent! : c;
  const p = st.parent!;
  if (p.type === 'list') return p.namedChildren[0] === st && tokensOf(p)[0] === '&&' && isPwd(p.namedChildren[1]) && isSubstituted(p);
  return p.type === 'command_substitution' && p.namedChildren.length === 2 && p.namedChildren[0] === st && isPwd(p.namedChildren[1]);
};

/** Where stdout and stderr end up after a statement's redirections, when the targets are plain words. */
const outputsOf = (n: SyntaxNode): { out?: string; err?: string } => {
  const to: { out?: string; err?: string } = {};
  for (const r of fields(n, 'redirect').filter((x) => x.type === 'file_redirect')) {
    const fd = field(r, 'descriptor')?.text ?? '';
    const op = tokensOf(r)[0];
    // (A redirection being typed has no target yet.)
    const target = field(r, 'destination');
    const dest = target && staticWordValue(target);
    // (`>&word` sends both when the word is not a number; `&>` and `&>>` have no descriptor.)
    if (op === '&>' || op === '&>>' || (op === '>&' && fd === '' && !/^\d+$/.test(dest ?? ''))) to.out = to.err = dest;
    else if (op === '>&' && fd === '2' && dest === '1') to.err = to.out;
    else if (op === '>&' && (fd === '' || fd === '1') && dest === '2') to.out = to.err;
    else if (['>', '>>', '>|'].includes(op) && (fd === '' || fd === '1')) to.out = dest;
    else if (['>', '>>', '>|'].includes(op) && fd === '2') to.err = dest;
  }
  return to;
};
/** `command -v jq >/dev/null 2>&1`, `type -P jq &>/dev/null`, `hash jq`, `which jq`: a check that prints nothing. */
const quietCheck = (n: SyntaxNode): boolean => {
  const c = n.type === 'redirected_statement' ? field(n, 'body')! : undefined;
  if (!c || !(commandIs(c, 'which', 'hash') || (commandIs(c, 'command') && has(parseOf(c)!, '-v')) || (commandIs(c, 'type') && has(parseOf(c)!, '-P')))) return false;
  const { out, err } = outputsOf(n);
  return out === '/dev/null' && err === '/dev/null';
};
/** `[[ "${BASH_SOURCE[0]}" == "$0" ]]`, `[ "$0" -ef "$BASH_SOURCE" ]`: whether the script is the one started. */
const runDirectly = (n: SyntaxNode): boolean => {
  const b = n.type === 'extended_test' && n.namedChildren.length === 1 && n.namedChildren[0].type === 'binary_expression' ? n.namedChildren[0] : undefined;
  const [left, op, right] = b ? [field(b, 'left'), field(b, 'operator')!.text, field(b, 'right')]
    : testWords(n)?.length === 3 ? [testWords(n)![0], staticWordValue(testWords(n)![1]), testWords(n)![2]] : [];
  // (`!=` asks the same question: whether it is sourced.)
  if (!['=', '==', '!=', '-ef'].includes(op!)) return false;
  const source = (w: SyntaxNode | undefined) => isScriptPath(w) && parameterOf(w)!.name === 'BASH_SOURCE';
  const zero = (w: SyntaxNode | undefined) => isScriptPath(w) && parameterOf(w)!.name === '0';
  return (source(left) && zero(right)) || (zero(left) && source(right));
};

/**
 * Whether one `set` command turns errexit, nounset and pipefail all on, however the options are written (`-euo`, `-eou`,
 * `-o pipefail -eu`, `-e -u -o pipefail`, `-o errexit -o nounset -o pipefail`…).
 */
const strictMode = (c: SyntaxNode): boolean => {
  if (!commandIs(c, 'set')) return false;
  const words = wordsOf(c);
  const on = new Set<string | undefined>();
  const short: Record<string, string> = { e: 'errexit', u: 'nounset' };
  const set = (name: string | undefined, sign: string) => { if (sign === '-') on.add(name); else on.delete(name); };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === undefined || !/^[-+][a-zA-Z]+$/.test(w)) break;
    // As in bash, each `o` of a bundle takes the next word as an option name, and the other letters still apply.
    for (const letter of w.slice(1)) {
      if (letter === 'o') {
        if (i + 1 < words.length) set(words[++i], w[0]);
      } else if (short[letter]) set(short[letter], w[0]);
    }
  }
  return on.has('errexit') && on.has('nounset') && on.has('pipefail');
};

/** `: "${VAR:?…}"` (`ops` `:?`, `?`), `: "${VAR:=…}"` (`:=`, `=`): the null command, run for the expansion of its first word. */
const colonExpansion = (...ops: string[]) => (c: SyntaxNode): boolean => {
  const e = commandIs(c, ':') ? expansionOf(argsOf(c)[0]) : undefined;
  return e?.type === 'expansion' && e.children[1].type === 'variable_name' && ops.includes(e.children[2].text);
};
/** `cmd || true`, `cmd || :`. */
const orTrue = (n: SyntaxNode): boolean => n.type === 'list' && tokensOf(n)[0] === '||' && commandIs(n.namedChildren[1], 'true', ':') && !argsOf(n.namedChildren[1]).length;
/**
 * `trap 'rm -f "$tmp"' EXIT`: an action for EXIT. Not `trap - EXIT` and `trap '' EXIT`, which take the action away,
 * nor `trap -p EXIT`, which prints it.
 */
const exitTrap = (c: SyntaxNode): boolean => {
  if (!commandIs(c, 'trap')) return false;
  const words = wordsOf(c);
  const at = words[0] === '--' ? 1 : 0;
  const action = words[at];
  // (bash takes `exit` in any case, and a number that is 0 (`00`, ` 0`, `+0`), for EXIT.)
  return words.length > at + 1 && !(action !== undefined && (action === '' || action.startsWith('-')))
    && words.slice(at + 1).some((w) => w !== undefined && (w.toUpperCase() === 'EXIT' || (/^\s*[-+]?\d+\s*$/.test(w) && Number(w) === 0)));
};
/** `exec > >(tee -a log) 2>&1`: from here on, stdout goes through `tee` (or `logger`). `>>` and `&>>` do the same: a pipe has no end to append to. */
const execTee = (n: SyntaxNode): boolean => {
  const c = n.type === 'redirected_statement' ? field(n, 'body')! : undefined;
  return !!c && commandIs(c, 'exec') && !argsOf(c).length && fields(n, 'redirect').some((r) => {
    const fd = field(r, 'descriptor')?.text ?? '';
    const dest = field(r, 'destination');
    return r.type === 'file_redirect' && (['&>', '&>>'].includes(tokensOf(r)[0]) || (['>', '>>'].includes(tokensOf(r)[0]) && (fd === '' || fd === '1')))
      && dest?.type === 'process_substitution' && commandIs(dest.namedChildren[0], 'tee', 'logger');
  });
};
/** `shift $((OPTIND-1))`, `shift "$(( OPTIND - 1 ))"`. */
const shiftOptind = (c: SyntaxNode): boolean => {
  const w = commandIs(c, 'shift') && argsOf(c).length === 1 ? argsOf(c)[0] : undefined;
  const a = w?.type === 'string' && w.children.length === 3 ? w.namedChildren[0] : w;
  const e = a?.type === 'arithmetic_expansion' ? a.namedChildren[0] : undefined;
  return e?.type === 'binary_expression' && field(e, 'left')!.text === 'OPTIND' && field(e, 'operator')!.text === '-' && field(e, 'right')?.text === '1';
};
/** `args=$(getopt -o ab: -- "$@")`. */
const getoptArgs = (c: SyntaxNode): boolean => commandIs(c, 'getopt') && isSubstituted(c) && argsOf(c).some((w) => w.type === 'string' && parameterOf(w)?.name === '@');
/** `eval set -- "$args"`. */
const evalSet = (c: SyntaxNode): boolean => commandIs(c, 'eval') && argsOf(c).length > 2 && wordsOf(c).slice(0, 2).join(' ') === 'set --';
/** `while [ $# -gt 0 ]`, `while (( $# ))`: a loop over the arguments. (`[ $# > 0 ]` is `[ $# ]` with stdout to the file `0`: always true.) */
const argsLoop = (n: SyntaxNode): boolean => {
  const c = whileOf(n) && field(n, 'condition');
  const count = (w: SyntaxNode | undefined) => parameterOf(w)?.name === '#';
  const zero = (w: SyntaxNode | undefined) => staticWordValue(w!) === '0';
  const words = c && testWords(c);
  if (words) {
    const [left, op, right] = words;
    return words.length === 3 && count(left) && ['-gt', '-ne', '!='].includes(staticWordValue(op)!) && zero(right);
  }
  const e = (c?.type === 'extended_test' || c?.type === 'arithmetic_command') && c.namedChildren.length === 1 ? c.namedChildren[0] : undefined;
  if (c?.type === 'arithmetic_command' && count(e)) return true;
  return e?.type === 'binary_expression' && count(field(e, 'left')) && zero(field(e, 'right'))
    && (c!.type === 'arithmetic_command' ? ['>', '!='] : ['-gt', '-ne', '!=', '>']).includes(field(e, 'operator')!.text);
};
/** `[ -e "$f" ] || continue`: a test of a name, and `continue` when it is not there. */
const globGuard = (n: SyntaxNode): boolean => {
  if (n.type !== 'list' || tokensOf(n)[0] !== '||' || !commandIs(n.namedChildren[1], 'continue') || argsOf(n.namedChildren[1]).length) return false;
  const t = n.namedChildren[0];
  const u = t.type === 'extended_test' && t.namedChildren[0].type === 'unary_expression' ? t.namedChildren[0] : undefined;
  const [op, operand] = u ? [field(u, 'operator')!.text, u.namedChildren[1]]
    : testWords(t)?.length === 2 ? [staticWordValue(testWords(t)![0]), testWords(t)![1]] : [];
  return ['-e', '-f'].includes(op!) && /^\w+$/.test(parameterOf(operand)?.name ?? '');
};

/** The words of `[ … ]` (by its spelling, closed with `]`) between the brackets; undefined for any other node. */
const testWords = (n: SyntaxNode): SyntaxNode[] | undefined => {
  if (!writtenAsBracket(n)) return undefined;
  const b = bracketWords(n);
  return b.close ? b.words : undefined;
};

/** A statement's shape in the tree. */
type Shape = (n: SyntaxNode) => boolean;
/** `IFS=`, `IFS=''`: an assignment of the empty string. */
const emptyValue = (a: SyntaxNode): boolean => {
  const v = field(a, 'value');
  return !v || staticWordValue(v) === '';
};
/** A shape of a command. */
const command = (test: (c: SyntaxNode) => boolean): Shape => (n) => n.type === 'command' && test(n);

// (`until` is a `while_statement` too, with that keyword first.)
const whileOf = (n: SyntaxNode): SyntaxNode | undefined => (n.type === 'while_statement' && n.children[0].type === 'while' ? n : undefined);
/** `while true`, `while :`: a loop whose only condition is that command. */
const endless = (n: SyntaxNode): boolean => {
  const w = whileOf(n);
  const c = w && field(w, 'condition');
  return !!c && c.type === 'command' && ['true', ':'].includes(nameOf(c)!) && c.namedChildren.length === 1;
};
/** `while … read … done < file` (`process`: `< <(command)`): the loop is redirected, and a command in it reads. */
const readLoop = (process: boolean) => (n: SyntaxNode): boolean => {
  const body = n.type === 'redirected_statement' ? field(n, 'body') : undefined;
  if (body?.type !== 'while_statement') return false;
  const redirects = n.namedChildren.filter((c) => c.type === 'file_redirect');
  const r = redirects.length === 1 ? redirects[0] : undefined;
  if (!r || !/^<(?!<)/.test(r.text) || (field(r, 'destination')?.type === 'process_substitution') !== process) return false;
  return descendants(body, ['command']).some((c) => nameOf(c) === 'read');
};
const loopCommand = (name: string) => (n: SyntaxNode): boolean => {
  const w = whileOf(n);
  return nameOf(w && field(w, 'condition')) === name;
};

interface Idiom {
  test: Shape;
  ja: string;
  en: string;
  /** Not reported when this other idiom (by index) is found, e.g. a `cd` that is part of a larger idiom. */
  unless?: number;
}

/** Well-known patterns, found in the tree of a statement. */
const IDIOMS: Idiom[] = [
  {
    test: command((c) => commandIs(c, 'read') && c.namedChildren.some((a) => a.type === 'variable_assignment' && field(a, 'name')!.text === 'IFS' && emptyValue(a)) && has(parseOf(c)!, '-r')),
    ja: '`IFS= read -r`: 1行を加工せずそのまま読む（`IFS=` で前後の空白を取り除かせず、`-r` でバックスラッシュをそのまま残す）',
    en: '`IFS= read -r`: reads a line exactly as is (`IFS=` keeps surrounding spaces, `-r` keeps backslashes)',
  },
  {
    test: command(scriptDirPath),
    ja: 'スクリプトが置かれているディレクトリの絶対パスを得る（どこから実行しても同じ場所を指せる）',
    en: 'gets the absolute path of the directory the script lives in (the same wherever it is run from)',
  },
  {
    test: command(cdScriptDir),
    unless: 1,
    ja: 'スクリプトが置かれているディレクトリに移動する（どこから実行しても相対パスが同じように使える）',
    en: 'moves to the directory the script lives in (so relative paths work wherever it is run from)',
  },
  {
    test: quietCheck,
    ja: 'コマンドがインストールされているかを、出力を出さずに確かめる',
    en: 'checks quietly whether a command is installed',
  },
  {
    test: runDirectly,
    ja: 'スクリプトが直接実行されたか（`source` で読み込まれたのではないか）を判定する（Python の `if __name__ == "__main__"` に相当）',
    en: 'checks whether the script is run directly rather than sourced (like Python\'s `if __name__ == "__main__"`)',
  },
  {
    test: command(strictMode),
    ja: '安全なスクリプトのための定番設定（strict mode）: エラーで止まる、未定義の変数をエラーにする、パイプの途中の失敗も見逃さない',
    en: 'the usual "strict mode": stop on errors, treat unset variables as errors, and catch failures inside pipelines',
  },
  {
    test: command(colonExpansion(':?', '?')),
    ja: '`: "${VAR:?…}"`: 必須の変数が設定されているか確かめる（未設定ならメッセージを出して終了。`:` は何もしないコマンド）',
    en: '`: "${VAR:?…}"`: checks that a required variable is set (exits with the message if not; `:` does nothing itself)',
  },
  {
    test: command(colonExpansion(':=', '=')),
    ja: '`: "${VAR:=…}"`: 変数が未設定か空なら既定値を代入する（`:=` の場合。`=` だけなら未設定のときだけ。`:` は何もしないコマンドで、展開だけを行わせる）',
    en: '`: "${VAR:=…}"`: assigns a default if the variable is unset or empty (with `:=`; plain `=` only when unset; `:` does nothing, only the expansion matters)',
  },
  {
    test: orTrue,
    ja: '`|| true`: 失敗しても終了ステータスを成功にする（`set -e` でスクリプトが止まらないようにする）',
    en: '`|| true`: turns a failure into success (so `set -e` does not stop the script)',
  },
  {
    test: command(exitTrap),
    ja: '`trap … EXIT`: スクリプトがどう終わっても（エラーでも）最後に後片付けを実行する',
    en: '`trap … EXIT`: runs clean-up when the script exits, however it exits',
  },
  {
    test: execTee,
    ja: '以降のすべての出力を画面に出しつつ、ログにも保存する',
    en: 'from here on, everything printed also goes to a log',
  },
  {
    test: endless,
    ja: '無限ループ（`break` や `exit` で抜ける）',
    en: 'an endless loop (left with `break` or `exit`)',
  },
  {
    test: command((c) => commandIs(c, 'mktemp') && isSubstituted(c)),
    ja: '`mktemp`: 他と重ならない一時ファイル（-d ならディレクトリ）を安全に作る',
    en: '`mktemp`: safely creates a unique temporary file (or directory with -d)',
  },
  {
    test: readLoop(false),
    ja: '`while read … done < ファイル`: ファイルを1行ずつ読んで処理する（ループ全体の標準入力がそのファイルになる）。最後の行の末尾に改行がないと、その行は読まれずに終わる（`while read -r line || [ -n "$line" ]` とすれば読める）',
    en: '`while read … done < file`: reads a file line by line (the file is the stdin of the whole loop). A last line with no newline at its end is skipped, unless the loop is `while read -r line || [ -n "$line" ]`',
  },
  {
    test: readLoop(true),
    ja: '`while read … done < <(コマンド)`: コマンドの出力を1行ずつ読んで処理する。`コマンド | while read …` と違い、ループがカレントシェルで動くので、中で代入した変数がループのあとも残る。最後の行の末尾に改行がないと、その行は読まれずに終わる（`|| [ -n "$line" ]` を足せば読める）',
    en: '`while read … done < <(command)`: reads the output of a command line by line. Unlike `command | while read …`, the loop runs in the current shell, so variables set in it are still there after the loop. A last line with no newline at its end is skipped, unless `|| [ -n "$line" ]` is added',
  },
  {
    test: loopCommand('getopts'),
    ja: '`while getopts`: 短いオプション（`-a`、値つきの `-b 値`）を1つずつ読む。オプションの文字は変数に、値は `$OPTARG` に入る。最初のオプションでない語で読み取りが止まるので、オプションは引数より前に置く',
    en: '`while getopts`: reads short options (`-a`, `-b value`) one at a time: the letter goes to the variable, the value to `$OPTARG`. It stops at the first word that is not an option, so options must come before the operands',
  },
  {
    test: command(shiftOptind),
    ja: '`shift $((OPTIND-1))`: `getopts` で読み終えたオプションを取り除き、`$1` を最初の引数にする。関数の中で `getopts` を使うなら、先に `local OPTIND=1` としておく（さもないと2回目の呼び出しが前回の続きから始まり、何も読まない）',
    en: '`shift $((OPTIND-1))`: drops the options `getopts` has read, so `$1` is the first operand. In a function that uses `getopts`, set `local OPTIND=1` first, or a second call starts where the first stopped and reads nothing',
  },
  {
    test: loopCommand('getopt'),
    ja: '`getopt`（`s` なし）は組み込みの `getopts` とは別の外部コマンドで、整えた引数を表示して終わる。1つずつ読むループにはならない（組み込みは `getopts`）',
    en: '`getopt` (no `s`) is an external program, not the builtin `getopts`: it prints the rewritten arguments and exits, so it cannot drive a loop that reads one option at a time (the builtin is `getopts`)',
  },
  {
    test: command(getoptArgs),
    ja: '`getopt`（GNU/util-linux）: 引数を整えた形に書き直す（`-ab` は `-a -b` に、`--long=値` は `--long 値` に分け、最後に `--` を付ける）。あとの `case` が `$1` だけ見ればよくなる。終了ステータスを見ること（不正なオプションなら失敗する）。`local args=$(getopt …)` では失敗が隠れる',
    en: '`getopt` (GNU/util-linux): rewrites the arguments into a fixed form (`-ab` becomes `-a -b`, `--long=v` becomes `--long v`, and `--` ends them), so a `case` only has to look at `$1`. Check its exit status (it fails on a bad option); `local args=$(getopt …)` hides the failure',
  },
  {
    test: command(evalSet),
    ja: '`eval set -- "$args"`: `getopt` が整えた引数（クォート済み）を、このスクリプトの位置パラメータ `$1 $2 …` に入れ直す。`"$args"` は必ずダブルクォートで囲む',
    en: '`eval set -- "$args"`: puts the arguments that `getopt` rewrote (and quoted) back into `$1 $2 …`. Keep `"$args"` in double quotes',
  },
  {
    test: argsLoop,
    ja: '引数を先頭から順に読むループ（ふつうは `case` で `$1` を調べ、最後に `shift` で1つ進める）。値をとるオプションは `shift 2` が要る。`shift` を忘れると、ループが終わらない',
    en: 'a loop over the arguments (usually a `case` on `$1`, then `shift` to move on). An option that takes a value needs `shift 2`; without any `shift` the loop never ends',
  },
  {
    test: command((c) => commandIs(c, 'read') && optionValues(c, '-d').includes('')),
    ja: '`read -d \'\'`: NUL（バイト 0）までを1項目として読む。`find -print0` と組み合わせると、空白や改行を含む名前も安全に扱える。区切りは `-d \'\'` と書く（`-d \'\\0\'` では区切りが `\\` になり、何も読めない）',
    en: '`read -d \'\'`: reads up to a NUL byte as one item. With `find -print0`, names containing spaces or newlines are safe. Write the delimiter as `-d \'\'` (`-d \'\\0\'` makes `\\` the delimiter, and nothing is read)',
  },
  {
    test: command((c) => parsesOf(c, 'find').some((p) => p.roles.some(({ word, role }) => role.role === 'expression' && staticWordValue(argsOf(c)[word]) === '-print0'))),
    ja: '`find -print0`: 名前を改行でなく NUL で区切って出力する。受け取る側も NUL を読むこと（`xargs -0`、`read -d \'\'`）。改行区切りのままだと、空白や改行を含む名前が壊れる',
    en: '`find -print0`: separates the names with a NUL byte instead of a newline. The reader must read NUL too (`xargs -0`, `read -d \'\'`); with newlines, names containing spaces or newlines break',
  },
  {
    test: command((c) => parsesOf(c, 'xargs').some((p) => has(p, '-0'))),
    ja: '`xargs -0`: 入力を NUL 区切りで読む（`find -print0` と組み合わせる）。付けないと、空白やクォートを含む名前が分割されたり壊れたりする',
    en: '`xargs -0`: reads its input separated by NUL bytes (pair it with `find -print0`). Without it, names with spaces or quotes are split or mangled',
  },
  {
    test: (n) => n.type === 'while_statement' && n.children[0].type === 'until',
    ja: '`until コマンド`: コマンドが失敗する間、くり返す（成功したら止まる。`while` の逆）。何かの準備ができるのを待つときに使う。回数や時間の上限がないと、永久に終わらないことがある',
    en: '`until command`: repeats while the command fails and stops when it succeeds (the opposite of `while`). Used to wait for something to be ready. With no limit on tries or time, it can run forever',
  },
  {
    test: command((c) => commandIs(c, 'mapfile', 'readarray')),
    ja: '`mapfile`（`readarray`）: 入力の各行を配列の要素に入れる。`-t` で行末の改行を取り除く（付けないと各要素が改行で終わる）。`コマンド | mapfile` は配列が消える（サブシェルで動く）ので、`mapfile -t 配列 < <(コマンド)` と書く',
    en: '`mapfile` (`readarray`): reads each line of the input into an array element. `-t` strips the trailing newline (without it, each element ends with one). `command | mapfile` loses the array (it runs in a subshell); write `mapfile -t arr < <(command)`',
  },
  {
    test: globGuard,
    ja: '存在しない名前を飛ばす。`for f in *.txt` で何にも一致しないと、bash は `*.txt` をそのまま残し、ループが存在しない名前で1回まわる。その対策（`shopt -s nullglob` でも防げる）',
    en: 'skips a name that does not exist. When `for f in *.txt` matches nothing, bash keeps `*.txt` as it is and the loop runs once with that text. This guards against it (`shopt -s nullglob` does too)',
  },
  {
    test: command((c) => commandIs(c, 'read') && optionValues(c, '-p').some((p) => p !== undefined && /\b[yY](es)?\/[nN](o)?\b/.test(p))),
    ja: 'はい／いいえの確認。`[y/N]` の大文字は、Enter だけのときの既定値という慣習で、空の答えをその既定値として扱うのは続くコードの役目。`-p` の表示は、標準入力が端末のときだけ出る',
    en: 'a yes/no question. The capital letter in `[y/N]` is only a convention for the default on a bare Enter: the code after it must treat an empty answer that way. The `-p` prompt is shown only when stdin is a terminal',
  },
];

/** Notes for the idioms found in the given statements, without duplicates. */
export function findIdioms(statements: readonly SyntaxNode[], lang: Lang): string[] {
  const s = pick(lang);
  const found = IDIOMS.map((idiom) => statements.some((n) => idiom.test(n)));
  return IDIOMS.filter((idiom, i) => found[i] && !(idiom.unless !== undefined && found[idiom.unless]))
    .map((idiom) => s(`定番の書き方: ${idiom.ja}`, `Idiom: ${idiom.en}`));
}
