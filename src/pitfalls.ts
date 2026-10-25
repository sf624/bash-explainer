import type { Shell } from './dialect';
import { lookupCommand } from './dict/aliases';
import { Lang } from './i18n';
import { resolveName } from './semantics/names';
import type { StateModel } from './semantics/state';
import { descendants, field, fields } from './syntax/tree';
import type { SyntaxNode } from './syntax/tree';
import { bracketWords, writtenAsBracket } from './testexpr';
import { staticWordValue, unquoteWord } from './staticword';
import { parseExpansion } from './expansion';
import { quoteExpansions } from './fixes';
import { marked, type Note, type NoteLevel } from './messages';

// Style checks: common mistakes in how a script is written (`[-f x]`, `x = 1`, `{echo`, a `}` without `;`,
// `rm -rf $DIR/…`, `read` without `-r`, `<` and `>` or a missing `]` inside `[ ]`), explained where they appear: what
// goes wrong and how to write it instead. Each is found from the syntax tree, and only on the line where its node
// starts. The pitfalls that state what the shell does with a word, from the models, are facts with a catalog entry
// (src/wordfacts.ts, src/messages.ts), not here.

const pick = (lang: Lang) => (ja: string, en: string) => (lang === 'ja' ? ja : en);

/** The variable an expansion reads (`DIR` for `$DIR` or `${DIR}`), when it is a plain one. */
function varName(n: SyntaxNode): string | undefined {
  const v = n.namedChildren.find((c) => c.type === 'variable_name');
  return v?.text;
}

/**
 * The variable an `rm -r` word starts with when an empty value leaves a path from the root (`$DIR/*`, `"$DIR"/*`,
 * `"${DIR}/x"`, `"$DIR/"*`, `"$DIR""/x"`): the expansion, its name, what is left (`/*`), and whether it is the plain
 * value (`$v`, `${v}`, `${v:-}`), which `${v:?}` can stand for. Not for an expansion that is never empty (`${#v}`,
 * `${v:-x}`, `${v:?}`), nor HOME and PWD, which are always set.
 */
function rootTarget(w: SyntaxNode): { e: SyntaxNode; v: string; left: string; plain: boolean; check?: string } | undefined {
  const first = w.type === 'concatenation' ? w.namedChildren[0] : w.type === 'string' ? w : undefined;
  if (!first) return undefined;
  // In quotes, the expansion right after the opening quote; a string of only it is skipped over (`"$DIR""/x"`).
  const inner = first.type === 'string' ? first.namedChildren[0] : first;
  if (!inner || inner.startIndex !== first.startIndex + (first === inner ? 0 : 1)) return undefined;
  if (inner.type !== 'simple_expansion' && inner.type !== 'expansion') return undefined;
  const sub = inner.namedChildren.find((c) => c.type === 'subscript');
  const special = inner.namedChildren.find((c) => c.type === 'special_variable_name');
  const all = special ? ['@', '*'].includes(special.text) : ['@', '*'].includes(sub?.namedChildren[1]?.text ?? '');
  const alone = first !== inner && first.namedChildren.length === 1 && first.text === `"${inner.text}"`;
  const left = alone ? w.text.slice(first.endIndex - w.startIndex) : (first !== inner ? '"' : '') + w.text.slice(inner.endIndex - w.startIndex);
  if (!/^["']?\//.test(left)) return undefined;
  // `$@`, `$*`, `${a[@]}`, `${!a[@]}`: no words at all when there are none (`set --`, `a=()`); a check counts them.
  if (all) {
    const p = inner.type === 'expansion' ? parseExpansion(inner.text) : undefined;
    if (p?.op) return undefined;
    const name = sub?.namedChildren[0].text;
    return { e: inner, v: inner.text, left, plain: false, check: name ? `[ "\${#${name}[@]}" -gt 0 ] || exit 1` : '[ "$#" -gt 0 ] || exit 1' };
  }
  if (special) return undefined;
  // An element, `${a[0]}`, is named with its subscript.
  const v = sub ? sub.text : varName(inner);
  if (!v || ['HOME', 'PWD'].includes(v)) return undefined;
  const ref = /^\w+$/.test(v) ? `$${v}` : `\${${v}}`;
  // Inside `"…"` of a check, a quote or backslash in the expansion means something else than where it stands: no check then.
  const quotable = !/['"\\]/.test(inner.text);
  const gen = (plain: boolean) => ({ e: inner, v, left, plain, check: quotable ? `[ -n "${plain ? ref : inner.text}" ] || exit 1` : undefined });
  if (inner.type === 'simple_expansion') return gen(true);
  const p = parseExpansion(inner.text);
  if (!p || p.prefix === '#') return undefined;
  const word = p.parts.find((q) => q.role === 'word')?.text ?? '';
  // What the default word is after quote removal, where the expansion stands (`''` and `""` are empty, `"lit"` is `lit`);
  // undefined when it holds an expansion.
  const value = unquoteWord(word.replace(/\$'([^'\\]*)'/g, "'$1'"), first.type === 'string');
  if (!p.prefix && (!p.op || (['-', ':-', '=', ':='].includes(p.op) && value === ''))) return gen(true);
  // Never empty: an error when empty, or a default of literal text when empty. (`${v-x}` is empty when v is set
  // and empty; `${v:+x}` when v is empty; `${v:-$w}` when w is empty too.)
  if (p.op === ':?' || ((p.op === ':-' || p.op === ':=') && value)) return undefined;
  // `${v%…}`, `${v/…}`, `${v:1}`, `${v:+x}`, `${v@Q}` (unset v), `${!v}`…: may be empty, with no form that `:?` can stand for.
  return gen(false);
}

/** The command the name of the simple command `n` runs, as the checks read it (see `pathCommand`). */
export function commandName(n: SyntaxNode): string | undefined {
  const name = field(n, 'name')?.text;
  return name === undefined ? undefined : pathCommand(name);
}

/**
 * The command a name runs, as the checks read it: the name itself; for a path, the program of its last part when the
 * dictionary knows it (`/bin/rm` is rm, as the explanation reads it), else none. A path runs that file, never a builtin
 * (3.7.2): `./read` is not `read`, nor `./cd` the `cd` builtin.
 */
export function pathCommand(name: string): string | undefined {
  if (!name.includes('/')) return name;
  const spec = lookupCommand(name);
  return spec && !spec.builtin ? name.slice(name.lastIndexOf('/') + 1) : undefined;
}

export function args(n: SyntaxNode): SyntaxNode[] {
  return fields(n, 'argument');
}

/** The codes of the style checks, as diagnostics show them (`# bash-explainer disable=<code>`). */
export type StyleCode = 'bracket-no-space' | 'assignment-with-spaces' | 'brace-no-space' | 'brace-close-no-separator'
  | 'rm-empty-variable-root' | 'read-without-r' | 'redirect-in-bracket' | 'bracket-close-in-word' | 'and-or-in-bracket';

/**
 * The level of each style check (src/messages.ts, `NoteLevel`): `warning` when the line breaks as written, `info` when
 * it breaks only with some input (`read` without `-r` and a backslash).
 */
export const STYLE_LEVELS: Record<StyleCode, NoteLevel> = {
  'bracket-no-space': 'warning', 'assignment-with-spaces': 'warning', 'brace-no-space': 'warning', 'brace-close-no-separator': 'warning',
  'rm-empty-variable-root': 'warning', 'read-without-r': 'info', 'redirect-in-bracket': 'warning', 'bracket-close-in-word': 'warning',
  'and-or-in-bracket': 'warning',
};

/** A style check found: its code, the node it is about, its level and its note. */
/** A style check found on a node: its note, whose code is the check's. */
export interface StyleFinding extends Note { code: StyleCode; node: SyntaxNode }

/** Notes for the pitfalls whose node starts on `line`. */
export function pitfallNotes(root: SyntaxNode, line: number, lang: Lang, model: StateModel, shell: Shell | undefined): string[] {
  return [...new Set(pitfallFindings(root, lang, line, line, model, shell).map((f) => f.text))];
}

/**
 * Whether the variable `name` has a value with some static text in it where `at` runs, on every path, as far as the
 * model may be relied on (`DIR=/opt/app`, `B="$S/build"`): then it is never empty there.
 */
function neverEmpty(model: StateModel, name: string, at: SyntaxNode): boolean {
  const v = model.at(at).run.variables.get(name);
  if (!v || v.set !== 'on' || !model.trusts(name)) return false;
  return v.value !== undefined ? v.value !== '' : !!v.source && hasStaticText(v.source);
}

/** Whether a word has text of its own, outside its expansions (`"$S/build"`, `${S}x`, `'a'`). */
function hasStaticText(n: SyntaxNode): boolean {
  switch (n.type) {
    case 'word': case 'string_content': return n.text !== '';
    case 'raw_string': return n.text.length > 2;
    case 'string': case 'concatenation': return n.namedChildren.some(hasStaticText);
    default: return false;
  }
}

/**
 * Whether the command name `name` at `at` runs something that takes `=` as an argument: a function, an alias, a
 * builtin (`export = x`), or a program the dictionary knows (`sed = f`, `echo ===`). Not a name the dictionary does
 * not know, which is most likely a variable (`x = 1`).
 */
function runsCommand(model: StateModel, name: string, at: SyntaxNode, shell: Shell | undefined): boolean {
  const r = resolveName(model, name, at, { shell, command: true, program: (p) => !!lookupCommand(p) });
  return r.kind !== 'file' || r.known || !!r.sourced;
}

/** The style checks whose node starts on a line from `from` to `to`, in one walk of the tree, with the model of the tree and its shell. */
export function pitfallFindings(root: SyntaxNode, lang: Lang, from: number, to: number, model: StateModel, shell: Shell | undefined): StyleFinding[] {
  const s = pick(lang);
  const found: StyleFinding[] = [];
  const add = (code: StyleCode, node: SyntaxNode, ja: string, en: string) => {
    found.push({ ...marked(lang, STYLE_LEVELS[code], s(ja, en), { kind: 'pitfall' }), code, node });
  };
  const visit = (n: SyntaxNode) => {
    if (n.startPosition.row >= from && n.startPosition.row <= to) check(n);
    if (n.startPosition.row <= to && n.endPosition.row >= from) for (const c of n.namedChildren) visit(c);
  };

  const check = (n: SyntaxNode) => {
    switch (n.type) {
      case 'command': {
        if (writtenAsBracket(n)) bracket(n);
        const name = commandName(n);
        const a = args(n);
        // `[-f x]`: the name is one word, `[-f`.
        if (name && /^\[[^\]]/.test(name) && a.at(-1)?.text.endsWith(']')) {
          add('bracket-no-space', field(n, 'name')!, `\`[\` は普通のコマンドなので、あとに空白が要ります（\`${name}\` は別のコマンド名になる）。\`[ ${name.slice(1)} …\` のように書きます`,
            `\`[\` is an ordinary command, so a space must follow it (\`${name}\` reads as another command name). Write \`[ ${name.slice(1)} …\``);
        }
        // `x = 1`: a command named x, not an assignment.
        if (name && /^[A-Za-z_]\w*$/.test(name) && a.length && (a[0].text === '=' || /^=\S/.test(a[0].text)) && !runsCommand(model, name, field(n, 'name')!, shell)) {
          add('assignment-with-spaces', n, `\`${name} ${a[0].text}…\` は代入ではなく、\`${name}\` というコマンドを実行します。代入は \`=\` の前後に空白を入れずに \`${name}=…\` と書きます`,
            `\`${name} ${a[0].text}…\` runs a command named \`${name}\`; it is not an assignment. Write \`${name}=…\` with no spaces around \`=\``);
        }
        // `{echo a;}`: no space after `{`, so it is a command named `{echo`.
        if (name && /^\{[A-Za-z_]\w*$/.test(name)) {
          add('brace-no-space', field(n, 'name')!, `\`${name}\` は \`{\` の直後に空白がないので、グループの開始ではなく \`${name}\` というコマンド名です。\`{\` の後には空白が必要で、\`}\` の前には \`;\` か改行が必要です: \`{ ${name.slice(1)} …; }\``,
            `there is no space after \`{\`, so \`${name}\` is a command name, not the start of a group. \`{\` needs a space after it, and \`}\` needs a \`;\` or newline before it: \`{ ${name.slice(1)} …; }\``);
        }
        // `{ echo a; echo b }`: `}` is an argument of the last command, and the group is never closed. (Not in zsh, where
        // a `}` closes the group anywhere unless IGNORE_CLOSE_BRACES is set: zshoptions.)
        const lastArg = a[a.length - 1];
        if (shell !== 'zsh' && lastArg?.type === 'word' && lastArg.text === '}' && n.parent?.type === 'compound_statement' && n.parent.incomplete) {
          add('brace-close-no-separator', lastArg, `\`}\` の前に \`;\` か改行が必要です。このままでは \`}\` は \`${name}\` の引数で、\`{ }\` のグループが閉じていません: \`{ …; }\``,
            `\`}\` needs a \`;\` or a newline before it. As written, \`}\` is an argument of \`${name}\` and the \`{ }\` group is never closed: \`{ …; }\``);
        }
        // `rm -rf $DIR/…`: an empty DIR removes from the root.
        if (name === 'rm' && a.some((w) => /^-[a-zA-Z]*[rR]/.test(w.text) || w.text === '--recursive')) {
          for (const w of a) {
            const t = rootTarget(w);
            if (!t) continue;
            const { e, v, left } = t;
            // (Nor a plain value the script surely set to some text: `DIR=/opt/app; rm -rf $DIR/*`.)
            if (t.plain && neverEmpty(model, v, e)) continue;
            const safe = t.plain && quoteExpansions(w, new Map([[e, `\${${v}:?}`]]));
            if (safe) {
              add('rm-empty-variable-root', w, `\`${v}\` が空だと \`rm -r ${left}\` になり、ルートから削除してしまいます。\`${safe}\` と書くと、空のときは止まります`,
                `if \`${v}\` is empty this becomes \`rm -r ${left}\`, deleting from the root. Write \`${safe}\` to stop when it is empty`);
            } else {
              // `${DIR%/}` has no form with `:?` (and is empty for DIR=/ too); `${x:-*.txt}` has no quoted form.
              const what = t.plain ? v : e.text;
              if (t.check) {
                add('rm-empty-variable-root', w, `\`${what}\` が空だと \`rm -r ${left}\` になり、ルートから削除してしまいます。前に \`${t.check}\` と書くと、空のときは止まります`,
                  `if \`${what}\` is empty this becomes \`rm -r ${left}\`, deleting from the root. Write \`${t.check}\` before it to stop when it is empty`);
              } else {
                // (A quote or backslash in the expansion: a check in quotes would not read it the same.)
                add('rm-empty-variable-root', w, `\`${what}\` が空だと \`rm -r ${left}\` になり、ルートから削除してしまいます。空でないことを前に確かめてください`,
                  `if \`${what}\` is empty this becomes \`rm -r ${left}\`, deleting from the root. Check that it is not empty before it`);
              }
            }
            break;
          }
        }
        // `read` without -r eats backslashes.
        // Only when it reads into a variable; `read` alone or `read -n 1` waits for a key. Only the builtin: not a
        // function of that name (src/semantics/names.ts).
        const readsVar = a.some((w) => /^[A-Za-z_]\w*$/.test(w.text));
        if (name === 'read' && readsVar && !a.some((w) => /^-[a-zA-Z]*[rnN]/.test(w.text)) && resolveName(model, name, field(n, 'name')!, { shell, command: true }).kind === 'builtin') {
          add('read-without-r', n, '`-r` を付けないと、入力のバックスラッシュ（`\\`）がエスケープとして消えます。ふつうは `read -r` と書きます',
            'without `-r`, backslashes in the input are taken as escapes and lost. Usually write `read -r`');
        }
        break;
      }
    }
  };

  /** `[ … ]`, by its spelling: what goes wrong in how it is written. */
  const bracket = (n: SyntaxNode) => {
    // `[ $a < $b ]`, `[ 5>3 ]`: `<` and `>` are redirections of the command `[`. (Not those after its last word,
    // `[ … ] >f`, nor those plainly meant as redirections: to a device, `2>/dev/null`, or a copy of a descriptor, `2>&1`.)
    const end = args(n).at(-1)?.startIndex ?? -1;
    const meant = (e: SyntaxNode) => /&/.test(e.children.find((c) => !c.named)!.type) || /^\/dev\//.test(field(e, 'destination')?.text ?? '');
    const redirect = n.namedChildren.find((e) => e.type === 'file_redirect' && !meant(e) && e.startIndex > field(n, 'name')!.startIndex && e.startIndex < end);
    if (redirect) {
      add('redirect-in-bracket', redirect, `\`[ ]\` の中の \`${redirect.text.match(/^\d*[<>]+/)![0]}\` は比較ではなくリダイレクトとして読まれます。文字列の順序の比較は \`[[ ]]\` を使うか、\`\\${redirect.text.match(/[<>]/)![0]}\` とエスケープします`,
        `\`${redirect.text.match(/^\d*[<>]+/)![0]}\` inside \`[ ]\` is read as a redirection, not a comparison. Use \`[[ ]]\` to compare strings by order, or escape it as \`\\${redirect.text.match(/[<>]/)![0]}\``);
    }
    const { words, close } = bracketWords(n);
    const last = words[words.length - 1];
    const next = n.parent?.children[n.parent.children.indexOf(n) + 2];
    const sep = n.parent?.children[n.parent.children.indexOf(n) + 1];
    if (!close && last && /[^\s]\]$/.test(last.text)) {
      // `[ -f $x]`. (With a last word of known text, `[ -f x]`, the analyzer says it: `bracket-close-glued`.)
      if (staticWordValue(last) !== undefined) return;
      add('bracket-close-in-word', last, `\`${last.text}\` の \`]\` は単語の一部として読まれ、閉じの \`]\` がありません（\`missing ']'\`）。\`]\` の前に空白が要ります`,
        `the \`]\` in \`${last.text}\` is read as part of the word, so \`[\` has no closing \`]\` ("missing ']'"). \`]\` needs a space before it`);
    } else if (!close && (sep?.type === '&&' || sep?.type === '||') && next?.type === 'command' && args(next).at(-1)?.text === ']') {
      // `[ a && b ]`
      add('and-or-in-bracket', sep, `\`[ ]\` の中の \`${sep.type}\` は \`[\` の引数ではなく、コマンドをつなぐ演算子です。\`]\` が足りず、\`[ … ] ${sep.type} [ … ]\` と分けて書くか、\`[[ ]]\` を使います`,
        `\`${sep.type}\` inside \`[ ]\` is not an argument of \`[\` but the operator that joins commands, so \`[\` loses its \`]\`. Write \`[ … ] ${sep.type} [ … ]\`, or use \`[[ ]]\``);
    }
  };
  visit(root);
  return found;
}
