import type { CommandSpec } from '../argv/spec';
import type { YqFlavor } from '../embedded/yq';
import { cmd, OptSpec, pos } from './types';

const formats = (kind: 'input' | 'output') => ({
  json: { ja: 'JSON', en: 'JSON' }, j: { ja: 'JSON', en: 'JSON' }, yaml: { ja: 'YAML', en: 'YAML' }, y: { ja: 'YAML', en: 'YAML' },
  props: { ja: 'Java の properties 形式', en: 'Java properties' }, p: { ja: 'Java の properties 形式', en: 'Java properties' },
  xml: { ja: 'XML', en: 'XML' }, x: { ja: 'XML', en: 'XML' }, csv: { ja: 'CSV', en: 'CSV' }, c: { ja: 'CSV', en: 'CSV' },
  tsv: { ja: 'TSV', en: 'TSV' }, t: { ja: 'TSV', en: 'TSV' }, toml: { ja: 'TOML', en: 'TOML' }, lua: { ja: 'Lua', en: 'Lua' }, l: { ja: 'Lua', en: 'Lua' },
  ini: { ja: 'INI', en: 'INI' }, i: { ja: 'INI', en: 'INI' }, ...(kind === 'output' ? { shell: { ja: 'シェルの変数代入（`a_b=1`）', en: 'shell variable assignments (`a_b=1`)' }, s: { ja: 'シェルの変数代入', en: 'shell assignments' } } : {}),
});

const V4_OPTIONS: OptSpec[] = [
  ['-o|--output-format', '出力形式（`json`・`yaml`・`xml`・`props`・`csv`・`tsv`・`toml`・`shell`・`lua` など。既定は入力と同じ）', 'output format (`json`, `yaml`, `xml`, `props`, `csv`, `tsv`, `toml`, `shell`, `lua`…; defaults to the input format)', 'arg', formats('output')],
  ['-p|--input-format', '入力形式（`json`・`xml`・`csv`・`toml`・`props`・`ini` など。既定は拡張子から判断）', 'input format (`json`, `xml`, `csv`, `toml`, `props`, `ini`…; guessed from the file extension)', 'arg', formats('input')],
  ['-i|--inplace', '結果で最初のファイルを上書きする', 'update the first file in place'],
  ['-n|--null-input', '入力を読まずに式だけで文書を作る', 'read no input; build a document from the expression'],
  ['-P|--prettyPrint', '`{a: 1}` のような書き方も通常のブロック形式に整える', 'pretty print (turn flow style like `{a: 1}` into block style)'],
  ['-I|--indent', 'インデントの幅（既定 2）', 'indentation width (default 2)', 'arg'],
  ['-r|--unwrapScalar', '文字列などをクォートなしで出力する（YAML では既定）', 'print scalars without quotes (the default for YAML)'],
  ['-e|--exit-status', '結果が null・false・なしなら失敗の終了ステータスにする', 'exit with an error if the result is null, false or nothing'],
  ['-f|--front-matter', 'Markdown などの先頭の YAML（フロントマター）だけを処理する（`extract`・`process`）', 'process only the YAML front matter (`extract` or `process`)', 'arg'],
  ['-0|--nul-output', '結果を NUL 文字区切りで出力する（`xargs -0` 向け）', 'separate results with NUL (for `xargs -0`)'],
  ['-N|--no-doc', 'ドキュメント区切り `---` を出力しない', 'do not print the `---` document separators'],
  ['-s|--split-exp', '結果ごとに、指定した式の名前のファイルに書き出す', 'write each result to a file named by the given expression', 'arg'],
  ['-C|--colors', '色付きで出力する', 'force colours'],
  ['-M|--no-colors', '色を付けない', 'no colours'],
  ['-v|--verbose', '詳しいログを出す', 'verbose logging'],
  ['--expression', '式を明示する（ファイル名と区別できないとき）', 'give the expression explicitly (when it looks like a file)', 'arg'],
  ['--from-file', '式をファイルから読む', 'read the expression from a file', 'arg io:read'],
];

const V4_EXPR = { positional: [pos('yq の式（jq に似た記法）', 'yq expression (jq-like)'), pos('入力ファイル（省略すると標準入力）', 'input file (stdin if omitted)')], positionalLang: ['yq4' as const], positionalIo: [undefined, 'input' as const] };

/** mikefarah/yq v4: `yq [eval] EXPR FILE…`; a Go program with cobra and pflag (`-o=json` gives `-o` the value `json`). */
const mikefarah4: CommandSpec = cmd('YAML（JSON・XML・TOML なども）を jq に似た式で抽出・変換する（mikefarah/yq v4）', 'Query and edit YAML (also JSON, XML, TOML…) with jq-like expressions (mikefarah/yq v4)', V4_OPTIONS, {
  ...V4_EXPR,
  parser: 'cobra',
  subcommands: {
    e: cmd('式を各ドキュメントに順に適用する（`eval`）', 'apply the expression to each document (`eval`)', V4_OPTIONS, V4_EXPR),
    eval: cmd('式を各ドキュメントに順に適用する', 'apply the expression to each document', V4_OPTIONS, V4_EXPR),
    ea: cmd('全ファイルのドキュメントをまとめて1回で処理する（`eval-all`。マージなどに使う）', 'process the documents of all files together (`eval-all`; for merging)', V4_OPTIONS, V4_EXPR),
    'eval-all': cmd('全ファイルのドキュメントをまとめて1回で処理する（マージなどに使う）', 'process the documents of all files together (for merging)', V4_OPTIONS, V4_EXPR),
  },
});

/** kislyuk/yq: `yq [jq options] FILTER FILE…`, a jq wrapper. */
const kislyuk: CommandSpec = cmd('YAML を JSON に変換して jq で処理する（kislyuk/yq。式は jq そのもの。出力は既定で JSON）', 'Convert YAML to JSON and process it with jq (kislyuk/yq; the filter is plain jq; output is JSON by default)', [
  ['-y|--yaml-output|--yml-output', '結果を YAML に戻して出力する', 'convert the result back to YAML'],
  ['-Y|--yaml-roundtrip|--yml-roundtrip', 'タグやスタイルを保ったまま YAML で出力する', 'output YAML keeping tags and styles'],
  ['-i|--in-place', '結果で入力ファイルを上書きする', 'edit the files in place'],
  ['-w|--width', 'YAML 出力の折り返し幅', 'wrap width of YAML output', 'arg'],
  ['--indentless-lists|--indentless', 'YAML 出力でリストをインデントしない', 'do not indent lists in YAML output'],
  ['--explicit-start', 'YAML 出力の先頭に `---` を付ける', 'start YAML output with `---`'],
  ['-r|--raw-output', '文字列をクォートなしで出力する（jq の `-r`）', 'print strings without quotes (jq\'s `-r`)'],
  ['-c|--compact-output', '1行に詰めて出力する', 'compact output'],
  ['-e|--exit-status', '結果が null・false なら失敗の終了ステータスにする', 'set the exit status from the result'],
  ['-n|--null-input', '入力を読まない', 'do not read input'],
  ['-s|--slurp', '全入力を1つの配列として読む', 'read all inputs into one array'],
  ['-S|--sort-keys', 'キーをソートして出力する', 'sort keys'],
  ['--arg', 'jq の変数に文字列を渡す（`--arg name value`）', 'pass a string variable (`--arg name value`)', 'arg2'],
  ['--argjson', 'jq の変数に JSON の値を渡す（`--argjson name 値`）', 'pass a JSON variable (`--argjson name value`)', 'arg2'],
  ['--slurpfile', 'ファイルの JSON を配列として変数に入れる（`--slurpfile name ファイル`）', "load a file's JSON values into a variable as an array (`--slurpfile name file`)", 'arg2 io:read'],
  ['--rawfile', 'ファイルの中身を文字列として変数に入れる（`--rawfile name ファイル`）', "load a file's text into a variable (`--rawfile name file`)", 'arg2 io:read'],
], { positional: [pos('jq フィルタ（例: `.items[].name`）', 'jq filter (e.g. `.items[].name`)'), pos('入力 YAML ファイル', 'input YAML file')], positionalLang: ['jq'], positionalIo: [undefined, 'input'] });

const V3_GLOBAL: OptSpec[] = [
  ['-j|--tojson', 'JSON で出力する', 'output JSON'],
  ['-P|--prettyPrint', '整形して出力する', 'pretty print'],
  ['-I|--indent', 'インデントの幅', 'indentation width', 'arg'],
  ['-C|--colors', '色付きで出力する', 'colours'],
  ['-v|--verbose', '詳しいログを出す', 'verbose'],
];
const V3_DOC: OptSpec = ['-d|--doc', '対象のドキュメント番号（0 から。`*` で全部）', 'document index (from 0; `*` for all)', 'arg'];
const V3_INPLACE: OptSpec = ['-i|--inplace', 'ファイルを上書きする', 'update the file in place'];
const path = pos('パス（`a.b[0].c`、`a.*`、`a.(name==x)` など。jq の式ではない）', 'path (`a.b[0].c`, `a.*`, `a.(name==x)`…; not a jq expression)');
const file = pos('YAML ファイル', 'YAML file');

/** mikefarah/yq v3: `yq r FILE PATH`, `yq w FILE PATH VALUE`… */
const mikefarah3: CommandSpec = cmd('YAML をパスで読み書きする（mikefarah/yq v3。v4 とは記法が違う）', 'Read and write YAML by path (mikefarah/yq v3; different syntax from v4)', V3_GLOBAL, {
  subcommands: {
    r: cmd('パスの値を読む（read）', 'read the value at a path', [...V3_GLOBAL, V3_DOC, ['-p|--printMode', '表示内容（`v` 値・`p` パス・`pv` 両方）', 'what to print (`v` values, `p` paths, `pv` both)', 'arg'], ['-l|--length', '長さを表示する', 'print the length'], ['-c|--collect', '結果を配列にまとめる', 'collect results into an array'], ['-D|--defaultValue', '見つからないときに表示する値', 'value printed when nothing matches', 'arg'], ['-X|--explodeAnchors', 'アンカーを展開する', 'explode anchors'], ['-e|--exitStatus', '見つからなければ失敗の終了ステータス', 'exit with an error if nothing matches']], { positional: [file, path], positionalLang: [undefined, 'yq3path'] }),
    w: cmd('パスに値を書き込む（write）', 'write a value at a path', [...V3_GLOBAL, V3_DOC, V3_INPLACE, ['-s|--script', '更新内容を書いたスクリプトファイル', 'update script file', 'arg'], ['--tag', 'YAML タグ', 'YAML tag', 'arg'], ['--style', '書き方のスタイル', 'style', 'arg']], { positional: [file, path, pos('書き込む値', 'value to write')], positionalLang: [undefined, 'yq3path'] }),
    d: cmd('パスの値を削除する（delete）', 'delete the value at a path', [...V3_GLOBAL, V3_DOC, V3_INPLACE], { positional: [file, path], positionalLang: [undefined, 'yq3path'] }),
    m: cmd('複数の YAML をマージする（merge）', 'merge YAML files', [...V3_GLOBAL, V3_DOC, V3_INPLACE, ['-x|--overwrite', '既存の値を上書きする', 'overwrite existing values'], ['-a|--arrays', '配列のマージ方法（`update`・`append`・`overwrite`）', 'array merge strategy (`update`, `append`, `overwrite`)', 'arg']], { positional: [pos('マージ先の YAML ファイル', 'YAML file to merge into'), pos('マージする YAML ファイル', 'YAML file to merge')] }),
    n: cmd('新しい YAML を作る（new）', 'create new YAML', [...V3_GLOBAL, ['-s|--script', 'スクリプトファイル', 'script file', 'arg']], { positional: [path, pos('値', 'value')], positionalLang: ['yq3path'] }),
    p: cmd('全体をパスの下に入れる（prefix）', 'nest the document under a path', [...V3_GLOBAL, V3_DOC, V3_INPLACE], { positional: [file, path], positionalLang: [undefined, 'yq3path'] }),
    x: cmd('2つの YAML を比較する（compare）', 'compare two YAML files', V3_GLOBAL, { positional: [file, file, path], positionalLang: [undefined, undefined, 'yq3path'] }),
    v: cmd('YAML として正しいか検証する（validate）', 'validate YAML', V3_GLOBAL, { positional: [file] }),
  },
});
for (const [short, long] of [['r', 'read'], ['w', 'write'], ['d', 'delete'], ['m', 'merge'], ['n', 'new'], ['p', 'prefix'], ['x', 'compare'], ['v', 'validate']]) {
  mikefarah3.subcommands![long] = mikefarah3.subcommands![short];
}

export const YQ_SPECS: Record<YqFlavor, CommandSpec> = { mikefarah4, kislyuk, mikefarah3 };
