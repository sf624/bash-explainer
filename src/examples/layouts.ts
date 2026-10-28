// What a command prints, as made-up lines of the real layout, for the examples of the commands after it in a pipeline
// (`ps aux | awk '{print $2}'`): the spec of the command chooses the layout (`CommandSpec.layouts`), and this module
// makes the lines. The columns are those of procps-ng 4 and GNU coreutils 9 (test/examples-layouts.test.ts compares
// them with the real tools).
import type { ArgvParse } from '../argv/interpret';
import { givenOptions } from '../argv/query';
import type { CommandSpec, Layout } from '../argv/spec';

/**
 * A command of the pipeline as it runs: its argument list (`argv`, as ps shows it), and the path bash runs it by when
 * it does not find it in PATH (`/bin/env`, or a path `hash -p` gave the name).
 */
export interface Run { argv: string[]; path?: string }

/** A column of a table: its width, and whether its cells are aligned on the right. */
interface Column { width: number; right?: boolean }

/**
 * Lines of a table whose columns are one space apart, each cell padded to its column's width; a cell wider than its
 * column pushes the next ones right, and the padding of the next cells takes that back where it can (as procps does).
 * The last column is not padded.
 */
function table(columns: Column[], rows: string[][]): string[] {
  return rows.map((row) => {
    let line = '';
    let at = 0;
    row.forEach((cell, i) => {
      const col = columns[i];
      if (i) line += ' ';
      at += i ? col.width + 1 : col.width;
      const last = i === row.length - 1;
      // (What the line is ahead of the columns: the padding of this cell takes it back.)
      const room = Math.max(at - line.length, cell.length);
      line += col.right ? cell.padStart(room) : last ? cell : cell.padEnd(room);
    });
    return line;
  });
}

/** A process of the made-up system: its user, PID, parent, CPU and memory, and command line (`args`). */
interface Proc { user: string; pid: number; ppid: number; cpu: string; mem: string; vsz: number; rss: number; tty: string; stat: string; start: string; time: string; args: string; comm: string }

/** The processes of the made-up system, before the commands of the pipeline (a wide cell pushes the next ones: python's VSZ). */
const SYSTEM: Proc[] = [
  { user: 'root', pid: 1, ppid: 0, cpu: '0.0', mem: '0.1', vsz: 167744, rss: 11904, tty: '?', stat: 'Ss', start: '09:12', time: '0:02', args: '/sbin/init', comm: 'init' },
  { user: 'root', pid: 845, ppid: 1, cpu: '0.0', mem: '0.0', vsz: 55220, rss: 1640, tty: '?', stat: 'Ss', start: '09:12', time: '0:00', args: 'nginx: master process /usr/sbin/nginx', comm: 'nginx' },
  { user: 'www-data', pid: 846, ppid: 845, cpu: '0.0', mem: '0.0', vsz: 55856, rss: 5560, tty: '?', stat: 'S', start: '09:12', time: '0:00', args: 'nginx: worker process', comm: 'nginx' },
  { user: 'alice', pid: 2140, ppid: 2139, cpu: '0.0', mem: '0.0', vsz: 10052, rss: 5248, tty: 'pts/0', stat: 'Ss', start: '09:30', time: '0:00', args: '-bash', comm: 'bash' },
  { user: 'alice', pid: 2301, ppid: 2140, cpu: '12.5', mem: '1.1', vsz: 1412880, rss: 192312, tty: 'pts/0', stat: 'Sl', start: '09:41', time: '1:14', args: 'python3 app.py', comm: 'python3' },
];

/** The PID of the first command of the pipeline; the shell starts each after the one before it. */
const FIRST_PID = 2388;

/**
 * The processes: the system's, then the commands of the pipeline (`procs`, in order: they run
 * at the same time as ps; `self`, the index of ps among them). A command whose words are not known has no row.
 */
function processes(procs: (Run | undefined)[], self: number): Proc[] {
  const own = procs.flatMap((run, i): Proc[] => (run ? [{
    user: 'alice', pid: FIRST_PID + i, ppid: 2140, cpu: '0.0', mem: '0.0', vsz: 6480 + 1120 * i, rss: 2304 + 640 * i,
    tty: 'pts/0', stat: i === self ? 'R+' : 'S+', start: '09:45', time: '0:00', args: run.argv.join(' '), comm: comm(run.path ?? run.argv[0]),
  }] : []));
  return [...SYSTEM, ...own];
}

/** `HH:MM:SS` of ps's full formats, from the `M:SS` of its BSD one. */
const longTime = (t: string): string => {
  const [m, s] = t.split(':').map(Number);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

/**
 * The name of a program, as ps's `comm` shows it: the base name of the file run, cut to 15 bytes by the kernel; procps
 * shows each byte of a character cut in two as `?`.
 */
function comm(file: string): string {
  const base = file.slice(file.lastIndexOf('/') + 1);
  const bytes = new TextEncoder().encode(base);
  if (bytes.length <= 15) return base;
  // (`end`: the first byte of the character the cut falls in, or the cut.)
  let end = 15;
  while ((bytes[end] & 0xc0) === 0x80) end--;
  return new TextDecoder().decode(bytes.subarray(0, end)) + '?'.repeat(15 - end);
}

/** One entry of the made-up directory: its mode, links, owner, size, date and name. */
interface Entry { mode: string; links: number; owner: string; size: number; date: string; name: string }

/** The made-up directory (`.` and `..`, the hidden file, then the others), sorted by name in every locale. */
const DIRECTORY: Entry[] = [
  { mode: 'drwxr-x---', links: 4, owner: 'alice', size: 4096, date: 'Mar  3 09:20', name: '.' },
  { mode: 'drwxr-xr-x', links: 4, owner: 'root', size: 4096, date: 'Jan 10 08:00', name: '..' },
  { mode: '-rw-r--r--', links: 1, owner: 'alice', size: 3771, date: 'Jan 10 08:00', name: '.bashrc' },
  { mode: 'drwxr-xr-x', links: 2, owner: 'alice', size: 4096, date: 'Mar  3 09:15', name: 'docs' },
  { mode: '-rw-r--r--', links: 1, owner: 'alice', size: 220, date: 'Mar  1 18:02', name: 'notes.txt' },
  { mode: '-rw-r--r--', links: 1, owner: 'alice', size: 18410, date: 'Feb 27 11:47', name: 'report.csv' },
  { mode: '-rwxr-xr-x', links: 1, owner: 'alice', size: 1532, date: 'Mar  3 09:20', name: 'run.sh' },
  { mode: 'drwxr-xr-x', links: 3, owner: 'alice', size: 4096, date: 'Feb 20 16:33', name: 'src' },
];

/** The blocks of 1 KiB a file takes on a file system of 4 KiB blocks, as `total` counts them. */
const blocks = (size: number): number => Math.ceil(size / 4096) * 4;

/** A size as `ls -h` prints it: in powers of 1024, rounded up, with one decimal below 10. */
function human(size: number): string {
  if (size < 1024) return String(size);
  const k = size / 1024;
  return k < 10 ? `${(Math.ceil(k * 10) / 10).toFixed(1)}K` : `${Math.ceil(k)}K`;
}

/** What `ls -l` prints of the entries: the total, then a line each, its columns as wide as their widest cell. */
function longListing(entries: Entry[], size: (n: number) => string, total: string): string[] {
  const rows = entries.map((e) => [e.mode, String(e.links), e.owner, e.owner, size(e.size), e.date, e.name]);
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  const right = [false, true, false, false, true, false, false];
  return [`total ${total}`, ...table(widths.map((width, i) => ({ width, right: right[i] })), rows)];
}

/** The made-up file systems of `df -h`. */
const FILE_SYSTEMS = [
  ['tmpfs', '392M', '1.6M', '390M', '1%', '/run'],
  ['/dev/sda2', '98G', '41G', '52G', '45%', '/'],
  ['tmpfs', '2.0G', '0', '2.0G', '0%', '/dev/shm'],
  ['/dev/sda1', '511M', '6.1M', '505M', '2%', '/boot/efi'],
  ['/dev/sdb1', '916G', '603G', '267G', '70%', '/data'],
];

/** The variables of the made-up environment, in the order a login shell exports them. */
const ENVIRONMENT = [
  'SHELL=/bin/bash', 'PWD=/home/alice', 'LOGNAME=alice', 'HOME=/home/alice', 'LANG=en_US.UTF-8', 'TERM=xterm-256color',
  'USER=alice', 'PATH=/usr/local/bin:/usr/bin:/bin',
];

/**
 * Made-up lines of what a command prints in the layout `kind`. `procs`: the commands of the pipeline (undefined where
 * their words are not known), `self` the index of this one: ps lists them too, since they run at the same time; env
 * ends with `_`, the path bash ran it by (found in the made-up PATH, `/usr/bin`, unless it has a path of its own).
 */
export function layoutSample(kind: Layout, procs: (Run | undefined)[], self: number): string[] {
  switch (kind) {
    case 'ps-bsd-u': {
      const cols: Column[] = [{ width: 8 }, { width: 7, right: true }, { width: 4, right: true }, { width: 4, right: true }, { width: 6, right: true }, { width: 5, right: true }, { width: 8 }, { width: 4 }, { width: 5 }, { width: 6, right: true }, { width: 0 }];
      const rows = processes(procs, self).map((p) => [p.user, String(p.pid), p.cpu, p.mem, String(p.vsz), String(p.rss), p.tty, p.stat, p.start, p.time, p.args]);
      return table(cols, [['USER', 'PID', '%CPU', '%MEM', 'VSZ', 'RSS', 'TTY', 'STAT', 'START', 'TIME', 'COMMAND'], ...rows]);
    }
    case 'ps-full': {
      const cols: Column[] = [{ width: 8 }, { width: 7, right: true }, { width: 7, right: true }, { width: 2, right: true }, { width: 5 }, { width: 8 }, { width: 8, right: true }, { width: 0 }];
      const rows = processes(procs, self).map((p) => [p.user, String(p.pid), String(p.ppid), String(Math.floor(Number(p.cpu))), p.start, p.tty, longTime(p.time), p.args]);
      return table(cols, [['UID', 'PID', 'PPID', 'C', 'STIME', 'TTY', 'TIME', 'CMD'], ...rows]);
    }
    case 'ps': {
      // (The processes of this terminal, by the name of their program.)
      const cols: Column[] = [{ width: 7, right: true }, { width: 8 }, { width: 8, right: true }, { width: 0 }];
      const rows = processes(procs, self).filter((p) => p.tty === 'pts/0').map((p) => [String(p.pid), p.tty, longTime(p.time), p.comm]);
      return table(cols, [['PID', 'TTY', 'TIME', 'CMD'], ...rows]);
    }
    case 'ls': return DIRECTORY.filter((e) => !e.name.startsWith('.')).map((e) => e.name);
    case 'ls-long':
    case 'ls-long-human': {
      const shown = DIRECTORY.filter((e) => !e.name.startsWith('.'));
      const total = shown.reduce((n, e) => n + blocks(e.size), 0);
      return kind === 'ls-long' ? longListing(shown, String, String(total)) : longListing(shown, human, `${total}K`);
    }
    case 'ls-long-all': return longListing(DIRECTORY, String, String(DIRECTORY.reduce((n, e) => n + blocks(e.size), 0)));
    case 'df-human': {
      const cols: Column[] = [{ width: 15 }, { width: 4, right: true }, { width: 5, right: true }, { width: 5, right: true }, { width: 4, right: true }, { width: 0 }];
      return table(cols, [['Filesystem', 'Size', 'Used', 'Avail', 'Use%', 'Mounted on'], ...FILE_SYSTEMS]);
    }
    case 'who': {
      const cols: Column[] = [{ width: 8 }, { width: 12 }, { width: 0 }];
      return table(cols, [['alice', 'pts/0', '2026-03-03 09:30 (192.168.1.20)'], ['bob', 'pts/1', '2026-03-03 10:02 (192.168.1.31)'], ['alice', 'tty1', '2026-03-03 08:12']]);
    }
    case 'env': return [...ENVIRONMENT, `_=${procs[self]!.path ?? `/usr/bin/${procs[self]!.argv[0]}`}`];
  }
}

/** The roles of the words of a command that prints a layout: its options and their values, and `--`. */
const OPTION_WORDS = new Set(['option', 'cluster', 'old-style', 'value', 'end-of-options']);

/**
 * The layout of what the command prints (`CommandSpec.layouts`): the alternative whose options are exactly those given
 * (`ps aux`, `ls -l`), when every word is an option. Undefined for other options, an option the spec does not know, or
 * any other word: an operand (`ls -l /etc` lists files not made up here), a command it runs (`env find .` prints what
 * find prints, not the environment), a pattern option (`env -` starts from an empty environment).
 */
export function layoutOf(spec: CommandSpec | undefined, parse: ArgvParse): Layout | undefined {
  if (!spec?.layouts || parse.roles.some(({ role }) => !OPTION_WORDS.has(role.role))) return undefined;
  const given = givenOptions(parse).map(({ role }) => (role.role === 'option' ? role.spec.names[0] : undefined));
  if (given.includes(undefined)) return undefined;
  const names = new Set(given);
  return spec.layouts.find((alt) => alt.options.length === names.size && alt.options.every((o) => names.has(o)))?.layout;
}
