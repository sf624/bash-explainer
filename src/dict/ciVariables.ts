import { Text, tx } from '../i18n';

// Variables that CI systems set for the scripts they run, and the contexts of GitHub Actions'
// `${{ … }}` expressions: the most used ones, from each system's documentation.

export interface CiVariable {
  /** The system that sets it. */
  ci: string;
  meaning: Text;
}

const gh = (ja: string, en: string): CiVariable => ({ ci: 'GitHub Actions', meaning: tx(ja, en) });
const gl = (ja: string, en: string): CiVariable => ({ ci: 'GitLab CI/CD', meaning: tx(ja, en) });
const cc = (ja: string, en: string): CiVariable => ({ ci: 'CircleCI', meaning: tx(ja, en) });
const jk = (ja: string, en: string): CiVariable => ({ ci: 'Jenkins', meaning: tx(ja, en) });
const bb = (ja: string, en: string): CiVariable => ({ ci: 'Bitbucket Pipelines', meaning: tx(ja, en) });

/** Azure Pipelines variables by their name in `$(Build.SourcesDirectory)`; scripts see them as `BUILD_SOURCESDIRECTORY`. */
export const azureVariables: Record<string, Text> = {
  'Build.SourcesDirectory': tx('ソースコードをチェックアウトしたディレクトリ', 'the directory the sources are checked out to'),
  'Build.ArtifactStagingDirectory': tx('成果物を公開する前に置くディレクトリ', 'the directory to put artifacts in before publishing them'),
  'Build.BinariesDirectory': tx('ビルド結果を置くためのディレクトリ', 'a directory for build outputs'),
  'Build.BuildId': tx('ビルドの ID（実行ごとに一意）', 'the ID of the build (unique per run)'),
  'Build.BuildNumber': tx('ビルド番号（実行の名前）', 'the build number (the name of the run)'),
  'Build.SourceBranch': tx('ビルドするブランチなどの完全な ref（`refs/heads/main` など）', 'the full ref being built (`refs/heads/main`…)'),
  'Build.SourceBranchName': tx('ビルドするブランチ名・タグ名（ref の最後の部分）', 'the branch or tag being built (the last part of the ref)'),
  'Build.SourceVersion': tx('ビルドするコミットの ID', 'the commit being built'),
  'Build.Reason': tx('ビルドが始まった理由（`IndividualCI`、`PullRequest`、`Manual` など）', 'why the build started (`IndividualCI`, `PullRequest`, `Manual`…)'),
  'Build.Repository.Name': tx('リポジトリ名', 'the name of the repository'),
  'System.AccessToken': tx('パイプラインのアクセストークン（スクリプトで使うには `env:` で渡す必要があります）', 'the pipeline\'s access token (scripts get it only when passed through `env:`)'),
  'System.DefaultWorkingDirectory': tx('既定の作業ディレクトリ', 'the default working directory'),
  'System.PullRequest.PullRequestId': tx('プルリクエストの ID（プルリクエストのビルドのときだけ）', 'the ID of the pull request (only in pull request builds)'),
  'System.PullRequest.TargetBranch': tx('プルリクエストのマージ先ブランチ', 'the target branch of the pull request'),
  'Agent.TempDirectory': tx('ジョブごとに空にされる一時ディレクトリ', 'a temporary directory cleaned for each job'),
  'Agent.OS': tx('エージェントの OS（`Linux`、`Windows_NT`、`Darwin`）', 'the agent\'s OS (`Linux`, `Windows_NT`, `Darwin`)'),
  'Pipeline.Workspace': tx('パイプラインの作業ディレクトリ（成果物のダウンロード先など）', 'the pipeline\'s workspace (where artifacts are downloaded…)'),
};

/** Environment variables CI systems set, by name. */
export const ciVariables: Record<string, CiVariable> = {
  CI: { ci: 'GitHub Actions, GitLab CI/CD, CircleCI…', meaning: tx('CI で実行しているときに `true` になる', '`true` when running in CI') },
  // GitHub Actions
  GITHUB_ACTIONS: gh('GitHub Actions で実行しているときに `true` になる', '`true` when running in GitHub Actions'),
  GITHUB_WORKSPACE: gh('ステップの既定の作業ディレクトリ（`actions/checkout` がチェックアウトする場所）', 'the default working directory of steps (where `actions/checkout` checks out)'),
  GITHUB_SHA: gh('ワークフローを起動したコミットの SHA', 'the SHA of the commit that triggered the workflow'),
  GITHUB_REF: gh('起動したブランチなどの完全な ref（`refs/heads/main`、`refs/pull/1/merge`、`refs/tags/v1` など）', 'the full ref that triggered the workflow (`refs/heads/main`, `refs/pull/1/merge`, `refs/tags/v1`…)'),
  GITHUB_REF_NAME: gh('起動したブランチ名・タグ名（`main`、`v1` など）', 'the branch or tag that triggered the workflow (`main`, `v1`…)'),
  GITHUB_HEAD_REF: gh('プルリクエストの元（head）ブランチ名（プルリクエストのイベントのときだけ）', 'the head (source) branch of the pull request (only for pull request events)'),
  GITHUB_BASE_REF: gh('プルリクエストのマージ先（base）ブランチ名（プルリクエストのイベントのときだけ）', 'the base (target) branch of the pull request (only for pull request events)'),
  GITHUB_REPOSITORY: gh('`所有者/リポジトリ名`', '`owner/repository`'),
  GITHUB_REPOSITORY_OWNER: gh('リポジトリの所有者（ユーザー名・組織名）', 'the owner of the repository (user or organization)'),
  GITHUB_RUN_ID: gh('ワークフロー実行の ID（実行ごとに一意。再実行では変わらない）', 'the ID of the workflow run (unique per run; the same on re-runs)'),
  GITHUB_RUN_NUMBER: gh('ワークフローの実行番号（1 から順に増える）', 'the run number of the workflow (counts up from 1)'),
  GITHUB_RUN_ATTEMPT: gh('同じ実行の何回目の試行か（再実行で増える）', 'which attempt of the run this is (goes up on re-runs)'),
  GITHUB_ACTOR: gh('ワークフローを起動したユーザー名', 'the user who triggered the workflow'),
  GITHUB_EVENT_NAME: gh('ワークフローを起動したイベント名（`push`、`pull_request` など）', 'the event that triggered the workflow (`push`, `pull_request`…)'),
  GITHUB_EVENT_PATH: gh('起動したイベントの内容（JSON）が書かれたファイルのパス', 'the path of a file holding the triggering event (JSON)'),
  GITHUB_SERVER_URL: gh('GitHub の URL（`https://github.com`）', 'the URL of GitHub (`https://github.com`)'),
  GITHUB_API_URL: gh('GitHub API の URL（`https://api.github.com`）', 'the URL of the GitHub API (`https://api.github.com`)'),
  GITHUB_JOB: gh('実行中のジョブの ID', 'the ID of the current job'),
  GITHUB_ACTION_PATH: gh('複合アクション（composite action）のディレクトリ', 'the directory of the composite action'),
  GITHUB_ENV: gh('ファイルのパス。ここに `名前=値` を書くと、後のステップで環境変数として使えます', 'a file path; lines `NAME=value` written there become environment variables in later steps'),
  GITHUB_OUTPUT: gh('ファイルのパス。ここに `名前=値` を書くと、ステップの出力（`steps.<id>.outputs.名前`）になります', 'a file path; lines `name=value` written there become step outputs (`steps.<id>.outputs.name`)'),
  GITHUB_PATH: gh('ファイルのパス。ここに書いたディレクトリが、後のステップの PATH に追加されます', 'a file path; directories written there are added to PATH for later steps'),
  GITHUB_STEP_SUMMARY: gh('ファイルのパス。ここに書いた Markdown が、ジョブの実行結果のページに表示されます', 'a file path; Markdown written there is shown on the run\'s summary page'),
  RUNNER_OS: gh('ランナーの OS（`Linux`、`Windows`、`macOS`）', 'the runner\'s OS (`Linux`, `Windows`, `macOS`)'),
  RUNNER_ARCH: gh('ランナーの CPU アーキテクチャ（`X64`、`ARM64` など）', 'the runner\'s CPU architecture (`X64`, `ARM64`…)'),
  RUNNER_TEMP: gh('ジョブごとに空にされる一時ディレクトリ', 'a temporary directory emptied for each job'),
  RUNNER_TOOL_CACHE: gh('`actions/setup-node` などがツールをキャッシュするディレクトリ', 'the directory where `actions/setup-node` and the like cache tools'),
  RUNNER_DEBUG: gh('デバッグログが有効なときに `1` になる', '`1` when debug logging is on'),
  // GitLab CI/CD
  GITLAB_CI: gl('GitLab CI/CD で実行しているときに `true` になる', '`true` when running in GitLab CI/CD'),
  CI_COMMIT_SHA: gl('ビルドするコミットの SHA', 'the SHA of the commit being built'),
  CI_COMMIT_SHORT_SHA: gl('コミットの SHA の先頭8文字', 'the first 8 characters of the commit SHA'),
  CI_COMMIT_REF_NAME: gl('ビルドするブランチ名・タグ名', 'the branch or tag being built'),
  CI_COMMIT_REF_SLUG: gl('ブランチ名・タグ名を URL やホスト名に使える形にしたもの（小文字、63文字まで）', 'the branch or tag name made safe for URLs and host names (lowercase, up to 63 characters)'),
  CI_COMMIT_BRANCH: gl('ビルドするブランチ名（タグやマージリクエストのパイプラインでは空）', 'the branch being built (unset in tag and merge request pipelines)'),
  CI_COMMIT_TAG: gl('ビルドするタグ名（タグのパイプラインのときだけ）', 'the tag being built (only in tag pipelines)'),
  CI_DEFAULT_BRANCH: gl('プロジェクトの既定のブランチ名', 'the project\'s default branch'),
  CI_PIPELINE_ID: gl('パイプラインの ID', 'the ID of the pipeline'),
  CI_PIPELINE_SOURCE: gl('パイプラインが始まった理由（`push`、`merge_request_event`、`schedule` など）', 'how the pipeline started (`push`, `merge_request_event`, `schedule`…)'),
  CI_JOB_ID: gl('ジョブの ID', 'the ID of the job'),
  CI_JOB_NAME: gl('ジョブ名', 'the name of the job'),
  CI_JOB_TOKEN: gl('ジョブの間だけ有効なトークン（レジストリや API への認証に使う）', 'a token valid while the job runs (to authenticate to the registry or the API)'),
  CI_PROJECT_DIR: gl('リポジトリをクローンしたディレクトリ（ジョブの作業ディレクトリ）', 'the directory the repository is cloned to (the job\'s working directory)'),
  CI_PROJECT_NAME: gl('プロジェクト名', 'the name of the project'),
  CI_PROJECT_PATH: gl('`グループ/プロジェクト名`', '`group/project`'),
  CI_REGISTRY: gl('GitLab のコンテナレジストリのアドレス', 'the address of GitLab\'s container registry'),
  CI_REGISTRY_IMAGE: gl('このプロジェクトのコンテナイメージの名前（レジストリのアドレス付き）', 'the name of this project\'s container image (with the registry address)'),
  CI_REGISTRY_USER: gl('コンテナレジストリに `docker login` するユーザー名', 'the user name for `docker login` to the container registry'),
  CI_REGISTRY_PASSWORD: gl('コンテナレジストリに `docker login` するパスワード（ジョブの間だけ有効）', 'the password for `docker login` to the container registry (valid while the job runs)'),
  CI_MERGE_REQUEST_IID: gl('マージリクエストの番号（マージリクエストのパイプラインのときだけ）', 'the merge request number (only in merge request pipelines)'),
  CI_SERVER_URL: gl('GitLab の URL', 'the URL of the GitLab instance'),
  // CircleCI
  CIRCLECI: cc('CircleCI で実行しているときに `true` になる', '`true` when running in CircleCI'),
  CIRCLE_BRANCH: cc('ビルドするブランチ名', 'the branch being built'),
  CIRCLE_SHA1: cc('ビルドするコミットの SHA', 'the SHA of the commit being built'),
  CIRCLE_TAG: cc('ビルドするタグ名（タグのときだけ）', 'the tag being built (only for tags)'),
  CIRCLE_BUILD_NUM: cc('ジョブの番号', 'the job number'),
  CIRCLE_WORKING_DIRECTORY: cc('ジョブの作業ディレクトリ', 'the job\'s working directory'),
  CIRCLE_PROJECT_REPONAME: cc('リポジトリ名', 'the name of the repository'),
  CIRCLE_PROJECT_USERNAME: cc('リポジトリの所有者（ユーザー名・組織名）', 'the owner of the repository (user or organization)'),
  CIRCLE_PULL_REQUEST: cc('プルリクエストの URL（プルリクエストのときだけ）', 'the URL of the pull request (only for pull requests)'),
  CIRCLE_NODE_INDEX: cc('並列実行（`parallelism`）で何番目のコンテナか（0 から）', 'which container this is in a parallel run (`parallelism`), from 0'),
  CIRCLE_NODE_TOTAL: cc('並列実行（`parallelism`）のコンテナ数', 'the number of containers in a parallel run (`parallelism`)'),
  // Jenkins
  JENKINS_URL: jk('Jenkins の URL', 'the URL of Jenkins'),
  BUILD_NUMBER: jk('ビルド番号（1 から順に増える）', 'the build number (counts up from 1)'),
  BUILD_ID: jk('ビルドの ID（ビルド番号と同じ）', 'the build ID (the same as the build number)'),
  BUILD_URL: jk('このビルドのページの URL', 'the URL of this build\'s page'),
  JOB_NAME: jk('ジョブ名（フォルダー付き）', 'the name of the job (with its folders)'),
  WORKSPACE: jk('ジョブの作業ディレクトリ', 'the job\'s workspace directory'),
  NODE_NAME: jk('ビルドを実行しているエージェント名（組み込みノードは `built-in`）', 'the agent running the build (`built-in` for the built-in node)'),
  BRANCH_NAME: jk('ビルドするブランチ名（マルチブランチパイプラインのとき）', 'the branch being built (in multibranch pipelines)'),
  CHANGE_ID: jk('プルリクエストの番号（マルチブランチパイプラインでプルリクエストのとき）', 'the pull request number (in multibranch pipelines, for pull requests)'),
  TAG_NAME: jk('ビルドするタグ名（マルチブランチパイプラインでタグのとき）', 'the tag being built (in multibranch pipelines, for tags)'),
  GIT_COMMIT: jk('チェックアウトしたコミットの SHA（Git プラグイン）', 'the SHA of the checked-out commit (Git plugin)'),
  // Bitbucket Pipelines
  BITBUCKET_BRANCH: bb('ビルドするブランチ名', 'the branch being built'),
  BITBUCKET_COMMIT: bb('ビルドするコミットの SHA', 'the SHA of the commit being built'),
  BITBUCKET_TAG: bb('ビルドするタグ名（タグのときだけ）', 'the tag being built (only for tags)'),
  BITBUCKET_BUILD_NUMBER: bb('ビルド番号', 'the build number'),
  BITBUCKET_CLONE_DIR: bb('リポジトリをクローンしたディレクトリ', 'the directory the repository is cloned to'),
  // Azure Pipelines: `Build.SourcesDirectory` → `BUILD_SOURCESDIRECTORY`.
  TF_BUILD: { ci: 'Azure Pipelines', meaning: tx('Azure Pipelines で実行しているときに `True` になる', '`True` when running in Azure Pipelines') },
  ...Object.fromEntries(Object.entries(azureVariables).map(([name, meaning]) => [name.replace(/\./g, '_').toUpperCase(), { ci: 'Azure Pipelines', meaning }])),
};

/**
 * What a context of a GitHub Actions expression stands for: `github.head_ref`, `secrets.TOKEN`,
 * `steps.build.outputs.path`… Undefined for other expressions (`a == b`, functions…).
 */
export function githubContext(expr: string): Text | undefined {
  const exact: Record<string, Text> = {
    'github.head_ref': tx('プルリクエストの元（head）ブランチ名（プルリクエストのイベントのときだけ）', 'the head (source) branch of the pull request (only for pull request events)'),
    'github.base_ref': tx('プルリクエストのマージ先（base）ブランチ名（プルリクエストのイベントのときだけ）', 'the base (target) branch of the pull request (only for pull request events)'),
    'github.ref': tx('起動したブランチなどの完全な ref（`refs/heads/main` など）', 'the full ref that triggered the workflow (`refs/heads/main`…)'),
    'github.ref_name': tx('起動したブランチ名・タグ名', 'the branch or tag that triggered the workflow'),
    'github.sha': tx('ワークフローを起動したコミットの SHA', 'the SHA of the commit that triggered the workflow'),
    'github.event_name': tx('ワークフローを起動したイベント名（`push`、`pull_request` など）', 'the event that triggered the workflow (`push`, `pull_request`…)'),
    'github.repository': tx('`所有者/リポジトリ名`', '`owner/repository`'),
    'github.repository_owner': tx('リポジトリの所有者', 'the owner of the repository'),
    'github.actor': tx('ワークフローを起動したユーザー名', 'the user who triggered the workflow'),
    'github.run_id': tx('ワークフロー実行の ID', 'the ID of the workflow run'),
    'github.run_number': tx('ワークフローの実行番号（1 から順に増える）', 'the run number of the workflow (counts up from 1)'),
    'github.run_attempt': tx('同じ実行の何回目の試行か', 'which attempt of the run this is'),
    'github.workspace': tx('ステップの既定の作業ディレクトリ', 'the default working directory of steps'),
    'github.server_url': tx('GitHub の URL', 'the URL of GitHub'),
    'github.job': tx('実行中のジョブの ID', 'the ID of the current job'),
    'github.token': tx('ワークフロー用に自動で発行されるトークン（`secrets.GITHUB_TOKEN` と同じ）', 'the token issued for the workflow (the same as `secrets.GITHUB_TOKEN`)'),
    'github.event.number': tx('プルリクエストの番号', 'the pull request number'),
    'github.event.pull_request.number': tx('プルリクエストの番号', 'the pull request number'),
    'github.event.pull_request.head.sha': tx('プルリクエストの元ブランチの先頭コミットの SHA', 'the SHA of the head commit of the pull request'),
    'runner.os': tx('ランナーの OS（`Linux`、`Windows`、`macOS`）', 'the runner\'s OS (`Linux`, `Windows`, `macOS`)'),
    'runner.arch': tx('ランナーの CPU アーキテクチャ（`X64`、`ARM64` など）', 'the runner\'s CPU architecture (`X64`, `ARM64`…)'),
    'runner.temp': tx('ジョブごとに空にされる一時ディレクトリ', 'a temporary directory emptied for each job'),
    'runner.tool_cache': tx('ツールのキャッシュディレクトリ', 'the tool cache directory'),
    'job.status': tx('ジョブの現在の状態（`success`、`failure`、`cancelled`）', 'the current status of the job (`success`, `failure`, `cancelled`)'),
    'secrets.GITHUB_TOKEN': tx('ワークフロー用に自動で発行されるトークン', 'the token issued for the workflow'),
    'strategy.job-index': tx('マトリックスの中で何番目のジョブか（0 から）', 'which job of the matrix this is (from 0)'),
    'strategy.job-total': tx('マトリックスのジョブ数', 'the number of jobs in the matrix'),
  };
  if (exact[expr]) return exact[expr];
  let m: RegExpExecArray | null;
  if ((m = /^secrets\.(\w+)$/.exec(expr))) return tx(`シークレット \`${m[1]}\`（ログには \`***\` と伏せて表示される）`, `the secret \`${m[1]}\` (masked as \`***\` in logs)`);
  if ((m = /^vars\.(\w+)$/.exec(expr))) return tx(`リポジトリなどに設定した変数 \`${m[1]}\``, `the configuration variable \`${m[1]}\` (set on the repository or organization)`);
  if ((m = /^env\.(\w+)$/.exec(expr))) return tx(`\`env:\` で定義した環境変数 \`${m[1]}\``, `the environment variable \`${m[1]}\` defined under \`env:\``);
  if ((m = /^matrix\.([\w-]+)$/.exec(expr))) return tx(`マトリックスの値 \`${m[1]}\`（ジョブごとに変わる）`, `the matrix value \`${m[1]}\` (differs per job)`);
  if ((m = /^(?:github\.event\.)?inputs\.([\w-]+)$/.exec(expr))) return tx(`入力 \`${m[1]}\`（\`workflow_dispatch\`・\`workflow_call\`、またはアクションの \`with:\`）`, `the input \`${m[1]}\` (\`workflow_dispatch\`, \`workflow_call\` or an action's \`with:\`)`);
  if ((m = /^steps\.([\w-]+)\.outputs\.([\w-]+)$/.exec(expr))) return tx(`ID が \`${m[1]}\` のステップの出力 \`${m[2]}\``, `the output \`${m[2]}\` of the step with ID \`${m[1]}\``);
  if ((m = /^steps\.([\w-]+)\.(outcome|conclusion)$/.exec(expr))) return tx(`ID が \`${m[1]}\` のステップの結果（\`success\`、\`failure\` など）`, `the result of the step with ID \`${m[1]}\` (\`success\`, \`failure\`…)`);
  if ((m = /^needs\.([\w-]+)\.outputs\.([\w-]+)$/.exec(expr))) return tx(`ジョブ \`${m[1]}\` の出力 \`${m[2]}\``, `the output \`${m[2]}\` of the job \`${m[1]}\``);
  if ((m = /^needs\.([\w-]+)\.result$/.exec(expr))) return tx(`ジョブ \`${m[1]}\` の結果（\`success\`、\`failure\` など）`, `the result of the job \`${m[1]}\` (\`success\`, \`failure\`…)`);
  return undefined;
}
