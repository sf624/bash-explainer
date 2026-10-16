// bash-explainer: explains shell scripts line by line in the terminal, and checks them for
// constructs their shell lacks. Offline, like the extension: nothing is sent anywhere.
import * as fs from 'fs';
import * as path from 'path';
import { Analyzer, Example, LineExplanation, Token } from '../src/analyzer';
import { detectShell, Shell, SHELL_NAMES } from '../src/dialect';
import { DocumentIssue, documentIssues, explainDocumentLine, ShellDocument } from '../src/document';
import { extractShell, HostKind, hostKind } from '../src/hosts';
import { Lang } from '../src/i18n';
import { createBashParser } from '../src/parser';
import { toPlainMarkdown } from '../src/ui/render';
import { startLanguageServer } from './lsp';

declare const __VERSION__: string;

type Kind = 'shell' | HostKind;
const KINDS: Kind[] = ['shell', 'dockerfile', 'makefile', 'yaml', 'npm', 'markdown', 'python'];
type Format = 'text' | 'markdown' | 'json';

const HELP = `Usage: bash-explainer [options] <file>[:<line>[-<line>]]...
       bash-explainer [options] -e '<command line>'
       cat script.sh | bash-explainer [options] -
       bash-explainer --lsp

Explains shell scripts line by line: every command, option, redirection and
expansion, with worked examples. Also reads the shell code in Dockerfiles,
Makefiles, CI YAML, package.json, Markdown and Python. Runs offline.

Options:
  -e, --command <text>   explain this command line
  -l, --line <n>[-<m>]   only these lines (also <file>:<n>[-<m>])
      --check            report constructs the script's shell lacks, and other
                         risks; exit 1 if there is a warning
      --shell <name>     the script's shell: ${Object.keys(SHELL_NAMES).join(', ')}
                         (default: from the shebang or the file name)
      --kind <kind>      what the file is: ${KINDS.join(', ')}
                         (default: from the file name)
      --lang <en|ja>     language (default: from LANG)
      --format <format>  text, markdown or json (default: text)
      --no-examples      leave out worked examples
      --color, --no-color  colour the text output (default: when a terminal)
      --lsp              run as a Language Server on standard input and output
                         (hover, diagnostics, quick fixes) for editors
  -h, --help             show this help
  -v, --version          show the version

Exit status: 0 when done (with --check: no warning), 1 with --check when there
is a warning, 2 on a usage or input error.
`;

class UsageError extends Error {}

interface Options {
  inputs: { spec: string; lines?: [number, number] }[];
  command?: string;
  lines?: [number, number];
  check: boolean;
  shell?: Shell;
  kind?: Kind;
  lang: Lang;
  format: Format;
  examples: boolean;
  color: boolean;
}

function parseRange(text: string): [number, number] {
  const m = /^(\d+)(?:-(\d+))?$/.exec(text);
  if (!m || +m[1] < 1) throw new UsageError(`not a line or line range: ${text}`);
  const from = +m[1];
  const to = m[2] ? +m[2] : from;
  if (to < from) throw new UsageError(`not a line range: ${text}`);
  return [from, to];
}

function defaultLang(env: NodeJS.ProcessEnv): Lang {
  const locale = env.LC_ALL || env.LC_MESSAGES || env.LANG || '';
  return locale.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv, isTTY: boolean): Options | 'help' | 'version' {
  const o: Options = { inputs: [], check: false, lang: defaultLang(env), format: 'text', examples: true, color: isTTY && !env.NO_COLOR };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
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
      case '--no-examples': o.examples = false; break;
      case '--color': o.color = true; break;
      case '--no-color': o.color = false; break;
      case '--shell': {
        const v = value();
        if (!(v in SHELL_NAMES)) throw new UsageError(`unknown shell: ${v} (${Object.keys(SHELL_NAMES).join(', ')})`);
        o.shell = v as Shell;
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
        o.lang = v;
        break;
      }
      case '--format': {
        const v = value();
        if (v !== 'text' && v !== 'markdown' && v !== 'json') throw new UsageError(`unknown format: ${v} (text, markdown, json)`);
        o.format = v;
        break;
      }
      default: {
        if (arg.startsWith('-') && arg !== '-') throw new UsageError(`unknown option: ${arg}`);
        // file:12 or file:3-8 (a real file whose name ends that way wins)
        const m = /^(.+):(\d+(?:-\d+)?)$/.exec(arg);
        if (m && !fs.existsSync(arg)) o.inputs.push({ spec: m[1], lines: parseRange(m[2]) });
        else o.inputs.push({ spec: arg });
      }
    }
  }
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
    const kind = o.kind ?? (input.spec === '-' ? 'shell' : hostKind('', input.spec) ?? 'shell');
    out.push({ name: input.spec, text: text.replace(/\r\n/g, '\n'), kind, lines: input.lines ?? o.lines });
  }
  return out;
}

// ---- Output -----------------------------------------------------------------------------------

const ANSI: Partial<Record<Token['kind'], string>> = {
  command: '34', builtin: '34', function: '34',
  option: '33', redirect: '33', pattern: '33',
  argument: '32', string: '32', number: '32',
  operator: '35', keyword: '35', block: '35', test: '35',
  variable: '31', expansion: '31', substitution: '31', assignment: '31',
  comment: '90', error: '91',
};

function textOutput(name: string, line: number, lineText: string, ex: LineExplanation, color: boolean): string {
  const paint = (code: string | undefined, s: string) => (color && code ? `\x1b[${code}m${s}\x1b[0m` : s);
  const out: string[] = [`${paint('1', `${name}:${line + 1}`)}  ${lineText.trim()}`];
  for (const c of ex.context) out.push(`  ${paint('90', `› ${c.label} (${c.line + 1})`)}`);
  for (const n of ex.notes) out.push(`  ${n}`);
  const walk = (t: Token, depth: number) => {
    out.push(`${'  '.repeat(depth + 1)}${paint(ANSI[t.kind], t.label.replace(/\s*\n\s*/g, ' ⏎ '))}  ${t.explanation.replace(/`/g, '')}`);
    for (const c of t.children) walk(c, depth + 1);
  };
  for (const t of ex.items) walk(t, 0);
  for (const e of ex.examples) out.push(...exampleText(e, paint));
  return out.join('\n');
}

function exampleText(e: Example, paint: (code: string | undefined, s: string) => string): string[] {
  const out = [`  ${paint('1', e.title)}`];
  for (const s of e.sections) {
    out.push(`    ${paint('90', s.label)}`);
    for (const l of s.lines.length ? s.lines : [s.empty ?? '']) out.push(`      ${l}`);
  }
  return out;
}

/** Problems, one per line, as compilers print them. */
function issueText(name: string, i: DocumentIssue, color: boolean): string {
  const sev = i.severity === 'warning' ? (color ? '\x1b[33mwarning\x1b[0m' : 'warning') : (color ? '\x1b[34minfo\x1b[0m' : 'info');
  return `${name}:${i.startLine + 1}:${i.startCol + 1}: ${sev}: ${plain(i.message)} [${i.code}]`;
}

const plain = (message: string) => message.replace(/^[⚠ℹ]️?\s*/u, '').replace(/`/g, '');

/** Examples without what only the panel uses. */
const forJson = (ex: LineExplanation) => ({ ...ex, examples: ex.examples.map(({ interactive: _, ...e }) => e) });

// ---- Main -------------------------------------------------------------------------------------

export async function main(argv: string[], io: { stdout: (s: string) => void; stderr: (s: string) => void; env: NodeJS.ProcessEnv; isTTY: boolean }): Promise<number> {
  let o: ReturnType<typeof parseArgs>;
  let inputs: Input[];
  try {
    o = parseArgs(argv, io.env, io.isTTY);
    if (o === 'help') return io.stdout(HELP), 0;
    if (o === 'version') return io.stdout(`${__VERSION__}\n`), 0;
    inputs = readInputs(o);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    io.stderr(`bash-explainer: ${e.message}\nTry 'bash-explainer --help'.\n`);
    return 2;
  }

  const parser = await createBashParser({ runtimeDir: __dirname, bashWasm: path.join(__dirname, 'tree-sitter-bash.wasm') });
  const analyzer = new Analyzer(o.lang);
  const json: unknown[] = [];
  const chunks: string[] = [];
  let warnings = 0;

  for (const input of inputs) {
    const lines = input.text.split('\n');
    let doc: ShellDocument;
    if (input.kind === 'shell') {
      doc = { lines, tree: parser.parse(input.text) };
    } else {
      const extracted = extractShell(input.kind, input.text);
      doc = { lines, extracted, tree: parser.parse(extracted.text) };
    }
    const shells = { forced: o.shell, detected: detectShell(lines.slice(0, 50).join('\n'), input.name) };

    if (o.check) {
      const issues = documentIssues(doc, o.lang, shells).filter((i) => !input.lines || (i.startLine + 1 >= input.lines[0] && i.startLine + 1 <= input.lines[1]));
      warnings += issues.filter((i) => i.severity === 'warning').length;
      if (o.format === 'json') json.push(...issues.map((i) => ({ file: input.name, line: i.startLine + 1, column: i.startCol + 1, endLine: i.endLine + 1, endColumn: i.endCol + 1, severity: i.severity, code: i.code, message: plain(i.message) })));
      else chunks.push(...issues.map((i) => issueText(input.name, i, o.color)));
    } else {
      const [from, to] = input.lines ?? [1, lines.length];
      if (to > lines.length) {
        io.stderr(`bash-explainer: ${input.name} has ${lines.length} lines\n`);
        return 2;
      }
      for (let line = from - 1; line < to; line++) {
        const ex = explainDocumentLine(analyzer, doc, line, o.lang, shells, { examples: { enabled: o.examples, disabled: [] } });
        // Without an explicit range, lines with nothing to explain (blank, outside the shell code) are skipped.
        if (!input.lines && !ex.items.length && !ex.notes.length) continue;
        if (o.format === 'json') json.push({ file: input.name, line: line + 1, text: lines[line], explanation: forJson(ex) });
        else if (o.format === 'markdown') chunks.push(toPlainMarkdown(ex, lines[line], `${input.name}:${line + 1}`).trimEnd());
        else chunks.push(textOutput(input.name, line, lines[line], ex, o.color));
      }
    }
    doc.tree.delete();
  }

  if (o.format === 'json') io.stdout(JSON.stringify(json, null, 2) + '\n');
  else if (chunks.length) io.stdout(chunks.join(o.check ? '\n' : o.format === 'markdown' ? '\n\n---\n\n' : '\n\n') + '\n');
  return o.check && warnings > 0 ? 1 : 0;
}

if (require.main === module && process.argv.includes('--lsp')) {
  // --stdio, which some editors add, is the only transport there is.
  startLanguageServer({ input: process.stdin, output: process.stdout, env: process.env, version: __VERSION__, exit: (code) => process.exit(code) });
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
