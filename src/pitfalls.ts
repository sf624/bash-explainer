import { Lang } from './i18n';
import { field, fields } from './syntax/tree';
import type { SyntaxNode } from './syntax/tree';

// Common mistakes in shell scripts, explained where they appear: what goes wrong and how to write
// it instead. Each is found from the syntax tree, and only on the line where its node starts.

const pick = (lang: Lang) => (ja: string, en: string) => (lang === 'ja' ? ja : en);

/** A variable expansion the shell word-splits and globs: not inside double quotes. */
function unquotedExpansion(n: SyntaxNode): boolean {
  return (n.type === 'simple_expansion' || n.type === 'expansion') && n.parent?.type !== 'string';
}

/** `$?`, `$#`, `$$`, `$!` and `${#…}`: always a number, so safe unquoted. */
function alwaysNumber(n: SyntaxNode): boolean {
  return /^\$[?#$!]$/.test(n.text) || /^\$\{#/.test(n.text);
}

/** The variable an expansion reads (`DIR` for `$DIR` or `${DIR}`), when it is a plain one. */
function varName(n: SyntaxNode): string | undefined {
  const v = n.namedChildren.find((c) => c.type === 'variable_name');
  return v?.text;
}

/** Does the text read the variable (`$NAME`, `${NAME}`, `${NAME:-…}`)? */
export function usesVariable(text: string, name: string): boolean {
  return new RegExp(`\\$(\\{${name}\\b|${name}\\b)`).test(text);
}

function commandName(n: SyntaxNode): string | undefined {
  return field(n, 'name')?.text.split('/').pop();
}

function args(n: SyntaxNode): SyntaxNode[] {
  return fields(n, 'argument');
}

/** Notes for the pitfalls whose node starts on `line`. */
export function pitfallNotes(root: SyntaxNode, line: number, lang: Lang): string[] {
  const s = pick(lang);
  const notes: string[] = [];
  const add = (ja: string, en: string) => notes.push(s(`⚠ 落とし穴: ${ja}`, `⚠ Pitfall: ${en}`));
  const visit = (n: SyntaxNode) => {
    if (n.startPosition.row === line) check(n);
    if (n.startPosition.row <= line && n.endPosition.row >= line) for (const c of n.namedChildren) visit(c);
  };

  const check = (n: SyntaxNode) => {
    switch (n.type) {
      case 'command': {
        const name = commandName(n);
        const a = args(n);
        // `[-f x]`: the name is one word, `[-f`.
        if (name && /^\[[^\]]/.test(name) && a.at(-1)?.text.endsWith(']')) {
          add(`\`[\` は普通のコマンドなので、あとに空白が要ります（\`${name}\` は別のコマンド名になる）。\`[ ${name.slice(1)} …\` のように書きます`,
            `\`[\` is an ordinary command, so a space must follow it (\`${name}\` reads as another command name). Write \`[ ${name.slice(1)} …\``);
        }
        // `x = 1`: a command named x, not an assignment.
        if (name && /^[A-Za-z_]\w*$/.test(name) && a.length && (a[0].text === '=' || /^=\S/.test(a[0].text))) {
          add(`\`${name} ${a[0].text}…\` は代入ではなく、\`${name}\` というコマンドを実行します。代入は \`=\` の前後に空白を入れずに \`${name}=…\` と書きます`,
            `\`${name} ${a[0].text}…\` runs a command named \`${name}\`; it is not an assignment. Write \`${name}=…\` with no spaces around \`=\``);
        }
        // `FOO=1 echo $FOO`: the shell expands `$FOO` before the command sees the new value.
        const prefix = n.namedChildren.filter((c) => c.type === 'variable_assignment').map((c) => field(c, 'name')?.text).filter((v): v is string => !!v);
        for (const v of prefix) {
          const use = a.find((w) => w.type !== 'raw_string' && usesVariable(w.text, v));
          if (name && use) {
            add(`\`${v}=…\` は \`${name}\` の環境にだけ入ります。\`${use.text}\` は、その前に今のシェルが展開します（今の値で、なければ空）。新しい値を使うなら \`${v}=… sh -c '… "\$${v}"'\` のようにシェル経由にします`,
              `\`${v}=…\` is set only in the environment of \`${name}\`; the current shell expands \`${use.text}\` before that (to its present value, or nothing). To use the new value, go through a shell: \`${v}=… sh -c '… "\$${v}"'\``);
            break;
          }
        }
        // `{echo a;}`: no space after `{`, so it is a command named `{echo`.
        if (name && /^\{[A-Za-z_]\w*$/.test(name)) {
          add(`\`${name}\` は \`{\` の直後に空白がないので、グループの開始ではなく \`${name}\` というコマンド名です。\`{\` の後には空白が必要で、\`}\` の前には \`;\` か改行が必要です: \`{ ${name.slice(1)} …; }\``,
            `there is no space after \`{\`, so \`${name}\` is a command name, not the start of a group. \`{\` needs a space after it, and \`}\` needs a \`;\` or newline before it: \`{ ${name.slice(1)} …; }\``);
        }
        // `{ echo a; echo b }`: `}` is an argument of the last command, and the group is never closed.
        const lastArg = a[a.length - 1];
        if (lastArg?.type === 'word' && lastArg.text === '}' && n.parent?.type === 'compound_statement' && n.parent.incomplete) {
          add(`\`}\` の前に \`;\` か改行が必要です。このままでは \`}\` は \`${name}\` の引数で、\`{ }\` のグループが閉じていません: \`{ …; }\``,
            `\`}\` needs a \`;\` or a newline before it. As written, \`}\` is an argument of \`${name}\` and the \`{ }\` group is never closed: \`{ …; }\``);
        }
        // `rm -rf $DIR/…`: an empty DIR removes from the root.
        if (name === 'rm' && a.some((w) => /^-[a-zA-Z]*[rR]/.test(w.text) || w.text === '--recursive')) {
          for (const w of a) {
            const first = w.type === 'concatenation' || w.type === 'string' ? w.namedChildren[0] : undefined;
            if (!first || (first.type !== 'simple_expansion' && first.type !== 'expansion')) continue;
            // HOME and PWD are always set; special parameters such as `$$` have no name to put in `${…:?}`.
            const v = varName(first);
            if (v && !['HOME', 'PWD'].includes(v) && w.text.slice(first.endIndex - w.startIndex).startsWith('/') && !/:\?/.test(first.text)) {
              add(`\`${v}\` が空だと \`rm -r ${w.text.replace(first.text, '')}\` になり、ルートから削除してしまいます。\`"\${${v}:?}/…"\` と書くと、空のときは止まります`,
                `if \`${v}\` is empty this becomes \`rm -r ${w.text.replace(first.text, '')}\`, deleting from the root. Write \`"\${${v}:?}/…"\` to stop when it is empty`);
              break;
            }
          }
        }
        // `read` without -r eats backslashes.
        // Only when it reads into a variable; `read` alone or `read -n 1` waits for a key.
        const readsVar = a.some((w) => /^[A-Za-z_]\w*$/.test(w.text));
        if (name === 'read' && readsVar && !a.some((w) => /^-[a-zA-Z]*[rnN]/.test(w.text))) {
          add('`-r` を付けないと、入力のバックスラッシュ（`\\`）がエスケープとして消えます。ふつうは `read -r` と書きます',
            'without `-r`, backslashes in the input are taken as escapes and lost. Usually write `read -r`');
        }
        // Unquoted variables as paths of file commands.
        if (name && ['rm', 'cp', 'mv', 'cd', 'mkdir', 'touch', 'chmod', 'chown', 'ln', 'cat', 'source', '.'].includes(name)) {
          const bare = a.find((w) => unquotedExpansion(w) || (w.type === 'concatenation' && w.namedChildren.some((c) => unquotedExpansion(c))));
          if (bare) {
            add(`\`${bare.text}\` をクォートしていないので、値に空白や \`*\` があると別々の引数に分かれたり、ファイル名に展開されたりします。\`"${bare.text}"\` と書きます`,
              `\`${bare.text}\` is not quoted, so a value with spaces or \`*\` is split into several arguments or expanded to file names. Write \`"${bare.text}"\``);
          }
        }
        break;
      }
      case 'redirected_statement': {
        // `sudo cmd > file`: the redirection is done by your shell, without sudo's rights.
        const body = field(n, 'body');
        // Only for files that need root: system directories, not your logs or /dev/null.
        const toFile = n.namedChildren.some((c) => c.type === 'file_redirect' && !/^\d*>&/.test(c.text.trim())
          && /^(\/etc|\/proc|\/sys|\/usr|\/opt|\/root|\/boot|\/lib)\//.test(field(c, 'destination')?.text.replace(/^["']/, '') ?? ''));
        if (body?.type === 'command' && commandName(body) === 'sudo' && toFile) {
          add('リダイレクト（`>`）は sudo ではなく今のシェルが、今のユーザーの権限で行います。root しか書けないファイルには `… | sudo tee ファイル` を使います',
            'the redirection (`>`) is done by your own shell with your rights, not by sudo. For a file only root can write, use `… | sudo tee file`');
        }
        break;
      }
      case 'for_statement': case 'select_statement': {
        const value = field(n, 'value');
        if (!value) break;
        // `for f in $(ls …)`
        const cmd = value.type === 'command_substitution' && value.namedChildren[0]?.type === 'command' ? commandName(value.namedChildren[0]) : undefined;
        if (cmd === 'ls' || cmd === 'find') {
          add(`\`$(${cmd} …)\` の結果は空白や改行で区切られるので、空白を含むファイル名が壊れます。${cmd === 'ls' ? '`for f in *.txt` のようにグロブを使います' : '`find … -print0 | while IFS= read -r -d \'\' f` や `find -exec` を使います'}`,
            `the output of \`$(${cmd} …)\` is split on spaces and newlines, so file names with spaces break. ${cmd === 'ls' ? 'Use a glob, as in `for f in *.txt`' : "Use `find … -print0 | while IFS= read -r -d '' f` or `find -exec`"}`);
        }
        // `for a in $*` / `for a in $@`
        if (value.type === 'simple_expansion' && /^\$[*@]$/.test(value.text)) {
          add(`\`${value.text}\` をクォートしないと、空白を含む引数が分かれてしまいます。\`for a in "$@"\`（または \`for a\` だけ）と書きます`,
            `unquoted \`${value.text}\` splits arguments that contain spaces. Write \`for a in "$@"\` (or just \`for a\`)`);
        }
        break;
      }
      case 'test_command': {
        // `[ $x = y ]`: an empty or spaced value breaks the test.
        // The words of the test itself, not variables inside a `$(…)` in it.
        const bare = n.namedChildren.find((e) => unquotedExpansion(e) && !alwaysNumber(e));
        if (bare) {
          add(`\`[ ]\` の中の \`${bare.text}\` をクォートしないと、値が空や空白入りのときに条件式が壊れます（\`unary operator expected\` などのエラーや、誤った結果。空の \`[ -n $x ]\` は真になります）。\`"${bare.text}"\` と書きます`,
            `unquoted \`${bare.text}\` inside \`[ ]\` breaks the test when the value is empty or has spaces (an error such as "unary operator expected", or a wrong result: an empty \`[ -n $x ]\` is true). Write \`"${bare.text}"\``);
        }
        // `[ $a < $b ]`: `<` and `>` are redirections of the command `[`.
        const redirect = n.namedChildren.find((e) => e.type === 'file_redirect');
        if (redirect) {
          add(`\`[ ]\` の中の \`${redirect.text.match(/^\d*[<>]+/)![0]}\` は比較ではなくリダイレクトとして読まれます。文字列の順序の比較は \`[[ ]]\` を使うか、\`\\${redirect.text.match(/[<>]/)![0]}\` とエスケープします`,
            `\`${redirect.text.match(/^\d*[<>]+/)![0]}\` inside \`[ ]\` is read as a redirection, not a comparison. Use \`[[ ]]\` to compare strings by order, or escape it as \`\\${redirect.text.match(/[<>]/)![0]}\``);
        }
        const last = n.namedChildren[n.namedChildren.length - 1];
        const closed = n.children[n.children.length - 1].type === ']';
        const next = n.parent?.children[n.parent.children.indexOf(n) + 2];
        const sep = n.parent?.children[n.parent.children.indexOf(n) + 1];
        if (!closed && last && /[^\s]\]$/.test(last.text)) {
          // `[ -f x]`
          add(`\`${last.text}\` の \`]\` は単語の一部として読まれ、閉じの \`]\` がありません（\`missing ']'\`）。\`]\` の前に空白が要ります`,
            `the \`]\` in \`${last.text}\` is read as part of the word, so \`[\` has no closing \`]\` ("missing ']'"). \`]\` needs a space before it`);
        } else if (!closed && (sep?.type === '&&' || sep?.type === '||') && next?.type === 'command' && args(next).at(-1)?.text === ']') {
          // `[ a && b ]`
          add(`\`[ ]\` の中の \`${sep.type}\` は \`[\` の引数ではなく、コマンドをつなぐ演算子です。\`]\` が足りず、\`[ … ] ${sep.type} [ … ]\` と分けて書くか、\`[[ ]]\` を使います`,
            `\`${sep.type}\` inside \`[ ]\` is not an argument of \`[\` but the operator that joins commands, so \`[\` loses its \`]\`. Write \`[ … ] ${sep.type} [ … ]\`, or use \`[[ ]]\``);
        }
        break;
      }
      case 'declaration_command': {
        // `local x=$(cmd)`: the status of local hides the status of cmd.
        // The keyword: local, export, declare, readonly or typeset.
        const kw = n.children[0].text;
        const assign = n.namedChildren.find((c) => c.type === 'variable_assignment' && field(c, 'value')?.type === 'command_substitution');
        if (assign) {
          const v = field(assign, 'name')!.text;
          add(`\`${kw} ${v}=$(…)\` の終了ステータスは \`${kw}\` 自身のもの（成功）になり、\`$(…)\` の中の失敗が隠れます（\`set -e\` でも止まりません）。\`${kw} ${v}\` と \`${v}=$(…)\` の2行に分けます`,
            `the status of \`${kw} ${v}=$(…)\` is that of \`${kw}\` (success), which hides a failure inside \`$(…)\` (even from \`set -e\`). Split it: \`${kw} ${v}\`, then \`${v}=$(…)\``);
        }
        break;
      }
    }
  };
  visit(root);
  return [...new Set(notes)];
}
