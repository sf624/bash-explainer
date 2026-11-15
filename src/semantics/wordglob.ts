// Pathname expansion of the fields of a word (manual 3.5.8) for the evaluator of words (src/semantics/words.ts):
// whether bash takes a field as a pattern, with the glob step and its options, and the names it matches in the files
// of an environment; and the failure bash stops a word with.
import { guardedApart, modelLimit } from '../examples/regexguard';
import { globToRegex, hasExtglob, hasGlobstar } from '../examples/shellwords';
import { rootOf } from '../syntax/tree';
import { type Char, GLOB_CHARS, globbedByBash, patternOfChars, releasesDiffer } from './chars';
import type { Applies, Fields, WordEnv, WordMeaning } from './words';
import { changesDirectory } from './wordsites';

/** How bash fails on a word as it expands it (`Fields.error`), thrown by the evaluator (src/semantics/words.ts) and by pathname expansion. */
export class Failure { constructor(readonly error: NonNullable<Fields['error']>) {} }

/** What `f` gives, or undefined where bash fails on the word (a `Failure`). */
export function attempt<T>(f: () => T): T | undefined {
  try {
    return f();
  } catch (e) {
    // A rethrow guard: only `Failure` is thrown inside (a bug elsewhere must not become a wrong answer).
    /* c8 ignore next */
    if (!(e instanceof Failure)) throw e;
    return undefined;
  }
}

/**
 * Whether pathname expansion (manual 3.5.8) takes the field `f` of the word `w` as a pattern: the glob step and its
 * options, and the field's characters as bash quotes them (`ownChars`). Not known where the step may not apply, or
 * the pattern rests on an extended glob that extglob may not allow (`@(a)` with extglob off, a syntax error written so,
 * is not followed).
 */
export function globsField(w: WordMeaning, f: readonly Char[]): Applies {
  const step = w.steps.find((s) => s.kind === 'glob')!;
  const g = w.glob;
  // (Glob characters all quoted, which bash unquotes, `ownChars`: `IFS='?a'; ls "?"a`.)
  const unquoted = step.applies === false && (step.why === undefined || step.why === 'quoted') && f.some((c) => !c.quoted && GLOB_CHARS.test(c.c));
  if (unquoted ? g.noglob !== 'off' : step.applies === false && step.why !== 'noglob') return unquoted && g.noglob === 'unknown' ? 'unknown' : false;
  const pattern = patternOfChars(f);
  if (globbedByBash(pattern, g.extglob) === false && !hasExtglob(pattern)) return false;
  if (step.applies === false && !unquoted) return false;
  return step.applies === 'unknown' || (hasExtglob(pattern) && g.extglob !== 'on') ? 'unknown' : true;
}

/** Pathname expansion of one field (manual 3.5.8): the names it matches, the field itself, none, or unknown. */
export function globField(w: WordMeaning, f: Char[], env: WordEnv | undefined): string[] | undefined {
  const text = f.map((c) => c.c).join('');
  const globs = globsField(w, f);
  if (globs === false) return [text];
  // (Not followed: what differs between releases, `releasesDiffer`.)
  if (globs === 'unknown' || releasesDiffer(f) || !env?.files || changesDirectory(w.nodes[0])) return undefined;
  const pattern = patternOfChars(f);
  const g = w.glob;
  if ([g.nullglob, g.failglob, g.dotglob, g.nocaseglob, g.globstar, g.extglob].includes('unknown') || g.globignore === 'unknown') return undefined;
  // `./*.log`: the names under the current directory, with `./` before them; neither `sub/../*` nor `/var/log/*` is followed.
  const prefix = /^(?:\.\/)*/.exec(pattern)![0];
  const rest = pattern.slice(prefix.length);
  // (Where globskipdots is not known, `.` and `..` count only where a name of the pattern starts with `.`, `d/.*`; or at the top, where `matchFiles` asks.)
  if (rest.startsWith('/') || rest.split('/').some((seg) => seg === '.' || seg === '..') || (rest.includes('/') && (g.globskipdots === 'off' || (g.globskipdots === 'unknown' && /\/\./.test(rest))))) return undefined;
  const matched = guardedApart(modelLimit(rootOf(w.nodes[0])), () => matchFiles(w, rest, env.files!), () => undefined);
  if (!matched) return undefined;
  if (prefix && g.globstar === 'on' && rest === '**') matched.unshift('');
  if (matched.length) return matched.map((m) => prefix + m).sort();
  if (g.failglob === 'on') throw new Failure('no-match');
  return g.nullglob === 'on' ? [] : [text];
}

/** The names of `files` (with `.` and `..` when globskipdots is off; none when it is not known and they match) that `pattern` matches, without those GLOBIGNORE leaves out. */
function matchFiles(w: WordMeaning, pattern: string, files: readonly string[]): string[] | undefined {
  const g = w.glob;
  const ignore = g.globignore === 'unset' ? [] : (g.globignore as { value: string }).value.split(':').filter(Boolean).map((p) => globToRegex(p, 'file', { dotglob: true }));
  const opts = { dotglob: g.dotglob === 'on', nocase: g.nocaseglob === 'on', globstar: g.globstar === 'on' && hasGlobstar(pattern) };
  const re = globToRegex(pattern, 'file', opts);
  if (!re) return undefined;
  // A directory with its slash: for a pattern that ends with `/`, and for `dir/**` (`**` matches nothing after `dir/`).
  const slashed = pattern.endsWith('/') || (opts.globstar && /.\/\*\*$/.test(pattern));
  const names = files.flatMap((p) => (p.endsWith('/') ? [...(pattern.endsWith('/') ? [] : [p.slice(0, -1)]), ...(slashed ? [p] : [])] : [p]));
  if (g.globskipdots !== 'on') names.push('.', '..');
  const out = names.filter((p) => re.test(p) && !ignore.some((r) => r?.test(p))).sort();
  return g.globskipdots === 'unknown' && out.some((p) => p === '.' || p === '..') ? undefined : out;
}
