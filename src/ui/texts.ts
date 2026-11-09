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
      // (The depths of the panel, in its view slot (docs/design/usability-9.md, Q1): the names on the control; the full ones, their
      // tooltip with the key that chooses each in the panel; what a screen reader hears of the one chosen, and the menu's button.)
      views: '深さ', depths: { 1: { short: '概要', full: '何をするか' }, 2: { short: '単語ごと', full: '{shell}が単語ごとにどう読むか' } },
      depthKey: '{full}（パネルの中ではキー {n}）', depthSaid: '{views}: {short}（{full}）',
      // (The short words of the panel's tools, each contained in the tool's name: src/ui/panelHead.ts.)
      words: { collapse: '折りたたむ', expand: '展開する', copy: 'Markdown でコピー', copyShort: 'Markdown', reference: '早見表', referenceShort: '早見表' },
      // (The sentence of the line at the top of the view, `LineExplanation.sentence`.)
      inShort: 'ひとことで',
      // (The box of the line's problems: src/ui/panelProblems.ts.)
      problems: {
        title: 'この行の問題', more: '詳しく', fix: '修正案', copyFix: '修正をコピー', toRow: '解説の行へ移動', toProblem: 'この行の問題へ移動', levelSaid: '{level}、{word}',
        // (Why a fix stops with `return 1 2>/dev/null || exit 1`: `Rewrite.sourcedOrRun`.)
        sourcedOrRun: '`source` で読まれたら `return`、実行されたら `exit`',
        onLine: '行 {n} の{word}', toLine: '行 {n} へ移動',
      },
      // (What a screen reader hears between the reading of a worked example's highlighted part and the part itself.)
      saidSep: '：',
      // (The line box of a line over more than three rows: its tooltip, folded and opened.)
      lineOpen: 'クリックで行全体を表示', lineFold: 'クリックで 3 行までに折りたたむ',
      // (The Legend of the panel: what each mark drawn means, src/ui/panelRows.ts.)
      key: {
        frame: {
          command: '1 つのコマンド', compound: '1 つの複合コマンド（`if`・`for`・`[[ ]]` など）', group: 'パイプラインやリスト（`|`・`&&`・`||`・`;`）でつないだコマンド',
        },
        names: {
          program: '{shell}が PATH から見つけて起動するプログラム', builtin: '{shell}に組み込まれたコマンド', function: 'シェルの関数（スクリプトで定義したもの、または bats の `run` のようにホストが用意したもの）', alias: '{shell}が読むときに置き換えるエイリアス',
          keyword: '{shell}の予約語', none: '実行できるものが見つからない名前', sourced: 'プログラムか、前に読み込んだファイルの関数',
        },
        roles: {
          command: 'コマンド名', builtin: 'ビルトイン', option: 'オプション', argument: '引数', string: '文字列', number: '数値', keyword: '予約語', operator: '演算子や文法の部分',
          redirect: 'リダイレクト', pattern: 'パス名展開のパターン', variable: '変数と展開', assignment: '代入', comment: 'コメント', shebang: 'シバン(shebang)', error: '{shell}が読めない部分',
        },
        ref: 'bash マニュアルの節（押すと開く）', basis: 'マニュアルではなく、実際の bash で確かめた動作', roleLine: '{shell}にとっての役割と、それを読むもの',
        received: {
          asWritten: 'プログラムが書いたとおりに受け取る単語', changed: 'プログラムが変わった形で受け取る単語', hole: '実行するまで分からない値', many: '1 つとは限らない単語',
        },
        notPosix: 'sh によっては動かない書き方。bash の問題ではなく、sh に移すときに関わる',
      },
      // (What the switch adds, and the marks of the rows: src/ui/panelReceives.ts.)
      receives: {
        switch: 'プログラムが受け取るもの', on: 'プログラムが受け取るものを表示', off: 'プログラムが受け取るものを非表示',
        program: '受け取る単語:', onlyName: '受け取るのは名前だけ:', nothing: '単語が残らず、何も実行されない',
        inside: {
          builtin: { some: '{shell}の中で動き、受け取るのは:', none: '{shell}の中で動き、引数はなし' },
          function: { some: 'シェルの関数で、受け取るのは:', none: 'シェルの関数で、引数はなし' },
          sourced: { some: 'プログラムか、読み込んだファイルの関数で、受け取るのは:', none: 'プログラムか、読み込んだファイルの関数で、引数はなし' },
        },
        fails: '{shell}がここで止まり、実行されない: {error}',
        errors: {
          'ambiguous-redirect': 'リダイレクト先が 1 語にならない', 'no-match': 'パターンに合うファイル名がない（`failglob`）', unbound: '設定されていない変数がある（`set -u`）',
          'parameter-null': '変数が空か設定されていない（`${x:?}`）', substring: '`${x:offset:length}` の長さが負になる',
        },
        many: '1 つとは限らない単語', space: '空白',
        handled: '{shell}が処理', handledSays: '{shell}が処理し、プログラムの単語にはならない', bash: 'bash ', theShell: 'シェル', more: 'ほか {n} 語', notPosix: 'sh に移植できない', keyButton: '凡例',
      },
      // (What bash does to a word, on a row of depth 2: src/ui/panelSteps.ts.)
      steps: {
        lead: '{shell}の手順:', summary: '展開はなし', maybe: '{kind}（ありうる）', off: '{kinds}はしない', and: '・', lastAnd: '・', because: '（{why}）',
        kinds: { brace: 'ブレース展開', tilde: 'チルダ展開', parameter: 'パラメータ展開', command: 'コマンド置換', arithmetic: '算術展開', process: 'プロセス置換', split: '単語分割', glob: 'グロブ', 'quote-removal': 'クォート除去' },
        why: { quoted: 'クォート内', context: 'ここでは行わない', cond: '`[[ ]]` の中では行わない', assign: '代入では行わない', noglob: '`set -f`', 'ifs-empty': 'IFS が空', 'posix-mode': 'POSIX モード', 'braceexpand-off': 'braceexpand が無効', dialect: 'このシェルにはない', zsh: 'zsh' },
      },
      // (A row between two commands of a pipeline.)
      connector: { pipe: '{from} の標準出力 → {to} の標準入力', both: '{from} の標準出力と標準エラー出力 → {to} の標準入力' },
      tree: {
        reads: '{name} が読む',
        bands: { bash: '{shell}', child: { subshell: 'サブシェル', shell: '新しいシェル', same: '同じシェルでもう一度', remote: 'リモートのシェル', container: 'コンテナのシェル' } },
        readers: {
          bash: '{shell}が解析する',
          child: {
            subshell: 'サブシェル（このシェルのコピー）がもう一度解析する', shell: '新しく起動したシェル（別のプロセス）がもう一度解析する', same: 'それを実行するシェルが、この文字列をもう一度解析する（新しいプロセスなし）',
            remote: '別のマシンのシェルが解析する', container: 'コンテナの中のシェルが解析する',
          },
          command: '{shell}ではなく {name} が読む', inShell: 'シェルの中で {name} が読む', newBash: 'このシェルではなく、新しく起動した bash が読む', language: '{name} が読む独自の言語', bashLanguage: '{shell}自身が読む（正規表現の照合、POSIX の拡張正規表現(ERE)）',
          promptLanguage: '{shell}自身が、プロンプトを表示するたびに読む',
        },
        kinds: {
          line: '{shell}がこの行を読む', script: '中のスクリプト', list: 'リスト', andList: 'AND リスト', orList: 'OR リスト', andOrList: 'AND・OR リスト', pipeline: 'パイプライン', command: '単純コマンド', compound: '複合コマンド',
          clause: '節', coprocess: 'コプロセス', function: '関数定義', commandName: 'コマンド名', aliasWord: 'エイリアス（読むときに置き換わる）', expandedName: '最初の単語', option: 'オプション', argument: '引数',
          assignmentArgument: '代入の引数', value: '値', word: '単語', name: '名前', assignment: '代入', redirect: 'リダイレクト', heredoc: 'ヒアドキュメント', quote: 'クォート',
          expansion: '展開', substitution: '置換', arithmetic: '算術式展開', brace: 'ブレース展開', operator: '演算子', keyword: '予約語',
          comment: 'コメント', shebang: 'シバン（{shell}にとってはコメント）', expression: '式', descriptor: 'ファイルディスクリプタ', delimiter: '終わりの区切り', subscript: '添字', part: '部分',
        },
        commandKinds: {
          argument: 'オペランド', command: 'コマンド名', builtin: 'コマンド名', function: 'コマンド名', alias: 'コマンド名', option: 'オプション', subcommand: 'サブコマンド', test: '条件', operator: '演算子',
          assignment: '代入', variable: '変数名', block: 'グループ',
        },
        valueFor: '{flag} の値',
        placeholder: { path: 'プレースホルダー（パスに置き換わる）', item: 'プレースホルダー（入力の1件に置き換わる）' },
        valueExpands: '{flag} の値: 展開された最初の語。残りはオペランド',
        expands: { glob: '{kind}: 一致したファイル名ごと', split: '{kind}: 分割された語ごと', brace: '{kind}: ブレース展開の語ごと', elements: '{kind}: 要素ごと' },
        resolves: { alias: 'エイリアス', keyword: '予約語', function: '関数', builtin: 'ビルトイン', file: '外部コマンド', none: '実行されない' },
        about: {
          line: '{shell}はこの行をコマンドに分け、単純コマンドをさらに代入・単語・リダイレクトに分ける。',
          value: '代入の値: {shell}がチルダ展開・パラメータ展開・コマンド置換・算術展開をしてクォートを取り除き、その結果を代入する。単語分割とグロブはしない。',
          script: 'シェルがこのテキストを独立したスクリプトとしてもう一度解析し、実行する。`$( )`・`<( )`・バッククォートではサブシェルが実行する。',
          list: 'リスト: `;`・`&`・改行で区切ったパイプラインの並び。`&&` と `||` のほうが強く結び付くので、区切られた1つ1つはパイプライン、または `&&` と `||` でつないだ AND リスト・OR リスト。`;` はその前の部分の終了を待ち、`&` はその前の部分だけをバックグラウンドで実行する。',
          andList: 'AND リスト: `a && b` は `a` が成功（終了ステータス 0）したときだけ `b` を実行する。`&&` と `||` が続くときは左から読む。',
          orList: 'OR リスト: `a || b` は `a` が失敗（終了ステータス 0 以外）したときだけ `b` を実行する。`&&` と `||` が続くときは左から読む。',
          andOrList: 'AND・OR リスト: `&&` と `||` が混ざったリスト。`&&` と `||` は優先順位が同じなので左から読み、`&&` の次はそこまでの終了ステータスが 0 のときだけ、`||` の次は 0 以外のときだけ実行する。例えば `a && b || c` は `(a && b) || c`。',
          command: '単純コマンド: 代入・単語・リダイレクトからなる。{shell}が単語を展開し、最初のフィールドをコマンド名、残りを引数とする。',
          commandName: 'コマンド名: {shell}が探し（関数、ビルトイン、PATH の中のファイルの順）、引数を渡して実行する。',
          aliasWord: 'エイリアス: {shell}は行を読むときに、最初の単語をエイリアスの中身に置き換える。単語の展開より前なので、探すコマンド名は中身の最初の単語で、残りは引数になる。',
          option: '予約語のオプション: {shell}は書いたとおりに読む。展開する単語ではない。',
          expandedName: 'コマンド名は実行するときに決まる: {shell}が単語を展開し、最初のフィールドがコマンド名、残りが引数になる。この単語が何にも展開されなければ、次の単語が名前になる。',
          argument: '引数: {shell}が展開し、そのフィールドをコマンドに渡す。',
          assignmentArgument: '代入の形の引数: {shell}は代入として展開し（値は単語分割もグロブもされない）、ビルトインに渡す。ビルトインが代入する。',
          word: '単語: {shell}が展開し、その結果を渡す。',
          heredoc: 'ヒアドキュメントの本文: コマンドの入力になる。標準入力(fd 0)か、`<<` の前に書いたファイルディスクリプタ。',
          descriptor: 'ファイルディスクリプタ: リダイレクトが切り替える番号。`{fd}` と書くと、{shell}が空いている番号（10 以上）を選んで変数 `fd` に入れる（`>&-` と `<&-` では、変数の値の番号を閉じる）。',
          delimiter: 'ヒアドキュメントの終わりの区切り: この単語だけの行で本文が終わる。{shell}は展開しない。一部でもクォートすると、本文も展開しない。',
          keyword: '予約語: 引用符で囲まずにコマンドの最初の単語（`for x` の後の `in` のように、構文がそれを待つ位置も）に書いたとき、{shell}が構文の一部として読む単語（`if`、`do`、`{`、`!` など）。',
          subscript: '添字 `@`・`*`: 配列の 1 つの要素ではなく、すべての要素。式ではない。',
          expression: '式: `[[ ]]` は条件式として、`(( ))`・`$(( ))`・`${x:i:n}` の位置と長さ・インデックス配列の添字は算術式として {shell}自身が読む。単語のように展開して渡すのではない。',
          language: '単語の中にある独自の言語: {shell}ではなく、コマンドが独自の規則で読む。',
          bashLanguage: '`=~` の右辺の正規表現: {shell}自身が、POSIX の拡張正規表現(ERE)の規則で左辺と照合する。',
          promptLanguage: 'プロンプト文字列（`PS1`・`PS4` などの値）: {shell}自身が、プロンプトを表示するたびにバックスラッシュのエスケープを置き換え、その結果を展開する。',
        },
        languages: {
          regex: '正規表現', glob: 'glob パターン', sed: 'sed スクリプト', awk: 'awk プログラム', jq: 'jq フィルター', yq4: 'yq の式', yq3path: 'yq のパス',
          printf: 'printf の書式', echo: 'エスケープ', date: 'date の書式', perl: 'Perl', mode: 'ファイルモード', umask: 'umask', sortkey: 'ソートキー',
          cutfields: 'フィールドの範囲', cutchars: '文字の範囲', trset: '文字の集合', getopts: 'オプション文字', getoptshort: 'オプション文字',
          getoptlong: '長いオプション', gitformat: 'git の書式', gitdate: 'git の日付', arith: '算術式', prompt: 'プロンプト文字列',
          bazeltarget: 'ターゲットのパターン', bazelquery: 'ターゲットのパターン', bazelaquery: 'ターゲットのパターン',
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
      views: 'Depth', depths: { 1: { short: 'Overview', full: 'What it does' }, 2: { short: 'Word by word', full: 'How {shell} reads it, word by word' } },
      depthKey: '{full} (key {n} in the panel)', depthSaid: '{views}: {short} ({full})',
      words: { collapse: 'Collapse', expand: 'Expand', copy: 'Copy as Markdown', copyShort: 'Markdown', reference: 'Reference', referenceShort: 'Ref' },
      inShort: 'In short',
      // (The box of the line's problems: src/ui/panelProblems.ts.)
      problems: {
        title: 'Problems on this line', more: 'More', fix: 'Fix', copyFix: 'Copy fix', toRow: 'Go to its row', toProblem: 'Go to the problem', levelSaid: '{level}, {word}',
        sourcedOrRun: '`return` if sourced, `exit` if run',
        onLine: '{word} on line {n}', toLine: 'Go to line {n}',
      },
      saidSep: ': ',
      lineOpen: 'Click to show the whole line', lineFold: 'Click to fold the line to three rows',
      // (The Legend of the panel: what each mark drawn means, src/ui/panelRows.ts.)
      key: {
        frame: {
          command: 'one command', compound: 'one compound command (`if`, `for`, `[[ ]]` and the like)', group: 'commands joined into a pipeline or a list (`|`, `&&`, `||`, `;`)',
        },
        names: {
          program: 'a program {shell} finds in PATH and starts', builtin: 'a command built into {shell}', function: 'a shell function: the script\'s own, or one its host defines (bats\' `run`)', alias: 'an alias, replaced when {shell} reads the line',
          keyword: 'a reserved word of {shell}', none: 'a name with nothing to run', sourced: 'a program, or a function of a file read before here',
        },
        roles: {
          command: 'command name', builtin: 'builtin', option: 'option', argument: 'argument', string: 'string', number: 'number', keyword: 'reserved word', operator: 'operator or part of the grammar',
          redirect: 'redirection', pattern: 'glob pattern', variable: 'variable or expansion', assignment: 'assignment', comment: 'comment', shebang: 'shebang', error: 'a part {shell} cannot read',
        },
        ref: 'the section of the bash manual (click to open it)', basis: 'behaviour checked with a real bash, not stated in the manual', roleLine: 'its role to {shell}, and who reads it',
        received: {
          asWritten: 'the program receives this word exactly as written', changed: 'the program receives this word changed', hole: 'a value known only when the line runs', many: 'not always one word',
        },
        notPosix: 'a form some sh do not have: no problem in bash, but it matters when moving to sh',
      },
      // (What the switch adds, and the marks of the rows: src/ui/panelReceives.ts.)
      receives: {
        switch: 'What the program receives', on: 'Showing what each program receives', off: 'Not showing what each program receives',
        program: 'receives:', onlyName: 'receives only its name:', nothing: 'no word is left, so nothing runs',
        inside: {
          builtin: { some: 'runs inside {shell}, gets:', none: 'runs inside {shell}, gets no arguments' },
          function: { some: 'a function of the shell, gets:', none: 'a function of the shell, gets no arguments' },
          sourced: { some: 'a program, or a function of the file read, gets:', none: 'a program, or a function of the file read, gets no arguments' },
        },
        fails: '{shell} stops here, so it does not run: {error}',
        errors: {
          'ambiguous-redirect': 'the target of a redirection is not one word', 'no-match': 'no file name matches the pattern (`failglob`)', unbound: 'a variable is not set (`set -u`)',
          'parameter-null': 'a variable is empty or not set (`${x:?}`)', substring: 'the length in `${x:offset:length}` is negative',
        },
        many: 'not always one word', space: 'space',
        handled: 'handled by {shell}', handledSays: '{shell} handles it; it is not among the program\'s words', bash: 'bash', theShell: 'the shell', more: 'and {n} more words', notPosix: 'not portable to sh', keyButton: 'Legend',
      },
      steps: {
        lead: "{shell}'s steps:", summary: 'nothing expands', maybe: '{kind} (maybe)', off: 'no {kinds}', and: ', ', lastAnd: ' or ', because: ' ({why})',
        kinds: { brace: 'brace expansion', tilde: 'tilde expansion', parameter: 'parameter expansion', command: 'command substitution', arithmetic: 'arithmetic expansion', process: 'process substitution', split: 'word splitting', glob: 'globbing', 'quote-removal': 'quote removal' },
        why: { quoted: 'quoted', context: 'not done here', cond: 'not in `[[ ]]`', assign: 'not in an assignment', noglob: '`set -f`', 'ifs-empty': 'IFS is empty', 'posix-mode': 'POSIX mode', 'braceexpand-off': 'braceexpand is off', dialect: 'not in this shell', zsh: 'zsh' },
      },
      connector: { pipe: 'stdout of {from} → stdin of {to}', both: 'stdout and stderr of {from} → stdin of {to}' },
      tree: {
        reads: '{name} reads it',
        bands: { bash: '{shell}', child: { subshell: 'subshell', shell: 'new shell', same: 'same shell, again', remote: 'remote shell', container: 'container shell' } },
        readers: {
          bash: '{shell} parses it',
          child: {
            subshell: 'a subshell (a copy of this shell) parses it again', shell: 'a newly started shell (another process) parses it again', same: 'the shell that runs it parses this string again (no new process)',
            remote: 'a shell on another machine parses it', container: 'a shell in the container parses it',
          },
          command: '{name} reads it, not {shell}', inShell: '{name} reads it, inside the shell', newBash: 'a new bash reads it, not this shell', language: 'a language of its own, read by {name}', bashLanguage: '{shell} reads it itself (its regex matching, POSIX ERE)',
          promptLanguage: '{shell} reads it itself, each time it prints the prompt',
        },
        kinds: {
          line: '{shell} reads the line', script: 'script inside', list: 'list', andList: 'AND list', orList: 'OR list', andOrList: 'AND and OR list', pipeline: 'pipeline', command: 'simple command', compound: 'compound command',
          clause: 'clause', coprocess: 'coprocess', function: 'function definition', commandName: 'command name', aliasWord: 'alias, replaced when the line is read', expandedName: 'first word', option: 'option', argument: 'argument',
          assignmentArgument: 'assignment argument', value: 'value', word: 'word', name: 'name', assignment: 'assignment', redirect: 'redirection', heredoc: 'here-document', quote: 'quotes',
          expansion: 'expansion', substitution: 'substitution', arithmetic: 'arithmetic expansion', brace: 'brace expansion', operator: 'operator', keyword: 'reserved word',
          comment: 'comment', shebang: 'shebang, a comment to {shell}', expression: 'expression', descriptor: 'file descriptor', delimiter: 'delimiter', subscript: 'subscript', part: 'part',
        },
        commandKinds: {
          argument: 'operand', command: 'command name', builtin: 'command name', function: 'command name', alias: 'command name', option: 'option', subcommand: 'subcommand', test: 'condition', operator: 'operator',
          assignment: 'assignment', variable: 'variable name', block: 'group',
        },
        valueFor: 'value of {flag}',
        placeholder: { path: 'placeholder for the path', item: 'placeholder for the input item' },
        valueExpands: 'value of {flag}: the first of the expanded words; the rest are operands',
        expands: { glob: '{kind}: each matching file name', split: '{kind}: each word it splits into', brace: '{kind}: each word the braces give', elements: '{kind}: each element' },
        resolves: { alias: 'alias', keyword: 'reserved word', function: 'function', builtin: 'builtin', file: 'program', none: 'nothing runs' },
        about: {
          line: '{Shell} splits the line into commands, then each simple command into assignments, words and redirections.',
          value: 'The value of an assignment: {shell} does tilde and parameter expansion, command substitution and arithmetic expansion, removes the quotes, and assigns the result. It does no word splitting or globbing.',
          script: 'The shell parses this text again, as a script of its own, and runs it: a subshell does, in `$( )`, `<( )` and backquotes.',
          list: 'A list: pipelines separated by `;`, `&` or newlines. `&&` and `||` bind tighter, so each part is a pipeline or an AND or OR list. `;` waits for the part before it to end; `&` runs that part alone in the background.',
          andList: 'An AND list: `a && b` runs `b` only if `a` succeeds (status 0). A chain of `&&` and `||` is read from the left.',
          orList: 'An OR list: `a || b` runs `b` only if `a` fails (non-zero status). A chain of `&&` and `||` is read from the left.',
          andOrList: 'An AND and OR list: `&&` and `||` mixed. They have equal precedence, so the list is read from the left; after `&&` the next command runs only if the status so far is 0, after `||` only if it is not. `a && b || c` is `(a && b) || c`.',
          command: 'A simple command: assignments, words and redirections. {Shell} expands the words; the first field is the command name, and the others are its arguments.',
          commandName: 'The command name: {shell} looks it up (a function, a builtin, then a file in PATH) and runs it with the arguments.',
          aliasWord: 'An alias: {shell} replaces the first word with the text of the alias when it reads the line. That comes before the words are expanded, so the name it looks up is the first word of the text, and the rest are arguments.',
          option: 'An option of a reserved word: {shell} reads it as written. It is not a word that {shell} expands.',
          expandedName: 'The command name is known only when it runs: {shell} expands the words, and the first field is the name, the others its arguments. If this word expands to nothing, the next word gives the name.',
          argument: 'An argument: {shell} expands it and passes its fields to the command.',
          assignmentArgument: 'An argument that is an assignment: {shell} expands it as an assignment (no word splitting or globbing of the value) and passes it to the builtin, which assigns it.',
          word: 'A word: {shell} expands it, then passes on the result.',
          heredoc: 'The body of the here-document: it becomes the input of the command, on its standard input (fd 0) or on the descriptor written before `<<`.',
          descriptor: 'A file descriptor: the number the redirection changes. Written `{fd}`, {shell} picks a free one (10 or higher) and puts its number in the variable `fd` (with `>&-` and `<&-`, it closes the one whose number is in the variable).',
          delimiter: 'The delimiter of a here-document: a line with this word alone ends the body. {Shell} does not expand it; if any part of it is quoted, it does not expand the body either.',
          keyword: 'A reserved word: a word {shell} reads as part of the syntax (`if`, `do`, `{`, `!`…) when it is unquoted and the first word of a command, or where the syntax expects it (`in` after `for x`).',
          subscript: 'The subscript `@` or `*`: all the elements of the array, not one. It is no expression.',
          expression: 'An expression: {shell} reads it itself, as a conditional expression in `[[ ]]`, and as an arithmetic one in `(( ))`, `$(( ))`, the offset and length of `${x:i:n}` and the index of an indexed array. It is not a word that {shell} expands and passes on.',
          language: 'A language of its own inside the word: the command reads it by its own rules, not {shell}.',
          bashLanguage: 'The regex on the right of `=~`: {shell} itself matches the left side against it, by the rules of a POSIX extended regular expression (ERE).',
          promptLanguage: 'A prompt string (the value of `PS1`, `PS4`…): each time {shell} prints the prompt, it replaces the backslash escapes, then expands the result.',
        },
        languages: {
          regex: 'regex', glob: 'glob pattern', sed: 'sed script', awk: 'awk program', jq: 'jq filter', yq4: 'yq expression', yq3path: 'yq path',
          printf: 'printf format', echo: 'escapes', date: 'date format', perl: 'Perl', mode: 'file mode', umask: 'umask', sortkey: 'sort key',
          cutfields: 'field list', cutchars: 'character list', trset: 'character set', getopts: 'option letters', getoptshort: 'option letters',
          getoptlong: 'long options', gitformat: 'git format', gitdate: 'git date', arith: 'arithmetic', prompt: 'prompt string',
          bazeltarget: 'target pattern', bazelquery: 'target pattern', bazelaquery: 'target pattern',
        },
      },
    },
  },
} satisfies Record<Lang, unknown>;

/** Display features that can each be turned on or off. */
export type Feature = keyof typeof ui.ja.features;

/** The features, in the order the status bar's menu lists them. */
export function featureNames(): Feature[] {
  return Object.keys(ui.ja.features) as Feature[];
}

type Panel = (typeof ui)[Lang]['panel'];

/** The name of the shell that reads the script, as the panel's texts say it: bash unless the script is explained as another shell's, then "the shell". */
export function shellWord(lang: Lang, shell: string | undefined): string {
  const t = ui[lang].panel.receives;
  return inBash(shell) ? t.bash : t.theShell;
}

/** Whether a script explained as `shell` is bash's (`LineExplanation.shell` is absent for bash). */
const inBash = (shell: string | undefined): boolean => !shell || shell === 'bash';

// (The panel's texts are strings in objects, nothing else: the test of `panelTexts` checks that the shapes stay the same.)
const put = (value: unknown, word: string, sentence: string): unknown => (typeof value === 'string'
  ? (value === '{shell}' ? word.trim() : value.replace(/([぀-ヿ一-鿿]) \{shell\}/g, (_, kana: string) => kana + (word.endsWith(' ') ? ' ' : '') + word).replace(/\{shell\}/g, word).replace(/\{Shell\}/g, sentence))
  : Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, put(v, word, sentence)])));
const shelled = new Map<string, Panel>();

/**
 * The panel's texts with the name of the script's shell in place of `{shell}` (`{Shell}` at the start of a sentence: bash stays "bash"): a script
 * explained as sh is not read by "bash", and a fact about bash alone (a text that does not say `{shell}`) stays as it is.
 */
export function panelTexts(lang: Lang, shell: string | undefined): Panel {
  const bash = inBash(shell);
  const key = lang + (bash ? '' : '*');
  let made = shelled.get(key);
  if (!made) {
    const word = shellWord(lang, shell);
    made = put(ui[lang].panel, word, bash ? word : lang === 'en' ? 'The shell' : word) as Panel;
    shelled.set(key, made);
  }
  return made;
}
