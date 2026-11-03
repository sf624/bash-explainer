import { type Shell, shellFromName } from '../dialect';
import { azureVariables as AZURE_VARIABLES, CI_PROVIDED, githubContext } from '../dict/ciVariables';
import type { HostCi, RegionNote } from './index';
import type { FactSpec } from '../messages';
import { LineOut, Builder, spaced, indentOf } from './builder';

/** Keys whose value is a shell script in common CI systems. */
const YAML_KEYS = /^(run|script|before_script|after_script|bash|sh|cmds?|command)$/;

/** What one CI system's YAML says about its steps. A file can match more than one system; `stepCi` picks per step. */
interface CiSystem {
  /** Whether the file looks like this system's. */
  detect: (lines: string[]) => boolean;
  /** The label of a step (ja, en). */
  label: (key: string) => [string, string];
  /** A step this system does not run as a shell script (`parent` is the line the key sits under). */
  skips?: (lines: string[], key: string, parent: () => string | undefined) => boolean;
  /** Whether a `command:` key holds a shell script (otherwise it is no step). */
  commandIsShell: boolean;
}

const CI_SYSTEMS: Record<HostCi, CiSystem> = {
  azure: {
    detect: (lines) => lines.some((l) => /^\s*(pool|trigger)\s*:|^\s*-\s+task\s*:|vmImage\s*:/.test(l)),
    label: (key) => [`Azure Pipelines の \`${key}:\` ステップ`, `Azure Pipelines \`${key}:\` step`],
    // Azure Pipelines runs `script:` with cmd.exe on Windows agents.
    skips: (lines, key) => key === 'script' && lines.some((l) => /vmImage\s*:\s*['"]?windows/i.test(l)),
    commandIsShell: false,
  },
  circleci: {
    detect: (lines) => !lines.some((l) => /^\s*runs-on\s*:/.test(l)) && lines.some((l) => /^version\s*:\s*['"]?2(\.\d)?['"]?\s*$/.test(l)),
    label: () => ['CircleCI の `run` ステップ', 'CircleCI `run` step'],
    commandIsShell: false,
  },
  github: {
    detect: (lines) => lines.some((l) => /^\s*(runs-on|steps|jobs)\s*:/.test(l)),
    label: () => ['GitHub Actions の `run:` ステップ', 'GitHub Actions `run:` step'],
    // An action's input (`with: script:` of actions/github-script is JavaScript), not a shell script.
    skips: (_lines, key, parent) => key !== 'run' && /^\s*with\s*:\s*$/.test(parent() ?? ''),
    commandIsShell: true,
  },
};

/** The CI system a step with this key belongs to, among the systems the file matches (`found`). */
function stepCi(b: Builder, at: number, indent: number, key: string, found: readonly HostCi[]): HostCi | undefined {
  if (found.includes('azure') && (key === 'script' || key === 'bash')) return 'azure';
  // CircleCI's `run:` with `command:` under it, or `run:` with the command itself.
  if (key === 'command' && /^\s*(-\s+)?run\s*:\s*$/.test(parentLine(b, at, indent) ?? '')) return 'circleci';
  if (found.includes('circleci') && key === 'run') return 'circleci';
  if (found.includes('github') && key === 'run') return 'github';
  return undefined;
}

export function yaml(b: Builder): void {
  const found = (Object.keys(CI_SYSTEMS) as HostCi[]).filter((id) => CI_SYSTEMS[id].detect(b.lines));
  if (found.includes('azure')) b.azure = { vars: azureVariables(b.lines) };
  // A Travis CI file names its `language:` at the top level.
  const travis = b.lines.some((l) => /^language\s*:/.test(l));
  // (What the CI and the file's `env:` maps set for the scripts, workflow, job or step: taken for every script.)
  if (found.length) b.provided.push(...CI_PROVIDED());
  b.provided.push(...envKeys(b.lines));
  for (let i = 0; i < b.lines.length; i++) {
    const line = b.lines[i];
    const m = /^(\s*(?:-\s+)?)([\w-]+)\s*:(?:\s+(.*))?$/.exec(line);
    if (!m || !YAML_KEYS.test(m[2])) continue;
    const key = m[2];
    const indent = m[1].length;
    const rest = (m[3] ?? '').replace(/\s+#.*$/, '').trimEnd();
    // `defaults: run: shell:` holds no script.
    if (key === 'run' && !rest && /^\s*defaults\s*:/.test(b.lines[i - 1] ?? '')) continue;
    if (found.some((id) => CI_SYSTEMS[id].skips?.(b.lines, key, () => parentLine(b, i, indent)))) continue;
    // CircleCI's `run:` with `name:` and `command:` under it: the command is found as its own key.
    if (key === 'run' && !rest) {
      const next = b.lines.slice(i + 1).find((l) => l.trim());
      if (next && indentOf(next) > indent && !/^\s*-\s/.test(next)) continue;
    }
    const shell = yamlShell(b, i, indent, key, found);
    if (shell === null) continue;
    const first = b.regions.length;
    const keyLine = i;
    const ci = stepCi(b, i, indent, key, found);
    const label: [string, string] = ci ? CI_SYSTEMS[ci].label(key) : [`YAML の \`${key}:\``, `YAML \`${key}:\``];
    const valueAt = line.length - (m[3] ?? '').length;
    if (BLOCK_HEADER.test(rest)) {
      i = yamlBlock(b, i, indent, rest, label, shell);
    } else if (rest) {
      yamlScalar(b, i, valueAt, rest, label, shell);
    } else {
      // A list of commands: `script:` followed by `- cmd` items.
      let j = i + 1;
      while (j < b.lines.length && (!b.lines[j].trim() || indentOf(b.lines[j]) > indent || (indentOf(b.lines[j]) === indent && /^\s*-\s/.test(b.lines[j]) && !/^\s*-\s+[\w-]+\s*:/.test(b.lines[j])))) {
        const item = /^(\s*-\s+)(.*)$/.exec(b.lines[j]);
        if (item) {
          const value = item[2].replace(/\s+#.*$/, '').trimEnd();
          if (BLOCK_HEADER.test(value)) { j = yamlBlock(b, j, indentOf(b.lines[j]), value, label, shell) + 1; continue; }
          yamlScalar(b, j, item[1].length, value, label, shell);
        }
        j++;
      }
      i = j - 1;
    }
    if (ci) for (const r of b.regions.slice(first)) r.host.ci = ci;
    const script = ci ? undefined : scriptOf(b, keyLine, key, travis);
    if (script !== undefined) for (const r of b.regions.slice(first)) r.script = script;
  }
}

/**
 * The shell a `script:` key's commands run in, as a `ShellRegion.script` group (undefined: each command, or each step,
 * is a shell of its own). GitLab CI joins a job's `before_script` and `script` into one shell script, and runs
 * `after_script` in a shell of its own; Bitbucket Pipelines runs a step's `script` list in one shell; Travis CI runs all
 * the phases of a job in one shell. Every other key (GitHub Actions `run:`, Azure Pipelines `script:` and `bash:`,
 * CircleCI `run:`, Taskfile `cmds:`) is one shell per step or per command. The group is the line of the job that holds
 * the key (-1 at the top level), or of the key itself for GitLab's `after_script`.
 */
function scriptOf(b: Builder, at: number, key: string, travis: boolean): number | undefined {
  if (key === 'after_script' && !travis) return at;
  if (key !== 'script' && key !== 'before_script' && key !== 'after_script') return undefined;
  const indent = indentOf(b.lines[at]);
  for (let j = at - 1; j >= 0; j--) if (b.lines[j].trim() && !b.lines[j].trimStart().startsWith('#') && indentOf(b.lines[j]) < indent) return j;
  return -1;
}

/** Names defined under `variables:` (`name: value` or `- name: x`), for `$(name)` macros. */
function azureVariables(lines: string[]): Set<string> {
  const vars = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)variables\s*:\s*$/.exec(lines[i]);
    if (!m) continue;
    for (let j = i + 1; j < lines.length && (!lines[j].trim() || indentOf(lines[j]) > m[1].length); j++) {
      const v = /^\s*(?:-\s+name\s*:\s*['"]?([\w.]+)|([\w.]+)\s*:)/.exec(lines[j]);
      if (v && v[2] !== 'value' && v[2] !== 'group' && v[2] !== 'readonly') vars.add(v[1] ?? v[2]);
    }
  }
  return vars;
}

/** The shell of a step: `shell:` next to `run:` in GitHub Actions (bash by default), null if not a shell. */
function yamlShell(b: Builder, at: number, indent: number, key: string, systems: readonly HostCi[]): Shell | undefined | null {
  if (key === 'command' && !systems.some((id) => CI_SYSTEMS[id].commandIsShell)) return null;
  if (key === 'bash') return 'bash';
  if (key === 'sh') return 'sh';
  if (key !== 'run') return undefined;
  // Look at the sibling keys of the same step. `indent` is the column of the key, after any `- `.
  const level = indent;
  // Above, up to the line that starts the step (`- name: …`); none when `run:` starts it.
  const startsItem = (j: number) => /^\s*-\s/.test(b.lines[j]) && indentOf(b.lines[j].replace(/-\s+/, (d) => ' '.repeat(d.length))) === level;
  // The column of a line's key, after any `- `.
  const keyColumn = (j: number) => indentOf(b.lines[j].replace(/^(\s*)-\s+/, (d) => ' '.repeat(d.length)));
  // Blank and comment-only lines say nothing about indentation; `---` and `...` end a YAML document.
  const idle = (j: number) => !b.lines[j].trim() || b.lines[j].trim().startsWith('#');
  const marker = (j: number) => /^(---|\.\.\.)(\s|$)/.test(b.lines[j]);
  if (!startsItem(at)) {
    // `shell:` may stand above `run:` in the same step, down to the line that starts the step.
    for (let j = at - 1; j >= 0 && (idle(j) || (keyColumn(j) >= level && !marker(j))); j--) {
      if (idle(j)) continue;
      const m = /^\s*(?:-\s+)?shell:\s*(\S+)/.exec(b.lines[j]);
      if (m && keyColumn(j) === level) return shellName(m[1]);
      if (keyColumn(j) === level && startsItem(j)) break;
    }
  }
  for (let j = at + 1; j < b.lines.length && (idle(j) || (indentOf(b.lines[j]) >= level && !marker(j))); j++) {
    const m = /^\s*shell:\s*(\S+)/.exec(b.lines[j]);
    if (m && indentOf(b.lines[j]) === level) return shellName(m[1]);
  }
  if (!systems.includes('github')) return undefined;
  // `defaults: run: shell:` for the workflow, or for the job that holds this step.
  // Keys have no order: the defaults may stand above or below the step, and `shell:` anywhere in `run:`. The deepest (the job's) wins.
  const parentOf = (j: number, col: number) => {
    for (let i = j - 1; i >= 0; i--) if (!idle(i) && (indentOf(b.lines[i]) < col || marker(i))) return i;
    return -1;
  };
  let found: { k: number; shell: Shell | null } | undefined;
  for (let d = 0; d < b.lines.length; d++) {
    const m = /^(\s*)shell:\s*(\S+)/.exec(b.lines[d]);
    if (!m) continue;
    const r = parentOf(d, m[1].length);
    if (r < 0 || !/^\s*run\s*:\s*$/.test(b.lines[r])) continue;
    const dl = parentOf(r, indentOf(b.lines[r]));
    if (dl < 0 || !/^\s*defaults\s*:\s*$/.test(b.lines[dl])) continue;
    const k = indentOf(b.lines[dl]);
    // A job's defaults apply only within the job, and a document ends them.
    const [from, to] = d < at ? [d + 1, at] : [at + 1, dl];
    let apart = false;
    for (let j = from; j < to; j++) if (marker(j) || (!idle(j) && indentOf(b.lines[j]) < k)) apart = true;
    if (apart) continue;
    if (!found || k > found.k) found = { k, shell: shellName(m[2]) };
  }
  if (found) return found.shell;
  // A job on a Windows runner runs `run:` with PowerShell unless told otherwise.
  if (/windows/i.test(runsOn(b, at) ?? '')) return null;
  return 'bash';
}

/** The nearest line above `at` that is less indented than `indent`: the key `at` belongs to. */
function parentLine(b: Builder, at: number, indent: number): string | undefined {
  for (let j = at - 1; j >= 0; j--) {
    if (b.lines[j].trim() && indentOf(b.lines[j]) < indent) return b.lines[j];
  }
  return undefined;
}

/** `runs-on:` of the job holding line `at`, when it names a runner (not a matrix expression). */
function runsOn(b: Builder, at: number): string | undefined {
  // Keys have no order: `runs-on:` may stand above or below the step.
  for (let j = 0; j < b.lines.length; j++) {
    const m = /^(\s*)runs-on\s*:\s*(.*)$/.exec(b.lines[j]);
    if (!m) continue;
    // The job (or the document) ended between there and here.
    const [from, to] = j < at ? [j + 1, at] : [at + 1, j];
    if (b.lines.slice(from, to).some((l) => /^(---|\.\.\.)(\s|$)/.test(l) || (l.trim() && !l.trim().startsWith('#') && indentOf(l) < m[1].length))) continue;
    return m[2].includes('${{') ? undefined : m[2];
  }
  return undefined;
}

function shellName(s: string): Shell | null {
  const n = s.replace(/['"]/g, '').split(/[\s{]/)[0];
  const sh = shellFromName(n);
  return sh === 'bash' || sh === 'sh' ? sh : null;
}

/** The header of a block scalar: `|` (literal) or `>` (folded), with a chomping and an indentation indicator in either order. */
const BLOCK_HEADER = /^[|>](?:[-+]?[1-9]?|[1-9][-+])$/;

/**
 * A `|` / `>` block scalar (`header`): the more-indented lines after `at`. Returns the last line of the block.
 * YAML takes the block's indentation off every line (YAML 1.2, 8.1.1.1): the column of the first line that is not
 * empty, or `indent` plus the indicator (`|2`). The script the runner gets starts there, so an indented `EOF` ends a
 * here-document. A folded block (`>`) joins two lines next to each other with a space, unless one of them is more
 * indented (8.1.3): the shell text gets ` \` there, so the shell reads them as one line too.
 */
function yamlBlock(b: Builder, at: number, indent: number, header: string, label: [string, string], shell: Shell | undefined): number {
  const given = /\d/.exec(header);
  let strip = given ? indent + Number(given[0]) : undefined;
  const lines: number[] = [];
  for (let j = at + 1; j < b.lines.length && (!b.lines[j].trim() || indentOf(b.lines[j]) > indent); j++) {
    if (!b.lines[j].trim()) continue;
    // (Only spaces indent YAML: a tab after them is the script's, as for `<<-`.)
    strip ??= /^ */.exec(b.lines[j])![0].length;
    lines.push(j);
  }
  // A line of the folded block that YAML joins with the next one: both at the block's indentation, with nothing between.
  const folds = (j: number) => header[0] === '>' && lines.includes(j + 1) && indentOf(b.lines[j]) === strip && indentOf(b.lines[j + 1]) === strip;
  for (const j of lines) {
    githubLine(b, j, Math.min(strip!, indentOf(b.lines[j])), b.lines[j].length);
    if (folds(j)) b.outs[j]!.insert(' \\', b.lines[j].length, b.lines[j].length);
  }
  const last = lines.length ? lines[lines.length - 1] : at;
  b.region(at + 1, last, label, shell, lines.some(folds) ? [FOLDED] : undefined);
  return last;
}

/** The note on a folded block whose lines YAML joins. */
const FOLDED: RegionNote = { spec: { id: 'yaml-folded-block', params: {} } };

/** A one-line value, plain or quoted. */
function yamlScalar(b: Builder, i: number, from: number, value: string, label: [string, string], shell: Shell | undefined): void {
  const q = value[0];
  if ((q === '"' || q === "'") && value.endsWith(q) && value.length > 1) githubLine(b, i, from + 1, from + value.length - 1);
  else githubLine(b, i, from, from + value.length);
  b.region(i, i, label, shell);
}

/** Copy part of a line, replacing GitHub Actions `${{ … }}` expressions with a variable. */
function githubLine(b: Builder, i: number, from: number, to: number): void {
  const line = b.lines[i];
  const o = (b.outs[i] ??= new LineOut());
  const re = b.azure ? /\$\{\{\s*(.*?)\s*\}\}|\$\(([A-Za-z_][\w.]*)\)/g : /\$\{\{\s*(.*?)\s*\}\}/g;
  re.lastIndex = from;
  let at = from;
  for (let m: RegExpExecArray | null; (m = re.exec(line)) && m.index < to;) {
    if (m[2] !== undefined) {
      // `$(name)`: an Azure Pipelines macro when it names a pipeline variable; otherwise bash's `$(command)`.
      if (!(m[2].includes('.') || b.azure!.vars.has(m[2]))) continue;
      o.copy(line, at, m.index);
      const known = Object.hasOwn(AZURE_VARIABLES, m[2]) ? AZURE_VARIABLES[m[2]] : undefined;
      const meaning: [string, string] = known
        ? [`${spaced(known.ja)}を表す Azure Pipelines の変数 \`${m[2]}\` のマクロで、スクリプトが実行される前に値に置き換わります`, `the Azure Pipelines variable \`${m[2]}\`: ${known.en}; the macro is replaced with its value before the script runs`]
        : [`Azure Pipelines の変数 \`${m[2]}\` のマクロで、スクリプトが実行される前に値に置き換わります`, `an Azure Pipelines macro, replaced with the value of the variable \`${m[2]}\` before the script runs`];
      o.insert(`\${${m[2].replace(/\W+/g, '_').toUpperCase()}}`, m.index, m.index + m[0].length, meaning);
      b.substitutions.push({ line: i, text: m[0], meaning });
      at = m.index + m[0].length;
      continue;
    }
    o.copy(line, at, m.index);
    const name = m[1].replace(/\W+/g, '_').replace(/^_|_$/g, '').toUpperCase() || 'EXPR';
    const meaning: [string, string] = b.azure
      ? [`Azure Pipelines のテンプレート式で、パイプラインの展開時に \`${m[1]}\` の値に置き換わります`, `an Azure Pipelines template expression, replaced with the value of \`${m[1]}\` when the pipeline is expanded`]
      : githubMeaning(m[1]);
    o.insert(`\${${name}}`, m.index, m.index + m[0].length, meaning);
    b.substitutions.push({ line: i, text: m[0], meaning, warning: !b.azure && UNTRUSTED.test(m[1]) ? { id: 'actions-script-injection', params: { expr: m[1] } } : undefined });
    at = m.index + m[0].length;
  }
  o.copy(line, at, to);
}

/** What a GitHub Actions expression in a script stands for: `${{ github.head_ref }}` → its branch. */
function githubMeaning(expr: string): [string, string] {
  const known = githubContext(expr);
  return known
    ? [`${spaced(known.ja)}を表す GitHub Actions の式 \`${expr}\` で、スクリプトが実行される前に値に置き換わります`, `the GitHub Actions expression \`${expr}\`: ${known.en}; replaced with its value before the script runs`]
    : [`GitHub Actions の式で、スクリプトが実行される前に \`${expr}\` の値に置き換わります`, `a GitHub Actions expression, replaced with the value of \`${expr}\` before the script runs`];
}

/** Contexts an outside contributor controls (GitHub's security hardening guide). */
const UNTRUSTED = /^github\.(head_ref|event\.(issue\.(title|body|labels\.\*\.name)|pull_request\.(title|body|labels\.\*\.name|head\.(ref|label|repo\.default_branch))|comment\.body|review\.body|review_comment\.body|discussion\.(title|body)|release\.(name|body)|pages\.[^.]+\.page_name|commits(\.\*|\.\d+|\[\d+\])\.(message|(author|committer)\.(email|name))|head_commit\.(message|(author|committer)\.(email|name))|workflow_run\.(head_branch|display_title|head_commit\.(message|(author|committer)\.(email|name)))))$/;

/** Files GitHub Actions provides to steps, by environment variable. */
const GITHUB_FILES: Record<string, [string, string]> = {
  GITHUB_ENV: ['ここに `名前=値` を書くと、後のステップで環境変数として使えます', 'lines `NAME=value` written here become environment variables in later steps'],
  GITHUB_OUTPUT: ['ここに `名前=値` を書くと、ステップの出力（`steps.<id>.outputs.名前`）になります', 'lines `name=value` written here become step outputs (`steps.<id>.outputs.name`)'],
  GITHUB_PATH: ['ここに書いたディレクトリが、後のステップの PATH に追加されます', 'directories written here are added to PATH for later steps'],
  GITHUB_STEP_SUMMARY: ['ここに書いた Markdown が、ジョブの実行結果のページに表示されます', 'Markdown written here is shown on the run\'s summary page'],
  GITHUB_STATE: ['ここに書いた値を、同じアクションの pre/post の処理で読めます', 'values written here can be read by the action\'s pre and post steps'],
};

/** Notes for GitHub's special files used on a line of a GitHub Actions step. */
export function githubFileNotes(text: string): FactSpec[] {
  const out: FactSpec[] = [];
  for (const [name, [ja, en]] of Object.entries(GITHUB_FILES)) {
    if (new RegExp(`\\$\\{?${name}\\b`).test(text)) out.push({ id: 'github-file', params: { name, what: { ja, en } } });
  }
  return out;
}


/** The keys of the `env:`, `variables:` and `environment:` maps of a YAML file: the variables they set for its scripts. */
function envKeys(lines: readonly string[]): string[] {
  const out: string[] = [];
  lines.forEach((line, i) => {
    const m = /^(\s*(?:-\s+)?)(?:env|variables|environment)\s*:\s*(?:#.*)?$/.exec(line);
    if (!m) return;
    // (The keys of its first child's indent, until a line indented as little as the map's key.)
    let child = -1;
    for (const next of lines.slice(i + 1)) {
      if (!next.trim() || /^\s*#/.test(next)) continue;
      const indent = indentOf(next);
      if (indent <= m[1].length) break;
      if (child < 0) child = indent;
      const key = indent === child ? /^\s*(?:-\s+)?([A-Za-z_]\w*)\s*:/.exec(next) : null;
      if (key) out.push(key[1]);
    }
  });
  return out;
}
