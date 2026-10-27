// Where code runs, as the explanations say it (docs/design/analyzer.md, step 3): why a `{ }` group or a command runs
// in a subshell, and what that does to a builtin that acts on its shell and to `$$`. The links come from the
// environment model (src/semantics/env.ts); this module puts them in words.
import { fact } from '../messages';
import { type EnvLink, groupSubshellLink, processOf, type SubshellLink } from '../semantics/env';
import { stageUncounted } from '../semantics/vars';
import type { SyntaxNode } from '../syntax/tree';
import type { Explainer } from './context';

/**
 * Why a `{ }` group runs in a subshell (src/semantics/env.ts): it, or a statement that holds it in the same list,
 * is a stage of a pipeline (the last one too, unless lastpipe is on), a background job (`&`) or a coproc.
 * Undefined when it runs in the current shell.
 */
export function groupSubshell(cx: Explainer, n: SyntaxNode): { ja: string; en: string } | undefined {
  const link = groupSubshellLink(cx.state.env(n), n);
  if (!link) return undefined;
  if (link.why === 'coproc') return { ja: 'コプロセスはサブシェルで動く', en: 'A coprocess runs in a subshell' };
  if (link.why === 'background') return { ja: '`&` でバックグラウンドの仕事にする', en: 'It is started in the background with `&`' };
  return link.sure
    ? { ja: 'パイプラインの各段は別々のサブシェルで動く', en: 'Each stage of a pipeline runs in its own subshell' }
    : { ja: 'パイプラインの各段は別々のサブシェルで動く（最後の段は、`shopt -s lastpipe` が効いている経路ではシェル自身で動く）', en: 'Each stage of a pipeline runs in its own subshell (the last one runs in the shell itself on the paths where `shopt -s lastpipe` is on)' };
}

/** Why code runs in a subshell, from the link that starts it (src/semantics/env.ts): `( )`, `$( )`, `&`, a pipeline stage… */
export function subshellWhy(cx: Explainer, link: EnvLink, sure: boolean): string {
  if (link.kind === 'call') {
    if (!sure) {
      // (Every call it sees is in a subshell, but it may be called where it does not see: src/semantics/trust.ts, `closed`.)
      const seen = link.sites.every((x) => processOf(x.env).kind === 'subshell' && processOf(x.env).sure);
      return seen ? cx.s('関数の呼び出し元。スクリプトに見えない所からも呼ばれうる', 'where its function is called; what the script does not show may call it too')
        : cx.s('関数の呼び出し元の一部', 'some of the places its function is called from');
    }
    // (Every call is in a subshell: named when they all give the same reason.)
    const whys = new Set(link.sites.map((x) => processOf(x.env)).map((p) => subshellWhy(cx, p.link!, p.sure)));
    return whys.size === 1 ? cx.s(`関数の呼び出し元: ${[...whys][0]}`, `where its function is called: ${[...whys][0]}`) : cx.s('関数の呼び出し元', 'where its function is called');
  }
  const l = link as SubshellLink;
  switch (l.why) {
    case 'parentheses': return '`( )`';
    case 'command-substitution': return l.at.text.startsWith('`') ? cx.s('バッククォート', 'backquotes') : '`$( )`';
    case 'process-substitution': return `\`${l.at.text[0]}( )\``;
    case 'background': return '`&`';
    case 'coproc': return '`coproc`';
    case 'pipeline-stage': return l.sure ? cx.s('パイプラインの段', 'a pipeline stage') : cx.s('パイプラインの最後の段で、lastpipe が無効のとき', 'the last stage of a pipeline, when lastpipe is off');
  }
}

/**
 * `n` in a subshell: whether it surely is, and why (`substitution`: the subshell of a `$( )` or `<( )` around it);
 * undefined when it runs in this shell (or in another program).
 */
export function inSubshell(cx: Explainer, n: SyntaxNode): { sure: boolean; why: string; substitution: boolean } | undefined {
  const p = processOf(cx.state.env(n));
  const l = p.link;
  return p.kind === 'subshell' ? { sure: p.sure, why: subshellWhy(cx, l!, p.sure), substitution: l!.kind === 'subshell' && (l!.why === 'command-substitution' || l!.why === 'process-substitution') } : undefined;
}

/**
 * What a builtin that acts on its shell does in a subshell (`cd` in `( )`, `exit` in `$( )`): it acts on the
 * subshell only. In `$( )` a change is usually there for the commands after it (`$(cd dir && pwd)`): said mildly.
 */
export function shellEffectNote(cx: Explainer, n: SyntaxNode, effect: 'changes' | 'exits' | undefined): string {
  const sub = effect && inSubshell(cx, n);
  if (!sub) return '';
  const { sure, why } = sub;
  if (effect === 'changes' && sub.substitution) {
    return cx.s(`。${why} の中のサブシェルで実行されるので、この変更はその中のあとのコマンドにだけ効く`, `. It runs in the subshell of ${why}, so the change holds only for the commands after it there`);
  }
  return effect === 'exits'
    ? (sure ? cx.s(`。サブシェル（${why}）で実行されるので、終わるのはサブシェルだけ（スクリプト全体は終わらない）`, `. It runs in a subshell (${why}), so it ends only the subshell, not the script`)
      : cx.s(`。サブシェル（${why}）で実行されることがあり、そのとき終わるのはサブシェルだけ（スクリプト全体は終わらない）`, `. It may run in a subshell (${why}); then it ends only the subshell, not the script`))
    : (sure ? cx.s(`。サブシェル（${why}）で実行されるので、この変更はサブシェルの中だけで、サブシェルが終わると消える`, `. It runs in a subshell (${why}), so the change stays in the subshell and is gone when it ends`)
      : cx.s(`。サブシェル（${why}）で実行されることがあり、そのときこの変更はサブシェルの中だけで、サブシェルが終わると消える`, `. It may run in a subshell (${why}); then the change stays in the subshell and is gone when it ends`));
}

/**
 * A variable that counts subshells (`$BASH_SUBSHELL`, src/semantics/vars.ts) read in a simple command that is a stage
 * of a pipeline: bash runs the stage in a subshell, but does not count it.
 */
export function stageCountNote(cx: Explainer, n: SyntaxNode, name: string): void {
  if (!stageUncounted(name) || (cx.shell && cx.shell !== 'bash')) return;
  const l = processOf(cx.state.env(n)).link;
  if (l?.kind === 'subshell' && l.why === 'pipeline-stage' && l.at.type === 'command') cx.note(fact(cx.lang, 'bash-subshell-not-counted'), n);
}

/** `$$` in a subshell: still the PID of the script's shell (bash gives the subshell's in `$BASHPID`). */
export function pidNote(cx: Explainer, n: SyntaxNode): string {
  const sub = inSubshell(cx, n);
  if (!sub) return '';
  const own = !cx.shell || cx.shell === 'bash' ? cx.s('（サブシェル自身の ID は `$BASHPID`）', ' (the subshell\'s own is `$BASHPID`)') : '';
  return sub.sure
    ? cx.s(`。ここはサブシェル（${sub.why}）の中だが、値はスクリプトのシェルのプロセス ID のまま${own}`, `. This is in a subshell (${sub.why}), but it is still the PID of the script's shell${own}`)
    : cx.s(`。サブシェル（${sub.why}）で実行されることがあるが、そのときも値はスクリプトのシェルのプロセス ID${own}`, `. This may run in a subshell (${sub.why}); it is still the PID of the script's shell there${own}`);
}
