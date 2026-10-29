import type { CommandSpec, SubcommandSpec } from '../argv/spec';
import { tx } from '../i18n';
import { args, byCount, cmd, GNU_INFO, operand, OptSpec, persistent, pos } from './types';

// Commands chosen from a survey of shell scripts, Dockerfiles and CI workflows in popular
// repositories (installers, official Docker images, CI images): the ones most often met that the
// dictionary did not know. Package managers, users and groups, system information, signatures and
// checksums, compression, and the language toolchains that scripts call.

const files = pos('対象のファイル', 'target file');
const pkg = pos('パッケージ名（`名前=バージョン` で版を指定）', 'package name (`name=version` pins a version)');

// ---- Package managers ---------------------------------------------------------------------------

/** Options apt-get and apt accept before or after the subcommand. */
const aptCommon: OptSpec[] = [
  ['-y|--yes|--assume-yes', '確認せずに「はい」と答える（スクリプトや Dockerfile で必須）', 'answer yes to prompts (needed in scripts and Dockerfiles)'],
  ['-q|--quiet', '進捗の表示を減らす（`-qq` でさらに減らす）', 'less progress output (`-qq`: even less)'],
  ['--no-install-recommends', '推奨パッケージを入れない（イメージを小さく保つ定番）', 'do not install recommended packages (keeps images small)'],
  ['-o|--option', 'APT の設定を1つ上書きする（`-o APT::…=値`）', 'set one APT configuration option (`-o APT::…=value`)', 'arg'],
  ['--auto-remove|--autoremove', '不要になった依存パッケージも一緒に削除する', 'also remove dependencies no longer needed'],
  ['--purge', '設定ファイルも含めて削除する', 'remove configuration files too'],
  ['-f|--fix-broken', '壊れた依存関係を直そうとする', 'try to fix broken dependencies'],
  ['-s|--simulate|--dry-run', '実際には何もせず、行うことを表示する', 'show what would be done, without doing it'],
  ['-d|--download-only', 'ダウンロードだけして入れない', 'download only, do not install'],
  ['--reinstall', '入っているパッケージも入れ直す', 'reinstall packages already installed'],
  ['--fix-missing|-m', '取得できないパッケージがあっても続ける', 'go on when some packages cannot be downloaded'],
];

// Subcommands that take one unit or package name.
const unit = pos('ユニット名（`nginx.service`…）', 'unit name (`nginx.service`…)');
const plainPkg = pos('パッケージ名', 'package name');
const unitSub = (ja: string, en: string): CommandSpec => cmd(ja, en, [], { positional: [unit] });
const pkgSub = (ja: string, en: string): CommandSpec => cmd(ja, en, [], { positional: [plainPkg] });

const dnfLike = (): Record<string, CommandSpec> => ({
  info: pkgSub('パッケージの詳細を表示する', 'Show package details'),
  search: pkgSub('名前や説明からパッケージを検索する', 'Search packages by name or description'),
  list: cmd('パッケージを一覧表示する（`installed`、`available`、`updates`）', 'List packages (`installed`, `available`, `updates`)'),
  provides: cmd('指定のファイルを提供するパッケージを探す', 'Find the package that provides a file'),
  whatprovides: cmd('指定のファイルを提供するパッケージを探す', 'Find the package that provides a file'),
  groupinstall: cmd('パッケージグループを入れる', 'Install a package group'),
  group: cmd('パッケージグループを扱う（`list`、`install`、`info`）', 'Handle package groups (`list`, `install`, `info`)'),
  history: cmd('操作の履歴を表示する（`undo`、`rollback` も）', 'Show the transaction history (also `undo`, `rollback`)'),
  repolist: cmd('有効なリポジトリを一覧表示する', 'List the enabled repositories'),
  'check-update': cmd('更新できるパッケージを確認する', 'Check for available updates'),
  reinstall: pkgSub('パッケージを入れ直す', 'Reinstall packages'),
  downgrade: pkgSub('パッケージの版を下げる', 'Downgrade packages'),
  autoremove: cmd('不要になった依存パッケージを削除する', 'Remove unneeded dependencies'),
  erase: pkgSub('パッケージを削除する', 'Remove packages'),
  'distro-sync': cmd('リポジトリの版にそろえる', 'Sync installed packages to the repository versions'),
});


const aptSubs = (extra: Record<string, CommandSpec> = {}, before: Record<string, CommandSpec> = {}): Record<string, CommandSpec> => ({
  ...before,
  update: cmd('リポジトリからパッケージの一覧を取り直す（install の前に必要）', 'Refresh the package lists from the repositories (needed before install)', aptCommon),
  upgrade: cmd('入っているパッケージを新しい版に更新する', 'Upgrade installed packages', aptCommon),
  'dist-upgrade': cmd('依存関係の変化も含めてすべて更新する（パッケージの追加・削除もあり）', 'Upgrade everything, adding or removing packages as dependencies change', aptCommon),
  install: cmd('パッケージをインストールする', 'Install packages', aptCommon, { positional: [pkg] }),
  remove: cmd('パッケージを削除する（設定ファイルは残る）', 'Remove packages (configuration files stay)', aptCommon, { positional: [pkg] }),
  purge: cmd('パッケージを設定ファイルごと削除する', 'Remove packages with their configuration files', aptCommon, { positional: [pkg] }),
  autoremove: cmd('依存先として入り、もう不要になったパッケージを削除する', 'Remove packages installed as dependencies and no longer needed', aptCommon),
  clean: cmd('ダウンロード済みのパッケージファイルを削除する（`/var/cache/apt/archives`）', 'Delete downloaded package files (`/var/cache/apt/archives`)', aptCommon),
  autoclean: cmd('もう入手できない古いパッケージファイルだけ削除する', 'Delete only package files that can no longer be downloaded', aptCommon),
  download: cmd('パッケージの .deb をカレントディレクトリにダウンロードする', "Download packages' .deb files into the current directory", aptCommon, { positional: [pkg] }),
  ...extra,
});

const apkCommon: OptSpec[] = [
  ['--no-cache', 'インデックスを取得して使い、キャッシュを残さない（`apk update` と後片付けが不要）', 'fetch the index, use it and keep no cache (no `apk update` or cleanup needed)'],
  ['-U|--update-cache', '先にパッケージの一覧を取り直す', 'refresh the package index first'],
  ['-t|--virtual', 'まとめて入れたパッケージに仮の名前を付ける（あとで `apk del 名前` で一括削除）', 'group the packages under a virtual name (remove them all later with `apk del name`)', 'arg'],
  ['--no-network', 'ネットワークを使わない', 'do not use the network'],
  ['-q|--quiet', '表示を減らす', 'less output'],
  ['-v|--verbose', '詳しく表示する', 'more output'],
  ['--print-arch', 'このシステムのアーキテクチャ（`x86_64`、`aarch64`…）を表示する', "print the system's architecture (`x86_64`, `aarch64`…)"],
  ['-X|--repository', '使うリポジトリを追加する', 'use the given repository too', 'arg'],
];

const rpmCommon: OptSpec[] = [
  ['-y|--assumeyes', '確認せずに「はい」と答える', 'answer yes to prompts'],
  ['-q|--quiet', '表示を減らす', 'less output'],
  ['--nodocs', 'ドキュメントを入れない（イメージを小さく保つ）', 'do not install documentation (keeps images small)'],
  ['--setopt', '設定を1つ上書きする（`--setopt=名前=値`）', 'set one configuration option (`--setopt=name=value`)', 'arg'],
  ['--enablerepo', '指定したリポジトリを有効にする', 'enable the given repository', 'arg'],
  ['--disablerepo', '指定したリポジトリを無効にする', 'disable the given repository', 'arg'],
  ['--allowerasing', '依存の衝突を解くためにパッケージの削除も許す', 'allow removing packages to resolve conflicts'],
];

const rpmSubs = (extra: Record<string, CommandSpec> = {}): Record<string, CommandSpec> => ({
  ...extra,
  install: cmd('パッケージをインストールする', 'Install packages', rpmCommon, { positional: [pkg] }),
  remove: cmd('パッケージを削除する', 'Remove packages', rpmCommon, { positional: [pkg] }),
  update: cmd('パッケージを更新する', 'Update packages', rpmCommon),
  upgrade: cmd('パッケージを更新する', 'Upgrade packages', rpmCommon),
  clean: cmd('キャッシュを削除する（`clean all` ですべて）', 'Delete cached data (`clean all`: everything)', rpmCommon),
  makecache: cmd('リポジトリのメタデータを取得してキャッシュする', 'Download and cache repository metadata', rpmCommon),
});

const pipInstall: OptSpec[] = [
  ['-r|--requirement', '指定したファイル（`requirements.txt`）に並んだパッケージを入れる', 'install the packages listed in the given file (`requirements.txt`)', 'arg'],
  ['-U|--upgrade', '入っていても最新版に更新する', 'upgrade if already installed'],
  ['--no-cache-dir', 'ダウンロードをキャッシュしない（イメージを小さく保つ）', 'do not cache downloads (keeps images small)'],
  ['--user', 'ユーザーのホームに入れる（管理者権限が不要）', "install into the user's home (no admin rights needed)"],
  ['-e|--editable', 'ソースのディレクトリを編集可能なまま入れる（開発用）', 'install a source directory in editable mode (for development)', 'arg'],
  ['-q|--quiet', '表示を減らす', 'less output'],
  ['--break-system-packages', 'OS が管理する Python にも入れる（PEP 668 の保護を外す。注意）', 'install into the OS-managed Python (overrides PEP 668; careful)'],
  ['-c|--constraint', '版の上限・下限を指定したファイルで制約する', 'constrain versions with the given file', 'arg'],
  ['--index-url|-i', 'パッケージの取得元を PyPI 以外にする', 'download packages from the given index instead of PyPI', 'arg'],
];

const pipName = pos('パッケージ名', 'package name');

const pip = cmd('Python のパッケージマネージャ', 'Python package manager', [['-q|--quiet', '表示を減らす', 'less output'], ['--version|-V', '版を表示する', 'show the version']], {
  subcommands: {
    install: cmd('パッケージをインストールする', 'Install packages', pipInstall, { positional: [pos('パッケージ（`名前==版` で版を指定）', 'package (`name==version` pins a version)')] }),
    uninstall: cmd('パッケージを削除する', 'Uninstall packages', [['-y|--yes', '確認しない', 'do not ask for confirmation']], { positional: [pipName] }),
    list: cmd('入っているパッケージを一覧表示する', 'List installed packages', [['--outdated|-o', '更新があるものだけ', 'only outdated ones']]),
    freeze: cmd('入っているパッケージを requirements 形式で出力する', 'Print installed packages in requirements format'),
    show: cmd('パッケージの情報を表示する', 'Show package information', [], { positional: [pipName] }),
  },
});

// ---- Checksums, signatures and compression -------------------------------------------------------

const checksum = (bits: string): CommandSpec => cmd(`${bits} のハッシュ値（チェックサム）を計算する`, `Compute ${bits} checksums`, [
  ['-c|--check', 'ハッシュ値の一覧ファイルと照合する（ダウンロードの検証）', 'verify against a checksum list (checking downloads)'],
  ['-b|--binary', 'バイナリモードで読む', 'read in binary mode'],
  ['--status', '何も表示せず、結果を終了ステータスで返す', 'print nothing; report via the exit status'],
  ['--tag', 'BSD 形式のチェックサムを出す', 'create a BSD-style checksum'],
  ['-t|--text', 'テキストモードで読む（既定）', 'read in text mode (the default)'],
  ['-z|--zero', '各行を改行でなく NUL で終える', 'end each output line with NUL, not a newline'],
  ['--ignore-missing', '存在しないファイルを失敗にも報告にもしない', 'do not fail or report status for missing files'],
  ['--quiet', '検証に成功したものは表示しない', 'do not print OK lines'],
  ['--strict', '書式の正しくないチェックサムの行があれば 0 以外で終わる', 'exit non-zero for improperly formatted checksum lines'],
  ['-w|--warn', '書式の正しくないチェックサムの行を警告する', 'warn about improperly formatted checksum lines'],
  ...GNU_INFO,
], { parser: 'getopt_long', positional: [files] });

const compressor = (ja: string, en: string, ext: string, extra: OptSpec[] = []): CommandSpec => cmd(ja, en, [
  ['-d|--decompress', '展開する', 'decompress'],
  ['-c|--stdout', '結果を標準出力に書く（元のファイルはそのまま）', 'write to stdout (keep the input files)'],
  ['-k|--keep', '元のファイルを削除しない', 'keep the input files'],
  ['-f|--force', '既存のファイルを上書きする', 'overwrite existing files'],
  ['-q|--quiet', '表示を減らす', 'less output'],
  ['-v|--verbose', '詳しく表示する', 'more output'],
  ...extra,
], { positional: [pos(`対象のファイル（展開なら \`${ext}\`）`, `file (\`${ext}\` to decompress)`)] });

const GZIP_OPTIONS: OptSpec[] = [
  ['-a|--ascii', '行末を変換する（Unix では何もしない）', 'convert line ends (ignored on Unix)'],
  ['-c|--stdout|--to-stdout', '結果を標準出力に書く（`zcat` では常にそうする）', 'write to stdout (`zcat` always does)'],
  ['-d|--decompress|--uncompress', '展開する（`zcat` では常にそうする）', 'decompress (`zcat` always does)'],
  ['-k|--keep', '元のファイルを削除しない', 'keep the input files'],
  ['-L|--license', 'ライセンスを表示する', 'display the software license'],
  ['-n|--no-name', '元の名前と日時を保存・復元しない', 'do not save or restore the original name and timestamp'],
  ['-N|--name', '元の名前と日時を保存・復元する', 'save or restore the original name and timestamp'],
  ['--silent', '警告を出さない（`--quiet` と同じ）', 'suppress all warnings (same as `--quiet`)'],
  ['-1|--fast', '速く圧縮する', 'compress faster'],
  ['-9|--best', 'よく圧縮する', 'compress better'],
  ['--rsyncable', 'rsync で扱いやすいアーカイブにする', 'make an rsync-friendly archive'],
  ['-b|--bits', 'LZW の最大ビット数（圧縮用）', 'maximum number of bits for LZW (compression only)', 'arg'],
  ['-Z|--lzw', 'LZW 形式（compress 互換）で圧縮する', 'compress in the LZW (compress) format'],
  ['-f|--force', '強制的に処理する', 'force'],
  ['-l|--list', '圧縮ファイルの内容を一覧する', 'list the contents of compressed files'],
  ['-q|--quiet', '警告を出さない', 'suppress all warnings'],
  ['-r|--recursive', 'ディレクトリを再帰的に処理する', 'operate recursively on directories'],
  ['-S|--suffix', '圧縮ファイルの拡張子', 'suffix of compressed files', 'arg'],
  ['--synchronous', '同期的に書き出す（安全だが遅い）', 'synchronous output (safer on a crash, but slower)'],
  ['-t|--test', '圧縮ファイルが壊れていないか調べる', 'test the integrity of compressed files'],
  ['-v|--verbose', '詳しく表示する', 'verbose mode'],
];

const decompressToStdout = (ja: string, en: string, gnu = false): CommandSpec => cmd(ja, en, gnu ? [...GZIP_OPTIONS, ...GNU_INFO] : [], { ...(gnu ? { parser: 'getopt_long' as const } : {}), positional: [files] });

/** `-R owner/name`, which gh's subcommands accept too. */
const ghRepo: OptSpec[] = [['-R|--repo', '対象のリポジトリ（`オーナー/名前`）', 'repository (`owner/name`)', 'arg']];

// ---- Users and groups -------------------------------------------------------------------------

const user = pos('ユーザー名', 'user name');
const group = pos('グループ名', 'group name');

// ---- The dictionary ---------------------------------------------------------------------------

// iproute2 reads an object, and a command of an object, by a prefix of its name: the first name in its own
// table that the word starts (`ip a s` is `ip address show`, `ip l s` is `ip link set`). The entries are in
// that order, with the commands written as aliases at the place of the name they share a meaning with.
const ipSub = (ja: string, en: string, subs?: Record<string, SubcommandSpec>): SubcommandSpec =>
  cmd(ja, en, [], subs ? { subcommandPrefixes: 'first', subcommands: subs } : {});
const ipCommand = (ja: string, en: string, aliases?: string[]): SubcommandSpec => ({ ...cmd(ja, en), ...(aliases ? { aliases } : {}) });
const ipShow = (what: string, whatJa: string): SubcommandSpec => ipCommand(`${whatJa}を表示する（省略可。\`dev 名前\` で絞る）`, `Show ${what} (the default; \`dev NAME\` filters)`, ['list', 'lst']);
const ipChange = (what: string, whatJa: string): Record<string, SubcommandSpec> => ({
  add: ipCommand(`${whatJa}を追加する`, `Add ${what}`),
  change: ipCommand(`${whatJa}を変更する`, `Change ${what}`, ['chg']),
  replace: ipCommand(`${whatJa}を追加するか、あれば置き換える`, `Add ${what}, or replace it`),
});
const ipDelete = (what: string, whatJa: string): SubcommandSpec => ipCommand(`${whatJa}を削除する`, `Delete ${what}`);
const ipFlush = (what: string, whatJa: string): SubcommandSpec => ipCommand(`条件に合う${whatJa}をまとめて削除する`, `Remove every ${what} that matches`);

const IP_OBJECTS: Record<string, SubcommandSpec> = {
  address: ipSub('IP アドレスを表示・設定する', 'Show or set IP addresses', {
    ...ipChange('an address', 'アドレス'), delete: ipDelete('an address', 'アドレス'), show: ipShow('addresses', 'アドレス'), flush: ipFlush('address', 'アドレス'),
  }),
  addrlabel: ipSub('アドレスの選び方に使うラベルを扱う', 'Handle the labels used to choose addresses'),
  maddress: ipSub('マルチキャストアドレスを扱う', 'Handle multicast addresses'),
  route: ipSub('ルーティングテーブルを表示・設定する', 'Show or set routes', {
    ...ipChange('a route', '経路'), delete: ipDelete('a route', '経路'), show: ipShow('routes', '経路'),
    get: ipCommand('宛先に使われる経路を1つ表示する', 'Show the route used to reach a destination'), flush: ipFlush('route', '経路'),
  }),
  rule: ipSub('ルーティングポリシーのルールを扱う', 'Handle routing policy rules'),
  neighbor: { ...ipSub('ARP / 近隣のテーブルを表示・設定する', 'Show or set the neighbour (ARP) table', {
    ...ipChange('a neighbour entry', '近隣エントリ'), delete: ipDelete('a neighbour entry', '近隣エントリ'),
    get: ipCommand('近隣エントリを1つ調べる', 'Look up one neighbour entry'), show: ipShow('neighbour entries', '近隣エントリ'), flush: ipFlush('neighbour entry', '近隣エントリ'),
  }), aliases: ['neighbour'] },
  ntable: { ...ipSub('近隣テーブルの設定を扱う', 'Handle the settings of the neighbour tables'), aliases: ['ntbl'] },
  link: ipSub('ネットワークインターフェースを表示・設定する', 'Show or set network interfaces', {
    add: ipCommand('インターフェースを追加する', 'Add an interface'),
    set: ipCommand('インターフェースの状態を変える（`up`、`down`、`mtu`…）', 'Change an interface (`up`, `down`, `mtu`…)', ['change']),
    replace: ipCommand('インターフェースを追加するか、あれば置き換える', 'Add an interface, or replace it'),
    delete: ipDelete('an interface', 'インターフェース'), show: ipShow('interfaces', 'インターフェース'),
  }),
  l2tp: ipSub('L2TP のトンネルを扱う', 'Handle L2TP tunnels'),
  fou: ipSub('UDP で包むトンネル（FOU）の受け口を扱う', 'Handle receive ports of tunnels over UDP (FOU)'),
  ila: ipSub('ILA の変換を扱う', 'Handle ILA mappings'),
  macsec: ipSub('MACsec の設定を扱う', 'Handle MACsec settings'),
  tunnel: { ...ipSub('IP トンネルを扱う', 'Handle IP tunnels'), aliases: ['tunl'] },
  tuntap: { ...ipSub('TUN / TAP デバイスを扱う', 'Handle TUN and TAP devices'), aliases: ['tap'] },
  token: ipSub('IPv6 のトークン（インターフェース識別子）を扱う', 'Handle IPv6 tokens (interface identifiers)'),
  tcpmetrics: { ...ipSub('TCP の接続ごとの記録を扱う', 'Handle the metrics TCP keeps per peer'), aliases: ['tcp_metrics'] },
  monitor: ipSub('ネットワークの変化を見張る', 'Watch for network changes'),
  xfrm: ipSub('IPsec の設定を扱う', 'Handle IPsec policies and states'),
  mroute: ipSub('マルチキャストのルーティングを表示する', 'Show multicast routing'),
  mrule: ipSub('マルチキャストのルーティングのルールを扱う', 'Handle multicast routing rules'),
  netns: ipSub('ネットワーク名前空間を扱う（`add`、`exec`、`list`、`delete`）', 'Handle network namespaces (`add`, `exec`, `list`, `delete`)'),
  netconf: ipSub('インターフェースごとのネットワーク設定を表示する', 'Show the network settings of each interface'),
  vrf: ipSub('VRF（仮想ルーティング）を扱う', 'Handle VRFs (virtual routing)'),
  sr: ipSub('セグメントルーティング（IPv6）を扱う', 'Handle segment routing (IPv6)'),
  nexthop: ipSub('ネクストホップのオブジェクトを扱う', 'Handle next-hop objects'),
  mptcp: ipSub('MPTCP の設定を扱う', 'Handle MPTCP settings'),
  ioam: ipSub('IOAM（経路上の計測）の設定を扱う', 'Handle IOAM (in-situ measurement) settings'),
  help: ipSub('使い方を表示する', 'Show the usage'),
  stats: ipSub('インターフェースの統計を表示する', 'Show interface statistics'),
};

export const system: Record<string, CommandSpec> = {
  'apt-get': cmd('Debian / Ubuntu のパッケージ管理（APT）', 'Debian/Ubuntu package manager (APT)', aptCommon, {
    subcommands: aptSubs({}, {
      'build-dep': pkgSub('ソースからビルドするのに必要なパッケージを入れる', 'Install the packages needed to build a source package'),
      source: pkgSub('ソースパッケージを取得する', 'Fetch a source package'),
      check: cmd('壊れた依存関係がないか確かめる', 'Check for broken dependencies'),
      changelog: pkgSub('パッケージの変更履歴を表示する', 'Show the package changelog'),
    }),
  }),
  apt: cmd('Debian / Ubuntu のパッケージ管理（対話向けの APT。スクリプトでは `apt-get` が推奨）', 'Debian/Ubuntu package manager (interactive APT; scripts should use `apt-get`)', aptCommon, {
    subcommands: aptSubs({
      'full-upgrade': cmd('依存関係の変化も含めてすべて更新する', 'Upgrade everything, adding or removing packages as needed', aptCommon),
      list: cmd('パッケージを一覧表示する（`--installed`、`--upgradable`）', 'List packages (`--installed`, `--upgradable`)', [['--installed', '入っているものだけ', 'installed ones only'], ['--upgradable', '更新があるものだけ', 'upgradable ones only']]),
      search: cmd('パッケージを検索する', 'Search for packages', [], { positional: [pos('検索語', 'search term')] }),
      show: cmd('パッケージの情報を表示する', 'Show package information', [], { positional: [pkg] }),
    }, {
      'edit-sources': cmd('パッケージの取得元の設定を編集する', 'Edit the package sources list'),
      depends: pkgSub('依存しているパッケージを表示する', 'Show the dependencies'),
      rdepends: pkgSub('これに依存しているパッケージを表示する', 'Show reverse dependencies'),
      policy: pkgSub('入れられる版と優先度を表示する', 'Show available versions and priorities'),
      reinstall: pkgSub('パッケージを入れ直す', 'Reinstall packages'),
    }),
  }),
  'apt-mark': cmd('APT のパッケージに印を付ける（自動・手動・固定）', 'Mark APT packages (automatic, manual, held)', [], {
    subcommands: {
      auto: cmd('依存先として入ったものとして扱う（`autoremove` の対象になる）', 'Mark as installed automatically (`autoremove` may remove them)', [], { positional: [pkg] }),
      manual: cmd('手動で入れたものとして扱う（`autoremove` で消えない）', 'Mark as installed manually (`autoremove` keeps them)', [], { positional: [pkg] }),
      hold: cmd('版を固定して更新させない', 'Hold the version: do not upgrade', [], { positional: [pkg] }),
      unhold: cmd('版の固定を外す', 'Release a hold', [], { positional: [pkg] }),
      showmanual: cmd('手動で入れたパッケージを一覧表示する', 'List packages marked manual'),
      showauto: cmd('自動で入ったパッケージを一覧表示する', 'List packages marked automatic'),
      showhold: cmd('固定されたパッケージを一覧表示する', 'List held packages'),
    },
  }),
  dpkg: cmd('Debian のパッケージ（.deb）を直接操作する', 'Manage Debian packages (.deb) directly', [
    ['-i|--install', '.deb ファイルをインストールする', 'install a .deb file'],
    ['-r|--remove', 'パッケージを削除する', 'remove a package'],
    ['-P|--purge', '設定ファイルごと削除する', 'remove with configuration files'],
    ['-l|--list', 'パッケージを一覧表示する', 'list packages'],
    ['-L|--listfiles', 'パッケージが入れたファイルを一覧表示する', 'list the files a package installed'],
    ['-S|--search', '指定したファイルを入れたパッケージを探す', 'find the package that installed a file'],
    ['-s|--status', 'パッケージの状態を表示する', "show a package's status"],
    ['--print-architecture', 'このシステムのアーキテクチャ（`amd64`、`arm64`…）を表示する', "print the system's architecture (`amd64`, `arm64`…)"],
    ['--add-architecture', '別のアーキテクチャのパッケージも入れられるようにする', "allow another architecture's packages", 'arg'],
    ['--configure', '展開済みのパッケージを設定する（`-a` ですべて）', 'configure unpacked packages (`-a`: all)'],
    ['-c|--contents', '.deb に含まれるファイルを一覧表示', 'list the files inside a .deb'],
    ['-I|--info', '.deb の情報を表示', 'show information about a .deb'],
    ['-x|--extract', '.deb の中身を指定のディレクトリに展開する', 'extract the files of a .deb into a directory'],
    ['-X|--vextract', '.deb の中身を展開し、ファイル名を表示する', 'extract the files of a .deb and list them'],
    ['-b|--build', 'ディレクトリから .deb を作る', 'build a .deb from a directory'],
    ['--unpack', '展開だけして設定はしない', 'unpack the package without configuring it'],
    ['-C|--audit', '正しく入っていないパッケージを調べる', 'search for packages broken or half-installed'],
    ['-V|--verify', '入れたファイルが変更されていないか検証する', 'verify the installed files'],
    ['--get-selections', 'パッケージの選択状態を一覧表示する', 'list the package selections'],
    ['--set-selections', '標準入力の選択状態を設定する', 'set the package selections from stdin'],
    ['--force-all', 'すべての問題を無視して強制的に実行する（注意）', 'force everything despite problems (careful)'],
    ['--force-depends', '依存関係の問題を無視して実行する（注意）', 'ignore dependency problems (careful)'],
    ['--compare-versions', '2つの版を比べる（`1.0 lt 2.0`）', 'compare two versions (`1.0 lt 2.0`)'],
    ['-p|--print-avail', '取得できるパッケージの情報を表示', 'show information of an available package'],
    ['-W|--show', '指定の書式でパッケージを表示', 'show packages in a given format'],
    ['--simulate|--no-act|--dry-run', '実際には何もしない', 'do not change anything'],
    ['--root', '代わりのルートディレクトリ', 'install into the given root directory', 'arg'],
    ['--force-confold', '設定ファイルが違うとき、現在のものを残す', 'keep the current configuration files when they differ'],
    ['--force-confnew', '設定ファイルが違うとき、新しいものを使う', 'use the new configuration files when they differ'],
  ], { parser: 'dpkg', ...args(operand('PACKAGE', 'パッケージ名または .deb ファイル', 'package name or .deb file')) }),
  'dpkg-query': cmd('入っている Debian パッケージの情報を問い合わせる', 'Query installed Debian packages', [
    ['-W|--show', 'パッケージを一覧表示する（`-f` で形式を指定）', 'show packages (format with `-f`)'],
    ['-f|--showformat', '`-W` の出力形式（`${Package} ${Version}\\n` など）', 'output format for `-W` (`${Package} ${Version}\\n`…)', 'arg'],
    ['-l|--list', 'パッケージを一覧表示する', 'list packages'],
    ['-L|--listfiles', 'パッケージが入れたファイルを一覧表示する', 'list the files a package installed'],
    ['-S|--search', '指定したファイルを入れたパッケージを探す', 'find the package that installed a file'],
    ['-s|--status', 'パッケージの状態を表示する', "show a package's status"],
  ], { parser: 'dpkg', ...args({ name: 'PACKAGE', text: pkg }) }),
  'dpkg-architecture': cmd('Debian のビルド用アーキテクチャの値を表示する', 'Print Debian build architecture values', [
    ['-q|--query', '指定した変数の値だけを表示する（`DEB_HOST_MULTIARCH`、`DEB_BUILD_GNU_TYPE`…）', 'print only the given variable (`DEB_HOST_MULTIARCH`, `DEB_BUILD_GNU_TYPE`…)', 'arg'],
    ['-a|--host-arch', '対象の Debian アーキテクチャを指定する', 'use the given Debian host architecture', 'arg'],
  ]),
  apk: cmd('Alpine Linux のパッケージ管理', 'Alpine Linux package manager', persistent(apkCommon), {
    subcommands: {
      add: cmd('パッケージをインストールする', 'Install packages', [], { positional: [pos('パッケージ名（`名前=版` で版を指定）', 'package name (`name=version` pins a version)')] }),
      del: cmd('パッケージ（または `--virtual` の名前）を削除する', 'Remove packages (or a `--virtual` name)', [], { positional: [pkg] }),
      update: cmd('パッケージの一覧を取り直す', 'Refresh the package index', []),
      upgrade: cmd('入っているパッケージを更新する', 'Upgrade installed packages', []),
      info: cmd('パッケージの情報を表示する', 'Show package information', [], { positional: [pkg] }),
      search: cmd('パッケージを検索する', 'Search for packages', [], { positional: [pos('検索語', 'search term')] }),
    },
  }),
  dnf: cmd('Fedora / RHEL のパッケージ管理', 'Fedora/RHEL package manager', rpmCommon, {
    subcommands: rpmSubs({
      ...dnfLike(),
      repoquery: pkgSub('リポジトリのパッケージ情報を問い合わせる', 'Query repository package information'),
      module: cmd('モジュール（ストリーム）を扱う（`list`、`enable`、`install`）', 'Handle modules and streams (`list`, `enable`, `install`)'),
      'config-manager': cmd('リポジトリの設定を表示・変更する', 'Show or change repository settings'),
      download: pkgSub('RPM をダウンロードだけする', 'Download RPMs without installing'),
      mark: cmd('パッケージに印を付ける（`install`、`remove`）', 'Mark packages (`install`, `remove`)'),
      swap: cmd('あるパッケージを別のものに置き換える', 'Swap one package for another'),
    }),
  }),
  yum: cmd('RHEL / CentOS のパッケージ管理（古い版。新しくは dnf）', 'RHEL/CentOS package manager (older; dnf replaces it)', rpmCommon, {
    subcommands: rpmSubs({
      ...dnfLike(),
      localinstall: pkgSub('ローカルの RPM ファイルを入れる', 'Install a local RPM file'),
      deplist: pkgSub('依存関係を一覧表示する', 'List dependencies'),
    }),
  }),
  microdnf: cmd('最小構成のコンテナ向けの dnf', 'Minimal dnf for containers', rpmCommon, { subcommands: rpmSubs() }),
  brew: cmd('Homebrew（macOS / Linux のパッケージ管理）', 'Homebrew (package manager for macOS and Linux)', [
    ['--prefix', 'Homebrew（またはパッケージ）の置き場所を表示する', 'print where Homebrew (or a package) lives'],
    ['-q|--quiet', '表示を減らす', 'less output'],
  ], {
    subcommands: {
      install: cmd('パッケージをインストールする', 'Install packages', [['--cask', 'GUI アプリ（cask）として入れる', 'install a GUI app (cask)']], { positional: [pkg] }),
      uninstall: cmd('パッケージを削除する', 'Uninstall packages', [], { positional: [pkg] }),
      update: cmd('Homebrew 自身とパッケージの一覧を更新する', 'Update Homebrew and the package lists'),
      upgrade: cmd('入っているパッケージを更新する', 'Upgrade installed packages', [], { positional: [pkg] }),
      list: cmd('入っているパッケージを一覧表示する', 'List installed packages'),
      info: cmd('パッケージの情報を表示する', 'Show package information', [], { positional: [pkg] }),
      tap: cmd('追加のリポジトリ（tap）を登録する', 'Add a third-party repository (tap)', [], { positional: [pos('tap の名前（`ユーザー/リポジトリ`）', 'tap name (`user/repo`)')] }),
      cleanup: cmd('古い版やキャッシュを削除する', 'Remove old versions and caches'),
      bundle: cmd('Brewfile に書かれたものをまとめて入れる', 'Install everything in a Brewfile'),
    },
  }),
  pip,
  pip3: pip,
  yarn: cmd('Node.js のパッケージマネージャ（Yarn）', 'Node.js package manager (Yarn)', [
    ['--frozen-lockfile|--immutable', 'yarn.lock を書き換えない（CI 向け。合わなければ失敗）', 'do not change yarn.lock (for CI; fail if it is out of date)'],
    ['--production', '開発用の依存を入れない', 'skip development dependencies'],
    ...persistent([
      ['--cwd', '指定したディレクトリで実行する', 'run in the given directory', 'arg'],
      ['-s|--silent', '余計な出力をしない（Yarn 1）', 'print less (Yarn 1)'],
      ['--verbose', '詳しく表示する（Yarn 1）', 'verbose output (Yarn 1)'],
      ['--offline', 'ネットワークを使わず、キャッシュだけを使う（Yarn 1）', 'use only the cache, not the network (Yarn 1)'],
      ['--non-interactive', '対話的な確認をしない（Yarn 1）', 'do not prompt (Yarn 1)'],
      ['--network-timeout', 'ネットワークの要求を待つ時間の上限（ミリ秒。Yarn 1）', 'how long to wait for a network request (milliseconds; Yarn 1)', 'arg'],
      ['--ignore-engines', 'package.json の `engines` の検査を省く（Yarn 1）', 'skip the `engines` check of package.json (Yarn 1)'],
    ]),
  ], {
    subcommands: {
      install: cmd('依存をインストールする', 'Install dependencies', [['--frozen-lockfile|--immutable', 'yarn.lock を書き換えない（CI 向け）', 'do not change yarn.lock (for CI)'], ['--production', '開発用の依存を入れない', 'skip development dependencies']]),
      add: cmd('依存を追加する', 'Add dependencies', [['-D|--dev', '開発用の依存として追加', 'as development dependencies']], { positional: [pkg] }),
      remove: cmd('依存を削除する', 'Remove dependencies', [], { positional: [pkg] }),
      run: cmd('package.json の scripts を実行する', 'Run a package.json script', [], { positional: [pos('スクリプト名', 'script name')] }),
      cache: cmd('キャッシュを操作する（`yarn cache clean` で削除する）', 'Manage the cache (`yarn cache clean` empties it)'),
    },
  }),

  // ---- Language toolchains ----
  node: cmd('JavaScript を実行する（Node.js）', 'Run JavaScript (Node.js)', [
    ['-e|--eval', '指定した JavaScript を実行する', 'run the given JavaScript', 'arg'],
    ['-p|--print', '指定した JavaScript を実行して結果を表示する', 'run the given JavaScript and print the result', 'arg'],
    ['-v|--version', '版を表示する', 'print the version'],
    ['-r|--require', '先に指定したモジュールを読み込む', 'load the given module first', 'arg'],
  ], { positional: [pos('実行するスクリプト', 'script to run'), pos('スクリプトへの引数', 'argument to the script')] }),
  go: cmd('Go のツール（ビルド・テスト・依存管理）', 'Go toolchain (build, test, modules)', [], {
    subcommands: {
      build: cmd('パッケージをビルドする', 'Compile packages', [
        ['-o', '出力するファイル名', 'output file', 'arg'], ['-mod', '依存の扱い（`readonly`: go.mod を変えない、`vendor`）', 'module mode (`readonly`: do not change go.mod; `vendor`)', 'arg'], ['-v', 'ビルドするパッケージ名を表示', 'print package names'],
        ['-ldflags', 'リンカに渡すフラグ（`-s -w` で小さく、`-X` で変数を埋め込む）', 'linker flags (`-s -w`: smaller; `-X`: set a variable)', 'arg'],
        ['-trimpath', 'ビルドした場所のパスを埋め込まない（再現可能なビルド）', 'leave out local paths (reproducible builds)'], ['-race', 'データ競合の検出を有効にする', 'enable the race detector'],
        ['-tags', 'ビルドタグ', 'build tags', 'arg'],
      ], { positional: [pos('パッケージ（`./...` で配下すべて）', 'packages (`./...`: everything below)')], parser: 'single-dash' }),
      test: cmd('テストを実行する', 'Run tests', [
        ['-v', '各テストの結果を表示', 'verbose'], ['-run', '指定した正規表現に合うテストだけ', 'only tests matching the given regex', 'arg'], ['-race', 'データ競合の検出を有効にする', 'enable the race detector'],
        ['-count', '実行回数（`-count=1` でキャッシュを使わない）', 'run count (`-count=1` skips the cache)', 'arg'], ['-cover', 'カバレッジを表示', 'show coverage'], ['-timeout', '時間切れ', 'timeout', 'arg'],
        ['-json', '結果を JSON で出力', 'JSON output'], ['-c', 'テストのバイナリを作るだけで実行しない', 'compile the test binary, do not run it'], ['-o', 'テストのバイナリの出力先', 'test binary output', 'arg'],
        ['-tags', 'ビルドタグ', 'build tags', 'arg'], ['-ldflags', 'リンカに渡すフラグ', 'linker flags', 'arg'], ['-short', '時間のかかるテストを省く', 'skip long tests'],
      ], { positional: [pos('パッケージ（`./...` で配下すべて）', 'packages (`./...`: everything below)')], parser: 'single-dash' }),
      run: cmd('ビルドしてすぐ実行する', 'Compile and run', [], { positional: [pos('main パッケージかファイル（`パス@版` も可）', 'main package or files (or `path@version`)'), pos('プログラムへの引数', 'argument to the program')], parser: 'single-dash' }),
      install: cmd('ビルドしてコマンドを `$GOPATH/bin` に入れる（`パス@版`）', 'Build and install commands into `$GOPATH/bin` (`path@version`)', [], { positional: [pos('パッケージ（`パス@版`）', 'package (`path@version`)')] }),
      get: cmd('依存を追加・更新する（go.mod を書き換える）', 'Add or update dependencies (edits go.mod)', [['-u', '最新版に更新', 'update to the latest']], { positional: [pkg], parser: 'single-dash' }),
      mod: cmd('モジュール（go.mod）を操作する（`tidy`、`download`、`vendor`、`edit`）', 'Manage modules (`tidy`, `download`, `vendor`, `edit`)', [], { parser: 'single-dash' }),
      list: cmd('パッケージやモジュールを一覧表示する', 'List packages or modules', [['-m', 'パッケージでなくモジュールを', 'modules instead of packages'], ['-json', 'JSON で出力', 'JSON output'], ['-f', 'Go テンプレートで出力形式を指定', 'output format as a Go template', 'arg'], ['-e', 'エラーのあるパッケージも表示', 'include packages with errors'], ['-deps', '依存もすべて', 'include dependencies'], ['-find', '依存を解決せずに探すだけ', 'only find, do not resolve dependencies']], { positional: [pos('パッケージ（`./...`、`all`）', 'packages (`./...`, `all`)')], parser: 'single-dash' }),
      vet: cmd('怪しいコードを検査する', 'Report suspicious code', [], { positional: [pos('パッケージ', 'packages')] }),
      fmt: cmd('コードを整形する', 'Format code', [], { positional: [pos('パッケージ', 'packages')] }),
      generate: cmd('`//go:generate` のコマンドを実行する', 'Run `//go:generate` commands'),
      tool: cmd('Go のツールや、go.mod に登録したツールを実行する（`go tool 名前`）', 'Run a Go tool, or a tool listed in go.mod (`go tool name`)', [], { parser: 'single-dash' }),
      version: cmd('Go の版を表示する', 'Print the Go version'),
      env: cmd('Go の環境変数を表示する', "Print Go's environment", [], { positional: [pos('変数名（`GOPATH`、`GOOS`…）', 'variable name (`GOPATH`, `GOOS`…)')] }),
    },
  }),
  gofmt: cmd('Go のコードを整形する', 'Format Go code', [
    ['-l', '整形が必要なファイル名だけを表示（CI での検査向け）', 'list files that need formatting (for CI checks)'], ['-w', 'ファイルを直接書き換える', 'rewrite files in place'],
    ['-d', '差分を表示する', 'show diffs'], ['-s', 'コードを簡略化する', 'simplify code'],
  ], { positional: [files] }),
  cargo: cmd('Rust のビルドツール・パッケージマネージャ', 'Rust build tool and package manager', [], {
    subcommands: {
      build: cmd('ビルドする', 'Compile', [['--release', '最適化してビルド（`target/release`）', 'optimised build (`target/release`)'], ['--locked', 'Cargo.lock のとおりに（変えない）', 'use Cargo.lock as is']]),
      test: cmd('テストを実行する', 'Run tests', [['--release', '最適化してビルド', 'optimised build'], ['--locked', 'Cargo.lock のとおりに', 'use Cargo.lock as is']]),
      run: cmd('ビルドして実行する', 'Compile and run', [['--release', '最適化してビルド', 'optimised build']]),
      install: cmd('Rust のコマンドを入れる', 'Install a Rust binary', [['--locked', '公開時の Cargo.lock のとおりに入れる（推奨）', "use the published Cargo.lock (recommended)"]], { positional: [pkg] }),
      check: cmd('ビルドせずに型などを検査する', 'Check without building'),
      fmt: cmd('コードを整形する', 'Format code', [['--check', '整形が必要なら失敗する（CI 向け）', 'fail if formatting is needed (for CI)']]),
      clippy: cmd('リンター（Clippy）で検査する', 'Lint with Clippy'),
      add: cmd('依存を追加する', 'Add dependencies', [], { positional: [pkg] }),
      update: cmd('Cargo.lock の依存を更新する', 'Update dependencies in Cargo.lock'),
      doc: cmd('ドキュメントを作る', 'Build documentation'),
    },
  }),
  rustup: cmd('Rust のツールチェーン管理', 'Rust toolchain manager', [['-y', '確認しない', 'do not ask for confirmation']], {
    subcommands: {
      component: cmd('部品（`rustfmt`、`clippy`…）を追加・削除する（`component add`）', 'Add or remove components (`rustfmt`, `clippy`…; `component add`)'),
      target: cmd('クロスコンパイルの対象を追加する（`target add`）', 'Add cross-compilation targets (`target add`)'),
      toolchain: cmd('ツールチェーンを入れる・削除する（`toolchain install`）', 'Install or remove toolchains (`toolchain install`)'),
      default: cmd('既定のツールチェーンを設定する', 'Set the default toolchain', [], { positional: [pos('ツールチェーン（`stable`、`nightly`…）', 'toolchain (`stable`, `nightly`…)')] }),
      update: cmd('ツールチェーンを更新する', 'Update toolchains'),
      show: cmd('入っているツールチェーンを表示する', 'Show installed toolchains'),
      run: cmd('指定したツールチェーンでコマンドを実行する', 'Run a command with a given toolchain'),
    },
  }),
  rustc: cmd('Rust のコンパイラ', 'Rust compiler', [
    ['-V|--version', '版を表示する（`-Vv` で詳しく）', 'print the version (`-Vv`: verbose)'], ['-v|--verbose', '詳しく表示する', 'verbose'],
    ['-o', '出力するファイル名', 'output file', 'arg'], ['--edition', 'Rust のエディション', 'Rust edition', 'arg'],
  ], { positional: [files] }),
  php: cmd('PHP を実行する', 'Run PHP', [
    ['-r', '指定した PHP のコードを実行する（`<?php` は不要）', 'run the given PHP code (no `<?php`)', 'arg'], ['-v|--version', '版を表示する', 'print the version'],
    ['-m', '入っている拡張を一覧表示する', 'list loaded extensions'], ['-i', '設定の情報（phpinfo）を表示する', 'show configuration (phpinfo)'],
    ['-d', 'php.ini の設定を1つ上書きする（`-d 名前=値`）', 'set one php.ini setting (`-d name=value`)', 'arg'],
  ], { positional: [pos('実行するスクリプト', 'script to run'), pos('スクリプトへの引数', 'argument to the script')] }),
  gcc: cmd('C コンパイラ（GCC）', 'C compiler (GCC)', [
    ['-o', '出力するファイル名', 'output file', 'arg'], ['-c', 'コンパイルだけしてリンクしない（.o を作る）', 'compile only, do not link (make .o files)'],
    ['-g', 'デバッグ情報を入れる', 'include debug information'], ['-O0', '最適化しない', 'no optimisation'], ['-O2', '一般的な最適化', 'usual optimisation'],
    ['-O3', 'より強い最適化', 'more optimisation'], ['-Os', 'サイズを小さくする最適化', 'optimise for size'], ['-Wall', '主な警告を有効にする', 'enable the common warnings'],
    ['-Wextra', '追加の警告を有効にする', 'enable extra warnings'], ['-Werror', '警告をエラーにする', 'treat warnings as errors'],
    ['-shared', '共有ライブラリを作る', 'build a shared library'], ['-fPIC', '位置独立コードを作る（共有ライブラリ向け）', 'position-independent code (for shared libraries)'],
    ['-static', '静的にリンクする', 'link statically'], ['-dumpversion', 'コンパイラの版だけを表示する', 'print only the compiler version'], ['-dumpmachine', '対象のアーキテクチャを表示する', 'print the target triple'],
  ], { positional: [pos('ソースファイル', 'source file')], parser: 'single-dash' }),

  // ---- GitHub ----
  // gh finds its subcommand as cobra does: `gh -R o/r pr list` gives `-R` to `pr`.
  // (cobra's `-h` is added only after the search for the subcommand, so `gh -h pr` takes `pr` as its value, as an
  // option not known there: gh shows its own help.)
  gh: cmd('GitHub CLI', 'GitHub CLI', [['--version', '版を表示する', 'print the version'], ['--help', 'ヘルプを表示する', 'show help', 'persistent']], {
    parser: 'cobra',
    subcommands: {
      api: cmd('GitHub の API を呼び出す', 'Call the GitHub API', [
        ['--jq|-q', '結果を指定した jq の式で絞る', 'filter the result with the given jq expression', 'arg lang:jq'],
        ['-X|--method', 'HTTP メソッド（既定は GET、値があれば POST）', 'HTTP method (GET; POST when fields are given)', 'arg'],
        ['-f|--raw-field', '文字列の値を送る（`名前=値`）', 'send a string field (`name=value`)', 'arg'],
        ['-F|--field', '型を推測して値を送る（数値・真偽値・`@ファイル`）', 'send a typed field (numbers, booleans, `@file`)', 'arg'],
        ['--paginate', 'すべてのページを取得する', 'fetch every page'], ['-H|--header', 'HTTP ヘッダーを追加する', 'add an HTTP header', 'arg'],
        ['-i|--include', 'レスポンスのヘッダーも表示する', 'include response headers'],
      ], { positional: [pos('API のパス（`repos/{owner}/{repo}/…`）', 'API path (`repos/{owner}/{repo}/…`)')] }),
      pr: cmd('プルリクエストを操作する（`create`、`view`、`checkout`、`merge`、`list`…）', 'Work with pull requests (`create`, `view`, `checkout`, `merge`, `list`…)', [
        ...ghRepo,
        ['-t|--title', 'タイトル', 'title', 'arg'], ['-b|--body', '本文', 'body', 'arg'], ['-F|--body-file', '本文のファイル', 'body file', 'arg'],
        ['-H|--head', 'PR の元のブランチ', 'branch the changes come from', 'arg'], ['-B|--base', 'マージ先のブランチ', 'branch to merge into', 'arg'],
        ['-l|--label', 'ラベル', 'label', 'arg'], ['-d|--draft', '下書きにする', 'as a draft'], ['-f|--fill', 'コミットからタイトルと本文を埋める', 'fill title and body from the commits'],
        ['--json', '出力する項目を JSON で（`number,title`…）', 'JSON output with these fields (`number,title`…)', 'arg'], ['-q|--jq', 'JSON を指定した jq の式で絞る', 'filter the JSON with the given jq expression', 'arg lang:jq'],
      ]),
      issue: cmd('Issue を操作する（`create`、`view`、`list`…）', 'Work with issues (`create`, `view`, `list`…)', ghRepo),
      release: cmd('リリースを操作する（`create`、`download`、`view`…）', 'Work with releases (`create`, `download`, `view`…)', ghRepo),
      run: cmd('GitHub Actions の実行を操作する（`list`、`view`、`watch`…）', 'Work with GitHub Actions runs (`list`, `view`, `watch`…)', ghRepo),
      workflow: cmd('GitHub Actions のワークフローを操作する（`run`、`list`…）', 'Work with GitHub Actions workflows (`run`, `list`…)', ghRepo),
      repo: cmd('リポジトリを操作する（`clone`、`view`、`create`…）', 'Work with repositories (`clone`, `view`, `create`…)', ghRepo),
      auth: cmd('GitHub へのログインを管理する（`login`、`status`、`token`）', 'Manage authentication (`login`, `status`, `token`)'),
    },
  }),

  // ---- Users and groups ----
  id: cmd('ユーザーの ID とグループを表示する', "Print a user's IDs and groups", [
    ['-Z|--context', 'SELinux のセキュリティコンテキストを表示', 'print the SELinux security context'],
    ['-z|--zero', '各項目を改行でなく NUL で区切る', 'delimit entries with NUL'],
    ['-u|--user', 'ユーザー ID だけ（`0` なら root）', 'only the user ID (`0` is root)'], ['-g|--group', '主グループの ID だけ', 'only the primary group ID'],
    ['-G|--groups', '所属するグループの ID すべて', 'all group IDs'], ['-n|--name', '数値でなく名前で表示（`-un` でユーザー名）', 'names instead of numbers (`-un`: user name)'],
    ['-r|--real', '実 ID を表示する', 'real IDs instead of effective'],
    ...GNU_INFO,
  ], { parser: 'getopt_long', positional: [user] }),
  whoami: cmd('今のユーザー名を表示する', 'Print the current user name', [...GNU_INFO], { parser: 'getopt_long' }),
  getent: cmd('ユーザー・グループ・ホストなどのデータベースを引く（`/etc/passwd` や LDAP も見る）', 'Look up users, groups, hosts and other databases (`/etc/passwd`, LDAP…)', [], {
    positional: [pos('データベース（`passwd`、`group`、`hosts`…）', 'database (`passwd`, `group`, `hosts`…)'), pos('探すキー（名前や ID）', 'key to look up (name or ID)')],
  }),
  useradd: cmd('ユーザーを作る', 'Create a user', [
    ['-e|--expiredate', 'アカウントの期限日（`YYYY-MM-DD`）', 'account expiry date (`YYYY-MM-DD`)', 'arg'],
    ['-f|--inactive', 'パスワードの期限切れ後にアカウントを無効にするまでの日数', 'days after password expiry before the account is disabled', 'arg'],
    ['-k|--skel', 'ホームの雛形のディレクトリ', 'skeleton directory for the home', 'arg'],
    ['-o|--non-unique', '重複する UID を許す', 'allow a duplicate UID'],
    ['-p|--password', '暗号化済みのパスワード', 'encrypted password', 'arg'],
    ['-N|--no-user-group', 'ユーザー名と同じグループを作らない', 'do not create a group with the user name'],
    ['-b|--base-dir', 'ホームを作る親ディレクトリ', 'base directory for the home', 'arg'],
    ['-D|--defaults', '既定値を表示・変更する', 'show or change the defaults'],
    ['-R|--root', '代わりのルートディレクトリ', 'apply changes in the given chroot directory', 'arg'],
    ['-Z|--selinux-user', 'SELinux のユーザー', 'SELinux user', 'arg'],
    ['-m|--create-home', 'ホームディレクトリを作る', 'create the home directory'], ['-M|--no-create-home', 'ホームディレクトリを作らない', 'do not create a home directory'],
    ['-r|--system', 'システムユーザー（サービス用）として作る', 'create a system account (for services)'], ['-u|--uid', 'ユーザー ID', 'user ID', 'arg'],
    ['-g|--gid', '主グループ', 'primary group', 'arg'], ['-G|--groups', '追加で所属するグループ（カンマ区切り）', 'extra groups (comma-separated)', 'arg'],
    ['-s|--shell', 'ログインシェル（`/usr/sbin/nologin` でログイン不可）', 'login shell (`/usr/sbin/nologin`: no login)', 'arg'], ['-d|--home-dir', 'ホームディレクトリ', 'home directory', 'arg'],
    ['-c|--comment', '説明（氏名など）', 'comment (full name…)', 'arg'], ['-U|--user-group', '同じ名前のグループも作る', 'create a group with the same name'],
    ['-l|--no-log-init', 'lastlog などに記録しない（大きな UID で Docker イメージが膨らむのを防ぐ）', 'do not add to lastlog (avoids huge Docker images with large UIDs)'],
  ], { positional: [user] }),
  groupadd: cmd('グループを作る', 'Create a group', [
    ['-o|--non-unique', '重複する GID を許す', 'allow a duplicate GID'],
    ['-p|--password', '暗号化済みのパスワード', 'encrypted password', 'arg'],
    ['-R|--root', '代わりのルートディレクトリ', 'apply changes in the given chroot directory', 'arg'],
    ['-r|--system', 'システムグループとして作る', 'create a system group'], ['-g|--gid', 'グループ ID', 'group ID', 'arg'], ['-f|--force', 'すでにあっても成功にする', 'succeed if it already exists'],
  ], { positional: [group] }),
  adduser: cmd('ユーザーを作る（Debian の対話的な版、または BusyBox / Alpine 版）', "Create a user (Debian's friendlier tool, or BusyBox/Alpine's)", [
    ['--system|-S', 'システムユーザーとして作る', 'create a system user'], ['--disabled-password|-D', 'パスワードを設定しない', 'do not set a password'],
    ['--home|-h', 'ホームディレクトリ', 'home directory', 'arg'], ['--shell|-s', 'ログインシェル', 'login shell', 'arg'],
    ['--uid|-u', 'ユーザー ID', 'user ID', 'arg'], ['--ingroup|-G', '所属させるグループ', 'group to put the user in', 'arg'],
    ['--group', '同じ名前のグループも作る（`--system` と）', 'create a group with the same name (with `--system`)'], ['--gecos|-g', '説明（氏名など）', 'comment (full name…)', 'arg'],
    ['--no-create-home|-H', 'ホームディレクトリを作らない', 'do not create a home directory'],
  ], { positional: [user, group] }),
  addgroup: cmd('グループを作る（Debian / BusyBox）', 'Create a group (Debian, BusyBox)', [
    ['--system|-S', 'システムグループとして作る', 'create a system group'], ['--gid|-g', 'グループ ID', 'group ID', 'arg'],
  ], { positional: [group] }),
  su: cmd('別のユーザー（既定は root）になってシェルやコマンドを実行する', 'Run a shell or command as another user (root by default)', [
    // The string runs in the user's shell. util-linux su keeps the environment but HOME, SHELL, USER, LOGNAME and
    // PATH (exported functions too); `-`, `-l` and `--login` start it afresh, but for TERM (su(1)).
    { names: ['-c', '--command'], text: tx('シェルで指定したコマンドを実行する', 'run the given command with the shell'), value: { name: 'COMMAND', command: { run: 'shell-string', env: 'exported', envWith: { options: ['-', '-l', '--login'], env: 'reset', keeps: ['TERM'] } } } },
    ['-|-l|--login', 'ログインシェルとして（環境を初期化して）', 'as a login shell (fresh environment)'],
    ['-s|--shell', '使うシェル', 'shell to use', 'arg'], ['-m|-p|--preserve-environment', '今の環境変数を引き継ぐ', 'keep the environment'],
    ['-g|--group', '主グループを指定する', 'specify the primary group', 'arg'],
    ['-G|--supp-group', '追加のグループを指定する', 'specify a supplementary group', 'arg'],
    ['-P|--pty', '疑似端末を作る', 'create a pseudo-terminal for the session'],
  ], { operands: [{ pattern: [{ name: 'USER', text: user, repeat: '*' }] }] }),
  gosu: cmd('別のユーザーでコマンドを実行する（コンテナの入口向け。sudo と違い PID 1 を引き継ぐ）', "Run a command as another user (for container entrypoints; unlike sudo it keeps PID 1)", [], {
    positional: [pos('ユーザー（`ユーザー:グループ` も可）', 'user (or `user:group`)'), pos('実行するコマンド', 'command to run'), pos('コマンドへの引数', 'argument to the command')],
  }),

  // ---- System information and services ----
  uname: cmd('OS とマシンの情報を表示する', 'Print system information', [
    ['-i|--hardware-platform', 'ハードウェアのプラットフォーム', 'hardware platform'],
    ['-a|--all', 'すべての情報', 'all information'], ['-s|--kernel-name', 'カーネル名（`Linux`、`Darwin`…。スクリプトで OS 判定に使う）', 'kernel name (`Linux`, `Darwin`…; used to tell the OS)'],
    ['-m|--machine', 'マシンのアーキテクチャ（`x86_64`、`arm64`、`aarch64`…）', 'machine architecture (`x86_64`, `arm64`, `aarch64`…)'], ['-r|--kernel-release', 'カーネルのリリース', 'kernel release'],
    ['-n|--nodename', 'ホスト名', 'host name'], ['-o|--operating-system', 'OS 名', 'operating system'], ['-p|--processor', 'プロセッサの種類', 'processor type'], ['-v|--kernel-version', 'カーネルの版', 'kernel version'],
    ...GNU_INFO,
  ], { parser: 'getopt_long' }),
  arch: cmd('マシンのアーキテクチャを表示する（`uname -m` と同じ）', 'Print the machine architecture (same as `uname -m`)', [...GNU_INFO], { parser: 'getopt_long' }),
  hostname: cmd('ホスト名を表示・設定する', 'Show or set the host name', [
    ['-d|--domain', 'DNS ドメイン名を表示', 'show the DNS domain name'],
    ['-A|--all-fqdns', 'すべての FQDN を表示', 'show all FQDNs'],
    ['-b|--boot', 'ホスト名が未設定なら `localhost` を設定する', 'set a default host name if none is set'],
    ['-F|--file', 'ファイルからホスト名を設定する', 'set the host name from a file', 'arg'],
    ['-a|--alias', '別名を表示', 'show the alias names'],
    ['-f|--fqdn|--long', '完全修飾ドメイン名', 'fully qualified domain name'], ['-s|--short', 'ドメインを除いた名前', 'short name'],
    ['-I|--all-ip-addresses', 'すべての IP アドレス（Linux）', 'all IP addresses (Linux)'], ['-i|--ip-address', 'ホスト名の IP アドレス', "the host name's IP address"],
  ]),
  nproc: cmd('使える CPU の数を表示する（`make -j$(nproc)` の定番）', 'Print the number of usable CPUs (as in `make -j$(nproc)`)', [
    ['--all', '制限を無視して全 CPU 数', 'all CPUs, ignoring limits'], ['--ignore', '指定した数だけ引いて表示', 'subtract the given number of', 'arg'],
    ...GNU_INFO,
  ], { parser: 'getopt_long' }),
  getconf: cmd('システムの設定値を表示する', 'Print system configuration values', [], {
    positional: [pos('変数名（`_NPROCESSORS_ONLN`: 使える CPU 数、`LONG_BIT`: 32/64 ビット、`PAGESIZE`…）', 'variable (`_NPROCESSORS_ONLN`: usable CPUs, `LONG_BIT`: 32/64-bit, `PAGESIZE`…)')],
  }),
  lsb_release: cmd('Linux ディストリビューションの情報を表示する', 'Print Linux distribution information', [
    ['-a|--all', 'すべての情報', 'all information'], ['-i|--id', 'ディストリビューション名（`Ubuntu`…）', 'distributor ID (`Ubuntu`…)'], ['-d|--description', '説明', 'description'],
    ['-r|--release', 'リリース番号', 'release number'], ['-c|--codename', 'コードネーム（`noble`…）', 'code name (`noble`…)'], ['-s|--short', '見出しなしで値だけ', 'values only, no labels'],
  ]),
  sw_vers: cmd('macOS の版を表示する', 'Print the macOS version', [
    ['-productName', '製品名（`macOS`）', 'product name (`macOS`)'], ['-productVersion', '版（`14.5`…）', 'version (`14.5`…)'], ['-buildVersion', 'ビルド番号', 'build number'],
  ], { parser: 'single-dash' }),
  sysctl: cmd('カーネルのパラメータを表示・変更する', 'Show or change kernel parameters', [
    ['-e|--ignore', '知らないキーのエラーを無視する', 'ignore unknown keys'],
    ['-N|--names', '名前だけ表示', 'print names only'],
    ['-q|--quiet', '設定した値を表示しない', 'do not echo the values set'],
    ['--system', 'すべての設定ファイルを読み込む', 'load all system configuration files'],
    ['-r|--pattern', '指定した正規表現に合うものだけ', 'only names matching the given regular expression', 'arg'],
    ['-b|--binary', '値を改行なしで出力', 'print values without a newline'],
    ['--load', 'ファイルから読み込む（`-p` と同じ）', 'load from a file (same as `-p`)', 'arg'],
    ['-n', '名前を付けず値だけ', 'values only, no names'], ['-w', '値を書き込む（`名前=値`）', 'write a value (`name=value`)'],
    ['-a', 'すべて表示する', 'show all'], ['-p', '設定ファイル（既定は `/etc/sysctl.conf`）から読み込む', 'load from a file (default `/etc/sysctl.conf`)'],
  ], { positional: [pos('パラメータ名（`hw.memsize`、`net.ipv4.ip_forward`…）', 'parameter name (`hw.memsize`, `net.ipv4.ip_forward`…)')] }),
  systemctl: cmd('systemd のサービスを操作する', 'Control systemd services', persistent([
    ['-a|--all', 'すべてのユニットを表示（停止中のものも）', 'show all units, including inactive ones'],
    ['-t|--type', 'ユニットの種類で絞る（`service`、`timer`、`socket`…）', 'filter by unit type (`service`, `timer`, `socket`…)', 'arg'],
    ['--state', '状態で絞る（`failed`、`running`…）', 'filter by state (`failed`, `running`…)', 'arg'],
    ['-l|--full', '長い行を省略しない', 'do not ellipsize output'],
    ['-H|--host', '操作するホスト（SSH 経由）', 'operate on a remote host over SSH', 'arg'],
    ['--system', 'システムのサービスマネージャーを使う', 'use the system service manager'],
    ['--no-reload', '`enable` や `disable` の後に設定を再読み込みしない', 'do not reload after enable or disable'],
    ['-f|--force', '強制する（`enable` では既存のリンクを置き換える）', 'force (with `enable`, replace existing links)'],
    ['--no-ask-password', 'パスワードを尋ねない', 'do not ask for passwords'],
    ['--no-legend', '見出しと脚注を表示しない', 'do not print the legend'],
    ['-p|--property', '表示するプロパティ（`show` で）', 'property to show (with `show`)', 'arg'],
    ['--failed', '失敗したユニットだけ', 'show only failed units'],
    ['--runtime', '再起動すると消える一時的な変更にする', 'make a temporary change that is lost at reboot'],
    ['--global', 'すべてのユーザーに対して有効・無効にする', 'enable or disable for all users'],
    ['--root', '代わりのルートディレクトリ', 'use the given root directory', 'arg'],
    ['-n|--lines', '`status` で表示するログの行数', 'number of journal lines shown by `status`', 'arg'],
    ['-o|--output', '`status` のログの形式', 'journal output format for `status`', 'arg'],
    ['-r|--recursive', 'ホストとローカルコンテナーのユニットを表示する（`list-units` など）', 'show units of the host and local containers (`list-units`…)'],
    ['--reverse', '`list-dependencies` で逆向きに表示', 'show reverse dependencies'],
    ['--before', '`list-dependencies` で先に起動するもの', 'show units ordered before'],
    ['--after', '`list-dependencies` で後に起動するもの', 'show units ordered after'],
    ['--signal', '`kill` で送るシグナル', 'signal to send with `kill`', 'arg'],
    ['-M|--machine', '操作するコンテナ', 'operate on a container', 'arg'],
    ['--wait', '`start` したユニットが終わるまで待つ', 'wait until started units finish'],
    ['--user', '自分のユーザーのサービスを操作する', "control the user's own services"], ['-q|--quiet', '表示を減らす（`is-active` を条件判定に使うとき）', 'less output (when `is-active` is used as a test)'],
    ['--now', '`enable` と同時に起動（`disable` なら停止）', 'also start with `enable` (stop with `disable`)'], ['--no-pager', 'ページャを使わない', 'do not use a pager'],
  ]), {
    subcommands: {
      'is-failed': unitSub('ユニットが失敗状態かどうか確かめる', 'Check whether the unit failed'),
      'list-units': cmd('読み込まれているユニットを一覧表示する', 'List the loaded units'),
      'list-unit-files': cmd('インストールされているユニットファイルと有効・無効の状態を一覧表示する', 'List installed unit files and whether they are enabled'),
      'list-timers': cmd('タイマーと次回の実行時刻を一覧表示する', 'List timers and when they fire next'),
      'list-sockets': cmd('ソケットユニットを一覧表示する', 'List socket units'),
      'list-dependencies': unitSub('ユニットの依存関係を木で表示する', 'Show the dependency tree of a unit'),
      'list-jobs': cmd('実行待ちのジョブを一覧表示する', 'List jobs in progress'),
      show: unitSub('ユニットのプロパティを表示する', 'Show the properties of a unit'),
      cat: unitSub('ユニットファイルの内容を表示する', 'Show the unit file contents'),
      edit: unitSub('ユニットの設定を上書きする（ドロップインを編集）', 'Edit a drop-in override of a unit'),
      'reset-failed': unitSub('失敗の状態を解除する', 'Reset the failed state'),
      isolate: unitSub('指定したユニットだけを残して他を止める（ランレベルの切り替え）', 'Start the unit and stop the rest (like switching run levels)'),
      'set-default': unitSub('既定のターゲット（ランレベル）を設定する', 'Set the default target (run level)'),
      'get-default': cmd('既定のターゲット（ランレベル）を表示する', 'Show the default target (run level)'),
      poweroff: cmd('システムを停止して電源を切る', 'Shut down and power off the system'),
      reboot: cmd('システムを再起動する', 'Reboot the system'),
      halt: cmd('システムを停止する', 'Halt the system'),
      suspend: cmd('メモリに退避してサスペンドする', 'Suspend the system to RAM'),
      hibernate: cmd('ディスクに退避して休止状態にする', 'Hibernate the system to disk'),
      rescue: cmd('レスキューモード（シングルユーザー）に入る', 'Enter rescue (single-user) mode'),
      emergency: cmd('緊急モードに入る', 'Enter emergency mode'),
      kill: unitSub('ユニットのプロセスにシグナルを送る', 'Send a signal to the processes of a unit'),
      'try-restart': unitSub('動いているときだけ再起動する', 'Restart only if it is running'),
      'reload-or-restart': unitSub('再読み込みできれば再読み込み、できなければ再起動する', 'Reload if possible, otherwise restart'),
      'try-reload-or-restart': unitSub('動いているときだけ再読み込みか再起動をする', 'Reload or restart only if it is running'),
      reenable: unitSub('いったん無効にしてから有効にし直す', 'Disable and enable the unit again'),
      preset: unitSub('プリセットの設定に従って有効・無効にする', 'Enable or disable per the preset files'),
      link: cmd('ユニットファイルをリンクで追加する', 'Link a unit file into the search path'),
      revert: unitSub('上書きした設定を元に戻す', 'Revert the unit to its vendor version'),
      'daemon-reexec': cmd('systemd 自体を再実行する', 'Re-execute the systemd manager'),
      'is-system-running': cmd('システム全体の状態を表示する', 'Show the overall state of the system'),
      cancel: cmd('実行待ちのジョブをキャンセルする', 'Cancel a queued job'),
      'set-property': unitSub('ユニットのプロパティを実行中に変更する', 'Change a property of a running unit'),
      'show-environment': cmd('サービスマネージャーの環境変数を表示する', 'Show the environment of the service manager'),
      'add-wants': unitSub('ターゲットに `Wants=` の依存を追加する', 'Add a `Wants=` dependency to a target'),
      freeze: unitSub('ユニットのプロセスを凍結する', 'Freeze the processes of a unit'),
      thaw: unitSub('凍結を解除する', 'Thaw a frozen unit'),
      start: cmd('サービスを起動する', 'Start a service', [], { positional: [pos('サービス名', 'service name')] }),
      stop: cmd('サービスを停止する', 'Stop a service', [], { positional: [pos('サービス名', 'service name')] }),
      restart: cmd('サービスを再起動する', 'Restart a service', [], { positional: [pos('サービス名', 'service name')] }),
      reload: cmd('サービスに設定を読み直させる', 'Reload a service', [], { positional: [pos('サービス名', 'service name')] }),
      enable: cmd('起動時に自動で起動するようにする', 'Start a service at boot', [['--now', '今すぐ起動もする', 'also start it now']], { positional: [pos('サービス名', 'service name')] }),
      disable: cmd('起動時に自動で起動しないようにする', 'Do not start a service at boot', [['--now', '今すぐ停止もする', 'also stop it now']], { positional: [pos('サービス名', 'service name')] }),
      status: cmd('サービスの状態を表示する', "Show a service's status", [['--no-pager', 'ページャを使わない', 'do not use a pager']], { positional: [pos('サービス名', 'service name')] }),
      'is-active': cmd('サービスが動いているかを終了ステータスで返す', 'Exit 0 if the service is running', [['-q|--quiet', '何も表示しない', 'print nothing']], { positional: [pos('サービス名', 'service name')] }),
      'is-enabled': cmd('起動時に自動で起動するかを返す', 'Exit 0 if the service starts at boot', [['-q|--quiet', '何も表示しない', 'print nothing']], { positional: [pos('サービス名', 'service name')] }),
      'daemon-reload': cmd('ユニットファイルの変更を読み込む', 'Reload unit files after changes'),
      mask: cmd('サービスを起動できないようにする', 'Make a service impossible to start', [], { positional: [pos('サービス名', 'service name')] }),
      unmask: cmd('`mask` を解除する', 'Undo `mask`', [], { positional: [pos('サービス名', 'service name')] }),
    },
  }),
  mount: cmd('ファイルシステムをマウントする', 'Mount a file system', [
    ['-v|--verbose', '詳しく表示する', 'verbose'],
    ['-w|--rw|--read-write', '読み書きできるようにマウントする', 'mount read-write'],
    ['-n|--no-mtab', '`/etc/mtab` に書かない', 'do not write `/etc/mtab`'],
    ['-f|--fake', '実際にはマウントしない', 'dry run; do not call mount(2)'],
    ['-L|--label', 'ラベルでデバイスを指定する', 'mount the device with the given label', 'arg'],
    ['-U|--uuid', 'UUID でデバイスを指定する', 'mount the device with the given UUID', 'arg'],
    ['--move', 'マウント位置を移す', 'move a mounted tree to another place'],
    ['--rbind', '下位のマウントも含めてバインドする', 'bind including submounts'],
    ['-B', 'ディレクトリを別の場所にバインドする', 'bind a directory elsewhere'],
    ['-R', '下位のマウントも含めてバインドする', 'bind including submounts'],
    ['--make-private', 'マウントのイベントを共有しない', 'mark as private'],
    ['--make-shared', 'マウントのイベントを共有する', 'mark as shared'],
    ['--make-slave', 'マウントのイベントを受け取るだけにする', 'mark as slave'],
    ['-l|--show-labels', '一覧にラベルも表示', 'show labels in the list'],
    ['-s', '調整できないオプションを無視する', 'ignore unsupported options'],
    ['-T|--fstab', '読む fstab のファイル', 'alternative fstab file', 'arg'],
    ['-i|--internal-only', '`mount.<type>` ヘルパーを呼ばない', 'do not call the mount helpers'],
    ['-t|--types', 'ファイルシステムの種類', 'file system type', 'arg'], ['-o|--options', 'マウントオプション（`ro`、`bind`…）', 'mount options (`ro`, `bind`…)', 'arg'],
    ['--bind', 'ディレクトリを別の場所にも見せる', 'make a directory visible elsewhere'], ['--make-rshared', '配下のマウントを共有にする（コンテナ向け）', 'make mounts below shared (for containers)'],
    ['-a|--all', '`/etc/fstab` のすべてをマウントする', 'mount everything in `/etc/fstab`'], ['-r|--read-only', '読み取り専用', 'read-only'],
  ], { positional: [pos('デバイス', 'device'), pos('マウント先のディレクトリ', 'directory to mount on')], operands: [byCount(1, [pos('デバイスまたはマウント先（もう一方は `/etc/fstab` から探す）', 'device or mount point (the other is looked up in `/etc/fstab`)')], { unless: '-a|--all' })] }),
  mountpoint: cmd('ディレクトリがマウントポイントかを調べる', 'Check whether a directory is a mount point', [
    ['-d|--fs-devno', 'ファイルシステムのデバイス番号を表示', 'show the device number of the file system'],
    ['-x|--devno', 'ブロックデバイスの番号を表示', 'show the device number of a block device'],
    ['-q|--quiet', '何も表示せず終了ステータスで返す', 'print nothing; report via the exit status'],
  ], { positional: [pos('ディレクトリ', 'directory')] }),
  ldd: cmd('プログラムが使う共有ライブラリを表示する', 'Print the shared libraries a program uses', [
    ['-d|--data-relocs', 'データの再配置を行って未定義のシンボルを報告する', 'perform data relocations and report missing objects'],
    ['-r|--function-relocs', '関数の再配置を行って未定義のシンボルを報告する', 'perform function relocations and report missing objects'],
    ['-u|--unused', '使われていない直接の依存を表示', 'print unused direct dependencies'],
    ['--version', '版を表示する（glibc の版がわかる）', 'print the version (tells the glibc version)'], ['-v|--verbose', '詳しく表示する', 'more detail'],
  ], { positional: [pos('プログラム', 'program')] }),
  'locale-gen': cmd('ロケールのデータを作る', 'Generate locale data', [], { positional: [pos('ロケール（`en_US.UTF-8`…）', 'locale (`en_US.UTF-8`…)')] }),
  stty: cmd('端末の設定を表示・変更する', 'Show or change terminal settings', [
    ['-echo', '入力した文字を表示しない（パスワード入力向け）', 'do not echo typed characters (for passwords)'], ['-icanon', '行単位でなく1文字ずつ読む', 'read character by character, not by line'],
    ['-g|--save', '今の設定を、あとで戻せる形で表示する', 'print the settings in a form that can restore them'], ['-F|--file', '対象の端末デバイス', 'terminal device', 'arg'],
    ['-a|--all', 'すべての設定を人が読める形で表示する', 'print all current settings in a human-readable form'],
    ...GNU_INFO,
  ], { parser: 'getopt_long', positional: [pos('設定（`size`: 行数と桁数、`sane`: 既定に戻す、`raw`、`echo`…）', 'setting (`size`: rows and columns, `sane`: reset, `raw`, `echo`…)')] }),
  // The options in iproute2's order (ip.c): `-s` is `-stats`, `-b` is `-batch`, `-br` is `-brief`.
  ip: cmd('ネットワークの設定を表示・変更する（iproute2）', 'Show or change network configuration (iproute2)', [
    ['-l|-loops', 'アドレスをまとめて削除するとき、試す回数の上限', 'maximum number of attempts when flushing addresses', 'arg'],
    ['-f|-family', 'アドレスファミリ（`inet`、`inet6`、`link`）', 'protocol family (`inet`, `inet6`, `link`)', 'arg'],
    ['-4', 'IPv4 だけ', 'IPv4 only'], ['-6', 'IPv6 だけ', 'IPv6 only'], ['-0', 'リンク層だけ（`-f link` と同じ）', 'link layer only (same as `-f link`)'],
    ['-M', 'MPLS だけ', 'MPLS only'], ['-B', 'ブリッジだけ', 'bridge only'],
    ['-h|-human|-human-readable', '統計の数を単位付きの読みやすい形にする', 'print statistics in human-readable units'],
    ['-iec', '単位を 1024 の累乗にする（`Ki`、`Mi`）', 'use units in powers of 1024 (`Ki`, `Mi`)'],
    ['-s|-stats|-statistics', '統計も表示する（2回でさらに詳しく）', 'show statistics (twice for more)'],
    ['-d|-details', '詳細を表示する', 'show details'],
    ['-r|-resolve', '名前を引いて表示する', 'resolve addresses to names'],
    ['-o|-oneline', '1つの項目を1行で表示する', 'one record per line'],
    ['-t|-timestamp', '`monitor` で時刻も表示する', 'show the time in `monitor`'],
    ['-ts|-tshort', '`monitor` で時刻を短い形で表示する', 'show the time in short form in `monitor`'],
    ['-V|-Version', 'バージョンを表示する', 'print the version'],
    ['-force', '`-batch` でエラーがあっても続ける', 'go on after errors with `-batch`'],
    ['-b|-batch', 'コマンドを読むファイル（1行に1つ）', 'file to read commands from (one per line)', 'arg'],
    ['-rc|-rcvbuf', '受信バッファの大きさ', 'size of the receive buffer', 'arg'],
    ['-c|-color', '色を付ける', 'colorize the output'],
    ['-n|-netns', '操作するネットワーク名前空間', 'network namespace to use', 'arg'],
    ['-N|-Numeric', '名前でなく番号で表示する（プロトコルなど）', 'print numbers instead of names (protocols…)'],
    ['-a|-all', 'すべてのオブジェクトに実行する', 'execute for all objects'],
    ['-j|-json', 'JSON で出力', 'JSON output'],
    ['-p|-pretty', 'JSON を読みやすく整える', 'pretty-print the JSON'],
    ['-br|-brief', '簡潔な表形式', 'brief table'],
  ], { parser: 'iproute2', subcommandPrefixes: 'first', subcommands: IP_OBJECTS }),
  ss: cmd('ソケット（通信の接続や待ち受け）を表示する', 'Show sockets (connections and listeners)', [
    ['-s|--summary', '接続数の要約を表示', 'show a summary of socket counts'],
    ['-x|--unix', 'UNIX ドメインソケットだけ', 'UNIX domain sockets only'],
    ['-e|--extended', '詳しい情報も表示', 'show detailed socket information'],
    ['-o|--options', 'タイマーの情報も表示', 'show timer information'],
    ['-i|--info', 'TCP の内部情報を表示', 'show internal TCP information'],
    ['-m|--memory', 'ソケットのメモリ使用量を表示', 'show socket memory usage'],
    ['-4|--ipv4', 'IPv4 だけ', 'IPv4 only'],
    ['-6|--ipv6', 'IPv6 だけ', 'IPv6 only'],
    ['-w|--raw', 'RAW ソケットだけ', 'raw sockets only'],
    ['-H|--no-header', '見出しを表示しない', 'do not print the header'],
    ['-r|--resolve', 'アドレスとポートを名前で表示', 'resolve addresses and ports to names'],
    ['-Z|--context', 'SELinux のコンテキストも表示', 'show SELinux context'],
    ['-K|--kill', '該当するソケットを強制的に閉じる（注意）', 'forcibly close the sockets (careful)'],
    ['-f|--family', 'アドレスファミリで絞る', 'select the address family', 'arg'],
    ['-O|--oneline', '1つの接続を1行で表示', 'print each socket on one line'],
    ['-t|--tcp', 'TCP', 'TCP'], ['-u|--udp', 'UDP', 'UDP'], ['-l|--listening', '待ち受け中のものだけ', 'listening sockets only'],
    ['-n|--numeric', '名前に変換せず数字で表示', 'numeric addresses and ports'], ['-p|--processes', '使っているプロセスも表示', 'show the processes using them'], ['-a|--all', 'すべて', 'all sockets'],
  ]),

  // ---- Signatures, checksums and binary data ----
  gpg: cmd('GnuPG: 署名の検証・暗号化・鍵の管理', 'GnuPG: verify signatures, encrypt, manage keys', [
    ['--gen-key|--generate-key', '鍵ペアを作る', 'generate a key pair'],
    ['--full-generate-key', '鍵ペアを詳しい設定で作る', 'generate a key pair with all options'],
    ['-K|--list-secret-keys', '秘密鍵を一覧表示', 'list secret keys'],
    ['--list-sigs|--list-signatures', '署名も含めて鍵を一覧表示', 'list keys with signatures'],
    ['--check-sigs', '署名を検証しながら一覧表示', 'list keys and verify signatures'],
    ['--delete-keys', '公開鍵を削除', 'delete public keys'],
    ['--delete-secret-keys', '秘密鍵を削除', 'delete secret keys'],
    ['--delete-secret-and-public-key', '秘密鍵と公開鍵を削除', 'delete a secret and public key'],
    ['--edit-key', '鍵を対話的に編集する', 'edit a key interactively'],
    ['--send-keys', '公開鍵を鍵サーバーに送る', 'send public keys to a key server'],
    ['--search-keys', '鍵サーバーで鍵を探す', 'search a key server'],
    ['--refresh-keys', '鍵サーバーから鍵を更新する', 'refresh keys from a key server'],
    ['--export-secret-keys', '秘密鍵を書き出す（注意）', 'export secret keys (careful)'],
    ['--clearsign', '平文のまま署名を付ける', 'make a clear text signature'],
    ['-c|--symmetric', '共通鍵（パスフレーズ）で暗号化する', 'encrypt with a passphrase (symmetric)'],
    ['--gen-revoke', '失効証明書を作る', 'generate a revocation certificate'],
    ['--passphrase', 'パスフレーズ（履歴に残る。注意）', 'passphrase (kept in history; careful)', 'arg'],
    ['--passphrase-fd', 'パスフレーズを読むファイルディスクリプタ', 'file descriptor to read the passphrase from', 'arg'],
    ['--pinentry-mode', 'パスフレーズの入力方法（`loopback`）', 'how to ask for passphrases (`loopback`)', 'arg'],
    ['-u|--local-user', '署名に使う鍵', 'key to sign with', 'arg'],
    ['--default-key', '既定で署名に使う鍵', 'default key to sign with', 'arg'],
    ['--keyid-format', '鍵 ID の表示形式', 'key ID format', 'arg'],
    ['--with-colons', '機械が読みやすい出力にする', 'machine-readable output'],
    ['--list-packets', 'OpenPGP のパケットを表示', 'list the packets of a message'],
    ['--print-md', 'ダイジェストを出力する', 'print message digests', 'arg'],
    ['--enarmor', 'バイナリを ASCII アーマーにする', 'convert binary to ASCII armor'],
    ['--trust-model', '信頼モデル（`always`…）', 'trust model (`always`…)', 'arg'],
    ['--lock-never', 'ロックを使わない', 'do not use locks'],
    ['--batch', '対話せずに動く（スクリプト向け）', 'never ask (for scripts)'], ['--no-tty', '端末を使わない', 'do not use the terminal'], ['--yes', '確認に「はい」と答える', 'answer yes to questions'],
    ['--keyserver', '鍵を取得する鍵サーバー', 'key server to fetch keys from', 'arg'], ['--recv-keys|--receive-keys', '鍵サーバーから、続く ID の鍵を取得する', 'fetch the keys with the IDs that follow from the key server'],
    ['--verify', '署名を検証する（`gpg --verify 署名 ファイル`）', 'verify a signature (`gpg --verify sig file`)'], ['--dearmor', 'テキスト形式（ASCII armor）の鍵をバイナリに変換する（APT の鍵の定番）', 'convert an ASCII-armored key to binary (the usual step for APT keys)'],
    ['-a|--armor', 'テキスト形式で出力する', 'ASCII-armored output'], ['-o|--output', '出力するファイル', 'output file', 'arg'],
    ['--import', '鍵を取り込む', 'import keys'], ['--export', '鍵を書き出す', 'export keys'], ['--fingerprint', '鍵の指紋を表示する', 'show key fingerprints'],
    ['-k|--list-keys', '鍵を一覧表示する', 'list keys'], ['--no-default-keyring', '既定の鍵束を使わない', 'do not use the default keyring'], ['--keyring', '使う鍵束のファイル', 'keyring file to use', 'arg'],
    ['--homedir', 'GnuPG の設定ディレクトリ（既定は `~/.gnupg`）', 'GnuPG home directory (default `~/.gnupg`)', 'arg'], ['-d|--decrypt', '復号する', 'decrypt'],
    ['-e|--encrypt', '暗号化する', 'encrypt'], ['-r|--recipient', '暗号化の宛先', 'encrypt for the given recipient', 'arg'], ['-s|--sign', '署名する', 'sign'],
    ['-b|--detach-sign', '別ファイルの署名を作る', 'make a detached signature'], ['-q|--quiet', '表示を減らす', 'less output'],
  ], { positional: [pos('ファイルまたは鍵 ID', 'file or key ID')] }),
  gpgconf: cmd('GnuPG の部品を管理する', 'Manage GnuPG components', [
    ['--kill', '指定した部品（`gpg-agent`、`all`）を止める（一時ディレクトリを削除する前に）', 'stop the given component (`gpg-agent`, `all`; before deleting a temporary home)', 'arg'],
    ['--list-dirs', '使うディレクトリを表示する', 'list the directories used'], ['--reload', '指定した部品に設定を読み直させる', 'reload the given component', 'arg'],
  ]),
  openssl: cmd('OpenSSL: 暗号・証明書のツール', 'OpenSSL: cryptography and certificate tool', [], {
    subcommands: {
      enc: cmd('共通鍵で暗号化・復号する', 'Encrypt or decrypt with a symmetric cipher', [['-aes-256-cbc', 'AES-256 (CBC) を使う', 'use AES-256 (CBC)'], ['-d', '復号する', 'decrypt'], ['-a|-base64', 'Base64 で入出力する', 'use Base64'], ['-salt', 'ソルトを使う', 'use a salt'], ['-pbkdf2', '鍵導出に PBKDF2 を使う', 'use PBKDF2 for key derivation'], ['-in', '入力ファイル', 'input file', 'arg'], ['-out', '出力ファイル', 'output file', 'arg'], ['-k', 'パスワード', 'password', 'arg']], { parser: 'openssl' }),
      verify: cmd('証明書を検証する', 'Verify certificates', [['-CAfile', '信頼する CA 証明書のファイル', 'trusted CA certificates file', 'arg'], ['-untrusted', '中間証明書のファイル', 'intermediate certificates file', 'arg']], { parser: 'openssl' }),
      pkcs12: cmd('PKCS#12 ファイルを作る・読む', 'Create or read PKCS#12 files', [['-export', '作る', 'create a PKCS#12 file'], ['-in', '入力ファイル', 'input file', 'arg'], ['-out', '出力ファイル', 'output file', 'arg'], ['-inkey', '秘密鍵', 'private key file', 'arg'], ['-nodes', '秘密鍵を暗号化しない', 'do not encrypt private keys'], ['-nokeys', '鍵を出力しない', 'do not output private keys'], ['-clcerts', 'クライアント証明書だけ', 'client certificates only']], { parser: 'openssl' }),
      ca: cmd('簡易の認証局(CA)として証明書を発行する', 'Act as a simple certificate authority', [['-config', '設定ファイル', 'configuration file', 'arg'], ['-in', '署名要求(CSR)', 'certificate signing request', 'arg'], ['-out', '出力ファイル', 'output file', 'arg'], ['-days', '有効日数', 'validity in days', 'arg'], ['-batch', '質問しない', 'no prompts']], { parser: 'openssl' }),
      genpkey: cmd('秘密鍵を作る（汎用）', 'Generate a private key (generic)', [['-algorithm', '鍵のアルゴリズム（`RSA`、`EC`）', 'key algorithm (`RSA`, `EC`)', 'arg'], ['-out', '出力ファイル', 'output file', 'arg'], ['-pkeyopt', '鍵のオプション（`rsa_keygen_bits:4096`）', 'key option (`rsa_keygen_bits:4096`)', 'arg']], { parser: 'openssl' }),
      rsa: cmd('RSA 鍵を処理・変換する', 'Process and convert RSA keys', [['-in', '入力ファイル', 'input file', 'arg'], ['-out', '出力ファイル', 'output file', 'arg'], ['-pubout', '公開鍵を出力する', 'output the public key'], ['-text', '内容を文字で表示', 'print in text form'], ['-noout', '鍵そのものは出力しない', 'do not output the key']], { parser: 'openssl' }),
      ecparam: cmd('楕円曲線のパラメータや鍵を作る', 'Generate elliptic curve parameters or keys', [['-name', '曲線の名前（`prime256v1`）', 'curve name (`prime256v1`)', 'arg'], ['-genkey', '鍵を作る', 'generate a key'], ['-out', '出力ファイル', 'output file', 'arg']], { parser: 'openssl' }),
      passwd: cmd('パスワードのハッシュを作る', 'Compute password hashes', [['-6', 'SHA-512 (crypt) を使う', 'use SHA-512 crypt'], ['-5', 'SHA-256 (crypt) を使う', 'use SHA-256 crypt'], ['-1', 'MD5 (crypt) を使う', 'use MD5 crypt'], ['-apr1', 'Apache の MD5 形式を使う', 'use the Apache MD5 format'], ['-salt', 'ソルト', 'salt', 'arg'], ['-stdin', '標準入力から読む', 'read from stdin']], { parser: 'openssl' }),
      s_server: cmd('テスト用の TLS サーバーを動かす', 'Run a test TLS server', [['-accept', '待ち受けるポート', 'port to listen on', 'arg'], ['-cert', '証明書', 'certificate file', 'arg'], ['-key', '秘密鍵', 'private key file', 'arg'], ['-www', '状態のページを返す', 'serve a status page']], { parser: 'openssl' }),
      crl: cmd('証明書失効リスト(CRL)を処理する', 'Process certificate revocation lists (CRLs)', [['-in', '入力ファイル', 'input file', 'arg'], ['-text', '内容を文字で表示', 'print in text form'], ['-noout', 'CRL そのものは出力しない', 'do not output the CRL']], { parser: 'openssl' }),
      ciphers: cmd('使える暗号スイートを一覧表示する', 'List the available cipher suites', [['-v', '詳しく表示する', 'verbose']], { parser: 'openssl' }),
      list: cmd('使えるアルゴリズムなどを一覧表示する', 'List algorithms and commands'),
      pkey: cmd('公開鍵・秘密鍵を処理・変換する', 'Process and convert public and private keys', [['-in', '入力ファイル', 'input file', 'arg'], ['-pubout', '公開鍵を出力する', 'output the public key'], ['-text', '内容を文字で表示', 'print in text form'], ['-noout', '鍵そのものは出力しない', 'do not output the key']], { parser: 'openssl' }),
      rand: cmd('ランダムなバイト列を作る（パスワードや鍵の生成）', 'Generate random bytes (passwords, keys)', [
        ['-base64', 'Base64 で出力', 'Base64 output'], ['-hex', '16進数で出力', 'hex output'], ['-out', '出力するファイル', 'output file', 'arg'],
      ], { positional: [pos('バイト数', 'number of bytes')], parser: 'openssl' }),
      x509: cmd('証明書を表示・変換する', 'Show or convert certificates', [
        ['-in', '入力ファイル', 'input file', 'arg'], ['-out', '出力ファイル', 'output file', 'arg'], ['-noout', '証明書そのものは出力しない', 'do not print the certificate itself'],
        ['-text', '内容を読める形で表示', 'print the contents as text'], ['-enddate', '有効期限を表示', 'print the expiry date'], ['-subject', 'サブジェクトを表示', 'print the subject'],
        ['-fingerprint', '指紋を表示', 'print the fingerprint'], ['-checkend', '指定した秒数以内に期限切れなら失敗する', 'fail if it expires within the given number of seconds', 'arg'],
      ], { parser: 'openssl' }),
      req: cmd('証明書署名要求（CSR）や自己署名証明書を作る', 'Create certificate requests (CSR) or self-signed certificates', [
        ['-new', '新しい要求を作る', 'new request'], ['-x509', '要求の代わりに自己署名証明書を作る', 'make a self-signed certificate instead'], ['-nodes|-noenc', '秘密鍵を暗号化しない', 'do not encrypt the private key'],
        ['-newkey', '新しい鍵も作る（`rsa:2048`…）', 'also make a new key (`rsa:2048`…)', 'arg'], ['-keyout', '秘密鍵の出力先', 'where to write the private key', 'arg'],
        ['-out', '出力ファイル', 'output file', 'arg'], ['-days', '有効日数', 'days of validity', 'arg'], ['-subj', 'サブジェクト（`/CN=example.com`）', 'subject (`/CN=example.com`)', 'arg'],
      ], { parser: 'openssl' }),
      s_client: cmd('TLS でサーバーにつないで証明書などを確かめる', 'Connect to a server over TLS to inspect it', [
        ['-connect', '接続先（`ホスト:ポート`）', 'where to connect (`host:port`)', 'arg'], ['-servername', 'SNI で名乗るホスト名', 'host name to send in SNI', 'arg'], ['-showcerts', '証明書チェーンをすべて表示', 'show the whole chain'],
      ], { parser: 'openssl' }),
      dgst: cmd('ハッシュ値の計算や署名の検証をする', 'Hash, sign or verify', [
        ['-sha256', 'SHA-256', 'SHA-256'], ['-verify', '指定した公開鍵で署名を検証する', 'verify with the given public key', 'arg'], ['-signature', '署名のファイル', 'signature file', 'arg'], ['-sign', '指定した秘密鍵で署名する', 'sign with the given private key', 'arg'],
      ], { positional: [files], parser: 'openssl' }),
      genrsa: cmd('RSA の秘密鍵を作る', 'Generate an RSA private key', [['-out', '出力ファイル', 'output file', 'arg']], { positional: [pos('鍵の長さ（ビット）', 'key size in bits')], parser: 'openssl' }),
      version: cmd('OpenSSL の版を表示する', 'Print the OpenSSL version'),
    },
  }),
  shasum: cmd('SHA のハッシュ値（チェックサム）を計算する（macOS にもある）', 'Compute SHA checksums (also on macOS)', [
    ['-a|--algorithm', '方式（`1`、`256`、`512`…。既定は 1）', 'algorithm (`1`, `256`, `512`…; default 1)', 'arg'],
    ['-c|--check', 'ハッシュ値の一覧ファイルと照合する', 'verify against a checksum list'], ['-b|--binary', 'バイナリモードで読む', 'read in binary mode'],
  ], { positional: [files] }),
  sha1sum: checksum('SHA-1'),
  sha224sum: checksum('SHA-224'),
  sha384sum: checksum('SHA-384'),
  sha512sum: checksum('SHA-512'),
  cmp: cmd('2つのファイルをバイト単位で比べる', 'Compare two files byte by byte', [
    ['-s|--silent|--quiet', '何も表示せず終了ステータスで返す（同じなら 0）', 'print nothing; exit 0 if the same'], ['-l|--verbose', '違うバイトをすべて表示', 'list every differing byte'], ['-n|--bytes', '先頭から指定したバイト数だけ比べる', 'compare at most the given number of bytes', 'arg'],
    ['-b|--print-bytes', '違うバイトも表示する', 'print the differing bytes'],
    ['-c|--print-chars', '違うバイトを文字でも表示する', 'print the differing bytes as characters'],
    ['-i|--ignore-initial', '先頭の指定したバイト数を読み飛ばす（`SKIP1:SKIP2` で別々に）', 'skip the first bytes (`SKIP1:SKIP2` for each file)', 'arg'],
    ['--help', 'ヘルプを表示する', 'show help'],
    ['-v|--version', 'バージョンを表示する', 'print the version'],
  ], { parser: 'getopt_long', positional: [pos('1 つ目のファイル（`-` で標準入力）', 'first file (`-` for stdin)'), pos('2 つ目のファイル', 'second file'), pos('1 つ目のファイルで読み飛ばすバイト数', 'bytes to skip in the first file'), pos('2 つ目のファイルで読み飛ばすバイト数', 'bytes to skip in the second file')] }),
  xxd: cmd('16進ダンプを作る・元に戻す', 'Make a hex dump, or reverse one', [
    ['-r|-revert', '16進ダンプをバイナリに戻す', 'turn a hex dump back into binary'], ['-p|-ps|-plain', '区切りのない16進数だけで出力', 'plain hex, no offsets or text'],
    ['-c|-cols', '1行のバイト数', 'bytes per line', 'arg'], ['-l|-len', '指定したバイト数だけ', 'stop after the given number of bytes', 'arg'], ['-s|-seek', '指定した位置から', 'start at the given offset', 'arg'], ['-i|-include', 'C の配列として出力', 'output as a C array'],
  ], { positional: [files], parser: 'single-dash' }),
  od: cmd('ファイルを8進数・16進数などでダンプする', 'Dump files in octal, hex and other formats', [
    ['-b', '8 進数のバイトで表示', 'octal bytes'],
    ['-d', '10 進数の 2 バイト単位で表示', 'unsigned decimal 2-byte units'],
    ['-o', '8 進数の 2 バイト単位で表示', 'octal 2-byte units'],
    ['-a', '名前付きの文字で表示', 'named characters'],
    ['-f', '単精度の浮動小数点数で表示', 'floating point'],
    ['-i', '10 進数の整数で表示', 'decimal integers'],
    ['-A|--address-radix', '位置の表示形式（`n` で表示しない、`x` 16進…）', 'offset format (`n`: none, `x`: hex…)', 'arg'],
    ['-t|--format', '出力形式（`x1`: 1バイトずつ16進、`c`: 文字…）', 'output format (`x1`: hex bytes, `c`: characters…)', 'arg'],
    ['-v|--output-duplicates', '同じ行の繰り返しを省略しない', 'do not collapse repeated lines'], ['-c', '文字で表示（`-t c` と同じ）', 'characters (same as `-t c`)'],
    ['-x', '2バイトずつ16進で表示', 'hex, two bytes at a time'], ['-N|--read-bytes', '指定したバイト数だけ', 'read only the given number of bytes', 'arg'], ['-j|--skip-bytes', '先頭から指定したバイト数を飛ばす', 'skip the given number of bytes first', 'arg'],
    ['--endian', '指定したバイト順に入れ替える（`big` か `little`）', 'swap the input bytes to the given byte order (`big` or `little`)', 'arg'],
    ['-S', 'NUL で終わる文字列だけ表示する（最小の長さを指定）', 'show only NUL-terminated strings of at least the given length', 'arg'],
    ['--strings', '`-S` と同じ（長さは `--strings=長さ`）', 'like `-S` (the length is `--strings=LEN`)', 'attached'],
    ['-w|--width', '1 行に出力するバイト数（省略時は 32）', 'bytes per output line (32 if no value)', 'attached'],
    ['--traditional', '3 つ目の古い形式（`ファイル 位置 ラベル`）の引数を受け付ける', 'accept the old third form of arguments (`FILE OFFSET LABEL`)'],
    ...GNU_INFO,
  ], { parser: 'getopt_long', positional: [files] }),
  hexdump: cmd('ファイルを16進数でダンプする', 'Dump files in hex', [
    ['-C', '16進数と文字を並べた定番の形式', 'canonical hex + ASCII display'], ['-v', '同じ行の繰り返しを省略しない', 'do not collapse repeated lines'],
    ['-e', '出力の書式', 'output format string', 'arg'], ['-n', '指定したバイト数だけ', 'only the given number of bytes', 'arg'], ['-s', '先頭から指定したバイト数を飛ばす', 'skip the given number of bytes first', 'arg'],
  ], { positional: [files] }),
  readelf: cmd('ELF 形式の実行ファイルの中身を表示する', 'Show the contents of ELF binaries', [
    ['-h|--file-header', 'ファイルヘッダー', 'file header'], ['-l|--program-headers', 'プログラムヘッダー', 'program headers'], ['-S|--section-headers', 'セクションヘッダー', 'section headers'],
    ['-s|--syms|--symbols', 'シンボル表', 'symbol table'], ['-d|--dynamic', '動的セクション（必要な共有ライブラリなど）', 'dynamic section (needed libraries…)'], ['-W|--wide', '長い行を折り返さない', 'do not wrap long lines'],
    ['-n|--notes', 'ノートセクション', 'note sections'],
  ], { positional: [pos('実行ファイル', 'binary')] }),
  iconv: cmd('文字コードを変換する', 'Convert text between character encodings', [
    ['-f|--from-code', '元の文字コード（`SHIFT_JIS`…）', 'source encoding (`SHIFT_JIS`…)', 'arg'], ['-t|--to-code', '変換後の文字コード（`UTF-8`…。`//TRANSLIT` で近い文字に置換）', 'target encoding (`UTF-8`…; `//TRANSLIT` substitutes)', 'arg'],
    ['-c', '変換できない文字を捨てる', 'drop characters that cannot be converted'], ['-l|--list', '使える文字コードを一覧表示', 'list encodings'],
  ], { positional: [files] }),

  // ---- Compression ----
  xz: compressor('xz 形式で圧縮・展開する（高い圧縮率）', 'Compress or decompress xz files (high ratio)', '.xz', [['-T|--threads', '使うスレッド数（`0` で CPU 数）', 'threads to use (`0`: one per CPU)', 'arg'], ['-z|--compress', '圧縮する', 'compress']]),
  unxz: compressor('xz 形式を展開する', 'Decompress xz files', '.xz'),
  xzcat: decompressToStdout('xz 形式を展開して標準出力に出す', 'Decompress xz files to stdout'),
  zstd: compressor('zstd 形式で圧縮・展開する（速くて圧縮率も高い）', 'Compress or decompress zstd files (fast, good ratio)', '.zst', [
    ['-T|--threads', '使うスレッド数（`-T0` で CPU 数）', 'threads to use (`-T0`: one per CPU)', 'arg'], ['-o', '出力するファイル', 'output file', 'arg'], ['--rm', '成功したら元のファイルを削除する', 'remove the input on success'],
  ]),
  unzstd: compressor('zstd 形式を展開する', 'Decompress zstd files', '.zst'),
  zstdcat: decompressToStdout('zstd 形式を展開して標準出力に出す', 'Decompress zstd files to stdout'),
  bzip2: compressor('bzip2 形式で圧縮・展開する', 'Compress or decompress bzip2 files', '.bz2'),
  bunzip2: compressor('bzip2 形式を展開する', 'Decompress bzip2 files', '.bz2'),
  bzcat: decompressToStdout('bzip2 形式を展開して標準出力に出す', 'Decompress bzip2 files to stdout'),
  zcat: decompressToStdout('gzip 形式を展開して標準出力に出す', 'Decompress gzip files to stdout', true),
  patch: cmd('差分（diff）をファイルに当てる', 'Apply a diff to files', [
    ['-p|--strip', 'パスの先頭から指定した数の階層を取り除く（`-p1` で `a/` `b/` を除く。git の差分の定番）', 'strip the given number of leading path parts (`-p1` drops `a/` and `b/`, as git diffs need)', 'arg'],
    ['-i|--input', '差分のファイル（省略時は標準入力）', 'diff file (default: stdin)', 'arg'], ['-R|--reverse', '逆向きに当てる（元に戻す）', 'apply in reverse (undo)'],
    ['-N|--forward', 'すでに当たっている差分は無視する', 'skip patches that seem applied'], ['--dry-run', '実際には変更せず、当たるかを確かめる', 'check without changing files'],
    ['-s|--silent|--quiet', '表示を減らす', 'less output'], ['-b|--backup', '元のファイルのバックアップを残す', 'keep backups of the originals'],
  ], { positional: [pos('対象のファイル', 'file to patch'), pos('差分のファイル', 'diff file')] }),
  expr: cmd('式を評価して結果を出力する（古い書き方。今は `$(( ))` や `[[ =~ ]]`）', 'Evaluate an expression and print the result (old style; today `$(( ))` or `[[ =~ ]]`)', [], {
    positional: [pos('式（各語は別の引数: `$a + 1`、`文字列 : 正規表現`、`length 文字列`…）', 'expression (one word per argument: `$a + 1`, `string : regex`, `length string`…)')],
  }),

  // ---- macOS and Windows helpers ----
  osascript: cmd('AppleScript（または JavaScript）を実行する（macOS）', 'Run AppleScript or JavaScript (macOS)', [
    ['-e', '実行するスクリプトの1行', 'one line of script to run', 'arg'], ['-l', '言語（`AppleScript`、`JavaScript`）', 'language (`AppleScript`, `JavaScript`)', 'arg'],
  ], { positional: [pos('スクリプトのファイル', 'script file')] }),
  'xcode-select': cmd('使う Xcode（コマンドラインツール）を選ぶ（macOS）', 'Choose the active Xcode or Command Line Tools (macOS)', [
    ['-p|--print-path', '使っている開発ツールの場所を表示（入っているかの確認にも）', 'print the active developer directory (also checks they are installed)'],
    ['--install', 'コマンドラインツールを入れる', 'install the Command Line Tools'], ['-s|--switch', '使う開発ツールを切り替える', 'switch the active developer directory', 'arg'],
  ]),
  xcrun: cmd('Xcode の開発ツールを探して実行する（macOS）', 'Find and run Xcode developer tools (macOS)', [
    ['--sdk', '使う SDK（`macosx`、`iphoneos`…）', 'SDK to use (`macosx`, `iphoneos`…)', 'arg'], ['-f|--find', 'ツールの場所だけを表示', 'print the tool path only', 'arg'],
  ], { positional: [pos('実行するツール', 'tool to run')] }),
  otool: cmd('Mach-O 形式の実行ファイルの中身を表示する（macOS）', 'Show the contents of Mach-O binaries (macOS)', [
    ['-L', '使う共有ライブラリ', 'shared libraries used'], ['-l', 'ロードコマンド', 'load commands'], ['-h', 'ヘッダー', 'header'],
  ], { positional: [pos('実行ファイル', 'binary')] }),
  cygpath: cmd('Windows と Unix のパスを変換する（Cygwin / MSYS2 / Git Bash）', 'Convert between Windows and Unix paths (Cygwin, MSYS2, Git Bash)', [
    ['-w|--windows', 'Windows 形式（`C:\\…`）に', 'to Windows form (`C:\\…`)'], ['-u|--unix', 'Unix 形式（`/c/…`）に', 'to Unix form (`/c/…`)'],
    ['-m|--mixed', '`C:/…` の形に', 'to mixed form (`C:/…`)'], ['-a|--absolute', '絶対パスにする', 'absolute path'],
  ], { positional: [pos('パス', 'path')] }),

  // ---- Linters and downloaders ----
  shellcheck: cmd('シェルスクリプトの静的解析（リンター）', 'Static analysis (lint) for shell scripts', [
    ['-x|--external-sources', '`source` されるファイルも追う', 'follow `source`d files'], ['-s|--shell', 'シェルの種類（`sh`、`bash`…）', 'shell dialect (`sh`, `bash`…)', 'arg'],
    ['-e|--exclude', '無視する警告（`SC2086` など）', 'warnings to ignore (`SC2086`…)', 'arg'], ['-S|--severity', '指定した重さ以上だけ（`error`、`warning`、`info`、`style`）', 'minimum severity (`error`, `warning`, `info`, `style`)', 'arg'],
    ['-f|--format', '出力形式（`gcc`、`json`、`diff`…）', 'output format (`gcc`, `json`, `diff`…)', 'arg'], ['-V|--version', '版を表示する', 'print the version'], ['-a|--check-sourced', '`source` されるファイルの警告も出す', 'also report on sourced files'],
  ], { positional: [files] }),
  shfmt: cmd('シェルスクリプトを整形する', 'Format shell scripts', [
    ['-i', 'インデントの幅（`0` でタブ）', 'indent width (`0`: tabs)', 'arg'], ['-w', 'ファイルを直接書き換える', 'rewrite files in place'], ['-l', '整形が必要なファイル名だけを表示', 'list files that need formatting'],
    ['-d', '差分を表示（整形が必要なら失敗。CI 向け）', 'show diffs (fail if formatting is needed; for CI)'], ['-s', 'コードを簡略化する', 'simplify code'],
    ['-ci', '`case` の中身もインデントする', 'indent `case` bodies'], ['-bn', '`&&` や `|` を行頭に置く', 'put `&&` and `|` at line starts'],
    ['-ln|--language-dialect', 'シェルの種類（`bash`、`posix`、`mksh`）', 'dialect (`bash`, `posix`, `mksh`)', 'arg'],
  ], { positional: [files], parser: 'single-dash' }),
  aria2c: cmd('高速なダウンローダー（複数接続）', 'Fast downloader (several connections)', [
    ['-x|--max-connection-per-server', 'サーバーあたりの最大接続数', 'connections per server', 'arg'], ['-s|--split', '分割数', 'number of pieces', 'arg'],
    ['-o|--out', '保存するファイル名', 'output file name', 'arg'], ['-d|--dir', '保存するディレクトリ', 'output directory', 'arg'], ['-c|--continue', '途中から再開する', 'resume'], ['-q|--quiet', '表示しない', 'no output'],
  ], { positional: [pos('URL', 'URL')] }),
  scanelf: cmd('ELF 形式の実行ファイルを調べる（Alpine の Docker イメージで依存ライブラリを探す定番）', 'Scan ELF binaries (used in Alpine images to find needed libraries)', [
    ['--needed|-n', '必要な共有ライブラリを表示', 'print needed libraries'], ['--nobanner|-B', '見出しを出さない', 'no header'],
    ['--format|-F', '出力形式（`%n#p`…）', 'output format (`%n#p`…)', 'arg'], ['--recursive|-R', 'ディレクトリを再帰的に調べる', 'scan directories recursively'],
  ], { positional: [pos('ファイルまたはディレクトリ', 'file or directory')] }),
};
