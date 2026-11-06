// Whether GNU make runs a recipe line with no shell. The rule is make's own (job.c, `construct_command_argv_internal`,
// measured with GNU make 4.3: test/make-real.test.ts compares it with the real make, run as a separate program):
// make reads the line itself, as words, when it holds none of the characters a shell would read (`;`, `"`, `$`, `|`,
// `#`, `*`, …) outside single quotes and its first word is not the name of a shell builtin of make's list; it then
// runs the program directly. Anything else goes to `/bin/sh -c`.
import { isMakeAutomatic } from '../messages-hosts';

/**
 * The characters that send a line to the shell when make finds one outside single quotes and not escaped with a
 * backslash. (A single quote is not among them: make reads single-quoted text itself.)
 */
const SHELL_CHARS = new Set('#;"*?[]&|<>(){}$`^~!');

/**
 * The first words that send a line to the shell, whatever else it holds: make's list of the builtins and keywords a
 * shell must run itself (`cd`, `export`, `if`, `test`…). `echo`, `printf`, `true`, `pwd`, `kill`, `source` and `time` are
 * not in it, so make runs them as programs.
 */
const SHELL_COMMANDS: ReadonlySet<string> = new Set([
  '.', ':', 'alias', 'bg', 'break', 'case', 'cd', 'command', 'continue', 'eval', 'exec', 'exit', 'export', 'fc', 'fg',
  'for', 'getopts', 'hash', 'if', 'jobs', 'login', 'logout', 'read', 'readonly', 'return', 'set', 'shift', 'test',
  'times', 'trap', 'type', 'ulimit', 'umask', 'unalias', 'unset', 'wait', 'while',
]);

/**
 * How make runs a recipe line: `shell` (through `/bin/sh -c`), `direct` (the program, with the words make read), or
 * `maybe` (it holds a make variable whose value decides: make expands it first, then looks at the text). `first` is the
 * first word of a `maybe` line when it is plain text.
 */
export type RecipeRun =
  | { run: 'shell' }
  | { run: 'direct'; /** The words of the program, undefined for one with a file name (`$@`) in it. */ words: (string | undefined)[] }
  | { run: 'maybe'; first?: string };

/** What make expands in the text of a line, in order: a character, or a variable or function it replaces by text. */
type Piece = string | { value: 'unknown' | 'file' };

/**
 * Make expands the variables and functions of the line, then reads the text. A `$$` is a `$`, an automatic variable
 * (`$@`, `$<`) a file name, and the other references text we cannot know.
 */
function pieces(line: string): Piece[] {
  const out: Piece[] = [];
  for (let k = 0; k < line.length; k++) {
    const c = line[k];
    if (c !== '$') { out.push(c); continue; }
    const next = line[k + 1];
    if (next === undefined) { out.push({ value: 'unknown' }); continue; }
    k++;
    if (next === '$') out.push('$');
    else if (isMakeAutomatic(next)) out.push({ value: 'file' });
    else if (next === '(' || next === '{') {
      const close = closing(line, k);
      out.push({ value: 'unknown' });
      k = close < 0 ? line.length : close;
    } else out.push({ value: 'unknown' });
  }
  return out;
}

/** Index of the bracket that closes the one at `open`, counting the same kind. */
function closing(s: string, open: number): number {
  const close = s[open] === '(' ? ')' : '}';
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === s[open]) depth++;
    else if (s[i] === close && --depth === 0) return i;
  }
  return -1;
}

/**
 * How make runs `line`: the text of a recipe line after its `@`, `-` and `+` prefixes, with the lines of a backslash
 * continuation joined by a newline (and the tab that starts each of the later lines taken off, as make does).
 */
export function recipeRun(line: string): RecipeRun {
  const items = pieces(line);
  // The words, as the program would get them: undefined where a variable's text is in them.
  const words: (string | undefined)[] = [];
  let word: string | undefined;
  let unknown = false;
  let started = false;
  let quoted = false;
  const add = (c: string | undefined) => { started = true; word = word === undefined || c === undefined ? undefined : word + c; };
  const end = () => { if (started) words.push(word); word = ''; started = false; };
  word = '';
  for (let k = 0; k < items.length; k++) {
    const c = items[k];
    if (typeof c !== 'string') {
      if (c.value === 'unknown') unknown = true;
      add(undefined);
    } else if (quoted) {
      if (c === "'") quoted = false;
      else add(c);
    } else if (c === '\\') {
      const next = items[k + 1];
      // (A backslash before a newline joins the lines; before a character, it makes the character plain; at the end, it is dropped.)
      if (next === undefined) continue;
      k++;
      if (next !== '\n') add(typeof next === 'string' ? next : undefined);
      if (typeof next !== 'string' && next.value === 'unknown') unknown = true;
    } else if (c === "'") {
      quoted = true;
      started = true;
    } else if (c === ' ' || c === '\t') end();
    else if (SHELL_CHARS.has(c)) return { run: 'shell' };
    else add(c);
  }
  end();
  // (An unfinished single quote is a line for the shell to refuse; nothing to read.)
  if (quoted || !words.length) return { run: 'shell' };
  const first = words[0];
  if (first !== undefined && (first.includes('=') || SHELL_COMMANDS.has(first))) return { run: 'shell' };
  return unknown ? { run: 'maybe', ...(first !== undefined ? { first } : {}) } : { run: 'direct', words };
}
