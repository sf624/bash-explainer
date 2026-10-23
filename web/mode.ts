// Which of the site's pages this copy of the script runs. The same script serves three pages:
//  - the editor (index.html): the editor and the explanation panel in a frame;
//  - compare (compare.html): the editor and two frames, each holding a copy of the page in panel mode;
//  - panel (`?view=panel`): only the explanation panel. The script, the cursor and the rest come from the page around it.

export type PageKind = 'editor' | 'compare' | 'panel';

export interface PageMode {
  readonly page: PageKind;
  /** compare.html: the editor and two frames, each holding a copy of this page in panel mode. */
  readonly compare: boolean;
  /** `?view=panel`: the explanation panel only. */
  readonly panel: boolean;
  /** Whether the page has its own problems list, lint marks, dividers and settings (the panel copy has none). */
  readonly hasChrome: boolean;
}

export function pageMode(page: PageKind): PageMode {
  return { page, compare: page === 'compare', panel: page === 'panel', hasChrome: page !== 'panel' };
}

function detect(): PageKind {
  if (document.body.dataset.page === 'compare') return 'compare';
  return new URLSearchParams(location.search).get('view') === 'panel' ? 'panel' : 'editor';
}

export const mode: PageMode = pageMode(detect());
