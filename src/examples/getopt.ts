// Simulates util-linux getopt(1) for worked examples.

export class GetoptUnsupported extends Error {}

export interface GetoptSpec {
  /** Short options as given to `-o`, e.g. `+hv:c::`. */
  short: string;
  /** Long options as given to `--long`, e.g. `help,verbose:,color::`. */
  long: string[];
  /** `-a`: long options may start with a single `-`. */
  alternative?: boolean;
  /** The old form `getopt OPTSTRING ARGS`, which prints words unquoted. */
  legacy?: boolean;
}

/** Number of colons after a short option letter or long name: 0 none, 1 required, 2 optional. */
function shortArity(short: string, c: string): number | undefined {
  const body = short.replace(/^[+-]/, '');
  for (let k = 0; k < body.length;) {
    if (body[k] === ':') { k++; continue; }
    const colons = body.startsWith('::', k + 1) ? 2 : body[k + 1] === ':' ? 1 : 0;
    if (body[k] === c) return colons;
    k += 1 + colons;
  }
  return undefined;
}

function longEntries(long: string[]): [string, number][] {
  return long.map((l) => {
    const name = l.replace(/:+$/, '');
    return [name, l.length - name.length];
  });
}

/** What getopt prints for `args` (the words after `--`), as one line. */
export function runGetopt(spec: GetoptSpec, args: string[]): string {
  const q = (s: string) => (spec.legacy ? s : `'${s.replace(/'/g, "'\\''")}'`);
  const opts: string[] = [];
  const rest: string[] = [];
  const inPlace = spec.short.startsWith('-');
  const stopEarly = spec.short.startsWith('+');
  const longs = longEntries(spec.long);
  const findLong = (name: string): [string, number] => {
    const exact = longs.find(([n]) => n === name);
    if (exact) return exact;
    const prefixed = longs.filter(([n]) => n.startsWith(name));
    if (prefixed.length !== 1) throw new GetoptUnsupported(`--${name}`);
    return prefixed[0];
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      rest.push(...args.slice(i + 1).map(q));
      break;
    }
    const isLong = a.startsWith('--') || (spec.alternative && /^-[^-]/.test(a) && a.length > 2 && longs.some(([n]) => n.startsWith(a.slice(1).split('=')[0])));
    if (isLong && a.length > 2) {
      const body = a.replace(/^--?/, '');
      const eq = body.indexOf('=');
      const [name, arity] = findLong(eq < 0 ? body : body.slice(0, eq));
      opts.push(`--${name}`);
      if (arity === 1) {
        if (eq >= 0) opts.push(q(body.slice(eq + 1)));
        else if (i + 1 < args.length) opts.push(q(args[++i]));
        else throw new GetoptUnsupported('missing value');
      } else if (arity === 2) {
        opts.push(q(eq >= 0 ? body.slice(eq + 1) : ''));
      } else if (eq >= 0) {
        throw new GetoptUnsupported('unexpected value');
      }
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      for (let k = 1; k < a.length; k++) {
        const arity = shortArity(spec.short, a[k]);
        if (arity === undefined) throw new GetoptUnsupported(`-${a[k]}`);
        opts.push(`-${a[k]}`);
        if (arity === 0) continue;
        const attached = a.slice(k + 1);
        if (arity === 1) {
          if (attached) opts.push(q(attached));
          else if (i + 1 < args.length) opts.push(q(args[++i]));
          else throw new GetoptUnsupported('missing value');
        } else {
          opts.push(q(attached));
        }
        break;
      }
      continue;
    }
    // A non-option argument.
    if (stopEarly) {
      rest.push(...args.slice(i).map(q));
      break;
    }
    if (inPlace) opts.push(q(a));
    else rest.push(q(a));
  }
  return ' ' + [...opts, '--', ...rest].join(' ');
}

/** A plausible value for an option, guessed from its name. */
function valueFor(name: string): string {
  if (/out|file|path|log|config|conf|input|dir/i.test(name)) return /dir/i.test(name) ? 'build' : /out/i.test(name) ? 'out.txt' : 'input.txt';
  if (/num|count|level|port|size|limit|max|min|jobs|depth|timeout|retr|verbose/i.test(name)) return '3';
  if (/name|user/i.test(name)) return 'alice';
  if (/colou?r/i.test(name)) return 'always';
  return 'value';
}

/** Sample arguments that exercise the spec: bundled flags, values, long options and operands. */
export function sampleGetoptArgs(spec: GetoptSpec): string[] {
  const body = spec.short.replace(/^[+-]/, '');
  const shorts: [string, number][] = [];
  for (let k = 0; k < body.length;) {
    const colons = body.startsWith('::', k + 1) ? 2 : body[k + 1] === ':' ? 1 : 0;
    shorts.push([body[k], colons]);
    k += 1 + colons;
  }
  const longs = longEntries(spec.long);
  const longName = (c: string) => longs.find(([n]) => n[0] === c)?.[0] ?? c;
  const args: string[] = ['file1.txt'];
  const flags = shorts.filter(([, n]) => n === 0).slice(0, 2).map(([c]) => c);
  if (spec.short.startsWith('+')) args.length = 0;
  if (flags.length) args.push(`-${flags.join('')}`);
  const valued = shorts.find(([, n]) => n === 1);
  if (valued) args.push(`-${valued[0]}`, valueFor(longName(valued[0])));
  const optional = shorts.find(([, n]) => n === 2);
  if (optional) args.push(`-${optional[0]}`);
  const longValued = longs.find(([n, a]) => a === 1 && !(valued && n[0] === valued[0]));
  if (longValued) args.push(`--${longValued[0]}=${valueFor(longValued[0])}`);
  const longOptional = longs.find(([, a]) => a === 2);
  if (longOptional) args.push(`--${longOptional[0]}=${valueFor(longOptional[0])}`);
  const longFlag = longs.find(([n, a]) => a === 0 && !flags.includes(n[0]));
  if (longFlag) args.push(`--${longFlag[0]}`);
  if (spec.short.startsWith('+')) args.push('file1.txt', '-x');
  else args.push('file2.txt');
  return args;
}
