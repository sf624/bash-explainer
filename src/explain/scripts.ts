// Strings a command runs as a script (docs/design/analyzer.md, step 7; docs/design/semantics.md, 4.13): `bash -c 'cmd'`,
// `su -c`, `eval`, a trap's action, the words ssh joins. The model reads the string (`StateModel.script`), and each of
// its lines is explained as a script of its own (`Explainer.nestedLine`), with its tokens placed in the source. And
// the notes on a command that another one runs, which follow from where its slot runs it (src/semantics/env.ts): a
// function or a builtin that a program cannot run, a variable that a new shell does not get.
import type { ExplainOptions, Span, Token } from '../analyzer-types';
import type { CommandRole } from '../argv/interpret';
import { specialVariables } from '../dict/syntax';
import { tx } from '../i18n';
import { shorten } from '../label';
import { fact } from '../messages';
import { spanOf } from '../noteanchors';
import { type ExecEnv, linksAfter, reachOf, type SlotLink, variableIn, whereOf } from '../semantics/env';
import { fromEnvironment } from '../semantics/shellstate';
import type { Missed } from '../semantics/names';
import { type NestedScript, plainReads, scriptSourceIndex } from '../semantics/nested';
import { givenToEveryShell } from '../semantics/vars';
import { type ExpansionStep, wordMeaning } from '../semantics/words';
import { isPlainWord, literalContent, staticWordValue } from '../staticword';
import { ancestor, assignmentsOnly, descendants, field, readsVariable, type SyntaxNode } from '../syntax/tree';
import { replaceRange, stringShell, textBetween } from '../rewrite';
import { readAsScript, scriptProcess } from '../tokenmarks';
import type { Explainer } from './context';
import { lineStarts, posOf, sameSpan, sortTokens } from './nodes';
import { resolve } from './reads';

/** The expansions that give a word a value of the shell that expands it (`$x`, `$(…)`, `*`, `~`): not braces or quotes. */
const LOCAL_EXPANSIONS: ReadonlySet<ExpansionStep['kind']> = new Set(['tilde', 'parameter', 'command', 'arithmetic', 'process', 'glob']);

/**
 * The tokens of the string `words` hold, read as the script a slot runs (docs/design/semantics.md, 4.13): the
 * items of each of its lines, explained with its shell and model (`Explainer.nestedLine`) and mapped to the source (a
 * token per line when it has several). Its notes and examples join the line's, unless `notes` is false (a script that never
 * runs). `note`: why it is not read, or that
 * its shell is not known.
 */
export function scriptTokens(cx: Explainer, words: SyntaxNode[], env: ExecEnv, positional?: ExplainOptions['positional'], notes = true): { tokens: Token[]; note?: string } {
  const script = cx.state.script(words, env);
  // (A string no shell runs, `sudo eval s`, has the pitfall of its slot.)
  if ('why' in script) {
    return script.why === 'not-run' ? { tokens: [] } : { tokens: [], note: script.why === 'not-static'
      ? cx.s('。展開を含み、中身は実行するときに決まるので、スクリプトとしては解説しない', '. It holds an expansion, so its text is known only when it runs: it is not explained as a script')
      : cx.s('。文字列の中の文字列が深すぎるので、スクリプトとしては解説しない', '. Strings nested this deep are not explained as scripts') };
  }
  const rows = script.tree.text.split('\n');
  const lines: Token[][] = [];
  for (let line = 0; line < rows.length; line++) {
    const ex = cx.nestedLine(script, line, positional);
    // (A statement over several lines is explained whole on each of them: keep it, and its notes, on its first.)
    const items = ex.items.filter((t) => t.span.start.line === line);
    lines.push(items.map((t) => fromScript(cx, t, script)));
    // (Not the notes of a script that never runs, `find . -exec bash -c 's' _ {} ;`, which find refuses: `notes` false.)
    if (!items.length || !notes) continue;
    cx.adopt(ex, (span) => scriptSpan(cx, span, script));
  }
  const used = lines.map((items, i) => ({ items, i })).filter((l) => l.items.length);
  const tokens = used.length === 1 ? used[0].items : used.map(({ items, i }): Token => ({
    kind: 'block', label: shorten(rows[i].trim()), children: items,
    explanation: cx.s(`文字列の ${i + 1} 行目`, `Line ${i + 1} of the string`),
    span: { start: items[0].span.start, end: items[items.length - 1].span.end },
  }));
  const note = script.known ? undefined
    : cx.s('。実行するシェルはここではわからない（ユーザーのログインシェル）ので、bash として解説する', ". The shell that runs it is not known here (the user's login shell): it is explained as bash");
  for (const t of tokens) readAsScript(t, scriptProcess(env));
  return { tokens, ...(note ? { note } : {}) };
}

/** `t` with the tokens of a string read as a script under the token of its word (the quoted string, when `t` holds it). */
export function withScript(t: Token, script: { tokens: Token[]; note?: string }): Token {
  const only = t.children.length === 1 && sameSpan(t.children[0].span, t.span) ? t.children[0] : t;
  // (The script's tokens take the place of the word's own parts, which cover the same text: `$'…'` escapes.)
  if (script.tokens.length) only.children = sortTokens(script.tokens);
  if (script.note) t.explanation += script.note;
  return t;
}

/** One token for the words joined into a script (`eval echo $x`, `ssh host ls -l`), with the script's tokens. */
export function joinedScript(cx: Explainer, words: SyntaxNode[], desc: string | undefined, script: { tokens: Token[]; note?: string }): Token {
  const span: Span = { start: spanOf(words[0]).start, end: spanOf(words[words.length - 1]).end };
  const text = cx.source.slice(words[0].startIndex, words[words.length - 1].endIndex);
  const joinedText = cx.s('（単語を空白でつないだ文字列を、スクリプトとして読む）', ' (the words, joined with spaces, are read as a script)');
  return {
    kind: 'argument', label: shorten(text), span, children: script.tokens,
    explanation: (desc ?? cx.s('もう一度読んで実行する文字列', 'Text to read and run again')) + joinedText + (script.note ?? ''),
  };
}

/** A token of a string read as a script, with its spans moved from the string's text to the source. */
function fromScript(cx: Explainer, t: Token, script: NestedScript): Token {
  return { ...t, span: scriptSpan(cx, t.span, script), children: t.children.map((c) => fromScript(cx, c, script)) };
}

/**
 * A span in the text of a string read as a script, in the source: from the start of its first character to the end
 * of its last (`\$x` for `$x` in `"echo \$x"`).
 */
function scriptSpan(cx: Explainer, sp: Span, script: NestedScript): Span {
  const inner = lineStarts(script.tree.text);
  const s = inner[sp.start.line] + sp.start.character;
  const e = inner[sp.end.line] + sp.end.character;
  const outer = lineStarts(cx.source);
  const start = posOf(outer, scriptSourceIndex(script, s, false));
  // (An empty span ends where it starts.)
  return { start, end: posOf(outer, scriptSourceIndex(script, e, e > s)) };
}

/** The command string of `trap`: when its `$variables` are expanded depends on the quotes. */
export function trapNote(cx: Explainer, a: SyntaxNode): string {
  // (In double quotes, the expansions the parser finds: `\$x` is text.)
  const found = a.type === 'raw_string' ? a.text.match(/\$\{?[A-Za-z_]\w*\}?|\$\(|`/g) ?? []
    : descendants(a, ['simple_expansion', 'expansion', 'command_substitution']).map((e) => (e.type === 'command_substitution' ? '$(' : e.text));
  const vars = [...new Set(found)].map((v) => (v === '$(' || v === '`' ? '$(…)' : v));
  if (!vars.length) return '';
  const shown = [...new Set(vars)].map((v) => `\`${v}\``).join(cx.s('、', ', '));
  if (a.type === 'raw_string') {
    return cx.s(`。シングルクォートなので ${shown} はここでは展開されず、トラップが実行されるときに展開される（そのときの値が使われる）`,
      `. Single quotes keep ${shown} from being expanded here: it is expanded when the trap runs, with the value it has then`);
  }
  return a.type === 'string'
    ? cx.s(`。ダブルクォートなので ${shown} は今ここで展開され、そのときの内容がトラップに固定される（実行時の値にしたいならシングルクォートにする）`,
      `. Double quotes expand ${shown} now, and the trap keeps that text (use single quotes to get the value at run time)`)
    : '';
}

/**
 * Pitfalls of a command that another one runs (`words`, from its first word), which follow from how its slot runs
 * it. A separate program (`exec`: sudo, xargs, find -exec…) cannot run a shell function or a builtin that
 * only changes the shell, and `$NAME` of its words is read before the wrapper sets `NAME`; in a container,
 * the script's functions are not there. A new shell (`shell-string`: bash -c, su -c, ssh) does not have the
 * script's functions, and the words ssh joins are expanded here before they are sent. The current shell
 * (`current-shell`: eval, command, builtin) runs both. `env` is where the command runs (src/semantics/env.ts):
 * its last link is this slot, and what reaches it is what every link on the way passes on.
 */
export function slotNotes(cx: Explainer, role: CommandRole, env: ExecEnv, words: SyntaxNode[], assigned: string[], effect?: 'changes' | 'exits'): void {
  const { slot } = role;
  const link = env.links[env.links.length - 1] as SlotLink;
  const via = link.via;
  // (What reached the shell that runs the command is in its state: only the command's own slots, `linksAfter`.)
  const own = linksAfter(env, cx.state.env(ancestor(words[0], (x) => x.type === 'command')!));
  const where = whereOf(own);
  // (The first link that passes no exported functions: `env -i`, `su -`, sudo, a container.)
  const { blocker } = reachOf(own);
  const first = words[0];
  const name = first.text;
  // A function of the script that the slot does not run (src/semantics/names.ts): even one defined later.
  const isFn = isPlainWord(first) && (resolve(cx, name, first, { env }) as { missed?: Missed }).missed?.kind === 'function';
  if (slot.run === 'exec' && where === 'container') {
    if (isFn) {
      cx.note(fact(cx.lang, 'function-not-in-container', { via, name }), first);
    }
  } else if (slot.run === 'exec') {
    // (A builtin with a program of its name runs the program: the slot gave its spec.)
    if (isPlainWord(first) && (isFn || role.spec?.builtin)) {
      const fix = isFn && blocker
        ? tx(`関数の中身を直接書くか、\`${via} bash -c "$(declare -f ${name}); ${name}"\` のように定義ごと渡します（\`${blocker.via}\` は環境の関数を渡さないので、\`export -f\` は効きません）`,
          `Write out its body, or pass the definition along: \`${via} bash -c "$(declare -f ${name}); ${name}"\` (\`${blocker.via}\` passes no exported functions, so \`export -f\` does not help)`)
        : isFn
        ? tx(`\`export -f ${name}\` してから \`bash -c '${name} "$@"' _ …\` のようにシェル経由で呼びます`, `Run \`export -f ${name}\`, then call it through a shell: \`bash -c '${name} "$@"' _ …\``)
        : effect === 'changes'
          ? tx(`サブシェル \`(${name} … && …)\` か、\`${via} sh -c '${name} … && …'\` を使います`, `Use a subshell \`(${name} … && …)\`, or \`${via} sh -c '${name} … && …'\``)
          : tx(`\`${via} sh -c '${name} …'\` のようにシェル経由で呼びます（今のシェルの状態を変えるものは、別のプログラムでは変えられません）`, `Go through a shell, as in \`${via} sh -c '${name} …'\` (what changes the state of the current shell cannot be changed by another program)`);
      cx.note(fact(cx.lang, 'builtin-or-function-as-program', { via, name, isFn, fix }), first);
    }
  } else if (slot.run === 'shell-string' && where === 'remote') {
    // (A word this shell expands before ssh joins the words: src/semantics/words.ts.)
    const risky = words.find((w) => wordMeaning(w, cx.state)!.steps.some((x) => LOCAL_EXPANSIONS.has(x.kind) && x.applies !== false));
    if (risky) {
      cx.note(fact(cx.lang, 'ssh-local-expansion', { risky: risky.text }), risky);
    }
    unpassedVariables(cx, env, words);
    if (isFn) {
      cx.note(fact(cx.lang, 'function-not-on-remote', { name }), first);
    }
  } else if (slot.run === 'shell-string') {
    unpassedVariables(cx, env, words);
    // The commands of the string that name a function of this script, when the string is read as a script
    // (src/semantics/state.ts), but not one the string defines itself (`bash -c 'f() { …; }; f'`); otherwise the
    // first word of the string, when it is known (`su -c 'f arg'`).
    const script = cx.state.script(words, env);
    let fn: string | undefined;
    if (!('why' in script)) {
      const own = new Set(descendants(script.tree.root, ['function_definition']).map((d) => field(d, 'name')!.text));
      const call = descendants(script.tree.root, ['command']).filter((c) => !assignmentsOnly(c))
        .find((c) => { const n = staticWordValue(field(c, 'name')!.namedChildren[0], false, script.shell); return n !== undefined && !own.has(n) && cx.state.definitions.functions.has(n); });
      // (A file the string reads first with `source` or `.` may define it: `bash -c '. ~/.profile; f'`.)
      if (call && !script.model.sources.some((x) => x.startIndex < call.startIndex)) fn = staticWordValue(field(call, 'name')!.namedChildren[0], false, script.shell);
    } else {
      const lit = literalContent(first)?.text;
      fn = lit ? /^\s*([A-Za-z_][\w-]*)/.exec(lit)?.[1] : undefined;
    }
    // What the string's first word runs in the new shell (src/semantics/names.ts): this script's function only
    // when every link passes the exported functions (not `su -c`, `env -i bash -c f`, `sudo bash -c f`) and the
    // shell reads them (bash, not dash). (A function exported on some paths only is taken as exported.)
    const res = fn && cx.state.definitions.functions.has(fn) ? resolve(cx, fn, first, { env }) : undefined;
    const missed = res && res.kind !== 'keyword' && res.kind !== 'alias' ? res.missed : undefined;
    const shell = link.shell!;
    if (res && res.kind !== 'function') {
      const f = fn!;
      cx.note(missed?.why === 'not-passed' && blocker !== link
        ? fact(cx.lang, 'function-not-in-new-shell-blocked', { via, fn: f, blocker: blocker!.via })
        : missed?.why === 'not-passed'
        ? fact(cx.lang, 'function-not-in-new-shell', { via, fn: f })
        : missed?.why === 'not-imported'
        ? fact(cx.lang, 'function-not-imported', { via, shell, fn: f })
        : fact(cx.lang, 'function-not-in-new-shell-export', { via, fn: f }), first);
    } else if (missed?.why === 'not-imported') {
      // (`sh` is dash on Debian and Ubuntu, bash elsewhere.)
      cx.note(fact(cx.lang, 'function-not-imported-sh', { via, fn: fn! }), first);
    }
  }
  for (const v of assigned) {
    const use = words.find((w) => readsVariable(w, v));
    if (use) {
      // The rewrite: the command and its arguments become the string of a new shell, the script's own (`stringShell`:
      // `bash -c`; in sh, which may be dash, not for `echo -e` or `printf %q`). Its edit is left out where the string has
      // an expansion other than `$v` (`$other`, `$(…)`): that shell would expand it instead of this one.
      const last = words[words.length - 1];
      const inner = textBetween(first, last);
      const program = stringShell(cx.shell, first.text, words.map((w) => w.text));
      const code = program ? `${program} -c '${inner.replace(/'/g, "'\\''")}'` : `${cx.shell} -c '…'`;
      const own = !!program && !/[$`]/.test(inner.replace(new RegExp(`\\$(\\{${v}\\}|${v}(?!\\w))`, 'g'), ''));
      cx.note(fact(cx.lang, 'wrapper-assignment-expanded-first', { use: use.text, via, v, rewrite: [own ? replaceRange(first, first.startIndex, last.endIndex, code) : { code, edits: [] }] }), use);
      break;
    }
  }
}

/**
 * `x=1; bash -c 'echo "$x"'`: a variable of this script that a string run by another shell reads (in single
 * quotes, so that shell expands it), which that shell does not get: it is not exported, or a link on the way
 * passes no variables (`env -i`, sudo, ssh: `variableIn` of src/semantics/env.ts; but sudo keeps `TERM`, `TZ`…). Whether
 * its export may come from the environment is `fromEnvironment`'s: not said of one the environment almost always has
 * (`TERM`), a caveat for one in capitals, a clause for one in lower case. Not one the string sets itself, nor one the
 * command or a wrapper sets for it (`x=1 bash -c …`, `env x=1 …`, sudo's `USER`), nor one set by that shell (`$_`);
 * nothing of a read after code the string runs and its model does not read (`. ./env.sh; echo "$x"`), nor "not
 * exported" after such code in this shell (`source`, `eval "$x"`: `ShellState.opaque`), which may export it.
 */
function unpassedVariables(cx: Explainer, env: ExecEnv, words: SyntaxNode[]): void {
  // The string, read as the script it is (src/semantics/state.ts): the variables it reads, and whether each
  // reached it there (passed by the slots, or set by the string itself before the read).
  const script = cx.state.script(words, env);
  if ('why' in script) return;
  const cmd = ancestor(words[0], (x) => x.type === 'command')!;
  const st = cx.state.at(cmd).run;
  const remote = whereOf(env) === 'remote';
  // (Only `$v` and `${v}`: `${v:-x}`, `${v+x}` and `${#v}` are fine with no value. A file of variables may give any.)
  if (env.links.some((l) => l.kind === 'slot' && l.assigns.includes('*'))) return;
  for (const { name: v, at: e } of plainReads(script)) {
    const x = st.variables.get(v);
    // (Not one bash gives every shell, `$PS4`, `$FUNCNAME`. One the environment usually has, `$HOME`, is said nothing
    // of below, unless a link on the way drops it: `env -i`.)
    const given = givenToEveryShell(v);
    // (Set by the string itself before the read, or given to it exported, by the slot or this shell: not one passed
    // with an export not known, from the environment.)
    const own = script.model.at(e).run.variables.get(v);
    // (After code the string runs that its model does not read, `bash -c '. ./env.sh; echo "$x"'`, it may be set.)
    if (script.model.at(e).run.opaque) continue;
    if (!x || x.set !== 'on' || given || specialVariables[v] || (own && (own.attrs.x?.state === 'on' || script.tree.root === ancestor(own.at, (a) => !a.parent)))) continue;
    const exported = x.attrs.x?.state ?? 'off';
    // (sudo still passes a few variables of the environment, `TERM`, `TZ`: then it is as with no wrapper.)
    const { dropped, unset } = variableIn(cx.state, cmd, v, env);
    if (dropped) {
      cx.note(remote
        ? fact(cx.lang, 'variable-not-in-remote-shell', { v })
        : fact(cx.lang, 'variable-not-passed-by-wrapper', { v, via: dropped.via, ...(dropped.keeps ? { keeps: dropped.keeps.slice(0, 2) } : {}) }), words[0]);
      return;
    }
    // (Whether it is exported, only where no path before ran code the model does not read (`source`, `eval "$x"`:
    // `ShellState.opaque`), which may export it.)
    if (st.opaque) return;
    // (`env -u FOO` removes it on the way, whatever the environment had.)
    const environment = unset ? 'no' : fromEnvironment(v, st, 'export', cx.state.provides);
    if (environment === 'usually') continue;
    // (bash exports no array, even with `export`. `FOO=1` is exported when `FOO` came from the environment: `env FOO=x bash script`.)
    const array = ['a', 'A'].some((l) => (x.attrs[l]?.state ?? 'off') !== 'off');
    if (array) {
      cx.note(fact(cx.lang, 'variable-not-exported', { v, array }), words[0]);
      return;
    }
    if (exported === 'off' || environment === 'maybe' || (unset && exported !== 'on')) {
      cx.note(fact(cx.lang, 'variable-not-exported', { v, ...(environment === 'maybe' || environment === 'unlikely' ? { environment } : {}) }), words[0]);
      return;
    }
  }
}
