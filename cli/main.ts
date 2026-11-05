// bash-explainer: explains shell scripts line by line in the terminal, and checks them for
// constructs their shell lacks. Offline, like the extension: nothing is sent anywhere.
import * as fs from 'fs';
import { Analyzer, Example, LineExplanation, Token } from '../src/analyzer';
import { controlsShown, jsonText, oneLine, pictureText } from '../src/ctlchars';
import { BASH_VERSIONS, type BashVersion, DEFAULT_BASH_VERSION } from '../src/bashversion';
import { Shell, SHELL_NAMES } from '../src/dialect';
import { DocumentIssue, diagnosticsFor, explainDocumentLine, plain } from '../src/document';
import { contained, failuresGoTo, loggedOnce, stackFull } from '../src/failures';
import { FILE_KINDS, FileKind, openDocument, shellsOf } from '../src/document-setup';
import { hostKind } from '../src/hosts';
import { Lang, resolveLang } from '../src/i18n';
import { failsCheck, LEVELS, type ProblemSeverity, problemLevel, SEVERITIES } from '../src/levels';
import { joinParts, labelParts, PLACEHOLDER_CLOSE, PLACEHOLDER_OPEN } from '../src/label';
import { explainOptions, forcedShell, mergeSettings, parseAssignment, readSettings, Settings, settingsJson } from '../src/settings';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { noteBasis, noteRefs, notesByLevel, refsText, toPlainMarkdown, wordsMarkdown } from '../src/ui/render';
import { type NoteBasis, rowPlain, tokenRow } from '../src/ui/tokenRow';
import { ui } from '../src/ui/texts';
import { startLanguageServer } from './lsp';
import { readSettingsFile, settingsFile, SettingsFileError } from './settings-file';
import { pushAll } from '../src/lists';
import { fact } from '../src/messages';
import { isNotRead } from '../src/messages-unread';

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
      --check            report errors (lines that fail every time, constructs
                         the script's shell lacks), warnings and other caveats;
                         exit 1 if there is an error
      --strict           with --check, also exit 1 on a warning
      --counts <file>    with --check, also append the numbers of problems to
                         this file, as $GITHUB_OUTPUT reads them: errors=,
                         warnings=, infos=, pitfalls= and failing= (those that
                         make the exit status 1)
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

Exit status: 0 when done (with --check: no error), 1 with --check when there
is an error (with --strict, also a warning), 2 on a usage or input error.
`;

class UsageError extends Error {}

interface Options {
  /** After `--`, a name is a file's (`file`), whatever it looks like: `-` is not standard input. */
  inputs: { spec: string; lines?: [number, number]; file?: boolean }[];
  command?: string;
  lines?: [number, number];
  check: boolean;
  /** With --check: the warnings fail it too. */
  strict: boolean;
  /** With --check: also append the numbers of problems to this file, as name=value lines. */
  countsFile?: string;
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
  /** Run as a Language Server; `config` names its settings file. */
  lsp: boolean;
  config?: string;
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
    inputs: [], check: false, strict: false, lang: 'en', format: 'text', color: isTTY && !env.NO_COLOR, settings: mergeSettings(), warnings: [], printConfig: false, lsp: false,
  };
  let config: string | undefined;
  let noConfig = false;
  const sets: Record<string, unknown> = {};
  /** The settings the dedicated options set, which win over the file and --set. */
  const flags: Partial<Settings> = {};
  let unknown: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // Everything after -- is a file, even if it starts with -.
    if (arg === '--') {
      pushAll(o.inputs, argv.slice(i + 1).map((spec) => ({ spec, file: true })));
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
      case '--lsp': o.lsp = true; break;
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
      case '--counts': o.countsFile = value(); break;
      case '--sarif':
        o.sarifFile = value();
        if (o.sarifFile === '-') throw new UsageError('--sarif needs a file, not - (use --format sarif for standard output)');
        break;
      default: {
        if (arg.startsWith('-') && arg !== '-') {
          unknown ??= arg;
          break;
        }
        // file:12 or file:3-8 (a real file whose name ends that way wins)
        const m = /^(.+):(\d+(?:-\d+)?)$/.exec(arg);
        if (m && !fs.existsSync(arg)) o.inputs.push({ spec: m[1], lines: parseRange(m[2]) });
        else o.inputs.push({ spec: arg });
      }
    }
  }
  // (A Language Server takes what editors add, as --stdio, the only transport there is.)
  if (o.lsp) return { ...o, config };
  if (unknown !== undefined) throw new UsageError(`unknown option: ${unknown}`);
  if ((o.format === 'sarif' || o.format === 'github') && !o.check) throw new UsageError(`--format ${o.format} goes with --check`);
  if (o.sarifFile !== undefined && !o.check) throw new UsageError('--sarif goes with --check');
  if (o.countsFile !== undefined && !o.check) throw new UsageError('--counts goes with --check');
  if (o.strict && !o.check) throw new UsageError('--strict goes with --check');
  // defaults < settings file < --set < --lang, --shell, --bash-version, --no-examples
  const file = noConfig ? undefined : settingsFile(config, env);
  let fromFile: Partial<Settings> = {};
  if (file) {
    try {
      const read = readSettingsFile(file);
      fromFile = read.settings;
      pushAll(o.warnings, read.warnings);
    } catch (e) {
      if (!(e instanceof SettingsFileError)) throw e;
      throw new UsageError(e.message);
    }
  }
  const set = readSettings(sets, '--set');
  pushAll(o.warnings, set.warnings);
  o.settings = mergeSettings(fromFile, set.settings, flags);
  o.lang = resolveLang(o.settings.language, locale(env));
  o.shell = forcedShell(o.settings);
  if (o.printConfig) return o;
  if (!o.inputs.length && o.command === undefined) throw new UsageError('nothing to explain: give a file, - for standard input, or -e <command line>');
  return o;
}

// ---- Documents --------------------------------------------------------------------------------

interface Input {
  /** The file name, "-" or "(command)". */
  name: string;
  /** The name as the outputs for reading show it. */
  shown: string;
  text: string;
  kind: Kind;
  lines?: [number, number];
  /** Read from standard input: a script by what is given, as a file named `.sh` is (`ScriptEvidence`). */
  stdin?: boolean;
}

function readInputs(o: Options): Input[] {
  const out: Input[] = [];
  if (o.command !== undefined) out.push({ name: '(command)', shown: '(command)', text: o.command, kind: o.kind ?? 'shell', lines: o.lines });
  for (const input of o.inputs) {
    const stdin = input.spec === '-' && !input.file;
    let text: string;
    try {
      text = stdin ? fs.readFileSync(0, 'utf8') : fs.readFileSync(input.spec, 'utf8');
    } catch (e) {
      throw new UsageError(`cannot read ${oneLine(input.spec)}: ${(e as NodeJS.ErrnoException).code ?? e}`);
    }
    const kind = o.kind ?? (stdin ? 'shell' : hostKind('', input.spec, text) ?? 'shell');
    // A shell script keeps its CRs: the parser reads them as blanks and the check warns about them.
    out.push({ name: input.spec, shown: oneLine(input.spec), text: kind === 'shell' ? text : text.replace(/\r\n/g, '\n'), kind, lines: input.lines ?? o.lines, ...(stdin ? { stdin } : {}) });
  }
  return out;
}

// ---- Output -----------------------------------------------------------------------------------

/**
 * What stands for the start of a colour sequence (ESC [) until `shown` has written out the control characters of the text. It is
 * made anew in each run, so no script holds it, nor any text an explanation derives from one.
 */
const COLOUR_MARK = `\u{E000}${Math.random().toString(36).slice(2)}\u{E001}`;
const sgr = (code: string) => `${COLOUR_MARK}${code}m`;

/**
 * All that main writes to standard output and standard error passes here: what it reads from a script, a file name or an
 * argument can hold control characters, which must not reach the terminal as they are. Only the tool's own colours do.
 */
const shown = (text: string) => controlsShown(text).split(COLOUR_MARK).join('\x1b[');

/**
 * What GitHub's runner reads as a command anywhere in a line it logs, written as `##\[`: for the outputs for reading (text,
 * Markdown, standard error). JSON and SARIF are data, and annotations are commands themselves.
 */
const forLog = (text: string) => text.replace(/##\[/g, '##\\[');

const ANSI: Partial<Record<Token['kind'], string>> = {
  // (The shebang as the program it names, as the panel draws it.)
  command: '34', subcommand: '34', builtin: '34', function: '34', alias: '34', shebang: '34',
  option: '33', redirect: '33', pattern: '33',
  argument: '32', string: '32', number: '32',
  operator: '35', keyword: '35', block: '35', test: '35',
  variable: '31', expansion: '31', substitution: '31', assignment: '31',
  comment: '90', error: '91',
};

function textOutput(name: string, line: number, lineText: string, ex: LineExplanation, color: boolean, lang: Lang): string {
  const paint = (code: string | undefined, s: string) => (color && code ? `${sgr(code)}${s}${sgr('0')}` : s);
  // The references a row cites, dim: " (Bash manual 3.7.2)", " (Bash manual 3.8, 3.1.3; execve(2))".
  const refs = (r: readonly string[] | undefined) => (r?.length ? paint('90', refsText(lang, r)) : '');
  const out: string[] = [`${paint('1', `${name}:${line + 1}`)}  ${lineText.trim()}`];
  // (Where a note or a row rests on bash's behaviour: the chip's words, dim, then the try-it and its output, under it.)
  const based = (basis: NoteBasis | undefined, indent: string) => {
    if (basis) {
      out.push(`${indent}${paint('90', `[${basis.label}]`)}`, `${indent}${paint('90', `${ui[lang].panel.tryIt}:`)} ${basis.tryIt.code}`,
        ...basis.tryIt.output.split('\n').map((l) => `${indent}  ${paint('90', l)}`));
    }
  };
  for (const c of ex.context) out.push(`  ${paint('90', `› ${c.label} (${c.line + 1})`)}`);
  // A note's mark and word in the colour of its level (the level table), as the problems print theirs.
  for (const { text: n, level, body } of notesByLevel(ex)) {
    const head = n.slice(0, n.length - body.length).trimEnd();
    const { ansi, bold } = LEVELS[level];
    const shown = head ? `${paint(ansi, bold ? paint('1', head) : head)} ${pictureText(body)}` : pictureText(body);
    out.push(`  ${shown}${refs(noteRefs(ex, n))}`);
    based(noteBasis(ex, n, lang), '    ');
  }
  const walk = (t: Token, depth: number) => {
    const r = tokenRow(t, lang);
    // Code parts in the colour of the kind; a placeholder in italics and dim (or ‹name› when there is no colour).
    const label = joinParts(r.labelParts, (p) => (p.placeholder
      ? (color ? `${sgr('2;3')}${p.text}${sgr('0')}` : `${PLACEHOLDER_OPEN}${p.text}${PLACEHOLDER_CLOSE}`)
      : paint(ANSI[r.kind], p.text.replace(/\s*\n\s*/g, ' ⏎ '))));
    out.push(`${'  '.repeat(depth + 1)}${label}  ${rowPlain(r).replace(/`/g, '')}${refs(r.refs)}`);
    // (The value of an expansion where it runs, on a line of its own: its backticks are kept, as they mark where each word starts and ends.)
    if (r.value) out.push(`${'  '.repeat(depth + 2)}${paint('90', '=')} ${pictureText(r.value.said.text)}`);
    based(r.basis, '  '.repeat(depth + 2));
    for (const c of t.children) walk(c, depth + 1);
  };
  for (const t of ex.items) walk(t, 0);
  for (const e of ex.examples) pushAll(out, exampleText(e, paint));
  return out.join('\n');
}

function exampleText(e: Example, paint: (code: string | undefined, s: string) => string): string[] {
  const out = [`  ${paint('1', e.title)}`];
  if (e.note) out.push(`    ${paint('90', pictureText(e.note))}`);
  for (const s of e.sections) {
    out.push(`    ${paint('90', s.label)}`);
    // (The words of a brace expansion on one line, each in backticks, so that they read as separate words, not lines of output.)
    if (s.words) out.push(`      ${wordsMarkdown(s)}`);
    else for (const l of s.lines.length ? s.lines : [s.empty ?? '']) out.push(`      ${pictureText(l)}`);
  }
  return out;
}

/** Problems, one per line, as compilers print them. */
function issueText(name: string, i: DocumentIssue, color: boolean): string {
  const { word } = SEVERITIES[i.severity];
  const sev = color ? `${sgr(problemLevel(i.severity).ansi)}${word}${sgr('0')}` : word;
  return `${name}:${i.startLine + 1}:${i.startCol + 1}: ${sev}: ${oneLine(plain(i.message, { backticks: false }))} [${i.code}]`;
}

/** A GitHub Actions workflow command, which shows the problem on the pull request's diff. */
function annotation(name: string, i: DocumentIssue): string {
  const data = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const prop = (s: string) => data(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
  const where = `file=${prop(name)},line=${i.startLine + 1},col=${i.startCol + 1},endLine=${i.endLine + 1},endColumn=${i.endCol + 1}`;
  // (A pitfall's title says so: the Action counts them apart.)
  return `::${SEVERITIES[i.severity].github} ${where},title=${prop(`Bash Explainer${i.pitfall ? ' (pitfall)' : ''}: ${i.code}`)}::${data(plain(i.message, { backticks: false }))}`;
}

interface Problem { file: string; line: number; column: number; endLine: number; endColumn: number; severity: ProblemSeverity; code: string; message: string }

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
        level: SEVERITIES[p.severity].sarif,
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

/** A token and those under it, without what only the panel and the reading tree read and may change with it: its frame, what it stands around, its depth hint, the word `[` and the stage's name. */
const tokenForJson = ({ frame: _, around: _a, plain: _p, nameWord: _n, stage: _s, ...t }: Token): Omit<Token, 'frame' | 'around' | 'plain' | 'nameWord' | 'stage' | 'children'> & { children: unknown[] } => ({ ...t, children: t.children.map(tokenForJson) });

/** Without what only the editor's views use: the examples' reruns, the ranges of the notes (for the part hover). */
// (The anchors and the notes' data are for the views: the JSON keeps what it had, the notes and the facts' ids, with
// what a fact rests on where it is not the manual, and its try-it: docs/design/basis.md.)
const forJson = ({ anchors: _, noteInfo: _n, ...ex }: LineExplanation) => ({
  ...ex,
  items: ex.items.map(tokenForJson),
  ...(ex.facts ? { facts: ex.facts.map(({ id, kind, level, text, refs, basis, tryIt, convention }) => ({ id, kind, level, text, refs, ...(basis ? { basis } : {}), ...(tryIt ? { tryIt } : {}), ...(convention ? { convention } : {}) })) } : {}),
  examples: ex.examples.map(({ interactive: _i, ...e }) => e),
});

/**
 * Writes a file the options name, in place, and not through a symbolic link at its name (O_NOFOLLOW, which Windows lacks; the
 * link stays as it is). In place, as both kinds of write need: --counts adds to its file, and a device such as /dev/null stays one.
 */
function writeOwn(file: string, text: string, flags: number, stderr: (s: string) => void): boolean {
  try {
    const fd = fs.openSync(file, flags | (fs.constants.O_NOFOLLOW ?? 0), 0o666);
    try {
      fs.writeFileSync(fd, text);
    } finally {
      fs.closeSync(fd);
    }
    return true;
  } catch (e) {
    // (Node's message names the file too.)
    const why = (e as NodeJS.ErrnoException).code === 'ELOOP' ? 'it is a symbolic link' : (e as Error).message;
    stderr(oneLine(`bash-explainer: cannot write ${file}: ${why}`) + '\n');
    return false;
  }
}

// ---- Main -------------------------------------------------------------------------------------

export async function main(argv: string[], streams: { stdout: (s: string) => void; stderr: (s: string) => void; env: NodeJS.ProcessEnv; isTTY: boolean; startLsp?: (config: string | undefined) => void }): Promise<number> {
  const io = { ...streams, stdout: (s: string) => streams.stdout(shown(s)), stderr: (s: string) => streams.stderr(forLog(shown(s))) };
  let o: ReturnType<typeof parseArgs>;
  let inputs: Input[];
  try {
    o = parseArgs(argv, io.env, io.isTTY);
    if (o === 'help') return io.stdout(HELP), 0;
    if (o === 'version') return io.stdout(`${__VERSION__}\n`), 0;
    if (o.lsp) return io.startLsp?.(o.config), 0;
    for (const w of o.warnings) io.stderr(`bash-explainer: warning: ${w}\n`);
    if (o.printConfig) return io.stdout(`${jsonText(settingsJson(o.settings, 'cli'), 2)}\n`), 0;
    inputs = readInputs(o);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    io.stderr(`bash-explainer: ${e.message}\nTry 'bash-explainer --help'.\n`);
    return 2;
  }

  const parser = createUnbashParser();
  const analyzer = new Analyzer(o.lang);
  const json: unknown[] = [];
  let chunks: string[] = [];
  // (GitHub shows only the first annotations of each kind in a step: those that fail the check come first.)
  const failing: string[] = [];
  // (What --counts writes: the problems by severity, the pitfalls, and those that fail the check.)
  const counts: Record<string, number> = { ...Object.fromEntries(Object.values(SEVERITIES).filter((s) => !s.faded).map((s) => [s.count, 0])), pitfalls: 0, failing: 0 };

  // (A bug a boundary contained, src/failures.ts: the output goes on with what can be said, standard error tells it, and the
  // exit status is 2, as when the tool stops: it is no finding about the script, and a check that could not read a line has not passed.)
  let failed = 0;
  /** The files the parser could not follow (`SyntaxTree.unread`), or with a line no walk could follow (`line-too-deep`): no bug, but they were not all read. */
  let unread = 0;
  /** A line range past the end of its file, which stops the files after it. */
  let badRange = false;
  let file = '';
  const log = loggedOnce((text) => io.stderr(`bash-explainer: ${file}: ${text}\n`));
  const before = failuresGoTo((f) => {
    failed++;
    log(f);
  });
  // (The explanation of a line goes out when it is made: all the lines of a long file may not fit in a string, or in the memory.)
  const between = o.check ? '\n' : o.format === 'markdown' ? '\n\n---\n\n' : '\n\n';
  let wrote = false;
  const write = () => {
    if (!chunks.length) return;
    const text = (wrote ? between : '') + chunks.join(between);
    chunks = [];
    wrote = true;
    io.stdout(o.format === 'github' ? text : forLog(text));
  };
  let rows = 0;
  const writeRow = (row: unknown) => {
    // (The text first: a row that fails to print leaves no comma or bracket behind.)
    const text = jsonText(row, 2).replace(/\n/g, '\n  ');
    io.stdout(`${rows++ ? ',\n' : '[\n'}  ${text}`);
  };
  try {
    for (const input of inputs) {
      file = input.shown;
      const doc = openDocument(input.text, input.kind, (text) => parser.parse(text));
      const lines = doc.lines;
      const shells = shellsOf(lines, input.name, o.shell, o.command !== undefined ? 'said' : o.kind !== undefined || input.stdin ? 'name' : undefined);
      // (Said once for a file, however many lines say it.)
      let notRead = !!doc.tree.unread;
      // (A file not read says so once, on its first line, not on each.)
      const [from, to] = doc.tree.unread ? [input.lines?.[0] ?? 1, input.lines?.[0] ?? 1] : input.lines ?? [1, lines.length];
      if (!o.check && to > lines.length) {
        io.stderr(`bash-explainer: ${input.shown} has ${lines.length} lines\n`);
        // (What was streamed before it is complete: the array is closed below, and the status says that the rest was not read.)
        badRange = true;
        break;
      }

      // (The boundary of a file: a bug in what it prints leaves the other files.)
      contained(`the file ${input.shown}`, () => {
        if (o.check) {
          const issues = diagnosticsFor(() => doc, () => shells, o.lang, o.settings, 'cli').shown
            .filter((i) => !input.lines || isNotRead(i.code) || (i.startLine + 1 >= input.lines[0] && i.startLine + 1 <= input.lines[1]))
            .sort((a, b) => a.startLine - b.startLine || a.startCol - b.startCol);
          // (An error fails the check, a warning only with --strict: the level table, src/levels.ts.)
          const fails = (i: DocumentIssue) => failsCheck(i.severity, o.strict);
          for (const i of issues) {
            // (No finding about the script: no count holds it, and the status says it.)
            if (isNotRead(i.code)) {
              notRead = true;
              continue;
            }
            counts[SEVERITIES[i.severity].count]++;
            if (i.pitfall) counts.pitfalls++;
            if (fails(i)) counts.failing++;
          }
          if (o.format === 'json' || o.format === 'sarif' || o.sarifFile !== undefined) pushAll(json, issues.map((i) => ({ file: input.name, line: i.startLine + 1, column: i.startCol + 1, endLine: i.endLine + 1, endColumn: i.endCol + 1, severity: i.severity, code: i.code, message: plain(i.message, { backticks: false }), ...(i.convention && o.settings['notes.basis'] !== false ? { convention: i.convention } : {}) })));
          if (o.format === 'github') for (const i of issues) (fails(i) || isNotRead(i.code) ? failing : chunks).push(annotation(input.shown, i));
          else if (o.format !== 'json' && o.format !== 'sarif') pushAll(chunks, issues.map((i) => issueText(input.shown, i, o.color)));
        } else {
          for (let line = from - 1; line < to; line++) {
            const ex = explainDocumentLine(analyzer, doc, line, o.lang, shells, explainOptions(o.settings));
            if (ex.noteInfo.some((n) => isNotRead(n.code))) notRead = true;
            // Without an explicit range, lines with nothing to explain (blank, outside the shell code) are skipped.
            if (!input.lines && !ex.items.length && !ex.notes.length) continue;
            if (o.format === 'json') writeRow({ file: input.name, line: line + 1, text: lines[line], explanation: forJson(ex) });
            else if (o.format === 'markdown') chunks.push(toPlainMarkdown(ex, lines[line], `${input.shown}:${line + 1}`, o.lang).trimEnd());
            // (A file not read says so, without its first line, which may be all of it.)
          else if (doc.tree.unread) chunks.push(`${input.shown}: ${ex.notes[0]}`);
          else chunks.push(textOutput(input.shown, line, lines[line], ex, o.color, o.lang));
            write();
          }
        }
      }, (e) => {
        if (stackFull(e)) notRead = true;
        chunks.push(`${input.shown}: ${fact(o.lang, 'file-not-read', { why: stackFull(e) ? 'too-deep' : 'failed' }).text}`);
      });
      if (notRead) unread++;
    }
  } finally {
    failuresGoTo(before);
  }

  if (o.sarifFile !== undefined) {
    const text = jsonText(sarif(json as Problem[]), 2) + '\n';
    if (!writeOwn(o.sarifFile, text, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC, io.stderr)) return 2;
  }
  if (o.countsFile !== undefined) {
    const text = Object.entries(counts).map(([k, n]) => `${k}=${n}\n`).join('');
    if (!writeOwn(o.countsFile, text, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND, io.stderr)) return 2;
  }
  if (o.format === 'json') io.stdout(o.check ? jsonText(json, 2) + '\n' : rows ? '\n]\n' : '[]\n');
  else if (o.format === 'sarif') io.stdout(jsonText(sarif(json as Problem[]), 2) + '\n');
  else if (o.format === 'github') chunks = [...failing, ...chunks];
  if (o.format !== 'json' && o.format !== 'sarif') {
    write();
    if (wrote) io.stdout('\n');
  }
  if (unread) io.stderr(`bash-explainer: ${unread} file${unread === 1 ? '' : 's'} could not be read in full: the output says where.\n`);
  if (failed) {
    io.stderr(`bash-explainer: ${failed} internal error${failed === 1 ? '' : 's'}: what they stopped is missing from the output. This is a bug of the tool, not a problem of the script: please report it.\n`);
  }
  if (failed || unread || badRange) return 2;
  return o.check && counts.failing > 0 ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2), {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    env: process.env,
    isTTY: !!process.stdout.isTTY,
    startLsp: (config) => startLanguageServer({ input: process.stdin, output: process.stdout, env: process.env, version: __VERSION__, exit: (code) => process.exit(code), config }),
  }).then((code) => {
    process.exitCode = code;
  }, (e) => {
    process.stderr.write(forLog(shown(`bash-explainer: ${e instanceof Error ? e.stack : e}\n`)));
    process.exitCode = 2;
  });
}
