// Turns a dictionary entry of today's shape (CommandDoc, src/dict/types.ts) into a command spec, with the
// rules the analyzer applies by the command's name (`find`, `jq`, `head -5`…). It lets the interpreter read
// every command of the dictionary until the entries are written as specs (the builtins are already).
import type { CommandDoc, OptDoc, PositionalBy } from '../dict/types';
import { Text, tx } from '../i18n';
import type { CommandSpec, Condition, OperandAlt, OperandSpec, OptionSpec, PatternOption, ValueSpec } from './spec';

/** Commands that read `-N` as `-n N` (`head -5`). */
const COUNT_COMMANDS = new Set(['head', 'tail']);

const names = (list: string): string[] => list.split('|');

/** The spec of a dictionary entry; `name` is the command's name, which some rules depend on (none applies to a subcommand). */
export function fromCommandDoc(doc: CommandDoc, name = ''): CommandSpec {
  const spec: CommandSpec = { summary: doc.summary };
  const options = convertOptions(doc.options ?? {});
  // find's expression has a parser of its own; only the options before the paths are options.
  if (name === 'find') {
    spec.operandParser = 'find-expression';
    spec.options = options.filter((o) => o.names.some((n) => /^-[HLP]$/.test(n)));
  } else spec.options = options;
  if (doc.longSingleDash) spec.style = 'single-dash';
  // jq reads `--arg NAME VALUE` only as separate words: `--arg=x` is an unknown option.
  if (name === 'jq') spec.longEquals = false;
  const patterns = patternOptions(name);
  if (patterns.length) spec.patternOptions = patterns;
  spec.operands = operandAlts(doc, name);
  if (doc.subcommands) {
    // (A subcommand written as a spec is used as it is.)
    spec.subcommands = Object.fromEntries(Object.entries(doc.subcommands).map(([sub, d]) => [sub, d.spec ?? fromCommandDoc(d)]));
  }
  return spec;
}

/** Options that share one OptDoc (`-r|--recursive`) become one option with several names. */
function convertOptions(opts: Record<string, OptDoc>): OptionSpec[] {
  const byDoc = new Map<OptDoc, string[]>();
  for (const [n, o] of Object.entries(opts)) byDoc.set(o, [...(byDoc.get(o) ?? []), n]);
  return [...byDoc].map(([o, ns]) => convertOption(ns, o));
}

function convertOption(ns: string[], o: OptDoc): OptionSpec {
  const opt: OptionSpec = { names: ns, text: o.text, ...(o.persistent ? { persistent: true } : {}) };
  const extra: Partial<ValueSpec> = { ...(o.lang ? { lang: o.lang } : {}), ...(o.values ? { values: o.values } : {}) };
  if (o.untilTerminator) opt.until = { terminators: [';', '+'], slot: { run: 'exec' } };
  else if (o.arg) {
    const n = o.argCount ?? 1;
    opt.value = n > 1
      ? Array.from({ length: n }, (_, k): ValueSpec => ({ name: n === 2 ? ['NAME', 'VALUE'][k] : `VALUE${k + 1}`, ...(k === n - 1 ? extra : {}) }))
      : { name: 'VALUE', ...extra };
  } else if (o.attachedOnly) opt.value = { name: 'VALUE', how: 'attached-only', optional: true, ...extra };
  else if (o.nextIf) opt.value = { name: 'VALUE', optional: true, next: new RegExp(o.nextIf), ...extra };
  // `jq . in.json --args a`: the operands after the option are values, not files.
  if (o.restOperands) opt.laterOperands = { name: 'ARG', text: o.restOperands, repeat: '*' };
  return opt;
}

/** The options recognized by their form, which the analyzer knows by the command's name. */
function patternOptions(name: string): PatternOption[] {
  const out: PatternOption[] = [];
  if (COUNT_COMMANDS.has(name)) {
    out.push({
      pattern: /^-(\d+)$/,
      text: ([, n]) => tx(`${n} 行（\`-n ${n}\` の古い書き方）`, `${n} line${n === '1' ? '' : 's'} (old way to write \`-n ${n}\`)`),
      open: tx('展開した数の行数（`-n 数` の古い書き方）', 'as many lines as the expansion gives (old way to write `-n N`)'),
    });
  }
  return out;
}

/** The operand alternatives: by count (`positionalBy`), by option (`fills`), then the default; none when nothing describes them. */
function operandAlts(doc: CommandDoc, name: string): OperandAlt[] | undefined {
  const texts = doc.positional ?? [];
  const opts = Object.entries(doc.options ?? {});
  // (`typed`: the language of the positional arguments, which an option may change: `chmod --reference`.)
  const item = (i: number, t: Text, repeat?: OperandSpec['repeat'], typed = true): OperandSpec => {
    const lang = typed ? doc.positionalLang?.[i] : undefined;
    return {
      name: `ARG${i + 1}`, text: t, ...(repeat ? { repeat } : {}), ...(lang ? { lang } : {}),
      ...(i > 0 && /^(g|m|n)?awk$/.test(name) ? { assignmentText: AWK_ASSIGNMENT } : {}),
    };
  };
  // The positional texts from `from` on: each optional, and the last repeats (as `positional` does).
  const listed = (list: Text[], from = 0): OperandSpec[] => {
    const out: OperandSpec[] = [];
    for (let i = from; i < list.length; i++) {
      if (i < list.length - 1) { out.push(item(i, list[i], '?')); continue; }
      // A language applies to its own index only (`positionalLang` does not repeat).
      if (doc.positionalLang?.[i]) out.push(item(i, list[i], '?'), { ...item(i + 1, list[i], '*'), lang: undefined });
      else out.push(item(i, list[i], '*'));
    }
    return out;
  };
  const alts: OperandAlt[] = [];
  for (const rule of doc.positionalBy ?? []) {
    const when = condition(rule);
    alts.push({ ...when, pattern: byCount(rule, (i, t, repeat) => item(i, t, repeat, !when.when)) });
  }
  const fills = opts.filter(([, o]) => o.fillsPositional).map(([n]) => n);
  if (fills.length) alts.push({ when: { option: fills }, pattern: listed(texts, 1) });
  if (texts.length) alts.push({ pattern: listed(texts) });
  return alts.length ? alts : undefined;
}

const AWK_ASSIGNMENT = tx(
  '変数の代入 `名前=値`: これより後のファイルを読み始める前に awk の変数を設定する（`-v` と違い `BEGIN` では使えない。`\\t` などのエスケープは解釈される）',
  'Variable assignment `name=value`: sets the awk variable before the files after it are read (unlike `-v`, `BEGIN` does not see it; escapes such as `\\t` are processed)',
);

function condition(rule: PositionalBy): { when?: Condition } {
  // (No rule has both `when` and `unless`.)
  if (rule.when) return { when: { option: names(rule.when) } };
  if (rule.unless) return { when: { not: { option: names(rule.unless) } } };
  return {};
}

/**
 * `positionalBy`: exactly `count` operands (or more, with `orMore`); the texts in order, the last one
 * repeating, and `last` for the final operand.
 */
function byCount(rule: PositionalBy, item: (i: number, t: Text, repeat?: OperandSpec['repeat']) => OperandSpec): OperandSpec[] {
  const { count, texts, last } = rule;
  const at = (i: number): Text => texts[Math.min(i, texts.length - 1)];
  const required = last ? count - 1 : count;
  const out: OperandSpec[] = [];
  for (let i = 0; i < required; i++) out.push(item(i, at(i)));
  if (rule.orMore) {
    for (let i = required; i < texts.length - 1; i++) out.push(item(i, at(i), '?'));
    out.push(item(Math.max(required, texts.length - 1), at(texts.length - 1), '*'));
  }
  if (last) out.push(item(count - 1, last));
  return out;
}
