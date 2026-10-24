// bash-explainer: explains shell scripts line by line in the terminal, and checks them for
// constructs their shell lacks. Offline, like the extension: nothing is sent anywhere.
import * as fs from 'fs';
import { Analyzer, Example, LineExplanation, Token } from '../src/analyzer';
import { BASH_VERSIONS, type BashVersion, DEFAULT_BASH_VERSION } from '../src/bashversion';
import { Shell, SHELL_NAMES } from '../src/dialect';
import { DocumentIssue, diagnosticsFor, explainDocumentLine, plain } from '../src/document';
import { FILE_KINDS, FileKind, openDocument, shellsOf } from '../src/document-setup';
import { hostKind } from '../src/hosts';
import { Lang, resolveLang } from '../src/i18n';
import { joinParts, labelParts, PLACEHOLDER_CLOSE, PLACEHOLDER_OPEN } from '../src/label';
import { explainOptions, forcedShell, mergeSettings, parseAssignment, readSettings, Settings, settingsJson } from '../src/settings';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { splitNote } from '../src/messages';
import { explained, noteRefs, notesByLevel, refsText, toPlainMarkdown } from '../src/ui/render';
import { startLanguageServer } from './lsp';
import { readSettingsFile, settingsFile, SettingsFileError } from './settings-file';

declare const __VERSION__: string;

type Kind = FileKind;
const KINDS = FILE_KINDS;
type Format = 'text' | 'markdown' | 'json' | 'sarif' | 'github';

const HELP = `Usage: bash-explainer [options] <file>[:<line>[-<line>]]...
       bash-explainer [options] -e '<command line>'
       cat script.sh | bash-explainer [options] -
       bash-explainer --lsp

Explains shell scripts line by line: every command, option, redirection and
expansion, with worked examples. Also reads the shell code in Dockerfiles,
Makefiles, CI YAML, Jenkinsfiles, package.json, Markdown and Python, and
points out common pitfalls. Runs offline.

Options:
  -e, --command <text>   explain this command line
  -l, --line <n>[-<m>]   only these lines (also <file>:<n>[-<m>])
      --check            report constructs the script's shell lacks, other risks
                         and pitfalls; exit 1 if there is a warning (other than
                         on a pitfall)
      --strict           with --check, also exit 1 on a warning on a pitfall
      --shell <name>     the script's shell: ${Object.keys(SHELL_NAMES).join(', ')}
                         (default: from the shebang or the file name)
      --bash-version <v>  the bash release to explain for: ${BASH_VERSIONS.join(', ')}
                         (default: ${DEFAULT_BASH_VERSION})
      --kind <kind>      what the file is: ${KINDS.join(', ')}
                         (default: from the file name)
      --lang <en|ja>     language (default: from LANG)
      --format <format>  text, markdown or json (default: text); with --check also
                         sarif (for code scanning) or github (annotations in
                         GitHub Actions)
      --sarif <file>     with --check, also write the problems to this file as
                         SARIF, whatever --format says (one run for both)
      --no-examples      leave out worked examples
      --config <file>    read the settings from this JSON file (default:
                         $BASH_EXPLAINER_CONFIG, else
                         ~/.config/bash-explainer/settings.json when it exists)
      --no-config        read no settings file
      --set <key>=<value>  set one setting, as named in VS Code (shell=dash,
                         notes.idioms=false); may be repeated
      --print-config     print the settings in effect as JSON
      --color, --no-color  colour the text output (default: when a terminal)
      --lsp              run as a Language Server on standard input and output
                         (hover, diagnostics, quick fixes) for editors
  -h, --help             show this help
  -v, --version          show the version

Settings: the file, then --set, then --lang, --shell, --bash-version and
--no-examples, each overriding the one before.

Exit status: 0 when done (with --check: no warning), 1 with --check when there
is a warning (with --strict, also one on a pitfall), 2 on a usage or input
error.
`;

class UsageError extends Error {}

interface Options {
  inputs: { spec: string; lines?: [number, number] }[];
  command?: string;
  lines?: [number, number];
  check: boolean;
  /** With --check: the warnings on pitfalls fail it too. */
  strict: boolean;
  shell?: Shell;
  kind?: Kind;
  lang: Lang;
  format: Format;
  /** With --check: also write the problems to this file as SARIF. */
  sarifFile?: string;
  color: boolean;
  settings: Settings;
  /** Keys and values from the settings file or --set that were left out. */
  warnings: string[];
  printConfig: boolean;
}

function parseRange(text: string): [number, number] {
  const m = /^(\d+)(?:-(\d+))?$/.exec(text);
  if (!m || +m[1] < 1) throw new UsageError(`not a line or line range: ${text}`);
  const from = +m[1];
  const to = m[2] ? +m[2] : from;
  if (to < from) throw new UsageError(`not a line range: ${text}`);
  return [from, to];
}

const locale = (env: NodeJS.ProcessEnv) => env.LC_ALL || env.LC_MESSAGES || env.LANG || '';

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv, isTTY: boolean): Options | 'help' | 'version' {
  const o: Options = {
    inputs: [], check: false, strict: false, lang: 'en', format: 'text', color: isTTY && !env.NO_COLOR, settings: mergeSettings(), warnings: [], printConfig: false,
  };
  let config: string | undefined;
  let noConfig = false;
  const sets: Record<string, unknown> = {};
  /** The settings the dedicated options set, which win over the file and --set. */
  const flags: Partial<Settings> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // Everything after -- is a file, even if it starts with -.
    if (arg === '--') {
      o.inputs.push(...argv.slice(i + 1).map((spec) => ({ spec })));
      break;
    }
    const [name, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    const value = () => {
      if (inline !== undefined) return inline;
      if (i + 1 >= argv.length) throw new UsageError(`${name} needs a value`);
      return argv[++i];
    };
    switch (name) {
      case '-h': case '--help': return 'help';
      case '-v': case '--version': return 'version';
      case '-e': case '--command': o.command = value(); break;
      case '-l': case '--line': o.lines = parseRange(value()); break;
      case '--check': o.check = true; break;
      case '--strict': o.strict = true; break;
      case '--no-examples': flags['examples.enabled'] = false; break;
      case '--config': config = value(); break;
      case '--no-config': noConfig = true; break;
      case '--print-config': o.printConfig = true; break;
      case '--set': {
        const v = value();
        const a = parseAssignment(v);
        if (!a) throw new UsageError(`--set needs <key>=<value>: ${v}`);
        sets[a.key] = a.value;
        break;
      }
      case '--color': o.color = true; break;
      case '--no-color': o.color = false; break;
      case '--shell': {
        const v = value();
        if (!(v in SHELL_NAMES)) throw new UsageError(`unknown shell: ${v} (${Object.keys(SHELL_NAMES).join(', ')})`);
        flags.shell = v as Shell;
        break;
      }
      case '--bash-version': {
        const v = value() as BashVersion;
        if (!BASH_VERSIONS.includes(v)) throw new UsageError(`unknown bash version: ${v} (${BASH_VERSIONS.join(', ')})`);
        flags.bashVersion = v;
        break;
      }
      case '--kind': {
        const v = value() as Kind;
        if (!KINDS.includes(v)) throw new UsageError(`unknown kind: ${v} (${KINDS.join(', ')})`);
        o.kind = v;
        break;
      }
      case '--lang': {
        const v = value();
        if (v !== 'en' && v !== 'ja') throw new UsageError(`unknown language: ${v} (en, ja)`);
        flags.language = v;
        break;
      }
      case '--format': {
        const v = value();
        if (!['text', 'markdown', 'json', 'sarif', 'github'].includes(v)) throw new UsageError(`unknown format: ${v} (text, markdown, json, sarif, github)`);
        o.format = v as Format;
        break;
      }
      case '--sarif':
        o.sarifFile = value();
        if (o.sarifFile === '-') throw new UsageError('--sarif needs a file, not - (use --format sarif for standard output)');
        break;
      default: {
        if (arg.startsWith('-') && arg !== '-') throw new UsageError(`unknown option: ${arg}`);
        // file:12 or file:3-8 (a real file whose name ends that way wins)
        const m = /^(.+):(\d+(?:-\d+)?)$/.exec(arg);
        if (m && !fs.existsSync(arg)) o.inputs.push({ spec: m[1], lines: parseRange(m[2]) });
        else o.inputs.push({ spec: arg });
      }
    }
  }
  if ((o.format === 'sarif' || o.format === 'github') && !o.check) throw new UsageError(`--format ${o.format} goes with --check`);
  if (o.sarifFile !== undefined && !o.check) throw new UsageError('--sarif goes with --check');
  if (o.strict && !o.check) throw new UsageError('--strict goes with --check');
  // defaults < settings file < --set < --lang, --shell, --bash-version, --no-examples
  const file = noConfig ? undefined : settingsFile(config, env);
  let fromFile: Partial<Settings> = {};
  if (file) {
    try {
      const read = readSettingsFile(file);
      fromFile = read.settings;
      o.warnings.push(...read.warnings);
    } catch (e) {
      if (!(e instanceof SettingsFileError)) throw e;
      throw new UsageError(e.message);
    }
  }
  const set = readSettings(sets, '--set');
  o.warnings.push(...set.warnings);
  o.settings = mergeSettings(fromFile, set.settings, flags);
  o.lang = resolveLang(o.settings.language, locale(env));
  o.shell = forcedShell(o.settings);
  if (o.printConfig) return o;
  if (!o.inputs.length && o.command === undefined) throw new UsageError('nothing to explain: give a file, - for standard input, or -e <command line>');
  return o;
}

// ---- Documents --------------------------------------------------------------------------------

interface Input {
  /** Shown in the output: the file name, "-" or "(command)". */
  name: string;
  text: string;
  kind: Kind;
  lines?: [number, number];
}

function readInputs(o: Options): Input[] {
  const out: Input[] = [];
  if (o.command !== undefined) out.push({ name: '(command)', text: o.command, kind: o.kind ?? 'shell', lines: o.lines });
  for (const input of o.inputs) {
    let text: string;
    try {
      text = input.spec === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(input.spec, 'utf8');
    } catch (e) {
      throw new UsageError(`cannot read ${input.spec}: ${(e as NodeJS.ErrnoException).code ?? e}`);
    }
    const kind = o.kind ?? (input.spec === '-' ? 'shell' : hostKind('', input.spec, text) ?? 'shell');
    // A shell script keeps its CRs: the parser reads them as blanks and the check warns about them.
    out.push({ name: input.spec, text: kind === 'shell' ? text : text.replace(/\r\n/g, '\n'), kind, lines: input.lines ?? o.lines });
  }
  return out;
}

// ---- Output -----------------------------------------------------------------------------------

const ANSI: Partial<Record<Token['kind'], string>> = {
  command: '34', subcommand: '34', builtin: '34', function: '34', alias: '34',
  option: '33', redirect: '33', pattern: '33',
  argument: '32', string: '32', number: '32',
  operator: '35', keyword: '35', block: '35', test: '35',
  variable: '31', expansion: '31', substitution: '31', assignment: '31',
  comment: '90', error: '91',
};

const NOTE_ANSI = { warning: '33', info: '34', note: '90' } as const;

function textOutput(name: string, line: number, lineText: string, ex: LineExplanation, color: boolean, lang: Lang): string {
  const paint = (code: string | undefined, s: string) => (color && code ? `\x1b[${code}m${s}\x1b[0m` : s);
  // The sections of the manual a row is about, dim: " (Bash manual 3.7.2)".
  const refs = (r: readonly string[] | undefined) => (r?.length ? paint('90', refsText(lang, r)) : '');
  const out: string[] = [`${paint('1', `${name}:${line + 1}`)}  ${lineText.trim()}`];
  for (const c of ex.context) out.push(`  ${paint('90', `› ${c.label} (${c.line + 1})`)}`);
  // A note's mark and word in the colour of its level, as the problems print theirs (`warning`, `info`).
  for (const n of notesByLevel(ex.notes)) {
    const { level, body } = splitNote(n, lang);
    const head = n.slice(0, n.length - body.length).trimEnd();
    const shown = head ? `${paint(NOTE_ANSI[level], level === 'note' ? head : paint('1', head))} ${body}` : body;
    out.push(`  ${shown}${refs(noteRefs(ex, n))}`);
  }
  const walk = (t: Token, depth: number) => {
    // Code parts in the colour of the kind; a placeholder in italics and dim (or ‹name› when there is no colour).
    const label = joinParts(labelParts(t), (p) => (p.placeholder
      ? (color ? `\x1b[2;3m${p.text}\x1b[0m` : `${PLACEHOLDER_OPEN}${p.text}${PLACEHOLDER_CLOSE}`)
      : paint(ANSI[t.kind], p.text.replace(/\s*\n\s*/g, ' ⏎ '))));
    out.push(`${'  '.repeat(depth + 1)}${label}  ${explained(t).replace(/`/g, '')}${refs(t.refs)}`);
    for (const c of t.children) walk(c, depth + 1);
  };
  for (const t of ex.items) walk(t, 0);
  for (const e of ex.examples) out.push(...exampleText(e, paint));
  return out.join('\n');
}

function exampleText(e: Example, paint: (code: string | undefined, s: string) => string): string[] {
  const out = [`  ${paint('1', e.title)}`];
  if (e.note) out.push(`    ${paint('90', e.note)}`);
  for (const s of e.sections) {
    out.push(`    ${paint('90', s.label)}`);
    for (const l of s.lines.length ? s.lines : [s.empty ?? '']) out.push(`      ${l}`);
  }
  return out;
}

/** Problems, one per line, as compilers print them. */
function issueText(name: string, i: DocumentIssue, color: boolean): string {
  const sev = i.severity === 'warning' ? (color ? '\x1b[33mwarning\x1b[0m' : 'warning') : (color ? '\x1b[34minfo\x1b[0m' : 'info');
  return `${name}:${i.startLine + 1}:${i.startCol + 1}: ${sev}: ${plain(i.message, { backticks: false })} [${i.code}]`;
}

/** A GitHub Actions workflow command, which shows the problem on the pull request's diff. */
function annotation(name: string, i: DocumentIssue): string {
  const data = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const prop = (s: string) => data(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
  const where = `file=${prop(name)},line=${i.startLine + 1},col=${i.startCol + 1},endLine=${i.endLine + 1},endColumn=${i.endCol + 1}`;
  // (A pitfall's title says so: the Action counts them apart.)
  return `::${i.severity === 'warning' ? 'warning' : 'notice'} ${where},title=${prop(`Bash Explainer${i.pitfall ? ' (pitfall)' : ''}: ${i.code}`)}::${data(plain(i.message, { backticks: false }))}`;
}

interface Problem { file: string; line: number; column: number; endLine: number; endColumn: number; severity: string; code: string; message: string }

/** SARIF 2.1.0, as code scanning (github/codeql-action/upload-sarif) reads it. */
function sarif(problems: Problem[]) {
  const codes = [...new Set(problems.map((p) => p.code))].sort();
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'Bash Explainer',
          version: __VERSION__,
          informationUri: 'https://github.com/sf624/bash-explainer',
          rules: codes.map((id) => ({ id, shortDescription: { text: id } })),
        },
      },
      results: problems.map((p) => ({
        ruleId: p.code,
        level: p.severity === 'warning' ? 'warning' : 'note',
        message: { text: p.message },
        locations: [{
          physicalLocation: {
            artifactLocation: { uri: p.file.replace(/\\/g, '/') },
            region: { startLine: p.line, startColumn: p.column, endLine: p.endLine, endColumn: p.endColumn },
          },
        }],
      })),
    }],
  };
}

/** Without what only the editor's views use: the examples' reruns, the ranges of the notes (for the part hover). */
const forJson = ({ anchors: _, ...ex }: LineExplanation) => ({ ...ex, examples: ex.examples.map(({ interactive: _i, ...e }) => e) });

// ---- Main -------------------------------------------------------------------------------------

export async function main(argv: string[], io: { stdout: (s: string) => void; stderr: (s: string) => void; env: NodeJS.ProcessEnv; isTTY: boolean }): Promise<number> {
  let o: ReturnType<typeof parseArgs>;
  let inputs: Input[];
  try {
    o = parseArgs(argv, io.env, io.isTTY);
    if (o === 'help') return io.stdout(HELP), 0;
    if (o === 'version') return io.stdout(`${__VERSION__}\n`), 0;
    for (const w of o.warnings) io.stderr(`bash-explainer: warning: ${w}\n`);
    if (o.printConfig) return io.stdout(`${JSON.stringify(settingsJson(o.settings, 'cli'), null, 2)}\n`), 0;
    inputs = readInputs(o);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    io.stderr(`bash-explainer: ${e.message}\nTry 'bash-explainer --help'.\n`);
    return 2;
  }

  const parser = createUnbashParser();
  const analyzer = new Analyzer(o.lang);
  const json: unknown[] = [];
  const chunks: string[] = [];
  // (GitHub shows only the first annotations of each kind in a step: those that fail the check come first.)
  const failing: string[] = [];
  let warnings = 0;

  for (const input of inputs) {
    const doc = openDocument(input.text, input.kind, (text) => parser.parse(text));
    const lines = doc.lines;
    const shells = shellsOf(lines, input.name, o.shell);

    if (o.check) {
      const issues = diagnosticsFor(() => doc, () => shells, o.lang, o.settings, 'cli').shown
        .filter((i) => !input.lines || (i.startLine + 1 >= input.lines[0] && i.startLine + 1 <= input.lines[1]))
        .sort((a, b) => a.startLine - b.startLine || a.startCol - b.startCol);
      // (A pitfall fails the check only with --strict: its warnings came later, and must not fail a CI that passed.)
      const fails = (i: DocumentIssue) => i.severity === 'warning' && (o.strict || !i.pitfall);
      warnings += issues.filter(fails).length;
      if (o.format === 'json' || o.format === 'sarif' || o.sarifFile !== undefined) json.push(...issues.map((i) => ({ file: input.name, line: i.startLine + 1, column: i.startCol + 1, endLine: i.endLine + 1, endColumn: i.endCol + 1, severity: i.severity, code: i.code, message: plain(i.message, { backticks: false }) })));
      if (o.format === 'github') for (const i of issues) (fails(i) ? failing : chunks).push(annotation(input.name, i));
      else if (o.format !== 'json' && o.format !== 'sarif') chunks.push(...issues.map((i) => issueText(input.name, i, o.color)));
    } else {
      const [from, to] = input.lines ?? [1, lines.length];
      if (to > lines.length) {
        io.stderr(`bash-explainer: ${input.name} has ${lines.length} lines\n`);
        return 2;
      }
      for (let line = from - 1; line < to; line++) {
        const ex = explainDocumentLine(analyzer, doc, line, o.lang, shells, explainOptions(o.settings));
        // Without an explicit range, lines with nothing to explain (blank, outside the shell code) are skipped.
        if (!input.lines && !ex.items.length && !ex.notes.length) continue;
        if (o.format === 'json') json.push({ file: input.name, line: line + 1, text: lines[line], explanation: forJson(ex) });
        else if (o.format === 'markdown') chunks.push(toPlainMarkdown(ex, lines[line], `${input.name}:${line + 1}`, o.lang).trimEnd());
        else chunks.push(textOutput(input.name, line, lines[line], ex, o.color, o.lang));
      }
    }
  }

  if (o.sarifFile !== undefined) {
    const text = JSON.stringify(sarif(json as Problem[]), null, 2) + '\n';
    try {
      fs.writeFileSync(o.sarifFile, text);
    } catch (e) {
      io.stderr(`bash-explainer: cannot write ${o.sarifFile}: ${(e as Error).message}\n`);
      return 2;
    }
  }
  if (o.format === 'json') io.stdout(JSON.stringify(json, null, 2) + '\n');
  else if (o.format === 'sarif') io.stdout(JSON.stringify(sarif(json as Problem[]), null, 2) + '\n');
  else if (o.format === 'github') chunks.unshift(...failing);
  if (o.format !== 'json' && o.format !== 'sarif' && chunks.length) io.stdout(chunks.join(o.check ? '\n' : o.format === 'markdown' ? '\n\n---\n\n' : '\n\n') + '\n');
  return o.check && warnings > 0 ? 1 : 0;
}

if (require.main === module && process.argv.includes('--lsp')) {
  // --stdio, which some editors add, is the only transport there is. --config names the settings file.
  const at = process.argv.findIndex((a) => a === '--config' || a.startsWith('--config='));
  const config = at < 0 ? undefined : process.argv[at].startsWith('--config=') ? process.argv[at].slice('--config='.length) : process.argv[at + 1];
  startLanguageServer({ input: process.stdin, output: process.stdout, env: process.env, version: __VERSION__, exit: (code) => process.exit(code), config });
} else if (require.main === module) {
  main(process.argv.slice(2), {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    env: process.env,
    isTTY: !!process.stdout.isTTY,
  }).then((code) => {
    process.exitCode = code;
  }, (e) => {
    process.stderr.write(`bash-explainer: ${e instanceof Error ? e.stack : e}\n`);
    process.exitCode = 2;
  });
}
