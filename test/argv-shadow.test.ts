// The shadow comparison of the argument interpreter (src/argv/interpret.ts) with the analyzer's own walk
// (`args` in src/analyzer.ts). For every simple command of the corpus (the fixtures and the snippets of the
// tests), both read the arguments, and the role of each word is compared: option, option value, operand
// (with its text), subcommand, wrapped command, assignment, end of options.
//
// Differences are listed in test/fixtures/argv-shadow-known.json with a reason: either the interpreter is
// wrong (to fix), or the old walk is (the interpreter agrees with the real tool). The test fails on a new
// difference and on a stale entry.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Analyzer, lookupCommand, Token } from '../src/analyzer';
import { fromCommandDoc } from '../src/argv/fromdoc';
import { ArgRole, ArgvParse, ArgWord, interpret } from '../src/argv/interpret';
import type { CommandSpec } from '../src/argv/spec';
import { shoptOptions } from '../src/dict/builtins';
import { distroAliases } from '../src/dict/distroAliases';
import type { CommandDoc } from '../src/dict/types';
import { staticWordValue } from '../src/staticword';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, field } from '../src/syntax/tree';
import type { SyntaxNode } from '../src/syntax/tree';
import * as ts from 'typescript';
import { argWord } from '../src/argv/words';
import { corpus } from './support/corpus';

interface Known { input: string; command: string; word: string; old: string; new: string; reason: string }
const knownFile = path.join(__dirname, 'fixtures/argv-shadow-known.json');

/** A word's role, for comparing: a key, the text the explanation starts with, and the language of an operand or value. */
interface Canon { key: string; text?: string; lang?: string }
const show = (c: Canon | undefined): string =>
  (c ? c.key + (c.text ? ` «${c.text.length > 70 ? `${c.text.slice(0, 70)}…` : c.text}»` : '') + (c.lang ? ` [${c.lang}]` : '') : 'none');
/** The keys and languages are the same, and the old text starts with the new one. */
const agree = (o: Canon | undefined, n: Canon | undefined): boolean =>
  (o?.key ?? 'none') === (n?.key ?? 'none') && o?.lang === n?.lang
  && (n?.text === undefined ? o?.text === undefined : o?.text !== undefined && o.text.startsWith(n.text));

const base = (name: string): string => name.slice(name.lastIndexOf('/') + 1);
const isPlain = (n: SyntaxNode): boolean => n.type === 'word' || n.type === 'number';
const specs = new Map<string, CommandSpec | undefined>();
/** The spec of a command, as a wrapper finds it (by its name). */
function lookup(name: string): CommandSpec | undefined {
  if (!specs.has(name)) {
    const doc = lookupCommand(name);
    specs.set(name, doc && fromCommandDoc(doc, base(name)));
  }
  return specs.get(name);
}
const dash = (flag: string): string => flag.replace(/^\+/, '-');

// ---------------------------------------------------------------- the interpreter's roles

function canonNew(parse: ArgvParse, words: ArgWord[], raw: string[], out: Map<number, Canon>, coarse = false): void {
  const letter = (r: ArgRole): string => (r.role === 'option' ? r.flag.slice(1) + (r.value ? '=' : '') : r.role === 'unknown-option' ? `${r.flag.slice(1)}?${r.value ? '=' : ''}` : '');
  for (const { word, role } of parse.roles) {
    const set = (key: string, text?: string, lang?: string): void => { out.set(word, { key, ...(text !== undefined ? { text } : {}), ...(lang ? { lang } : {}) }); };
    // (A declaration's options are compared by their words only.)
    if (coarse) { set(['operand', 'value'].includes(role.role) ? 'arg' : `opt:${raw[word]}`); continue; }
    switch (role.role) {
      case 'option':
        if (role.disables) set(`opt:${dash(role.flag)}(off)${role.missing ? '(no value)' : ''}`);
        else set(`opt:${role.flag}${role.value ? '=' : ''}${role.missing ? '(no value)' : ''}`, role.missing ? undefined : role.text.en);
        break;
      case 'unknown-option': set(`opt:${role.flag}?${role.value ? '=' : ''}`); break;
      case 'open-option': set('opt:open'); break;
      case 'cluster': set(`opt:-${role.letters.map(letter).join('')}`); break;
      case 'pattern-option': set(`opt:${raw[word]}`, role.text.en); break;
      case 'value': set(`val:${dash(role.of)}#${role.index}`, undefined, role.spec?.lang); break;
      case 'old-style': set(`old:${role.letters.map((l) => (l as { flag: string }).flag).join('')}`); break;
      case 'end-of-options': set('end'); break;
      case 'terminator': set('term'); break;
      case 'joined': set('joined'); break;
      case 'expression': set('skip'); break;
      case 'operand': {
        // (A job spec may be a glob to the shell, `%?foo`: the source text says what it is.)
        const v = words[word].value ?? raw[word];
        const lang = role.spec?.lang;
        if (role.assignment && role.spec!.assignment) set('assign');
        else if (role.assignment) set('arg', role.spec!.assignmentText!.en, lang);
        else if (role.spec?.type === 'job' && /^%./.test(v)) set('job');
        else if (role.spec?.type === 'shell-option' && v in shoptOptions) set('shopt');
        else set('arg', role.spec?.text.en, lang);
        break;
      }
      case 'subcommand': set(`sub:${role.name}`); canonNew(role.parse, words, raw, out); break;
      case 'command':
        if (role.slot.joinsWords) { set('cmd:shell-string'); break; }
        if (!role.parse) { set('shell-string'); break; }
        set(`cmd:${role.slot.run}`);
        // find's expression is read by a parser of its own (not compared).
        if (role.name && base(role.name) === 'find') for (let k = word + 1; k < words.length; k++) out.set(k, { key: 'skip' });
        else canonNew(role.parse, words, raw, out);
        break;
    }
  }
}

// ---------------------------------------------------------------- the old walk's roles

const UNKNOWN = /^Option \(not in the dictionary/;

/** The language the walk gave each word it explained as an operand or a value (recorded from `positional`). */
const langs = new Map<SyntaxNode, string | undefined>();

/** Whether the value of `flag` is a command string in the spec (`bash -c`, `su -c`, `flock FILE -c`). */
function shellValue(spec: CommandSpec | undefined, flag: string): boolean {
  if (spec?.operands?.some((a) => a.pattern.some((x) => x.name === 'COMMAND_STRING')) && flag === '-c') return true;
  const opt = spec?.options?.find((o) => o.names.includes(flag));
  return !!opt && !Array.isArray(opt.value) && !!opt.value?.command;
}

/** The roles of the words `nodes`, read from the tokens the analyzer made for them (`args`). */
function canonOld(tokens: Token[], nodes: SyntaxNode[], doc: CommandDoc | undefined, name: string, out: Map<number, Canon>, offset = 0): void {
  const spec = doc && fromCommandDoc(doc, base(name));
  const at = (t: Token): number => nodes.findIndex((n) => n.startPosition.row === t.span.start.line && n.startPosition.column === t.span.start.character);
  for (const t of tokens) {
    const k = at(t);
    assert.ok(k >= 0, `no word for the token ${t.label}`);
    const word = nodes[k];
    const set = (key: string, text?: string): void => {
      const lang = langs.get(word);
      out.set(offset + k, { key, ...(text !== undefined ? { text } : {}), ...(lang && /^(arg|val:)/.test(key) ? { lang } : {}) });
    };
    const e = t.explanation;
    if ((t.kind === 'command' || t.kind === 'builtin') && /^runs `/.test(e)) {
      set(`cmd:${['command', 'builtin'].includes(base(name)) ? 'current-shell' : 'exec'}`);
      const inner = word.text;
      if (base(inner) === 'find') { for (let j = k + 1; j < nodes.length; j++) out.set(offset + j, { key: 'skip' }); continue; }
      canonOld(t.children, nodes.slice(k + 1), lookupCommand(inner), inner, out, offset + k + 1);
      continue;
    }
    if (t.kind === 'subcommand') { set(`sub:${word.text}`); continue; }
    if (t.kind === 'option') {
      const text = dash(word.text);
      if (/^End of options/.test(e)) { set('end'); continue; }
      if (/^--?[^=]*=/.test(text) && / \(value: `/.test(e)) {
        const flag = text.slice(0, text.indexOf('='));
        set(`opt:${flag}${UNKNOWN.test(e) ? '?' : ''}=`, UNKNOWN.test(e) ? undefined : e);
        continue;
      }
      const letters = t.children.filter((c) => c.kind === 'option');
      if (k === 0 && /^[A-Za-z0-9]+$/.test(text)) { set(`old:${letters.map((c) => c.label).join('')}`); continue; }
      if (letters.length > 1) {
        set(`opt:-${t.children.map((c) => (c.kind === 'option' ? c.label.slice(1) + (UNKNOWN.test(c.explanation) ? '?' : '') : '=')).join('')}`);
        continue;
      }
      const value = t.children.find((c) => c.kind === 'argument' && c.span.start.line === t.span.start.line);
      const flag = value ? text.slice(0, value.span.start.character - t.span.start.character) : text;
      // A value the option needs, with no word left for it (`set -o` alone lists the settings).
      // (A command string is an operand in the spec: `bash -c` with nothing after it has no value missing.)
      const missing = !value && !!doc?.options?.[flag]?.arg && k + 1 >= nodes.length && !shellValue(spec, flag);
      if (UNKNOWN.test(e)) set(`opt:${flag}?${value ? '=' : ''}`);
      else if (/^(Undo|turn it off)/.test(e)) set(`opt:${flag}(off)`);
      else if (/^`\+o` alone/.test(e)) set(`opt:${flag}(off)(no value)`);
      else set(`opt:${flag}${value ? '=' : ''}${missing ? '(no value)' : ''}`, missing ? undefined : e);
      continue;
    }
    const value = /^(Value|Name) for `([^`]+)`/.exec(e);
    if (t.kind === 'argument' && value) {
      const of = value[2];
      const index = value[1] === 'Value' && (doc?.options?.[of]?.argCount ?? 1) > 1 ? 1 : 0;
      set(shellValue(spec, of) ? 'shell-string' : `val:${of}#${index}`);
      continue;
    }
    // `set -o pipefail`: a value the dictionary knows is explained as `pipefail: …`.
    const prev = out.get(offset + k - 1)?.key;
    const valued = Object.entries(doc?.options ?? {}).find(([, o]) => o.values && Object.hasOwn(o.values, word.text))?.[0];
    if (t.kind === 'argument' && e.startsWith(`${word.text}: `) && valued && /^(opt|val):/.test(prev ?? '')) { set(`val:${valued}#0`); continue; }
    if (/^Sets the variable `/.test(e)) { set('assign'); continue; }
    if (/^Job spec: /.test(e)) { set('job'); continue; }
    if (/^Shell option `/.test(e)) { set('shopt'); continue; }
    // ssh: the old walk calls every word after the host the remote command, which the spec joins into one string.
    if (base(name) === 'ssh' && e.startsWith('remote command')) {
      set(/^cmd:/.test(prev ?? '') || prev === 'joined' ? 'joined' : 'cmd:shell-string');
      continue;
    }
    // (Words with no text of their own are explained by what they are: a word, a concatenation…)
    set('arg', t.kind === 'argument' && !/^(Word|Concatenation)\b/.test(e) ? e : undefined);
  }
}

// ---------------------------------------------------------------- the comparison

interface Diff { input: string; command: string; word: string; old: string; new: string }
interface Counts { commands: number; words: number; skipped: Record<string, number> }

type Walk = {
  args(doc: CommandDoc | undefined, args: SyntaxNode[], name: string): Token[];
  declaration(n: SyntaxNode): Token;
  positional(a: SyntaxNode, desc: string | undefined, lang?: string): Token;
};

/** Compares the old and the new roles of the words `args` of a command; adds the differences to `diffs`. */
function compareWords(input: string, c: SyntaxNode, args: SyntaxNode[], old: Map<number, Canon>, now: Map<number, Canon>, counts: Counts, diffs: Diff[]): void {
  counts.commands++;
  for (let k = 0; k < args.length; k++) {
    const o = old.get(k);
    const n = now.get(k);
    if (o?.key === 'skip' || n?.key === 'skip') continue;
    counts.words++;
    if (process.env.ARGV_SHADOW_TRACE) console.log(`${args[k].text}\t${show(o)}\t${show(n)}`);
    if (agree(o, n)) continue;
    diffs.push({ input, command: c.text.replace(/\s*\\\n\s*/g, ' ').slice(0, 100), word: args[k].text, old: show(o), new: show(n) });
  }
}

/** Compares the two readings of every simple command and declaration of a script; returns the differences. */
function compareScript(input: string, text: string, counts: Counts): Diff[] {
  const tree = parser.parse(text);
  const analyzer = new Analyzer('en');
  // explainLine sets up what the walk reads (the script's text, functions, arrays…).
  analyzer.explainLine(tree, 0);
  const walk = analyzer as unknown as Walk;
  const functions = new Set(descendants(tree.root, ['function_definition']).map((f) => field(f, 'name')?.text));
  const aliases = new Set([...text.matchAll(/\balias\s+([^\s=]+)=/g)].map((m) => m[1]));
  const skip = (why: string): void => { counts.skipped[why] = (counts.skipped[why] ?? 0) + 1; };
  const diffs: Diff[] = [];
  const read = (spec: CommandSpec, args: SyntaxNode[], name: string, coarse = false): Map<number, Canon> => {
    const words = args.map(argWord);
    const now = new Map<number, Canon>();
    canonNew(interpret(spec, words, { name, lookup }), words, args.map((a) => a.text), now, coarse);
    return now;
  };
  for (const c of descendants(tree.root, ['command'])) {
    const nameNode = field(c, 'name');
    if (!nameNode) continue;
    const word = nameNode.namedChildren[0];
    const args: SyntaxNode[] = [];
    let seenName = false;
    for (const x of c.children) {
      if (x === nameNode) { seenName = true; continue; }
      if (x.type.endsWith('redirect') || (!seenName && x.type === 'variable_assignment')) continue;
      if (x.named) args.push(x);
    }
    if (!args.length) continue;
    const spelled = word && staticWordValue(word);
    const name = spelled ?? (word && isPlain(word) ? word.text : nameNode.text);
    if (word && isPlain(word) && /[{]/.test(word.text)) { skip('brace head'); continue; }
    if (functions.has(name)) { skip('function'); continue; }
    if (aliases.has(name) && !lookupCommand(name)) { skip('alias'); continue; }
    if (['find', 'yq', 'test'].includes(base(name))) { skip(base(name)); continue; }
    const distro = Object.hasOwn(distroAliases, name) && !lookupCommand(name) ? distroAliases[name] : undefined;
    const doc = distro ? (distro.command ? lookupCommand(distro.command) : undefined) : lookupCommand(name);
    const old = new Map<number, Canon>();
    canonOld(walk.args(doc, args, name), args, doc, name, old);
    compareWords(input, c, args, old, read(doc ? fromCommandDoc(doc, base(name)) : { summary: { ja: '', en: '' } }, args, name), counts, diffs);
  }
  // `declare -a x`, `local -r y=1`: the walk reads them with its own code; options and names are compared.
  for (const d of descendants(tree.root, ['declaration_command'])) {
    const args = d.namedChildren.filter((x) => !x.type.endsWith('redirect'));
    if (!args.length) continue;
    const kw = d.children[0].type;
    const at = (n: SyntaxNode): Token | undefined => walk.declaration(d).children.find((t) => t.span.start.line === n.startPosition.row && t.span.start.character === n.startPosition.column);
    const old = new Map<number, Canon>();
    args.forEach((a, k) => { const t = at(a); if (t) old.set(k, { key: t.kind === 'option' ? `opt:${a.text}` : 'arg' }); });
    compareWords(input, d, args, old, read(lookup(kw)!, args, kw, true), counts, diffs);
  }
  return diffs;
}

const parser = createUnbashParser();

/** Lines from the review of the interpreter, each checked with the real tool: where the walk reads them otherwise, a known difference says so. */
const REVIEWED = [
  'kill -9 -1', 'kill -s TERM -1', 'kill -$sig $pid', 'head -$n f', 'ls -$opts', 'ls -l$x d', 'ssh host ls -l', 'ssh -p 22 host -t ls -l',
  'flock /tmp/l -n true', 'bash +x s.sh', 'chmod --reference=r u+x', 'nice --5 make', "dpkg-query -W -f='${Package}' bash",
  'jq --arg=x y .', "jq -c '$ARGS' in.json --args a", 'jq -n -f prog.jq --args a', 'echo -e -E x', 'bash -ex script.sh -x', 'ls "-l" "--all"', 'let -1+2',
];

/**
 * More inputs: the string literals of the tests that are a command line of a command in the dictionary
 * (`cp -t d a b`, `rpm -qi bash`), beyond the snippets that scripts/extract-snippets.ts collects.
 */
function testLines(): string[] {
  const found = new Set<string>();
  // (Not the interpreter's own tests, whose inputs are made to differ.)
  for (const file of fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.ts') && !f.startsWith('argv-')).sort()) {
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(__dirname, file), 'utf8'), ts.ScriptTarget.ES2022, true);
    const visit = (n: ts.Node): void => {
      if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && /^[\w./-]+ \S/.test(n.text)) found.add(n.text);
      ts.forEachChild(n, visit);
    };
    visit(source);
  }
  return [...found].filter((text) => {
    const tree = parser.parse(text);
    if (tree.errors.length) return false;
    const first = descendants(tree.root, ['command'])[0];
    const name = first && field(first, 'name')?.text;
    return !!name && !!lookupCommand(name);
  });
}

describe('argv shadow: the interpreter against the analyzer\'s walk', () => {
  it('reads every command of the corpus as the walk does, except the known differences', function () {
    this.timeout(300000);
    const { files, snippets } = corpus();
    const known: Known[] = JSON.parse(fs.readFileSync(knownFile, 'utf8'));
    const used = new Set<Known>();
    const counts = { commands: 0, words: 0, skipped: {} as Record<string, number> };
    const fresh: string[] = [];
    let knownCount = 0;
    const seen = new Set(snippets.map((s) => s.text));
    // Record the language the walk gives each operand and value.
    const proto = Analyzer.prototype as unknown as Walk;
    const positional = proto.positional;
    proto.positional = function (this: Walk, a, desc, lang) { langs.set(a, lang); return positional.call(this, a, desc, lang); };
    const inputs = [
      ...files.map((f) => ({ key: f.name, text: f.text })),
      ...snippets.map((s) => ({ key: s.text, text: s.text })),
      ...testLines().filter((t) => !seen.has(t)).map((t) => ({ key: t, text: t })),
      ...REVIEWED.map((t) => ({ key: t, text: t })),
    ];
    try {
      for (const input of inputs) {
        for (const d of compareScript(input.key, input.text, counts)) {
          const k = known.find((e) => e.input === d.input && e.command === d.command && e.word === d.word && e.old === d.old && e.new === d.new);
          if (k) { used.add(k); knownCount++; continue; }
          fresh.push(JSON.stringify(d));
        }
      }
    } finally {
      proto.positional = positional;
    }
    console.log(`      argv shadow: ${counts.commands} commands, ${counts.words} words compared; skipped ${JSON.stringify(counts.skipped)}; ${knownCount} known differences, ${fresh.length} new`);
    const stale = known.filter((k) => !used.has(k)).map((k) => `stale: ${JSON.stringify(k)}`);
    if (process.env.ARGV_SHADOW_DUMP) fs.writeFileSync(process.env.ARGV_SHADOW_DUMP, `[\n${fresh.join(',\n')}\n]\n`);
    assert.deepEqual([...fresh, ...stale], []);
  });
});

