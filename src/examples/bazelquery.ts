// What `bazel query` and `bazel cquery` print of an expression over a made-up workspace (src/examples/bazelworkspace.ts),
// for the examples of the commands after them in a pipeline (`bazel query 'kind(cc_library, //...)' --output label_kind |
// awk '{print $3}'`). The expression is the tree of the query language's reader (`queryTree`, src/embedded/bazelquery.ts);
// what this evaluator does not follow is not computed (no example), never guessed: a pattern relative to the current
// directory, a target the workspace does not have, a dependency it does not know, an order bazel does not fix. It follows
// target patterns, `deps`, `rdeps`, `allpaths`, `somepath`, `kind`, `filter`, `attr` (`name`, `tags`, `visibility`),
// `labels`, `tests`, `let`, `set` and the set operators; for cquery, the configurations of the patterns' targets and the
// functions that do not walk the graph. test/bazel-examples-run.test.ts compares it with what bazel 9.3.2 printed.
import type { ArgvParse } from '../argv/interpret';
import { givenOptions, operands, switched, values } from '../argv/query';
import { labelOf, parseTargetPattern } from '../embedded/bazel';
import { queryTree, type QueryArgument, type QueryNode } from '../embedded/bazelquery';
import { pick } from '../embedded/types';
import type { Lang } from '../i18n';
import { BAZEL_CC, type Workspace, type WorkspaceTarget } from './bazelworkspace';
import { toJsRegex } from './regex';
import type { SourceRun } from './runners';
import { chargeSize, chargeWalk, runnerStep, scriptRegex } from './regexguard';
import { Unsupported } from './unsupported';

/** What the evaluator does not follow: no output is computed. */
class NotComputed extends Unsupported {}

/** The output formats the examples print: a label a line, with its kind, or the packages. */
export type QueryOutput = 'label' | 'label_kind' | 'package';

/** A run of a query: the command, its expression, its `--output`, and whether it follows implicit dependencies (`--implicit_deps`, the default). */
export interface QueryRun { command: 'query' | 'cquery'; expression: string; output: QueryOutput; implicitDeps: boolean }

/** The most steps an evaluation takes. */
const MAX_STEPS = 10000;

/** What a target's label is made of, for the order bazel prints them in: its repository ('' for the main one), package and name. */
interface Parts { repo: string; pkg: string; name: string }

/** A target, or a configured target (cquery's), as the sets of the evaluation hold it. */
interface Item { label: string; config?: string }

/** A dependency of a rule, with the attribute it is in. */
interface Edge { to: string; attr?: string }

/** The lines `run` prints over `ws`, or undefined where the evaluator does not follow it. Within `guarded` (src/examples/regexguard.ts). */
export function runQuery(ws: Workspace, run: QueryRun): string[] | undefined {
  const tree = queryTree(run.expression, run.command);
  if (!tree) return undefined;
  try {
    return new Evaluation(ws, run).lines(tree);
  } catch (e) {
    if (e instanceof NotComputed) return undefined;
    // A bug in the evaluator: let it show.
    /* c8 ignore next */
    throw e;
  }
}

/** A list of labels as `attr` reads it (`[a, b]`). */
const listText = (xs: readonly string[]): string => `[${xs.join(', ')}]`;

class Evaluation {
  private readonly targets = new Map<string, WorkspaceTarget>();
  private readonly parts = new Map<string, Parts>();
  /** The packages of the main repository. */
  private readonly packages = new Set<string>();
  /** The items by their key: a label, or a configured target's label and configuration. */
  private readonly items = new Map<string, Item>();
  /** cquery's configured targets: those of the patterns of the expression, and what they depend on. */
  private universe?: string[];
  private steps = 0;

  constructor(private readonly ws: Workspace, private readonly run: QueryRun) {
    chargeWalk(ws.targets.length);
    for (const t of ws.targets) {
      const p = parseTargetPattern(t.label)!;
      const parts = { repo: p.repo?.name ?? '', pkg: p.pkg, name: p.name! };
      this.targets.set(t.label, t);
      this.parts.set(t.label, parts);
      if (!parts.repo) this.packages.add(parts.pkg);
    }
  }

  lines(tree: QueryNode): string[] {
    const cquery = this.run.command === 'cquery';
    if (cquery) this.universe = this.configure(tree);
    // (somepath gives a path, which bazel prints in its order; anything else is sorted.)
    const path = tree.kind === 'call' && tree.name === 'somepath';
    let items = [...this.eval(tree, new Map(), true)].map((k) => this.items.get(k)!);
    if (!path) {
      chargeWalk(items.length * Math.ceil(Math.log2(items.length + 1)));
      items = items.sort((a, b) => this.compare(a, b));
    }
    if (this.run.output === 'package') {
      if (cquery || path) throw new NotComputed();
      const pkgs = [...new Set(items.map((i) => this.main(i.label).pkg))];
      chargeSize(pkgs.reduce((n, p) => n + p.length + 1, 0));
      return pkgs.sort();
    }
    // (Each line: the kind, the label, the configuration; their size is charged before they are made.)
    const parts = items.map((i) => [this.run.output === 'label_kind' ? this.target(i.label).kind ?? this.unknown() : undefined, i.label, i.config] as const);
    chargeSize(parts.reduce((n, p) => n + p.reduce((m, x) => m + (x?.length ?? 0) + 3, 0), 0));
    return parts.map(([kind, label, config]) => `${kind === undefined ? '' : `${kind} `}${label}${config === undefined ? '' : ` (${config})`}`);
  }

  private unknown(): never {
    throw new NotComputed();
  }

  private step(): void {
    runnerStep(++this.steps, MAX_STEPS);
  }

  private target(label: string): WorkspaceTarget {
    return this.targets.get(label) ?? this.unknown();
  }

  /** The parts of a label of the main repository; not computed for another (what bazel shows of it is not known here). */
  private main(label: string): Parts {
    const p = this.parts.get(label)!;
    return p.repo ? this.unknown() : p;
  }

  /** Whether a label is of the main repository; not computed for one the workspace does not have. */
  private inMain(label: string): boolean {
    return !(this.parts.get(label) ?? this.unknown()).repo;
  }

  /** By repository (the main one first), package and name, as bazel sorts labels; then by configuration. */
  private compare(a: Item, b: Item): number {
    const x = this.parts.get(a.label)!;
    const y = this.parts.get(b.label)!;
    const order = (p: string, q: string) => (p < q ? -1 : p > q ? 1 : 0);
    // (Two items of one label are a cquery's, each with its configuration.)
    return order(x.repo, y.repo) || order(x.pkg, y.pkg) || order(x.name, y.name) || order(a.config!, b.config!);
  }

  /** The key of an item, made once. */
  private key(label: string, config?: string): string {
    const k = config === undefined ? label : `${label}\0${config}`;
    if (!this.items.has(k)) this.items.set(k, { label, ...(config === undefined ? {} : { config }) });
    return k;
  }

  /** What a target depends on directly: a rule's attributes but its outputs (`outs`), a generated file's rule; undefined where not known. */
  private edges(t: WorkspaceTarget): Edge[] | undefined {
    if (t.kind === 'source file') return [];
    if (t.rule) return [{ to: t.rule }];
    if (!t.attrs) return undefined;
    return Object.entries(t.attrs).flatMap(([attr, labels]) => (attr === 'outs' ? [] : labels.map((to) => ({ to, attr }))));
  }

  /** Whether `edges` are all it depends on, as the run follows dependencies (implicit ones too, by default). */
  private complete(t: WorkspaceTarget): boolean {
    return !t.open && !(this.run.implicitDeps && t.implicit);
  }

  /** The labels of a target pattern; not computed for one relative to the current directory, of another repository's packages, or that bazel refuses. */
  private pattern(text: string): string[] {
    const p = parseTargetPattern(text);
    if (!p || p.refused || p.negative || !p.absolute) return this.unknown();
    if (p.repo?.name) {
      const label = labelOf(p);
      return p.repo.canonical || p.recursive || p.wildcard || !this.targets.has(label) ? this.unknown() : [label];
    }
    const pkgs = [...this.packages].filter((k) => (p.recursive ? !p.pkg || k === p.pkg || k.startsWith(`${p.pkg}/`) : k === p.pkg));
    // (No package there, or no such target: bazel stops with an error.)
    if (!pkgs.length) return this.unknown();
    if (!p.wildcard) {
      const label = labelOf({ ...p, repo: undefined });
      return this.targets.has(label) ? [label] : this.unknown();
    }
    chargeWalk(this.targets.size);
    return [...this.targets.values()].filter((t) => pkgs.includes(this.parts.get(t.label)!.pkg) && !this.parts.get(t.label)!.repo && (p.wildcard === 'targets' || this.isRule(t))).map((t) => t.label);
  }

  private isRule(t: WorkspaceTarget): boolean {
    return (t.kind ?? this.unknown()).endsWith(' rule');
  }

  /** cquery's configured targets: the targets of the expression's patterns in their configurations, and what they depend on. */
  private configure(tree: QueryNode): string[] {
    const words: string[] = [];
    const visit = (n: QueryArgument): void => {
      this.step();
      if (n.kind === 'word') words.push(n.text);
      else if (n.kind === 'let') [n.value, n.body].forEach(visit);
      else if (n.kind === 'set') n.items.forEach(visit);
      else if (n.kind === 'operator') [n.left, n.right].forEach(visit);
      else if (n.kind === 'call') n.args.forEach(visit);
    };
    visit(tree);
    const { target, test, exec } = this.ws.configs;
    const seen = new Set<string>();
    const queue: Item[] = [];
    const add = (label: string, config: string) => {
      const k = this.key(label, config);
      if (!seen.has(k)) {
        seen.add(k);
        queue.push({ label, config });
      }
    };
    const top = (t: WorkspaceTarget): string => (t.kind === 'source file' ? 'null' : t.rule || !this.inMain(t.label) ? this.unknown() : t.kind!.endsWith('_test rule') ? test : target);
    for (const w of words) for (const label of this.pattern(w)) add(label, top(this.target(label)));
    for (let i = 0; i < queue.length; i++) {
      this.step();
      const { label, config } = queue[i];
      // (A rule's dependencies outside the main repository do not lead back into it.)
      for (const e of (this.edges(this.target(label)) ?? this.unknown()).filter((x) => this.inMain(x.to))) {
        const d = this.target(e.to);
        // (A tool is built for the execution platform; what a test depends on, without the options for tests.)
        add(e.to, d.kind === 'source file' ? 'null' : d.rule ? this.unknown() : e.attr === 'tools' ? exec : config === test ? target : config!);
      }
    }
    return [...seen];
  }

  private eval(n: QueryNode, env: ReadonlyMap<string, Set<string>>, top = false): Set<string> {
    this.step();
    switch (n.kind) {
      case 'word': {
        const labels = new Set(this.pattern(n.text));
        if (!this.universe) return new Set([...labels].map((l) => this.key(l)));
        chargeWalk(this.universe.length);
        return new Set(this.universe.filter((k) => labels.has(this.items.get(k)!.label)));
      }
      case 'variable': return env.get(n.name)!;
      case 'let': return this.eval(n.body, new Map([...env, [n.name, this.eval(n.value, env)]]));
      case 'set': return this.union(n.items.map((x) => this.eval(x, env)));
      case 'operator': {
        const a = this.eval(n.left, env);
        const b = this.eval(n.right, env);
        if (n.op === 'union') return this.union([a, b]);
        chargeWalk(a.size);
        return new Set([...a].filter((k) => b.has(k) === (n.op === 'intersect')));
      }
      case 'call': return this.call(n.name, n.args, env, top);
    }
  }

  private union(sets: Set<string>[]): Set<string> {
    chargeWalk(sets.reduce((s, x) => s + x.size, 0));
    return new Set(sets.flatMap((s) => [...s]));
  }

  private call(name: string, args: QueryArgument[], env: ReadonlyMap<string, Set<string>>, top: boolean): Set<string> {
    const expr = (i: number) => this.eval(args[i] as QueryNode, env);
    const text = (i: number) => (args[i] as { text: string }).text;
    const depth = (i: number) => (args[i] ? (args[i] as { value: number }).value : Infinity);
    const graph = this.run.command === 'query';
    switch (name) {
      case 'kind': {
        const found = this.matcher(text(0));
        return this.select(expr(1), (t) => found(t.kind ?? this.unknown()));
      }
      case 'filter': {
        const found = this.matcher(text(0));
        return this.select(expr(1), (t) => !!this.main(t.label) && found(t.label));
      }
      case 'attr': {
        const found = this.matcher(text(1));
        return this.select(expr(2), (t) => this.isRule(t) && this.decided(found, this.attrTexts(t, text(0))));
      }
      case 'tests': return this.select(expr(0), (t) => (t.kind === 'test_suite rule' ? this.unknown() : this.isRule(t) && t.kind!.endsWith('_test rule')));
      case 'labels':
        if (graph) return this.labels(text(0), expr(1));
        break;
      case 'deps':
        if (graph) return this.deps(expr(0), depth(1));
        break;
      case 'rdeps':
        if (graph) return this.rdeps(expr(0), expr(1), depth(2));
        break;
      case 'allpaths':
        if (graph) return this.allpaths(expr(0), expr(1));
        break;
      case 'somepath':
        if (graph && top) return this.somepath(expr(0), expr(1));
        break;
    }
    return this.unknown();
  }

  /** The items whose target `keep` keeps. */
  private select(items: Set<string>, keep: (t: WorkspaceTarget) => boolean): Set<string> {
    chargeWalk(items.size);
    return new Set([...items].filter((k) => keep(this.target(this.items.get(k)!.label))));
  }

  /** Whether the Java regex `pattern` matches anywhere in a text, as bazel searches (`Matcher.find`); not computed where JavaScript has no regex of the same meaning. */
  private matcher(pattern: string): (text: string) => boolean {
    const js = toJsRegex(pattern, 'pcre') ?? this.unknown();
    const re = scriptRegex(js.source, js.flags);
    return (text) => re.test(text);
  }

  /** Whether `found` matches every text a value may be shown as, or none of them; not computed where it depends on which. */
  private decided(found: (text: string) => boolean, texts: readonly string[]): boolean {
    const verdicts = new Set(texts.map(found));
    return verdicts.size > 1 ? this.unknown() : verdicts.has(true);
  }

  /**
   * The texts `attr` may read of a rule's attribute `name` of the main repository (a list as `[a, b]`): its name, its tags,
   * its visibility, with a label of the main repository as `//pkg:x` or `@@//pkg:x`, and none written as the package's
   * default, private. Not computed for another attribute, or an external rule.
   */
  private attrTexts(t: WorkspaceTarget, name: string): readonly string[] {
    const { name: own } = this.main(t.label);
    if (name === 'name') return [own];
    if (name === 'tags') return [listText(t.tags ?? [])];
    if (name !== 'visibility') return this.unknown();
    const v = t.visibility ?? ['//visibility:private'];
    return [listText(v), listText(v.map((l) => `@@${l}`)), ...(t.visibility ? [] : ['[]'])];
  }

  /** `labels(attr, x)`: the targets the attribute `attr` of the rules of `x` names; not computed where it is not written, or not a rule's of the main repository. */
  private labels(attr: string, items: Set<string>): Set<string> {
    chargeWalk(items.size);
    return new Set([...items].flatMap((k) => {
      const t = this.target(k);
      this.main(t.label);
      return (t.attrs?.[attr] ?? this.unknown()).map((l) => this.key(l));
    }));
  }

  /** `deps(x, depth)`: `x` and what it depends on, at most `depth` steps away; not computed where a dependency on the way is not known. */
  private deps(from: Set<string>, depth: number): Set<string> {
    const seen = new Map([...from].map((k) => [k, 0]));
    const queue = [...from];
    for (let i = 0; i < queue.length; i++) {
      this.step();
      const k = queue[i];
      const d = seen.get(k)!;
      if (d >= depth) continue;
      const t = this.target(k);
      const edges = this.complete(t) ? this.edges(t) : undefined;
      for (const e of edges ?? this.unknown()) {
        if (!seen.has(e.to)) {
          seen.set(this.key(e.to), d + 1);
          queue.push(e.to);
        }
      }
    }
    return new Set(seen.keys());
  }

  /**
   * What the targets of the main repository in `from` depend on there, and they. A dependency outside it does not lead back
   * into it (an external repository does not name the main one's targets), so the implicit ones and those not known do not count.
   */
  private closure(from: Set<string>): { nodes: Set<string>; edges: Map<string, string[]> } {
    const nodes = new Set([...from].filter((k) => this.inMain(k)));
    const edges = new Map<string, string[]>();
    const queue = [...nodes];
    for (let i = 0; i < queue.length; i++) {
      this.step();
      const to = (this.edges(this.target(queue[i])) ?? this.unknown()).map((e) => e.to).filter((x) => this.inMain(x));
      edges.set(queue[i], to);
      for (const x of to) {
        if (!nodes.has(x)) {
          nodes.add(this.key(x));
          queue.push(x);
        }
      }
    }
    return { nodes, edges };
  }

  /** The targets of `nodes` that reach one of `to` (of the main repository), at most `depth` steps away, by `edges` taken backwards. */
  private reaching(to: Set<string>, { nodes, edges }: { nodes: Set<string>; edges: Map<string, string[]> }, depth: number): Map<string, number> {
    if ([...to].some((k) => !this.inMain(k))) this.unknown();
    const back = new Map<string, string[]>();
    chargeWalk(nodes.size);
    for (const [k, outs] of edges) {
      for (const x of outs) {
        if (!back.has(x)) back.set(x, []);
        back.get(x)!.push(k);
      }
    }
    const seen = new Map([...to].filter((k) => nodes.has(k)).map((k) => [k, 0]));
    const queue = [...seen.keys()];
    for (let i = 0; i < queue.length; i++) {
      this.step();
      const d = seen.get(queue[i])!;
      if (d >= depth) continue;
      for (const x of back.get(queue[i]) ?? []) {
        if (!seen.has(x)) {
          seen.set(x, d + 1);
          queue.push(x);
        }
      }
    }
    return seen;
  }

  /** `rdeps(universe, x, depth)`: the targets of `universe` and what it depends on that depend on `x`, at most `depth` steps away. */
  private rdeps(universe: Set<string>, x: Set<string>, depth: number): Set<string> {
    return new Set(this.reaching(x, this.closure(universe), depth).keys());
  }

  /** `allpaths(from, to)`: every target on a path from one of `from` to one of `to`. */
  private allpaths(from: Set<string>, to: Set<string>): Set<string> {
    return new Set(this.reaching(to, this.closure(from), Infinity).keys());
  }

  /**
   * `somepath(from, to)`: a path from one of `from` to one of `to`, in its order. Bazel takes one where there are several:
   * computed only where there is one, that starts at the one target of `from` on a path and that no target of `to` lies inside.
   */
  private somepath(from: Set<string>, to: Set<string>): Set<string> {
    const graph = this.closure(from);
    const on = new Set(this.reaching(to, graph, Infinity).keys());
    const next = (k: string) => graph.edges.get(k)!.filter((x) => on.has(x));
    const starts = [...on].filter((k) => from.has(k));
    if (!on.size) return on;
    if (starts.length !== 1) return this.unknown();
    const path = [starts[0]];
    for (let k = starts[0]; !to.has(k); ) {
      this.step();
      const after = next(k);
      if (after.length !== 1) return this.unknown();
      path.push(k = after[0]);
    }
    return path.length === on.size ? new Set(path) : this.unknown();
  }
}

/**
 * The options of query and cquery the examples follow: `--output` and `--implicit_deps`, and those that change nothing
 * printed on the standard output (the progress, colours, the options read from the rc files).
 */
const FOLLOWED = new Set(['--output', '--implicit_deps', '--keep_going', '--show_progress', '--color', '--curses', '--show_timestamps', '--announce_rc', '--tool_tag']);
/** The outputs each command's examples print: cquery has no `package`. */
const OUTPUTS: Readonly<Record<QueryRun['command'], readonly string[]>> = { query: ['label', 'label_kind', 'package'], cquery: ['label', 'label_kind'] };

/**
 * What `bazel query` (or `cquery`) prints of the words of `parse` over the made-up workspace (`BAZEL_CC`): the expression its
 * operands make, joined with spaces, with `--output` and `--implicit_deps` (the last given of each); undefined for any other
 * option, a word not known, or what the evaluator does not follow. `words`: the values of the words, when known.
 */
export function bazelQuerySource(command: QueryRun['command'], parse: ArgvParse, words: readonly (string | undefined)[], lang: Lang): SourceRun | undefined {
  if (givenOptions(parse).some(({ role }) => role.role !== 'option' || role.missing || !FOLLOWED.has(role.spec.names[0]))) return undefined;
  const parts = operands(parse).map(({ word }) => words[word]);
  const out = values(parse, '--output').at(-1);
  const output = out ? words[out.word]?.slice(out.at ?? 0) : 'label';
  if (!parts.length || parts.includes(undefined) || !OUTPUTS[command].includes(output!)) return undefined;
  const lines = runQuery(BAZEL_CC, { command, expression: parts.join(' '), output: output as QueryOutput, implicitDeps: switched(parse, '--implicit_deps') ?? true });
  if (!lines) return undefined;
  const s = pick(lang);
  const configs = command === 'cquery' ? s('。かっこの中の構成（`(a7a71fd)`）は、ある環境のオプションのハッシュで、環境ごとに違う', '. The configurations in parentheses (`(a7a71fd)`) are hashes of one machine\'s options, and differ on another') : '';
  return { lines, note: s(`架空の C++ のワークスペース（\`//app\`・\`//lib\`・\`//tools\`・\`//util\` と \`@abseil-cpp\`）での例。実際の出力は、実行するワークスペースのターゲットになる${configs}`, `An example over a made-up C++ workspace (\`//app\`, \`//lib\`, \`//tools\`, \`//util\` and \`@abseil-cpp\`): the real output lists the targets of the workspace it runs in${configs}`) };
}
