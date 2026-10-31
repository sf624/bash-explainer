// The version of the page: the menu's switch between the release and the development version, and the banner of the
// development version and of the previews (/next/, /pr/N/).
import type { Lang } from '../src/i18n';
import { CHANNEL, COMMIT, PR, UP } from './build-info';
import { $, put } from './dom';
import { TEXT } from './text';

/** Fills the version switch and the banner in the page's language. */
export function showChannel(lang: Lang): void {
  const t = TEXT[lang];
  // The release page has no version switch (the build leaves it out); the development and preview pages do.
  put('channel-label', t.version);
  $<HTMLSelectElement>('channel')?.replaceChildren(
    new Option(t.release, 'release', false, false),
    new Option(CHANNEL === 'next' ? `${t.development}, ${COMMIT})` : `${t.development})`, 'next', false, CHANNEL === 'next'),
    // A preview has its own entry, the current one; the other pages do not list previews.
    ...(CHANNEL === 'pr' ? [new Option(`${t.pr} #${PR}, ${COMMIT}`, 'pr', false, true)] : []),
  );
  if (!document.getElementById('channel-banner')) {
    // The compare page has no banner.
  } else if (CHANNEL !== 'release') {
    const code = Object.assign(document.createElement('code'), { textContent: COMMIT });
    const release = $<HTMLAnchorElement>('banner-release');
    // The pages sit at /, /next/ and /pr/N/.
    release.href = UP;
    release.textContent = t.toRelease;
    // From a preview, main is the other copy; from main, the release.
    $('banner-compare').textContent = t.compareLink[CHANNEL];
    if (CHANNEL === 'next') {
      // Ja reads "main の abc1234 からビルドしています。": the commit sits in the middle of the sentence.
      $('banner-text').replaceChildren(t.banner + ' ', code, ' ' + t.bannerTail);
    } else {
      // En reads "Preview of pull request #12 (commit abc1234). Not released."; ja "プルリクエスト #12（コミット abc1234）のプレビュー。未リリース。"
      const open = lang === 'ja' ? '（コミット ' : ' (commit ';
      const close = lang === 'ja' ? '）' : '). ';
      $('banner-text').replaceChildren(`${t.prBanner} #${PR}${open}`, code, close + t.prBannerTail);
      $<HTMLAnchorElement>('banner-pr').href = `https://github.com/sf624/bash-explainer/pull/${PR}`;
      $('banner-pr').textContent = `${t.toPr} #${PR}`;
      $('banner-pr').hidden = false;
      $('banner-pr-sep').hidden = false;
    }
    $<HTMLAnchorElement>('banner-commit').href = `https://github.com/sf624/bash-explainer/commit/${COMMIT}`;
    $('banner-commit').textContent = COMMIT;
    $('channel-banner').hidden = false;
  }
}
