import type { CommandSpec } from '../argv/spec';
import { tx } from '../i18n';
import { cmd, OptSpec, pos } from './types';

// Network tools and server administration from the LPIC-1/2 and LinuC-1/2 objectives: interface
// and name configuration, diagnostics, packet capture, firewalls, DNS, web, Samba and VPN servers.

/** `ssh -o Name=value`: the settings of ssh_config(5) that change how the host is checked. */
const NO_HOST_CHECK = tx('ホスト鍵を確かめずに接続する。未知のホストの鍵は黙って登録し、鍵が変わったホストにも（一部の制限付きで）接続するので、なりすまし（中間者攻撃）に気づけない（注意）',
  'connect without checking host keys: the keys of unknown hosts are added silently, and hosts whose key has changed are connected to (with some restrictions), so a man-in-the-middle goes unnoticed (careful)');
export const SSH_OPTION_VALUES = {
  'StrictHostKeyChecking=no': NO_HOST_CHECK,
  'StrictHostKeyChecking=off': NO_HOST_CHECK,
  'StrictHostKeyChecking=accept-new': tx('未知のホストの鍵は自動で登録するが、鍵が変わったホストには接続しない', 'add the keys of unknown hosts automatically, but refuse hosts whose key has changed'),
  'UserKnownHostsFile=/dev/null': tx('既知のホストの鍵を記録しない。どのホストも毎回未知のホストになる（`StrictHostKeyChecking=no` と一緒だと、鍵を一切確かめない。注意）', 'keep no known host keys, so every host is unknown each time (with `StrictHostKeyChecking=no`, no key is ever checked; careful)'),
};

const host = pos('ホスト名または IP アドレス', 'host name or IP address');
const user = pos('ユーザー名', 'user name');
const iface = pos('ネットワークインターフェース（`eth0`…）', 'network interface (`eth0`…)');

const pingCommon: OptSpec[] = [
  ['-c', '送る回数', 'number of packets to send', 'arg'],
  ['-i', '送る間隔（秒）', 'interval in seconds', 'arg'],
  ['-W', '応答を待つ秒数', 'seconds to wait for a reply', 'arg'],
  ['-s', 'パケットのデータ長（バイト）', 'packet data size in bytes', 'arg'],
  ['-t', 'TTL（経由できるルーターの数）', 'TTL (hops)', 'arg'],
  ['-q', '要約だけ表示', 'quiet; print only the summary'],
  ['-n', '名前を引かず数値のまま表示', 'numeric output only'],
  ['-I', '送信元のインターフェースまたはアドレス', 'source interface or address', 'arg'],
];
const traceCommon = (): OptSpec[] => [
  ['-n', '名前を引かず数値のまま表示', 'numeric output; do not resolve names'],
  ['-m', '追跡する最大のホップ数', 'maximum number of hops', 'arg'],
  ['-p', 'ポート番号', 'port number', 'arg'],
  ['-w', '各応答を待つ秒数', 'seconds to wait for each reply', 'arg'],
  ['-q', '各ホップに送るパケット数', 'probes per hop', 'arg'],
];
const ncCommon: OptSpec[] = [
  ['-l', '待ち受け（サーバー）モード', 'listen for incoming connections'],
  ['-v', '詳しく表示する', 'verbose'],
  ['-u', 'TCP でなく UDP を使う', 'use UDP instead of TCP'],
  ['-p', '送信元のポート', 'source port', 'arg'],
  ['-w', '接続を待つ秒数', 'timeout in seconds', 'arg'],
  ['-n', '名前を引かず数値のまま扱う', 'do not resolve names'],
];
const ncKeep: OptSpec = ['-k', '接続が終わっても待ち受けを続ける（OpenBSD 版と Ncat。traditional 版にはない）', 'keep listening after a connection ends (OpenBSD netcat and Ncat; not in traditional netcat)'];
const ncScan: OptSpec = ['-z', 'データを送らず、ポートが開いているかだけ調べる（スキャン。OpenBSD 版と traditional 版。Ncat にはない）', 'send no data; only check whether the port is open (scan; OpenBSD and traditional netcat, not Ncat)'];
const ncExec: OptSpec = ['-e', '接続されたら実行するコマンド（traditional 版と Ncat のみ。OpenBSD 版にはない）', 'command to run after connecting (traditional netcat and Ncat only; not in OpenBSD netcat)', 'arg'];
const smbCommon: OptSpec[] = [
  ['-U|--user', 'ユーザー名（`ユーザー%パスワード`）', 'user name (`user%password`)', 'arg'],
  ['-N|--no-pass', 'パスワードを尋ねない', 'do not ask for a password'],
  ['-W|--workgroup', 'ワークグループ（ドメイン）', 'workgroup (domain)', 'arg'],
  ['-s|--configfile', '設定ファイル', 'configuration file', 'arg'],
];
const dnsKey: OptSpec[] = [
  ['-a', '鍵のアルゴリズム（`RSASHA256`…）', 'key algorithm (`RSASHA256`…)', 'arg'],
  ['-b', '鍵の長さ（ビット）', 'key size in bits', 'arg'],
  ['-n', '鍵の種類（`ZONE`、`HOST`）', 'name type (`ZONE`, `HOST`)', 'arg'],
  ['-f', '鍵の種類（`KSK` など）', 'key flag (`KSK` and so on)', 'arg'],
];

export const netadmin: Record<string, CommandSpec> = {
  // ---- interfaces and addressing ------------------------------------------------------------
  nmcli: cmd('NetworkManager を操作する', 'Control NetworkManager', [
    ['-t|--terse', '機械で読みやすい出力', 'terse, script-friendly output'],
    ['-p|--pretty', '見やすい出力', 'pretty output'],
    ['-f|--fields', '表示する項目', 'fields to show', 'arg'],
    ['-a|--ask', '足りない値を尋ねる', 'ask for missing values'],
    ['-w|--wait', '待つ秒数', 'seconds to wait', 'arg'],
  ], {
    subcommands: {
      general: cmd('全体の状態・ホスト名を表示する（`status`、`hostname`）', 'Show the overall status and host name (`status`, `hostname`)'),
      networking: cmd('ネットワーク全体の有効・無効（`on` / `off`）', 'Turn networking on or off (`on` / `off`)'),
      radio: cmd('Wi-Fi などの無線の有効・無効', 'Turn Wi-Fi and other radios on or off'),
      connection: cmd('接続の設定を管理する（`show`、`up`、`down`、`add`、`modify`、`delete`）', 'Manage connection profiles (`show`, `up`, `down`, `add`, `modify`, `delete`)', [['--active', '有効な接続だけ', 'active connections only']]),
      device: cmd('ネットワークデバイスを管理する（`status`、`show`、`connect`、`disconnect`、`wifi list`）', 'Manage network devices (`status`, `show`, `connect`, `disconnect`, `wifi list`)'),
      monitor: cmd('NetworkManager の変化を見張る', 'Watch NetworkManager for changes'),
    },
  }),
  nmtui: cmd('NetworkManager を端末のメニューで設定する', 'Configure NetworkManager with a terminal menu'),
  ifup: cmd('ネットワークインターフェースを有効にする（ifupdown 版。`/etc/network/interfaces`。RHEL 8 の network-scripts 版は名前だけを取る）', 'Bring a network interface up (ifupdown version, `/etc/network/interfaces`; the network-scripts one in RHEL 8 takes only a name)', [
    ['-a', '`auto` 指定のインターフェースをすべて', 'all interfaces marked `auto`'],
    ['-v', '実行するコマンドを表示する', 'show the commands as they run'],
    ['-n|--no-act', '実際には何もしない', 'print what would be done'],
    ['--force', '状態に関係なく実行する', 'force the operation'],
  ], { positional: [iface] }),
  ifdown: cmd('ネットワークインターフェースを無効にする（ifupdown 版。RHEL 8 の network-scripts 版は名前だけを取る）', 'Bring a network interface down (ifupdown version; the network-scripts one in RHEL 8 takes only a name)', [
    ['-a', '定義されたインターフェースをすべて', 'all defined interfaces'],
    ['-v', '実行するコマンドを表示する', 'show the commands as they run'],
    ['-n|--no-act', '実際には何もしない', 'print what would be done'],
    ['--force', '状態に関係なく実行する', 'force the operation'],
  ], { positional: [iface] }),
  route: cmd('IP ルーティングテーブルを表示・変更する（古い。`ip route` を使う）', 'Show or change the IP routing table (old; use `ip route`)', [
    ['-n', '名前を引かず数値のまま表示', 'numeric output; do not resolve names'],
    ['-e', '`netstat` 形式で表示', 'netstat-style output'],
    ['-v', '詳しく表示する', 'verbose'],
    ['-A', 'アドレスファミリ（`inet6`）', 'address family (`inet6`)', 'arg'],
  ], { positional: [pos('動作（`add`、`del`）', 'action (`add`, `del`)'), pos('宛先（`default`、`-net 10.0.0.0/8`）、`gw` ゲートウェイ、`dev` デバイス', 'target (`default`, `-net 10.0.0.0/8`), `gw` gateway, `dev` device')] }),
  arp: cmd('ARP テーブル（IP と MAC アドレスの対応）を表示・変更する', 'Show or change the ARP table (IP to MAC address)', [
    ['-a', 'BSD 形式ですべて表示', 'show all entries, BSD style'],
    ['-n', '名前を引かず数値のまま表示', 'numeric output'],
    ['-d', 'エントリを削除する', 'delete an entry'],
    ['-s', 'エントリを追加する', 'add an entry'],
    ['-i', '対象のインターフェース', 'interface', 'arg'],
    ['-v', '詳しく表示する', 'verbose'],
  ]),
  ethtool: cmd('ネットワークカードの設定（速度・リンク状態）を表示・変更する', 'Show or change network card settings (speed, link state)', [
    ['-i', 'ドライバーの情報', 'driver information'],
    ['-S', '統計', 'statistics'],
    ['-s', '設定を変える（`speed`、`duplex`、`autoneg`）', 'change settings (`speed`, `duplex`, `autoneg`)'],
    ['-k', 'オフロードの設定を表示', 'show offload features'],
    ['-K', 'オフロードの設定を変更', 'change offload features'],
    ['-p', 'LED を点滅させて物理的に識別する', 'blink the LED to identify the port'],
  ], { positional: [iface] }),
  iw: cmd('無線 LAN(nl80211)の設定を表示・変更する', 'Show or change wireless (nl80211) settings', [], { positional: [pos('対象（`dev`、`phy`）と動作（`scan`、`link`、`info`）', 'target (`dev`, `phy`) and action (`scan`, `link`, `info`)')] }),
  iwconfig: cmd('無線 LAN インターフェースの設定を表示・変更する（古い）', 'Show or change wireless interface settings (old)', [], { positional: [iface] }),
  iwlist: cmd('無線 LAN の情報（検出したアクセスポイントなど）を表示する（古い）', 'List wireless information such as access points found (old)', [], { positional: [iface, pos('調べる項目（`scan`、`freq`、`rate`）', 'what to list (`scan`, `freq`, `rate`)')] }),
  brctl: cmd('Ethernet ブリッジを設定する（古い。`ip link` と `bridge` を使う）', 'Configure Ethernet bridges (old; use `ip link` and `bridge`)', [], { positional: [pos('動作（`addbr`、`delbr`、`addif`、`delif`、`show`）', 'action (`addbr`, `delbr`, `addif`, `delif`, `show`)')] }),
  bridge: cmd('ブリッジの設定・転送テーブルを表示・変更する', 'Show or change bridge settings and forwarding tables', [
    ['-s|-stats', '統計も表示', 'show statistics'],
    ['-d|-details', '詳細を表示', 'show details'],
    ['-j|-json', 'JSON で出力', 'JSON output'],
  ], { positional: [pos('対象（`link`、`fdb`、`vlan`、`mdb`）と動作（`show`、`add`、`del`）', 'object (`link`, `fdb`, `vlan`, `mdb`) and action (`show`, `add`, `del`)')] }),
  dhclient: cmd('DHCP でアドレスを取得する', 'Get an address by DHCP', [
    ['-r', 'アドレスを手放す（リリース）', 'release the lease'],
    ['-v', '詳しく表示する', 'verbose'],
    ['-d', '前面で動かす', 'run in the foreground'],
    ['-1', '1回だけ試して失敗したら終わる', 'try once and give up on failure'],
    ['-x', '動作中の dhclient を止める', 'stop the running dhclient'],
  ], { positional: [iface] }),
  networkctl: cmd('systemd-networkd のネットワークの状態を表示する', 'Show network status from systemd-networkd', [], { positional: [pos('動作（`list`、`status`、`up`、`down`、`reload`）', 'action (`list`, `status`, `up`, `down`, `reload`)')] }),
  resolvectl: cmd('systemd-resolved の DNS 設定と名前解決を調べる', 'Inspect DNS settings and resolve names via systemd-resolved', [], {
    subcommands: {
      status: cmd('DNS の設定をインターフェースごとに表示する', 'Show DNS settings per interface'),
      query: cmd('名前を解決する', 'Resolve a name'),
      statistics: cmd('キャッシュなどの統計を表示する', 'Show cache statistics'),
      'flush-caches': cmd('DNS のキャッシュを破棄する', 'Flush the DNS caches'),
      dns: cmd('インターフェースの DNS サーバーを表示・設定する', 'Show or set DNS servers of an interface'),
    },
  }),
  nft: cmd('nftables（カーネルのパケットフィルタ）の規則を操作する', 'Manage nftables (kernel packet filtering) rules', [
    ['-f|--file', '規則を読み込むファイル', 'file to read rules from', 'arg'],
    ['-a|--handle', '規則のハンドルも表示', 'show rule handles'],
    ['-n|--numeric', '名前を引かず数値のまま表示', 'numeric output'],
    ['-j|--json', 'JSON で入出力する', 'use JSON'],
    ['-c|--check', '適用せず検査だけ', 'check only; do not apply'],
  ], { positional: [pos('動作（`list ruleset`、`add rule`、`flush ruleset`…）', 'action (`list ruleset`, `add rule`, `flush ruleset`…)')] }),
  // ---- diagnostics --------------------------------------------------------------------------
  ping6: cmd('IPv6 で ICMP エコーを送って疎通を確認する', 'Check reachability over IPv6 with ICMP echo', pingCommon, { positional: [host] }),
  traceroute: cmd('宛先までに通る経路(ルーター)を調べる', 'Trace the route (routers) to a host', [
    ...traceCommon(),
    ['-I', 'UDP でなく ICMP を使う', 'use ICMP instead of UDP'],
    ['-T', 'TCP SYN を使う', 'use TCP SYN'],
    ['-6', 'IPv6 を使う', 'use IPv6'],
    ['-4', 'IPv4 を使う', 'use IPv4'],
  ], { positional: [host] }),
  traceroute6: cmd('IPv6 で宛先までの経路を調べる', 'Trace the route to a host over IPv6', traceCommon(), { positional: [host] }),
  tracepath: cmd('宛先までの経路と MTU を調べる（root 不要）', 'Trace the route and the path MTU to a host (no root needed)', [
    ['-n', '名前を引かず数値のまま表示', 'numeric output'],
    ['-m', '最大のホップ数', 'maximum hops', 'arg'],
    ['-p', 'ポート番号', 'port number', 'arg'],
    ['-b', '名前と IP アドレスの両方を表示', 'show both names and IP addresses'],
    ['-l', '最初のパケットの長さ', 'initial packet length', 'arg'],
  ], { positional: [host] }),
  tracepath6: cmd('IPv6 で宛先までの経路と MTU を調べる', 'Trace the route and the path MTU over IPv6', [
    ['-n', '名前を引かず数値のまま表示', 'numeric output'],
    ['-m', '最大のホップ数', 'maximum hops', 'arg'],
  ], { positional: [host] }),
  mtr: cmd('`traceroute` と `ping` を合わせた経路の診断を続けて表示する', 'Keep tracing a route like `traceroute` and `ping` combined', [
    ['-r|--report', '指定回数だけ調べて結果を表示して終わる', 'run for a number of cycles, print a report and exit'],
    ['-c|--report-cycles', '調べる回数', 'number of cycles', 'arg'],
    ['-n|--no-dns', '名前を引かず数値のまま表示', 'do not resolve names'],
    ['-w|--report-wide', '省略せずに表示（`-r` と併用）', 'wide report (with `-r`)'],
    ['-b|--show-ips', 'ホスト名と IP アドレスを両方表示', 'show both names and IPs'],
    ['-T|--tcp', 'TCP を使う', 'use TCP'],
    ['-u|--udp', 'UDP を使う', 'use UDP'],
    ['-i|--interval', '送る間隔（秒）', 'interval in seconds', 'arg'],
  ], { positional: [host] }),
  ncat: cmd('TCP/UDP で接続・待ち受けする万能ツール（Nmap 版）', 'Versatile TCP/UDP connect and listen tool (Nmap version)', [
    ...ncCommon,
    ncKeep,
    ['--ssl', 'TLS で暗号化する', 'use TLS'],
    ['--send-only', 'データを送るだけで受け取らない', 'send only; ignore received data'],
    ['-e|--exec', '接続されたら実行するコマンド', 'command to run after connecting', 'arg'],
  ], { positional: [host, pos('ポート番号', 'port number')] }),
  netcat: cmd('TCP/UDP で接続・待ち受けする万能ツール（`nc` と同じ）', 'Versatile TCP/UDP connect and listen tool (same as `nc`)', [...ncCommon, ncKeep, ncScan, ncExec], { positional: [host, pos('ポート番号', 'port number')] }),
  telnet: cmd('TCP でホストに接続する対話的なクライアント（暗号化なし。ポートの確認に使う）', 'Interactive TCP client (no encryption; used to test ports)', [
    ['-l', 'ログインに使うユーザー名', 'user name for the login', 'arg'],
    ['-e', 'エスケープ文字', 'escape character', 'arg'],
    ['-4', 'IPv4 だけを使う', 'use IPv4 only'],
    ['-6', 'IPv6 だけを使う', 'use IPv6 only'],
  ], { positional: [host, pos('ポート番号（既定 23）', 'port number (default 23)')] }),
  ftp: cmd('FTP でファイルを転送する（暗号化なし）', 'Transfer files over FTP (no encryption)', [
    ['-n', '自動ログインしない', 'do not log in automatically'],
    ['-i', '複数ファイルの転送で確認しない', 'do not prompt during multiple transfers'],
    ['-p', 'パッシブモードを使う', 'use passive mode'],
    ['-v', '詳しく表示する', 'verbose'],
  ], { positional: [host] }),
  nmap: cmd('ネットワークをスキャンして、開いているポートやサービスを調べる', 'Scan a network for open ports and services', [
    ['-sS', 'TCP SYN スキャン（root が必要）', 'TCP SYN scan (needs root)'],
    ['-sT', 'TCP connect スキャン', 'TCP connect scan'],
    ['-sU', 'UDP スキャン', 'UDP scan'],
    ['-sV', 'サービスのバージョンを調べる', 'detect service versions'],
    ['-sn', 'ポートをスキャンせずホストの生存確認だけ', 'host discovery only; no port scan'],
    ['-O', 'OS を推定する', 'detect the operating system'],
    ['-p', 'スキャンするポート（`22,80`、`1-1024`、`-` ですべて）', 'ports to scan (`22,80`, `1-1024`, `-` for all)', 'arg'],
    ['-A', 'OS・バージョン・スクリプトをまとめて調べる', 'aggressive: OS, versions, scripts and traceroute'],
    ['-Pn', 'ホストの生存確認をせずスキャンする', 'skip host discovery; assume hosts are up'],
    ['-T', 'タイミングの強さ（`0` 〜 `5`）', 'timing template (`0` to `5`)', 'arg'],
    ['-oN', '結果を通常の形式でファイルに保存', 'save results in normal format', 'arg'],
    ['-v', '詳しく表示する', 'verbose'],
    ['--script', '実行するスクリプト', 'scripts to run', 'arg'],
    ['-F', '主要な100ポートだけ調べる', 'fast: scan only the 100 most common ports'],
  ], { positional: [pos('対象（ホスト、`192.168.1.0/24`）', 'target (host, `192.168.1.0/24`)')] }),
  tcpdump: cmd('ネットワークのパケットを捕捉して表示する', 'Capture and show network packets', [
    ['-i', '捕捉するインターフェース（`any` ですべて）', 'interface to capture on (`any`: all)', 'arg'],
    ['-n', '名前を引かず数値のまま表示', 'do not resolve names'],
    ['-nn', 'ポート名も引かず数値のまま表示', 'do not resolve names or ports'],
    ['-c', '捕捉するパケット数', 'stop after the given number of packets', 'arg'],
    ['-w', 'パケットを指定したファイルに保存する', 'write packets to the given file', 'arg'],
    ['-r', '保存したファイルを読む', 'read packets from the given file', 'arg'],
    ['-v', '詳しく表示する（`-vv` でさらに）', 'verbose (`-vv`: more)'],
    ['-A', '内容を ASCII で表示', 'print payloads in ASCII'],
    ['-X', '内容を 16 進数と ASCII で表示', 'print payloads in hex and ASCII'],
    ['-s', '各パケットから取り込むバイト数（`0` ですべて）', 'bytes to capture per packet (`0`: all)', 'arg'],
    ['-e', 'リンク層のヘッダーも表示', 'print link-level headers'],
    ['-q', '簡潔に表示', 'quiet output'],
  ], { positional: [pos('フィルタ式（`port 80`、`host 10.0.0.1 and tcp`）', 'filter expression (`port 80`, `host 10.0.0.1 and tcp`)')] }),
  iftop: cmd('接続ごとの通信量をリアルタイムで表示する', 'Show bandwidth use per connection in real time', [
    ['-i', '対象のインターフェース', 'interface', 'arg'],
    ['-n', '名前を引かず数値のまま表示', 'do not resolve names'],
    ['-N', 'ポート名を引かず数値のまま表示', 'do not resolve ports'],
    ['-P', 'ポートも表示', 'show ports'],
    ['-F', '対象のネットワーク（`192.168.0.0/24`）', 'only the given network (`192.168.0.0/24`)', 'arg'],
  ]),
  iptraf: cmd('ネットワークの通信量を端末のメニューで監視する', 'Monitor network traffic with a terminal menu', [
    ['-i', '対象のインターフェース（`all` ですべて）', 'interface (`all`: all)', 'arg'],
    ['-g', '全体の統計を表示', 'show general interface statistics'],
  ]),
  'iptraf-ng': cmd('ネットワークの通信量を端末のメニューで監視する', 'Monitor network traffic with a terminal menu', [
    ['-i', '対象のインターフェース（`all` ですべて）', 'interface (`all`: all)', 'arg'],
    ['-g', '全体の統計を表示', 'show general interface statistics'],
  ]),
  // ---- X11 ----------------------------------------------------------------------------------
  xhost: cmd('X サーバーに接続できるホストやユーザーを制御する', 'Control which hosts and users can connect to the X server', [], { positional: [pos('`+ホスト`（許可）、`-ホスト`（拒否）、`+`（全員を許可）（注意）', '`+host` (allow), `-host` (deny), `+` (allow everyone, careful)')] }),
  xauth: cmd('X サーバーの認証情報（`.Xauthority`）を管理する', 'Manage X server authorization (`.Xauthority`)', [
    ['-f', '対象のファイル', 'authority file', 'arg'],
    ['-v', '詳しく表示する', 'verbose'],
  ], { positional: [pos('動作（`list`、`add`、`extract`、`merge`、`remove`）', 'action (`list`, `add`, `extract`, `merge`, `remove`)')] }),
  startx: cmd('X Window System を起動する', 'Start the X Window System', [], { positional: [pos('起動するクライアント', 'client to run')] }),
  // ---- DNS ----------------------------------------------------------------------------------
  rndc: cmd('BIND（named）を遠隔制御する', 'Control the BIND name server (named)', [
    ['-s', '操作するサーバー', 'server to contact', 'arg'],
    ['-p', 'ポート番号', 'port number', 'arg'],
    ['-c', '設定ファイル', 'configuration file', 'arg'],
    ['-k', '鍵のファイル', 'key file', 'arg'],
  ], { positional: [pos('動作（`reload`、`reconfig`、`flush`、`status`、`stop`）', 'action (`reload`, `reconfig`, `flush`, `status`, `stop`)')] }),
  'named-checkconf': cmd('BIND の設定ファイルの文法を検査する', 'Check the syntax of the BIND configuration', [
    ['-z', 'ゾーンファイルも読み込んで検査する', 'also load and check the zone files'],
    ['-p', '整形して設定を表示する', 'print the configuration in canonical form'],
    ['-t', '`chroot` するディレクトリ', 'directory to chroot into', 'arg'],
  ], { positional: [pos('設定ファイル（`/etc/named.conf`）', 'configuration file (`/etc/named.conf`)')] }),
  'named-checkzone': cmd('DNS のゾーンファイルの文法を検査する', 'Check the syntax of a DNS zone file', [
    ['-d', 'デバッグ表示', 'debug output'],
    ['-q', '表示を減らす', 'quiet'],
    ['-i', '整合性の検査の種類', 'kind of integrity checks', 'arg'],
    ['-k', '名前の検査の動作（`fail`、`warn`、`ignore`）', 'name check mode (`fail`, `warn`, `ignore`)', 'arg'],
  ], { positional: [pos('ゾーン名', 'zone name'), pos('ゾーンファイル', 'zone file')] }),
  'named-compilezone': cmd('ゾーンファイルを検査して別の形式に変換する', 'Check a zone file and convert it to another format', [
    ['-o', '出力するファイル', 'output file', 'arg'],
    ['-f', '入力の形式（`text`、`raw`）', 'input format (`text`, `raw`)', 'arg'],
    ['-F', '出力の形式（`text`、`raw`）', 'output format (`text`, `raw`)', 'arg'],
  ], { positional: [pos('ゾーン名', 'zone name'), pos('ゾーンファイル', 'zone file')] }),
  'dnssec-keygen': cmd('DNSSEC の鍵を作る', 'Generate DNSSEC keys', dnsKey, { positional: [pos('ゾーン名', 'zone name')] }),
  'dnssec-signzone': cmd('ゾーンに DNSSEC の署名を付ける', 'Sign a zone with DNSSEC', [
    ['-o', 'ゾーンの名前', 'zone origin', 'arg'],
    ['-k', 'KSK の鍵', 'KSK key', 'arg'],
    ['-S', '鍵を自動で探して署名する', 'smart signing: look up the keys'],
    ['-N', 'SOA のシリアルの更新方法（`unixtime`…）', 'how to update the SOA serial (`unixtime`…)', 'arg'],
    ['-3', 'NSEC3 を使う（ソルト）', 'use NSEC3 (salt)', 'arg'],
  ], { positional: [pos('ゾーンファイル', 'zone file'), pos('ZSK の鍵', 'ZSK keys')] }),
  // ---- web and proxy servers ----------------------------------------------------------------
  apachectl: cmd('Apache HTTP サーバーを制御する', 'Control the Apache HTTP server', [
    ['-t', '設定ファイルの文法を検査する', 'check the syntax of the configuration'],
    ['-S', 'バーチャルホストなどの設定を表示する', 'show the parsed virtual host settings'],
    ['-M', '読み込まれるモジュールを表示', 'list the loaded modules'],
    ['-k', '操作（`start`、`stop`、`restart`、`graceful`）', 'action (`start`, `stop`, `restart`, `graceful`)', 'arg'],
    ['-v', 'バージョンを表示', 'show the version'],
  ], { positional: [pos('動作（`start`、`stop`、`restart`、`graceful`、`configtest`）', 'action (`start`, `stop`, `restart`, `graceful`, `configtest`)')] }),
  apache2ctl: cmd('Apache HTTP サーバーを制御する（Debian 系）', 'Control the Apache HTTP server (Debian family)', [
    ['-t', '設定ファイルの文法を検査する', 'check the syntax of the configuration'],
    ['-S', 'バーチャルホストなどの設定を表示する', 'show the parsed virtual host settings'],
    ['-M', '読み込まれるモジュールを表示', 'list the loaded modules'],
    ['-k', '操作（`start`、`stop`、`restart`、`graceful`）', 'action (`start`, `stop`, `restart`, `graceful`)', 'arg'],
  ], { positional: [pos('動作（`start`、`stop`、`restart`、`graceful`、`configtest`）', 'action (`start`, `stop`, `restart`, `graceful`, `configtest`)')] }),
  httpd: cmd('Apache HTTP サーバー（RHEL 系）', 'Apache HTTP server (Red Hat family)', [
    ['-t', '設定ファイルの文法を検査する', 'check the syntax of the configuration'],
    ['-S', 'バーチャルホストなどの設定を表示する', 'show the parsed virtual host settings'],
    ['-M', '読み込まれるモジュールを表示', 'list the loaded modules'],
    ['-f', '設定ファイル', 'configuration file', 'arg'],
    ['-k', '操作（`start`、`stop`、`restart`、`graceful`）', 'action (`start`, `stop`, `restart`, `graceful`)', 'arg'],
    ['-v', 'バージョンを表示', 'show the version'],
    ['-V', 'ビルドの設定を表示', 'show build settings'],
  ]),
  apache2: cmd('Apache HTTP サーバー（Debian 系）', 'Apache HTTP server (Debian family)', [
    ['-t', '設定ファイルの文法を検査する', 'check the syntax of the configuration'],
    ['-S', 'バーチャルホストなどの設定を表示する', 'show the parsed virtual host settings'],
    ['-M', '読み込まれるモジュールを表示', 'list the loaded modules'],
    ['-f', '設定ファイル', 'configuration file', 'arg'],
    ['-k', '操作（`start`、`stop`、`restart`、`graceful`）', 'action (`start`, `stop`, `restart`, `graceful`)', 'arg'],
    ['-v', 'バージョンを表示', 'show the version'],
  ]),
  nginx: cmd('nginx（Web サーバー・リバースプロキシ）', 'nginx (web server and reverse proxy)', [
    ['-t', '設定ファイルの文法を検査して終わる', 'test the configuration and exit'],
    ['-T', '検査して設定を表示する', 'test and dump the configuration'],
    ['-s', '動作中の nginx にシグナルを送る（`reload`、`stop`、`quit`、`reopen`）', 'signal the running nginx (`reload`, `stop`, `quit`, `reopen`)', 'arg'],
    ['-c', '設定ファイル', 'configuration file', 'arg'],
    ['-g', '設定に追加するディレクティブ', 'extra global directives', 'arg'],
    ['-p', '作業ディレクトリ（プレフィックス）', 'prefix path', 'arg'],
    ['-v', 'バージョンを表示', 'show the version'],
    ['-V', 'バージョンとビルドの設定を表示', 'show the version and build settings'],
  ]),
  squidclient: cmd('Squid プロキシに要求を送って状態を調べる', 'Send requests to a Squid proxy and inspect it', [
    ['-h', 'プロキシのホスト', 'proxy host', 'arg'],
    ['-p', 'プロキシのポート', 'proxy port', 'arg'],
    ['-m', 'HTTP メソッド', 'HTTP method', 'arg'],
    ['-v', '詳しく表示する', 'verbose'],
  ], { positional: [pos('URL（`mgr:info` などの管理用も可）', 'URL (or a manager page such as `mgr:info`)')] }),
  sshd: cmd('SSH サーバー（デーモン）', 'SSH server (daemon)', [
    ['-t', '設定ファイルを検査して終わる', 'test the configuration and exit'],
    ['-T', '有効な設定を表示して終わる', 'print the effective configuration and exit'],
    ['-D', '前面で動かす（デーモンにならない）', 'do not detach; stay in the foreground'],
    ['-d', 'デバッグモード', 'debug mode'],
    ['-p', '待ち受けるポート', 'port to listen on', 'arg'],
    ['-f', '設定ファイル', 'configuration file', 'arg'],
    ['-o', '設定を1つ指定する', 'set one configuration option', 'arg'],
  ]),
  openvpn: cmd('OpenVPN（VPN の接続・サーバー）', 'OpenVPN (VPN client and server)', [
    ['--config', '設定ファイル', 'configuration file', 'arg'],
    ['--daemon', 'デーモンとして動かす', 'run as a daemon'],
    ['--remote', '接続先のサーバー', 'remote server', 'arg'],
    ['--dev', '仮想デバイス（`tun0`、`tap0`）', 'virtual device (`tun0`, `tap0`)', 'arg'],
    ['--proto', 'プロトコル（`udp` / `tcp`）', 'protocol (`udp` / `tcp`)', 'arg'],
    ['--genkey', '鍵を作る', 'generate a key'],
    ['--verb', 'ログの詳しさ（0〜11）', 'log verbosity (0 to 11)', 'arg'],
    ['--auth-user-pass', 'ユーザー名とパスワードで認証する', 'authenticate with user name and password'],
  ]),
  // ---- Samba --------------------------------------------------------------------------------
  smbclient: cmd('SMB/CIFS の共有に FTP のように接続する', 'Connect to SMB/CIFS shares like an FTP client', [
    ...smbCommon,
    ['-L|--list', 'サーバーの共有を一覧表示する', 'list the shares of a server', 'arg'],
    ['-c|--command', '実行するコマンド', 'command to run', 'arg'],
    ['-m|--max-protocol', '使う最大のプロトコルバージョン', 'maximum protocol version', 'arg'],
  ], { positional: [pos('共有（`//サーバー/共有名`）', 'share (`//server/name`)')] }),
  smbstatus: cmd('Samba の接続とロックの状況を表示する', 'Show Samba connections and locks', [
    ['-b|--brief', '簡潔に表示', 'brief output'],
    ['-S|--shares', '共有だけ', 'shares only'],
    ['-L|--locks', 'ロックされたファイルだけ', 'locked files only'],
    ['-p|--processes', 'プロセスだけ', 'processes only'],
  ]),
  smbpasswd: cmd('Samba のユーザーのパスワードを設定・管理する', 'Set and manage Samba user passwords', [
    ['-a', 'ユーザーを追加する', 'add a user'],
    ['-x', 'ユーザーを削除する', 'delete a user'],
    ['-d', 'ユーザーを無効にする', 'disable a user'],
    ['-e', 'ユーザーを有効にする', 'enable a user'],
    ['-n', 'パスワードを空にする', 'set no password'],
    ['-s', 'パスワードを標準入力から読む', 'read the password from stdin'],
  ], { positional: [user] }),
  smbcontrol: cmd('Samba のデーモンにメッセージを送る', 'Send messages to Samba daemons', [], { positional: [pos('宛先（`smbd`、`nmbd`、`winbindd`）', 'destination (`smbd`, `nmbd`, `winbindd`)'), pos('メッセージ（`reload-config`、`ping`…）', 'message (`reload-config`, `ping`…)')] }),
  testparm: cmd('Samba の設定ファイル(`smb.conf`)を検査する', 'Check the Samba configuration file (`smb.conf`)', [
    ['-s|--suppress-prompt', '確認を待たずに設定を表示する', 'show the configuration without waiting for a key'],
    ['-v|--verbose', '既定値も含めて表示する', 'show defaults too'],
    ['--parameter-name', '指定した設定値だけ表示', 'show only the given parameter', 'arg'],
  ], { positional: [pos('設定ファイル', 'configuration file')] }),
  nmblookup: cmd('NetBIOS 名から IP アドレスを調べる', 'Look up NetBIOS names', [
    ['-A', '名前でなく IP アドレスを指定して調べる', 'treat the argument as an IP address'],
    ['-M', 'マスターブラウザーを探す', 'look up the master browser'],
    ['-S', 'ノードの状態も表示', 'also do a node status query'],
    ['-B', 'ブロードキャストアドレス', 'broadcast address', 'arg'],
  ], { positional: [pos('NetBIOS 名', 'NetBIOS name')] }),
  net: cmd('Samba と Windows のネットワーク機能を操作する', 'Administer Samba and Windows networking', [
    ['-U|--user', 'ユーザー名', 'user name', 'arg'],
    ['-S|--server', 'サーバー', 'server', 'arg'],
    ['-w|--workgroup', 'ワークグループ', 'workgroup', 'arg'],
  ], { positional: [pos('分類（`ads`、`rpc`、`usershare`、`cache`）と動作', 'class (`ads`, `rpc`, `usershare`, `cache`) and action')] }),
  'samba-tool': cmd('Samba の AD ドメインコントローラーを管理する', 'Administer a Samba Active Directory domain controller', [], {
    subcommands: {
      domain: cmd('ドメインを操作する（`provision`、`info`、`level`）', 'Manage the domain (`provision`, `info`, `level`)'),
      user: cmd('ユーザーを操作する（`create`、`list`、`delete`、`setpassword`）', 'Manage users (`create`, `list`, `delete`, `setpassword`)'),
      group: cmd('グループを操作する', 'Manage groups'),
      dns: cmd('DNS を操作する', 'Manage DNS'),
      testparm: cmd('設定を検査する', 'Check the configuration'),
    },
  }),
  // ---- server daemons -----------------------------------------------------------------------
  dhcpd: cmd('ISC DHCP サーバー(デーモン)', 'ISC DHCP server (daemon)', [
    ['-t', '設定ファイルを検査して終わる', 'test the configuration file and exit'],
    ['-T', 'リースファイルを検査して終わる', 'test the lease file and exit'],
    ['-f', '前面で動かす', 'run in the foreground'],
    ['-d', 'ログを標準エラー出力に出す（前面で）', 'log to stderr, in the foreground'],
    ['-cf', '設定ファイル', 'configuration file', 'arg'],
    ['-lf', 'リースファイル', 'lease file', 'arg'],
    ['-q', '起動時のメッセージを出さない', 'do not print the start-up banner'],
  ], { positional: [iface] }),
  radvd: cmd('IPv6 のルーター広告(RA)を送るデーモン', 'Daemon that sends IPv6 router advertisements (RA)', [
    ['-C|--config', '設定ファイル', 'configuration file', 'arg'],
    ['-c|--configtest', '設定ファイルを検査して終わる', 'check the configuration and exit'],
    ['-n|--nodaemon', '前面で動かす', 'do not daemonize'],
    ['-d|--debug', 'デバッグの水準（1〜5）', 'debug level (1 to 5)', 'arg'],
  ]),
  smbd: cmd('Samba のファイル・印刷共有のデーモン', 'Samba file and print sharing daemon', [
    ['-D|--daemon', 'デーモンとして動かす', 'run as a daemon'],
    ['-F|--foreground', '前面で動かす', 'stay in the foreground'],
    ['-i|--interactive', '前面で動かし、ログを端末に出す', 'foreground, logging to the terminal'],
    ['-s|--configfile', '設定ファイル', 'configuration file', 'arg'],
    ['-b|--build-options', 'ビルドの設定を表示', 'print the build options'],
  ]),
  nmbd: cmd('Samba の NetBIOS 名のデーモン', 'Samba NetBIOS name service daemon', [
    ['-D|--daemon', 'デーモンとして動かす', 'run as a daemon'],
    ['-F|--foreground', '前面で動かす', 'stay in the foreground'],
    ['-i|--interactive', '前面で動かし、ログを端末に出す', 'foreground, logging to the terminal'],
    ['-s|--configfile', '設定ファイル', 'configuration file', 'arg'],
  ]),
  winbindd: cmd('Samba の Windows ドメイン連携のデーモン(winbind)', 'Samba daemon that connects to Windows domains (winbind)', [
    ['-D|--daemon', 'デーモンとして動かす', 'run as a daemon'],
    ['-F|--foreground', '前面で動かす', 'stay in the foreground'],
    ['-i|--interactive', '前面で動かし、ログを端末に出す', 'foreground, logging to the terminal'],
    ['-s|--configfile', '設定ファイル', 'configuration file', 'arg'],
  ]),
  slapd: cmd('OpenLDAP サーバー(デーモン)', 'OpenLDAP server (daemon)', [
    ['-f', '設定ファイル（`slapd.conf`）', 'configuration file (`slapd.conf`)', 'arg'],
    ['-F', '設定ディレクトリ（`slapd.d`）', 'configuration directory (`slapd.d`)', 'arg'],
    ['-h', '待ち受ける URL（`ldap:/// ldapi:///`）', 'URLs to listen on (`ldap:/// ldapi:///`)', 'arg'],
    ['-d', 'デバッグの水準', 'debug level', 'arg'],
    ['-u', '実行するユーザー', 'user to run as', 'arg'],
    ['-g', '実行するグループ', 'group to run as', 'arg'],
    ['-T', 'ツールとして動かす（`a` slapadd、`c` slapcat…）', 'run as a tool (`a` slapadd, `c` slapcat…)', 'arg'],
    ['-Tt', '設定を検査して終わる（`slaptest`）', 'test the configuration and exit (`slaptest`)'],
  ]),
  exim: cmd('Exim（メールサーバー）。メールを送る・キューを操作する', 'Exim mail server: send mail and handle its queue', [
    ['-bp', 'メールキューを表示', 'list the mail queue'],
    ['-bpc', 'キューのメールの数を表示', 'count the messages in the queue'],
    ['-q', 'キューを処理する', 'process the queue'],
    ['-qff', '凍結したメールも含めてキューを処理する', 'process the queue, including frozen messages'],
    ['-M', '指定のメールを今すぐ配送する', 'deliver the given message now', 'arg'],
    ['-Mrm', '指定のメールを削除する', 'remove the given message', 'arg'],
    ['-bt', 'アドレスの配送先をテストする', 'test how an address would be routed'],
    ['-bV', 'バージョンと設定ファイルを表示', 'show the version and configuration file'],
    ['-bd', 'デーモンとして動かす', 'run as a daemon'],
    ['-d', 'デバッグ表示', 'debug output'],
  ], { parser: 'single-dash' }),
};
