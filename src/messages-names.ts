import type { Lang, Text } from './i18n';
import { SOURCED_NAME, unreadClause } from './messages-common';
import { noShellLines } from './messages-shell';
import type { NameFacts, NameKind } from './semantics/names';

// What the outputs say of a command name (3.7.2; src/semantics/names.ts `nameFacts`): the badge, its tooltip, and the
// other meanings of the name. Re-exported by src/messages.ts.

/** The words of the kinds of a command name: the badge (`word`), what the kind is (`title`), and how a line on the other meanings names it (`other`). */
const NAME_KINDS: Record<NameKind, { word: Text; title: Text; other: Text }> = {
  keyword: {
    word: { ja: '予約語', en: 'keyword' }, other: { ja: '予約語', en: 'a reserved word' },
    title: { ja: 'bash の構文の単語（予約語）。コマンドとして探されない', en: 'bash syntax (a reserved word): not looked up as a command' },
  },
  alias: {
    word: { ja: 'エイリアス', en: 'alias' }, other: { ja: 'エイリアス', en: 'an alias' },
    title: { ja: 'エイリアス: bash が行を読むときに、その中身に置き換える', en: 'an alias: bash replaces it with its text when it reads the line' },
  },
  function: {
    word: { ja: '関数', en: 'function' }, other: { ja: 'このスクリプトの関数', en: 'the function of this script' },
    title: { ja: 'シェルの関数（スクリプトのもの、または bats の run のようにホストが用意したもの）: 今のシェルで動く', en: 'a shell function (the script\'s own, or one its host defines, such as bats\' run): it runs in this shell' },
  },
  builtin: {
    word: { ja: 'ビルトイン', en: 'builtin' }, other: { ja: 'bash のビルトイン', en: 'bash\'s builtin' },
    title: { ja: 'bash に組み込まれたコマンド: 新しいプロセスなしで、今のシェルで動く', en: 'a command built into bash: it runs in this shell, with no new process' },
  },
  program: {
    word: { ja: 'プログラム', en: 'program' }, other: { ja: 'プログラム', en: 'a program' },
    title: { ja: 'プログラム: PATH から（パスならそのパスで）見つけたファイルを、別のプロセスとして動かす', en: 'a program: a file found in PATH (or at the path given), run as another process' },
  },
  none: {
    word: { ja: '実行されない', en: 'nothing runs' }, other: { ja: '何もない', en: 'nothing' },
    title: { ja: '何も実行されない（コマンドが見つからない）', en: 'nothing runs (no command is found)' },
  },
};

/** The badge's tooltip on a POSIX special builtin (4.4; checked with bash 5.2 in test/name-kinds.test.ts). */
const SPECIAL_TITLE: Text = {
  ja: 'POSIX の特殊ビルトイン: bash に組み込まれたコマンドで、新しいプロセスなしで今のシェルで動く。POSIX モードでは、関数より先に見つかり、エラーになると非対話シェルが終了し、前に書いた代入がコマンドの後も残る',
  en: 'a POSIX special builtin: a command built into bash, which runs in this shell with no new process. In POSIX mode, it is found before functions, an error in it exits a non-interactive shell, and the assignments before it stay after it',
};

/** The badge of a POSIX special builtin (4.4): its own word, in place of the builtin's. */
const SPECIAL_WORD: Text = { ja: '特殊ビルトイン', en: 'special builtin' };

/** The word of a kind of command name, as the badge says it ("builtin", "ビルトイン"). */
export const nameKindWord =(lang: Lang, kind: NameKind): string => NAME_KINDS[kind].word[lang];

/** What the panel and the other outputs say of a command name, in one language (`nameSaid`). */
export interface NameSaid {
  /** The badge: the kind's word. */
  kind: string;
  /** What the kind is: the badge's tooltip. */
  title: string;
  /** "run by `sudo`": the command that looks the name up; where nothing runs, why ("`builtin` finds no builtin named `ls`"). */
  by?: string;
  /** The line on what else the same name is, and how to reach it (only on a name with another meaning). */
  also?: string;
  /** The kind (and who runs it) for an output with no badge: " (builtin)", "（プログラム。`sudo` が実行）". */
  short: string;
}

/** The texts of the facts of a command name, in `lang`. */
export function nameSaid(lang: Lang, f: NameFacts): NameSaid {
  const k = NAME_KINDS[f.runs];
  const ja = lang === 'ja';
  const codes = (cs: string[]): string => {
    const q = cs.map((c) => `\`${c}\``);
    return ja ? q.join('・') : q.length > 1 ? `${q.slice(0, -1).join(', ')} or ${q[q.length - 1]}` : q[0];
  };
  // (A program that looks the name up runs the program even where bash has a builtin of that name: `sudo echo`.)
  const program = f.by !== undefined && f.runs === 'program' && f.also.some((o) => o.kind === 'builtin' && !o.off);
  const lines: string[] = f.noShell ? noShellLines(lang, f)
    : f.noProgram
    ? [f.by !== undefined
      ? (ja ? `\`${f.by}\` が名前を探すので、bash のビルトインは動かない。この名前のプログラムはふつうない` : `\`${f.by}\` looks the name up, so bash's builtin does not run, and there is usually no program of this name`)
      : (ja ? 'この名前のプログラムはふつうない' : 'There is usually no program of this name')]
    : program ? [ja ? `\`${f.by}\` が名前を探すので、これはプログラムで、bash のビルトインではない` : `\`${f.by}\` looks the name up, so this is the program, not bash's builtin`] : [];
  const others = f.also.filter((o) => !((program || (f.noProgram && f.by !== undefined)) && o.kind === 'builtin')).map((o) => {
    const detail = o.kind === 'keyword' ? (ja ? 'クォートせずにコマンドの先頭に書いたとき' : 'where it starts a command unquoted')
      : o.off ? (ja ? `\`enable -n\` で無効。\`enable ${f.name}\` で有効に戻る` : `turned off by \`enable -n\` (\`enable ${f.name}\` turns it on again)`)
        : o.unexpanded ? (ja ? `スクリプトの中では展開されない。\`shopt -s expand_aliases\` が要る${unreadClause(o.unexpanded === 'maybe', ['それを有効にして', 'turns it on'])[0]}` : `not expanded in a script (needs \`shopt -s expand_aliases\`${unreadClause(o.unexpanded === 'maybe', ['それを有効にして', 'turns it on'])[1]})`)
          : o.path ? (ja ? `ふつうは \`${o.path}\`` : `usually \`${o.path}\``) : '';
    const reach = o.reach.length ? (ja ? `${codes(o.reach)} で動く` : `run with ${codes(o.reach)}`) : '';
    const name = o.kind === 'program' && !o.path ? (ja ? 'PATH の中のプログラム' : 'a program in PATH') : NAME_KINDS[o.kind].other[lang];
    if (ja) return [detail, reach].some(Boolean) ? `${name}（${[detail, reach].filter(Boolean).join('。')}）` : name;
    return `${name}${detail ? `, ${detail}` : ''}${reach ? ` (${reach})` : ''}`;
  });
  if (others.length) lines.push(ja ? `同じ名前で、ほかに: ${others.join('・')}` : `Same name, also: ${others.join('; ')}`);
  const by = f.runs === 'none' ? (f.why === 'not-found' && f.noShell
    ? (ja ? `\`${f.name}\` という名前のプログラムはない（\`${f.name}\` はシェルの予約語で、この単語を読むシェルはない）`
      : `no program is named \`${f.name}\` (\`${f.name}\` is a reserved word of the shell, and no shell reads these words)`)
    : f.why === 'not-found'
    ? (ja ? `${f.by ? `\`${f.by}\`` : 'bash'} が探しても \`${f.name}\` という名前のコマンドはない（bash は \`${f.name}: command not found\` と表示する）`
      : `${f.by ? `\`${f.by}\`` : 'bash'} finds no command named \`${f.name}\` (bash says \`${f.name}: command not found\`)`)
    : (ja ? `\`${f.by ?? 'builtin'}\` が探しても \`${f.name}\` という名前のビルトインはない` : `\`${f.by ?? 'builtin'}\` finds no builtin named \`${f.name}\``))
    : f.by === undefined ? undefined : ja ? `\`${f.by}\` が実行` : `run by \`${f.by}\``;
  // (A special builtin, as the manual names it (4.4), differs from the others in POSIX mode only.)
  const title = f.special ? SPECIAL_TITLE[lang] : f.sourced ? SOURCED_NAME.title[lang] : k.title[lang];
  const word = f.special ? SPECIAL_WORD[lang] : f.sourced ? SOURCED_NAME.word[lang] : k.word[lang];
  return {
    kind: word, title, ...(by ? { by } : {}), ...(lines.length ? { also: lines.join(ja ? '。' : '. ') } : {}),
    short: ja ? `（${word}${by ? `。${by}` : ''}）` : ` (${word}${by ? `, ${by}` : ''})`,
  };
}
