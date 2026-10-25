// The differential test of the values Meaning shows (test/values.test.ts; docs/design/expansion-values.md): the
// scripts of the decisions' test (test/support/decisions.ts), with each marker `: Mk` given expansions to show
// (`: Mk "$mode" "${#flag}" … $v`). The model gives a value to some of them; bash prints each marker's words through
// xtrace, every time it runs. Every value the model gives must be the word bash had, at every run of the marker.
import * as fs from 'fs';
import * as path from 'path';
import { shellState } from '../../src/semantics/state';
import { expansionValue } from '../../src/semantics/values';
import { createUnbashParser } from '../../src/syntax/adapters/unbash';
import { descendants, fields, type SyntaxNode } from '../../src/syntax/tree';
import { forBash, forModel, PRELUDE, runBash, type Script } from './decisions';

/** The words each marker shows: quoted (one field each), then one unquoted (the fields left). */
const WORDS = ['"$mode"', '"${flag}"', '"$v"', '"${#mode}"', '"${flag:-z}"', '"${v%a}"', '"${mode/a/o}"', '"$r"', '$v'];

/** The script with expansions after each marker. */
export const withWords = (s: Script): Script => ({ ...s, text: s.text.replace(/: (M\d+)(?=[;\n ⟦}]|$)/g, (_, m: string) => `: ${m} ${WORDS.join(' ')}`) });

/** The words of a line of bash's xtrace (`+X : M5 a '' 'a b' $'x\ty'`), unquoted. */
export function traceWords(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    while (line[i] === ' ') i++;
    if (i >= line.length) break;
    let w = '';
    while (i < line.length && line[i] !== ' ') {
      if (line.startsWith("$'", i)) {
        i += 2;
        while (line[i] !== "'") {
          if (line[i] === '\\') {
            const c = line[i + 1];
            w += c === 'n' ? '\n' : c === 't' ? '\t' : c;
            i += 2;
          } else w += line[i++];
        }
        i++;
      } else if (line[i] === "'") {
        const end = line.indexOf("'", i + 1);
        w += line.slice(i + 1, end);
        i = end + 1;
      } else if (line[i] === '\\') {
        w += line[i + 1];
        i += 2;
      } else w += line[i++];
    }
    out.push(w);
  }
  return out;
}

export interface ValuesChecked {
  problems: string[];
  /** How many words the model gave a value to, and how many of their runs bash had. */
  shown: number;
  compared: number;
}

const parser = createUnbashParser();
/** How much of a run's trace is read. */
const TRACE_READ = 2 << 20;

/** The values the model gives on `s` (with `withWords`), checked against a run of bash in `dir`. */
export async function checkValues(s: Script, dir: string): Promise<ValuesChecked> {
  const script = withWords(s);
  const { src } = forModel(script.text);
  // The model's words at each marker: the value of each, or undefined.
  const want = new Map<string, (string[] | undefined)[]>();
  let shown = 0;
  const tree = parser.parse(src);
  const state = shellState(tree, 'bash');
  for (const c of descendants(tree.root, ['command'])) {
    const m = /^: (M\d+) /.exec(c.text);
    if (!m) continue;
    const words = fields(c, 'argument').slice(1);
    const values = words.map((w: SyntaxNode) => {
      const v = expansionValue(w.type === 'string' ? w.namedChildren[0] : w, state);
      // (A value with a glob is matched against the files of the run's directory: not compared here.)
      return v && !v.glob ? (v.words ?? [v.text]) : undefined;
    });
    shown += values.filter(Boolean).length;
    want.set(m[1], values);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  if (s.lib !== undefined) fs.writeFileSync(path.join(dir, 'lib.sh'), `${s.lib}\n`);
  fs.writeFileSync(path.join(dir, 's.sh'), `${PRELUDE}${forBash(script.text, new Map())}\nwait\n`);
  await runBash(dir, 's.sh');
  // (A loop with no end fills the trace until the run is stopped: its first megabytes are enough.)
  const fd = fs.openSync(path.join(dir, 'trace'), 'r');
  const buf = Buffer.alloc(TRACE_READ);
  const trace = buf.subarray(0, fs.readSync(fd, buf, 0, TRACE_READ, 0)).toString('utf8').replace(/[^\n]*$/, '');
  fs.closeSync(fd);
  fs.rmSync(dir, { recursive: true, force: true });
  const problems = new Set<string>();
  let compared = 0;
  // (Each line once: a loop with no end runs its markers many times, until the run is stopped.)
  for (const line of new Set(trace.match(/^\+*X : M\d+ .*$/gm))) {
    const t = /^\+*X : (M\d+) (.*)$/.exec(line)!;
    const values = want.get(t[1]);
    if (!values) continue;
    const got = traceWords(t[2]);
    // The quoted words are one field each; the last, unquoted, has the fields left.
    const quoted = WORDS.length - 1;
    values.forEach((v, i) => {
      if (!v) return;
      compared++;
      const bash = i < quoted ? [got[i]] : got.slice(quoted);
      if (JSON.stringify(bash) !== JSON.stringify(v)) problems.add(`${t[1]} ${WORDS[i]}: model ${JSON.stringify(v)}, bash ${JSON.stringify(bash)}`);
    });
  }
  return { problems: [...problems], shown, compared };
}

/** Checks `list` with `jobs` runs of bash at a time, in directories under `dir`. */
export async function checkAllValues(list: Script[], dir: string, jobs: number): Promise<ValuesChecked[]> {
  const out: ValuesChecked[] = new Array(list.length);
  let next = 0;
  const worker = async (slot: number): Promise<void> => {
    while (next < list.length) {
      const k = next++;
      out[k] = await checkValues(list[k], path.join(dir, String(slot)));
    }
  };
  await Promise.all(Array.from({ length: jobs }, (_, j) => worker(j)));
  return out;
}
