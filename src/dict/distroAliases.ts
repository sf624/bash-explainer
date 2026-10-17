import { Text, tx } from '../i18n';

/**
 * Aliases that distributions set up for interactive shells, with what they stand for and where.
 * They are not commands: other systems lack them, and scripts never see them (bash expands no
 * aliases in scripts, and these come from files only interactive shells read).
 */
export interface DistroAlias {
  /** The command the alias runs, for its arguments. */
  command: string;
  /** What to write instead, anywhere. */
  portable: string;
  /** What it stands for, by system. */
  definitions: [string, string][];
  meaning: Text;
}

export const distroAliases: Record<string, DistroAlias> = {
  ll: {
    command: 'ls',
    portable: 'ls -l',
    definitions: [['Ubuntu', 'ls -alF'], ['Fedora / RHEL', 'ls -l --color=auto'], ['Git for Windows', 'ls -l']],
    meaning: tx('ファイルを詳細形式（`-l`）で一覧表示する', 'list files in long format (`-l`)'),
  },
  la: {
    command: 'ls',
    portable: 'ls -A',
    definitions: [['Ubuntu', 'ls -A']],
    meaning: tx('`.` で始まるファイルも含めて一覧表示する（`.` と `..` は除く）', 'list files including those starting with `.` (but not `.` and `..`)'),
  },
  l: {
    command: 'ls',
    portable: 'ls -CF',
    definitions: [['Ubuntu', 'ls -CF']],
    meaning: tx('ファイルを複数列で一覧表示し、種類を表す記号（`/` や `*`）を付ける', 'list files in columns, marking their kind (`/`, `*`)'),
  },
  'l.': {
    command: 'ls',
    portable: 'ls -d .*',
    definitions: [['Fedora / RHEL', 'ls -d .* --color=auto']],
    meaning: tx('`.` で始まるファイルだけを一覧表示する', 'list only the files starting with `.`'),
  },
};
