import { builtins } from '../dict/builtins';
import { commands } from '../dict/commands';
import {
  binaryTestOps, expansionOps, keywords, listOps, redirects, specialVariables, unaryTestOps, wellKnownVariables,
} from '../dict/syntax';
import { Lang, Text } from '../i18n';

/** One entry of the quick reference: what you write and what it means. */
export interface ReferenceEntry { category: string; syntax: string; meaning: string }

/** A searchable cheat sheet built from the same dictionaries the explanations use (regex101's Quick Reference). */
export function quickReference(lang: Lang): ReferenceEntry[] {
  const t = (x: Text) => x[lang];
  const s = (ja: string, en: string) => (lang === 'ja' ? ja : en);
  const out: ReferenceEntry[] = [];
  const add = (category: string, syntax: string, meaning: string) => out.push({ category, syntax, meaning });

  const exp = s('パラメータ展開', 'Parameter expansion');
  for (const [op, f] of Object.entries(expansionOps)) {
    const arg = /^[#%]/.test(op) ? 'pattern' : op.startsWith('/') ? 'pattern/string' : 'word';
    add(exp, `\${var${op}${arg}}`, t(f('var', arg)));
  }
  add(exp, '${#var}', s('`var` の文字数（配列なら `${#arr[@]}` で要素数）', 'the length of `var` (`${#arr[@]}`: number of elements)'));
  add(exp, '${var:offset:length}', s('部分文字列を取り出す', 'a substring'));
  add(exp, '${!var}', s('間接参照: `var` の値を名前とする変数の値', 'indirection: the variable named by the value of `var`'));
  add(exp, '$(command)', s('コマンド置換: 実行結果の出力に置き換える', 'command substitution: replaced by the output'));
  add(exp, '$((expr))', s('算術展開: 整数の計算結果に置き換える', 'arithmetic expansion: replaced by the result'));
  add(exp, '<(command)', s('プロセス置換: 出力をファイルのように読める', 'process substitution: read the output like a file'));

  const vars = s('特殊変数', 'Special variables');
  for (const [name, x] of Object.entries(specialVariables)) add(vars, `$${name}`, t(x));
  for (const [name, x] of Object.entries(wellKnownVariables)) add(s('よく使う変数', 'Common variables'), `$${name}`, t(x));

  const red = s('リダイレクト', 'Redirections');
  for (const [op, f] of Object.entries(redirects)) {
    if (op === '>&' || op === '<&') continue;
    add(red, `${op} file`, t(f('', 'file')));
  }
  add(red, '2>&1', t(redirects['>&']('2', '1')));
  add(red, '2>/dev/null', s('標準エラー出力を捨てる', 'discard stderr'));
  add(red, '<<EOF', s('ヒアドキュメント: 次の行から `EOF` までを標準入力にする', 'here-document: the following lines up to `EOF` become stdin'));
  add(red, '<<< word', s('ヒアストリング: 文字列を標準入力にする', 'here-string: the string becomes stdin'));

  const ops = s('演算子', 'Operators');
  for (const [op, x] of Object.entries(listOps)) add(ops, op, t(x));

  const test = s('条件式', 'Tests');
  for (const [op, x] of Object.entries(unaryTestOps)) add(test, `[ ${op} x ]`, t(x));
  for (const [op, x] of Object.entries(binaryTestOps)) add(test, `[ a ${op} b ]`, t(x));

  const kw = s('構文', 'Syntax');
  for (const [k, x] of Object.entries(keywords)) add(kw, k, t(x));

  for (const [name, doc] of Object.entries(builtins)) add(s('組み込みコマンド', 'Builtins'), name, t(doc.summary));
  for (const [name, doc] of Object.entries(commands)) add(s('コマンド', 'Commands'), name, t(doc.summary));
  return out;
}
