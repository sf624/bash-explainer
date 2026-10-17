import { Text, tx } from '../i18n';

/**
 * Aliases and functions that distributions set up for interactive shells. They are not commands:
 * other systems lack them, and scripts never see them (the files that define them are read by
 * interactive shells only, and bash expands no aliases in scripts).
 *
 * Taken from the files the distributions ship (only names that are not commands themselves; aliases
 * that add options to a command, such as `ls --color=auto` or root's `rm -i`, are left out):
 * - Ubuntu: `/etc/skel/.bashrc` of the bash package (Debian's has these lines commented out)
 * - Fedora / RHEL: `/etc/profile.d/colorls.sh` of coreutils
 * - openSUSE: `/etc/profile.d/alias.bash` and `ls.bash` of aaa_base
 * - Git for Windows: `/etc/profile.d/aliases.sh` of git-extra
 */
export interface DistroAlias {
  kind: 'alias' | 'function';
  /** The command it runs, whose options and arguments it takes. */
  command?: string;
  /** What to write instead, anywhere; undefined when it differs too much between systems. */
  portable?: string;
  /** What it stands for, by system. */
  definitions: [string, string][];
  meaning: Text;
}

const UBUNTU = 'Ubuntu';
const FEDORA = 'Fedora / RHEL';
const SUSE = 'openSUSE';
const GIT = 'Git for Windows';

export const distroAliases: Record<string, DistroAlias> = {
  ll: {
    kind: 'alias', command: 'ls', portable: 'ls -l',
    definitions: [[UBUNTU, 'ls -alF'], [FEDORA, 'ls -l --color=auto'], [SUSE, 'ls -l'], [GIT, 'ls -l']],
    meaning: tx('ファイルを詳細形式（`-l`）で一覧表示する', 'list files in long format (`-l`)'),
  },
  la: {
    kind: 'alias', command: 'ls', portable: 'ls -A',
    definitions: [[UBUNTU, 'ls -A'], [SUSE, 'ls -la']],
    meaning: tx('`.` で始まるファイルも含めて一覧表示する', 'list files including those starting with `.`'),
  },
  l: {
    kind: 'alias', command: 'ls',
    definitions: [[UBUNTU, 'ls -CF'], [SUSE, 'ls -alF']],
    meaning: tx('ファイルを一覧表示する（中身は環境で大きく違う）', 'list files (what it does differs a lot between systems)'),
  },
  'l.': {
    kind: 'alias', command: 'ls', portable: 'ls -d .*',
    definitions: [[FEDORA, 'ls -d .* --color=auto']],
    meaning: tx('`.` で始まるファイルだけを一覧表示する', 'list only the files starting with `.`'),
  },
  'ls-l': {
    kind: 'alias', command: 'ls', portable: 'ls -l',
    definitions: [[SUSE, 'ls -l']],
    meaning: tx('ファイルを詳細形式（`-l`）で一覧表示する', 'list files in long format (`-l`)'),
  },
  alert: {
    kind: 'alias', portable: 'notify-send "done"',
    definitions: [[UBUNTU, 'notify-send --urgency=low -i "$([ $? = 0 ] && echo terminal || echo error)" "$(history|tail -n1|sed …)"']],
    meaning: tx('直前のコマンドが終わったことをデスクトップ通知で知らせる（`sleep 10; alert` のように長いコマンドの後ろに付ける。失敗したときはエラーのアイコン）', 'show a desktop notification that the previous command finished (put it after a long command, as in `sleep 10; alert`; an error icon when it failed)'),
  },
  o: {
    kind: 'alias', command: 'less', portable: 'less',
    definitions: [[SUSE, 'less']],
    meaning: tx('ファイルを1画面ずつ表示する（`less`）', 'page through files (`less`)'),
  },
  '..': {
    kind: 'alias', portable: 'cd ..',
    definitions: [[SUSE, 'cd ..']],
    meaning: tx('1つ上のディレクトリに移動する', 'go up one directory'),
  },
  '...': {
    kind: 'alias', portable: 'cd ../..',
    definitions: [[SUSE, 'cd ../..']],
    meaning: tx('2つ上のディレクトリに移動する', 'go up two directories'),
  },
  'cd..': {
    kind: 'alias', portable: 'cd ..',
    definitions: [[SUSE, 'cd ..']],
    meaning: tx('1つ上のディレクトリに移動する（`cd ..` の打ち間違いを救う）', 'go up one directory (for `cd ..` typed without the space)'),
  },
  '+': {
    kind: 'alias', portable: 'pushd .',
    definitions: [[SUSE, 'pushd .']],
    meaning: tx('今のディレクトリをディレクトリスタックに積む（`-` で戻る）', 'push the current directory onto the directory stack (`-` comes back)'),
  },
  '-': {
    kind: 'alias', portable: 'popd',
    definitions: [[SUSE, 'popd']],
    meaning: tx('ディレクトリスタックから取り出したディレクトリに戻る（`+` で積んだ場所）', 'go back to the directory popped from the directory stack (where `+` pushed)'),
  },
  md: {
    kind: 'alias', command: 'mkdir', portable: 'mkdir -p',
    definitions: [[SUSE, 'mkdir -p']],
    meaning: tx('ディレクトリを作る（途中のディレクトリもまとめて。すでにあってもエラーにしない）', 'make directories (with their parents; no error if they exist)'),
  },
  rd: {
    kind: 'alias', command: 'rmdir', portable: 'rmdir',
    definitions: [[SUSE, 'rmdir']],
    meaning: tx('空のディレクトリを削除する', 'remove empty directories'),
  },
  rehash: {
    kind: 'alias', portable: 'hash -r',
    definitions: [[SUSE, 'hash -r']],
    meaning: tx('覚えているコマンドの場所を忘れさせる（PATH に新しく入れたコマンドを探し直させる）', 'forget the remembered command locations (so newly installed commands are looked up again)'),
  },
  beep: {
    kind: 'alias', portable: "printf '\\a'",
    definitions: [[SUSE, 'echo -en "\\007"']],
    meaning: tx('端末のベルを鳴らす', 'ring the terminal bell'),
  },
  unmount: {
    kind: 'alias', portable: 'umount',
    definitions: [[SUSE, 'echo "Error: Try the command: umount" 1>&2; false']],
    meaning: tx('何もせず「`umount` を使え」と表示して失敗する（`umount` の打ち間違い用。アンマウントのコマンドは `umount`）', 'does nothing but print "Try the command: umount" and fail (for the misspelling; the command to unmount is `umount`)'),
  },
  remount: {
    kind: 'function', portable: 'mount -o remount,…',
    definitions: [[SUSE, 'mount -o remount,…']],
    meaning: tx('マウント済みのファイルシステムを、引数のオプションでマウントし直す（`remount ro /` で読み取り専用に）', 'remount a mounted file system with the given options (`remount ro /` makes it read-only)'),
  },
  xd: {
    kind: 'function', portable: 'cd "$(dirname "$(readlink -f FILE)")"',
    definitions: [[SUSE, 'cd "$(dirname "$(readlink -f "$1")")"']],
    meaning: tx('引数のファイルがあるディレクトリに移動する（シンボリックリンクはたどる）', 'go to the directory the given file is in (following symbolic links)'),
  },
};
