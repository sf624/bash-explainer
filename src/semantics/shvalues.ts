// The values of expansions in sh and dash scripts (docs/design/expansion-values.md). The model reads a script as bash
// reads it, and dash reads some of it otherwise; `sh` is dash on Debian and Ubuntu but `bash --posix` elsewhere. So a
// value is said there only for the POSIX forms, in a script that uses nothing that dash (and, for sh, bash) reads
// otherwise, and where what dash does is what bash --posix does too: measured with dash 0.5.12 and bash 5.2 by the
// rows of test/fixtures/probes/values.json that have a `shell`.
import { collectFeatures, featureWorks, type Shell } from '../dialect';
import { parseExpansion } from '../expansion';
import { staticWordValue } from '../staticword';
import { ancestor, descendants, field, fields, prefixAssignments, type SyntaxNode } from '../syntax/tree';
import { documentRoot, type StateModel } from './state';
import { type WordMeaning, wordFields } from './words';

/** The shells whose scripts get values: bash, dash, and sh (where dash and bash --posix agree). */
export const valueShell = (shell: Shell | undefined): boolean => !shell || shell === 'bash' || shell === 'sh' || shell === 'dash';

/** The operators of `${x…}` that POSIX has (dash reads the others as "Bad substitution"). */
const POSIX_OPS = new Set([':-', '-', ':+', '+', ':?', '?', '#', '##', '%', '%%']);
/** Features that dash lacks but that change no variable and do not stop the script: `echo -e` prints `-e`… */
const HARMLESS = new Set(['echoE', 'echoN', 'printfQ', 'typeT', 'readP', 'readOpts', 'waitN']);
/** The builtins whose words dash reads as assignments: their options and the ways to name them that dash reads otherwise. */
const DECLARATIONS = new Set(['export', 'readonly', 'local']);
const ASCII = /^[\x00-\x7f]*$/;
/** A character class of a bracket expression (which dash knows), taken out before the check of `[` in brackets. */
const CLASS = /\[:(?:alnum|alpha|blank|cntrl|digit|graph|lower|print|punct|space|upper|xdigit):\]/g;

/**
 * Whether the script `root` has what dash (and, for sh, dash or bash) reads otherwise than the model: a bash feature
 * (src/dialect.ts) that the shell lacks, `$"…"`, `$[…]`, arithmetic with `**` or a base (`16#ff`), `return` or
 * `local` outside a function (they end a dash script), or a declaration dash reads otherwise: `local -r` and
 * `export -n` (dash's take no option but `-p`), `x=1 local y` (dash keeps `x`), `\export x=$y` and
 * `command export x=$y` (dash does not split `$y`; bash splits the first, and bash without POSIX mode both).
 */
function readOtherwise(root: SyntaxNode, shell: Shell): boolean {
  const works = (id: string): boolean => HARMLESS.has(id) || (shell === 'sh' ? featureWorks(id, 'dash') && featureWorks(id, 'bash') : featureWorks(id, shell));
  if (collectFeatures(root, root.startPosition.row, root.endPosition.row).some((f) => !works(f.id))) return true;
  return descendants(root, ['translated_string', 'arithmetic_expansion', 'command']).some((n) => {
    if (n.type === 'translated_string') return true;
    if (n.type === 'arithmetic_expansion') return n.text.startsWith('$[') || /\*\*|#/.test(n.text);
    const word = field(n, 'name')?.namedChildren[0];
    const name = word && staticWordValue(word);
    if (!name) return false;
    const args = fields(n, 'argument');
    if (name === 'command' || name === 'builtin') return args.some((a) => DECLARATIONS.has(staticWordValue(a) ?? ''));
    // (Outside a function, dash's `return` ends the script, and its `local` fails, which ends it too.)
    if ((name === 'return' || name === 'local') && !ancestor(n, (a) => a.type === 'function_definition')) return true;
    if (!DECLARATIONS.has(name)) return false;
    return word.text !== name || (name === 'local' && prefixAssignments(n).length > 0)
      || args.some((a) => /^-./.test(a.text) && !(a.text === '-p' && name !== 'local'));
  });
}

const gates = new WeakMap<SyntaxNode, Map<Shell, boolean>>();
function gated(root: SyntaxNode, shell: Shell): boolean {
  let byShell = gates.get(root);
  if (!byShell) gates.set(root, (byShell = new Map()));
  let v = byShell.get(shell);
  if (v === undefined) byShell.set(shell, (v = readOtherwise(root, shell)));
  return v;
}

/** A bracket expression dash reads otherwise than bash: `[^a]` (in dash 0.5.12, `^` is one of the characters), or one with a `[` in it but a class (`[[.a.]]`, `[[=a=]]`: dash has neither). */
function bracketsDiffer(pattern: string): boolean {
  const p = pattern.replace(CLASS, '');
  return /\[!?\^/.test(p) || /\[!?\]?[^\]]*\[/.test(p);
}

/** Whether the variable `name` holds only ASCII where `w` is expanded (dash counts and matches bytes, bash characters). */
function asciiValue(name: string, w: WordMeaning, model: StateModel): boolean {
  const v = w.state.variables.get(name);
  if (!v || v.set !== 'on') return true;
  const text = v.value ?? (v.source ? wordFields(v.source, model).fields?.[0] : undefined);
  return text !== undefined && ASCII.test(text);
}

/**
 * Whether the value of `part` (an expansion of the word `w`, split where `split`) is not to be said in a script of
 * `model.shell`, sh or dash, because dash (or, for sh, dash or bash --posix) may give another one.
 */
export function shellValueRefused(part: SyntaxNode, w: WordMeaning, model: StateModel, quoted: boolean, split: boolean): boolean {
  const shell = model.shell;
  if (shell !== 'sh' && shell !== 'dash') return false;
  let root = part;
  while (root.parent) root = root.parent;
  if (gated(root, shell) || gated(documentRoot(part), shell)) return true;
  // (dash splits on the bytes of the IFS.)
  if (split && w.ifs.kind === 'value' && !ASCII.test(w.ifs.value)) return true;
  if (part.type === 'simple_expansion') return false;
  const p = parseExpansion(part.text);
  // (`${#x:-a}` is no form: bash and dash fail on it.)
  if (!p || p.subscript !== undefined || p.prefix === '!' || (p.op && !POSIX_OPS.has(p.op))) return true;
  if (p.prefix === '#') return !asciiValue(p.name, w, model);
  if (!p.op) return false;
  const operand = p.parts.find((x) => x.role === 'word' || x.role === 'pattern')?.text ?? '';
  // `"${x:-'}'}"`: in double quotes, dash and bash --posix end the word at the `}` in single quotes (bash gives `'}'`).
  if (!/[#%]/.test(p.op)) return quoted && operand.includes("'") && operand.includes('}');
  return bracketsDiffer(operand) || !ASCII.test(operand) || !asciiValue(p.name, w, model);
}
