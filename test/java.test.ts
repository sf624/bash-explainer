// java, javac, keytool, mvn and gradle (src/dict/java.ts): how their options and operands are read. The spec is written from the
// tools' usage texts and compared with no real binary (none of them is installed where the suite runs).
import * as assert from 'assert';
import { Analyzer, lookupCommand, Token } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

const parser = createUnbashParser();
/** The options and arguments of a line, each as `text: explanation`. */
const parts = (src: string, lang: 'en' | 'ja' = 'en'): string[] => {
  const out: Token[] = [];
  const walk = (t: Token) => (out.push(t), t.children.forEach(walk));
  new Analyzer(lang).explainLine(parser.parse(src), 0).items.forEach(walk);
  return out.filter((t) => t.kind === 'argument' || t.kind === 'option').map((t) => `${t.label}: ${t.explanation}`);
};
const one = (src: string, lang: 'en' | 'ja' = 'en'): string => parts(src, lang)[0];

describe('java tools', () => {
  it('java: single-dash options, -D and -X forms, then the main class ends the options', () => {
    const p = parts('java -Xmx512m -Xms64m -Xss1m -Xshare:auto -Dfoo=bar -Dflag -XX:+UseG1GC -cp out Main --port 80 -v');
    assert.match(p[0], /^-Xmx512m: maximum heap size `512m`/);
    assert.match(p[1], /^-Xms64m: initial heap size `64m`/);
    assert.match(p[2], /^-Xss1m: thread stack size `1m`/);
    assert.match(p[3], /^-Xshare:auto: a non-standard VM option `-Xshare:auto`/);
    assert.match(p[4], /^-Dfoo=bar: set the system property `foo` to `bar`/);
    assert.match(p[5], /^-Dflag: set the system property `flag` to the empty string/);
    assert.match(p[6], /^-XX:\+UseG1GC: an advanced VM option `\+UseG1GC`/);
    assert.match(p[7], /^-cp: class path/);
    assert.match(p[8], /^out: Value for `-cp`/);
    assert.match(p[9], /^Main: main class/);
    for (const k of [10, 11, 12]) assert.match(p[k], /: argument passed to the program$/);
    assert.match(one('java -Dfoo=bar', 'ja'), /^-Dfoo=bar: システムプロパティ `foo` を `bar` にする/);
  });

  it('java: the colon forms', () => {
    const cases: [string, RegExp][] = [
      ['-ea:com.example...', /enable `assert` statements for `com.example...`/],
      ['-da:Foo', /disable `assert` statements for `Foo`/],
      ['-verbose:gc', /details about `gc`/],
      ['-javaagent:a.jar=x', /load a Java agent JAR/],
      ['-agentlib:jdwp=transport=dt_socket', /native agent library/],
      ['-agentpath:/p/a.so', /native agent by path/],
      ['-splash:img.png', /splash screen image `img.png`/],
    ];
    for (const [w, re] of cases) {
      assert.match(one(`java ${w} Main`), re, w);
      assert.ok(one(`java ${w} Main`, 'ja').startsWith(w + ': '), w);
    }
    assert.match(one('java -ea Main'), /^-ea: enable `assert` statements/);
  });

  it('java -jar and -m: the next word is the file or the module, and the words after it are the program\'s own', () => {
    const jar = parts('java -jar app.jar --port 80 -x');
    assert.match(jar[0], /^-jar: run the `Main-Class`/);
    assert.match(jar[1], /^app\.jar: JAR file to run/);
    for (const k of [2, 3, 4]) assert.match(jar[k], /: argument passed to the program$/);
    const mod = parts('java --module mod/pkg.Main -x');
    assert.match(mod[1], /^mod\/pkg\.Main: module to run/);
    assert.match(mod[2], /^-x: argument passed to the program/);
    assert.match(parts('java -m mod -x', 'ja')[1], /^mod: 実行するモジュール/);
  });

  it('javac: options anywhere, attached forms, source files and @files', () => {
    const p = parts('javac -d out -classpath "lib/*" -Xlint:all -g:none -Aflag -Aname=v -J-Xmx1g -XDfoo -proc:only -implicit:none -Xdiags:verbose -Xlint -g A.java -Werror @args');
    assert.match(p[0], /^-d: directory to write the class files to/);
    assert.match(p[2], /^-classpath: class path/);
    assert.match(p[4], /^-Xlint:all: kinds of warnings to enable: `all`/);
    assert.match(p[5], /^-g:none: kinds of debugging information: `none`/);
    assert.match(p[6], /^-Aflag: an option `flag` for the annotation processors$/);
    assert.match(p[7], /^-Aname=v: .* \(value `v`\)$/);
    assert.match(p[8], /^-J-Xmx1g: an option for the JVM that runs the compiler: `-Xmx1g`/);
    assert.match(p[9], /^-XDfoo: an internal compiler option `foo`/);
    assert.match(p[10], /^-proc:only: annotation processing `only`/);
    assert.match(p[11], /^-implicit:none: whether to make class files/);
    assert.match(p[12], /^-Xdiags:verbose: how the errors are shown/);
    assert.match(p[13], /^-Xlint: enable all recommended warnings/);
    assert.match(p[14], /^-g: generate all debugging information/);
    assert.match(p[15], /^A\.java: source file/);
    assert.match(p[16], /^-Werror: fail the compilation/);
    assert.match(p[17], /^@args: source file .* `@FILE`/);
    assert.match(one('javac -h include A.java'), /^-h: directory to write the native header files to/);
    assert.match(one('javac -Aflag', 'ja'), /^-Aflag: アノテーションプロセッサーに渡すオプション `flag`$/);
  });

  it('keytool: the command is an option', () => {
    const p = parts('keytool -genkeypair -alias k -keyalg RSA -storepass changeit -J-Xmx1g');
    assert.match(p[0], /^-genkeypair: generate a key pair/);
    assert.match(p[1], /^-alias: alias of the entry/);
    assert.match(p[5], /^-storepass: keystore password \(written on the command line, other users can see it/);
    assert.match(p[7], /^-J-Xmx1g: an option for the JVM that runs keytool/);
    assert.match(one('keytool -genkey'), /^-genkey: generate a key pair/);
    assert.match(one('keytool -list -v'), /^-list: list the entries/);
  });

  it('mvn: multi-letter short options, -D, -P and -T attached or separate, phases as operands', () => {
    const p = parts('mvn -DskipTests -Dx=y -Pdev -T1C -pl :a -am -fae -ntp clean verify');
    assert.match(p[0], /^-DskipTests: set the system property `skipTests` to `true` .*the tests are not run/);
    assert.match(p[1], /^-Dx=y: set the system property `x` to `y` \(pom\.xml and the plugins read it\)$/);
    assert.match(p[2], /^-Pdev: activate the profile `dev`/);
    assert.match(p[3], /^-T1C: build in parallel with `1C` threads/);
    assert.match(p[4], /^-pl: build only the given modules/);
    assert.match(p[6], /^-am: also build the modules/);
    assert.match(p[7], /^-fae: build the modules that do not depend on a failed one/);
    assert.match(p[9], /^clean: lifecycle phase/);
    assert.match(p[10], /^verify: lifecycle phase/);
    assert.match(one('mvn -D x=y test'), /^-D: set a system property/);
    assert.match(one('mvn -DskipTests', 'ja'), /^-DskipTests: システムプロパティ `skipTests` を `true` にする（.*テストを実行しなくなる）/);
    assert.match(one('./mvnw -q test'), /^-q: quiet/);
  });

  it('gradle: tasks are operands; -D, -P and -x take their values; ./gradlew is gradle', () => {
    const p = parts('gradle -x test --info build -Pver=1 -Dorg.gradle.daemon=false :app:assemble --tests Foo');
    assert.match(p[0], /^-x: do not run the given task/);
    assert.match(p[1], /^test: Value for `-x`/);
    assert.match(p[3], /^build: task/);
    assert.match(p[4], /^-Pver=1: set a project property/);
    assert.match(p[6], /^-Dorg\.gradle\.daemon=false: set a JVM system property/);
    assert.match(p[8], /^:app:assemble: task/);
    assert.match(parts('./gradlew clean --no-daemon')[0], /^clean: task/);
    assert.ok(lookupCommand('gradlew') && lookupCommand('mvnw'));
  });
});
