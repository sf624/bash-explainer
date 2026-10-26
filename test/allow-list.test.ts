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
  PROGRAM, SET_OPTIONS, SHOPT_OPTIONS, SYNTAX, syntaxRow,
} from '../src/semantics/allow';
import { shellState } from '../src/semantics/state';
import { childOpening, localeWritten, openingBlinds } from '../src/semantics/opening';
import { scriptTrust } from '../src/semantics/trust';
import type { WrittenValue } from '../src/semantics/written';
import { BASH_VARIABLES } from '../src/semantics/vars';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, fields, type SyntaxNode } from '../src/syntax/tree';
import { interpret } from '../src/argv/interpret';
import { argWord } from '../src/argv/words';
import { lookupCommand } from '../src/dict/aliases';
import { commandName } from '../src/semantics/effects';
import { slotEnvs } from '../src/semantics/env';
import { runBash } from './support/bash';
import { forModel, GENERATED, scripts } from './support/decisions';
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
    // A construct with no row trusts nothing, and says which construct it is.
    assert.deepStrictEqual(syntaxRow('no_such_node').effect, { kind: 'all', why: 'the node type `no_such_node`, which the allow-list does not have' });
    assert.deepStrictEqual(optionRow(SHOPT_OPTIONS, 'no_such_option', true).effect, { kind: 'all', why: '`shopt -s no_such_option`, which the allow-list does not have' });
    assert.deepStrictEqual(optionRow(SET_OPTIONS, 'no_such_option', false).effect, { kind: 'all', why: '`set +o no_such_option`, which the allow-list does not have' });
    // (zsh's `setopt` is in the dictionary, but no builtin of bash: bash runs a program of that name, or finds none.)
    assert.ok(builtins.setopt);
    assert.strictEqual(builtinRow('setopt'), PROGRAM);
    assert.deepStrictEqual(PROGRAM.effect, { kind: 'none' });
    // An option's row turned off: its own `off`, or the row itself.
    assert.strictEqual(optionRow(SHOPT_OPTIONS, 'extquote', false).effect.kind, 'all');
    assert.strictEqual(optionRow(SET_OPTIONS, 'errexit', false), SET_OPTIONS.errexit);
    // `${x@}` and `${x@Z}`, which bash rejects ("bad substitution"), have no row.
    for (const e of ['${x@}', '${x@Z}']) {
      const n = descendants(parser.parse(`: ${e}`).root, ['expansion'])[0];
      assert.deepStrictEqual(expansionRow(n).effect, { kind: 'all', why: `the parameter expansion \`${e}\`, which the allow-list does not have` }, e);
    }
    // (A long one is named by its operator.)
    const long = descendants(parser.parse(`: \${x${'y'.repeat(40)}@Z}`).root, ['expansion'])[0];
    assert.deepStrictEqual(expansionRow(long).effect, { kind: 'all', why: 'the operator `@Z` of a parameter expansion, which the allow-list does not have' });
    // Every builtin's option its spec does not know trusts nothing, but those of the builtins that print or ignore it,
    // and of `test` and `[`, whose words are the expression's (`[ -a file ]`).
    for (const [name, row] of Object.entries(BUILTINS)) assert.strictEqual(row.unknownOption.effect.kind, [':', 'true', 'false', 'echo', 'printf', 'test', '['].includes(name) ? 'none' : 'all', name);
    assert.strictEqual(redirectionRow(descendants(parser.parse('c >f').root, ['file_redirect'])[0]), REDIRECTIONS['>']);
  });

  it('names what checks each row the walk follows, and each of those is there', () => {
    const problems: string[] = [];
    // The ids of the probe rows: unique in their table.
    const ids = new Map<ProbeKind, Map<string, number>>();
    for (const kind of PROBE_KINDS) {
      const counts = new Map<string, number>();
      for (const r of readProbeTable(kind)) if (r.id !== undefined) counts.set(r.id, (counts.get(r.id) ?? 0) + 1);
      for (const [id, n] of counts) if (n > 1) problems.push(`${kind}#${id}: ${n} rows have this id`);
      ids.set(kind, counts);
    }
    const files = new Map<string, string>();
    const titled = (file: string, title: string): boolean => {
      if (!files.has(file)) files.set(file, fs.existsSync(path.join(__dirname, '..', file)) ? fs.readFileSync(path.join(__dirname, '..', file), 'utf8') : '');
      return ['\'', '"', '`'].some((q) => !title.includes(q) && files.get(file)!.includes(`it(${q}${title}${q}`));
    };
    for (const { where, row } of allRows()) {
      if (row.effect.kind === 'followed' && !row.tests?.length) problems.push(`${where}: followed, with no tests`);
      for (const t of row.tests ?? []) {
        let m: RegExpExecArray | null;
        if ((m = /^(\w+)#([\w-]+)$/.exec(t))) {
          if (!PROBE_KINDS.includes(m[1] as ProbeKind) || ids.get(m[1] as ProbeKind)!.get(m[2]) !== 1) problems.push(`${where}: ${t} names no one row`);
        } else if ((m = /^(test\/[\w.-]+\.test\.ts): (.+)$/s.exec(t))) {
          if (!titled(m[1], m[2])) problems.push(`${where}: ${t} is no title of an it()`);
        } else if ((m = /^generator: (.+)$/s.exec(t))) {
          if (!Object.hasOwn(GENERATED, m[1])) problems.push(`${where}: ${t} is no key of GENERATED`);
        } else problems.push(`${where}: ${t} is in no format`);
      }
    }
    assert.deepStrictEqual(problems, []);
  });

  it('has a script the generator writes for each of its constructs a row names', () => {
    const sources = scripts(1, 120).map((s) => forModel(s.text).src);
    const unseen = Object.entries(GENERATED).filter(([, re]) => !sources.some((s) => re.test(s))).map(([name]) => name);
    assert.deepStrictEqual(unseen, []);
  });

  it('agrees with the specs: a file run unread trusts nothing, and a command run in this shell is followed, or trusts nothing', () => {
    const inShell: string[] = [];
    for (const [name, row] of Object.entries(BUILTINS)) {
      const spec = builtins[name];
      if (spec.shellEffect?.runsUnread) assert.deepStrictEqual(row.effect, { kind: 'all', why: 'a file is sourced' }, name);
      // A slot of the operands (under an option, `jobs -x cmd`: that option's row), or of an option's value (`mapfile -C`).
      for (const alt of spec.operands ?? []) {
        if (!alt.pattern.some((o) => o.command?.run === 'current-shell')) continue;
        inShell.push(name);
        const when = alt.when && 'option' in alt.when ? alt.when.option : [];
        assert.ok(row.effect.kind === 'followed' || row.effect.kind === 'all' || (when.length && when.every((o) => row.options?.[o]?.effect.kind === 'all')), name);
      }
      for (const o of spec.options ?? []) {
        const values = [o.value ?? []].flat();
        if (!values.some((v) => v.command?.run === 'current-shell')) continue;
        inShell.push(`${name} ${o.names[0]}`);
        assert.strictEqual(row.options?.[o.names[0]]?.effect.kind, 'all', `${name} ${o.names[0]}`);
      }
    }
    assert.deepStrictEqual(inShell.sort(), ['builtin', 'command', 'eval', 'jobs', 'mapfile -C', 'readarray -C', 'trap']);
  });

  // Every option or operand of a builtin that runs code later or elsewhere is typed as bash runs it: a function
  // (`type: 'function'`), or code with a command slot that says where it runs; and bash runs it so.
  it('types every callback of a builtin as bash runs it: a function, or code in this shell or a subshell', function () {
    if (!hasBash) this.skip();
    const typed = new Map<string, string>();
    for (const [name, spec] of Object.entries(builtins)) {
      if (!Object.hasOwn(BUILTINS, name)) continue;
      for (const o of spec.options ?? []) {
        for (const v of [o.value ?? []].flat()) {
          if (v.type === 'function') typed.set(`${name} ${o.names[0]}`, 'function');
          else if (v.command) typed.set(`${name} ${o.names[0]}`, `code: ${v.command.run}${v.command.later ? ', later' : ''}`);
        }
      }
      for (const alt of spec.operands ?? []) {
        for (const op of alt.pattern) {
          if (op.type === 'function') typed.set(`${name} ${op.name}`, 'function');
          else if (op.command) typed.set(`${name} ${op.name}`, `code: ${op.command.run}${op.command.later ? ', later' : ''}`);
        }
      }
    }
    const want: Record<string, string> = {
      // In this shell, now: `mapfile -C` reads its text with the index and the line after it, as `eval` does.
      'mapfile -C': 'code: current-shell', 'readarray -C': 'code: current-shell', 'compgen -F': 'function',
      // In a subshell, as `$( )`; `complete`'s run when a command is completed, which a script never does.
      'compgen -C': 'code: subshell', 'complete -C': 'code: subshell', 'complete -F': 'function',
    };
    for (const [k, v] of Object.entries(want)) assert.strictEqual(typed.get(k), v, k);
    // (The command slots of the operands: `eval`, `trap`'s action (later), `command`, `builtin`, `jobs -x`, and the
    // program `exec` runs in place of the shell.)
    assert.deepStrictEqual([...typed].filter(([k]) => !Object.hasOwn(want, k)).map(([k, v]) => `${k}: ${v}`).sort(),
      ['builtin COMMAND: code: current-shell', 'command COMMAND: code: current-shell', 'eval STRING: code: current-shell', 'exec COMMAND: code: exec', 'jobs COMMAND: code: current-shell',
        'trap ACTION: code: current-shell, later']);
    // What bash runs where: `x` is set by what runs in this shell only.
    const ran = (src: string): string => runBash(`x=1; f() { x=2; COMPREPLY=(a); }; ${src} >/dev/null 2>&1; echo $x`).stdout.trim();
    for (const src of ["mapfile -C 'x=2; :' -c 1 a <<< q", "readarray -C 'x=2; :' -c 1 a <<< q", 'compgen -F f w', 'jobs -x eval x=2', "trap 'x=2' USR1; kill -USR1 $$"]) assert.strictEqual(ran(src), '2', src);
    for (const src of ["compgen -C 'x=2' w", "complete -C 'x=2' c; complete -F f d", "bind -x '\"\\C-a\":x=2'"]) assert.strictEqual(ran(src), '1', src);
    // `bind -x` binds a key to a command (its value is `"keys":command`, text), and the prompts and PROMPT_COMMAND
    // are read by an interactive shell only: a script runs none of them (their effect is none).
    assert.strictEqual(ran("PROMPT_COMMAND='x=2'; PS0='$((x=3))'; PS1='$((x=4))'; PS2='$((x=5))'; true"), '1');
    for (const v of ['PROMPT_COMMAND', 'PS0', 'PS1', 'PS2']) assert.strictEqual(BASH_VARIABLES[v].effect.effect.kind, 'none', v);
    assert.strictEqual(typed.get('bind -x'), undefined);
  });

  it('is what the scan reads: a row of `all` trusts nothing, and `none` reads no further', () => {
    const blind = (src: string): string | undefined => shellState(parser.parse(src)).blind;
    // (compgen's row for an option its spec does not know.)
    assert.strictEqual(blind('compgen -Z x'), '`compgen` expands a word list or runs a command the model does not read');
    assert.strictEqual(blind('read -Q x'), '`read` is given an option its spec does not know');
    for (const src of ['shopt -p nullglob; shopt -so errexit; shopt -s nullglob dotglob; echo -Q', 'setopt x']) assert.strictEqual(blind(src), undefined, src);
    // Options and operators the table does not have, and option names not known.
    assert.strictEqual(blind('shopt -s nosuch'), '`shopt -s nosuch`, which the allow-list does not have');
    assert.strictEqual(blind('set -o nosuch'), '`set -o nosuch`, which the allow-list does not have');
    assert.strictEqual(blind(': "${x@Z}"'), 'the parameter expansion `${x@Z}`, which the allow-list does not have');
    assert.strictEqual(blind('shopt -s "$x"'), '`shopt` is given an option name not known');
    assert.strictEqual(blind('set -o "$x"'), '`set -o` is given an option name not known');
    assert.strictEqual(blind('set $x'), '`set` is given a word not known before its operands, which may be any option');
    assert.strictEqual(blind('shopt -u extquote'), '`shopt -u extquote` changes what bash does in ways the walk does not follow');
  });

  it('reads what a shell starts with by the table: the shebang, and the options and variables another shell gets', function () {
    const blind = (src: string): string | undefined => shellState(parser.parse(src)).blind;
    const regex = 'x=abc; if [[ $x =~ "a.c" ]]; then y=yes; else y=no; fi; echo "$y"';
    // The shebang's options and assignments, as if set on the first line.
    assert.strictEqual(blind('#!/bin/bash -k\nf() { y=$x; }; x=1; f x=2; echo "$y"'), '`set -k` (keyword) makes every assignment word one for its command');
    assert.strictEqual(blind(`#!/usr/bin/env -S bash -O compat31\n${regex}`), '`shopt -s compat31` changes what bash does in ways the walk does not follow');
    assert.strictEqual(blind(`#!/usr/bin/env -S BASH_COMPAT=42 bash\n${regex}`), '`BASH_COMPAT` changes how bash reads the script');
    assert.strictEqual(blind(`#!/usr/bin/env -S LC_ALL=C bash -O extglob -eu\n${regex}`), undefined);
    // (POSIX mode is walked from the start; `-O` turns the option on there.)
    assert.strictEqual(blind(`#!/usr/bin/env -S POSIXLY_CORRECT=1 bash\n${regex}`), undefined);
    const started = parser.parse('#!/usr/bin/env -S bash -O extglob\n: END');
    assert.strictEqual(shellState(started).at(descendants(started.root, ['command'])[0]).run.shopt.get('extglob'), 'on');
    // Another shell (`bash -c`): its options and the variables given to it. Its model decides nothing then.
    const inner = (src: string): { blind: string | undefined; decided: boolean } => {
      const tree = parser.parse(src);
      const model = shellState(tree);
      const c = descendants(tree.root, ['command'])[0];
      const args = fields(c, 'argument');
      const name = commandName(c)!;
      const spec = lookupCommand(name)!;
      const envs = slotEnvs(model.env(c), interpret(spec, args.map(argWord), { name, lookup: lookupCommand }), spec, args, lookupCommand);
      const string = args[args.findIndex((a) => a.text === '-c') + 1];
      const script = model.script([string], envs.get(string)!);
      assert.ok(!('why' in script), src);
      return { blind: script.model.blind, decided: !!script.model.condition(descendants(script.tree.root, ['if_statement'])[0]) };
    };
    assert.deepStrictEqual(inner(`bash -c '${regex}'`), { blind: undefined, decided: true });
    assert.deepStrictEqual(inner(`LC_ALL=C bash -c '${regex}'`), { blind: undefined, decided: true });
    assert.deepStrictEqual(inner(`env LC_ALL=C bash -o posix -c '${regex}'`), { blind: undefined, decided: true });
    assert.deepStrictEqual(inner(`BASH_COMPAT=31 bash -c '${regex}'`), { blind: '`BASH_COMPAT` changes how bash reads the script', decided: false });
    assert.deepStrictEqual(inner(`env BASH_COMPAT=31 bash -c '${regex}'`), { blind: '`BASH_COMPAT` changes how bash reads the script', decided: false });
    assert.deepStrictEqual(inner(`bash -O compat31 -c '${regex}'`), { blind: '`shopt -s compat31` changes what bash does in ways the walk does not follow', decided: false });
    assert.deepStrictEqual(inner(`LC_ALL=de_DE.UTF-8 bash -c '${regex}'`), { blind: '`LC_ALL` may be set to a locale other than C', decided: false });
    assert.deepStrictEqual(inner("bash -k -c 'f() { y=$x; }; x=1; f x=2; echo \"$y\"'"), { blind: '`set -k` (keyword) makes every assignment word one for its command', decided: false });
    // (A prefix assignment of a program is for its environment: this shell keeps its trust.)
    assert.strictEqual(blind(`BASH_COMPAT=31 bash -c '${regex}'; LANG=de_DE.UTF-8 sort /dev/null`), undefined);
    if (!hasBash) this.skip();
    // What bash does: each of them takes `then`, where the model without them decides "always false".
    assert.strictEqual(runBash(`BASH_COMPAT=31 bash -c '${regex}'; bash -O compat31 -c '${regex}'`).stdout, 'yes\nyes\n');
    const shebang = (line: string, body: string): string => runBash(`printf '%s\\n' '${line}' '${body.replace(/'/g, "'\\''")}' > s; chmod +x s; ./s`, { files: [] }).stdout;
    assert.strictEqual(shebang('#!/bin/bash -k', 'f() { y=$x; }; x=1; f x=2; echo "$y"'), '2\n');
    assert.strictEqual(shebang('#!/usr/bin/env -S bash -O compat31', regex), 'yes\n');
  });

  // The review of step 4, each checked with bash 5.2 below.
  it('reads every option and start variable of a shell, writes through namerefs, and empty command names', function () {
    const regex = 'x=abc; if [[ $x =~ "a.c" ]]; then y=yes; else y=no; fi; echo "$y"';
    const keyword = 'f() { y=$x; }; x=1; f x=2; echo "$y"';
    const model = (src: string): { blind: string | undefined; decided: boolean } => {
      const tree = parser.parse(src);
      const m = shellState(tree);
      return { blind: m.blind, decided: descendants(tree.root, ['if_statement']).some((n) => m.condition(n)) };
    };
    const inner = (src: string): string | undefined => {
      const tree = parser.parse(src);
      const m = shellState(tree);
      const c = descendants(tree.root, ['command']).find((x) => fields(x, 'argument').some((a) => a.text === '-c'))!;
      const args = fields(c, 'argument');
      const name = commandName(c)!;
      const spec = lookupCommand(name)!;
      const envs = slotEnvs(m.env(c), interpret(spec, args.map(argWord), { name, lookup: lookupCommand }), spec, args, lookupCommand);
      const string = args[args.findIndex((a) => a.text === '-c') + 1];
      const script = m.script([string], envs.get(string)!);
      assert.ok(!('why' in script), src);
      return script.model.blind;
    };
    const unlisted = (what: string): string => `the shell is started with \`${what}\`, which the allow-list does not have`;
    // An empty command name, unquoted: the next word is the command (`eval`, `source`, `set -k`…).
    for (const src of ['x=1; cmd=; $cmd eval x=2', 'x=1; declare cmd=; $cmd eval x=2', 'x=1; cmd=; ${cmd} eval x=2', "x=1; cmd=''; $cmd eval x=2", 'cmd=; $cmd set -k']) assert.strictEqual(model(src).blind, 'a command name not known', src);
    assert.strictEqual(model('x=1; cmd=; "$cmd" eval x=2').blind, undefined);
    // SHELLOPTS and BASHOPTS turn on the options they list when bash starts; POSIX_PEDANTIC, POSIX mode.
    assert.strictEqual(model(`#!/usr/bin/env -S BASHOPTS=compat31 bash\n${regex}`).blind, '`shopt -s compat31` changes what bash does in ways the walk does not follow');
    assert.strictEqual(model(`#!/usr/bin/env -S SHELLOPTS=keyword bash\n${keyword}`).blind, '`set -k` (keyword) makes every assignment word one for its command');
    assert.deepStrictEqual(model(`#!/usr/bin/env -S SHELLOPTS=errexit:posix bash\n${regex}`), { blind: undefined, decided: true });
    assert.strictEqual(model(`#!/usr/bin/env -S POSIX_PEDANTIC=1 bash\n${regex}`).blind, 'the shell is started with `POSIX_PEDANTIC`, which turns on options at its start');
    for (const v of ['SHELLOPTS=keyword', 'BASHOPTS=compat31', 'POSIX_PEDANTIC=1']) assert.strictEqual(inner(`env ${v} bash -c '${regex}'`), `the shell is started with \`${v.split('=')[0]}\`, which turns on options at its start`, v);
    assert.strictEqual(inner(`export SHELLOPTS; bash -c '${regex}'`), undefined);
    assert.strictEqual(inner(`docker run --env-file f img bash -c '${regex}'`), 'the shell is started with variables not known');
    // Options of a shell's start the table does not have, and `-o`, `-O` of a name not known.
    assert.strictEqual(model(`#!/bin/bash -r\n${regex}`).blind, unlisted('-r'));
    assert.strictEqual(model(`#!/bin/bash --debugger\n${regex}`).blind, unlisted('--debugger'));
    // (A word that is no option: bash reads it as the script, and the script's path as `$1`.)
    assert.strictEqual(model(`#!/bin/bash other\n${regex}`).blind, unlisted('other'));
    for (const line of ['#!/bin/bash --norc', '#!/bin/bash -', '#!/usr/bin/env -S bash --noprofile -e']) assert.deepStrictEqual(model(`${line}\n${regex}`), { blind: undefined, decided: true }, line);
    assert.strictEqual(model(`#!/usr/bin/env -S bash -i\n${regex}`).blind, unlisted('-i'));
    assert.strictEqual(model(`#!/usr/bin/env -S bash --login\n${regex}`).blind, unlisted('--login'));
    assert.strictEqual(model(`#!/usr/bin/env -S bash -o\n${regex}`).blind, unlisted('-o'));
    assert.strictEqual(model(`#!/usr/bin/env -S bash -k extra\n${regex}`).blind, unlisted('extra'));
    assert.strictEqual(inner(`bash -r -c '${regex}'`), unlisted('-r'));
    assert.strictEqual(inner(`bash --debugger -c '${regex}'`), unlisted('--debugger'));
    assert.strictEqual(inner(`bash --norc -c '${regex}'`), undefined);
    assert.strictEqual(inner(`LC_ALL= LANG=C bash -c '${regex}'`), undefined);
    assert.strictEqual(inner(`bash -O "$o" -c '${regex}'`), unlisted('-O …'));
    assert.strictEqual(inner(`bash +o "$o" -c '${regex}'`), unlisted('+o …'));
    // An `env -S` line not read in full.
    assert.strictEqual(model(`#!/usr/bin/env -S -u LANG bash -k\n${keyword}`).blind, unlisted('-S -u LANG bash -k'));
    assert.strictEqual(model(`#!/usr/bin/env -Sbash -k\n${keyword}`).blind, unlisted('-Sbash -k'));
    assert.strictEqual(model(`#!/usr/bin/env -S python3\n${regex}`).decided, true);
    // Writes through a nameref, also through a chain, by the target's row.
    assert.strictEqual(model(`declare -n r=BASH_COMPAT; r=31; ${regex}`).blind, '`BASH_COMPAT` changes how bash reads the script');
    assert.strictEqual(model('declare -n a=b; declare -n b=FUNCNEST; a=1').blind, '`FUNCNEST` may stop a function call');
    assert.strictEqual(model('declare -n r=LC_ALL; r=de_DE.UTF-8').blind, '`LC_ALL` may be set to a locale other than C');
    assert.strictEqual(model('declare -n r=LC_ALL; r=C; read r').blind, '`LC_ALL` may be set to a locale other than C');
    assert.strictEqual(model("declare -n r=PS4; r='$((u=2))'; set -x").blind, 'PS4, which `set -x` expands before each command, may assign or run a command');
    assert.strictEqual(model('declare -n r=LC_ALL; r=C; declare -n p=PS4; p=+; set -x').blind, undefined);
    // `#!/bin/bash -a` exports the functions defined after it, as `set -a` does.
    const exported = 'y=; f() { if [ -n "$y" ]; then echo set; else echo unset; fi; }; f; bash -c \'y=1; f\'';
    assert.deepStrictEqual(model(`#!/bin/bash -a\n${exported}`), { blind: undefined, decided: false });
    assert.deepStrictEqual(model(exported), { blind: undefined, decided: true });
    // A quoted assignment of `env` is given to the shell; a word after the string is its parameter.
    assert.strictEqual(inner(`env 'BASH_COMPAT=31' bash -c '${regex}'`), '`BASH_COMPAT` changes how bash reads the script');
    assert.strictEqual(inner(`env LC_ALL=de_DE.UTF-8 bash -c '${regex}' LC_ALL=C`), '`LC_ALL` may be set to a locale other than C');
    if (!hasBash) this.skip();
    const run = (script: string): string => runBash(script, { files: [] }).stdout;
    const shebang = (line: string, body: string): string => run(`printf '%s\\n' '${line}' '${body.replace(/'/g, "'\\''")}' > s; chmod +x s; ./s 2>/dev/null`);
    assert.strictEqual(run("x=1; cmd=; $cmd eval x=2; echo $x; cmd=; $cmd set -k; f() { y=$x; }; f x=3; echo $y"), '2\n3\n');
    assert.strictEqual(run(`env SHELLOPTS=keyword bash -c '${keyword}'; env BASHOPTS=compat31 bash -c '${regex}'; POSIX_PEDANTIC=1 bash -c 'shopt -qo posix && echo posix'`), '2\nyes\nposix\n');
    assert.strictEqual(shebang('#!/usr/bin/env -S BASHOPTS=compat31 bash', regex), 'yes\n');
    assert.strictEqual(shebang('#!/usr/bin/env -S SHELLOPTS=keyword bash', keyword), '2\n');
    assert.strictEqual(shebang('#!/bin/bash -r', 'x=1; { x=2; } >/dev/null; echo $x'), '1\n');
    assert.strictEqual(shebang('#!/usr/bin/env -S -u LANG bash -k', keyword), '2\n');
    assert.strictEqual(shebang('#!/usr/bin/env -Sbash -k', keyword), '2\n');
    assert.strictEqual(shebang('#!/bin/bash -a', exported), 'unset\nset\n');
    assert.strictEqual(run(`declare -n r=BASH_COMPAT; r=31; ${regex}; u=1; declare -n p=PS4; p='$((u=2))'; set -x; : 2>/dev/null; set +x 2>/dev/null; echo $u`), 'yes\n2\n');
    assert.strictEqual(run(`env 'BASH_COMPAT=31' bash -c '${regex}'`), 'yes\n');
  });

  it('takes a locale of C, and empty or unset, as changing nothing (src/semantics/opening.ts)', () => {
    const kept: WrittenValue[] = ['none', 'kept', { names: [], text: 'C', fixed: true }, { names: [], text: 'C POSIX', each: ['C', 'POSIX'], fixed: true }];
    for (const v of kept) assert.ok(localeWritten(v), JSON.stringify(v));
    const other: WrittenValue[] = ['number', 'unknown', { names: [], text: 'de_DE', fixed: true }, { names: ['l'], text: '$l' }, { names: [], text: 'C', fixed: true, appended: true }, { names: [], text: '', fixed: true, arith: true }];
    for (const v of other) assert.ok(!localeWritten(v), JSON.stringify(v));
    const blind = (src: string): string | undefined => shellState(parser.parse(src)).blind;
    for (const src of ['LANG=C; LC_ALL=; unset LC_CTYPE; export LC_COLLATE; LC_ALL=C.UTF-8; local LANG=POSIX', 'LANG=de_DE.UTF-8 sort; LC_MESSAGES=de_DE.UTF-8']) assert.strictEqual(blind(src), undefined, src);
    for (const src of ['LANG=de_DE.UTF-8', 'LC_ALL=$l', 'read LANG', 'LC_ALL+=C', 'f() { :; }; LC_ALL=de f', 'alias s=sort; LC_ALL=de s']) assert.strictEqual(blind(src)?.endsWith('may be set to a locale other than C'), true, src);
    // What another shell starts with: unset, or given with a value not known; options turned off.
    assert.strictEqual(openingBlinds({ variables: [['LANG', null], ['PATH', undefined]], shopt: new Map([['compat31', 'off']]), set: new Map([['keyword', 'off'], ['errexit', 'on']]) }), undefined);
    assert.strictEqual(openingBlinds({ variables: [['LANG', undefined]] }), '`LANG` may be set to a locale other than C');
    assert.deepStrictEqual(childOpening([{ flag: '+o', value: 'keyword' }, { flag: '-o', value: 'posix' }, { flag: '+O', value: 'extquote' }, { flag: '-e' }, { flag: '-Z' }, { flag: '--norc' }], [['x', { set: 'on', value: '1' }], ['y', { set: 'off' }], ['z', { set: 'unknown' }], ['POSIXLY_CORRECT', { set: 'on', value: 'y' }]], true),
      { set: new Map([['keyword', 'off'], ['errexit', 'on']]), shopt: new Map([['extquote', 'off']]), variables: [['x', '1'], ['y', null], ['z', undefined]], others: ['-Z'] });
  });

  it('trusts nothing in a script with a construct the table has no row for', () => {
    // (A node type no parser gives: the scan asks the table first, and the default is `all`.)
    const fake = { type: 'no_such_node', named: true, children: [], namedChildren: [], parent: null, text: '', startIndex: 0, endIndex: 0 } as unknown as SyntaxNode;
    const strings = { script: () => undefined, alias: () => fake, expansion: () => fake, capped: false };
    assert.strictEqual(scriptTrust(fake, strings).blind, 'the node type `no_such_node`, which the allow-list does not have');
  });
});
