// java, javac, keytool, mvn and gradle against the real tools: the recorded usage texts (test/fixtures/java/) are still what the tools
// print, and the rules the specs state for operands and option forms hold when the tools run. The tools are found through
// $BASH_EXPLAINER_JDK (a JDK's home), $MVN and $GRADLE (the scripts); the rows of a missing one are skipped. CI does not install them.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { lookupCommand } from '../src/analyzer';
import { interpret } from '../src/argv/interpret';
import { argWords } from './support/argwords';

const JDK = process.env.BASH_EXPLAINER_JDK;
const MVN = process.env.MVN;
const GRADLE = process.env.GRADLE;
const withJdk = (JDK && fs.existsSync(path.join(JDK, 'bin', 'java')) ? it : it.skip) as typeof it;
const withMvn = (JDK && MVN && fs.existsSync(MVN) ? it : it.skip) as typeof it;
const withGradle = (JDK && GRADLE && fs.existsSync(GRADLE) ? it : it.skip) as typeof it;

const fixture = (name: string): string[] => fs.readFileSync(path.join(__dirname, 'fixtures', 'java', name), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));

/** The roles of the words of `tool ARGS` in the spec, by word. */
function roles(tool: string, args: string[]): string[] {
  const { name, words } = argWords(`${tool} ${args.map((w) => `'${w}'`).join(' ')}`);
  const p = interpret(lookupCommand(name)!, words, { name, lookup: lookupCommand });
  return args.map((_, i) => p.roles.find((r) => r.word === i)?.role.role ?? 'none');
}

/** A directory of our own, removed by its exact path. */
function within(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'java-real-'));
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const jdk = (tool: string, args: string[], cwd: string): { out: string; status: number | null } => {
  const r = spawnSync(path.join(JDK!, 'bin', tool), args, { cwd, encoding: 'utf8', timeout: 120000, env: { ...process.env, JAVA_HOME: JDK } });
  return { out: r.stdout + r.stderr, status: r.status };
};

// Each case starts JVMs (a Gradle or Maven run is several seconds, more under a loaded machine), so none keeps mocha's 10 s default.
describe('java tools against the real tools', function () {
  this.timeout(60000);
  withJdk('the recorded usage lines of java, javac and keytool are what the JDK prints', () => {
    within((dir) => {
      const java = jdk('java', ['--help'], dir).out + jdk('java', ['--help-extra'], dir).out;
      const javac = jdk('javac', ['--help'], dir).out + jdk('javac', ['--help-extra'], dir).out;
      for (const l of fixture('java.txt')) assert.ok(java.includes(l.trim().replace(/\s{2,}.*/, '')), `java: ${l}`);
      for (const l of fixture('javac.txt')) assert.ok(javac.includes(l), `javac: ${l}`);
      const keytool = jdk('keytool', ['-help'], dir).out;
      for (const c of fixture('keytool.txt')[0].replace('commands: ', '').split(' ')) assert.ok(keytool.includes(` ${c} `), `keytool: ${c}`);
      for (const line of fixture('keytool.txt').slice(1)) {
        const [c, items] = [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(': ') + 2)];
        const help = jdk('keytool', [c, '-help'], dir).out;
        for (const item of items.split(', ').filter(Boolean)) assert.ok(help.includes(item.split(' ')[0]), `keytool ${c}: ${item}`);
      }
    });
  });

  withJdk('java: the words after the main class, or after the file of -jar, are the program\'s; -name=value is refused', () => {
    within((dir) => {
      fs.mkdirSync(path.join(dir, 'out'));
      fs.writeFileSync(path.join(dir, 'Main.java'), 'public class Main { public static void main(String[] a) { System.out.println("args=" + String.join("|", a) + " foo=" + System.getProperty("foo")); } }\n');
      fs.writeFileSync(path.join(dir, 'm.txt'), 'Main-Class: Main\n');
      assert.strictEqual(jdk('javac', ['-d', 'out', 'Main.java'], dir).status, 0);
      assert.strictEqual(jdk('jar', ['cfm', 'app.jar', 'm.txt', '-C', 'out', '.'], dir).status, 0);
      // -jar FILE ARGS
      assert.match(jdk('java', ['-Dfoo=bar', '-jar', 'app.jar', '--port', '80', '-v'], dir).out, /^args=--port\|80\|-v foo=bar/);
      assert.deepStrictEqual(roles('java', ['-Dfoo=bar', '-jar', 'app.jar', '--port', '80', '-v']), ['pattern-option', 'option', 'operand', 'operand', 'operand', 'operand']);
      // CLASS ARGS
      assert.match(jdk('java', ['-cp', 'out', 'Main', '-Dfoo=1', '-v'], dir).out, /^args=-Dfoo=1\|-v foo=null/);
      assert.deepStrictEqual(roles('java', ['-cp', 'out', 'Main', '-Dfoo=1', '-v']), ['option', 'value', 'operand', 'operand', 'operand']);
      // SOURCE FILE ARGS, with --source (and not -source)
      assert.match(jdk('java', ['--source', '21', 'Main.java', 'a'], dir).out, /^args=a /);
      assert.notStrictEqual(jdk('java', ['-source', '21', 'Main.java'], dir).status, 0);
      assert.deepStrictEqual(roles('java', ['-source', '21', 'Main.java']), ['unknown-option', 'operand', 'operand']);
      // --name=value for a long option; no -name=value
      assert.match(jdk('java', ['--class-path=out', 'Main'], dir).out, /^args= /);
      assert.deepStrictEqual(roles('java', ['--class-path=out', 'Main']), ['option', 'operand']);
      assert.notStrictEqual(jdk('java', ['-classpath=out', 'Main'], dir).status, 0);
      assert.deepStrictEqual(roles('java', ['-classpath=out', 'Main']), ['unknown-option', 'operand']);
      // -Dname alone is the empty string
      assert.match(jdk('java', ['-Dfoo', '-cp', 'out', 'Main'], dir).out, /foo=$/m);
      // javac and keytool refuse -name=value too
      assert.notStrictEqual(jdk('javac', ['-classpath=out', 'Main.java'], dir).status, 0);
      assert.deepStrictEqual(roles('javac', ['-classpath=out', 'Main.java']), ['unknown-option', 'operand']);
      assert.match(jdk('keytool', ['-list', '-keystore=ks.p12'], dir).out, /Illegal option/);
      assert.deepStrictEqual(roles('keytool', ['-list', '-keystore=ks.p12']), ['option', 'unknown-option']);
      // javac takes options after the files
      assert.strictEqual(jdk('javac', ['Main.java', '-d', 'out', '-nowarn'], dir).status, 0);
      assert.deepStrictEqual(roles('javac', ['Main.java', '-d', 'out', '-nowarn']), ['operand', 'option', 'value', 'option']);
    });
  });

  withMvn('mvn: -f=x and -D x=y are read, a prefix of a long option is not, and a bundle is an option and a goal', () => {
    within((dir) => {
      fs.writeFileSync(path.join(dir, 'pom.xml'), '<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>g</groupId><artifactId>a</artifactId><version>1</version><packaging>pom</packaging></project>\n');
      const mvn = (args: string[]): { out: string; status: number | null } => {
        const r = spawnSync(MVN!, ['-o', ...args], { cwd: dir, encoding: 'utf8', timeout: 180000, env: { ...process.env, JAVA_HOME: JDK, MAVEN_USER_HOME: path.join(dir, 'm2') } });
        return { out: r.stdout + r.stderr, status: r.status };
      };
      assert.strictEqual(mvn(['-f=pom.xml', '-D', 'x=y', '-pl', '.', 'validate']).status, 0);
      assert.deepStrictEqual(roles('mvn', ['-f=pom.xml', '-D', 'x=y', '-pl', '.', 'validate']), ['option', 'option', 'value', 'option', 'value', 'operand']);
      assert.notStrictEqual(mvn(['--proj=.', 'validate']).status, 0);
      assert.deepStrictEqual(roles('mvn', ['--proj=.', 'validate']), ['unknown-option', 'operand']);
      // commons-cli takes the first letter of a bundle as the option and the rest as a goal: `-qB` is `-q` and the phase `B`.
      assert.match(mvn(['-qB', 'validate']).out, /Unknown lifecycle phase "B"/);
    });
  });

  withGradle('gradle: -xtest, a cluster of flags, and an abbreviated task', () => {
    within((dir) => {
      fs.writeFileSync(path.join(dir, 'settings.gradle'), "rootProject.name = 'x'\n");
      fs.writeFileSync(path.join(dir, 'build.gradle'), "tasks.register('buildDocs') { doLast { println 'docs ran' } }\ntasks.register('test') { doLast { println 'test ran' } }\ntasks.register('build') { dependsOn 'test'; doLast { println 'build ran' } }\n");
      const gradle = (args: string[]): { out: string; status: number | null } => {
        const r = spawnSync(GRADLE!, ['--no-daemon', '--offline', ...args], { cwd: dir, encoding: 'utf8', timeout: 300000, env: { ...process.env, JAVA_HOME: JDK, GRADLE_USER_HOME: path.join(dir, 'home') } });
        return { out: r.stdout + r.stderr, status: r.status };
      };
      const a = gradle(['-q', '-xtest', 'build']);
      assert.ok(a.out.includes('build ran') && !a.out.includes('test ran'), a.out);
      assert.deepStrictEqual(roles('gradle', ['-q', '-xtest', 'build']), ['option', 'option', 'operand']);
      assert.match(gradle(['-qd', 'bD']).out, /docs ran/);
      assert.deepStrictEqual(roles('gradle', ['-qd', 'bD']), ['cluster', 'operand']);
      assert.match(gradle(['--tests=x', 'build']).out, /Unknown command-line option '--tests'/);
    });
  });
});
