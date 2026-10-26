// The allow-list of the trust (src/semantics/allow.ts; docs/design/trust-allow-list.md, section 5): every set of
// constructs is complete against bash and its manual, every `followed` row names what checks it, and the rows agree
// with the specs. The scan reads the table: tests/trust.test.ts checks what it trusts against bash.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { builtins } from '../src/dict/builtins';
import { SHELL_OPTIONS_SINCE } from '../src/bashversion';
import {
  BUILTINS, builtinRow, EXPANSION_OPERATORS, expansionOperator, expansionRow, optionRow, REDIRECTIONS, redirectionRow, type Row,
  SET_OPTIONS, SHOPT_OPTIONS, SYNTAX, syntaxRow, UNLISTED,
} from '../src/semantics/allow';
import { shellState } from '../src/semantics/state';
import { BASH_VARIABLES } from '../src/semantics/vars';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants } from '../src/syntax/tree';
import { runBash } from './support/bash';
import { forModel, scripts } from './support/decisions';
import { PROBE_KINDS, type ProbeKind, readProbeTable } from './support/probe';

const parser = createUnbashParser();
const hasBash = runBash('true').status === 0;
const BASH53 = process.env.BASH_EXPLAINER_BASH53;
/** The bashes to compare with: bash 5.2 on PATH, and bash 5.3 when `$BASH_EXPLAINER_BASH53` names one. */
const programs = [...(hasBash ? [{ name: 'bash 5.2', program: 'bash', v53: false }] : []), ...(BASH53 ? [{ name: 'bash 5.3', program: BASH53, v53: true }] : [])];
const lines = (script: string, program: string): string[] => runBash(script, { program }).stdout.trim().split('\n');
const sorted = (xs: Iterable<string>): string[] => [...xs].sort();

/** Every row of the tables, with where it is. */
function allRows(): { where: string; row: Row }[] {
  const out: { where: string; row: Row }[] = [];
  const add = (table: string, rows: Readonly<Record<string, Row>>): void => {
    for (const [k, row] of Object.entries(rows)) out.push({ where: `${table} ${k}`, row });
  };
  add('syntax', SYNTAX);
  add('builtin', BUILTINS);
  for (const [k, row] of Object.entries(BUILTINS)) out.push({ where: `builtin ${k}, unknown option`, row: row.unknownOption });
  add('set', SET_OPTIONS);
  add('shopt', SHOPT_OPTIONS);
  for (const [table, rows] of [['set', SET_OPTIONS], ['shopt', SHOPT_OPTIONS]] as const) {
    for (const [k, row] of Object.entries(rows)) if (row.off) out.push({ where: `${table} ${k}, off`, row: row.off });
  }
  add('expansion', EXPANSION_OPERATORS);
  add('redirection', REDIRECTIONS);
  for (const [k, v] of Object.entries(BASH_VARIABLES)) out.push({ where: `variable ${k}`, row: v.effect });
  return out;
}

describe('the allow-list of the trust (src/semantics/allow.ts)', () => {
  for (const { name, program, v53 } of programs) {
    it(`has a row for every builtin, and every option of set -o and shopt, of ${name}, and none it lacks`, () => {
      assert.deepStrictEqual(sorted(lines('compgen -b', program)), sorted(Object.keys(BUILTINS)));
      assert.deepStrictEqual(sorted(lines('set -o', program).map((l) => l.split(/\s+/)[0])), sorted(Object.keys(SET_OPTIONS)));
      // (The rows of bash 5.3's shopt options are there for 5.3 only.)
      const shopt = Object.keys(SHOPT_OPTIONS).filter((o) => v53 || !Object.hasOwn(SHELL_OPTIONS_SINCE, o));
      assert.deepStrictEqual(sorted(lines('shopt', program).map((l) => l.split(/\s+/)[0])), sorted(shopt));
    });
  }

  it('has a row for every operator of parameter expansion in the manual (3.5.3), and for those bash takes beyond it', function () {
    const doc = '/usr/share/doc/bash/bashref.html';
    if (!fs.existsSync(doc)) this.skip();
    const html = fs.readFileSync(doc, 'utf8');
    const start = html.indexOf('id="Shell-Parameter-Expansion"');
    const section = html.slice(start, html.indexOf('<hr>', start + 10));
    const terms = [...section.matchAll(/<dt[^>]*>(.*?)<\/dt>/gs)].map((m) => m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/−|&minus;/g, '-').trim());
    // (The letters of `${parameter@operator}` are the terms after it.)
    const transform = terms.indexOf('${parameter@operator}');
    const letters = terms.slice(transform + 1).filter((t) => /^[A-Za-z]$/.test(t));
    assert.ok(letters.length >= 10 && terms.length > 30, 'the section reads as expected');
    const forms = [...terms.slice(0, transform), ...letters.map((l) => `\${parameter@${l}}`)]
      // The forms the prose gives: `${parameter}`, a test for unset only (no colon), and an indirection.
      .concat(['${parameter}', '${parameter-word}', '${parameter=word}', '${parameter?word}', '${parameter+word}', '${!parameter}'])
      .map((f) => f.replace(/parameter|prefix|name/, 'x').replace(/offset|length/g, '1').replace(/word|pattern|string/g, 'w'));
    // bash also takes `~` and `~~`, which toggle the case (not in the manual).
    forms.push('${x~}', '${x~~}');
    assert.strictEqual(runBash('x=aB; echo "${x~} ${x~~}"').stdout, 'AB Ab\n');
    const ops = new Set<string>();
    for (const f of forms) {
      const e = descendants(parser.parse(`echo ${f}`).root, ['expansion'])[0];
      assert.ok(e, f);
      ops.add(expansionOperator(e));
    }
    assert.deepStrictEqual(sorted(ops), sorted(Object.keys(EXPANSION_OPERATORS)));
  });

  it('has a row for every redirection operator of the manual (3.6)', () => {
    // 3.6.1 to 3.6.10, each with the operators its forms use.
    const forms = ['<f', '>f', '>|f', '>>f', '&>f', '>&f', '&>>f', '<<E\nE', '<<-E\nE', '<<< w', '<&0', '>&1', '<&3-', '<>f', '3>&-'];
    const ops = new Set<string>();
    for (const f of forms) for (const r of descendants(parser.parse(`c ${f}`).root, ['file_redirect', 'heredoc_redirect', 'herestring_redirect'])) ops.add(r.children.find((c) => !c.named)!.type);
    assert.deepStrictEqual(sorted(ops), sorted(Object.keys(REDIRECTIONS)));
  });

  it('gives every bash variable and every node type a row, and says what a construct with no row does', () => {
    for (const [name, v] of Object.entries(BASH_VARIABLES)) assert.ok(v.effect, name);
    // (`SYNTAX` is a `Record` of every `NodeType`.)
    assert.ok(Object.keys(SYNTAX).length > 60);
    // Today a construct with no row changes nothing; when the default flips, it trusts nothing.
    assert.deepStrictEqual(UNLISTED.effect, { kind: 'none' });
    assert.strictEqual(UNLISTED.next?.kind, 'all');
    assert.strictEqual(syntaxRow('no_such_node'), UNLISTED);
    // (zsh's `setopt` is in the dictionary, but no builtin of bash.)
    assert.ok(builtins.setopt);
    assert.strictEqual(builtinRow('setopt').effect, UNLISTED.effect);
    assert.strictEqual(optionRow(SHOPT_OPTIONS, 'no_such_option', true), UNLISTED);
    // An option's row turned off: its own `off`, or the row itself.
    assert.strictEqual(optionRow(SHOPT_OPTIONS, 'extquote', false).next?.kind, 'all');
    assert.strictEqual(optionRow(SET_OPTIONS, 'errexit', false), SET_OPTIONS.errexit);
    // `${x@}` and `${x@Z}`, which bash rejects ("bad substitution"), have no row.
    for (const e of ['${x@}', '${x@Z}']) {
      const n = descendants(parser.parse(`: ${e}`).root, ['expansion'])[0];
      assert.strictEqual(expansionRow(n), UNLISTED, e);
    }
    assert.strictEqual(redirectionRow(descendants(parser.parse('c >f').root, ['file_redirect'])[0]), REDIRECTIONS['>']);
  });

  it('names what checks each row the walk follows, and each of those is there', () => {
    const snippets = new Map<ProbeKind | 'generator', string[]>(PROBE_KINDS.map((k) => [k, readProbeTable(k).map((r) => r.snippet)]));
    snippets.set('generator', scripts(1, 120).map((s) => forModel(s.text).src));
    const missing: string[] = [];
    for (const { where, row } of allRows()) {
      if (row.effect.kind === 'followed' && !row.tests?.length) missing.push(`${where}: followed, with no tests`);
      for (const t of row.tests ?? []) {
        const [, kind, text] = /^([\w/.-]+): (.*)$/s.exec(t)!;
        const found = kind.startsWith('test/') ? fs.readFileSync(path.join(__dirname, '..', kind), 'utf8').includes(text) : (snippets.get(kind as ProbeKind) ?? []).some((s) => s.includes(text));
        if (!found) missing.push(`${where}: ${t}`);
      }
    }
    assert.deepStrictEqual(missing, []);
  });

  it('agrees with the specs: a file run unread trusts nothing, and a command run in this shell is followed (or will trust nothing)', () => {
    for (const [name, row] of Object.entries(BUILTINS)) {
      const spec = builtins[name];
      if (spec.shellEffect?.runsUnread) assert.deepStrictEqual(row.effect, { kind: 'all', why: 'a file is sourced' }, name);
      const slots = (spec.operands ?? []).flatMap((alt) => alt.pattern).filter((o) => o.command?.run === 'current-shell');
      if (slots.length) assert.ok(row.effect.kind === 'followed' || row.next?.kind === 'all', name);
    }
    assert.deepStrictEqual(Object.keys(BUILTINS).filter((n) => (builtins[n].operands ?? []).some((alt) => alt.pattern.some((o) => o.command?.run === 'current-shell'))).sort(),
      ['builtin', 'command', 'eval', 'jobs', 'trap']);
  });

  it('is what the scan reads: a row of `all` trusts nothing, and `none` reads no further', () => {
    // (compgen's row for an option its spec does not know, as before the table.)
    assert.strictEqual(shellState(parser.parse('compgen -Z x')).blind, '`compgen` expands a word list or runs a command the model does not read');
    // (`shopt` reads each option by its row: none today trusts nothing.)
    for (const src of ['shopt -s compat31 nosuch "$x"; shopt -u extquote; shopt -p nullglob; shopt -so errexit', 'setopt x']) assert.strictEqual(shellState(parser.parse(src)).blind, undefined, src);
  });
});
