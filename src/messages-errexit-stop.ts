// The text of `errexit-stops-here` (src/messages-facts-status.ts; docs/design/errexit-stop.md, section 4): where a
// failure under `set -e` stops the script, which traps run then, and the status it ends with. Its params come from the
// models only (src/explain/status.ts, `errexitStop`): where they do not know a trap, the text says that one may run.
import { lineLabel } from './i18n';
import { codeSpan } from './label';
import { jaSpaced } from './messages-sentence';

/**
 * What fails: a command (its name), the `$( )` of an assignment (the name of its one command), a pipeline, a test
 * (`[[ … ]]`, `(( … ))`, `[ … ]`: false gives 1), a subshell `( … )`, or a redirection of a command that fails no other
 * way (`exec /opt/app >> "$LOG"`: status 1).
 */
export type StopWhat =
  | { readonly kind: 'command'; readonly name: string }
  | { readonly kind: 'substitution'; readonly name?: string }
  | { readonly kind: 'pipeline' }
  | { readonly kind: 'test'; readonly text: string }
  | { readonly kind: 'subshell' }
  | { readonly kind: 'redirection'; readonly name: string };

/**
 * A trap of `EXIT` or `ERR` that runs when the failure stops the shell (`sure`), or may (`sure: false`: set on some
 * paths, or after code the model does not read). `line` and `action`, where the model knows the `trap` command;
 * `fails`, `exits`: what the action may do to the status (`TrapOutcome`).
 */
export interface StopTrap {
  readonly sure: boolean;
  readonly line?: number;
  readonly action?: string;
  readonly fails?: boolean;
  readonly exits?: boolean;
}

/**
 * The params of `errexit-stops-here`. `what`: the statements of the line that stop (up to three; `more`: others too).
 * `stops`: the script, a subshell, the action of the main shell's `EXIT` trap (`exit-trap`; G4), a test of bats
 * (`test`, with `teardown` when the file defines it; G6), or a shell not known. `err`, `exit`: the traps that run (not
 * for `exit-trap`, `test`, `unknown`). `later`: no `EXIT` trap is set yet, and the main shell sets one later (run 4, fix 1).
 */
export interface ErrexitStopParams {
  readonly what: readonly StopWhat[];
  readonly more?: boolean;
  readonly stops: 'script' | 'subshell' | 'exit-trap' | 'test' | 'unknown';
  readonly err?: StopTrap;
  readonly exit?: StopTrap;
  readonly later?: { readonly line: number; readonly action: string };
  readonly teardown?: string;
}

/** The sections a stop note cites: `set` and the exit status, and `trap` where a trap is named. */
export function errexitStopRefs(p: ErrexitStopParams): readonly string[] {
  return ['4.3.1', ...(p.err || p.exit || p.later || p.stops === 'exit-trap' ? ['4.1'] : []), '3.7.5'];
}

type Lang = 'ja' | 'en';

/** The subject: what fails, as the line writes it. */
function subject(lang: Lang, w: StopWhat): string {
  switch (w.kind) {
    case 'command': return codeSpan(w.name);
    case 'substitution': return w.name ? (lang === 'ja' ? `\`$( )\` の中の ${codeSpan(w.name)}` : `${codeSpan(w.name)} in \`$( )\``) : '`$( )`';
    case 'pipeline': return lang === 'ja' ? 'パイプライン' : 'the pipeline';
    case 'test': return codeSpan(w.text);
    case 'subshell': return '`( … )`';
    case 'redirection': return lang === 'ja' ? `${codeSpan(w.name)} のリダイレクト` : `a redirection of ${codeSpan(w.name)}`;
  }
}

/** Joins items with "or" (en: `a`, `b` or `c`), or as a list of which one (ja: `a`・`b` のどれか). */
function either(lang: Lang, items: readonly string[]): string {
  if (lang === 'ja') return items.length > 1 ? `${items.join('・')}のどれか` : items[0];
  return items.length < 3 ? items.join(' or ') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`;
}

/** "If W fails" (en), "W が失敗すると" (ja); a test "is false". */
function condition(lang: Lang, p: ErrexitStopParams): string {
  const names = p.what.map((w) => subject(lang, w));
  const all = either(lang, p.more ? [...names, lang === 'ja' ? 'ほかのコマンド' : 'another'] : names);
  const test = p.what.length === 1 && !p.more && p.what[0].kind === 'test';
  if (lang === 'ja') return `${all}${test ? 'が偽だと' : 'が失敗すると'}`;
  return `If ${all} ${test ? 'is false' : 'fails'}`;
}

/** The status the shell ends with: the command's, the pipeline's, 1 for a test, or that of the one that fails. */
function statusOf(lang: Lang, p: ErrexitStopParams): string {
  const ja = lang === 'ja';
  if (p.what.length > 1 || p.more) return ja ? '失敗したコマンドの終了ステータス' : 'the status of the one that fails';
  const w = p.what[0];
  switch (w.kind) {
    case 'test': case 'redirection': return ja ? '終了ステータス 1 ' : 'status 1';
    case 'pipeline': return ja ? 'パイプラインの終了ステータス' : "the pipeline's status";
    case 'command': return ja ? `${codeSpan(w.name)} の終了ステータス` : `${codeSpan(w.name)}'s status`;
    case 'substitution': return w.name ? (ja ? `${codeSpan(w.name)} の終了ステータス` : `${codeSpan(w.name)}'s status`) : (ja ? '`$( )` の終了ステータス' : 'the status of `$( )`');
    case 'subshell': return ja ? '`( … )` の終了ステータス' : 'the status of `( … )`';
  }
}

/** "the EXIT trap of line 19" (en), "行 19 の EXIT トラップ" (ja). */
function trapName(lang: Lang, name: 'ERR' | 'EXIT', t: StopTrap): string {
  if (lang === 'ja') return t.line ? `${lineLabel('ja', t.line)} の ${name} トラップ` : `${name} トラップ`;
  return t.line ? `the ${name} trap of ${lineLabel('en', t.line, 'inline')}` : `an ${name} trap`;
}

/** What the traps that may run do to the status: the actions that may fail or call `exit` (one not known is said with the traps that may run). */
function hedge(lang: Lang, traps: readonly StopTrap[]): string {
  const ja = lang === 'ja';
  const changing = traps.filter((t) => t.action && (t.fails || t.exits));
  if (!changing.length) return '';
  const names = either(lang, changing.map((t) => codeSpan(t.action!)));
  const fails = changing.some((t) => t.fails);
  const exits = changing.some((t) => t.exits);
  if (!exits) return ja ? `（${names}が失敗したときはそのステータス）` : ` (or that of ${names}, if it fails)`;
  if (ja) return fails ? `（${names}が失敗したり \`exit\` を呼んだりしなければ）` : `（${names}が \`exit\` を呼ばなければ）`;
  return fails ? ` (unless ${names} fails or calls \`exit\`)` : ` (unless ${names} calls \`exit\`)`;
}

/** The text of `errexit-stops-here` (Japanese spaced around its code spans: `jaSpaced`). */
export function errexitStopText(lang: Lang, p: ErrexitStopParams): string {
  return lang === 'ja' ? jaSpaced(stopText(lang, p)) : stopText(lang, p);
}

function stopText(lang: Lang, p: ErrexitStopParams): string {
  const ja = lang === 'ja';
  const when = condition(lang, p);
  const status = statusOf(lang, p);
  switch (p.stops) {
    case 'unknown': return ja ? `${when}、\`set -e\` で実行しているシェル（スクリプトかサブシェル）が止まる` : `${when}, \`set -e\` stops the shell it runs in (the script or a subshell)`;
    case 'exit-trap': return ja ? `${when}、\`set -e\` で EXIT トラップはここで終わり、スクリプトは${status}で終了する` : `${when}, \`set -e\` ends the EXIT trap here, and the script exits with ${status}`;
    case 'test': {
      const down = p.teardown ? codeSpan(p.teardown) : undefined;
      return ja
        ? `${when}、テストはここで失敗する。残りの行は実行されず、${down ? `${down} が実行され、` : ''}bats は次のテストに進む`
        : `${when}, the test fails here: its remaining lines do not run, ${down ? `${down} runs, ` : ''}and bats goes on with the next test`;
    }
  }
  const shell = p.stops === 'script' ? (ja ? 'スクリプト' : 'the script') : (ja ? 'サブシェル' : 'the subshell');
  const named = ([['ERR', p.err], ['EXIT', p.exit]] as const).filter((x): x is readonly ['ERR' | 'EXIT', StopTrap] => !!x[1]);
  const sure = named.filter(([, t]) => t.sure);
  const maybe = named.filter(([, t]) => !t.sure);
  const change = hedge(lang, named.map(([, t]) => t));
  // (A trap that may run whose action is not known may change the status too.)
  const blind = maybe.some(([, t]) => !t.action);
  const runs = sure.map(([name, t]) => ja ? `${trapName(lang, name, t)}の ${codeSpan(t.action!)}` : `${trapName(lang, name, t)} runs ${codeSpan(t.action!)}`);
  // (ja: a space between と and a name in Latin letters, `ERR トラップと EXIT トラップ`.)
  const mayRun = maybe.map(([name, t]) => trapName(lang, name, t)).join(ja ? 'と' : ' and ').replace(/と(?=[A-Z])/g, 'と ');
  const later = p.later && (ja
    ? `EXIT トラップはまだ設定されていないので、${lineLabel('ja', p.later.line)} の ${codeSpan(p.later.action)} は実行されない`
    : `no EXIT trap is set yet, so ${codeSpan(p.later.action)} (${lineLabel('en', p.later.line, 'inline')}) does not run`);
  if (ja) {
    const stop = `${when}、\`set -e\` で${shell}はここで終わり、`;
    const ran = runs.length === 2 ? `${runs.join('、')}の順に実行され、` : runs.length ? `${runs[0]}が実行され、` : '';
    const extra = [maybe.length ? `先に${/^[A-Z]/.test(mayRun) ? ' ' : ''}${mayRun}が実行され${blind ? '、終了ステータスを変える' : 'る'}ことがある` : '', later ?? ''].filter(Boolean);
    return `${stop}${ran}${status}で終了する${change}${extra.map((x) => `（${x}）`).join('')}`;
  }
  const head = `${when}, \`set -e\` ${p.stops === 'script' ? 'stops the script' : 'ends the subshell'} here`;
  const body = runs.length ? `${head}: ${runs.join(', then ')}, and ${shell} exits with ${status}${change}` : `${head}, with ${status}${change}`;
  const extra = [maybe.length ? `${mayRun} may run first${blind ? ' and change the status' : ''}` : '', later ?? ''].filter(Boolean);
  return [body, ...extra].join('; ');
}
