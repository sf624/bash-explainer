import { pictureText } from '../ctlchars';
import { Example, ExampleSection, Kind, LineExplanation, Pos, Span, Token, ValueInfo } from '../analyzer-types';
import { SHELL_NAMES } from '../dialect';
import { Lang } from '../i18n';
import { codeSpan, joinParts, LabelPart, labelParts } from '../label';
import { referencesWith } from '../references';
import { MARKS, type Note, type NoteLevel } from '../messages';
import { errorColour, Role, roleColour, ThemeKind } from './palette';

/** (Moved to src/label.ts, which the message catalog reads too.) */
export { codeSpan };

export const ui = {
  ja: {
    title: 'Bash Explainer',
    line: (n: number) => `${n} 行目`,
    lineShort: (n: number) => `行 ${n}`,
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
    panel: {
      copy: 'Markdown でコピー', copied: '解説を Markdown としてコピーしました。', expandAll: 'すべて展開', collapseAll: 'すべて折りたたむ',
      reference: '早見表', search: '検索（例: ${、2>&1、-f、grep）', back: '← 解説に戻る', shell: 'シェル', yq: 'yq', auto: '自動',
      editHint: '書き換えられます（結果はその場で更新）', noMatch: '該当なし',
      // (The fold button of a row with parts, named by the row's label; the links' note on where they open: `linkNote`, src/ui/panelView.ts.)
      partsOf: '{name} の内訳', opensTab: '（新しいタブで開く）', opensBrowser: '（ブラウザで開く）',
      views: '表示', listView: '意味', treeView: '読まれ方',
      // (Prototype B) What each depth adds, the quoting notes of depth 1, and how a program's reading of a word is said.
      depth: {
        captions: ['各コマンドが何をするかと、各単語がそのコマンドにとって何か',
          'bash の読み方を追加: 構文・単語の部品・役割'],
        hide: 'この行を隠す', hideTitle: 'この行を隠す（凡例にも載っている）', keyClose: '凡例を閉じる',
        quotes: {
          double: 'ダブルクォート: 単語分割もグロブ展開もしない。`$`・バッククォート・`$(…)` は展開される',
          single: 'シングルクォートの中: 書いたとおりの1つの単語（何も展開されない）',
          ansi: '`$\'…\'` の中: 1つの単語のまま。`\\n` などのバックスラッシュのエスケープが置き換わる',
        },
        readsAs: '{name} が{kind}として読む', readsExpanded: '{name} が展開後の単語を{kind}として読む',
        readsGlob: '{name} が一致した名前をそれぞれ{kind}として読む', valueOf: '{flag} の値',
        from: { meaning: '{code}: {text}', line: '{code}: {n} 行目で代入した値', loop: '{code}: ループ変数（{n} 行目）' },
        // (An expansion's row at depth 2: what bash puts in its place, said once.)
        // (Round 6: where the value comes from is said once, on the word, at both depths.)
        param: { meaning: 'パラメータ展開: bash が {code} をその値（{text}）に置き換える', line: 'パラメータ展開: bash が {code} を {n} 行目で代入した値に置き換える', loop: 'パラメータ展開: bash が {code} をループ変数の今の値（{n} 行目）に置き換える' },
        tilde: {
          home: 'チルダ展開: bash が {code} をホームディレクトリ（`$HOME`）に置き換える',
          user: 'チルダ展開: bash が {code} をユーザー {user} のホームディレクトリに置き換える',
          pwd: 'チルダ展開: bash が {code} を現在のディレクトリ（`$PWD`）に置き換える',
          oldpwd: 'チルダ展開: bash が {code} を直前のディレクトリ（`$OLDPWD`）に置き換える',
        },
        pipe: 'パイプ: {left} の標準出力を {right} の標準入力へ渡す',
        defs: {
          command: '単純コマンド: bash が単語を展開し、最初の単語をコマンド名、残りを引数として実行する',
          keyword: 'コマンドではなく、bash の構文の一部',
        },
        form: '書式:', showKeywords: '予約語と区切りを表示（{n}）', hideKeywords: '予約語と区切りを隠す',
        exampleTitle: '例: {code}', globTitle: '例: {glob} に一致する名前',
        madeUp: ' · 入力は例', editable: '・編集できる',
        redirFor: '{name} だけに働く: bash が {name} の起動前に設定する',
        context: 'この行を囲む{label}（{n} 行目）',
        more: '定義', moreRoles: 'ほかの役割: {list}',
        argv: {
          receives: '{name} が受け取る単語:', effect: '（{e}）', inside: '{name} は bash の中で動き、引数だけを受け取る:', insideNone: '{name} は bash の中で動き、引数はない', quotes: 'クォートは取り除かれ、{name} には中身だけが渡る', sep: '、',
          handled: 'bash が処理し、{name} の引数には入らない: {list}',
          argv0: '最初の単語はプログラム自身の名前（argv[0]）',
          title: 'プログラムが受け取る単語（argv）。‹…› は実行するまで分からない値',
          many: '0 個以上の単語になる',
        },
        who: {
          label: 'プログラムに渡るもの', title: '各プログラムが受け取る単語を表示する（W キー）',
          caption: '各コマンドの下に、受け取る単語を表示。',
        },
        bashMark: 'bash', bashMarkTitle: 'bash が自分で処理する（プログラムには渡らない）',
        progRole: '→ {role}', progRoleWho: '（{name} が読む）', partOf: '{code} の一部', literal: '文字列 {code} そのもの',
        cond: { none: 'プログラムは実行されない: bash が {code} を自分で評価する', after: '展開した後に評価する式:' },
        summary: 'まとめ:',
        simple: '単純コマンド: bash が単語を展開してから {name} を実行する',
        chainTitle: '例: 各段階がデータをどう変えるか',
        forms: {
          if: 'if ‹テストのコマンド›; then ‹実行するコマンド›; fi', for: 'for ‹名前› in ‹単語›; do ‹コマンド›; done',
          while: 'while ‹テストのコマンド›; do ‹コマンド›; done', until: 'until ‹テストのコマンド›; do ‹コマンド›; done',
          case: 'case ‹単語› in ‹パターン›) ‹コマンド› ;; esac', select: 'select ‹名前› in ‹単語›; do ‹コマンド›; done',
          '[[': '[[ ‹条件式› ]]', '((': '(( ‹算術式› ))', '{': '{ ‹コマンド›; }', '(': '( ‹コマンド› )', do: 'do ‹コマンド›; done',
        },
        problemsAlso: '「問題」にも表示',
        risks: 'この行の注意点', riskJump: 'この{label}の行へ移動',
        legend: { tint: '色付き: プログラムが受け取るもの', bash: 'bash が処理', box: 'コマンド（枠の線）' },
        key: {
          title: '凡例',
          marks: '印',
          ph: '‹…›: 実行するまで分からない値', many: '点線の枠: 0 個以上の単語になる', partOf: '`-czf` の一部: まとめて渡る単語の一部（色は付かない）',
          argvText: '「プログラムに渡るもの」: 各コマンドの下に、受け取る単語（argv）を順に表示。最初の単語はプログラム自身の名前。代入とリダイレクトは入らない',
          bars: '左の線の色（部分の種類）',
          kinds: [['command', 'コマンド名'], ['option', 'オプション'], ['argument', '引数'], ['variable', '展開'], ['name', '変数名・代入'], ['pattern', 'グロブのパターン'], ['redirect', 'リダイレクト'], ['operator', '予約語・演算子']],
          chips: 'チップ（深さ 2）', role: '引数', roleText: 'bash にとっての役割（押すと定義）',
          prog: '→ オプション', progText: 'プログラムにとっての役割',
          badgeText: 'bash が実行するもの（`プログラム`: PATH から見つけるファイル、`ビルトイン`: bash に組み込まれたコマンド）',
          ref: '§3.7.1: bash マニュアルの節（ほかの節はツールチップ）',
          problems: '注意点', warning: '警告: 失敗やデータの消失につながりうる', info: '注意: 知っておくとよいこと',
          order: 'bash が単語を作る順: ブレース展開、チルダ展開・パラメータ展開・コマンド置換・算術式展開、単語分割、グロブ展開、最後にクォートの除去',
          keys: 'キー: `1`・`2` で深さ、`W` で「プログラムに渡るもの」',
        },
      },
      tree: {
        label: '行の各部分を誰が読むか', show: '深さ',
        // (Prototype B) The depths of the one view: their short names (the buttons) and their names.
        steps: [['何をするか', '各コマンドが何をするか'], ['bash の読み方', 'bash が行をどう読むか: 構文と単語の部品']],
        stepper: {
          group: '深さ', back: '浅く', forward: '深く',
          step: '深さ {i}/{n}：{name}', empty: 'この行では増えるものなし', jump: '深さを選ぶ',
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
        expands: { glob: '{kind}: 一致したファイル名ごと', split: '{kind}: 分割された語ごと', brace: '{kind}: ブレース展開の語ごと' },
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
          expression: '式: `[[ ]]` は条件式として、`(( ))`・`$(( ))`・`${x:i:n}` の位置と長さは算術式として bash 自身が読む。単語のように展開して渡すのではない。',
          language: '単語の中にある独自の言語: bash ではなく、コマンドが独自の規則で読む。',
          bashLanguage: '`=~` の右辺の正規表現: bash 自身が、POSIX の拡張正規表現(ERE)の規則で左辺と照合する。',
        },
        languages: {
          regex: '正規表現', glob: 'glob パターン', sed: 'sed スクリプト', awk: 'awk プログラム', jq: 'jq フィルター', yq4: 'yq の式', yq3path: 'yq のパス',
          printf: 'printf の書式', echo: 'エスケープ', date: 'date の書式', perl: 'Perl', mode: 'ファイルモード', umask: 'umask', sortkey: 'ソートキー',
          cutfields: 'フィールドの範囲', cutchars: '文字の範囲', trset: '文字の集合', getopts: 'オプション文字', getoptshort: 'オプション文字',
          getoptlong: '長いオプション', gitformat: 'git の書式', gitdate: 'git の日付', arith: '算術式',
        },
      },
    },
  },
  en: {
    title: 'Bash Explainer',
    line: (n: number) => `Line ${n}`,
    lineShort: (n: number) => `line ${n}`,
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
    panel: {
      copy: 'Copy as Markdown', copied: 'Copied the explanation as Markdown.', expandAll: 'Expand all', collapseAll: 'Collapse all',
      reference: 'Quick reference', search: 'Search (e.g. ${, 2>&1, -f, grep)', back: '← Back to the explanation', shell: 'Shell', yq: 'yq', auto: 'Auto',
      editHint: 'Editable; the result updates as you type', noMatch: 'Nothing found',
      partsOf: 'Parts of {name}', opensTab: '(opens in a new tab)', opensBrowser: '(opens in the browser)',
      views: 'View', listView: 'Meaning', treeView: 'Reading',
      depth: {
        captions: ['Each command, and what each word is to it',
          "Adds bash's reading: syntax, word parts, roles"],
        hide: 'Hide this line', hideTitle: 'Hide this line (the Key keeps it)', keyClose: 'Close the key',
        quotes: {
          double: 'Double quotes: no word splitting or globbing; `$`, backquotes and `$(…)` still expand',
          single: 'In single quotes: one word, exactly as written (nothing expands)',
          ansi: 'In `$\'…\'`: stays one word; backslash escapes such as `\\n` are replaced',
        },
        readsAs: '{name} reads it as {kind}', readsExpanded: '{name} reads the expanded word as {kind}',
        readsGlob: '{name} reads each matching name as {kind}', valueOf: 'the value of {flag}',
        from: { meaning: '{code}: {text}', line: '{code}: the value set on line {n}', loop: '{code}: the loop variable (line {n})' },
        // (Round 6: where the value comes from is said once, on the word, at both depths.)
        param: { meaning: 'Parameter expansion: bash replaces {code} with its value ({text})', line: 'Parameter expansion: bash replaces {code} with the value set on line {n}', loop: "Parameter expansion: bash replaces {code} with the loop variable's current value (line {n})" },
        tilde: {
          home: 'Tilde expansion: bash replaces {code} with your home directory (`$HOME`)',
          user: 'Tilde expansion: bash replaces {code} with the home directory of user {user}',
          pwd: 'Tilde expansion: bash replaces {code} with the current directory (`$PWD`)',
          oldpwd: 'Tilde expansion: bash replaces {code} with the previous directory (`$OLDPWD`)',
        },
        pipe: "Pipe: {left}'s stdout goes to {right}'s stdin",
        defs: {
          command: 'Simple command: bash expands the words; the first is the command name, the rest its arguments',
          keyword: "part of bash's syntax, not a command",
        },
        form: 'Form:', showKeywords: 'Show the keywords ({n})', hideKeywords: 'Hide the keywords',
        exampleTitle: 'Example: {code}', globTitle: 'Example: which names match {glob}',
        madeUp: ' · sample input', editable: ', editable',
        redirFor: 'For {name} only: bash sets it up before {name} starts',
        context: 'The {label} around this line (line {n})',
        more: 'definition', moreRoles: 'Also: {list}',
        argv: {
          receives: '{name} receives:', effect: ' ({e})', inside: '{name} runs inside bash and gets its arguments only:', insideNone: '{name} runs inside bash; it gets no arguments', quotes: 'The quotes are removed; {name} gets the bare value', sep: ', ',
          handled: "Handled by bash, not in {name}'s arguments: {list}",
          argv0: "the first word is the program's own name (argv[0])",
          title: 'The words the program receives (argv); ‹…›: a value known only when it runs',
          many: 'becomes any number of words',
        },
        who: {
          label: 'What the program sees', title: 'Show the words each program receives (key W)',
          caption: 'Under each command, the words it receives.',
        },
        bashMark: 'bash', bashMarkTitle: 'bash handles it itself (the program does not receive it)',
        progRole: '→ {role}', progRoleWho: '({name} reads it)', partOf: 'part of {code}', literal: 'The text {code} itself',
        cond: { none: 'No program runs: bash evaluates {code} itself', after: 'What it evaluates after expansion:' },
        summary: 'In short:',
        simple: 'Simple command: bash expands its words, then runs {name}',
        chainTitle: 'Example: what each stage makes of the data',
        forms: {
          if: 'if ‹test-commands›; then ‹consequent-commands›; fi', for: 'for ‹name› in ‹words›; do ‹commands›; done',
          while: 'while ‹test-commands›; do ‹consequent-commands›; done', until: 'until ‹test-commands›; do ‹consequent-commands›; done',
          case: 'case ‹word› in ‹pattern›) ‹commands› ;; esac', select: 'select ‹name› in ‹words›; do ‹commands›; done',
          '[[': '[[ ‹expression› ]]', '((': '(( ‹expression› ))', '{': '{ ‹list›; }', '(': '( ‹list› )', do: 'do ‹commands›; done',
        },
        problemsAlso: 'also in Problems',
        risks: 'Risks on this line', riskJump: 'Go to the row of this {label}',
        legend: { tint: 'Tinted: what the program gets', bash: 'done by bash', box: 'a command (its outline)' },
        key: {
          title: 'Key',
          marks: 'Marks',
          ph: '‹…›: a value known only when it runs', many: 'dashed: any number of words', partOf: 'part of `-czf`: a piece of a word passed whole (not tinted)',
          argvText: "What the program sees: under each command, the words it receives (argv), in order; the first is the program's own name. Assignments and redirections are not among them",
          bars: 'Left bar colours (the kind of part)',
          kinds: [['command', 'command name'], ['option', 'option'], ['argument', 'argument'], ['variable', 'expansion'], ['name', 'variable name, assignment'], ['pattern', 'glob pattern'], ['redirect', 'redirection'], ['operator', 'reserved word, operator']],
          chips: 'Chips (depth 2)', role: 'argument', roleText: 'its role to bash (click for the definition)',
          prog: '→ option', progText: 'its role to the program',
          badgeText: 'what bash runs (`program`: a file it finds in PATH; `builtin`: a command built into bash)',
          ref: '§3.7.1: the section of the bash manual (others in its tooltip)',
          problems: 'Risks', warning: 'Warning: can lead to a failure or lost data', info: 'Caveat: good to know',
          order: 'The order in which bash makes the words: brace expansion; tilde, parameter, command and arithmetic expansion; word splitting; globbing; and last, quote removal',
          keys: 'Keys: `1` and `2` choose the depth, `W` turns What the program sees on and off',
        },
      },
      tree: {
        label: 'Who reads each part of the line', show: 'Depth',
        // (Prototype B) The depths of the one view.
        steps: [['What it does', 'what each command does'], ['How bash reads it', 'how bash reads the line: its syntax and the parts of each word']],
        stepper: {
          group: 'Depth', back: 'Less detail', forward: 'More detail',
          step: 'Depth {i} of {n}: {name}', empty: 'Adds nothing on this line', jump: 'Choose a depth',
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
        expands: { glob: '{kind}: each matching file name', split: '{kind}: each word it splits into', brace: '{kind}: each word the braces give' },
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
          expression: 'An expression: bash reads it itself, as a conditional expression in `[[ ]]`, and as an arithmetic one in `(( ))`, `$(( ))` and the offset and length of `${x:i:n}`. It is not a word that bash expands and passes on.',
          language: 'A language of its own inside the word: the command reads it by its own rules, not bash.',
          bashLanguage: 'The regex on the right of `=~`: bash itself matches the left side against it, by the rules of a POSIX extended regular expression (ERE).',
        },
        languages: {
          regex: 'regex', glob: 'glob pattern', sed: 'sed script', awk: 'awk program', jq: 'jq filter', yq4: 'yq expression', yq3path: 'yq path',
          printf: 'printf format', echo: 'escapes', date: 'date format', perl: 'Perl', mode: 'file mode', umask: 'umask', sortkey: 'sort key',
          cutfields: 'field list', cutchars: 'character list', trset: 'character set', getopts: 'option letters', getoptshort: 'option letters',
          getoptlong: 'long options', gitformat: 'git format', gitdate: 'git date', arith: 'arithmetic',
        },
      },
    },
  },
} satisfies Record<Lang, unknown>;

/** The sections of the manual a note cites: those of the fact it says (`LineExplanation.facts`), if it is one. */
export function noteRefs(ex: LineExplanation, note: string): readonly string[] | undefined {
  return ex.facts?.find((f) => f.text === note)?.refs;
}

const RANK: Record<NoteLevel, number> = { warning: 0, info: 1, note: 2 };

/** The data of a note of the line (`LineExplanation.noteInfo`): its level and its word come from there, never from its text. */
export function noteOf(ex: LineExplanation, note: string): Note {
  return ex.noteInfo[ex.notes.indexOf(note)];
}

/**
 * Notes of the line (`notes`, all of them by default) in the order every output shows them: the warnings, then the
 * information, then the other notes, each in the order found.
 */
export function notesByLevel(ex: LineExplanation, notes: readonly string[] = ex.notes): Note[] {
  return notes.map((n, i) => ({ n: noteOf(ex, n), i })).sort((a, b) => RANK[a.n.level] - RANK[b.n.level] || a.i - b.i).map((x) => x.n);
}

/** "Bash manual [3.2.5.2](…), [6.4](…); [execve(2)](…)": the references as Markdown links (src/references.ts). */
export function refsMarkdown(lang: Lang, refs: readonly string[]): string {
  return referencesWith(lang, refs, (r, shown) => `[${shown}](${r.url} "${r.title}")`);
}

/** " (Bash manual 3.7.2; execve(2))", after a row that cites references. */
export function refsText(lang: Lang, refs: readonly string[]): string {
  return ` (${referencesWith(lang, refs, (_, shown) => shown)})`;
}

/**
 * A token's explanation for an output with no badge (the hover, Markdown, the CLI): with the kind of its command name,
 * and who runs it, when it is one (`Token.name`): "Print arguments to stdout (builtin)".
 */
export function explained(tok: Token): string {
  return pictureText(tok.name ? tok.explanation + tok.name.said.short : tok.explanation);
}

/**
 * The value of an expansion where it runs (`Token.value`: the model's), for a row of a Markdown list: a hard line
 * break, then the line, indented by `indent` under the row's text. Empty without a value.
 */
export function valueMarkdown(value: ValueInfo | undefined, indent: string): string {
  return value ? `\\\n${indent}${pictureText(value.said.text)}` : '';
}

/** Display features that can each be turned on or off. */
export type Feature = keyof typeof ui.ja.features;

/**
 * Where worked examples go: under the token they explain, before (`first`) or after (`last`) the
 * explanations of its parts, or all together at the end (`bottom`).
 */
export type ExamplePlacement = 'first' | 'last' | 'bottom';

function covers(outer: Span, inner: Span): boolean {
  const le = (a: Pos, b: Pos) => a.line < b.line || (a.line === b.line && a.character <= b.character);
  return le(outer.start, inner.start) && le(inner.end, outer.end);
}

/**
 * A copy of the explanation with each example moved onto the token for its anchor
 * (`Token.examples`): the outermost token with exactly that range, else the deepest one covering
 * it. Examples with no such token stay in `examples`, shown at the end.
 */
export function placeExamples(ex: LineExplanation): LineExplanation {
  const copy = (t: Token): Token => ({ ...t, children: t.children.map(copy), examples: undefined });
  const items = ex.items.map(copy);
  const rest: Example[] = [];
  for (const e of ex.examples) {
    let best: { tok: Token; depth: number } | undefined;
    let exact: Token | undefined;
    const visit = (t: Token, depth: number) => {
      if (!e.anchor || !covers(t.span, e.anchor)) return;
      if (!exact && covers(e.anchor, t.span)) exact = t;
      if (!best || depth >= best.depth) best = { tok: t, depth };
      t.children.forEach((c) => visit(c, depth + 1));
    };
    items.forEach((t) => visit(t, 0));
    const target = exact ?? best?.tok;
    if (target) (target.examples ??= []).push(e);
    else rest.push(e);
  }
  return { ...ex, items, examples: rest };
}

/** The colour role of each token kind; the same palette as the panel (media/panel.css). */
const KIND_ROLE: Record<Kind, Role | 'comment' | 'error'> = {
  command: 'command', subcommand: 'command', builtin: 'command', function: 'command', alias: 'command',
  option: 'option',
  argument: 'argument', string: 'argument', number: 'argument',
  operator: 'operator', keyword: 'operator', block: 'operator', test: 'operator',
  redirect: 'redirect', pattern: 'redirect',
  variable: 'variable', expansion: 'variable', substitution: 'variable', assignment: 'variable',
  comment: 'comment',
  // (The shebang names the program that runs the file: drawn as a command name, not as a comment.)
  shebang: 'command',
  error: 'error',
};

/** The CSS colour of a token kind in the hover, in a theme of that kind (src/ui/palette.ts). */
function kindColor(kind: Kind, theme: ThemeKind): string {
  const role = KIND_ROLE[kind];
  if (role === 'comment') return 'var(--vscode-descriptionForeground)';
  if (role === 'error') return errorColour(theme);
  return roleColour(role, theme);
}

/** Escape text for inline HTML inside Markdown (entities also stop `*`, `_` etc. acting as Markdown). */
export function esc(text: string): string {
  return text.replace(/[&<>"'*_`\\[\]~|#$]/g, (c) => `&#${c.charCodeAt(0)};`).replace(/ /g, '&nbsp;');
}

/** Hover HTML only keeps `<span style>` in exactly this shape: `color:<#hex|var(--vscode-…)>;`. */
export function colored(text: string, kind: Kind, theme: ThemeKind): string {
  return `<span style="color:${kindColor(kind, theme)};">${esc(text)}</span>`;
}


/** Split a line into runs, each owned by the deepest token covering it (as the panel does). */
export function lineSegments(text: string, line: number, items: Token[]): { text: string; kind?: Kind }[] {
  const owner: (Token | undefined)[] = new Array(text.length).fill(undefined);
  const depthAt: number[] = new Array(text.length).fill(-1);
  const visit = (tok: Token, depth: number) => {
    const { start, end } = tok.span;
    if (start.line <= line && end.line >= line) {
      const from = start.line < line ? 0 : start.character;
      const to = Math.min(end.line > line ? text.length : end.character, text.length);
      for (let i = from; i < to; i++) {
        if (depth >= depthAt[i]) {
          depthAt[i] = depth;
          owner[i] = tok;
        }
      }
    }
    tok.children.forEach((c) => visit(c, depth + 1));
  };
  items.forEach((t) => visit(t, 0));
  const out: { text: string; kind?: Kind }[] = [];
  for (let i = 0; i < text.length;) {
    let j = i;
    while (j < text.length && owner[j] === owner[i]) j++;
    const part = text.slice(i, j);
    out.push({ text: part, kind: part.trim() ? owner[i]?.kind : undefined });
    i = j;
  }
  return out;
}


/**
 * The words of a section of words (`ExampleSection.words`) on one line: each a code span, so that they read as separate
 * words, then what is said after them; control pictures as `pictureText` writes them.
 */
export function wordsMarkdown(sec: ExampleSection): string {
  const words = sec.lines.length ? sec.lines.map((w) => codeSpan(pictureText(w))).join(' ') : sec.empty!;
  return sec.words?.after ? `${words} ${sec.words.after}` : words;
}

/**
 * Examples as headings with one code block per section, so every line keeps its own row. Without `indent`, as blocks of
 * their own, each after a rule (`rule`); with it, inside a list item. An example's note is a quote, or a paragraph when
 * not `quote` (VS Code's hover gives a quote no bar, only the browser's margins). The control pictures of the lines (a code
 * block draws no marks) are written as `<LF>`; those of the note, as `pictureText` does or as `noteText` says. A section
 * of words is a line of code spans (`wordsMarkdown`), or as `wordsText` writes it.
 */
export function examplesMarkdown(examples: Example[], indent?: string, rule = true, quote = true, noteText: (note: string) => string = pictureText, wordsText: (sec: ExampleSection) => string = wordsMarkdown): string[] {
  const out: string[] = [];
  for (const e of examples) {
    if (indent === undefined) out.push('', ...(rule ? ['---', ''] : []), `#### ${e.title}`);
    else out.push(`${indent}##### ${e.title}`);
    if (e.note) out.push(...(indent === undefined ? ['', `${quote ? '> ' : ''}${noteText(e.note)}`] : [`${indent}> ${noteText(e.note)}`]));
    for (const sec of e.sections) {
      if (sec.words) {
        out.push(...(indent === undefined ? ['', `**${sec.label}**`, '', wordsText(sec)] : [`${indent}**${sec.label}**\\`, `${indent}${wordsText(sec)}`]));
        continue;
      }
      const lines = (sec.lines.length ? sec.lines : [sec.empty ?? '']).map(pictureText);
      // The fence must be longer than any run of backticks inside.
      const longest = Math.max(2, ...lines.map((l) => Math.max(0, ...(l.match(/`+/g) ?? []).map((m) => m.length))));
      const fence = '`'.repeat(longest + 1);
      if (indent === undefined) out.push('', `**${sec.label}**`, '', `${fence}text`, ...lines, fence);
      // A heading and a fence may each interrupt a paragraph, so the label needs no blank line around it.
      else out.push(`${indent}**${sec.label}**`, `${indent}${fence}text`, ...lines.map((l) => indent + l), `${indent}${fence}`);
    }
  }
  return out;
}

/** A label as Markdown: code parts as code spans, placeholders in italics (`if` *condition* `then`). */
export function labelMarkdown(parts: readonly LabelPart[]): string {
  return joinParts(parts, (p) => (p.placeholder ? `*${p.text}*` : codeSpan(p.text.replace(/\s*\n\s*/g, ' ⏎ '))));
}

/**
 * Notes of a line as plain Markdown quotes, warnings first: each keeps its mark, and its word in bold
 * (`> ⚠ **Pitfall:** …`), with the sections of the manual it cites.
 */
export function plainNotes(ex: LineExplanation, notes: readonly string[], lang: Lang): string[] {
  return notesByLevel(ex, notes).flatMap(({ text, level, label, body }) => {
    const refs = noteRefs(ex, text);
    return [`> ${pictureText(label ? `${MARKS[level]} **${label}** ${body}` : text)}${refs?.length ? ` (${refsMarkdown(lang, refs)})` : ''}`, ''];
  });
}

/** The explanation as plain Markdown (no HTML), for pasting into reviews and docs. */
export function toPlainMarkdown(ex: LineExplanation, lineText: string, where: string, lang: Lang = 'en'): string {
  const out: string[] = [`**${where}**`, '', '```bash', lineText.trim(), '```', ''];
  const links = (refs: readonly string[] | undefined) => (refs?.length ? ` (${refsMarkdown(lang, refs)})` : '');
  out.push(...plainNotes(ex, ex.notes, lang));
  const walk = (tok: Token, depth: number) => {
    out.push(`${'  '.repeat(depth)}- ${labelMarkdown(labelParts(tok))} — ${explained(tok)}${links(tok.refs)}${valueMarkdown(tok.value, '  '.repeat(depth + 1))}`);
    for (const c of tok.children) walk(c, depth + 1);
  };
  for (const item of ex.items) walk(item, 0);
  out.push(...examplesMarkdown(ex.examples));
  return out.join('\n').trim() + '\n';
}

/**
 * The tree without levels below `maxDepth` (1: only the top level; 0: everything). Examples of
 * a removed token move to the deepest token still shown, since they are placed by source range.
 */
export function pruneDepth(items: Token[], maxDepth: number): Token[] {
  if (!maxDepth || maxDepth < 1) return items;
  const cut = (t: Token, depth: number): Token => ({ ...t, children: depth + 1 >= maxDepth ? [] : t.children.map((c) => cut(c, depth + 1)) });
  return items.map((t) => cut(t, 0));
}
