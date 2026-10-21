// Turns a dictionary entry of today's shape (CommandDoc, src/dict/types.ts) into a command spec, with the
// rules the analyzer applies by the command's name (`echo`, `set`, `kill`, `head -5`…). It lets the
// interpreter read every command of the dictionary until the entries are written as specs.
import type { CommandDoc, OptDoc, PositionalBy } from '../dict/types';
import { Text, tx } from '../i18n';
import type { CommandSlot, CommandSpec, Condition, OperandAlt, OperandSpec, OptionSpec, PatternOption, ValueSpec, ValueType } from './spec';

/** POSIX special builtins: an assignment before them stays in POSIX mode. */
const SPECIAL_BUILTINS = new Set([':', '.', 'source', 'break', 'continue', 'eval', 'exec', 'exit', 'export', 'readonly', 'return', 'set', 'shift', 'times', 'trap', 'unset']);
/** Commands whose operands may be job specs (`%1`). */
const JOB_COMMANDS = new Set(['kill', 'fg', 'bg', 'wait', 'disown', 'jobs']);
/** Commands that read `-N` as `-n N` (`head -5`). */
const COUNT_COMMANDS = new Set(['head', 'tail', 'git log', 'git show', 'nice']);
const SIGNALS = 'HUP|INT|QUIT|ILL|TRAP|ABRT|BUS|FPE|KILL|USR1|SEGV|USR2|PIPE|ALRM|TERM|STKFLT|CHLD|CONT|STOP|TSTP|TTIN|TTOU|URG|XCPU|XFSZ|VTALRM|PROF|WINCH|IO|PWR|SYS|EMT|INFO|POLL|CLD|IOT';

const COMMAND_TEXT = tx('実行するコマンド', 'command to run');
const names = (list: string): string[] => list.split('|');

/** The spec of a dictionary entry; `name` is the command's name (`git log` for a subcommand), which some rules depend on. */
export function fromCommandDoc(doc: CommandDoc, name = ''): CommandSpec {
  const spec: CommandSpec = { summary: doc.summary };
  const options = convertOptions(doc.options ?? {}, name);
  // find's expression has a parser of its own; only the options before the paths are options.
  if (name === 'find') {
    spec.operandParser = 'find-expression';
    spec.options = options.filter((o) => o.names.some((n) => /^-[HLP]$/.test(n)));
  } else spec.options = options;
  // `bash -c 'cmd'`: `-c` says that the first operand is a command string; it takes no value of its own.
  if (doc.shellC) for (const o of options) if (o.names.includes('-c')) delete o.value;
  // `kill -9 -1`: only the first signal is one; then a word like `-1` is a PID (bash's `saw_signal`).
  if (name === 'kill') {
    for (const o of options) {
      if (o.names.some((n) => ['-s', '-n', '-9', '-0'].includes(n))) o.marks = 'signal';
      if (o.names.some((n) => ['-9', '-0'].includes(n))) o.unlessMarked = 'signal';
    }
  }
  if (doc.longSingleDash) spec.style = 'single-dash';
  // `echo` knows only `-n`, `-e` and `-E`, alone or joined; any other word is text to print. `let` has no options: `let -a` is an expression.
  else if (name === 'echo' || name === 'let') spec.style = 'none';
  // Builtins read options up to their first operand; so do wrappers (getopt with `+`) and shells.
  // (ssh reads options again after the host, up to the command: the gnu style with a command slot.)
  else if (doc.builtin || doc.wraps || doc.shellC) spec.style = 'posix';
  if (doc.builtin) spec.builtin = SPECIAL_BUILTINS.has(name) ? 'special' : 'regular';
  if (['set', 'declare', 'typeset', 'local'].includes(name) || doc.shellC) spec.plusOptions = true;
  // jq reads `--arg NAME VALUE` only as separate words: `--arg=x` is an unknown option.
  if (name === 'jq') spec.longEquals = false;
  if (/^dpkg(-query|-deb)?$/.test(name)) spec.shortEquals = true;
  const patterns = patternOptions(name);
  if (patterns.length) spec.patternOptions = patterns;
  if (name === 'echo') spec.dashDash = 'literal';
  if (doc.afterDashes) spec.dashDash = { then: [{ name: 'COMMAND', text: COMMAND_TEXT, command: { run: 'exec', where: 'container', env: 'none' } }] };
  // `rpm -qi`: an option means something else when another is given (a mode).
  const modes = new Set<string>();
  for (const [opt, o] of optionPairs(doc.options ?? {}, options)) {
    if (!o.inMode) continue;
    modes.add(o.inMode.when);
    opt.inMode = { [o.inMode.when]: o.inMode.text };
  }
  for (const when of modes) for (const opt of options) if (opt.names.some((n) => names(when).includes(n))) opt.selects = when;
  if (modes.size) spec.modes = [...modes].map((m) => ({ name: m }));
  // `echo -e`: backslash escapes are read; the last of `-e` and `-E` decides.
  if (name === 'echo') {
    spec.modes = [{ name: 'escapes' }, { name: 'plain', default: true }];
    spec.lastModeWins = true;
    for (const o of options) if (o.names[0] === '-e' || o.names[0] === '-E') o.selects = o.names[0] === '-e' ? 'escapes' : 'plain';
  }
  if (doc.bundle) {
    const b = doc.bundle;
    spec.oldStyle = {
      ...(b.options ? { letters: Object.fromEntries(Object.entries(b.options).map(([ch, o]) => [ch, convertOption([ch], o, name)])) } : {}),
      ...(b.needs ? { needs: b.needs } : {}),
      ...(b.style ? { style: b.style } : {}),
    };
  }
  spec.operands = operandAlts(doc, name);
  if (doc.subcommands) {
    spec.subcommands = Object.fromEntries(Object.entries(doc.subcommands).map(([sub, d]) => [sub, fromCommandDoc(d, `${name} ${sub}`)]));
  }
  return spec;
}

/** Options that share one OptDoc (`-r|--recursive`) become one option with several names. */
function convertOptions(opts: Record<string, OptDoc>, command: string): OptionSpec[] {
  const byDoc = new Map<OptDoc, string[]>();
  for (const [n, o] of Object.entries(opts)) byDoc.set(o, [...(byDoc.get(o) ?? []), n]);
  return [...byDoc].map(([o, ns]) => convertOption(ns, o, command));
}

/** Each option with the OptDoc it came from. */
function optionPairs(opts: Record<string, OptDoc>, options: OptionSpec[]): [OptionSpec, OptDoc][] {
  return options.map((opt) => [opt, opts[opt.names[0]]]);
}

function convertOption(ns: string[], o: OptDoc, command: string): OptionSpec {
  const opt: OptionSpec = { names: ns, text: o.text };
  const extra: Partial<ValueSpec> = { ...(o.lang ? { lang: o.lang } : {}), ...(o.values ? { values: o.values } : {}) };
  if (o.untilTerminator) opt.until = { terminators: [';', '+'], slot: { run: 'exec' } };
  else if (o.arg) {
    // `set -euo pipefail`: bash's `set` takes the name of `-o` from the next word, and reads the letters after it.
    const how = command === 'set' ? { how: 'next-only' as const } : {};
    const n = o.argCount ?? 1;
    // `su -c 'cmd'`, `flock FILE -c 'cmd'`: the value is a command string.
    const shell: CommandSlot | undefined = command === 'su' ? { run: 'shell-string', env: 'reset' } : command === 'flock' ? { run: 'shell-string', env: 'exported' } : undefined;
    opt.value = n > 1
      ? Array.from({ length: n }, (_, k): ValueSpec => ({ name: n === 2 ? ['NAME', 'VALUE'][k] : `VALUE${k + 1}`, ...how, ...(k === n - 1 ? extra : {}) }))
      : { name: 'VALUE', ...how, ...extra, ...(shell && ns.includes('-c') ? { command: shell } : {}) };
  } else if (o.attachedOnly) opt.value = { name: 'VALUE', how: 'attached-only', optional: true, ...extra };
  else if (o.nextIf) opt.value = { name: 'VALUE', optional: true, next: new RegExp(o.nextIf), ...extra };
  // `jq . in.json --args a`: the operands after the option are values, not files.
  if (o.restOperands) opt.laterOperands = { name: 'ARG', text: o.restOperands, repeat: '*' };
  return opt;
}

/** The options recognized by their form, which the analyzer knows by the command's name. */
function patternOptions(name: string): PatternOption[] {
  const out: PatternOption[] = [];
  const base = name.split(' ')[0];
  if (COUNT_COMMANDS.has(name)) {
    out.push({
      pattern: /^-(\d+)$/,
      text: ([, n]) => (base === 'git' ? tx(`${n} 件だけ（\`-n ${n}\` と同じ）`, `only ${n} (same as \`-n ${n}\`)`)
        : base === 'nice' ? tx(`優先度の調整値 ${n}（\`-n ${n}\` の古い書き方。負の値は \`--${n}\` で、権限が必要）`, `niceness adjustment ${n} (old way to write \`-n ${n}\`; a negative value is \`--${n}\` and needs privileges)`)
          : tx(`${n} 行（\`-n ${n}\` の古い書き方）`, `${n} line${n === '1' ? '' : 's'} (old way to write \`-n ${n}\`)`)),
      open: base === 'git' ? tx('展開した数の件数だけ（`-n 数` と同じ）', 'only as many as the expansion gives (same as `-n N`)')
        : base === 'nice' ? tx('展開した値を優先度の調整値にする（`-n 値` の古い書き方）', 'niceness adjustment given by the expansion (old way to write `-n N`)')
          : tx('展開した数の行数（`-n 数` の古い書き方）', 'as many lines as the expansion gives (old way to write `-n N`)'),
    });
  }
  // `nice --5`: an adjustment of -5.
  if (name === 'nice') {
    out.push({ pattern: /^--(\d+)$/, text: ([, n]) => tx(`優先度の調整値 -${n}（\`-n -${n}\` の古い書き方。負の値には権限が必要）`, `niceness adjustment -${n} (old way to write \`-n -${n}\`; a negative value needs privileges)`) });
  }
  if (name === 'kill') {
    const signal = { marks: 'signal', unlessMarked: 'signal' };
    out.push(
      {
        pattern: /^-(\d+)$/, ...signal,
        text: ([, n]) => tx(`送るシグナルの番号 ${n}（\`-n ${n}\` と同じ。\`kill -l ${n}\` で名前がわかる）`, `Send signal number ${n} (same as \`-n ${n}\`; \`kill -l ${n}\` prints its name)`),
        open: tx('展開した名前か番号のシグナルを送る（`-s 名前` と同じ）', 'Send the signal the expansion names (same as `-s NAME`)'),
      },
      {
        pattern: new RegExp(`^-(?:SIG)?(${SIGNALS})$`, 'i'), ...signal,
        text: ([, s]) => tx(`送るシグナル \`${s.toUpperCase()}\`（\`-s ${s.toUpperCase()}\` と同じ。\`kill -l\` で一覧）`, `Send the signal \`${s.toUpperCase()}\` (same as \`-s ${s.toUpperCase()}\`; \`kill -l\` lists them)`),
      },
    );
  }
  return out;
}

/** The operand alternatives: by count (`positionalBy`), by option (`positionalWith`, `fills`), then the default; none when nothing describes them. */
function operandAlts(doc: CommandDoc, name: string): OperandAlt[] | undefined {
  const texts = doc.positional ?? [];
  const opts = Object.entries(doc.options ?? {});
  const job = JOB_COMMANDS.has(name);
  const type: ValueType | undefined = job ? 'job' : name === 'let' ? 'arith' : name === 'shopt' ? 'shell-option' : undefined;
  // (`typed`: the type and language of the positional arguments, which an option may change: `kill -l`, `chmod --reference`.)
  const item = (i: number, t: Text, repeat?: OperandSpec['repeat'], typed = true): OperandSpec => {
    const itemType = typed ? type : undefined;
    const lang = !typed ? undefined : name === 'let' ? 'arith' : doc.positionalLang?.[i];
    return {
      name: `ARG${i + 1}`, text: t, ...(repeat ? { repeat } : {}), ...(itemType ? { type: itemType } : {}), ...(lang ? { lang } : {}),
      ...(i > 0 && /^(g|m|n)?awk$/.test(name) ? { assignmentText: AWK_ASSIGNMENT } : {}),
    };
  };
  // The positional texts from `from` on: each optional, and the last repeats (as `positional` does).
  const listed = (list: Text[], from = 0, typed = true): OperandSpec[] => {
    const out: OperandSpec[] = [];
    for (let i = from; i < list.length; i++) {
      if (i < list.length - 1) { out.push(item(i, list[i], '?', typed)); continue; }
      // A language applies to its own index only (`positionalLang` does not repeat).
      if (doc.positionalLang?.[i] && name !== 'let') out.push(item(i, list[i], '?', typed), { ...item(i + 1, list[i], '*', typed), lang: undefined });
      else out.push(item(i, list[i], '*', typed));
    }
    return out;
  };
  if (doc.shellC) return SHELL_OPERANDS;
  const alts: OperandAlt[] = [];
  // ssh reads options again after the host; the words after it are joined into one string for the remote shell.
  if (name === 'ssh') {
    return [{
      pattern: [
        item(0, texts[0]),
        { name: 'COMMAND', text: texts[1], repeat: '?', command: { run: 'shell-string', where: 'remote', joinsWords: true } },
      ],
    }];
  }
  if (doc.wraps) {
    const slot: CommandSlot = name === 'command' ? { run: 'current-shell', lookup: 'no-functions' }
      : name === 'builtin' ? { run: 'current-shell', lookup: 'builtins-only' }
        : name === 'exec' ? { run: 'exec', replacesShell: true } : { run: 'exec' };
    const skip = Array.from({ length: doc.wrapSkip ?? 0 }, (_, i) => item(i, texts[Math.min(i, texts.length - 1)], '?'));
    // `flock FILE -c CMD`: options end at the file, but `-c` right after it is still read.
    if (name === 'flock') alts.push({ pattern: [item(0, texts[0]), { name: '-c', text: COMMAND_TEXT, option: '-c' }, { name: 'COMMAND_STRING', text: COMMAND_TEXT, command: { run: 'shell-string', env: 'exported' } }] });
    alts.push({
      pattern: [
        ...(doc.assigns ? [{ name: 'NAME=VALUE', text: tx('コマンドの環境に入れる変数', 'variable for the command'), assignment: true, repeat: '*' as const }] : []),
        ...skip,
        { name: 'COMMAND', text: COMMAND_TEXT, repeat: '?', command: slot },
      ],
    });
    return alts;
  }
  for (const rule of doc.positionalBy ?? []) {
    const when = condition(rule);
    alts.push({ ...when, pattern: byCount(rule, (i, t, repeat) => item(i, t, repeat, !when.when)) });
  }
  for (const [o, list] of Object.entries(doc.positionalWith ?? {})) alts.push({ when: { option: names(o) }, pattern: listed(list, 0, !job) });
  const fills = opts.filter(([, o]) => o.fillsPositional).map(([n]) => n);
  if (fills.length) alts.push({ when: { option: fills }, pattern: listed(texts, 1) });
  if (name === 'echo') alts.push({ when: { mode: 'escapes' }, pattern: [{ ...item(0, texts[0], '*'), lang: 'echo' }] });
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

const shellArgs = (t: Text): OperandSpec => ({ name: 'ARG', text: t, repeat: '*' });
/** `bash -c 'cmd' NAME ARG…`, `bash -s ARG…`, `bash SCRIPT ARG…`. */
const SHELL_OPERANDS: OperandAlt[] = [
  {
    when: { option: ['-c'] },
    pattern: [
      { name: 'COMMAND_STRING', text: tx('実行するコマンド文字列', 'command string to run'), command: { run: 'shell-string', env: 'exported' } },
      { name: 'NAME', repeat: '?', text: tx('`$0` になる名前（スクリプト名の代わり。エラーメッセージにも出る）。引数ではない', 'Becomes `$0`, the name in place of a script name (shown in error messages); not an argument') },
      shellArgs(tx('コマンド文字列の位置パラメータ', 'Positional parameter')),
    ],
  },
  { when: { option: ['-s'] }, pattern: [shellArgs(tx('スクリプトへの引数', 'Argument to the script'))] },
  { pattern: [{ name: 'SCRIPT', repeat: '?', text: tx('実行するスクリプト', 'Script to run'), type: 'file' }, shellArgs(tx('スクリプトへの引数', 'Argument to the script'))] },
];
