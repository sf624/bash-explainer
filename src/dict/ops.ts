import type { CommandSpec } from '../argv/spec';
import { cmd, COMMAND_TEXT, operand, OptSpec, persistent, pos, runs } from './types';
import { tx } from '../i18n';

// Commands found in a second survey: operations and cloud scripts (Kubernetes, Terraform, AWS,
// Google Cloud), node bootstrap and debugging scripts, dotfiles and container builds.

const files = pos('対象のファイル', 'target file');
const user = pos('ユーザー名', 'user name');
const device = pos('デバイス（`/dev/sda1`…）', 'device (`/dev/sda1`…)');

// ---- Kubernetes ---------------------------------------------------------------------------------

/**
 * kubectl's global options (`kubectl options`), which every subcommand takes too (a subcommand's own option of
 * the same name wins). kubectl finds its subcommand as cobra does, so a subcommand's own options may come
 * before its name too (`kubectl -o yaml get pods`).
 */
const kube: OptSpec[] = persistent([
  ['-n|--namespace', '対象の名前空間', 'namespace', 'arg'],
  ['--context', '使う kubeconfig のコンテキスト（クラスター）', 'kubeconfig context (cluster) to use', 'arg'],
  ['--kubeconfig', '使う kubeconfig のファイル', 'kubeconfig file to use', 'arg'],
  ['--cluster', '使う kubeconfig のクラスター', 'kubeconfig cluster to use', 'arg'],
  ['--user', '使う kubeconfig のユーザー', 'kubeconfig user to use', 'arg'],
  ['-s|--server', 'API サーバーのアドレス', 'address of the API server', 'arg'],
  ['--token', '認証に使うベアラートークン', 'bearer token for authentication', 'arg'],
  ['--as', '指定したユーザーになりすまして操作する', 'act as the given user (impersonation)', 'arg'],
  ['--as-group', '指定したグループになりすまして操作する', 'act as the given group (impersonation)', 'arg'],
  ['--certificate-authority', 'CA 証明書のファイル', 'certificate authority file', 'arg'],
  ['--client-certificate', 'クライアント証明書のファイル', 'client certificate file', 'arg'],
  ['--client-key', 'クライアントの秘密鍵のファイル', 'client key file', 'arg'],
  ['--insecure-skip-tls-verify', 'サーバーの証明書を検証しない（危険）', 'do not verify the server certificate (insecure)'],
  ['--request-timeout', '1つの要求を待つ時間の上限（`0` は無制限）', 'how long to wait for one request (`0`: no limit)', 'arg'],
  ['-v|--v', 'ログの詳しさ（`0`〜`9`）', 'log verbosity (`0` to `9`)', 'arg'],
  ['--cache-dir', 'キャッシュのディレクトリ', 'cache directory', 'arg'],
  ['--match-server-version', 'クライアントとサーバーの版が同じでなければ失敗する', 'fail unless the client and server versions match'],
  ['--warnings-as-errors', 'サーバーからの警告をエラーとして扱う', 'treat warnings from the server as errors'],
  ['--disable-compression', 'サーバーへの要求で応答の圧縮を使わない', 'do not compress the responses of the server'],
  ['--as-uid', '指定した UID になりすまして操作する', 'act as the given UID (impersonation)', 'arg'],
  ['--tls-server-name', 'サーバーの証明書を確かめるときに使う名前', 'server name to check the server certificate with', 'arg'],
  ['--username', 'API サーバーへの基本認証のユーザー名', 'user name for basic authentication to the API server', 'arg'],
  ['--password', 'API サーバーへの基本認証のパスワード', 'password for basic authentication to the API server', 'arg'],
  ['--profile', '採るプロファイルの種類（`none`、`cpu`、`heap`…）', 'profile to capture (`none`, `cpu`, `heap`…)', 'arg'],
  ['--profile-output', 'プロファイルを書くファイル', 'file to write the profile to', 'arg'],
  ['--log-flush-frequency', 'ログを書き出す間隔の上限', 'longest time between log flushes', 'arg'],
  ['--vmodule', 'ファイルごとのログの詳しさ（`パターン=N,…`）', 'log verbosity per file (`pattern=N,…`)', 'arg'],
]);

/** Options that several subcommands have (each lists the ones it takes, as `kubectl SUBCOMMAND --help` does). */
const kubeOutput: OptSpec = ['-o|--output', '出力形式（`yaml`、`json`、`wide`、`name`、`jsonpath=…`）', 'output format (`yaml`, `json`, `wide`, `name`, `jsonpath=…`)', 'arg'];
const kubeSelector: OptSpec = ['-l|--selector', 'ラベルで絞る（`app=web`）', 'filter by label (`app=web`)', 'arg'];
const kubeAll: OptSpec = ['-A|--all-namespaces', 'すべての名前空間', 'all namespaces'];
const kubeWatch: OptSpec = ['-w|--watch', '変化を見張り続ける', 'keep watching for changes'];
// `--dry-run` takes its value only as `--dry-run=client` (alone it means `unchanged`, which kubectl rejects).
const kubeDryRun: OptSpec = ['--dry-run', '実際には変更しない（`--dry-run=client`、`--dry-run=server`）', 'do not change anything (`--dry-run=client`, `--dry-run=server`)', 'attached'];
const kubeWait: OptSpec = ['--wait', 'リソースの処理が終わるまで待つ（`--wait=false` で待たない）', 'wait until the resources are done (`--wait=false`: do not wait)'];
const kubeTimeout: OptSpec = ['--timeout', '待つ時間の上限（`60s`）', 'how long to wait (`60s`)', 'arg'];

/** The manifests to act on: options of the subcommands that take resources (not `logs`, where `-f` follows). */
const kubeFiles: OptSpec[] = [
  ['-f|--filename', 'マニフェストのファイルやディレクトリ（`-` で標準入力）', 'manifest file or directory (`-`: stdin)', 'arg'],
  ['-k|--kustomize', '指定した kustomization のディレクトリ', 'the given kustomization directory', 'arg'],
];

const resource = pos('リソースの種類と名前（`pod/web`、`deployment web`…）', 'resource type and name (`pod/web`, `deployment web`…)');

const kubectl = cmd('Kubernetes のクラスターを操作する', 'Control a Kubernetes cluster', kube, {
  cobra: true,
  subcommands: {
    get: cmd('リソースを一覧表示する', 'List resources', [...kubeFiles, kubeOutput, kubeSelector, kubeAll, kubeWatch], { positional: [resource] }),
    describe: cmd('リソースの詳細とイベントを表示する', 'Show details and events of resources', [...kubeFiles, kubeSelector, kubeAll], { positional: [resource] }),
    apply: cmd('マニフェストの内容にリソースを合わせる（なければ作る）', 'Make resources match the manifests (create them if missing)', [...kubeFiles, kubeOutput, kubeSelector, kubeDryRun, kubeTimeout, kubeWait, ['--server-side', 'サーバー側で適用する', 'apply on the server']]),
    create: cmd('リソースを作る', 'Create resources', [...kubeFiles, kubeOutput, kubeDryRun], { positional: [resource] }),
    delete: cmd('リソースを削除する', 'Delete resources', [...kubeFiles, kubeOutput, kubeSelector, kubeAll, kubeDryRun, kubeTimeout, kubeWait,
      ['--all', '種類のリソースをすべて', 'every resource of the type'],
      ['--force', '終了を待たずにすぐ削除する（危険）', 'delete at once, without waiting for the end (dangerous)'],
      ['--grace-period', '終了を待つ秒数（`0` ですぐ。`--force` とともに）', 'seconds to wait for the end (`0`: at once, with `--force`)', 'arg'],
      ['--ignore-not-found', 'なくてもエラーにしない', 'no error if it does not exist']], { positional: [resource] }),
    logs: cmd('Pod のログを表示する', "Print a pod's logs", [['-f|--follow', 'ログを流し続ける', 'stream the logs'], kubeSelector, ['-c|--container', 'コンテナ', 'container', 'arg'], ['--tail', '末尾の行数', 'lines from the end', 'arg'], ['-p|--previous', '再起動する前のコンテナのログ', 'logs of the previous container instance']], { positional: [pos('Pod（`deploy/名前` も可）', 'pod (or `deploy/name`)')] }),
    exec: cmd('コンテナの中でコマンドを実行する（`--` の後がコマンド）', 'Run a command in a container (the command follows `--`)', [...kubeFiles, ['-i|--stdin', '標準入力をつなぐ', 'pass stdin'], ['-t|--tty', '端末を割り当てる', 'allocate a TTY'], ['-c|--container', 'コンテナ', 'container', 'arg']], { operands: [{ pattern: [operand('POD', 'Pod', 'pod', { repeat: '*' })] }], dashDash: { then: [{ name: 'COMMAND', text: COMMAND_TEXT, command: { run: 'exec', where: 'container', env: 'none' } }] } }),
    run: cmd('Pod を起動する（`--` の後がコンテナで実行するコマンド）', 'Start a pod (the command to run in the container follows `--`)', [...kubeFiles, kubeOutput, kubeDryRun, ['--image', 'コンテナイメージ', 'container image', 'arg'], ['--env', '環境変数を設定（`名前=値`）', 'set an environment variable (`NAME=value`)', 'arg setenv'], ['--rm', '終了したら Pod を削除する', 'delete the pod when it exits'], ['-i|--stdin', '標準入力をつなぐ', 'pass stdin'], ['-t|--tty', '端末を割り当てる', 'allocate a TTY'], ['--restart', '再起動の方針（`Never`、`OnFailure`、`Always`）', 'restart policy (`Never`, `OnFailure`, `Always`)', 'arg']], { operands: [{ pattern: [operand('NAME', 'Pod の名前', 'pod name', { repeat: '*' })] }], dashDash: { then: [{ name: 'COMMAND', text: COMMAND_TEXT, command: { run: 'exec', where: 'container', env: 'none' } }] } }),
    debug: cmd('Pod にデバッグ用のコンテナを付けて起動する（`--` の後がそのコンテナで実行するコマンド）', 'Attach a debugging container to a pod (the command to run follows `--`)', [...kubeFiles, ['--image', 'デバッグ用のコンテナイメージ', 'image of the debugging container', 'arg'], ['-i|--stdin', '標準入力をつなぐ', 'pass stdin'], ['-t|--tty', '端末を割り当てる', 'allocate a TTY'], ['-c|--container', 'デバッグ用コンテナの名前', 'name of the debugging container', 'arg'], ['--target', '名前空間を共有するコンテナ', 'container whose process namespace to share', 'arg']], { operands: [{ pattern: [operand('POD', 'Pod', 'pod', { repeat: '*' })] }], dashDash: { then: [{ name: 'COMMAND', text: COMMAND_TEXT, command: { run: 'exec', where: 'container', env: 'none' } }] } }),
    'port-forward': cmd('手元のポートを Pod やサービスにつなぐ', 'Forward local ports to a pod or service', kubeFiles, { positional: [pos('Pod やサービス', 'pod or service'), pos('ポート（`手元:相手`）', 'ports (`local:remote`)')] }),
    rollout: cmd('デプロイの進み具合を操作する（`status`、`restart`、`undo`）', 'Manage rollouts (`status`, `restart`, `undo`)', [...kubeFiles, kubeOutput, kubeSelector, kubeWatch, kubeDryRun, kubeTimeout]),
    wait: cmd('条件を満たすまで待つ（`--for=condition=Ready`）', 'Wait for a condition (`--for=condition=Ready`)', [...kubeFiles, kubeOutput, kubeSelector, kubeAll, kubeTimeout, ['--for', '待つ条件（`condition=Ready`、`delete`…）', 'condition to wait for (`condition=Ready`, `delete`…)', 'arg']], { positional: [resource] }),
    config: cmd('kubeconfig を操作する（`use-context`、`current-context`…）', 'Manage kubeconfig (`use-context`, `current-context`…)', [kubeOutput]),
    'cluster-info': cmd('クラスターの情報を表示する', 'Show cluster information', kubeFiles),
    scale: cmd('レプリカ数を変える', 'Change the number of replicas', [...kubeFiles, kubeOutput, kubeSelector, kubeAll, kubeDryRun, kubeTimeout, ['--replicas', 'レプリカ数', 'number of replicas', 'arg']], { positional: [resource] }),
    patch: cmd('リソースの一部を書き換える', 'Change part of a resource', [...kubeFiles, kubeOutput, kubeDryRun, ['-p|--patch', '書き換える内容（JSON か YAML）', 'the patch (JSON or YAML)', 'arg'], ['--type', '書き換え方（`merge`、`json`、`strategic`）', 'patch type (`merge`, `json`, `strategic`)', 'arg']], { positional: [resource] }),
    label: cmd('ラベルを付ける', 'Set labels', [...kubeFiles, kubeOutput, kubeSelector, kubeAll, kubeDryRun], { positional: [resource] }),
    annotate: cmd('注釈を付ける', 'Set annotations', [...kubeFiles, kubeOutput, kubeSelector, kubeAll, kubeDryRun], { positional: [resource] }),
    version: cmd('クライアントとサーバーの版を表示する', 'Show client and server versions', [kubeOutput]),
    top: cmd('Pod やノードの CPU とメモリの使用量を表示する（`pod`、`node`）', 'Show the CPU and memory use of pods or nodes (`pod`, `node`)', [], {
      subcommands: {
        pod: { ...cmd('Pod の CPU とメモリの使用量を表示する', 'Show the CPU and memory use of pods', [kubeAll, kubeSelector,
          ['--containers', 'Pod の中のコンテナごとに表示する', 'show each container of the pods'],
          ['--sort-by', '並べる基準（`cpu`、`memory`）', 'sort by (`cpu`, `memory`)', 'arg'],
          ['--no-headers', '見出しの行を出さない', 'print no header line']], { positional: [pos('Pod の名前', 'pod name')] }), aliases: ['pods', 'po'] },
        node: { ...cmd('ノードの CPU とメモリの使用量を表示する', 'Show the CPU and memory use of nodes', [kubeSelector,
          ['--sort-by', '並べる基準（`cpu`、`memory`）', 'sort by (`cpu`, `memory`)', 'arg'],
          ['--no-headers', '見出しの行を出さない', 'print no header line']], { positional: [pos('ノードの名前', 'node name')] }), aliases: ['nodes', 'no'] },
      },
    }),
    'api-resources': cmd('サーバーが扱うリソースの種類を一覧表示する', 'List the resource types the server supports', [
      ['-o|--output', '出力形式（`wide`、`name`）', 'output format (`wide`, `name`)', 'arg'],
      ['--namespaced', '名前空間に属する種類だけ（`--namespaced=false` で属さないもの）', 'only the namespaced types (`--namespaced=false`: the others)'],
      ['--api-group', '指定した API グループの種類だけ', 'only the types of the given API group', 'arg'],
      ['--verbs', '指定した操作ができる種類だけ（`list,get`）', 'only the types that support the given verbs (`list,get`)', 'arg'],
    ]),
    events: cmd('イベントを一覧表示する', 'List events', [kubeOutput, kubeAll, kubeWatch,
      ['--for', '指定したリソースのイベントだけ（`pod/web`）', 'only the events of the given resource (`pod/web`)', 'arg'],
      ['--types', '指定した種類のイベントだけ（`Warning`、`Normal`）', 'only events of the given types (`Warning`, `Normal`)', 'arg']]),
    explain: cmd('リソースの種類とその項目の説明を表示する（`pods.spec.containers`）', 'Show the documentation of a resource type and its fields (`pods.spec.containers`)', [
      ['--recursive', '下の項目をすべて表示する', 'show every field below'],
      ['--api-version', '説明する API の版', 'API version to document', 'arg'],
      ['--output', '形式（`plaintext`、`plaintext-openapiv2`）', 'format (`plaintext`, `plaintext-openapiv2`)', 'arg'],
    ], { positional: [pos('リソースの種類と項目（`pods.spec`）', 'resource type and field (`pods.spec`)')] }),
  },
});

/** helm's global options (`helm --help`), which every subcommand takes too; helm finds its subcommand as cobra does. */
const helmGlobal: OptSpec[] = persistent([
  ['-n|--namespace', '対象の名前空間', 'namespace', 'arg'],
  ['--kube-context', '使う kubeconfig のコンテキスト（クラスター）', 'kubeconfig context (cluster) to use', 'arg'],
  ['--kubeconfig', '使う kubeconfig のファイル', 'kubeconfig file to use', 'arg'],
  ['--debug', '詳しく表示する', 'verbose output'],
  ['--kube-apiserver', 'API サーバーのアドレスとポート', 'address and port of the API server', 'arg'],
  ['--kube-as-user', '指定したユーザーになりすまして操作する', 'act as the given user (impersonation)', 'arg'],
  ['--kube-as-group', '指定したグループになりすまして操作する', 'act as the given group (impersonation)', 'arg'],
  ['--kube-token', '認証に使うベアラートークン', 'bearer token for authentication', 'arg'],
  ['--kube-ca-file', 'API サーバーの CA 証明書のファイル', 'certificate authority file of the API server', 'arg'],
  ['--kube-insecure-skip-tls-verify', 'API サーバーの証明書を検証しない（危険）', 'do not verify the certificate of the API server (insecure)'],
  ['--registry-config', 'レジストリの設定ファイル', 'registry configuration file', 'arg'],
  ['--repository-config', 'リポジトリの一覧のファイル', 'file that lists the repositories', 'arg'],
  ['--repository-cache', 'リポジトリの索引のキャッシュのディレクトリ', 'directory of the cached repository indexes', 'arg'],
]);
/** Options of the subcommands that install or render a chart. */
const helmCommon: OptSpec[] = [
  ['-f|--values', '値のファイル（values.yaml）', 'values file', 'arg'],
  ['--set', '値を1つ上書きする（`キー=値`）', 'set one value (`key=value`)', 'arg'],
  ['--create-namespace', '名前空間がなければ作る', 'create the namespace if missing'],
  ['--version', 'チャートの版', 'chart version', 'arg'],
  ['--wait', 'リソースが準備できるまで待つ', 'wait until the resources are ready'],
  ['--timeout', '待つ時間の上限', 'how long to wait', 'arg'],
];
const helmWait: OptSpec[] = [['--wait', 'リソースが消えるまで待つ', 'wait until the resources are deleted'], ['--timeout', '待つ時間の上限', 'how long to wait', 'arg']];

// ---- Clouds ---------------------------------------------------------------------------------------

const tfCommon: OptSpec[] = [
  ['-auto-approve', '確認せずに適用する（CI 向け）', 'apply without asking (for CI)'],
  ['-input=false', '入力を求めない', 'never ask for input'],
  ['-var', '変数を1つ渡す（`-var "名前=値"`）', 'set one variable (`-var "name=value"`)', 'arg'],
  ['-var-file', '変数のファイル（`.tfvars`）', 'variables file (`.tfvars`)', 'arg'],
  ['-out', '計画を保存するファイル', 'file to save the plan in', 'arg'],
  ['-target', '指定したリソースだけを対象にする', 'only the given resource', 'arg'],
  ['-backend-config', 'バックエンドの設定（`init`）', 'backend configuration (`init`)', 'arg'],
  ['-upgrade', 'プロバイダやモジュールを更新する（`init`）', 'upgrade providers and modules (`init`)'],
  ['-check', '整形が必要なら失敗する（`fmt`）', 'fail if formatting is needed (`fmt`)'],
  ['-recursive', 'サブディレクトリも（`fmt`）', 'subdirectories too (`fmt`)'],
  ['-raw', '値だけを出力する（`output`）', 'print the raw value (`output`)'],
  ['-json', 'JSON で出力', 'JSON output'],
];
const tf = (ja: string, en: string): CommandSpec => cmd(ja, en, tfCommon, { style: 'single-dash' });

const awsCommon: OptSpec[] = [
  ['--region', 'リージョン（`ap-northeast-1`…）', 'region (`ap-northeast-1`…)', 'arg'],
  ['--profile', '使う認証情報のプロファイル', 'credentials profile', 'arg'],
  ['--output', '出力形式（`json`、`text`、`table`、`yaml`）', 'output format (`json`, `text`, `table`, `yaml`)', 'arg'],
  ['--query', '出力を JMESPath で絞る', 'filter the output with JMESPath', 'arg'],
  ['--no-cli-pager', 'ページャを使わない', 'do not use a pager'],
  ['--endpoint-url', '接続先を変える（互換サービス、ローカル環境）', 'use another endpoint (compatible services, local)', 'arg'],
];

const gcloudCommon: OptSpec[] = [
  ['--project', 'プロジェクト', 'project', 'arg'], ['--region', 'リージョン', 'region', 'arg'], ['--zone', 'ゾーン', 'zone', 'arg'],
  ['--format', '出力形式（`json`、`value(…)`…）', 'output format (`json`, `value(…)`…)', 'arg'], ['--quiet|-q', '確認しない', 'do not ask for confirmation'],
];

// ---- System administration ------------------------------------------------------------------------

const iptables: OptSpec[] = [
  ['-A|--append', '規則を指定したチェーンの末尾に足す', 'append a rule to the given chain', 'arg'], ['-I|--insert', '規則をチェーンの先頭に入れる', 'insert a rule at the top', 'arg'],
  ['-D|--delete', '規則を削除する', 'delete a rule', 'arg'], ['-L|--list', '規則を一覧表示する', 'list rules'], ['-S|--list-rules', '規則をコマンドの形で表示する', 'print rules as commands'],
  ['-F|--flush', '規則をすべて削除する', 'delete all rules'], ['-t|--table', '表（`filter`、`nat`、`mangle`）', 'table (`filter`, `nat`, `mangle`)', 'arg'],
  ['-p|--protocol', 'プロトコル', 'protocol', 'arg'], ['-s|--source', '送信元', 'source', 'arg'], ['-d|--destination', '宛先', 'destination', 'arg'],
  ['--dport', '宛先ポート', 'destination port', 'arg'], ['-j|--jump', '一致したときの動作（`ACCEPT`、`DROP`、`DNAT`…）', 'target (`ACCEPT`, `DROP`, `DNAT`…)', 'arg'],
  ['-n|--numeric', '名前に変換せず数字で表示', 'numeric output'], ['-v|--verbose', '詳しく表示', 'verbose'],
  ['-w|--wait', 'ロックが空くまで待つ', 'wait for the lock'],
];

export const ops: Record<string, CommandSpec> = {
  kubectl,
  uv: cmd('Python のパッケージ・プロジェクト管理ツール（uv）', 'Python package and project manager (uv)', [], {
    subcommands: { run: cmd('環境を整えてからコマンドやスクリプトを実行する', 'Run a command or script in the project environment', [['--with', '一時的に加えるパッケージ', 'an extra package to add temporarily', 'arg'], ['--no-sync', '実行前に環境を同期しない', 'do not sync the environment first']], { style: 'posix', operands: [{ pattern: [runs()] }] }) },
  }),
  poetry: cmd('Python のパッケージ・プロジェクト管理ツール（Poetry）', 'Python package and project manager (Poetry)', [], {
    subcommands: { run: cmd('仮想環境の中でコマンドを実行する', 'Run a command in the virtual environment', [], { style: 'posix', operands: [{ pattern: [runs()] }] }) },
  }),
  helm: cmd('Kubernetes のパッケージ（チャート）を管理する', 'Kubernetes package (chart) manager', helmGlobal, {
    cobra: true,
    subcommands: {
      install: cmd('チャートを入れる（`名前 チャート`）', 'Install a chart (`name chart`)', helmCommon, { positional: [pos('リリース名', 'release name'), pos('チャート', 'chart')] }),
      upgrade: cmd('リリースを更新する（`--install` でなければ入れる）', 'Upgrade a release (`--install`: install if missing)', [...helmCommon, ['-i|--install', 'なければ入れる', 'install if missing']], { positional: [pos('リリース名', 'release name'), pos('チャート', 'chart')] }),
      uninstall: cmd('リリースを削除する', 'Uninstall a release', helmWait, { positional: [pos('リリース名', 'release name')] }),
      template: cmd('マニフェストを生成して表示する（クラスターには適用しない）', 'Render the manifests without applying them', helmCommon, { positional: [pos('リリース名', 'release name'), pos('チャート', 'chart')] }),
      lint: cmd('チャートを検査する', 'Check a chart', helmCommon.slice(0, 2), { positional: [pos('チャートのディレクトリ', 'chart directory')] }),
      repo: cmd('チャートのリポジトリを管理する（`add`、`update`）', 'Manage chart repositories (`add`, `update`)'),
      dependency: cmd('チャートの依存を管理する（`update`、`build`）', "Manage a chart's dependencies (`update`, `build`)"),
      package: cmd('チャートを .tgz にまとめる', 'Package a chart into a .tgz'),
      list: cmd('リリースを一覧表示する', 'List releases', [['-A|--all-namespaces', 'すべての名前空間', 'all namespaces']]),
      push: cmd('チャートを OCI レジストリに送る', 'Push a chart to an OCI registry'),
      version: cmd('版を表示する', 'Show the version'),
    },
  }),
  kustomize: cmd('Kubernetes のマニフェストを重ね合わせて組み立てる', 'Build Kubernetes manifests from bases and overlays', [], {
    subcommands: {
      build: cmd('マニフェストを組み立てて出力する（`| kubectl apply -f -` へ）', 'Build and print the manifests (for `| kubectl apply -f -`)', [], { positional: [pos('kustomization のディレクトリ', 'kustomization directory')] }),
      edit: cmd('kustomization.yaml を書き換える（`set image`…）', 'Edit kustomization.yaml (`set image`…)'),
    },
  }),
  kind: cmd('Docker の中に Kubernetes のクラスターを作る（テスト用）', 'Run Kubernetes clusters in Docker (for testing)', [['--name', 'クラスター名', 'cluster name', 'arg']], {
    subcommands: {
      create: cmd('クラスターを作る（`create cluster`）', 'Create a cluster (`create cluster`)', [['--name', 'クラスター名', 'cluster name', 'arg'], ['--config', '設定ファイル', 'configuration file', 'arg'], ['--image', 'ノードのイメージ', 'node image', 'arg'], ['--wait', '準備できるまで待つ', 'wait until ready', 'arg']]),
      delete: cmd('クラスターを削除する（`delete cluster`）', 'Delete a cluster (`delete cluster`)', [['--name', 'クラスター名', 'cluster name', 'arg']]),
      load: cmd('イメージをクラスターに読み込む（`load docker-image`）', 'Load images into the cluster (`load docker-image`)', [['--name', 'クラスター名', 'cluster name', 'arg']]),
      export: cmd('ログや kubeconfig を書き出す（`export logs`）', 'Export logs or kubeconfig (`export logs`)', [['--name', 'クラスター名', 'cluster name', 'arg']]),
      get: cmd('クラスターやノードを一覧表示する', 'List clusters or nodes'),
    },
  }),
  kubeadm: cmd('Kubernetes のクラスターを構築する（`init`、`join`、`reset`）', 'Set up Kubernetes clusters (`init`, `join`, `reset`)', [['--config', '設定ファイル', 'configuration file', 'arg']]),
  // Before the subcommand terraform takes only `-chdir=DIR` (with `=`), and the version and help options; any
  // other option there stops it ("Invalid flags before the subcommand"). The subcommands take the options.
  terraform: cmd('Terraform: インフラをコードで管理する', 'Terraform: infrastructure as code', [
    ['-chdir', '指定したディレクトリで実行する（`-chdir=ディレクトリ` と `=` で書き、サブコマンドより前に置く。`-chdir ディレクトリ` は terraform がエラーにする）', 'run in the given directory (written `-chdir=DIR`, with `=`, before the subcommand; terraform rejects `-chdir DIR`)', 'attached'],
    ['-version|-v|--version', '版を表示する', 'print the version'],
    ...persistent([['-help|-h|--help', 'ヘルプを表示する', 'show help']]),
  ], {
    style: 'single-dash',
    patternOptions: [{
      pattern: /^-(?!chdir=)./,
      text: () => tx('⚠ サブコマンドより前のオプション。terraform がここで受け付けるのは `-chdir=…`、`-version`、`-help` だけで、ほかは「Invalid flags before the subcommand」で止まる。サブコマンドの後に書く',
        '⚠ an option before the subcommand: terraform takes only `-chdir=…`, `-version` and `-help` there, and stops with "Invalid flags before the subcommand" on any other; write it after the subcommand'),
    }],
    subcommands: {
      init: tf('作業ディレクトリを準備する（プロバイダやモジュールを取得）', 'Prepare the working directory (download providers and modules)'),
      plan: tf('変更の計画を表示する（まだ変更しない）', 'Show the planned changes (nothing changes yet)'),
      apply: tf('変更を適用する', 'Apply the changes'),
      destroy: tf('管理しているリソースをすべて削除する（注意）', 'Destroy all managed resources (careful!)'),
      validate: tf('設定の文法を確かめる', 'Check the configuration'),
      fmt: tf('設定ファイルを整形する', 'Format the configuration files'),
      output: tf('出力値を表示する', 'Show output values'),
      import: tf('既存のリソースを管理下に入れる', 'Bring an existing resource under management'),
      state: tf('状態（state）を操作する（`list`、`show`、`mv`、`rm`）', 'Work with the state (`list`, `show`, `mv`, `rm`)'),
      workspace: tf('ワークスペースを操作する（`select`、`new`）', 'Work with workspaces (`select`, `new`)'),
      providers: tf('使うプロバイダを表示する', 'Show the providers used'),
      version: tf('版を表示する', 'Show the version'),
    },
  }),
  aws: cmd('AWS CLI（サービスとコマンドの組み合わせで操作する: `aws s3 cp`）', 'AWS CLI (a service and a command: `aws s3 cp`)', persistent(awsCommon), {
    subcommands: {
      s3: cmd('S3 のファイルを操作する（`cp`、`sync`、`ls`、`rm`）', 'Work with S3 files (`cp`, `sync`, `ls`, `rm`)', [['--recursive', 'ディレクトリごと', 'recursively'], ['--delete', '転送元にないものを削除する（`sync`）', 'delete files missing from the source (`sync`)'], ['--exclude', '除外するパターン', 'exclude pattern', 'arg'], ['--include', '含めるパターン', 'include pattern', 'arg']]),
      sts: cmd('認証情報を扱う（`get-caller-identity` で今の身元）', 'Security tokens (`get-caller-identity`: who am I)', []),
      ec2: cmd('EC2（仮想マシン、ネットワーク）を操作する', 'Work with EC2 (virtual machines, networks)', []),
      ecr: cmd('ECR（コンテナのレジストリ）を操作する（`get-login-password`）', 'Work with ECR, the container registry (`get-login-password`)', []),
      eks: cmd('EKS（Kubernetes）を操作する（`update-kubeconfig`）', 'Work with EKS, Kubernetes (`update-kubeconfig`)', [['--name', 'クラスター名', 'cluster name', 'arg']]),
      ssm: cmd('Systems Manager（パラメータやコマンド実行）を操作する', 'Work with Systems Manager (parameters, commands)', []),
      iam: cmd('IAM（ユーザーと権限）を操作する', 'Work with IAM (users and permissions)', []),
      configure: cmd('認証情報と既定の設定を登録・表示する', 'Set or show credentials and defaults', []),
      cloudformation: cmd('CloudFormation のスタックを操作する', 'Work with CloudFormation stacks', []),
      lambda: cmd('Lambda の関数を操作する', 'Work with Lambda functions', []),
      logs: cmd('CloudWatch Logs を操作する（`tail`）', 'Work with CloudWatch Logs (`tail`)', []),
    },
  }),
  gcloud: cmd('Google Cloud CLI（`gcloud グループ コマンド`）', 'Google Cloud CLI (`gcloud group command`)', persistent(gcloudCommon), {
    subcommands: {
      auth: cmd('認証する（`login`、`activate-service-account`、`configure-docker`）', 'Authenticate (`login`, `activate-service-account`, `configure-docker`)', []),
      config: cmd('設定を表示・変更する（`set project`…）', 'Show or change settings (`set project`…)', []),
      container: cmd('GKE（Kubernetes）を操作する（`clusters get-credentials`…）', 'Work with GKE, Kubernetes (`clusters get-credentials`…)', []),
      compute: cmd('Compute Engine（仮想マシン、ネットワーク）を操作する', 'Work with Compute Engine (virtual machines, networks)', []),
      run: cmd('Cloud Run を操作する（`deploy`）', 'Work with Cloud Run (`deploy`)', []),
      storage: cmd('Cloud Storage のファイルを操作する（`cp`、`ls`、`rm`）', 'Work with Cloud Storage files (`cp`, `ls`, `rm`)', []),
      artifacts: cmd('Artifact Registry を操作する', 'Work with Artifact Registry', []),
      builds: cmd('Cloud Build を操作する（`submit`）', 'Work with Cloud Build (`submit`)', []),
      iam: cmd('IAM（権限）を操作する', 'Work with IAM (permissions)', []),
      projects: cmd('プロジェクトを操作する', 'Work with projects', []),
      dns: cmd('Cloud DNS を操作する', 'Work with Cloud DNS', []),
      secrets: cmd('Secret Manager を操作する', 'Work with Secret Manager', []),
    },
  }),
  gsutil: cmd('Cloud Storage を操作する（古い CLI。今は `gcloud storage`）', 'Work with Cloud Storage (older CLI; today `gcloud storage`)', [['-m', '並列に処理する', 'run in parallel'], ['-q', '表示を減らす', 'quiet']], {
    subcommands: {
      cp: cmd('ファイルをコピーする（`gs://…`）', 'Copy files (`gs://…`)', [['-r|-R', 'ディレクトリごと', 'recursively']]),
      rsync: cmd('ディレクトリを同期する', 'Synchronise directories', [['-r', 'ディレクトリごと', 'recursively'], ['-d', '転送元にないものを削除する', 'delete files missing from the source']]),
      ls: cmd('ファイルを一覧表示する', 'List files'), rm: cmd('ファイルを削除する', 'Delete files', [['-r', 'ディレクトリごと', 'recursively']]), cat: cmd('ファイルの中身を表示する', 'Print files'),
    },
  }),
  az: cmd('Azure CLI（`az グループ コマンド`）', 'Azure CLI (`az group command`)', [
    ['-g|--resource-group', 'リソースグループ', 'resource group', 'arg'], ['-n|--name', '名前', 'name', 'arg'], ['--subscription', 'サブスクリプション', 'subscription', 'arg'],
    ['-o|--output', '出力形式（`json`、`tsv`、`table`）', 'output format (`json`, `tsv`, `table`)', 'arg'], ['--query', '出力を JMESPath で絞る', 'filter the output with JMESPath', 'arg'],
  ]),
  cosign: cmd('コンテナイメージなどに署名し、検証する（Sigstore）', 'Sign and verify container images and more (Sigstore)', [['--yes|-y', '確認しない', 'do not ask for confirmation'], ['--key', '鍵（省略時は OIDC によるキーレス）', 'key (default: keyless with OIDC)', 'arg']], {
    subcommands: {
      sign: cmd('署名する', 'Sign', [['--yes|-y', '確認しない', 'do not ask for confirmation'], ['--key', '鍵（省略時は OIDC によるキーレス）', 'key (default: keyless with OIDC)', 'arg']], { positional: [pos('イメージ', 'image')] }),
      verify: cmd('署名を検証する', 'Verify signatures', [['--key', '公開鍵', 'public key', 'arg'], ['--certificate-identity', '署名者として期待する ID', 'expected signer identity', 'arg'], ['--certificate-oidc-issuer', '期待する OIDC の発行者', 'expected OIDC issuer', 'arg']], { positional: [pos('イメージ', 'image')] }),
      'sign-blob': cmd('ファイルに署名する', 'Sign a file'), 'verify-blob': cmd('ファイルの署名を検証する', "Verify a file's signature"),
    },
  }),

  // ---- JavaScript and Ruby tools ----
  npx: cmd('npm のパッケージのコマンドを実行する（なければ一時的に取得）', "Run a package's command (fetching it if needed)", [
    ['--yes|-y', '取得の確認をしない', 'do not ask before fetching'], ['--package|-p', 'コマンドを含むパッケージ（`名前@版`）', 'package that provides the command (`name@version`)', 'arg'],
  ], { style: 'posix', operands: [{ pattern: [runs()] }] }),
  pnpm: cmd('Node.js のパッケージマネージャ（pnpm）', 'Node.js package manager (pnpm)', [['--frozen-lockfile', 'pnpm-lock.yaml を書き換えない（CI 向け）', 'do not change pnpm-lock.yaml (for CI)'], ['-r|--recursive', 'ワークスペースのすべてのパッケージで', 'in every workspace package'], ['--filter|-F', '対象のパッケージ', 'packages to act on', 'arg']], {
    subcommands: {
      install: cmd('依存をインストールする', 'Install dependencies', [['--frozen-lockfile', 'pnpm-lock.yaml を書き換えない（CI 向け）', 'do not change pnpm-lock.yaml (for CI)'], ['--prod|-P', '開発用の依存を入れない', 'skip development dependencies']]),
      i: cmd('依存をインストールする（`install` と同じ）', 'Install dependencies (same as `install`)', [['--frozen-lockfile', 'pnpm-lock.yaml を書き換えない（CI 向け）', 'do not change pnpm-lock.yaml (for CI)']]),
      add: cmd('依存を追加する', 'Add dependencies', [['-D|--save-dev', '開発用の依存として', 'as development dependencies']]),
      run: cmd('package.json の scripts を実行する', 'Run a package.json script'),
      exec: cmd('依存に入っているコマンドを実行する', 'Run a command from the dependencies'),
    },
  }),
  bundle: cmd('Ruby の依存を管理する（Bundler）', 'Manage Ruby dependencies (Bundler)', [], {
    subcommands: {
      install: cmd('Gemfile の依存を入れる', "Install the Gemfile's dependencies", [['--jobs|-j', '並列数', 'parallel jobs', 'arg'], ['--deployment', '本番向けに Gemfile.lock どおりに入れる', 'install exactly from Gemfile.lock, for production']]),
      exec: cmd('Bundler の環境でコマンドを実行する', "Run a command in the bundle's environment"),
      update: cmd('依存を更新する', 'Update dependencies'),
    },
  }),
  'golangci-lint': cmd('Go の静的解析ツールをまとめて実行する', 'Run many Go linters at once', [['--timeout', '時間切れ', 'timeout', 'arg'], ['--fix', '直せるものは直す', 'fix what can be fixed'], ['-c|--config', '設定ファイル', 'configuration file', 'arg'], ['--version', '版を表示する', 'print the version']], {
    subcommands: { run: cmd('検査する', 'Run the linters', [['--timeout', '時間切れ', 'timeout', 'arg'], ['--fix', '直せるものは直す', 'fix what can be fixed'], ['-c|--config', '設定ファイル', 'configuration file', 'arg']], { positional: [pos('パッケージ（`./...`）', 'packages (`./...`)')] }) },
  }),
  mkdocs: cmd('Markdown からドキュメントのサイトを作る（MkDocs）', 'Build documentation sites from Markdown (MkDocs)', [], {
    subcommands: { build: cmd('サイトを作る', 'Build the site', [['--strict', '警告をエラーにする', 'treat warnings as errors']]), serve: cmd('手元で表示する（変更に追従）', 'Serve locally (rebuilding on changes)'), 'gh-deploy': cmd('GitHub Pages に公開する', 'Deploy to GitHub Pages') },
  }),
  rpmbuild: cmd('RPM パッケージを作る', 'Build RPM packages', [['-bb', 'バイナリのパッケージを作る', 'build binary packages'], ['-ba', 'バイナリとソースのパッケージを作る', 'build binary and source packages'], ['-v', '詳しく表示する', 'verbose'], ['--define', 'マクロを定義する', 'define a macro', 'arg']], { positional: [pos('spec ファイル', 'spec file')], style: 'single-dash' }),

  // ---- Users ----
  usermod: cmd('ユーザーの設定を変える', 'Change a user', [
    ['-aG', '既存のグループに加えて追加する（`-a` なしの `-G` は置き換え）', 'add to these groups, keeping the others (`-G` without `-a` replaces them)', 'arg'],
    ['-a|--append', '`-G` と使い、グループを置き換えずに追加する', 'with `-G`, add to groups instead of replacing them'], ['-G|--groups', '所属するグループ（`-a` なしでは置き換え）', 'groups (replaced unless `-a`)', 'arg'],
    ['-g|--gid', '主グループ', 'primary group', 'arg'], ['-s|--shell', 'ログインシェル', 'login shell', 'arg'], ['-d|--home', 'ホームディレクトリ', 'home directory', 'arg'],
    ['-u|--uid', 'ユーザー ID', 'user ID', 'arg'], ['-L|--lock', 'パスワードでのログインを止める', 'lock the password'],
  ], { positional: [user] }),
  userdel: cmd('ユーザーを削除する', 'Delete a user', [['-r|--remove', 'ホームディレクトリとメールも削除する', 'remove the home directory and mail too'], ['-f|--force', '強制する', 'force']], { positional: [user] }),
  chsh: cmd('ログインシェルを変える', 'Change the login shell', [['-s|--shell', '新しいシェル', 'new shell', 'arg']], { positional: [user] }),

  // ---- SSH ----
  'ssh-keygen': cmd('SSH の鍵を作る・管理する', 'Create and manage SSH keys', [
    ['-t', '鍵の種類（`ed25519`、`rsa`…）', 'key type (`ed25519`, `rsa`…)', 'arg'], ['-b', '鍵の長さ（ビット）', 'key size in bits', 'arg'], ['-f', '鍵のファイル', 'key file', 'arg'],
    ['-N', '新しいパスフレーズ（`""` でなし）', 'new passphrase (`""`: none)', 'arg'], ['-C', 'コメント（メールアドレスなど）', 'comment (e-mail…)', 'arg'], ['-q', '表示しない', 'quiet'],
    ['-A', 'ホスト鍵をすべての種類で作る', 'generate all missing host keys'], ['-l', '鍵の指紋を表示する', "show a key's fingerprint"], ['-R', 'known_hosts から指定したホストを消す', 'remove the given host from known_hosts', 'arg'], ['-y', '秘密鍵から公開鍵を出力する', 'print the public key of a private key'],
  ]),
  'ssh-keyscan': cmd('ホストの公開鍵を取得する（known_hosts に足すため）', "Fetch hosts' public keys (to add to known_hosts)", [['-t', '鍵の種類', 'key type', 'arg'], ['-p', 'ポート', 'port', 'arg'], ['-H', 'ホスト名をハッシュにする', 'hash the host names']], { positional: [pos('ホスト', 'host')] }),

  // ---- Disks, kernel and services ----
  dd: cmd('データをブロック単位でコピー・変換する（ディスクの書き込みに注意）', 'Copy and convert data in blocks (careful when writing to disks)', [], {
    positional: [pos('`if=入力` `of=出力` `bs=ブロックの大きさ` `count=ブロック数` `status=progress` などの指定', 'settings such as `if=input`, `of=output`, `bs=block size`, `count=blocks`, `status=progress`')],
  }),
  lsblk: cmd('ブロックデバイス（ディスクとパーティション）を一覧表示する', 'List block devices (disks and partitions)', [['-f|--fs', 'ファイルシステムも表示', 'show file systems'], ['-o|--output', '表示する列', 'columns to show', 'arg'], ['-n|--noheadings', '見出しを出さない', 'no header'], ['-d|--nodeps', 'パーティションを出さない', 'no partitions'], ['-J|--json', 'JSON で出力', 'JSON output'], ['-p|--paths', '完全なパス', 'full paths']], { positional: [device] }),
  blkid: cmd('ブロックデバイスの種類や UUID を表示する', 'Show the type and UUID of block devices', [['-s', '指定した項目だけ（`UUID`、`TYPE`）', 'only the given tag (`UUID`, `TYPE`)', 'arg'], ['-o', '出力形式（`value` で値だけ）', 'output format (`value`: values only)', 'arg']], { positional: [device] }),
  findmnt: cmd('マウントされているファイルシステムを表示する', 'Show mounted file systems', [['-t|--types', '種類で絞る', 'filter by type', 'arg'], ['-o|--output', '表示する列', 'columns to show', 'arg'], ['-n|--noheadings', '見出しを出さない', 'no header'], ['-l|--list', '木でなく一覧で', 'list instead of a tree'], ['-u|--notruncate', '切り詰めない', 'do not truncate']], { positional: [pos('マウント先またはデバイス', 'mount point or device')] }),
  umount: cmd('ファイルシステムのマウントを外す', 'Unmount file systems', [['-l|--lazy', '使われなくなってから外す', 'detach now, clean up when no longer busy'], ['-f|--force', '強制する', 'force'], ['-a|--all', 'すべて', 'all']], { positional: [pos('マウント先またはデバイス', 'mount point or device')] }),
  sync: cmd('書き込み待ちのデータをディスクに書き出す', 'Write cached data to disk'),
  modprobe: cmd('カーネルモジュールを読み込む・外す', 'Load or remove kernel modules', [['-r|--remove', '外す', 'remove'], ['-n|--dry-run', '実際には行わない', 'do not actually do it'], ['-v|--verbose', '詳しく表示', 'verbose']], { positional: [pos('モジュール名', 'module name')] }),
  dmesg: cmd('カーネルのメッセージを表示する', 'Show kernel messages', [['-T|--ctime', '人が読める時刻で', 'human-readable timestamps'], ['-w|--follow', '新しいメッセージを待ち続ける', 'wait for new messages'], ['-l|--level', '指定した重要度だけ', 'only these levels', 'arg']]),
  uptime: cmd('起動からの時間と負荷を表示する', 'Show how long the system has been up, and the load', [['-p|--pretty', '読みやすい形で', 'pretty format'], ['-s|--since', '起動した日時', 'boot time']]),
  service: cmd('サービスを操作する（SysV init。systemd では `systemctl` に渡される）', 'Control services (SysV init; with systemd it calls `systemctl`)', [['--status-all', 'すべてのサービスの状態', 'status of all services']], { positional: [pos('サービス名', 'service name'), pos('操作（`start`、`stop`、`restart`、`status`）', 'action (`start`, `stop`, `restart`, `status`)')] }),
  killall: cmd('名前でプロセスにシグナルを送る（既定は終了）', 'Send a signal to processes by name (terminate by default)', [['-s|--signal', '送るシグナル', 'signal to send', 'arg'], ['-q|--quiet', '見つからなくても何も言わない', 'say nothing if none were found'], ['-w|--wait', '終わるまで待つ', 'wait for them to end']], { positional: [pos('プロセス名', 'process name')] }),
  logger: cmd('システムのログ（syslog / journal）に書く', 'Write to the system log (syslog/journal)', [['-t|--tag', 'タグ', 'tag', 'arg'], ['-p|--priority', '重要度（`user.err`…）', 'priority (`user.err`…)', 'arg'], ['-s|--stderr', '標準エラーにも出す', 'also write to stderr']], { positional: [pos('メッセージ', 'message')] }),
  getenforce: cmd('SELinux のモード（Enforcing / Permissive / Disabled）を表示する', 'Show the SELinux mode (Enforcing, Permissive or Disabled)'),
  iptables: cmd('Linux のパケットフィルタ（ファイアウォール）の規則を操作する', 'Manage Linux packet filter (firewall) rules', iptables),
  ip6tables: cmd('IPv6 のパケットフィルタの規則を操作する', 'Manage IPv6 packet filter rules', iptables),
  'iptables-save': cmd('パケットフィルタの規則をすべて出力する（`iptables-restore` で戻せる形）', 'Print all packet filter rules (in a form `iptables-restore` reads)', [['-t|--table', '指定した表だけ', 'only the given table', 'arg'], ['-c|--counters', 'カウンタも', 'include counters']]),
  'iptables-restore': cmd('`iptables-save` の出力から規則を読み込む', 'Load rules saved by `iptables-save`', [['-n|--noflush', '今の規則を削除せずに足す', 'add to the current rules instead of replacing them'], ['-w|--wait', 'ロックが空くまで待つ', 'wait for the lock']], { positional: [files] }),

  // ---- Text and numbers ----
  envsubst: cmd('テキスト中の `$VAR` や `${VAR}` を環境変数の値に置き換える（テンプレート用）', 'Replace `$VAR` and `${VAR}` in text with environment variables (for templates)', [], {
    positional: [pos('置き換える変数だけを並べたもの（`\'$A $B\'`。省略時はすべて）', "the variables to replace (`'$A $B'`; default: all)")],
  }),
  bc: cmd('任意精度の計算機（小数の計算に。`echo "1.5*2" | bc`）', 'Arbitrary-precision calculator (for decimals: `echo "1.5*2" | bc`)', [['-l|--mathlib', '小数と数学関数を使えるようにする', 'decimals and the math library'], ['-q|--quiet', '起動時の表示を出さない', 'no banner']]),

  // ---- macOS ----
  defaults: cmd('macOS の設定（defaults）を読み書きする', 'Read and write macOS preferences (defaults)', [
    ['-g|-globalDomain', 'すべてのアプリに共通の設定', 'the global domain, shared by all apps'], ['-bool', '真偽値', 'boolean value'], ['-int', '整数', 'integer value'],
    ['-float', '小数', 'floating-point value'], ['-string', '文字列', 'string value'], ['-array', '配列', 'array value'], ['-dict', '辞書', 'dictionary value'],
  ], {
    style: 'single-dash',
    subcommands: {
      write: cmd('設定を書く（`ドメイン キー -型 値`）', 'Write a setting (`domain key -type value`)', [['-g|-globalDomain', '共通の設定', 'the global domain'], ['-bool', '真偽値', 'boolean value'], ['-int', '整数', 'integer value'], ['-float', '小数', 'floating-point value'], ['-string', '文字列', 'string value'], ['-array', '配列', 'array value'], ['-dict', '辞書', 'dictionary value']], { positional: [pos('ドメイン（`com.apple.dock`…）', 'domain (`com.apple.dock`…)'), pos('キー', 'key'), pos('値', 'value')], style: 'single-dash' }),
      read: cmd('設定を読む', 'Read settings', [['-g|-globalDomain', '共通の設定', 'the global domain']], { positional: [pos('ドメイン', 'domain'), pos('キー', 'key')], style: 'single-dash' }),
      delete: cmd('設定を削除する', 'Delete settings', [['-g|-globalDomain', '共通の設定', 'the global domain']], { positional: [pos('ドメイン', 'domain'), pos('キー', 'key')], style: 'single-dash' }),
    },
  }),
  hdiutil: cmd('ディスクイメージ（.dmg）を操作する（macOS）', 'Work with disk images, .dmg (macOS)', [['-quiet', '表示しない', 'quiet'], ['-nobrowse', 'Finder に出さない', 'do not show in the Finder'], ['-mountpoint', 'マウント先', 'mount point', 'arg']], {
    style: 'single-dash',
    subcommands: {
      attach: cmd('イメージをマウントする', 'Mount an image', [['-quiet', '表示しない', 'quiet'], ['-nobrowse', 'Finder に出さない', 'do not show in the Finder'], ['-mountpoint', 'マウント先', 'mount point', 'arg']], { positional: [pos('.dmg ファイル', '.dmg file')], style: 'single-dash' }),
      mount: cmd('イメージをマウントする（`attach` と同じ）', 'Mount an image (same as `attach`)', [], { positional: [pos('.dmg ファイル', '.dmg file')] }),
      detach: cmd('イメージを取り外す', 'Unmount an image', [['-force', '強制する', 'force']], { positional: [pos('マウント先', 'mount point')], style: 'single-dash' }),
      create: cmd('イメージを作る', 'Create an image', [['-volname', 'ボリューム名', 'volume name', 'arg'], ['-srcfolder', '中身にするフォルダ', 'folder to put in', 'arg'], ['-format', '形式（`UDZO`: 圧縮）', 'format (`UDZO`: compressed)', 'arg']], { style: 'single-dash' }),
    },
  }),
  pmset: cmd('電源の設定を表示・変更する（macOS）', 'Show or change power settings (macOS)', [['-g', '設定や状態を表示する（`-g batt` でバッテリー）', 'show settings or status (`-g batt`: battery)'], ['-a', 'すべての電源のときの設定', 'settings for all power sources'], ['-b', 'バッテリーのときの設定', 'settings on battery'], ['-c', '電源につないだときの設定', 'settings on charger']]),
};
