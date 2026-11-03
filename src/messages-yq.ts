// The wording of the facts `yq-flavour` and `yq-compat` (docs/design/sources.md, rows 14 and 17, SB3c): which of the
// three tools called yq a command is explained as, why, and where it works. The verdict (src/embedded/yq.ts, `judgeYq`)
// decides; the words are here. The reasons of a verdict are data of the clues that gave it (pairs of ja and en, written
// where each clue is found), not wording of the verdict.
import type { Lang } from './i18n';
import type { YqFlavor, YqVerdict } from './embedded/yq';

type Pair = readonly [ja: string, en: string];

/** The names of the three tools called `yq` (the values of the setting `bashExplainer.yq.flavor`). */
export const YQ_NAMES: Record<YqFlavor, [string, string]> = {
  mikefarah4: ['mikefarah/yq v4', 'mikefarah/yq v4'],
  kislyuk: ['kislyuk/yq（Python 版。jq のラッパー）', 'kislyuk/yq (the Python jq wrapper)'],
  mikefarah3: ['mikefarah/yq v3', 'mikefarah/yq v3'],
};

/** Marks "a jq-style expression" in the missing features of v3. */
export const JQ_STYLE = '\u0000jq-style';

/** The verdict as notes in `lang`: what the explanation follows and why, and where the command works. */
function yqNotes(v: YqVerdict, lang: Lang): [flavour: string, compat: string] {
  const s = (ja: string, en: string) => (lang === 'ja' ? ja : en);
  const name = (f: YqFlavor) => YQ_NAMES[f][lang === 'ja' ? 0 : 1];
  const short = (f: YqFlavor) => (f === 'kislyuk' ? 'kislyuk/yq' : name(f));
  const item = (m: string) => (m === JQ_STYLE ? s('jq 形式の式', 'jq-style expressions') : m);
  const ver = (f: YqFlavor) => (f === 'mikefarah4' && v.compat.mikefarah4.min && v.compat.mikefarah4.min !== '4.0.0' ? s(`（v${v.compat.mikefarah4.min} 以降）`, ` (v${v.compat.mikefarah4.min} or later)`) : '');
  const head = v.decided
    ? s(`yq: ${name(v.flavor)}${ver(v.flavor) || (name(v.flavor).endsWith('）') ? '' : ' ')}として解説。根拠: ${v.reasons.map((r) => r[0]).join('、')}`, `yq: explained as ${name(v.flavor)}${ver(v.flavor)}. Because: ${v.reasons.map((r) => r[1]).join('; ')}`)
    : s(`yq: どの yq か判定できないため、${name('mikefarah4')}${ver('mikefarah4') || ' '}として解説（利用者が多いため）`, `yq: which yq this is cannot be told, so it is explained as ${name('mikefarah4')}${ver('mikefarah4')} (the most common one)`);
  const compat = (['mikefarah4', 'kislyuk', 'mikefarah3'] as YqFlavor[]).map((f) => {
    const c = v.compat[f];
    if (c.ok) {
      const extra = f === 'kislyuk' && v.flavor !== 'kislyuk' ? s('。出力は JSON（YAML にするには `-y`）', '; output is JSON (`-y` for YAML)') : '';
      return `${short(f)}${f === 'mikefarah4' ? ver(f) : ''} ✓${extra}`;
    }
    const list = c.missing.slice(0, 2).map(item);
    return `${short(f)} ✗${s(`（${list.join('・')} が使えない）`, ` (no ${list.join(', ')})`)}`;
  });
  return [head, s(`互換性: ${compat.join(' ／ ')}`, `Works with: ${compat.join(' / ')}`)];
}

/** `yq-flavour`: which yq the command is explained as, and why. */
export const yqFlavourText = ({ verdict }: { verdict: YqVerdict }): Pair => [yqNotes(verdict, 'ja')[0], yqNotes(verdict, 'en')[0]];

/** `yq-compat`: which of the three tools the command works with. */
export const yqCompatText = ({ verdict }: { verdict: YqVerdict }): Pair => [yqNotes(verdict, 'ja')[1], yqNotes(verdict, 'en')[1]];
