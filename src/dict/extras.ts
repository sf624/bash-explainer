import type { CommandSpec } from '../argv/spec';
import { cmd, mergeOptions, optionOf, pos } from './types';
import { extraFiles } from './extrasFiles';
import { extraAdmin } from './extrasAdmin';

// Options and subcommands that the LPIC and LinuC objectives (and everyday administration) use
// and that the first entries of older commands did not list. They are merged into the entries
// that exist; an option or subcommand written in the main entry is never replaced.

const unit = pos('ユニット名（`nginx.service`…）', 'unit name (`nginx.service`…)');
const pkg = pos('パッケージ名', 'package name');
const unitSub = (ja: string, en: string): CommandSpec => cmd(ja, en, [], { positional: [unit] });
const pkgSub = (ja: string, en: string): CommandSpec => cmd(ja, en, [], { positional: [pkg] });

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

const containerExtra = (): Record<string, CommandSpec> => ({
  stats: cmd('コンテナの資源の使用状況を表示する', 'Show live resource usage of containers', [['--no-stream', '1回だけ表示して終わる', 'print once and exit']]),
  create: cmd('コンテナを作る（起動はしない）', 'Create a container without starting it', [['--name', 'コンテナ名', 'container name', 'arg']]),
  restart: cmd('コンテナを再起動する', 'Restart containers', [['-t|--time', '停止を待つ秒数', 'seconds to wait before killing', 'arg']]),
  start: cmd('止まっているコンテナを起動する', 'Start stopped containers', [['-a|--attach', '出力につなぐ', 'attach output'], ['-i|--interactive', '標準入力につなぐ', 'attach stdin']]),
  rmi: cmd('イメージを削除する', 'Remove images', [['-f|--force', '強制的に削除', 'force removal']]),
  kill: cmd('コンテナにシグナルを送って強制終了する', 'Kill containers by signal', [['-s|--signal', '送るシグナル', 'signal to send', 'arg']]),
});

export const extraSubcommands: Record<string, Record<string, CommandSpec>> = {
  systemctl: {
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
  },
  'apt-get': {
    'build-dep': pkgSub('ソースからビルドするのに必要なパッケージを入れる', 'Install the packages needed to build a source package'),
    source: pkgSub('ソースパッケージを取得する', 'Fetch a source package'),
    check: cmd('壊れた依存関係がないか確かめる', 'Check for broken dependencies'),
    changelog: pkgSub('パッケージの変更履歴を表示する', 'Show the package changelog'),
  },
  apt: {
    'edit-sources': cmd('パッケージの取得元の設定を編集する', 'Edit the package sources list'),
    depends: pkgSub('依存しているパッケージを表示する', 'Show the dependencies'),
    rdepends: pkgSub('これに依存しているパッケージを表示する', 'Show reverse dependencies'),
    policy: pkgSub('入れられる版と優先度を表示する', 'Show available versions and priorities'),
    reinstall: pkgSub('パッケージを入れ直す', 'Reinstall packages'),
  },
  yum: {
    ...dnfLike(),
    localinstall: pkgSub('ローカルの RPM ファイルを入れる', 'Install a local RPM file'),
    deplist: pkgSub('依存関係を一覧表示する', 'List dependencies'),
  },
  dnf: {
    ...dnfLike(),
    repoquery: pkgSub('リポジトリのパッケージ情報を問い合わせる', 'Query repository package information'),
    module: cmd('モジュール（ストリーム）を扱う（`list`、`enable`、`install`）', 'Handle modules and streams (`list`, `enable`, `install`)'),
    'config-manager': cmd('リポジトリの設定を表示・変更する', 'Show or change repository settings'),
    download: pkgSub('RPM をダウンロードだけする', 'Download RPMs without installing'),
    mark: cmd('パッケージに印を付ける（`install`、`remove`）', 'Mark packages (`install`, `remove`)'),
    swap: cmd('あるパッケージを別のものに置き換える', 'Swap one package for another'),
  },
  hostnamectl: {
    'set-icon-name': cmd('アイコン名を設定する', 'Set the icon name'),
    'set-chassis': cmd('筐体の種類（`desktop`、`laptop`、`server`、`vm`）を設定する', 'Set the chassis type (`desktop`, `laptop`, `server`, `vm`)'),
    'set-deployment': cmd('環境の種類（`production` など）を設定する', 'Set the deployment environment (`production` and so on)'),
    'set-location': cmd('設置場所を設定する', 'Set the location'),
  },
  timedatectl: {
    show: cmd('設定をプロパティの形で表示する', 'Show the settings as properties'),
    'timesync-status': cmd('時刻同期(systemd-timesyncd)の状態を表示する', 'Show the state of time synchronization (systemd-timesyncd)'),
    'show-timesync': cmd('時刻同期の設定をプロパティの形で表示する', 'Show timesync settings as properties'),
    'set-time': cmd('システム時刻を設定する', 'Set the system time'),
    'set-local-rtc': cmd('ハードウェアクロックをローカル時刻とするか決める（`0` / `1`）', 'Set whether the RTC is in local time (`0` / `1`)'),
  },
  docker: {
    ...containerExtra(),
    pause: cmd('コンテナのプロセスを一時停止する', 'Pause the processes of containers'),
    unpause: cmd('一時停止を解除する', 'Unpause containers'),
    attach: cmd('実行中のコンテナの入出力につなぐ', 'Attach to the input and output of a running container'),
    import: cmd('tar のファイルからイメージを作る', 'Create an image from a tarball'),
    commit: cmd('コンテナの変更から新しいイメージを作る', 'Create an image from the changes of a container', [['-m|--message', 'コミットメッセージ', 'commit message', 'arg'], ['-a|--author', '作者', 'author', 'arg']]),
    top: cmd('コンテナの中のプロセスを表示する', 'Show the processes of a container'),
    history: cmd('イメージの作成履歴（レイヤー）を表示する', 'Show the history (layers) of an image'),
    port: cmd('コンテナのポートの対応を表示する', 'Show the port mappings of a container'),
    rename: cmd('コンテナの名前を変える', 'Rename a container'),
    diff: cmd('コンテナのファイルシステムの変更を表示する', 'Show changes to the container file system'),
    search: cmd('Docker Hub のイメージを検索する', 'Search Docker Hub for images'),
    info: cmd('Docker の環境の情報を表示する', 'Show system-wide information'),
    version: cmd('Docker のバージョンを表示する', 'Show the Docker version'),
    events: cmd('サーバーのイベントをリアルタイムで表示する', 'Stream events from the server'),
  },
  podman: {
    ...containerExtra(),
    pod: cmd('Pod（コンテナの集まり）を扱う', 'Handle pods (groups of containers)'),
    generate: cmd('systemd のユニットや Kubernetes のマニフェストを生成する', 'Generate systemd units or Kubernetes manifests'),
  },
  openssl: {
    enc: cmd('共通鍵で暗号化・復号する', 'Encrypt or decrypt with a symmetric cipher', [['-aes-256-cbc', 'AES-256 (CBC) を使う', 'use AES-256 (CBC)'], ['-d', '復号する', 'decrypt'], ['-a|-base64', 'Base64 で入出力する', 'use Base64'], ['-salt', 'ソルトを使う', 'use a salt'], ['-pbkdf2', '鍵導出に PBKDF2 を使う', 'use PBKDF2 for key derivation'], ['-in', '入力ファイル', 'input file', 'arg'], ['-out', '出力ファイル', 'output file', 'arg'], ['-k', 'パスワード', 'password', 'arg']], { style: 'single-dash' }),
    verify: cmd('証明書を検証する', 'Verify certificates', [['-CAfile', '信頼する CA 証明書のファイル', 'trusted CA certificates file', 'arg'], ['-untrusted', '中間証明書のファイル', 'intermediate certificates file', 'arg']], { style: 'single-dash' }),
    pkcs12: cmd('PKCS#12 ファイルを作る・読む', 'Create or read PKCS#12 files', [['-export', '作る', 'create a PKCS#12 file'], ['-in', '入力ファイル', 'input file', 'arg'], ['-out', '出力ファイル', 'output file', 'arg'], ['-inkey', '秘密鍵', 'private key file', 'arg'], ['-nodes', '秘密鍵を暗号化しない', 'do not encrypt private keys'], ['-nokeys', '鍵を出力しない', 'do not output private keys'], ['-clcerts', 'クライアント証明書だけ', 'client certificates only']], { style: 'single-dash' }),
    ca: cmd('簡易の認証局(CA)として証明書を発行する', 'Act as a simple certificate authority', [['-config', '設定ファイル', 'configuration file', 'arg'], ['-in', '署名要求(CSR)', 'certificate signing request', 'arg'], ['-out', '出力ファイル', 'output file', 'arg'], ['-days', '有効日数', 'validity in days', 'arg'], ['-batch', '質問しない', 'no prompts']], { style: 'single-dash' }),
    genpkey: cmd('秘密鍵を作る（汎用）', 'Generate a private key (generic)', [['-algorithm', '鍵のアルゴリズム（`RSA`、`EC`）', 'key algorithm (`RSA`, `EC`)', 'arg'], ['-out', '出力ファイル', 'output file', 'arg'], ['-pkeyopt', '鍵のオプション（`rsa_keygen_bits:4096`）', 'key option (`rsa_keygen_bits:4096`)', 'arg']], { style: 'single-dash' }),
    rsa: cmd('RSA 鍵を処理・変換する', 'Process and convert RSA keys', [['-in', '入力ファイル', 'input file', 'arg'], ['-out', '出力ファイル', 'output file', 'arg'], ['-pubout', '公開鍵を出力する', 'output the public key'], ['-text', '内容を文字で表示', 'print in text form'], ['-noout', '鍵そのものは出力しない', 'do not output the key']], { style: 'single-dash' }),
    ecparam: cmd('楕円曲線のパラメータや鍵を作る', 'Generate elliptic curve parameters or keys', [['-name', '曲線の名前（`prime256v1`）', 'curve name (`prime256v1`)', 'arg'], ['-genkey', '鍵を作る', 'generate a key'], ['-out', '出力ファイル', 'output file', 'arg']], { style: 'single-dash' }),
    passwd: cmd('パスワードのハッシュを作る', 'Compute password hashes', [['-6', 'SHA-512 (crypt) を使う', 'use SHA-512 crypt'], ['-5', 'SHA-256 (crypt) を使う', 'use SHA-256 crypt'], ['-1', 'MD5 (crypt) を使う', 'use MD5 crypt'], ['-apr1', 'Apache の MD5 形式を使う', 'use the Apache MD5 format'], ['-salt', 'ソルト', 'salt', 'arg'], ['-stdin', '標準入力から読む', 'read from stdin']], { style: 'single-dash' }),
    s_server: cmd('テスト用の TLS サーバーを動かす', 'Run a test TLS server', [['-accept', '待ち受けるポート', 'port to listen on', 'arg'], ['-cert', '証明書', 'certificate file', 'arg'], ['-key', '秘密鍵', 'private key file', 'arg'], ['-www', '状態のページを返す', 'serve a status page']], { style: 'single-dash' }),
    crl: cmd('証明書失効リスト(CRL)を処理する', 'Process certificate revocation lists (CRLs)', [['-in', '入力ファイル', 'input file', 'arg'], ['-text', '内容を文字で表示', 'print in text form'], ['-noout', 'CRL そのものは出力しない', 'do not output the CRL']], { style: 'single-dash' }),
    ciphers: cmd('使える暗号スイートを一覧表示する', 'List the available cipher suites', [['-v', '詳しく表示する', 'verbose']], { style: 'single-dash' }),
    list: cmd('使えるアルゴリズムなどを一覧表示する', 'List algorithms and commands'),
    pkey: cmd('公開鍵・秘密鍵を処理・変換する', 'Process and convert public and private keys', [['-in', '入力ファイル', 'input file', 'arg'], ['-pubout', '公開鍵を出力する', 'output the public key'], ['-text', '内容を文字で表示', 'print in text form'], ['-noout', '鍵そのものは出力しない', 'do not output the key']], { style: 'single-dash' }),
  },
  ip: {
    rule: cmd('ルーティングポリシーのルールを扱う', 'Handle routing policy rules'),
    tunnel: cmd('IP トンネルを扱う', 'Handle IP tunnels'),
    maddr: cmd('マルチキャストアドレスを扱う', 'Handle multicast addresses'),
    monitor: cmd('ネットワークの変化を見張る', 'Watch for network changes'),
    netns: cmd('ネットワーク名前空間を扱う（`add`、`exec`、`list`、`delete`）', 'Handle network namespaces (`add`, `exec`, `list`, `delete`)'),
    xfrm: cmd('IPsec の設定を扱う', 'Handle IPsec policies and states'),
    mroute: cmd('マルチキャストのルーティングを表示する', 'Show multicast routing'),
    vrf: cmd('VRF（仮想ルーティング）を扱う', 'Handle VRFs (virtual routing)'),
  },
};

/** Merge the extra options and subcommands into the entries of `commands`. What the main entry already has is kept. */
export function applyExtras(commands: Record<string, CommandSpec>): void {
  for (const [key, opts] of Object.entries({ ...extraFiles, ...extraAdmin })) {
    const spec = commands[key];
    // (`cmd` gives every entry a list of options.)
    spec.options = mergeOptions(opts.map(optionOf), spec.options!);
  }
  for (const [key, subs] of Object.entries(extraSubcommands)) {
    const spec = commands[key];
    spec.subcommands = { ...subs, ...spec.subcommands };
  }
}
