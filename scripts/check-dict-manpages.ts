/**
 * Maintenance tool, run by hand (not in CI): compares the options in the dictionary with the
 * Debian manual pages and, where the tool is installed, with its `--help`.
 *
 *   npx tsx scripts/check-dict-manpages.ts [--refresh] [--only name,name] [--json]
 *
 * Pages are cached under $MANPAGE_CACHE (default: a directory in the system temp directory), never in the
 * repository.
 * Checked: the commands of core, basic, storage, admin, netadmin, monitor, system, distro and ops (their options and
 * subcommands' options). macOS commands are not on Debian.
 *
 * Output: per command, the options of ours that neither the page nor `--help` mention (suspect),
 * the number of options the page has that we lack, and the commands without a page.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { basic } from '../src/dict/basic';
import { storage } from '../src/dict/storage';
import { admin } from '../src/dict/admin';
import { netadmin } from '../src/dict/netadmin';
import { monitor } from '../src/dict/monitor';
import { core } from '../src/dict/commands';
import { system } from '../src/dict/system';
import { distro } from '../src/dict/distro';
import { ops } from '../src/dict/ops';
import type { CommandSpec } from '../src/argv/spec';

const SUITE = 'trixie'; // the current Debian stable release
const BASE = 'https://manpages.debian.org';
const SECTIONS = ['1', '8', '5', '1ssl', '7'];
const cacheDir = process.env.MANPAGE_CACHE ?? path.join(os.tmpdir(), 'dict-manpages');
const args = process.argv.slice(2);
const refresh = args.includes('--refresh');
const asJson = args.includes('--json');
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');

// Options of some commands live on another page.
const related: Record<string, string[]> = { iptables: ['iptables-extensions'], ip6tables: ['iptables-extensions'], apache2ctl: ['apache2'], apachectl: ['apache2'], httpd: ['apache2'], dpkg: ['dpkg-query'] };

// Commands that must not be run for `--help` (they may act instead of printing help).
const noHelp = new Set(['reboot', 'halt', 'poweroff', 'shutdown', 'init', 'telinit', 'kill', 'killall', 'pkill', 'sleep', 'wall', 'write', 'mkfs', 'fdisk', 'parted', 'dd', 'swapoff', 'umount', 'chroot', 'su', 'sudo', 'passwd', 'login', 'vi', 'vim', 'nano', 'less', 'more', 'top', 'htop', 'watch', 'screen', 'tmux']);

/** Option names of one table entry, including its subcommands' options (prefixed by the path). */
function collect(prefix: string, doc: CommandSpec, into: Map<string, string[]>): void {
  const names = (doc.options ?? []).flatMap((o) => o.names);
  if (names.length) into.set(prefix, names);
  for (const [sub, d] of Object.entries(doc.subcommands ?? {})) collect(`${prefix} ${sub}`, d, into);
}

function targets(): Map<string, Map<string, string[]>> {
  const out = new Map<string, Map<string, string[]>>();
  const add = (cmdName: string, key: string, names: string[]): void => {
    const m = out.get(cmdName) ?? new Map<string, string[]>();
    m.set(key, [...(m.get(key) ?? []), ...names]);
    out.set(cmdName, m);
  };
  for (const table of [core, basic, storage, admin, netadmin, monitor, system, distro, ops]) {
    for (const [name, doc] of Object.entries(table)) {
      const m = new Map<string, string[]>();
      collect(name, doc, m);
      for (const [k, v] of m) add(name, k, v);
      if (!m.size) out.set(name, out.get(name) ?? new Map());
    }
  }
  return out;
}

/** The page source of a command, from the cache or manpages.debian.org; null when there is none. */
async function page(name: string): Promise<string | null> {
  fs.mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, name.replace(/[^\w.+-]/g, '_') + '.roff');
  if (!refresh && fs.existsSync(file)) {
    const t = fs.readFileSync(file, 'utf8');
    return t === '' ? null : t;
  }
  let text = '';
  for (const sec of SECTIONS) {
    // /<suite>/<name>.<section> redirects to /<suite>/<package>/<name>.<section>.<language>.html
    let url: string | undefined;
    const res = await fetch(`${BASE}/${SUITE}/${name}.${sec}`).catch(() => null);
    if (!res?.ok) continue;
    const want = new RegExp(`/${SUITE}/[^/"]+/${name.replace(/[.+]/g, '\\$&')}\\.${sec}\\.en\\.html`);
    if (want.test(res.url)) url = res.url;
    else url = BASE + (want.exec(await res.text())?.[0] ?? '');
    if (url === BASE) continue; // only another language or another section of that name
    const raw = await fetch(url.replace(/\.html$/, '.gz')).catch(() => null);
    if (raw?.ok) {
      text = await raw.text();
      break;
    }
  }
  const so = /^\.so\s+man\d\/(.+)\.\d\s*$/m.exec(text);
  if (so && text.length < 400) text = (await page(so[1])) ?? text;
  for (const extra of related[name] ?? []) text += '\n' + ((await page(extra)) ?? '');
  fs.writeFileSync(file, text);
  return text === '' ? null : text;
}

/** Option-like words in roff source, with the escapes of `\-`, fonts and so on handled. */
function pageOptions(src: string): Set<string> {
  // .so redirects carry no options; the text itself is what counts.
  const text = src
    .replace(/\\f(\[[^\]]*\]|\(..|.)/g, '')
    .replace(/\\\*\[?[A-Za-z]*\]?/g, '')
    .replace(/\\(-|e|\(hy|\(en|\(em)/g, '-')
    .replace(/\\&|\\\||\\\^|\\\//g, '')
    .replace(/\\ /g, ' ');
  const out = new Set<string>();
  // mdoc pages write flags as `.Fl x`, `.Fl -long`, `.Op Fl abc`
  for (const m of text.matchAll(/\bFl\s+(?:\\&)?([A-Za-z0-9#?-][\w.+-]*)/g)) {
    const t = m[1].replace(/[.-]+$/, '');
    out.add('-' + t);
    if (!t.startsWith('-') && t.length > 1) for (const c of t) out.add('-' + c);
  }
  for (const m of text.matchAll(/^\.(?:It|Op|Fl)\b.*\bFl\b.*$/gm)) {
    for (const w of m[0].matchAll(/(?:^|[\s,])-([A-Za-z][\w-]*)/g)) out.add('--' + w[1]);
  }
  for (const m of text.matchAll(/(?<![\w\-./])(--?[A-Za-z0-9#?][\w+.-]*)(?:\[([^\]]*)\])?/g)) {
    const w = m[1].replace(/[.-]+$/, '');
    out.add(w);
    // bundled short options (`-abc`, `-lh`): each letter counts, which is lenient on purpose
    out.add(m[1].replace(/-+$/, ''));
    if (/^-[A-Za-z0-9]{2,}$/.test(w)) for (const c of w.slice(1)) out.add('-' + c);
    if (w.startsWith('--no-')) out.add('--' + w.slice(5));
  }
  for (const m of text.matchAll(/--\[no-?\]([\w-]+)/g)) (out.add('--' + m[1]), out.add('--no-' + m[1]));
  // `[-abc]` and `-[abc]` in synopses
  for (const m of text.matchAll(/\[?-\[?([A-Za-z0-9]{1,})\]?/g)) if (m[1].length <= 12) for (const c of m[1]) out.add('-' + c);
  return out;
}

function helpOptions(name: string): Set<string> | null {
  if (noHelp.has(name)) return null;
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dict-help-'));
  try {
    const out = (flag: string): string => {
      try {
        return execFileSync(name, [flag], { cwd, timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
      } catch (e) {
        const x = e as { stdout?: string; stderr?: string; code?: string };
        if (x.code === 'ENOENT') throw e;
        return (x.stdout ?? '') + (x.stderr ?? '');
      }
    };
    return pageOptions(out('--help') + '\n' + out('-h'));
  } catch {
    return null;
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const all = targets();
  const noPage: string[] = [];
  const report: Record<string, { suspect: Record<string, string[]>; missing: number }> = {};
  for (const [name, entries] of [...all].sort()) {
    if (only && !only.includes(name)) continue;
    const src = await page(name);
    const help = helpOptions(name);
    if (src === null && help === null) {
      noPage.push(name);
      continue;
    }
    const base = new Set([...(src ? pageOptions(src) : []), ...(help ?? [])]);
    const ours = new Set<string>();
    const suspect: Record<string, string[]> = {};
    for (const [key, keys] of entries) {
      // `docker stats`, `openssl enc`, `perf record`: the subcommand often has a page of its own
      let known = base;
      if (key !== name) {
        const subPage = await page(`${name}-${key.slice(name.length + 1).replace(/ /g, '-')}`);
        if (subPage) known = new Set([...base, ...pageOptions(subPage)]);
      }
      for (const k of keys) {
        ours.add(k);
        const signal = /^-([A-Z]{2,7}\d*|\d{1,2})$/.test(k) && (known.has('-signal') || known.has('-SIGNAL') || known.has('-s'));
        if (!known.has(k) && !signal) (suspect[key] ??= []).push(k);
      }
    }
    const missing = [...(src ? pageOptions(src) : [])].filter((o) => o.length > 2 && o.startsWith('--') && !ours.has(o)).length;
    if (Object.keys(suspect).length || missing) report[name] = { suspect, missing };
  }
  if (asJson) return void console.log(JSON.stringify({ noPage, report }, null, 1));
  for (const [name, r] of Object.entries(report)) {
    const s = Object.entries(r.suspect).map(([k, v]) => `${k}: ${v.join(' ')}`).join(' | ');
    if (s || r.missing) console.log(`${name}${s ? `  SUSPECT ${s}` : ''}  (page has ${r.missing} long options we lack)`);
  }
  console.log(`\nNo page found (${noPage.length}): ${noPage.join(' ')}`);
}

void main();
