// What real shells say of a script they cannot read (`tool -n`), and whether what we say of it is the same: for
// test/syntax-error.test.ts and test/syntax-mutations.test.ts. Each table runs in one process, a file each, as a script is read.
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { SyntaxErrorWhat } from '../../src/syntax/tree';
import { runContained } from './contained';

/** What `tool -n` says of a script: its whole stderr, and its status. */
export interface ShellSaid { message: string; status: number }

const LOOP = (n: number) => `i=0; while [ "$i" -lt ${n} ]; do "$1" -n "$i" 2>&1; printf '\\036%s\\036' "$?"; i=$((i+1)); done`;
const SAID = /([^\x1e]*)\x1e(\d+)\x1e/g;

function inDirectory<T>(scripts: readonly string[], run: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-syntax-'));
  scripts.forEach((s, i) => fs.writeFileSync(path.join(dir, String(i)), s));
  return run(dir);
}

const parsed = (out: string, scripts: readonly string[], tool: string): ShellSaid[] => {
  const said = [...out.matchAll(SAID)].map((m) => ({ message: m[1], status: Number(m[2]) }));
  if (said.length !== scripts.length) throw new Error(`${tool}: ${said.length} answers for ${scripts.length} scripts`);
  return said;
};

/** What `tool -n` says of each script. */
export function shellSays(tool: string, scripts: readonly string[]): ShellSaid[] {
  return inDirectory(scripts, (dir) => {
    try {
      return parsed(spawnSync('bash', ['-c', LOOP(scripts.length), 'loop', tool], { encoding: 'utf8', maxBuffer: 1 << 26, cwd: dir }).stdout, scripts, tool);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

/** The same in a cgroup, and killed as a whole when it outlives `ms`: for a table generated from others. */
export async function shellSaysContained(tool: string, scripts: readonly string[], ms: number): Promise<ShellSaid[]> {
  const dir = inDirectory(scripts, (d) => d);
  try {
    return parsed((await runContained(['bash', '-c', LOOP(scripts.length), 'loop', tool], dir, {}, ms)).stdout, scripts, tool);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** What stops bash where no word is wanted: it names no word then. */
const NO_WORD = /^(?:newline|[()|&;<>-]+|then|do|done|fi|else|elif|esac|in|}|\]\])$/;

/** Whether what the fault says agrees with bash's message, on line `row` from 0; undefined if it says nothing that can be compared. */
export function agreesWithBash(what: SyntaxErrorWhat, message: string, row?: number): boolean | undefined {
  const near = /near (?:unexpected token )?`([^]*?)'(?: while looking for matching `.')?$/m.exec(message)?.[1];
  const atEnd = /unexpected end of file/.test(message);
  const line = /line (\d+): syntax error near/.exec(message)?.[1];
  switch (what.kind) {
    case 'token': case 'after-paren': return near === what.token && (row === undefined || Number(line) === row + 1);
    // (A heredoc's delimiter it says it wanted; else the end of the file, or the closing it looks for.)
    case 'missing': return atEnd || message.includes(`wanted \`${what.token}'`) || what.token.endsWith(/matching `(.)'/.exec(message)?.[1] ?? '\0');
    // (No token is named, but what they say has none to stand on: the shell stops where a word is wanted, not on a word.)
    case 'after': case 'command': case 'target': case 'heredoc': case 'body': return atEnd || NO_WORD.test(near ?? '');
    default: return undefined;
  }
}

/** The same with dash's: it names a token as bash does, or says `word` for any word. */
export function agreesWithDash(what: SyntaxErrorWhat, message: string, row?: number): boolean | undefined {
  const said = /Syntax error: (.*)$/m.exec(message)?.[1] ?? '';
  const line = /: (\d+): Syntax error/.exec(message)?.[1];
  const here = row === undefined || Number(line) === row + 1;
  switch (what.kind) {
    // (After `word (` any word is a word to dash, a reserved one too.)
    case 'after-paren': return here && (said.startsWith(`"${what.token}" unexpected`) || said.startsWith('word unexpected'));
    case 'token': return here && (said.startsWith(`"${what.token}" unexpected`) || (said.startsWith('word unexpected') && !/^(?:[()|&;]|then|do|done|fi|else|elif|esac|in)/.test(what.token)));
    case 'missing': return /end of file unexpected|Unterminated|Missing/.test(message);
    case 'after': case 'command': case 'target': case 'heredoc': case 'body': return said !== '' && !said.startsWith('word unexpected');
    default: return undefined;
  }
}
