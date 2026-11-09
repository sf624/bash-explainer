import type { Lang } from './i18n';
import { manualLabel, SECTIONS } from './manual';
import { PYTHON_REFERENCE } from './python-reference';

// What an explanation or a note cites (`Token.refs`, the sections of a fact in src/messages.ts): a section of the bash
// manual by its number ('3.8', src/manual.ts), or another document by an id of its own, from the table below: manual pages
// of the Linux man-pages project ('execve(2)'), where the kernel, not bash, does what the token is about, and parts of
// Python's documentation ('python-re-functions'), where a fact is about Python code (docs/design/python-regex.md, 5.3).
// Every output renders the ids through `reference`, and the web hover keeps only the links of `REFERENCE_URLS`.

/**
 * A page of another document: a manual page (`man`: its name and section, 'execve', '2'), or a part of Python's documentation of the
 * reference release (`python`: its module, 're'); the heading of the part cited, and its URL.
 */
export interface ManPage { kind: 'man' | 'python'; page: string; section?: string; anchor: string; url: string }

/** The other documents cited, by id: `page(section)` for a manual page, `python-…` for Python's documentation. */
const MAN_PAGES: Readonly<Record<string, ManPage>> = {
  'execve(2)': { kind: 'man', page: 'execve', section: '2', anchor: 'Interpreter scripts', url: 'https://man7.org/linux/man-pages/man2/execve.2.html' },
  'python-re-functions': { kind: 'python', page: 're', anchor: 'Functions', url: `https://docs.python.org/${PYTHON_REFERENCE}/library/re.html#functions` },
};

/** A reference as every output names it: `text`, its link's text (§3.8, execve(2), re); `title`, what it is about; `url`, its page. */
export interface Reference { id: string; kind: 'bash' | 'man' | 'python'; text: string; title: string; url: string }

/** The reference of an id, or undefined for an id of neither table. */
export function reference(id: string): Reference | undefined {
  const s = SECTIONS.get(id);
  if (s) return { id, kind: 'bash', text: `§${id}`, title: s.title, url: s.url };
  const m = MAN_PAGES[id];
  return m && { id, kind: m.kind, text: m.section ? `${m.page}(${m.section})` : m.page, title: m.anchor, url: m.url };
}

/** Every page an explanation can link to: the manual's sections, the manual pages and Python's documentation. */
export const REFERENCE_URLS: ReadonlySet<string> = new Set([...[...SECTIONS.values()].map((s) => s.url), ...Object.values(MAN_PAGES).map((m) => m.url)]);

/** "Linux manual page execve(2)", "Python documentation re": how a link to another document is labelled (its title, beside the part's heading). */
function manLabel(lang: Lang, r: Reference): string {
  const what = r.kind === 'man' ? (lang === 'ja' ? 'Linux マニュアルページ' : 'Linux manual page') : lang === 'ja' ? 'Python のドキュメント' : 'Python documentation';
  return `${what} ${r.text}`;
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
  const pages = refs.filter((r) => r.kind !== 'bash').map((r) => link(r, r.text));
  const [first, ...rest] = sections;
  return [...(sections.length ? [[manualLabel(lang, [first]), ...rest].join(', ')] : []), ...(pages.length ? [pages.join(', ')] : [])].join('; ');
}
