import { Lang } from './i18n';
import { descendants, field, fields } from './syntax/tree';
import type { SyntaxNode } from './syntax/tree';

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

/** Does the word expand the variable (`$NAME`, `${NAME}`, `${NAME:-…}`, also inside `"…"` or `$( )`), as the tree reads it? */
export function readsVariable(word: SyntaxNode, name: string): boolean {
  // (`${NAME[1]}` holds the name in its subscript.)
  const named = (c: SyntaxNode): SyntaxNode | undefined => (c.type === 'subscript' ? c.namedChildren[0] : c);
  return descendants(word, ['simple_expansion', 'expansion']).some((e) => e.namedChildren.some((c) => named(c)?.type === 'variable_name' && named(c)!.text === name));
}

export function commandName(n: SyntaxNode): string | undefined {
  return field(n, 'name')?.text.split('/').pop();
}

export function args(n: SyntaxNode): SyntaxNode[] {
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
        break;
      }
      case 'test_command': {
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
    }
  };
  visit(root);
  return [...new Set(notes)];
}
