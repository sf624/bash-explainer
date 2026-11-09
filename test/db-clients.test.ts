// The database clients (src/dict/databases.ts): psql and pg_dump 16.15, mysql and mysqldump 8.0.46 (MySQL, not MariaDB),
// sqlite3 3.54.1. The options of each spec are compared with the usage recorded in test/fixtures/db/ (always), and the
// recorded usage with the real programs when $PSQL, $PG_DUMP, $MYSQL, $MYSQLDUMP, $SQLITE3 are set (CI does not install them).
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Analyzer, lookupCommand, Token } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

type Value = 'none' | 'required' | 'optional';
/** The options of a usage text, with the value each takes (the first mention of a name wins). */
function usageOptions(text: string, sqlite = false): Map<string, Value> {
  const out = new Map<string, Value>();
  for (const line of text.split('\n')) {
    if (sqlite) {
      // (`--` ends the options: it is no option.)
      const m = /^ {3}(-\S+)/.exec(line);
      if (!m || m[1] === '--') continue;
      const rest = line.slice(3 + m[1].length);
      // `-[no]header`: two options. A value is named in capitals in the next word (`-cmd COMMAND`, `-lookaside SIZE N`).
      const names = m[1].startsWith('-[no]') ? ['-' + m[1].slice(5), '-no' + m[1].slice(5)] : [m[1]];
      for (const n of names) out.set(n, /^ [A-Z][A-Z0-9.]*(?: [A-Z][A-Z0-9.]*)?(?: {2,}|$)/.test(rest) ? 'required' : 'none');
      continue;
    }
    // (An option starts a line, up to six blanks in; the text that goes on below is indented much more.)
    const head = /^ {0,6}(-\S.*?)(?: {2,}|$)/.exec(line)?.[1];
    if (!head || /^--help=/.test(head)) continue;
    // (`-1 ("one")` of psql is a short option too. The value is written on the long name, and counts for the short one before it.)
    const toks = head.match(/--[a-z0-9][a-z0-9-]*(?:\[?=[^\s,]*)?|(?<![\w-])-[A-Za-z0-9?#](?![\w-])/g) ?? [];
    const kind: Value = toks.some((t) => /^--[\w-]+\[=/.test(t)) ? 'optional' : toks.some((t) => /^--[\w-]+=/.test(t)) ? 'required' : 'none';
    for (const tok of toks) {
      const name = /^[^=[]+/.exec(tok)![0];
      if (!out.has(name)) out.set(name, kind);
    }
  }
  return out;
}

const FIXTURES = path.join(__dirname, 'fixtures', 'db');
const usage = (file: string): string => fs.readFileSync(path.join(FIXTURES, file), 'utf8');

const TOOLS: { name: string; file: string; env: string; sqlite?: true; version: RegExp; usageArgs: string[] }[] = [
  { name: 'psql', file: 'psql.txt', env: 'PSQL', version: /^psql \(PostgreSQL\) 16\.15/, usageArgs: ['--help'] },
  { name: 'pg_dump', file: 'pg_dump.txt', env: 'PG_DUMP', version: /^pg_dump \(PostgreSQL\) 16\.15/, usageArgs: ['--help'] },
  { name: 'mysql', file: 'mysql.txt', env: 'MYSQL', version: /Ver 8\.0\.46/, usageArgs: ['--help'] },
  { name: 'mysqldump', file: 'mysqldump.txt', env: 'MYSQLDUMP', version: /Ver 8\.0\.46/, usageArgs: ['--help'] },
  { name: 'sqlite3', file: 'sqlite3.txt', env: 'SQLITE3', sqlite: true, version: /^3\.54\.1 /, usageArgs: ['-help'] },
];

/** Names the spec has besides the usage: the forms of a boolean option that MySQL reads, `--skip-NAME` and `--disable-NAME` (its usage mentions them in the text of `NAME`). */
const MYSQL_NEGATIONS = /^--(?:skip|disable|enable)-(.+)$/;

describe('database clients: the options of the specs', () => {
  for (const t of TOOLS) {
    it(`${t.name}: every option of its usage is in the spec, with the same kind of value, and the spec has nothing else`, () => {
      const fromUsage = usageOptions(usage(t.file), t.sqlite);
      assert.ok(fromUsage.size > 30, `${t.name}: ${fromUsage.size} options read`);
      const spec = lookupCommand(t.name)!;
      const specOptions = new Map<string, Value>();
      for (const o of spec.options!) for (const n of o.names) specOptions.set(n, !o.value ? 'none' : (o.value as { optional?: boolean }).optional ? 'optional' : 'required');
      const missing = [...fromUsage.keys()].filter((n) => !specOptions.has(n));
      assert.deepStrictEqual(missing, [], `${t.name}: in the usage, not in the spec`);
      const extra = [...specOptions.keys()].filter((n) => !fromUsage.has(n));
      for (const n of extra) {
        const base = MYSQL_NEGATIONS.exec(n)?.[1];
        assert.ok(base && t.name.startsWith('mysql') && (fromUsage.has('--' + base) || fromUsage.has(n.replace(/^--(?:skip|disable)-/, '--no-'))), `${t.name}: ${n} is not in the usage`);
      }
      const wrong = [...fromUsage].filter(([n, v]) => specOptions.get(n) !== v).map(([n, v]) => `${n}: usage ${v}, spec ${specOptions.get(n)}`);
      assert.deepStrictEqual(wrong, [], `${t.name}: the kind of value`);
    });
  }

  it('the usage extractor reads the odd lines of the usages', () => {
    const ps = usageOptions(usage('psql.txt'));
    assert.strictEqual(ps.get('-1'), 'none');
    assert.strictEqual(ps.get('--variable'), 'required');
    assert.strictEqual(ps.get('--help'), 'optional');
    assert.strictEqual(ps.has('--commands'), false);
    const my = usageOptions(usage('mysql.txt'));
    assert.strictEqual(my.get('--password'), 'optional');
    assert.strictEqual(my.get('--no-defaults'), 'none');
    assert.strictEqual(my.get('--defaults-file'), 'required');
    const sq = usageOptions(usage('sqlite3.txt'), true);
    assert.strictEqual(sq.get('-noheader'), 'none');
    assert.strictEqual(sq.get('-cmd'), 'required');
    assert.strictEqual(sq.get('-A'), 'required');
    assert.strictEqual(sq.get('-lookaside'), 'required');
    assert.strictEqual(sq.get('-noinit'), 'none');
  });
});

const parser = createUnbashParser();
/** The words of a line with their text, as `label: explanation`. */
const parts = (src: string, lang: 'en' | 'ja' = 'en'): string[] => {
  const out: Token[] = [];
  const walk = (t: Token) => (out.push(t), t.children.forEach(walk));
  new Analyzer(lang).explainLine(parser.parse(src), 0).items.forEach(walk);
  return out.filter((t) => t.kind === 'argument' || t.kind === 'option').map((t) => `${t.label}: ${t.explanation}`);
};

describe('database clients: how a call is read', () => {
  it('psql: a Docker entrypoint line reads its options and the connection words', () => {
    const p = parts('psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -X -q <<-EOSQL\nCREATE DATABASE x;\nEOSQL');
    assert.match(p[0], /^-v: set the psql variable NAME to VALUE/);
    assert.match(p[1], /^ON_ERROR_STOP=1: /);
    assert.match(p[2], /^--username: database user name to connect as/);
    assert.match(p[4], /^--dbname: database to connect to/);
    assert.match(p[6], /^-X: do not read the startup file/);
    assert.match(p[7], /^-q: run quietly/);
  });

  it('psql: -c, -f, a unique prefix of a long option, and the operands', () => {
    const p = parts("psql -h db -p 5433 -U app -c 'select 1' --vers appdb");
    assert.match(p[0], /^-h: host name of the server/);
    assert.match(p[8], /^--vers: print the version and exit/);
    assert.match(p[9], /^appdb: database name \(a connection string/);
    assert.match(parts('psql -f schema.sql postgresql://u@h/db')[2], /^postgresql:\/\/u@h\/db: database name .*a password in a URI can be seen by other users/);
    assert.match(parts('psql -d db -f setup.sql', 'ja')[2], /^-f: ファイルのコマンドを実行して終わる/);
  });

  it('mysql: a password attached to -p is on the command line, and other users can see it; -p alone asks on the terminal', () => {
    const p = parts('mysql -uroot -psecret -h db -D shop');
    assert.match(p[2], /^-psecret: password \(written on the command line, other users can see it\)/);
    assert.match(p[3], /^secret: /);
    assert.match(parts('mysql --password=secret')[0], /^--password=secret: password \(written on the command line, other users can see it\)/);
    assert.match(parts('mysqldump --password2=x db')[0], /^--password2=x: password for the second authentication factor \(written on the command line/);
    assert.match(parts('mysql -psecret', 'ja')[0], /^-psecret: パスワード（コマンド行に書くと他のユーザーに見える）/);
    for (const line of ['mysql -p shop', 'mysqldump --single-transaction -u root -p mydb > dump.sql', 'mysql --password db']) {
      const first = parts(line).find((t) => /^(-p|--password):/.test(t))!;
      assert.match(first, /^(-p|--password): ask for the password on the terminal \(the next word is not the password: `-p secret` takes `secret` as the database\)$/);
      assert.doesNotMatch(first, /other users/);
    }
    assert.match(parts('mysql -p shop')[1], /^shop: database to use/);
    assert.match(parts('mysql -p', 'ja')[0], /^-p: パスワードを端末で尋ねる（.*データベース名/);
    assert.doesNotMatch(parts('mysql -p', 'ja')[0], /他のユーザー/);
  });

  it('mysql: -e takes its statement as a value, and options cluster', () => {
    const p = parts("mysql -Bse 'select 1' db");
    assert.match(p[0], /^-Bse: Combined short options/);
    assert.match(p[1], /^-B: do not use the history file/);
    assert.match(p[2], /^-s: print less/);
    assert.match(p[3], /^-e: run the statements and quit/);
    assert.match(p[4], /^'select 1': Value for `-e`/);
    assert.match(p[5], /^db: database to use/);
    assert.match(parts('mysql --skip-column-names --user root -e 1')[0], /^--skip-column-names: do not write the column names/);
  });

  it('mysqldump: the operands are a database and its tables, or databases with --databases', () => {
    const one = parts('mysqldump -u root -psecret --single-transaction shop orders items');
    assert.match(one[2], /^-psecret: password/);
    assert.match(one[5], /^shop: database to dump/);
    assert.match(one[6], /^orders: table to dump/);
    const many = parts('mysqldump --databases a b');
    assert.match(many[1], /^a: database to dump \(each word is one\)/);
    assert.match(many[2], /^b: database to dump \(each word is one\)/);
    assert.match(parts('mysqldump --all-databases --result-file=all.sql')[1], /^--result-file=all\.sql: write the output to the given file/);
  });

  it('pg_dump: a format, a file, and a database', () => {
    const p = parts('pg_dump -Fc -f out.dump -h db -U app --no-owner appdb');
    assert.match(p[0], /^-Fc: output format/);
    assert.match(p[2], /^-f: file \(a directory with `-Fd`\) to write/);
    assert.match(p[9], /^appdb: database to dump/);
  });

  it('sqlite3: the database, then SQL and dot-commands, with options anywhere and in either dash form', () => {
    const p = parts("sqlite3 t.db -header --csv '.mode json' 'select * from a;'");
    assert.match(p[0], /^t\.db: database file/);
    assert.match(p[1], /^-header: turn headers on/);
    assert.match(p[2], /^--csv: set `\.mode csv -limits off`/);
    assert.match(p[3], /^'\.mode json': SQL statement or dot-command/);
    assert.match(p[4], /^'select \* from a;': SQL statement or dot-command/);
    const c = parts("sqlite3 -cmd '.timeout 1000' -init init.sql :memory:");
    assert.match(c[0], /^-cmd: command \(SQL or a dot-command\)/);
    assert.match(c[2], /^-init: file to read and run/);
  });
});

describe('database clients: the real programs', () => {
  for (const t of TOOLS) {
    const bin = process.env[t.env];
    const real = (bin ? it : it.skip) as typeof it;
    // (The usage text names the program and the user's name: only the options are compared.)
    real(`${t.name}: the recorded usage is the real one (${t.env})`, () => {
      const v = spawnSync(bin!, [t.sqlite ? '-version' : '--version'], { encoding: 'utf8', timeout: 30000, env: { ...process.env, HOME: '/nonexistent' } });
      assert.match(v.stdout, t.version);
      const r = spawnSync(bin!, t.usageArgs, { encoding: 'utf8', timeout: 30000, env: { ...process.env, HOME: '/nonexistent' } });
      const real = usageOptions(r.stdout + r.stderr, t.sqlite);
      assert.deepStrictEqual([...real], [...usageOptions(usage(t.file), t.sqlite)]);
    });
  }

  const sqlite = process.env.SQLITE3;
  (sqlite ? it : it.skip)('sqlite3: the first word is the database, the rest run in order, and options may follow the database in either dash form', () => {
    const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'sqlite-'));
    try {
      const db = path.join(dir, 't.db');
      const run = (...args: string[]) => spawnSync(sqlite!, args, { encoding: 'utf8', timeout: 30000, env: { ...process.env, HOME: '/nonexistent' } });
      assert.strictEqual(run(db, 'create table a(x);', 'insert into a values (1),(2);').status, 0);
      assert.strictEqual(run(db, '--csv', '-header', 'select * from a;').stdout, 'x\r\n1\r\n2\r\n');
      assert.strictEqual(run(db, '.mode json', 'select * from a;').stdout, '[{"x":1},\n{"x":2}]\n');
      assert.strictEqual(run('-json', db, 'select count(*) as n from a').stdout, '[{"n":2}]\n');
      assert.match(run('-bogus').stderr, /unknown option: -bogus/);
      // (a database file is created when it is missing)
      assert.strictEqual(fs.existsSync(path.join(dir, 'new.db')), false);
      run(path.join(dir, 'new.db'), 'create table b(y);');
      assert.strictEqual(fs.existsSync(path.join(dir, 'new.db')), true);
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });

  const mysql = process.env.MYSQL;
  (mysql ? it : it.skip)('mysql: no abbreviations of long options, and a clustered short option is read', () => {
    const run = (...args: string[]) => spawnSync(mysql!, args, { encoding: 'utf8', timeout: 30000, env: { ...process.env, HOME: '/nonexistent' } });
    assert.match(run('--verbo').stderr, /unknown option '--verbo'/);
    assert.match(run('--skip-column-name').stderr, /unknown option/);
    assert.doesNotMatch(run('-Bse', 'select 1', '-h', 'nonexistent.invalid').stderr, /unknown option/);
    assert.match(run('--print-defaults').stdout, / would have been started with the following arguments:/);
  });

  const psql = process.env.PSQL;
  (psql ? it : it.skip)('psql: a unique prefix of a long option stands for it, and the password has no option', () => {
    const run = (...args: string[]) => spawnSync(psql!, args, { encoding: 'utf8', timeout: 30000, env: { ...process.env, HOME: '/nonexistent' } });
    assert.match(run('--vers').stdout, /^psql \(PostgreSQL\) 16\./);
    assert.match(run('--password=x').stderr, /option '--password' doesn't allow an argument/);
  });
});
