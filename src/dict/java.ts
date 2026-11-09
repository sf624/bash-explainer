import type { CommandSpec, PatternOption } from '../argv/spec';
import { tx } from '../i18n';
import { cmd, operand, OptSpec } from './types';

// The tools of a Java development kit and its two build tools. Written from the tools' own usage texts (`java -help`,
// `javac -help`, `keytool -help`, `mvn --help`, `gradle --help`); none of them is installed where the dictionary is made,
// so test/java.test.ts reads the spec only and compares nothing with a real binary.
//
// The launcher and the compiler read options of one dash and a word (`-classpath x`, `-cp x`, `-Xmx512m`, `-g:none`,
// `-Dname=value`) and, for the long ones JDK 9 added, `--name value` and `--name=value`; options never cluster. The
// forms with a colon or an attached value are `patternOptions`. `java` ends its options at the main class, and the
// words after it are the program's. `keytool` takes its command as an option (`-genkeypair`). Maven reads its options
// with Apache commons-cli, whose short names have several letters (`-pl`, `-am`, `-fae`), so it is read as single-dash
// with `-D`, `-P` and `-T` attached as patterns; Gradle's short options are letters.

/** The value after the first `=` of `name=value`, or undefined. */
const valueOf = (s: string): string | undefined => (s.includes('=') ? s.slice(s.indexOf('=') + 1) : undefined);
const nameOf = (s: string): string => s.split('=')[0];

const SHARED: OptSpec[] = [
  ['-cp|-classpath|--class-path', 'クラスパス（クラスや JAR を探すディレクトリと JAR ファイルを `:` で区切って並べる）', 'class path (directories and JAR files to look for classes in, separated by `:`)', 'arg'],
  ['-p|--module-path', 'モジュールパス（モジュールを探すディレクトリと JAR ファイルを `:` で区切って並べる）', 'module path (directories and JAR files to look for modules in, separated by `:`)', 'arg'],
  ['--add-modules', '最初から解決するモジュール（カンマ区切り、`ALL-MODULE-PATH` など）', 'modules to resolve from the start (comma-separated, or `ALL-MODULE-PATH`)', 'arg'],
  ['--add-exports', 'モジュールのパッケージを他のモジュールに公開する（`モジュール/パッケージ=対象`）', 'export a package of a module to others (`MODULE/PACKAGE=TARGET`)', 'arg'],
  ['--add-reads', 'モジュールに別のモジュールを読ませる（`モジュール=対象`）', 'let a module read another (`MODULE=TARGET`)', 'arg'],
  ['--limit-modules', '観測できるモジュールを、指定したものとその依存に限る', 'limit the observable modules to the given ones and their dependencies', 'arg'],
  ['--enable-preview', 'この JDK の版のプレビュー機能を有効にする', 'enable the preview features of this JDK release'],
  ['-version', '版を標準エラー出力に表示して終わる', 'print the version to stderr and exit'],
  ['--version', '版を標準出力に表示して終わる', 'print the version to stdout and exit'],
  ['-help|-?|--help', '使い方を表示する', 'print the usage'],
  ['-verbose', '動きを詳しく表示する（`java` では `-verbose:class`、`:gc`、`:jni` もある）', 'print what it does (`java` also has `-verbose:class`, `:gc`, `:jni`)'],
];

const JAVA: OptSpec[] = [
  ...SHARED,
  ['-jar', '次の語の JAR ファイルの `Main-Class` を実行する（その後の語はプログラムの引数）', 'run the `Main-Class` of the JAR file in the next word (the words after it are the program\'s arguments)'],
  ['-m|--module', '次の語のモジュールのメインクラスを実行する（その後の語はプログラムの引数）', 'run the main class of the module in the next word (the words after it are the program\'s arguments)'],
  ['-h', '使い方を表示する', 'print the usage'],
  ['--list-modules', '観測できるモジュールを一覧表示して終わる', 'list the observable modules and exit'],
  ['-d|--describe-module', 'モジュールの説明を表示して終わる', 'describe a module and exit', 'arg'],
  ['--dry-run', 'VM を作るが、メインクラスは実行しない', 'create the VM, but do not run the main class'],
  ['-showversion|--show-version', '版を標準エラー出力に表示してから、続けて実行する', 'print the version to stderr, then go on and run'],
  ['-X', '標準でない `-X` オプションの一覧を表示する', 'print the non-standard `-X` options'],
  ['-ea|-enableassertions', '`assert` 文を有効にする（`-ea:パッケージ...`、`-ea:クラス` で範囲を絞る）', 'enable `assert` statements (`-ea:PACKAGE...` or `-ea:CLASS` to narrow them)'],
  ['-da|-disableassertions', '`assert` 文を無効にする（既定）', 'disable `assert` statements (the default)'],
  ['-esa|-enablesystemassertions', 'システムクラスの `assert` 文を有効にする', 'enable assertions in the system classes'],
  ['-dsa|-disablesystemassertions', 'システムクラスの `assert` 文を無効にする', 'disable assertions in the system classes'],
  ['-server', 'サーバー VM を使う（今の JDK では既定で、何も変わらない）', 'use the server VM (the default today; no change)'],
  ['-source|--source', 'ソースファイルのモードで、ソースの言語の版を指定する（`java -source 21 Hello.java`）', 'in source-file mode, the language release of the source (`java -source 21 Hello.java`)', 'arg'],
];

const colon = (pattern: RegExp, ja: (v: string) => string, en: (v: string) => string): PatternOption => ({ pattern, text: ([, v]) => tx(ja(v), en(v)) });

const javaPatterns: PatternOption[] = [
  { pattern: /^-D(.+)$/, text: ([, d]) => tx(`システムプロパティ \`${nameOf(d)}\` を${valueOf(d) === undefined ? '空の文字列に' : ` \`${valueOf(d)}\` に`}する（\`System.getProperty\` で読める）`, `set the system property \`${nameOf(d)}\`${valueOf(d) === undefined ? ' to the empty string' : ` to \`${valueOf(d)}\``} (read with \`System.getProperty\`)`) },
  { pattern: /^-XX:(.+)$/, text: ([, f]) => tx(`VM の詳細なオプション \`${f}\`（\`+名前\` で有効、\`-名前\` で無効、\`名前=値\`。JDK の版によって変わる）`, `an advanced VM option \`${f}\` (\`+NAME\` turns it on, \`-NAME\` off, \`NAME=VALUE\` sets it; it varies by JDK release)`) },
  { pattern: /^-Xmx(.+)$/, text: ([, s]) => tx(`ヒープの最大サイズを \`${s}\` にする（\`k\`、\`m\`、\`g\` の単位）`, `maximum heap size \`${s}\` (units \`k\`, \`m\`, \`g\`)`) },
  { pattern: /^-Xms(.+)$/, text: ([, s]) => tx(`ヒープの初期サイズを \`${s}\` にする`, `initial heap size \`${s}\``) },
  { pattern: /^-Xss(.+)$/, text: ([, s]) => tx(`スレッドのスタックサイズを \`${s}\` にする`, `thread stack size \`${s}\``) },
  { pattern: /^-X(.+)$/, text: ([, x]) => tx(`標準でない VM のオプション \`-X${x}\`（\`java -X\` が一覧を出す）`, `a non-standard VM option \`-X${x}\` (\`java -X\` lists them)`) },
  colon(/^-(?:ea|enableassertions):(.*)$/, (v) => `\`assert\` 文を有効にする（範囲は \`${v}\`：パッケージは \`...\` で終わる）`, (v) => `enable \`assert\` statements for \`${v}\` (a package ends in \`...\`)`),
  colon(/^-(?:da|disableassertions):(.*)$/, (v) => `\`assert\` 文を無効にする（範囲は \`${v}\`）`, (v) => `disable \`assert\` statements for \`${v}\``),
  colon(/^-verbose:(.*)$/, (v) => `\`${v}\` について詳しく表示する（\`class\`、\`gc\`、\`jni\`）`, (v) => `print details about \`${v}\` (\`class\`, \`gc\`, \`jni\`)`),
  colon(/^-javaagent:(.*)$/, (v) => `Java エージェントの JAR を読み込む（\`${v}\`：\`jar[=オプション]\`）`, (v) => `load a Java agent JAR (\`${v}\`: \`JAR[=OPTIONS]\`)`),
  colon(/^-agentlib:(.*)$/, (v) => `ネイティブのエージェントのライブラリを読み込む（\`${v}\`：\`名前[=オプション]\`）`, (v) => `load a native agent library (\`${v}\`: \`NAME[=OPTIONS]\`)`),
  colon(/^-agentpath:(.*)$/, (v) => `ネイティブのエージェントをパスで読み込む（\`${v}\`：\`パス[=オプション]\`）`, (v) => `load a native agent by path (\`${v}\`: \`PATH[=OPTIONS]\`)`),
  colon(/^-splash:(.*)$/, (v) => `スプラッシュ画面の画像 \`${v}\``, (v) => `splash screen image \`${v}\``),
];

const ARG = operand('ARG', 'プログラムに渡す引数', 'argument passed to the program', { repeat: '*' });

const javaSpec = cmd(
  'Java のプログラムを実行する（クラス、JAR、モジュール、またはソースファイル 1 つ）',
  'Run a Java program (a class, a JAR, a module, or one source file)',
  JAVA,
  {
    parser: 'single-dash',
    optionsFirst: true,
    patternOptions: javaPatterns,
    helpCommand: 'java -help',
    operands: [
      { when: { option: ['-jar'] }, pattern: [operand('JAR', '実行する JAR ファイル（`Main-Class` を持つもの。これ以降の語はプログラムの引数）', 'JAR file to run (with a `Main-Class`, and the words after it are the program\'s arguments)'), ARG] },
      { when: { option: ['-m', '--module'] }, pattern: [operand('MODULE', '実行するモジュール（`モジュール` か `モジュール/メインクラス`。これ以降の語はプログラムの引数）', 'module to run (`MODULE` or `MODULE/MAINCLASS`, and the words after it are the program\'s arguments)'), ARG] },
      { pattern: [operand('CLASS', 'メインクラス（`com.example.Main`）か、1 つのソースファイル（`Hello.java`、これ以降の語はプログラムの引数）', 'main class (`com.example.Main`) or one source file (`Hello.java`), and the words after it are the program\'s arguments', { repeat: '?' }), ARG] },
    ],
  },
);

const JAVAC: OptSpec[] = [
  ...SHARED,
  ['-d', 'クラスファイルを書き出すディレクトリ（パッケージのディレクトリはその下に作る）', 'directory to write the class files to (the package directories are made below it)', 'arg'],
  ['-s', '生成したソースファイルを書き出すディレクトリ', 'directory to write the generated source files to', 'arg'],
  ['-sourcepath|--source-path', 'ソースファイルを探すパス', 'path to look for source files in', 'arg'],
  ['--module-source-path', 'モジュールごとのソースのパス', 'path of the module source directories', 'arg'],
  ['--module-version', 'コンパイルするモジュールの版', 'version of the module being compiled', 'arg'],
  ['-encoding', 'ソースファイルの文字エンコーディング（`UTF-8`）', 'character encoding of the source files (`UTF-8`)', 'arg'],
  ['-source|--source', 'ソースの言語の版（`17`）', 'language release of the source (`17`)', 'arg'],
  ['-target|--target', '作るクラスファイルの対象の版（`17`）', 'release of the class files to make (`17`)', 'arg'],
  ['--release', '指定した版の公開 API だけを使い、その版向けにコンパイルする（`-source`、`-target` とは同時に使えない）', 'compile for that release, against its public API only (not with `-source` or `-target`)', 'arg'],
  ['-g', 'すべてのデバッグ情報を出す（`-g:none`、`-g:lines,vars,source` もある）', 'generate all debugging information (also `-g:none`, `-g:lines,vars,source`)'],
  ['-nowarn', '警告を出さない', 'generate no warnings'],
  ['-deprecation', '非推奨の API を使った場所を詳しく表示する', 'print the places that use deprecated APIs'],
  ['-Werror', '警告があればコンパイルに失敗させる', 'fail the compilation if there are warnings'],
  ['-parameters', 'メソッドの引数名をクラスファイルに残す（リフレクションで読める）', 'keep method parameter names in the class files (reflection can read them)'],
  ['-processor', '使うアノテーションプロセッサー（クラス名をカンマ区切りで）', 'annotation processors to run (class names, comma-separated)', 'arg'],
  ['-processorpath|--processor-path', 'アノテーションプロセッサーを探すパス', 'path to look for annotation processors in', 'arg'],
  ['--processor-module-path', 'アノテーションプロセッサーのモジュールを探すパス', 'module path to look for annotation processors in', 'arg'],
  ['-h', 'ネイティブのヘッダーファイルを書き出すディレクトリ', 'directory to write the native header files to', 'arg'],
  ['-Xlint', '有効にできる警告をすべて有効にする（`-Xlint:unchecked,-serial` のように種類を選べる）', 'enable all recommended warnings (`-Xlint:unchecked,-serial` picks kinds)'],
  ['-Xmaxerrs', '表示するエラーの最大数', 'maximum number of errors to print', 'arg'],
  ['-Xmaxwarns', '表示する警告の最大数', 'maximum number of warnings to print', 'arg'],
];

const javacPatterns: PatternOption[] = [
  { pattern: /^-A(.+)$/, text: ([, a]) => tx(`アノテーションプロセッサーに渡すオプション \`${nameOf(a)}\`${valueOf(a) === undefined ? '' : `（値は \`${valueOf(a)}\`）`}`, `an option \`${nameOf(a)}\` for the annotation processors${valueOf(a) === undefined ? '' : ` (value \`${valueOf(a)}\`)`}`) },
  { pattern: /^-J(.+)$/, text: ([, j]) => tx(`コンパイラを動かす JVM に渡すオプション \`${j}\``, `an option for the JVM that runs the compiler: \`${j}\``) },
  { pattern: /^-XD(.+)$/, text: ([, x]) => tx(`コンパイラの内部のオプション \`${x}\`（文書化されていない）`, `an internal compiler option \`${x}\` (not documented)`) },
  colon(/^-g:(.*)$/, (v) => `デバッグ情報の種類 \`${v}\`（\`none\`、または \`lines\`、\`vars\`、\`source\`）`, (v) => `kinds of debugging information: \`${v}\` (\`none\`, or \`lines\`, \`vars\`, \`source\`)`),
  colon(/^-Xlint:(.*)$/, (v) => `有効にする警告の種類 \`${v}\`（\`all\`、\`none\`。\`-名前\` で除く）`, (v) => `kinds of warnings to enable: \`${v}\` (\`all\`, \`none\`; \`-NAME\` leaves one out)`),
  colon(/^-proc:(.*)$/, (v) => `アノテーション処理のしかた \`${v}\`（\`none\`: しない、\`only\`: 処理だけで、コンパイルしない、\`full\`）`, (v) => `annotation processing \`${v}\` (\`none\`: off; \`only\`: process, do not compile; \`full\`)`),
  colon(/^-implicit:(.*)$/, (v) => `暗黙にコンパイルしたクラスのクラスファイルを作るか \`${v}\`（\`none\`、\`class\`）`, (v) => `whether to make class files for implicitly compiled classes: \`${v}\` (\`none\`, \`class\`)`),
  colon(/^-Xdiags:(.*)$/, (v) => `エラーの表示の詳しさ \`${v}\`（\`compact\`、\`verbose\`）`, (v) => `how the errors are shown: \`${v}\` (\`compact\`, \`verbose\`)`),
];

const javacSpec = cmd(
  'Java のソースファイルをコンパイルして、クラスファイルを作る',
  'Compile Java source files into class files',
  JAVAC,
  {
    parser: 'single-dash',
    patternOptions: javacPatterns,
    helpCommand: 'javac -help',
    operands: [{ pattern: [operand('SOURCE', 'ソースファイル（`.java`）、または `@ファイル`（オプションとソースの名前を並べたファイル）', 'source file (`.java`), or `@FILE` (a file that lists options and source names)', { repeat: '*' })] }],
  },
);

const KEYTOOL: OptSpec[] = [
  ['-genkeypair|-genkey', '鍵ペアと自己署名証明書を作り、キーストアに入れる', 'generate a key pair and a self-signed certificate, and store them in the keystore'],
  ['-genseckey', '秘密鍵（共通鍵）を作ってキーストアに入れる', 'generate a secret key and store it in the keystore'],
  ['-importcert|-import', '証明書か証明書チェーンをキーストアに取り込む', 'import a certificate or a certificate chain into the keystore'],
  ['-importkeystore', '別のキーストアの項目をすべて（または `-srcalias` の 1 つを）取り込む', 'import all entries (or the `-srcalias` one) from another keystore'],
  ['-importpass', 'パスワードをキーストアに入れる', 'import a password into the keystore'],
  ['-exportcert|-export', '証明書をファイルに書き出す（`-rfc` で PEM 形式）', 'export a certificate to a file (`-rfc`: PEM format)'],
  ['-list', 'キーストアの項目を一覧表示する（`-v` で詳しく）', 'list the entries of the keystore (`-v`: in detail)'],
  ['-printcert', 'ファイルの（または `-sslserver` の）証明書の中身を表示する', 'print the contents of a certificate in a file (or of an `-sslserver`)'],
  ['-printcertreq', '証明書署名要求の中身を表示する', 'print the contents of a certificate request'],
  ['-printcrl', 'CRL ファイルの中身を表示する', 'print the contents of a CRL file'],
  ['-certreq', '証明書署名要求（CSR）を作る', 'generate a certificate request (CSR)'],
  ['-gencert', '証明書署名要求から証明書を作る', 'generate a certificate from a certificate request'],
  ['-gencrl', 'CRL を作る', 'generate a CRL'],
  ['-delete', '`-alias` で指定した項目を削除する', 'delete the entry named by `-alias`'],
  ['-changealias', '項目の別名を `-destalias` に変える', 'change the alias of an entry to `-destalias`'],
  ['-keypasswd', '項目の鍵のパスワードを変える', 'change the password of the key of an entry'],
  ['-storepasswd', 'キーストアのパスワードを変える', 'change the password of the keystore'],
  ['-selfcert', '自己署名証明書を作り直す', 'generate a self-signed certificate again'],
  ['-keyclone', '項目を別名で複製する', 'clone an entry under another alias'],
  ['-identitydb', '古い identity データベースを取り込む', 'import entries from an old identity database'],
  ['-showinfo', 'セキュリティの情報を表示する（`-tls` で TLS の）', 'display the security information (`-tls`: that of TLS)'],
  ['-help|-?', '使い方を表示する（`keytool -genkeypair -help` でコマンドごとの）', 'print the usage (`keytool -genkeypair -help`: that of a command)'],
  ['-alias', '項目の別名（キーストアの中での名前）', 'alias of the entry (its name in the keystore)', 'arg'],
  ['-keystore', 'キーストアのファイル（既定は `~/.keystore`）', 'keystore file (default `~/.keystore`)', 'arg'],
  ['-cacerts', 'JDK の CA 証明書のキーストアを使う', 'use the JDK\'s keystore of CA certificates'],
  ['-storepass', 'キーストアのパスワード（コマンド行に書くと他のユーザーに見える。`:env 名前` や `:file ファイル` で別から読める）', 'keystore password (written on the command line, other users can see it; `:env NAME` or `:file FILE` reads it elsewhere)', 'arg'],
  ['-storetype', 'キーストアの種類（`PKCS12`、`JKS`）', 'keystore type (`PKCS12`, `JKS`)', 'arg'],
  ['-keypass', '項目の鍵のパスワード（省略するとキーストアのパスワードと同じ）', 'password of the entry\'s key (by default the keystore password)', 'arg'],
  ['-keyalg', '鍵のアルゴリズム（`RSA`、`EC`、`DSA`）', 'key algorithm (`RSA`, `EC`, `DSA`)', 'arg'],
  ['-keysize', '鍵のビット数（`2048`）', 'key size in bits (`2048`)', 'arg'],
  ['-groupname', '鍵のグループの名前（`secp256r1`）', 'name of the key group (`secp256r1`)', 'arg'],
  ['-sigalg', '署名のアルゴリズム（`SHA256withRSA`）', 'signature algorithm (`SHA256withRSA`)', 'arg'],
  ['-dname', '証明書の持ち主の識別名（`"CN=localhost, OU=Dev, O=Example, C=JP"`）', 'distinguished name of the owner (`"CN=localhost, OU=Dev, O=Example, C=US"`)', 'arg'],
  ['-validity', '証明書の有効日数', 'validity of the certificate in days', 'arg'],
  ['-startdate', '有効期間の始まり（`2026/01/01 10:00:00` か `+1m`）', 'start of the validity (`2026/01/01 10:00:00` or `+1m`)', 'arg'],
  ['-ext', '証明書の拡張（`SAN=dns:localhost,ip:127.0.0.1`、`bc:c`）', 'certificate extension (`SAN=dns:localhost,ip:127.0.0.1`, `bc:c`)', 'arg'],
  ['-file', '読み書きする証明書などのファイル', 'file to read or write (a certificate, a request)', 'arg'],
  ['-infile', '読み込むファイル', 'file to read', 'arg'],
  ['-outfile', '書き出すファイル', 'file to write', 'arg'],
  ['-rfc', '出力を RFC 1421 の PEM 形式にする', 'output in the RFC 1421 PEM format'],
  ['-v', '詳しく表示する', 'verbose output'],
  ['-noprompt', '確認を聞かずに進める', 'do not ask for confirmation'],
  ['-trustcacerts', 'cacerts の証明書を信頼できるものとして使う', 'trust the certificates of cacerts'],
  ['-protected', 'パスワードを端末でなく、PIN パッドなど保護された手段で入力する', 'the password is entered by a protected means such as a PIN pad, not at the terminal'],
  ['-srckeystore', '取り込み元のキーストア', 'source keystore', 'arg'],
  ['-destkeystore', '取り込み先のキーストア', 'destination keystore', 'arg'],
  ['-srcstoretype', '取り込み元のキーストアの種類', 'type of the source keystore', 'arg'],
  ['-deststoretype', '取り込み先のキーストアの種類', 'type of the destination keystore', 'arg'],
  ['-srcstorepass', '取り込み元のキーストアのパスワード', 'password of the source keystore', 'arg'],
  ['-deststorepass', '取り込み先のキーストアのパスワード', 'password of the destination keystore', 'arg'],
  ['-srckeypass', '取り込み元の鍵のパスワード', 'password of the source key', 'arg'],
  ['-destkeypass', '取り込み先の鍵のパスワード', 'password of the destination key', 'arg'],
  ['-srcalias', '取り込み元の項目の別名', 'alias of the source entry', 'arg'],
  ['-destalias', '取り込み先の項目の別名', 'alias of the destination entry', 'arg'],
  ['-new', '新しいパスワード', 'the new password', 'arg'],
  ['-sslserver', '証明書を取る TLS サーバー（`host[:port]`）', 'TLS server to take the certificate from (`host[:port]`)', 'arg'],
  ['-jarfile', '署名された JAR ファイル', 'signed JAR file', 'arg'],
  ['-providername', '暗号プロバイダーの名前', 'name of the cryptographic provider', 'arg'],
  ['-providerclass', '暗号プロバイダーのクラス', 'class of the cryptographic provider', 'arg'],
  ['-providerpath', '暗号プロバイダーを探すクラスパス', 'class path of the cryptographic provider', 'arg'],
  ['-addprovider', 'セキュリティプロバイダーを名前で追加する', 'add a security provider by name', 'arg'],
  ['-provider', 'セキュリティプロバイダーをクラス名で追加する', 'add a security provider by class name', 'arg'],
  ['-providerarg', '`-addprovider` や `-provider` に渡す引数', 'argument for `-addprovider` or `-provider`', 'arg'],
  ['-conf', 'オプションを読む設定ファイル', 'file of options to read', 'arg'],
  ['-tls', '`-showinfo` と使い、TLS の情報を表示する', 'with `-showinfo`: show the TLS information'],
  ['-debug', 'デバッグの出力をする', 'print debugging output'],
  ['-id', '`-gencert` で使う認証局の項目の id', 'id of the certificate authority entry for `-gencert`', 'arg'],
];

const keytoolSpec = cmd(
  'キーストア（鍵と証明書の入れ物）を操作する。コマンドはオプションの形で書く（`-genkeypair`、`-list`…）',
  'Manage a keystore (keys and certificates). The command is written as an option (`-genkeypair`, `-list`…)',
  KEYTOOL,
  {
    parser: 'single-dash',
    patternOptions: [{ pattern: /^-J(.+)$/, text: ([, j]) => tx(`keytool を動かす JVM に渡すオプション \`${j}\``, `an option for the JVM that runs keytool: \`${j}\``) }],
    helpCommand: 'keytool -help',
  },
);

const MAVEN: OptSpec[] = [
  ['-D|--define', 'システムプロパティを設定する（`-D名前=値`、値がなければ `true`。プラグインが読む）', 'set a system property (`-Dname=value`, `true` with no value; the plugins read them)', 'arg'],
  ['-P|--activate-profiles', 'プロファイルを有効にする（カンマ区切り、`!名前` で無効）', 'activate profiles (comma-separated, `!NAME`: off)', 'arg'],
  ['-pl|--projects', '指定したモジュールだけをビルドする（カンマ区切り、`:artifactId` か相対パス、`!` で除く）', 'build only the given modules (comma-separated, `:artifactId` or a path, `!` leaves out)', 'arg'],
  ['-am|--also-make', '`-pl` のモジュールが依存するモジュールもビルドする', 'also build the modules the `-pl` modules depend on'],
  ['-amd|--also-make-dependents', '`-pl` のモジュールに依存するモジュールもビルドする', 'also build the modules that depend on the `-pl` modules'],
  ['-rf|--resume-from', '指定したモジュールからビルドを再開する', 'resume the build from the given module', 'arg'],
  ['-T|--threads', '並列に動かすスレッド数（`4`、`1C` はコア 1 つに 1 スレッド）', 'threads for a parallel build (`4`, or `1C` per core)', 'arg'],
  ['-f|--file', '使う pom.xml（またはそのあるディレクトリ）', 'the pom.xml to use (or its directory)', 'arg'],
  ['-s|--settings', 'ユーザーの settings.xml の別の場所', 'alternate location of the user settings.xml', 'arg'],
  ['-gs|--global-settings', 'グローバルの settings.xml の別の場所', 'alternate location of the global settings.xml', 'arg'],
  ['-t|--toolchains', 'ユーザーの toolchains.xml の別の場所', 'alternate location of the user toolchains.xml', 'arg'],
  ['-gt|--global-toolchains', 'グローバルの toolchains.xml の別の場所', 'alternate location of the global toolchains.xml', 'arg'],
  ['-l|--log-file', 'ログを標準出力でなく指定したファイルに書く', 'write the log to the given file, not to the console', 'arg'],
  ['-b|--builder', '使うビルド戦略（`singlethreaded`、`multithreaded`）', 'the build strategy (`singlethreaded`, `multithreaded`)', 'arg'],
  ['-B|--batch-mode', '対話しないバッチモードで動かす（色も出さない）', 'batch mode: no interaction, no colours'],
  ['-q|--quiet', 'エラーだけを表示する', 'quiet: show errors only'],
  ['-X|--debug', 'デバッグの出力をする', 'print debugging output'],
  ['-e|--errors', 'エラーのスタックトレースも表示する', 'also show the stack traces of errors'],
  ['-V|--show-version', '版を表示してから続ける', 'show the version, then go on'],
  ['-v|--version', '版を表示して終わる', 'show the version and exit'],
  ['-h|--help', '使い方を表示する', 'show the usage'],
  ['-o|--offline', 'オフラインで動かす（ダウンロードしない）', 'work offline (download nothing)'],
  ['-U|--update-snapshots', 'SNAPSHOT の更新をリモートリポジトリに確かめる', 'check the remote repositories for updated SNAPSHOTs'],
  ['-nsu|--no-snapshot-updates', 'SNAPSHOT の更新を確かめない', 'do not check for updated SNAPSHOTs'],
  ['-ntp|--no-transfer-progress', 'ダウンロードの進み具合を表示しない', 'do not show the progress of downloads'],
  ['-N|--non-recursive', 'サブモジュールをたどらず、このプロジェクトだけをビルドする', 'do not recurse into the modules: build this project only'],
  ['-fae|--fail-at-end', '失敗したモジュールに依存しないモジュールのビルドは続け、最後に失敗にする', 'build the modules that do not depend on a failed one, and fail at the end'],
  ['-ff|--fail-fast', '最初の失敗でビルドを止める（既定）', 'stop at the first failure (the default)'],
  ['-fn|--fail-never', '失敗しても、いつも成功で終わる', 'never fail, whatever happens'],
  ['-C|--strict-checksums', 'チェックサムが合わなければ失敗にする', 'fail the build if a checksum does not match'],
  ['-c|--lax-checksums', 'チェックサムが合わなくても警告だけにする', 'only warn if a checksum does not match'],
  ['-ep|--encrypt-password', 'パスワードを暗号化して表示する（`settings.xml` に書ける形に）', 'encrypt a password for `settings.xml` and print it', 'arg'],
  ['-emp|--encrypt-master-password', 'マスターパスワードを暗号化して表示する', 'encrypt the master password and print it', 'arg'],
  ['--color', '色の使い方（`always`、`never`、`auto`）', 'colour use (`always`, `never`, `auto`)', 'arg'],
  ['--fail-on-severity', '指定した重大度以上のログがあれば失敗にする', 'fail the build if a log message of the given severity is logged', 'arg'],
  ['--raw-streams', 'ログを通さず標準入出力をそのまま使う', 'use the raw standard streams, not logged'],
];

const mavenSpec = cmd(
  'Java のプロジェクトをビルド・管理する（Maven。ライフサイクルのフェーズやプラグインのゴールを順に実行する）',
  'Build and manage a Java project (Maven: it runs lifecycle phases and plugin goals in order)',
  MAVEN,
  {
    parser: 'single-dash',
    patternOptions: [
      { pattern: /^-D(.+)$/, text: ([, d]) => tx(`システムプロパティ \`${nameOf(d)}\` を ${valueOf(d) === undefined ? '`true`' : `\`${valueOf(d)}\``} にする（pom.xml やプラグインが読む${nameOf(d) === 'skipTests' ? '。テストを実行しなくなる' : ''}）`, `set the system property \`${nameOf(d)}\` to ${valueOf(d) === undefined ? '`true`' : `\`${valueOf(d)}\``} (pom.xml and the plugins read it${nameOf(d) === 'skipTests' ? '; the tests are not run' : ''})`) },
      { pattern: /^-P(.+)$/, text: ([, p]) => tx(`プロファイル \`${p}\` を有効にする（カンマ区切り、\`!名前\` で無効）`, `activate the profile \`${p}\` (comma-separated, \`!NAME\`: off)`) },
      { pattern: /^-T(.+)$/, text: ([, t]) => tx(`ビルドを \`${t}\` スレッドで並列に動かす（\`1C\` はコア 1 つに 1 スレッド）`, `build in parallel with \`${t}\` threads (\`1C\`: one per core)`) },
    ],
    helpCommand: 'mvn --help',
    operands: [{ pattern: [operand('GOAL', 'ライフサイクルのフェーズ（`clean`、`compile`、`test`、`package`、`verify`、`install`、`deploy`）か、プラグインのゴール（`dependency:tree`、`groupId:artifactId:version:goal`）', 'lifecycle phase (`clean`, `compile`, `test`, `package`, `verify`, `install`, `deploy`) or plugin goal (`dependency:tree`, `groupId:artifactId:version:goal`)', { repeat: '*' })] }],
  },
);

const GRADLE: OptSpec[] = [
  ['-D|--system-prop', 'JVM のシステムプロパティを設定する（`-D名前=値`）', 'set a JVM system property (`-Dname=value`)', 'arg'],
  ['-P|--project-prop', 'プロジェクトのプロパティを設定する（`-P名前=値`。ビルドスクリプトが読む）', 'set a project property (`-Pname=value`; the build script reads it)', 'arg'],
  ['-x|--exclude-task', '指定したタスクを実行しない', 'do not run the given task', 'arg'],
  ['-p|--project-dir', 'プロジェクトのディレクトリ（既定は今のディレクトリ）', 'project directory (default: the current directory)', 'arg'],
  ['-b|--build-file', '使うビルドファイル', 'the build file to use', 'arg'],
  ['-c|--settings-file', '使う settings ファイル', 'the settings file to use', 'arg'],
  ['-g|--gradle-user-home', 'Gradle のユーザーのホーム（既定は `~/.gradle`）', 'the Gradle user home (default `~/.gradle`)', 'arg'],
  ['-I|--init-script', '実行前に読む初期化スクリプト', 'an init script to run before the build', 'arg'],
  ['--project-cache-dir', 'プロジェクトのキャッシュのディレクトリ', 'directory for the project cache', 'arg'],
  ['-i|--info', 'ログのレベルを info にする', 'log level info'],
  ['-d|--debug', 'ログのレベルを debug にする', 'log level debug'],
  ['-q|--quiet', 'エラーだけをログに出す', 'log errors only'],
  ['-w|--warn', 'ログのレベルを warn にする', 'log level warn'],
  ['-s|--stacktrace', 'エラーのスタックトレースを短く表示する', 'print the stack traces of errors (short)'],
  ['-S|--full-stacktrace', 'エラーのスタックトレースを全部表示する', 'print the full stack traces of errors'],
  ['--console', 'コンソールの出力の形（`auto`、`plain`、`rich`、`verbose`）', 'console output (`auto`, `plain`, `rich`, `verbose`)', 'arg'],
  ['--warning-mode', '警告の表示（`all`、`summary`、`fail`、`none`）', 'how to show warnings (`all`, `summary`, `fail`, `none`)', 'arg'],
  ['--continue', 'タスクが失敗しても、それに依存しないタスクは続けて実行する', 'go on with the tasks that do not depend on a failed one'],
  ['-m|--dry-run', 'タスクを実行せず、実行する順に表示する', 'run no task: list them in the order they would run'],
  ['--offline', 'オフラインで動かす（キャッシュだけを使う）', 'work offline (use the caches only)'],
  ['--refresh-dependencies', '依存をすべてもう一度確かめる', 'check all dependencies again'],
  ['--rerun-tasks', 'すべてのタスクを、最新でも実行し直す', 'run all tasks again, even if up to date'],
  ['--parallel', 'プロジェクトを並列にビルドする', 'build projects in parallel'],
  ['--max-workers', '同時に動かすワーカーの最大数', 'maximum number of workers', 'arg'],
  ['--build-cache', 'ビルドキャッシュを使う', 'use the build cache'],
  ['--no-build-cache', 'ビルドキャッシュを使わない', 'do not use the build cache'],
  ['--configuration-cache', '設定のキャッシュを使う', 'use the configuration cache'],
  ['--no-configuration-cache', '設定のキャッシュを使わない', 'do not use the configuration cache'],
  ['--daemon', 'ビルドにデーモンを使う（既定）', 'use the daemon for the build (the default)'],
  ['--no-daemon', 'デーモンを使わず、このビルドだけの JVM で動かす', 'do not use the daemon: run in a JVM for this build only'],
  ['--stop', '動いているデーモンを止める', 'stop the running daemons'],
  ['--status', 'デーモンの状態を表示する', 'show the status of the daemons'],
  ['-t|--continuous', '入力が変わるたびにビルドをやり直す', 'build again whenever an input changes'],
  ['--scan', 'ビルドスキャンを作って公開する', 'create and publish a build scan'],
  ['--no-scan', 'ビルドスキャンを作らない', 'do not create a build scan'],
  ['--tests', 'テストタスクの絞り込み（`com.example.FooTest.method`、`*Foo*`）。直前のタスクのオプション', 'filter of the test task (`com.example.FooTest.method`, `*Foo*`); an option of the task before it', 'arg'],
  ['-v|--version', '版を表示して終わる', 'print the version and exit'],
  ['-h|-?|--help', '使い方を表示する', 'print the usage'],
];

const gradleSpec = cmd(
  'Java などのプロジェクトをビルドする（Gradle。ビルドスクリプトのタスクを実行する）',
  'Build a Java (and similar) project (Gradle: it runs the tasks of the build script)',
  GRADLE,
  {
    helpCommand: 'gradle --help',
    operands: [{ pattern: [operand('TASK', 'タスク（`build`、`test`、`clean`、`:app:assemble`。`:` を使ってプロジェクトのパスを前に付けられ、`cB` のような略称も使える）', 'task (`build`, `test`, `clean`, `:app:assemble` with a project path before it, or an abbreviation such as `cB`)', { repeat: '*' })] }],
  },
);

export const java: Record<string, CommandSpec> = {
  java: javaSpec,
  javac: javacSpec,
  keytool: keytoolSpec,
  mvn: mavenSpec,
  gradle: gradleSpec,
};
