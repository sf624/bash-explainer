import type { Lang } from './i18n';
import { manualLabel, SECTIONS } from './manual';

// What an explanation or a note cites (`Token.refs`, the sections of a fact in src/messages.ts): a section of the bash
// manual by its number ('3.8', src/manual.ts), or another document by an id of its own, from the table below: for now,
// manual pages of the Linux man-pages project ('execve(2)'), where the kernel, not bash, does what the token is about.
// Every output renders the ids through `reference`, and the web hover keeps only the links of `REFERENCE_URLS`.

/** A section of a manual page: its name and section ('execve', '2'), the heading of the part cited, its page on man7.org. */
export interface ManPage { kind: 'man'; page: string; section: string; anchor: string; url: string }

/** The manual pages cited, by id: `page(section)`, or `page(section)/heading` for a second part of a page cited apart. */
const MAN_PAGES: Readonly<Record<string, ManPage>> = {
  'execve(2)': { kind: 'man', page: 'execve', section: '2', anchor: 'Interpreter scripts', url: 'https://man7.org/linux/man-pages/man2/execve.2.html' },
};

/** A reference as every output names it: `text`, its link's text (§3.8, execve(2)); `title`, what it is about; `url`, its page. */
export interface Reference { id: string; kind: 'bash' | 'man'; text: string; title: string; url: string }

/** The reference of an id, or undefined for an id of neither table. */
export function reference(id: string): Reference | undefined {
  const s = SECTIONS.get(id);
  if (s) return { id, kind: 'bash', text: `§${id}`, title: s.title, url: s.url };
  const m = MAN_PAGES[id];
  return m && { id, kind: 'man', text: `${m.page}(${m.section})`, title: m.anchor, url: m.url };
}

/** Every page an explanation can link to: the manual's sections and the manual pages. */
export const REFERENCE_URLS: ReadonlySet<string> = new Set([...[...SECTIONS.values()].map((s) => s.url), ...Object.values(MAN_PAGES).map((m) => m.url)]);

/** "Linux manual page execve(2)": how a link to a manual page is labelled (its title, beside the part's heading). */
function manLabel(lang: Lang, r: Reference): string {
  return `${lang === 'ja' ? 'Linux マニュアルページ' : 'Linux manual page'} ${r.text}`;
}

/** The label a link's tooltip gives a reference: "Bash manual 3.8", "Linux manual page execve(2)". */
export function referenceLabel(lang: Lang, r: Reference): string {
  return r.kind === 'bash' ? manualLabel(lang, [r.id]) : manLabel(lang, r);
}

/**
 * References as text, each through `link` (its text, or a link): the manual's sections after the words "Bash manual"
 * ("Bash manual 3.8, 3.1.3"), then the manual pages ("execve(2)"), the two kinds apart with "; ".
 */
export function referencesWith(lang: Lang, ids: readonly string[], link: (r: Reference, shown: string) => string): string {
  const refs = ids.map((id) => reference(id)!);
  const sections = refs.filter((r) => r.kind === 'bash').map((r) => link(r, r.id));
  const pages = refs.filter((r) => r.kind === 'man').map((r) => link(r, r.text));
  const [first, ...rest] = sections;
  return [...(sections.length ? [[manualLabel(lang, [first]), ...rest].join(', ')] : []), ...(pages.length ? [pages.join(', ')] : [])].join('; ');
}
