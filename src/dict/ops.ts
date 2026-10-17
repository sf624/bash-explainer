import { CommandDoc, cmd, OptSpec, pos } from './types';

// Commands found in a second survey: operations and cloud scripts (Kubernetes, Terraform, AWS,
// Google Cloud), node bootstrap and debugging scripts, dotfiles and container builds.

const files = pos('対象のファイル', 'target file');
const user = pos('ユーザー名', 'user name');
const device = pos('デバイス（`/dev/sda1`…）', 'device (`/dev/sda1`…)');

// ---- Kubernetes ---------------------------------------------------------------------------------

/** Options most kubectl subcommands take. */
const kube: OptSpec[] = [
  ['-n|--namespace', '対象の名前空間', 'namespace', 'arg'],
  ['-A|--all-namespaces', 'すべての名前空間', 'all namespaces'],
  ['--context', '使う kubeconfig のコンテキスト（クラスター）', 'kubeconfig context (cluster) to use', 'arg'],
  ['--kubeconfig', '使う kubeconfig のファイル', 'kubeconfig file to use', 'arg'],
  ['-o|--output', '出力形式（`yaml`、`json`、`wide`、`name`、`jsonpath=…`）', 'output format (`yaml`, `json`, `wide`, `name`, `jsonpath=…`)', 'arg'],
  ['-l|--selector', 'ラベルで絞る（`app=web`）', 'filter by label (`app=web`)', 'arg'],
  ['-f|--filename', 'マニフェストのファイルやディレクトリ（`-` で標準入力）', 'manifest file or directory (`-`: stdin)', 'arg'],
  ['-k|--kustomize', 'この kustomization のディレクトリ', 'this kustomization directory', 'arg'],
  ['-w|--watch', '変化を見張り続ける', 'keep watching for changes'],
  ['--dry-run', '実際には変更しない（`client`、`server`）', 'do not change anything (`client`, `server`)', 'arg'],
  ['--timeout', '待つ時間の上限（`60s`）', 'how long to wait (`60s`)', 'arg'],
];

const resource = pos('リソースの種類と名前（`pod/web`、`deployment web`…）', 'resource type and name (`pod/web`, `deployment web`…)');

const kubectl = cmd('Kubernetes のクラスターを操作する', 'Control a Kubernetes cluster', kube, {
  subcommands: {
    get: cmd('リソースを一覧表示する', 'List resources', kube, { positional: [resource] }),
    describe: cmd('リソースの詳細とイベントを表示する', 'Show details and events of resources', kube, { positional: [resource] }),
    apply: cmd('マニフェストの内容にリソースを合わせる（なければ作る）', 'Make resources match the manifests (create them if missing)', [...kube, ['--server-side', 'サーバー側で適用する', 'apply on the server']]),
    create: cmd('リソースを作る', 'Create resources', kube, { positional: [resource] }),
    delete: cmd('リソースを削除する', 'Delete resources', [...kube, ['--ignore-not-found', 'なくてもエラーにしない', 'no error if it does not exist']], { positional: [resource] }),
    logs: cmd('Pod のログを表示する', "Print a pod's logs", [...kube, ['-c|--container', 'コンテナ', 'container', 'arg'], ['--tail', '末尾の行数', 'lines from the end', 'arg'], ['-p|--previous', '再起動する前のコンテナのログ', 'logs of the previous container instance']], { positional: [pos('Pod（`deploy/名前` も可）', 'pod (or `deploy/name`)')] }),
    exec: cmd('コンテナの中でコマンドを実行する（`--` の後がコマンド）', 'Run a command in a container (the command follows `--`)', [...kube, ['-i|--stdin', '標準入力をつなぐ', 'pass stdin'], ['-t|--tty', '端末を割り当てる', 'allocate a TTY'], ['-c|--container', 'コンテナ', 'container', 'arg']], { positional: [pos('Pod', 'pod')] }),
    'port-forward': cmd('手元のポートを Pod やサービスにつなぐ', 'Forward local ports to a pod or service', kube, { positional: [pos('Pod やサービス', 'pod or service'), pos('ポート（`手元:相手`）', 'ports (`local:remote`)')] }),
    rollout: cmd('デプロイの進み具合を操作する（`status`、`restart`、`undo`）', 'Manage rollouts (`status`, `restart`, `undo`)', kube),
    wait: cmd('条件を満たすまで待つ（`--for=condition=Ready`）', 'Wait for a condition (`--for=condition=Ready`)', [...kube, ['--for', '待つ条件（`condition=Ready`、`delete`…）', 'condition to wait for (`condition=Ready`, `delete`…)', 'arg']], { positional: [resource] }),
    config: cmd('kubeconfig を操作する（`use-context`、`current-context`…）', 'Manage kubeconfig (`use-context`, `current-context`…)'),
    'cluster-info': cmd('クラスターの情報を表示する', 'Show cluster information', kube),
    scale: cmd('レプリカ数を変える', 'Change the number of replicas', [...kube, ['--replicas', 'レプリカ数', 'number of replicas', 'arg']], { positional: [resource] }),
    patch: cmd('リソースの一部を書き換える', 'Change part of a resource', [...kube, ['-p|--patch', '書き換える内容（JSON か YAML）', 'the patch (JSON or YAML)', 'arg'], ['--type', '書き換え方（`merge`、`json`、`strategic`）', 'patch type (`merge`, `json`, `strategic`)', 'arg']], { positional: [resource] }),
    label: cmd('ラベルを付ける', 'Set labels', kube, { positional: [resource] }),
    annotate: cmd('注釈を付ける', 'Set annotations', kube, { positional: [resource] }),
    version: cmd('クライアントとサーバーの版を表示する', 'Show client and server versions', kube),
  },
});

const helmCommon: OptSpec[] = [
  ['-n|--namespace', '対象の名前空間', 'namespace', 'arg'],
  ['-f|--values', '値のファイル（values.yaml）', 'values file', 'arg'],
  ['--set', '値を1つ上書きする（`キー=値`）', 'set one value (`key=value`)', 'arg'],
  ['--create-namespace', '名前空間がなければ作る', 'create the namespace if missing'],
  ['--version', 'チャートの版', 'chart version', 'arg'],
  ['--wait', 'リソースが準備できるまで待つ', 'wait until the resources are ready'],
  ['--timeout', '待つ時間の上限', 'how long to wait', 'arg'],
  ['--kube-context', '使うクラスター', 'cluster context', 'arg'],
];

// ---- Clouds ---------------------------------------------------------------------------------------

const tfCommon: OptSpec[] = [
  ['-auto-approve', '確認せずに適用する（CI 向け）', 'apply without asking (for CI)'],
  ['-input=false', '入力を求めない', 'never ask for input'],
  ['-var', '変数を1つ渡す（`-var "名前=値"`）', 'set one variable (`-var "name=value"`)', 'arg'],
  ['-var-file', '変数のファイル（`.tfvars`）', 'variables file (`.tfvars`)', 'arg'],
  ['-out', '計画を保存するファイル', 'file to save the plan in', 'arg'],
  ['-target', 'このリソースだけを対象にする', 'only this resource', 'arg'],
  ['-chdir', 'このディレクトリで実行する', 'run in this directory', 'arg'],
  ['-backend-config', 'バックエンドの設定（`init`）', 'backend configuration (`init`)', 'arg'],
  ['-upgrade', 'プロバイダやモジュールを更新する（`init`）', 'upgrade providers and modules (`init`)'],
  ['-check', '整形が必要なら失敗する（`fmt`）', 'fail if formatting is needed (`fmt`)'],
  ['-recursive', 'サブディレクトリも（`fmt`）', 'subdirectories too (`fmt`)'],
  ['-raw', '値だけを出力する（`output`）', 'print the raw value (`output`)'],
  ['-json', 'JSON で出力', 'JSON output'],
];
const tf = (ja: string, en: string): CommandDoc => cmd(ja, en, tfCommon, { longSingleDash: true });

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
  ['-A|--append', '規則をこのチェーンの末尾に足す', 'append a rule to this chain', 'arg'], ['-I|--insert', '規則をチェーンの先頭に入れる', 'insert a rule at the top', 'arg'],
  ['-D|--delete', '規則を削除する', 'delete a rule', 'arg'], ['-L|--list', '規則を一覧表示する', 'list rules'], ['-S|--list-rules', '規則をコマンドの形で表示する', 'print rules as commands'],
  ['-F|--flush', '規則をすべて削除する', 'delete all rules'], ['-t|--table', '表（`filter`、`nat`、`mangle`）', 'table (`filter`, `nat`, `mangle`)', 'arg'],
  ['-p|--protocol', 'プロトコル', 'protocol', 'arg'], ['-s|--source', '送信元', 'source', 'arg'], ['-d|--destination', '宛先', 'destination', 'arg'],
  ['--dport', '宛先ポート', 'destination port', 'arg'], ['-j|--jump', '一致したときの動作（`ACCEPT`、`DROP`、`DNAT`…）', 'target (`ACCEPT`, `DROP`, `DNAT`…)', 'arg'],
  ['-n|--numeric', '名前に変換せず数字で表示', 'numeric output'], ['-v|--verbose', '詳しく表示', 'verbose'],
  ['-w|--wait', 'ロックが空くまで待つ', 'wait for the lock'],
];

export const ops: Record<string, CommandDoc> = {
  kubectl,
  helm: cmd('Kubernetes のパッケージ（チャート）を管理する', 'Kubernetes package (chart) manager', helmCommon, {
    subcommands: {
      install: cmd('チャートを入れる（`名前 チャート`）', 'Install a chart (`name chart`)', helmCommon, { positional: [pos('リリース名', 'release name'), pos('チャート', 'chart')] }),
      upgrade: cmd('リリースを更新する（`--install` でなければ入れる）', 'Upgrade a release (`--install`: install if missing)', [...helmCommon, ['-i|--install', 'なければ入れる', 'install if missing']], { positional: [pos('リリース名', 'release name'), pos('チャート', 'chart')] }),
      uninstall: cmd('リリースを削除する', 'Uninstall a release', helmCommon, { positional: [pos('リリース名', 'release name')] }),
      template: cmd('マニフェストを生成して表示する（クラスターには適用しない）', 'Render the manifests without applying them', helmCommon, { positional: [pos('リリース名', 'release name'), pos('チャート', 'chart')] }),
      lint: cmd('チャートを検査する', 'Check a chart', helmCommon, { positional: [pos('チャートのディレクトリ', 'chart directory')] }),
      repo: cmd('チャートのリポジトリを管理する（`add`、`update`）', 'Manage chart repositories (`add`, `update`)'),
      dependency: cmd('チャートの依存を管理する（`update`、`build`）', "Manage a chart's dependencies (`update`, `build`)"),
      package: cmd('チャートを .tgz にまとめる', 'Package a chart into a .tgz'),
      list: cmd('リリースを一覧表示する', 'List releases', [...helmCommon, ['-A|--all-namespaces', 'すべての名前空間', 'all namespaces']]),
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
  terraform: cmd('Terraform: インフラをコードで管理する', 'Terraform: infrastructure as code', tfCommon, {
    longSingleDash: true,
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
  aws: cmd('AWS CLI（サービスとコマンドの組み合わせで操作する: `aws s3 cp`）', 'AWS CLI (a service and a command: `aws s3 cp`)', awsCommon, {
    subcommands: {
      s3: cmd('S3 のファイルを操作する（`cp`、`sync`、`ls`、`rm`）', 'Work with S3 files (`cp`, `sync`, `ls`, `rm`)', [...awsCommon, ['--recursive', 'ディレクトリごと', 'recursively'], ['--delete', '転送元にないものを削除する（`sync`）', 'delete files missing from the source (`sync`)'], ['--exclude', '除外するパターン', 'exclude pattern', 'arg'], ['--include', '含めるパターン', 'include pattern', 'arg']]),
      sts: cmd('認証情報を扱う（`get-caller-identity` で今の身元）', 'Security tokens (`get-caller-identity`: who am I)', awsCommon),
      ec2: cmd('EC2（仮想マシン、ネットワーク）を操作する', 'Work with EC2 (virtual machines, networks)', awsCommon),
      ecr: cmd('ECR（コンテナのレジストリ）を操作する（`get-login-password`）', 'Work with ECR, the container registry (`get-login-password`)', awsCommon),
      eks: cmd('EKS（Kubernetes）を操作する（`update-kubeconfig`）', 'Work with EKS, Kubernetes (`update-kubeconfig`)', [...awsCommon, ['--name', 'クラスター名', 'cluster name', 'arg']]),
      ssm: cmd('Systems Manager（パラメータやコマンド実行）を操作する', 'Work with Systems Manager (parameters, commands)', awsCommon),
      iam: cmd('IAM（ユーザーと権限）を操作する', 'Work with IAM (users and permissions)', awsCommon),
      configure: cmd('認証情報と既定の設定を登録・表示する', 'Set or show credentials and defaults', awsCommon),
      cloudformation: cmd('CloudFormation のスタックを操作する', 'Work with CloudFormation stacks', awsCommon),
      lambda: cmd('Lambda の関数を操作する', 'Work with Lambda functions', awsCommon),
      logs: cmd('CloudWatch Logs を操作する（`tail`）', 'Work with CloudWatch Logs (`tail`)', awsCommon),
    },
  }),
  gcloud: cmd('Google Cloud CLI（`gcloud グループ コマンド`）', 'Google Cloud CLI (`gcloud group command`)', gcloudCommon, {
    subcommands: {
      auth: cmd('認証する（`login`、`activate-service-account`、`configure-docker`）', 'Authenticate (`login`, `activate-service-account`, `configure-docker`)', gcloudCommon),
      config: cmd('設定を表示・変更する（`set project`…）', 'Show or change settings (`set project`…)', gcloudCommon),
      container: cmd('GKE（Kubernetes）を操作する（`clusters get-credentials`…）', 'Work with GKE, Kubernetes (`clusters get-credentials`…)', gcloudCommon),
      compute: cmd('Compute Engine（仮想マシン、ネットワーク）を操作する', 'Work with Compute Engine (virtual machines, networks)', gcloudCommon),
      run: cmd('Cloud Run を操作する（`deploy`）', 'Work with Cloud Run (`deploy`)', gcloudCommon),
      storage: cmd('Cloud Storage のファイルを操作する（`cp`、`ls`、`rm`）', 'Work with Cloud Storage files (`cp`, `ls`, `rm`)', gcloudCommon),
      artifacts: cmd('Artifact Registry を操作する', 'Work with Artifact Registry', gcloudCommon),
      builds: cmd('Cloud Build を操作する（`submit`）', 'Work with Cloud Build (`submit`)', gcloudCommon),
      iam: cmd('IAM（権限）を操作する', 'Work with IAM (permissions)', gcloudCommon),
      projects: cmd('プロジェクトを操作する', 'Work with projects', gcloudCommon),
      dns: cmd('Cloud DNS を操作する', 'Work with Cloud DNS', gcloudCommon),
      secrets: cmd('Secret Manager を操作する', 'Work with Secret Manager', gcloudCommon),
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
  ], { wraps: true }),
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
  rpmbuild: cmd('RPM パッケージを作る', 'Build RPM packages', [['-bb', 'バイナリのパッケージを作る', 'build binary packages'], ['-ba', 'バイナリとソースのパッケージを作る', 'build binary and source packages'], ['-v', '詳しく表示する', 'verbose'], ['--define', 'マクロを定義する', 'define a macro', 'arg']], { positional: [pos('spec ファイル', 'spec file')], longSingleDash: true }),

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
    ['-A', 'ホスト鍵をすべての種類で作る', 'generate all missing host keys'], ['-l', '鍵の指紋を表示する', "show a key's fingerprint"], ['-R', 'known_hosts からこのホストを消す', 'remove this host from known_hosts', 'arg'], ['-y', '秘密鍵から公開鍵を出力する', 'print the public key of a private key'],
  ]),
  'ssh-keyscan': cmd('ホストの公開鍵を取得する（known_hosts に足すため）', "Fetch hosts' public keys (to add to known_hosts)", [['-t', '鍵の種類', 'key type', 'arg'], ['-p', 'ポート', 'port', 'arg'], ['-H', 'ホスト名をハッシュにする', 'hash the host names']], { positional: [pos('ホスト', 'host')] }),

  // ---- Disks, kernel and services ----
  dd: cmd('データをブロック単位でコピー・変換する（ディスクの書き込みに注意）', 'Copy and convert data in blocks (careful when writing to disks)', [], {
    positional: [pos('`if=入力` `of=出力` `bs=ブロックの大きさ` `count=ブロック数` `status=progress` などの指定', 'settings such as `if=input`, `of=output`, `bs=block size`, `count=blocks`, `status=progress`')],
  }),
  lsblk: cmd('ブロックデバイス（ディスクとパーティション）を一覧表示する', 'List block devices (disks and partitions)', [['-f|--fs', 'ファイルシステムも表示', 'show file systems'], ['-o|--output', '表示する列', 'columns to show', 'arg'], ['-n|--noheadings', '見出しを出さない', 'no header'], ['-d|--nodeps', 'パーティションを出さない', 'no partitions'], ['-J|--json', 'JSON で出力', 'JSON output'], ['-p|--paths', '完全なパス', 'full paths']], { positional: [device] }),
  blkid: cmd('ブロックデバイスの種類や UUID を表示する', 'Show the type and UUID of block devices', [['-s', 'この項目だけ（`UUID`、`TYPE`）', 'only this tag (`UUID`, `TYPE`)', 'arg'], ['-o', '出力形式（`value` で値だけ）', 'output format (`value`: values only)', 'arg']], { positional: [device] }),
  findmnt: cmd('マウントされているファイルシステムを表示する', 'Show mounted file systems', [['-t|--types', '種類で絞る', 'filter by type', 'arg'], ['-o|--output', '表示する列', 'columns to show', 'arg'], ['-n|--noheadings', '見出しを出さない', 'no header'], ['-l|--list', '木でなく一覧で', 'list instead of a tree'], ['-u|--notruncate', '切り詰めない', 'do not truncate']], { positional: [pos('マウント先またはデバイス', 'mount point or device')] }),
  umount: cmd('ファイルシステムのマウントを外す', 'Unmount file systems', [['-l|--lazy', '使われなくなってから外す', 'detach now, clean up when no longer busy'], ['-f|--force', '強制する', 'force'], ['-a|--all', 'すべて', 'all']], { positional: [pos('マウント先またはデバイス', 'mount point or device')] }),
  sync: cmd('書き込み待ちのデータをディスクに書き出す', 'Write cached data to disk'),
  modprobe: cmd('カーネルモジュールを読み込む・外す', 'Load or remove kernel modules', [['-r|--remove', '外す', 'remove'], ['-n|--dry-run', '実際には行わない', 'do not actually do it'], ['-v|--verbose', '詳しく表示', 'verbose']], { positional: [pos('モジュール名', 'module name')] }),
  dmesg: cmd('カーネルのメッセージを表示する', 'Show kernel messages', [['-T|--ctime', '人が読める時刻で', 'human-readable timestamps'], ['-w|--follow', '新しいメッセージを待ち続ける', 'wait for new messages'], ['-l|--level', 'この重要度だけ', 'only these levels', 'arg']]),
  uptime: cmd('起動からの時間と負荷を表示する', 'Show how long the system has been up, and the load', [['-p|--pretty', '読みやすい形で', 'pretty format'], ['-s|--since', '起動した日時', 'boot time']]),
  service: cmd('サービスを操作する（SysV init。systemd では `systemctl` に渡される）', 'Control services (SysV init; with systemd it calls `systemctl`)', [['--status-all', 'すべてのサービスの状態', 'status of all services']], { positional: [pos('サービス名', 'service name'), pos('操作（`start`、`stop`、`restart`、`status`）', 'action (`start`, `stop`, `restart`, `status`)')] }),
  killall: cmd('名前でプロセスにシグナルを送る（既定は終了）', 'Send a signal to processes by name (terminate by default)', [['-s|--signal', '送るシグナル', 'signal to send', 'arg'], ['-q|--quiet', '見つからなくても何も言わない', 'say nothing if none were found'], ['-w|--wait', '終わるまで待つ', 'wait for them to end']], { positional: [pos('プロセス名', 'process name')] }),
  logger: cmd('システムのログ（syslog / journal）に書く', 'Write to the system log (syslog/journal)', [['-t|--tag', 'タグ', 'tag', 'arg'], ['-p|--priority', '重要度（`user.err`…）', 'priority (`user.err`…)', 'arg'], ['-s|--stderr', '標準エラーにも出す', 'also write to stderr']], { positional: [pos('メッセージ', 'message')] }),
  getenforce: cmd('SELinux のモード（Enforcing / Permissive / Disabled）を表示する', 'Show the SELinux mode (Enforcing, Permissive or Disabled)'),
  iptables: cmd('Linux のパケットフィルタ（ファイアウォール）の規則を操作する', 'Manage Linux packet filter (firewall) rules', iptables),
  ip6tables: cmd('IPv6 のパケットフィルタの規則を操作する', 'Manage IPv6 packet filter rules', iptables),
  'iptables-save': cmd('パケットフィルタの規則をすべて出力する（`iptables-restore` で戻せる形）', 'Print all packet filter rules (in a form `iptables-restore` reads)', [['-t|--table', 'この表だけ', 'only this table', 'arg'], ['-c|--counters', 'カウンタも', 'include counters']]),
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
    longSingleDash: true,
    subcommands: {
      write: cmd('設定を書く（`ドメイン キー -型 値`）', 'Write a setting (`domain key -type value`)', [['-g|-globalDomain', '共通の設定', 'the global domain'], ['-bool', '真偽値', 'boolean value'], ['-int', '整数', 'integer value'], ['-float', '小数', 'floating-point value'], ['-string', '文字列', 'string value'], ['-array', '配列', 'array value'], ['-dict', '辞書', 'dictionary value']], { positional: [pos('ドメイン（`com.apple.dock`…）', 'domain (`com.apple.dock`…)'), pos('キー', 'key'), pos('値', 'value')], longSingleDash: true }),
      read: cmd('設定を読む', 'Read settings', [['-g|-globalDomain', '共通の設定', 'the global domain']], { positional: [pos('ドメイン', 'domain'), pos('キー', 'key')], longSingleDash: true }),
      delete: cmd('設定を削除する', 'Delete settings', [['-g|-globalDomain', '共通の設定', 'the global domain']], { positional: [pos('ドメイン', 'domain'), pos('キー', 'key')], longSingleDash: true }),
    },
  }),
  hdiutil: cmd('ディスクイメージ（.dmg）を操作する（macOS）', 'Work with disk images, .dmg (macOS)', [['-quiet', '表示しない', 'quiet'], ['-nobrowse', 'Finder に出さない', 'do not show in the Finder'], ['-mountpoint', 'マウント先', 'mount point', 'arg']], {
    longSingleDash: true,
    subcommands: {
      attach: cmd('イメージをマウントする', 'Mount an image', [['-quiet', '表示しない', 'quiet'], ['-nobrowse', 'Finder に出さない', 'do not show in the Finder'], ['-mountpoint', 'マウント先', 'mount point', 'arg']], { positional: [pos('.dmg ファイル', '.dmg file')], longSingleDash: true }),
      mount: cmd('イメージをマウントする（`attach` と同じ）', 'Mount an image (same as `attach`)', [], { positional: [pos('.dmg ファイル', '.dmg file')] }),
      detach: cmd('イメージを取り外す', 'Unmount an image', [['-force', '強制する', 'force']], { positional: [pos('マウント先', 'mount point')], longSingleDash: true }),
      create: cmd('イメージを作る', 'Create an image', [['-volname', 'ボリューム名', 'volume name', 'arg'], ['-srcfolder', '中身にするフォルダ', 'folder to put in', 'arg'], ['-format', '形式（`UDZO`: 圧縮）', 'format (`UDZO`: compressed)', 'arg']], { longSingleDash: true }),
    },
  }),
  pmset: cmd('電源の設定を表示・変更する（macOS）', 'Show or change power settings (macOS)', [['-g', '設定や状態を表示する（`-g batt` でバッテリー）', 'show settings or status (`-g batt`: battery)'], ['-a', 'すべての電源のときの設定', 'settings for all power sources'], ['-b', 'バッテリーのときの設定', 'settings on battery'], ['-c', '電源につないだときの設定', 'settings on charger']]),
};
