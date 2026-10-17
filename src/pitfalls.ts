import { Lang } from './i18n';
import type { SyntaxNode } from './parser';

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
  const v = n.namedChildren.find((c) => c?.type === 'variable_name');
  return v?.text;
}

function commandName(n: SyntaxNode): string | undefined {
  return n.childForFieldName('name')?.text.split('/').pop();
}

function args(n: SyntaxNode): SyntaxNode[] {
  return n.childrenForFieldName('argument').filter((c): c is SyntaxNode => !!c);
}

/** Notes for the pitfalls whose node starts on `line`. */
export function pitfallNotes(root: SyntaxNode, line: number, lang: Lang): string[] {
  const s = pick(lang);
  const notes: string[] = [];
  const add = (ja: string, en: string) => notes.push(s(`⚠ 落とし穴: ${ja}`, `⚠ Pitfall: ${en}`));
  const visit = (n: SyntaxNode) => {
    if (n.startPosition.row === line) check(n);
    if (n.startPosition.row <= line && n.endPosition.row >= line) for (const c of n.namedChildren) if (c) visit(c);
  };

  const check = (n: SyntaxNode) => {
    switch (n.type) {
      case 'command': {
        const name = commandName(n);
        const a = args(n);
        // `x = 1`: a command named x, not an assignment.
        if (name && /^[A-Za-z_]\w*$/.test(name) && a.length && (a[0].text === '=' || /^=\S/.test(a[0].text))) {
          add(`\`${name} ${a[0].text}…\` は代入ではなく、\`${name}\` というコマンドを実行します。代入は \`=\` の前後に空白を入れずに \`${name}=…\` と書きます`,
            `\`${name} ${a[0].text}…\` runs a command named \`${name}\`; it is not an assignment. Write \`${name}=…\` with no spaces around \`=\``);
        }
        // `rm -rf $DIR/…`: an empty DIR removes from the root.
        if (name === 'rm' && a.some((w) => /^-[a-zA-Z]*[rR]/.test(w.text) || w.text === '--recursive')) {
          for (const w of a) {
            const first = w.type === 'concatenation' || w.type === 'string' ? w.namedChildren[0] : undefined;
            const rest = first && w.text.slice(first.endIndex - w.startIndex);
            // HOME and PWD are always set.
            if (first && (first.type === 'simple_expansion' || first.type === 'expansion') && rest?.startsWith('/') && !/:\?/.test(first.text) && !['HOME', 'PWD'].includes(varName(first) ?? '')) {
              const v = varName(first) ?? 'VAR';
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
          const bare = a.find((w) => unquotedExpansion(w) || (w.type === 'concatenation' && w.namedChildren.some((c) => c && unquotedExpansion(c))));
          if (bare) {
            add(`\`${bare.text}\` をクォートしていないので、値に空白や \`*\` があると別々の引数に分かれたり、ファイル名に展開されたりします。\`"${bare.text}"\` と書きます`,
              `\`${bare.text}\` is not quoted, so a value with spaces or \`*\` is split into several arguments or expanded to file names. Write \`"${bare.text}"\``);
          }
        }
        break;
      }
      case 'redirected_statement': {
        // `sudo cmd > file`: the redirection is done by your shell, without sudo's rights.
        const body = n.childForFieldName('body');
        // Only for files that need root: system directories, not your logs or /dev/null.
        const toFile = n.namedChildren.some((c) => c?.type === 'file_redirect' && !/^\d*>&/.test(c.text.trim())
          && /^(\/etc|\/proc|\/sys|\/usr|\/opt|\/root|\/boot|\/lib)\//.test(c.childForFieldName('destination')?.text.replace(/^["']/, '') ?? ''));
        if (body?.type === 'command' && commandName(body) === 'sudo' && toFile) {
          add('リダイレクト（`>`）は sudo ではなく今のシェルが、今のユーザーの権限で行います。root しか書けないファイルには `… | sudo tee ファイル` を使います',
            'the redirection (`>`) is done by your own shell with your rights, not by sudo. For a file only root can write, use `… | sudo tee file`');
        }
        break;
      }
      case 'for_statement': {
        const value = n.childForFieldName('value');
        if (!value) break;
        // `for f in $(ls …)`
        if (value.type === 'command_substitution' && value.namedChildren[0]?.type === 'command' && ['ls', 'find'].includes(commandName(value.namedChildren[0]) ?? '')) {
          const cmd = commandName(value.namedChildren[0]);
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
        if (n.child(0)?.type !== '[') break;
        // Operands of the test itself, not variables inside a `$(…)` in it.
        const operand = (e: SyntaxNode) => ['test_command', 'binary_expression', 'unary_expression', 'parenthesized_expression', 'negated_expression'].includes(e.parent?.type ?? '');
        const bare = n.descendantsOfType(['simple_expansion', 'expansion']).find((e) => e && unquotedExpansion(e) && operand(e) && !alwaysNumber(e));
        if (bare) {
          add(`\`[ ]\` の中の \`${bare.text}\` をクォートしないと、値が空や空白入りのときに条件式が壊れます（\`unary operator expected\` など）。\`"${bare.text}"\` と書きます`,
            `unquoted \`${bare.text}\` inside \`[ ]\` breaks the test when the value is empty or has spaces ("unary operator expected"). Write \`"${bare.text}"\``);
        }
        break;
      }
      case 'declaration_command': {
        // `local x=$(cmd)`: the status of local hides the status of cmd.
        const kw = n.child(0)?.text;
        if (!['local', 'export', 'declare', 'readonly', 'typeset'].includes(kw ?? '')) break;
        const assign = n.namedChildren.find((c) => c?.type === 'variable_assignment' && c.childForFieldName('value')?.type === 'command_substitution');
        if (assign) {
          const v = assign.childForFieldName('name')?.text ?? 'x';
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
