import { type Lang, lineLabel } from '../i18n';

// The panel's and the page's own texts in the two languages, in one place (docs/design/sources.md, row 17): what the
// panel, the hover, the status bar and the command line say that is not an explanation. test/ja-style.test.ts checks
// the Japanese against docs/japanese-style.md, and that no other file of src/ui holds Japanese text.

export const ui = {
  ja: {
    title: 'Bash Explainer',
    line: (n: number) => lineLabel('ja', n),
    lineShort: (n: number) => lineLabel('ja', n, 'inline'),
    forShell: (name: string) => `${name} 向けとして確認`,
    empty: 'この行には解説する内容がありません。',
    noEditor: 'bash スクリプトを開いてカーソルを置くと、その行の解説がここに表示されます。',
    features: {
      hover: ['ホバー', 'マウスを乗せた部分の解説をフローティング表示'],
      panel: ['パネルを自動で開く', 'bash スクリプトを開いたら、カーソル行に追従するパネルを開く'],
    },
    short: { hover: 'ホバー', panel: 'パネル' },
    off: 'オフ',
    pickFeatures: '使う表示方法を選択（複数可）',
    statusTooltip: 'Bash Explainer: クリックで表示方法を切り替え',
    openInPanel: 'パネルで詳しく見る',
    hover: {
      wholeLine: '行全体', wholeLineTitle: '行全体を説明', more: (n: number) => `ほか ${n} 項目はパネルで`, command: 'コマンド: ', in: '位置: ',
      moreNotes: (n: number) => `この行のほかの注記 ${n} 件`,
    },
    settings: '設定',
    // (Notices, plain text: a notification shows no Markdown. src/ui/inlineNotice.ts, src/ui/builtinThemes.ts.)
    inlineNotice: {
      message: 'インライン要約は削除され、bashExplainer.inline.enabled には効果がなくなりました。単語にマウスを乗せるとその解説、Ctrl+K Ctrl+E で行全体の解説を表示します。名前どおりのものを実行しないコマンド名にはヒントが付きます。',
      open: '設定を開く', dismiss: '今後表示しない',
    },
    unreadableTheme: (name: string, remote: boolean) => `パネルは独自の色のままです。カラーテーマ「${name}」を読めません。${remote ? 'このウィンドウでは Bash Explainer がリモート側（WSL、SSH、コンテナー）で動いていて、読めるのは VS Code の既定のカラーテーマ（Dark Modern、Light 2026 など）だけです。ローカル側に入れると（拡張機能ビューの「ローカルにインストール」）、どのカラーテーマも読めます。' : ''}`,
    // (A hint after a command name that does not run what it suggests, `runs` being what does run: src/ui/nameHints.ts.)
    nameHint: {
      noProgram: (runs: string, by?: string) => `${runs}（${by === undefined ? '' : `${by} が実行。`}ふつうは存在しない）`,
      shadow: (runs: string, other: string) => `${runs}（${other}ではない）`,
      off: (runs: string) => `${runs}（ビルトインは無効）`,
      unexpanded: (runs: string, maybe: boolean) => `${runs}（エイリアスは展開されない${maybe ? 'かもしれない' : ''}）`,
    },
    panel: {
      copy: 'Markdown でコピー', copied: '解説を Markdown としてコピーしました。', expandAll: 'すべて展開する', collapseAll: 'すべて折りたたむ',
      reference: '早見表', search: '検索（例: ${、2>&1、-f、grep）', back: '← 解説に戻る', shell: 'シェル', yq: 'yq', auto: '自動',
      editHint: '書き換えられます（結果はその場で更新）', noMatch: '該当なし',
      // (A note's try-it, docs/design/basis.md: the command is for the reader's terminal; the panel never runs it.)
      tryIt: '端末で試す', tryItHint: '端末に貼り付けて実行するコマンド。ここでは実行しない', prints: '出力', copyCode: 'コピー', copiedCode: 'コピーしました',
      // (The fold button of a row with parts, named by the row's label; the links' note on where they open: `linkNote`, src/ui/panelView.ts.)
      partsOf: '{name} の内訳', opensTab: '（新しいタブで開く）', opensBrowser: '（ブラウザで開く）',
      views: '表示', listView: '意味', treeView: '読まれ方',
      // (The short words of the panel's tools, each contained in the tool's name: src/ui/panelHead.ts.)
      words: { collapse: '折りたたむ', expand: '展開する', copy: 'コピー', reference: '早見表', referenceShort: '早見表' },
      // (The sentence of the line at the top of the Meaning view, `LineExplanation.sentence`.)
      inShort: 'ひとことで',
      // (What a screen reader hears between the reading of a worked example's highlighted part and the part itself.)
      saidSep: '：',
      // (The line box of a line over more than three rows: its tooltip, folded and opened.)
      lineOpen: 'クリックで行全体を表示', lineFold: 'クリックで 3 行までに折りたたむ',
      tree: {
        label: '行の各部分を誰が読むか', show: '表示',
        // The steps of the tree, from the line alone to every layer: their short names (the buttons) and their names.
        steps: [['行', '行'], ['リスト', 'リストとパイプライン'], ['コマンド', 'コマンド'], ['単語', '単語'], ['単語の中', '単語の中身（クォートと展開）'],
          ['スクリプト', '中のスクリプト'], ['引数', '各コマンドによる引数の読み方'], ['言語', '言語']],
        stepper: {
          group: 'ステップ', back: '前のステップ', forward: '次のステップ',
          step: 'ステップ {i}/{n}：{name}', empty: 'この行では増えるものなし', jump: 'ステップを選ぶ',
        },
        reads: '{name} が読む',
        bands: { bash: 'bash', child: { subshell: 'サブシェル', shell: '新しいシェル', same: '同じシェルでもう一度', remote: 'リモートのシェル', container: 'コンテナのシェル' } },
        readers: {
          bash: 'bash が解析する',
          child: {
            subshell: 'サブシェル（このシェルのコピー）がもう一度解析する', shell: '新しく起動したシェル（別のプロセス）がもう一度解析する', same: 'それを実行するシェルが、この文字列をもう一度解析する（新しいプロセスなし）',
            remote: '別のマシンのシェルが解析する', container: 'コンテナの中のシェルが解析する',
          },
          command: 'bash ではなく {name} が読む', language: '{name} が読む独自の言語', bashLanguage: 'bash 自身が読む（正規表現の照合、POSIX の拡張正規表現(ERE)）',
          promptLanguage: 'bash 自身が、プロンプトを表示するたびに読む',
        },
        kinds: {
          line: 'bash がこの行を読む', script: '中のスクリプト', list: 'リスト', andList: 'AND リスト', orList: 'OR リスト', pipeline: 'パイプライン', command: '単純コマンド', compound: '複合コマンド',
          clause: '節', coprocess: 'コプロセス', function: '関数定義', commandName: 'コマンド名', aliasWord: 'エイリアス（読むときに置き換わる）', expandedName: '最初の単語', option: 'オプション', argument: '引数',
          assignmentArgument: '代入の引数', word: '単語', name: '名前', assignment: '代入', redirect: 'リダイレクト', heredoc: 'ヒアドキュメント', quote: 'クォート',
          expansion: '展開', substitution: '置換', arithmetic: '算術式展開', brace: 'ブレース展開', operator: '演算子', keyword: '予約語',
          comment: 'コメント', shebang: 'シバン（bash にとってはコメント）', expression: '式', descriptor: 'ファイルディスクリプタ', delimiter: '終わりの区切り', part: '部分',
        },
        commandKinds: { argument: 'オペランド' },
        valueFor: '{flag} の値',
        valueExpands: '{flag} の値: 展開された最初の語。残りはオペランド',
        expands: { glob: '{kind}: 一致したファイル名ごと', split: '{kind}: 分割された語ごと', brace: '{kind}: ブレース展開の語ごと', elements: '{kind}: 要素ごと' },
        resolves: { alias: 'エイリアス', keyword: '予約語', function: '関数', builtin: 'ビルトイン', file: '外部コマンド', none: '実行されない' },
        tokenKinds: {
          command: '実行', subcommand: 'サブコマンド', builtin: 'ビルトイン', function: '関数', alias: 'エイリアス', keyword: 'キーワード', option: 'オプション', argument: '引数',
          operator: '演算子', redirect: 'リダイレクト', variable: '変数', expansion: '展開', substitution: '置換', string: 'リテラル',
          number: '数値', comment: 'コメント', shebang: 'シバン', assignment: '代入', test: '条件', pattern: 'パターン', block: 'ブロック', error: 'エラー',
        },
        about: {
          line: 'bash はこの行をコマンドに分け、単純コマンドをさらに代入・単語・リダイレクトに分ける。',
          script: 'シェルがこのテキストを独立したスクリプトとしてもう一度解析し、実行する。`$( )`・`<( )`・バッククォートではサブシェルが実行する。',
          list: 'リスト: `;`・`&`・改行で区切ったパイプラインの並び。`&&` と `||` のほうが強く結び付くので、区切られた1つ1つはパイプラインか AND・OR リスト。`;` はその前の部分の終了を待ち、`&` はその前の部分だけをバックグラウンドで実行する。',
          andList: 'AND リスト: `a && b` は `a` が成功（終了ステータス 0）したときだけ `b` を実行する。`&&` と `||` が続くときは左から読む。',
          orList: 'OR リスト: `a || b` は `a` が失敗（終了ステータス 0 以外）したときだけ `b` を実行する。`&&` と `||` が続くときは左から読む。',
          command: '単純コマンド: 代入・単語・リダイレクトからなる。bash が単語を展開し、最初のフィールドをコマンド名、残りを引数とする。',
          commandName: 'コマンド名: bash が探し（関数、ビルトイン、PATH の中のファイルの順）、引数を渡して実行する。',
          aliasWord: 'エイリアス: bash は行を読むときに、最初の単語をエイリアスの中身に置き換える。単語の展開より前なので、探すコマンド名は中身の最初の単語で、残りは引数になる。',
          option: '予約語のオプション: bash は書いたとおりに読む。展開する単語ではない。',
          expandedName: 'コマンド名は実行するときに決まる: bash が単語を展開し、最初のフィールドがコマンド名、残りが引数になる。この単語が何にも展開されなければ、次の単語が名前になる。',
          argument: '引数: bash が展開し、そのフィールドをコマンドに渡す。',
          assignmentArgument: '代入の形の引数: bash は代入として展開し（値は単語分割もグロブもされない）、ビルトインに渡す。ビルトインが代入する。',
          word: '単語: bash が展開し、その結果を渡す。',
          heredoc: 'ヒアドキュメントの本文: コマンドの入力になる。標準入力(fd 0)か、`<<` の前に書いたファイルディスクリプタ。',
          descriptor: 'ファイルディスクリプタ: リダイレクトが切り替える番号。`{fd}` と書くと、bash が空いている番号（10 以上）を選んで変数 `fd` に入れる（`>&-` と `<&-` では、変数の値の番号を閉じる）。',
          delimiter: 'ヒアドキュメントの終わりの区切り: この単語だけの行で本文が終わる。bash は展開しない。一部でもクォートすると、本文も展開しない。',
          keyword: '予約語: 引用符で囲まずにコマンドの最初の単語（`for x` の後の `in` のように、構文がそれを待つ位置も）に書いたとき、bash が構文の一部として読む単語（`if`、`do`、`{`、`!` など）。',
          expression: '式: `[[ ]]` は条件式として、`(( ))`・`$(( ))`・`${x:i:n}` の位置と長さ・インデックス配列の添字は算術式として bash 自身が読む。単語のように展開して渡すのではない。',
          language: '単語の中にある独自の言語: bash ではなく、コマンドが独自の規則で読む。',
          bashLanguage: '`=~` の右辺の正規表現: bash 自身が、POSIX の拡張正規表現(ERE)の規則で左辺と照合する。',
          promptLanguage: 'プロンプト文字列（`PS1`・`PS4` などの値）: bash 自身が、プロンプトを表示するたびにバックスラッシュのエスケープを置き換え、その結果を展開する。',
        },
        languages: {
          regex: '正規表現', glob: 'glob パターン', sed: 'sed スクリプト', awk: 'awk プログラム', jq: 'jq フィルター', yq4: 'yq の式', yq3path: 'yq のパス',
          printf: 'printf の書式', echo: 'エスケープ', date: 'date の書式', perl: 'Perl', mode: 'ファイルモード', umask: 'umask', sortkey: 'ソートキー',
          cutfields: 'フィールドの範囲', cutchars: '文字の範囲', trset: '文字の集合', getopts: 'オプション文字', getoptshort: 'オプション文字',
          getoptlong: '長いオプション', gitformat: 'git の書式', gitdate: 'git の日付', arith: '算術式', prompt: 'プロンプト文字列',
        },
      },
    },
  },
  en: {
    title: 'Bash Explainer',
    line: (n: number) => lineLabel('en', n),
    lineShort: (n: number) => lineLabel('en', n, 'inline'),
    forShell: (name: string) => `checked for ${name}`,
    empty: 'Nothing to explain on this line.',
    noEditor: 'Open a bash script and place the cursor on a line to see its explanation here.',
    features: {
      hover: ['Hover', 'Floating explanation of the part under the mouse'],
      panel: ['Open the panel automatically', 'Open the panel that follows the cursor line when a bash script is opened'],
    },
    short: { hover: 'Hover', panel: 'Panel' },
    off: 'Off',
    pickFeatures: 'Choose how explanations are shown (any number)',
    statusTooltip: 'Bash Explainer: click to change how explanations are shown',
    openInPanel: 'Open in panel',
    hover: {
      wholeLine: 'Whole line', wholeLineTitle: 'Explain the whole line', more: (n: number) => `${n} more in the panel`, command: 'Command: ', in: 'in: ',
      moreNotes: (n: number) => `${n} more note${n === 1 ? '' : 's'} on this line`,
    },
    settings: 'Settings',
    inlineNotice: {
      message: 'The inline summary was removed, and bashExplainer.inline.enabled no longer has an effect. Hover a word for what it is, or press Ctrl+K Ctrl+E for the whole line; command names that do not run what they suggest get a hint.',
      open: 'Open settings', dismiss: "Don't show again",
    },
    unreadableTheme: (name: string, remote: boolean) => `The panel keeps its own colours: the theme "${name}" cannot be read.${remote ? " Bash Explainer runs on the remote side of this window (WSL, SSH, a container), where only VS Code's default themes (Dark Modern, Light 2026…) can be read. Installed on the local side (Install Locally, in the Extensions view), it reads every theme." : ''}`,
    nameHint: {
      noProgram: (runs: string, by?: string) => `${runs}${by === undefined ? '' : `, run by ${by}`}: usually there is none`,
      shadow: (runs: string, other: string) => `${runs}, not the ${other}`,
      off: (runs: string) => `${runs}: the builtin is off`,
      unexpanded: (runs: string, maybe: boolean) => `${runs}: the alias ${maybe ? 'may not be' : 'is not'} expanded`,
    },
    panel: {
      copy: 'Copy as Markdown', copied: 'Copied the explanation as Markdown.', expandAll: 'Expand all', collapseAll: 'Collapse all',
      reference: 'Quick reference', search: 'Search (e.g. ${, 2>&1, -f, grep)', back: '← Back to the explanation', shell: 'Shell', yq: 'yq', auto: 'Auto',
      editHint: 'Editable; the result updates as you type', noMatch: 'Nothing found',
      tryIt: 'Try it in your terminal', tryItHint: 'A command to paste into your terminal; it is not run here', prints: 'Output', copyCode: 'Copy', copiedCode: 'Copied',
      partsOf: 'Parts of {name}', opensTab: '(opens in a new tab)', opensBrowser: '(opens in the browser)',
      views: 'View', listView: 'Meaning', treeView: 'Reading',
      words: { collapse: 'Collapse', expand: 'Expand', copy: 'Copy', reference: 'Reference', referenceShort: 'Ref' },
      inShort: 'In short',
      saidSep: ': ',
      lineOpen: 'Click to show the whole line', lineFold: 'Click to fold the line to three rows',
      tree: {
        label: 'Who reads each part of the line', show: 'Show',
        steps: [['Line', 'the line'], ['Lists', 'lists and pipelines'], ['Commands', 'commands'], ['Words', 'words'], ['Inside', 'inside the words (quotes and expansions)'],
          ['Scripts', 'scripts inside'], ['Arguments', 'how each command reads its arguments'], ['Languages', 'languages']],
        stepper: {
          group: 'Steps', back: 'Previous step', forward: 'Next step',
          step: 'Step {i} of {n}: {name}', empty: 'Adds nothing on this line', jump: 'Choose a step',
        },
        reads: '{name} reads',
        bands: { bash: 'bash', child: { subshell: 'subshell', shell: 'new shell', same: 'same shell, again', remote: 'remote shell', container: 'container shell' } },
        readers: {
          bash: 'bash parses it',
          child: {
            subshell: 'a subshell (a copy of this shell) parses it again', shell: 'a newly started shell (another process) parses it again', same: 'the shell that runs it parses this string again (no new process)',
            remote: 'a shell on another machine parses it', container: 'a shell in the container parses it',
          },
          command: '{name} reads it, not bash', language: 'a language of its own, read by {name}', bashLanguage: 'bash reads it itself (its regex matching, POSIX ERE)',
          promptLanguage: 'bash reads it itself, each time it prints the prompt',
        },
        kinds: {
          line: 'bash reads the line', script: 'script inside', list: 'list', andList: 'AND list', orList: 'OR list', pipeline: 'pipeline', command: 'simple command', compound: 'compound command',
          clause: 'clause', coprocess: 'coprocess', function: 'function definition', commandName: 'command name', aliasWord: 'alias, replaced when the line is read', expandedName: 'first word', option: 'option', argument: 'argument',
          assignmentArgument: 'assignment argument', word: 'word', name: 'name', assignment: 'assignment', redirect: 'redirection', heredoc: 'here-document', quote: 'quotes',
          expansion: 'expansion', substitution: 'substitution', arithmetic: 'arithmetic expansion', brace: 'brace expansion', operator: 'operator', keyword: 'reserved word',
          comment: 'comment', shebang: 'shebang, a comment to bash', expression: 'expression', descriptor: 'file descriptor', delimiter: 'delimiter', part: 'part',
        },
        commandKinds: { argument: 'operand' },
        valueFor: 'value of {flag}',
        valueExpands: 'value of {flag}: the first of the expanded words; the rest are operands',
        expands: { glob: '{kind}: each matching file name', split: '{kind}: each word it splits into', brace: '{kind}: each word the braces give', elements: '{kind}: each element' },
        resolves: { alias: 'alias', keyword: 'reserved word', function: 'function', builtin: 'builtin', file: 'program', none: 'nothing runs' },
        tokenKinds: {
          command: 'runs', subcommand: 'subcommand', builtin: 'builtin', function: 'function', alias: 'alias', keyword: 'keyword', option: 'option', argument: 'argument',
          operator: 'operator', redirect: 'redirection', variable: 'variable', expansion: 'expansion', substitution: 'substitution', string: 'literal',
          number: 'number', comment: 'comment', shebang: 'shebang', assignment: 'assignment', test: 'condition', pattern: 'pattern', block: 'block', error: 'error',
        },
        about: {
          line: 'bash splits the line into commands, then each simple command into assignments, words and redirections.',
          script: 'The shell parses this text again, as a script of its own, and runs it: a subshell does, in `$( )`, `<( )` and backquotes.',
          list: 'A list: pipelines separated by `;`, `&` or newlines. `&&` and `||` bind tighter, so each part is a pipeline or an AND or OR list. `;` waits for the part before it to end; `&` runs that part alone in the background.',
          andList: 'An AND list: `a && b` runs `b` only if `a` succeeds (status 0). A chain of `&&` and `||` is read from the left.',
          orList: 'An OR list: `a || b` runs `b` only if `a` fails (non-zero status). A chain of `&&` and `||` is read from the left.',
          command: 'A simple command: assignments, words and redirections. bash expands the words; the first field is the command name, and the others are its arguments.',
          commandName: 'The command name: bash looks it up (a function, a builtin, then a file in PATH) and runs it with the arguments.',
          aliasWord: 'An alias: bash replaces the first word with the text of the alias when it reads the line. That comes before the words are expanded, so the name it looks up is the first word of the text, and the rest are arguments.',
          option: 'An option of a reserved word: bash reads it as written. It is not a word that bash expands.',
          expandedName: 'The command name is known only when it runs: bash expands the words, and the first field is the name, the others its arguments. If this word expands to nothing, the next word gives the name.',
          argument: 'An argument: bash expands it and passes its fields to the command.',
          assignmentArgument: 'An argument that is an assignment: bash expands it as an assignment (no word splitting or globbing of the value) and passes it to the builtin, which assigns it.',
          word: 'A word: bash expands it, then passes on the result.',
          heredoc: 'The body of the here-document: it becomes the input of the command, on its standard input (fd 0) or on the descriptor written before `<<`.',
          descriptor: 'A file descriptor: the number the redirection changes. Written `{fd}`, bash picks a free one (10 or higher) and puts its number in the variable `fd` (with `>&-` and `<&-`, it closes the one whose number is in the variable).',
          delimiter: 'The delimiter of a here-document: a line with this word alone ends the body. bash does not expand it; if any part of it is quoted, it does not expand the body either.',
          keyword: 'A reserved word: a word bash reads as part of the syntax (`if`, `do`, `{`, `!`…) when it is unquoted and the first word of a command, or where the syntax expects it (`in` after `for x`).',
          expression: 'An expression: bash reads it itself, as a conditional expression in `[[ ]]`, and as an arithmetic one in `(( ))`, `$(( ))`, the offset and length of `${x:i:n}` and the index of an indexed array. It is not a word that bash expands and passes on.',
          language: 'A language of its own inside the word: the command reads it by its own rules, not bash.',
          bashLanguage: 'The regex on the right of `=~`: bash itself matches the left side against it, by the rules of a POSIX extended regular expression (ERE).',
          promptLanguage: 'A prompt string (the value of `PS1`, `PS4`…): each time bash prints the prompt, it replaces the backslash escapes, then expands the result.',
        },
        languages: {
          regex: 'regex', glob: 'glob pattern', sed: 'sed script', awk: 'awk program', jq: 'jq filter', yq4: 'yq expression', yq3path: 'yq path',
          printf: 'printf format', echo: 'escapes', date: 'date format', perl: 'Perl', mode: 'file mode', umask: 'umask', sortkey: 'sort key',
          cutfields: 'field list', cutchars: 'character list', trset: 'character set', getopts: 'option letters', getoptshort: 'option letters',
          getoptlong: 'long options', gitformat: 'git format', gitdate: 'git date', arith: 'arithmetic', prompt: 'prompt string',
        },
      },
    },
  },
} satisfies Record<Lang, unknown>;

/** Display features that can each be turned on or off. */
export type Feature = keyof typeof ui.ja.features;

/** The features, in the order the status bar's menu lists them. */
export function featureNames(lang: Lang) {
  return Object.keys(ui[lang].features) as Feature[];
}
