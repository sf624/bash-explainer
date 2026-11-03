import { shellFromName } from '../dialect';
import { CI_PROVIDED, ciVariables } from '../dict/ciVariables';
import type { RegionNote } from './index';
import { LineOut, Builder, spaced } from './builder';

/**
 * The scripts of `sh` steps in a Jenkins pipeline: `sh 'cmd'`, `sh "…"`, `sh '''…'''`, `sh """…"""`,
 * `sh(script: '…', returnStdout: true)`, `sh label: 'x', script: '…'`. Jenkins runs them with
 * `/bin/sh -xe` unless the script starts with a shebang.
 */
export function jenkinsfile(b: Builder): void {
  // (Jenkins sets its variables for every `sh` step: `BUILD_NUMBER`, `JOB_NAME`, `WORKSPACE`…)
  b.provided.push(...CI_PROVIDED());
  const start = /\bsh\s*\(?\s*(?:(?:label|returnStdout|returnStatus|encoding)\s*:\s*(?:'[^']*'|"[^"]*"|true|false)\s*,\s*)*(?:script\s*:\s*)?('''|"""|'|")/g;
  for (let i = 0; i < b.lines.length; i++) {
    const line = b.lines[i];
    if (/^\s*\/\//.test(line)) continue;
    start.lastIndex = 0;
    const m = start.exec(line);
    if (!m) continue;
    const quote = m[1];
    const interpolate = quote.startsWith('"');
    const from = m.index + m[0].length;
    // Where the string ends: on this line, or (triple quotes) on a later one.
    let endLine = i;
    let endCol = closingQuote(line, from, quote);
    if (endCol < 0 && quote.length === 3) {
      for (endLine = i + 1; endLine < b.lines.length && (endCol = closingQuote(b.lines[endLine], 0, quote)) < 0; endLine++);
    }
    if (endCol < 0) continue;
    // A triple-quoted script usually starts on the next line.
    const first = quote.length === 3 && !line.slice(from).trim() ? i + 1 : i;
    for (let k = first; k <= endLine; k++) {
      groovyText(b, k, k === i ? from : 0, k === endLine ? endCol : b.lines[k].length, interpolate);
    }
    // A closing triple quote on a line of its own is not part of the script.
    const last = endLine > first && !b.lines[endLine].slice(0, endCol).trim() ? endLine - 1 : endLine;
    // From just after the opening quote: `sh '''#!/bin/bash` starts with its shebang.
    const script = [b.lines[first].slice(first === i ? from : 0), ...b.lines.slice(first + 1, last + 1)].join('\n');
    // `#!/bin/bash`, `#!/usr/bin/env bash`: the last part of the path, or the word after env.
    const shebang = /^\s*#!\s*(?:\S*\/)?(\w+)(?:[ \t]+(\w+))?/.exec(script);
    const shell = shebang ? (shellFromName(shebang[2] && shebang[1] === 'env' ? shebang[2] : shebang[1]) ?? 'sh') : 'sh';
    const notes: RegionNote[] = [];
    if (interpolate && /(^|[^\\])\$[A-Za-z_{]/.test(script)) {
      notes.push({ spec: { id: 'jenkinsfile-groovy-interpolation', params: {} } });
    }
    b.region(first, last, ['Jenkinsfile の `sh` ステップ', 'Jenkinsfile `sh` step'], shell, notes.length ? notes : undefined);
    i = endLine;
  }
}

/** The column of the closing `quote` from `from` on, skipping backslash escapes; -1 if none. */
function closingQuote(line: string, from: number, quote: string): number {
  for (let k = from; k < line.length; k++) {
    if (line[k] === '\\') { k++; continue; }
    if (line.startsWith(quote, k)) return k;
  }
  return -1;
}

/** Copy part of a Groovy string as shell text: undo escapes, and stand in for `${…}` and `$name`. */
function groovyText(b: Builder, i: number, from: number, to: number, interpolate: boolean): void {
  const line = b.lines[i];
  const o = (b.outs[i] ??= new LineOut());
  let k = from;
  while (k < to) {
    const ch = line[k];
    if (ch === '\\' && k + 1 < to && /[\\'"$]/.test(line[k + 1])) {
      o.insert(line[k + 1], k, k + 2);
      k += 2;
      continue;
    }
    if (interpolate && ch === '$') {
      const braced = line[k + 1] === '{' ? line.indexOf('}', k + 2) : -1;
      const bare = /^\$([A-Za-z_][\w.]*)/.exec(line.slice(k, to));
      const end = braced >= 0 && braced < to ? braced + 1 : bare ? k + bare[0].length : -1;
      if (end > 0) {
        const expr = braced >= 0 && braced < to ? line.slice(k + 2, braced).trim() : bare![1];
        // `env.BRANCH_NAME`, `params.TARGET`.
        const envVar = /^env\.(\w+)$/.exec(expr)?.[1];
        const known = envVar && Object.hasOwn(ciVariables, envVar) ? ciVariables[envVar].meaning : /^params\.\w+$/.test(expr) ? { ja: `ビルドパラメータ \`${expr.slice(7)}\``, en: `the build parameter \`${expr.slice(7)}\`` } : undefined;
        const meaning: [string, string] = known
          ? [`${spaced(known.ja)}を表す Groovy の式 \`${expr}\` で、シェルが実行される前に Jenkins が値を埋め込みます`, `the Groovy expression \`${expr}\`: ${known.en}; Jenkins fills in its value before the shell runs`]
          : [`Groovy の式 \`${expr}\` の値で、シェルが実行される前に Jenkins が埋め込みます`, `the value of the Groovy expression \`${expr}\`, filled in by Jenkins before the shell runs`];
        o.insert(`\${${expr.replace(/\W+/g, '_').replace(/^_|_$/g, '').toUpperCase() || 'EXPR'}}`, k, end, meaning);
        b.substitutions.push({ line: i, text: line.slice(k, end), meaning });
        k = end;
        continue;
      }
    }
    o.copy(line, k, k + 1);
    k++;
  }
}

