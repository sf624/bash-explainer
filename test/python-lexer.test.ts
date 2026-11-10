import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { isName, isOp, type PyField, type PyLiteral, type PyToken, pyLex } from '../src/hosts/pylex';
import { PYTHON_REFERENCE } from '../src/python-reference';
import { escapeAt, pyValue } from '../src/hosts/pyvalue';
import { pyImports, pyResolve } from '../src/hosts/pyimports';
import { extractShell } from '../src/hosts';
import { needPython, pythonReference } from './support/python';

// The Python host's lexer (src/hosts/pylex.ts) and the value of its string literals (src/hosts/pyvalue.ts), against the
// reference Python's own `tokenize` and `ast` (docs/design/python-regex.md, section 7) on the files of test/fixtures/python/.
// The reference is found at $BASH_EXPLAINER_PYTHON, or as `python3` when that is the release; without it the comparison is
// skipped, and BASH_EXPLAINER_PYTHON_REQUIRED=1 makes that fail. Python is only run as a separate program, on a script of
// ours that reads the files (test/support/python-reference.py): nothing of the files runs.

const FIXTURES = path.join(__dirname, 'fixtures', 'python');
const files = fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.py')).sort().map((f) => path.join(FIXTURES, f));

type Flat = [string, number, number];

/** The tokens as `tokenize` gives them: an f-string's start, its fields' tokens and its end (its text left out). */
function flat(src: string, tokens: readonly PyToken[]): Flat[] {
  const KIND: Record<string, string> = { name: 'NAME', number: 'NUMBER', op: 'OP', comment: 'COMMENT', newline: 'NEWLINE', error: 'ERRORTOKEN' };
  const out: Flat[] = [];
  const fields = (fs: readonly PyField[]) => {
    for (const f of fs) {
      out.push(['OP', f.start, f.start + 1], ...flat(src, f.tokens));
      if (f.debug !== undefined) out.push(['OP', f.debug, f.debug + 1]);
      if (f.bang !== undefined) out.push(['OP', f.bang, f.bang + 1], ['NAME', f.conversion!.start, f.conversion!.end]);
      if (f.colon !== undefined) out.push(['OP', f.colon, f.colon + 1]);
      fields(f.spec);
      out.push(['OP', f.end - 1, f.end]);
    }
  };
  for (const t of tokens) {
    const lit = t.lit;
    if (!lit) out.push([KIND[t.kind], t.start, t.end]);
    else if (!lit.format) out.push(['STRING', t.start, t.end]);
    else {
      const s = lit.template ? 'TSTRING' : 'FSTRING';
      out.push([`${s}_START`, t.start, lit.contentStart]);
      fields(lit.fields);
      out.push([`${s}_END`, lit.contentEnd, t.end]);
    }
  }
  return out;
}

/** Every string literal of the tokens, those inside fields too, with the token's start. */
function literals(tokens: readonly PyToken[]): [number, PyLiteral][] {
  const out: [number, PyLiteral][] = [];
  const fields = (fs: readonly PyField[]) => fs.forEach((f) => { out.push(...literals(f.tokens)); fields(f.spec); });
  for (const t of tokens) {
    if (!t.lit) continue;
    out.push([t.start, t.lit]);
    fields(t.lit.fields);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

type Value = { s: string } | { b: string } | { f: (string | null)[] } | { error: string };

/** The source of each run of characters of a value that come from one place (an escape, a character, a surrogate pair), and the holes. */
function pieces(src: string, lit: PyLiteral): { text: string; slice: string; hole?: true }[] {
  const v = pyValue(src, lit);
  const out: { text: string; slice: string; hole?: true }[] = [];
  let h = 0;
  for (let i = 0; i <= v.value.length;) {
    for (; h < v.holes.length && v.holes[h].at === i; h++) {
      const hole = v.holes[h];
      if (hole.kind === 'name') out.push({ text: '', slice: src.slice(hole.start, hole.end), hole: true });
    }
    if (i === v.value.length) break;
    let j = i + 1;
    while (j < v.value.length && v.offs[j] === v.offs[i] && v.ends[j] === v.ends[i]) j++;
    // (A character outside the BMP written as is: its two code units.)
    if (j === i + 1 && /[\uD800-\uDBFF]/.test(v.value[i]) && v.offs[i + 1] === v.ends[i]) j++;
    out.push({ text: v.value.slice(i, j), slice: src.slice(v.offs[i], v.ends[j - 1]) });
    i = j;
  }
  return out;
}

/** Our value of a literal in the reference's form, with the characters of its `\N{…}` escapes from `named`. */
function ours(src: string, lit: PyLiteral, named: () => string): Value {
  const v = pyValue(src, lit);
  const parts: (string | null)[] = [''];
  let h = 0;
  for (let i = 0; i <= v.value.length; i++) {
    for (; h < v.holes.length && v.holes[h].at === i; h++) {
      if (v.holes[h].kind === 'name') parts[parts.length - 1] += named();
      else parts.push(null, '');
    }
    if (i < v.value.length) parts[parts.length - 1] += v.value[i];
  }
  if (lit.format) return { f: parts.filter((p) => p !== '') };
  return lit.bytes ? { b: parts.join('') } : { s: parts.join('') };
}

/** The reference's parts with adjacent texts joined and empty ones dropped. */
const joined = (v: Value): Value => {
  if (!('f' in v)) return v;
  const out: (string | null)[] = [];
  for (const p of v.f) {
    if (p !== null && typeof out[out.length - 1] === 'string') out[out.length - 1] += p;
    else out.push(p);
  }
  return { f: out.filter((p) => p !== '') };
};

describe('the Python lexer and the values of literals, against the reference Python', function () {
  this.timeout(60000);
  const ref = pythonReference();
  before(function () {
    needPython(this, ref);
  });

  it('gives the tokens of tokenize, and the value of every literal and of each character', () => {
    const texts = files.map((f) => fs.readFileSync(f, 'utf8'));
    const lexed = texts.map((src) => pyLex(src));
    const asked: [string, string][] = [];
    const ofFile = texts.map((src, n) => literals(lexed[n].tokens).map(([start, lit]) => {
      // (Each piece in a literal of the same prefix; a t-string's is an f-string's, whose value is a str.)
      const prefix = lit.prefix.replace('t', 'f');
      const ps = pieces(src, lit).map((p) => ({ ...p, at: asked.push([prefix, p.slice]) - 1 }));
      return { start, lit, ps };
    }));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-python-'));
    try {
      const request = path.join(dir, 'request.json');
      fs.writeFileSync(request, JSON.stringify({ files, pieces: asked }));
      const r = spawnSync((ref as { python: string }).python, ['-I', path.join(__dirname, 'support', 'python-reference.py'), request], { encoding: 'utf8', timeout: 60000, maxBuffer: 1 << 26 });
      assert.strictEqual(r.status, 0, r.stderr);
      const got = JSON.parse(r.stdout) as { version: string; files: Record<string, { tokens: Flat[]; values: [number, Value][] }>; pieces: Value[] };
      assert.strictEqual(got.version, PYTHON_REFERENCE);
      files.forEach((file, n) => {
        const src = texts[n];
        const want = got.files[file];
        const show = (t: Flat) => `${t[0]} ${JSON.stringify(src.slice(t[1], t[2]))}@${t[1]}`;
        assert.deepStrictEqual(flat(src, lexed[n].tokens).map(show), want.tokens.map(show), path.basename(file));
        assert.deepStrictEqual(ofFile[n].map((l) => l.start), want.values.map((v) => v[0]), path.basename(file));
        ofFile[n].forEach(({ start, lit, ps }, k) => {
          const named = ps.filter((p) => p.hole).map((p) => (got.pieces[p.at] as { s: string }).s);
          const where = `${path.basename(file)}: ${src.slice(start, start + 40)}`;
          assert.deepStrictEqual(ours(src, lit, () => named.shift()!), joined(want.values[k][1]), where);
          for (const p of ps) if (!p.hole) assert.deepStrictEqual(got.pieces[p.at], lit.bytes ? { b: p.text } : { s: p.text }, `${where}: ${JSON.stringify(p.slice)}`);
        });
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the Python lexer', () => {
  const kinds = (src: string) => pyLex(src).tokens.map((t) => `${t.kind} ${src.slice(t.start, t.end)}`);

  it('reads the fixture files with no error token, each literal with a value (the comparison above, without Python)', () => {
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      const { tokens } = pyLex(src);
      assert.deepStrictEqual(tokens.filter((t) => t.kind === 'error').map((t) => src.slice(t.start, t.end)), [], f);
      for (const [, lit] of literals(tokens)) assert.ok(pieces(src, lit).length || lit.contentEnd === lit.contentStart || lit.fields.length, f);
    }
  });

  it('follows the release that CI installs', () => {
    const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'test.yml'), 'utf8');
    assert.deepStrictEqual(workflow.split('\n').filter((l) => l.includes('python-version:')).map((l) => l.trim()), [`python-version: '${PYTHON_REFERENCE}'`]);
  });

  it('ends a file without a newline with a newline token, and reads what is no Python as errors', () => {
    assert.deepStrictEqual(kinds('x = 1'), ['name x', 'op =', 'number 1', 'newline ']);
    assert.deepStrictEqual(kinds('a $ ?'), ['name a', 'error $', 'error ?', 'newline ']);
    assert.deepStrictEqual(kinds('a. # c'), ['name a', 'op .', 'comment # c', 'newline ']);
    assert.deepStrictEqual(kinds('f"a}b"'), ['string f"a}b"', 'newline ']);
    // (A newline in brackets, or after a comment alone, ends no statement.)
    assert.deepStrictEqual(kinds('(\n)\n# c\n'), ['op (', 'op )', 'newline \n', 'comment # c']);
  });

  it('reads a literal that does not end as one error token, to the end of its line or, triple-quoted, of the file', () => {
    assert.deepStrictEqual(kinds('a = "x\nb'), ['name a', 'op =', 'error "x', 'newline \n', 'name b', 'newline ']);
    assert.deepStrictEqual(kinds("a = '''x\nb"), ['name a', 'op =', "error '''x\nb", 'newline ']);
    assert.deepStrictEqual(kinds('"a\\\nb"'), ['string "a\\\nb"', 'newline ']);
    // An f-string whose field does not end; a field ends at a newline in a literal in single quotes, in brackets too.
    for (const src of ['f"{x"', 'f"{x', 'f"{x!}"', 'f"{x!r"', 'f"{x:', 'f"{x:"', 'f"{\nx}"', 'f"{(\nx)}"', 'f"{x:\n}"']) assert.strictEqual(pyLex(src).tokens[0].kind, 'error', src);
    assert.deepStrictEqual(kinds('f"""{(\nx)}"""'), ['string f"""{(\nx)}"""', 'newline ']);
  });

  it('pairs brackets of the same kind, and leaves one without a partner unpaired', () => {
    // f ( a [ 1 ] , ( b ) ) ) newline
    assert.deepStrictEqual(pyLex('f(a[1], (b)) )').pair, [-1, 10, -1, 5, -1, 3, -1, 9, -1, 7, 1, -1, -1]);
    // ( ] ) newline: the `]` closes nothing, and the `)` the `(`.
    assert.deepStrictEqual(pyLex('(])').pair, [2, -1, 0, -1]);
  });

  it("keeps to Python's limits of nesting, as error tokens", () => {
    // (200 brackets are allowed, the 201st is "too many nested parentheses"; a field's `{` counts.)
    const parens = (n: number) => pyLex(`x = ${'('.repeat(n)}1${')'.repeat(n)}`).tokens.filter((t) => t.kind === 'error').length;
    assert.deepStrictEqual([parens(200), parens(201)], [0, 1]);
    assert.ok(pyLex(`x = ${'('.repeat(150)}f"{${'('.repeat(60)}`).tokens.some((t) => t.kind === 'error'));
    // (149 nested f-strings are allowed, the 150th is "too many nested f-strings or t-strings", at any depth without overflow.)
    const nested = (n: number) => pyLex(`${'f"{'.repeat(n)}x${'}"'.repeat(n)}`).tokens[0].kind;
    assert.deepStrictEqual([nested(149), nested(150), nested(1500)], ['string', 'error', 'error']);
    assert.strictEqual(extractShell('python', `import os\nos.system(${'f"{'.repeat(1500)}x${'}"'.repeat(1500)})\n`).regions.length, 0);
  });

  it('reads a file of literals that do not end in time linear in its lines', function () {
    this.timeout(60000);
    // (Each line's literal was read inside the one before, and again after that failed: 2^n, and 20 lines took half a second.)
    const time = (unit: string, n: number) => Math.min(...[0, 1, 2].map(() => {
      const start = performance.now();
      extractShell('python', `import os\n${unit.repeat(n)}os.system("ls")\n`);
      return performance.now() - start;
    }));
    const unit = time('x = f"{a}"\n', 2000);
    for (const broken of ['x = f"{(\n', 'x = f"""{(\n', 'x = f"{(f"""\n', 'x = f"{(rf"\\N{\n']) {
      const ms = time(broken, 2000);
      assert.ok(ms <= 20 * unit + 50, `${JSON.stringify(broken)}: ${Math.round(ms)} ms for 2000 lines, ${Math.round(unit)} ms for as many that end`);
    }
  });

  it('finds the names, operators and imports of a file', () => {
    const src = 'import a.b, c as d\nfrom e import (f as g, h)\nfrom . import i\nimport\nimport j as\nfrom k import\nfrom l\nx = 1; import m\n';
    const { tokens } = pyLex(src);
    assert.ok(isOp(src, tokens[2], '.') && isName(src, tokens[1], 'a') && !isName(src, tokens[1], 'ab') && !isOp(src, tokens[1], '.'));
    const imports = pyImports(src, tokens);
    assert.deepStrictEqual([...imports], [['a', 'a'], ['d', 'c'], ['g', 'e.f'], ['h', 'e.h'], ['m', 'm']]);
    assert.strictEqual(pyResolve(imports, 'd.run'), 'c.run');
    assert.strictEqual(pyResolve(imports, 'g'), 'e.f');
    assert.strictEqual(pyResolve(imports, 'a.b.c'), 'a.b.c');
    assert.strictEqual(pyResolve(imports, 'z.run'), undefined);
  });
});

describe('the values of Python literals', () => {
  /** The value of the first literal of `src`, with the source of each character. */
  const val = (src: string) => {
    const v = pyValue(src, pyLex(src).tokens[0].lit!);
    return { value: v.value, from: v.value.split('').map((_, i) => src.slice(v.offs[i], v.ends[i])), holes: v.holes.map((h) => `${h.kind}@${h.at}:${src.slice(h.start, h.end)}`) };
  };

  it('undoes every escape, and keeps a backslash that is none', () => {
    assert.deepStrictEqual(val('"\\a\\012\\0\\x41\\z"').value, '\x07\n\0Az'.replace('z', '\\z'));
    assert.deepStrictEqual(val('"\\012"').from, ['\\012']);
    assert.deepStrictEqual(val('b"\\777\\u0041"').value, '\xff\\u0041');
    assert.deepStrictEqual(val('"\\x4"').value, '\\x4');
    assert.deepStrictEqual(val('"\\U00110000"').value, '\\U00110000');
    assert.deepStrictEqual(val('"\\N{BULLET}x\\N{}"'), { value: 'x\\N{}', from: ['x', '\\', 'N', '{', '}'], holes: ['name@0:\\N{BULLET}'] });
    assert.deepStrictEqual(val('"a\\\nb"').from, ['a', 'b']);
    assert.deepStrictEqual(val('r"a\\nb"').value, 'a\\nb');
    assert.deepStrictEqual(escapeAt('\\N{x\n}', 0, false), undefined);
    // (The name ends on its line: a `\N{` with no `}` there looks no further.)
    assert.deepStrictEqual(escapeAt('\\N{x\n'.repeat(3) + '}', 0, false), undefined);
    assert.deepStrictEqual(escapeAt('\\N{x', 0, false), undefined);
    // (A backslash that starts no escape is kept, and Python warns; one that starts an incomplete escape, Python refuses.)
    assert.deepStrictEqual(['\\d', '\\{', '\\8', '\\N'].map((s) => escapeAt(s, 0, s === '\\N')), Array(4).fill({ end: 1, kept: true }));
    assert.deepStrictEqual(['\\x4', '\\u12', '\\U0011ffff', '\\N', '\\N{}'].map((s) => escapeAt(s, 0, false)), Array(5).fill(undefined));
    assert.deepStrictEqual(escapeAt('\\u12', 0, true), { end: 1, kept: true });
    const kinds = (src: string) => pyValue(src, pyLex(src).tokens[0].lit!).kinds;
    assert.deepStrictEqual([kinds('"\\d\\x4\\n"'), kinds('r"\\d"'), kinds('f"\\{x}"')], [['kept', 'text', 'text', 'text', 'text', 'escape'], ['text', 'text'], ['kept']]);
  });

  it('reads the fields of an f-string as holes, with the text of a self-documenting one', () => {
    assert.deepStrictEqual(val('f"a{x}b{{c}}{y = !r}"'), {
      value: 'ab{c}y = ', from: ['a', 'b', '{{', 'c', '}}', 'y', ' ', '=', ' '],
      holes: ['field@1:{x}', 'field@9:{y = !r}'],
    });
    assert.deepStrictEqual(val('f"{x=:>3}"').holes, ['field@2:{x=:>3}']);
  });
});
