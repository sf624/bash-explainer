// The steps of the panel's Reading view, and what each node of the reading tree (src/reading.ts) shows there: the
// step it appears at, its chip, who reads it, the band it starts, the general text of its kind and the colour of its
// code. A pure model: the hosts send its result with the line (src/ui/panelView.ts `panelUpdate`), and media/panel.js
// only draws it (docs/design/sources.md, SB2).
import type { ScriptProcess } from '../analyzer-types';
import type { Lang } from '../i18n';
import type { Layer, ReadingNode } from '../reading';
import { ui } from './texts';

/** The layers, in the order the steps add them. */
const LAYERS: readonly Layer[] = ['bash', 'child', 'command', 'language'];

/**
 * The steps of the tree view, from the line alone to every layer. Steps 1 to 5 unfold bash's own reading by the
 * kind of its nodes: the line, its lists and pipelines, its commands, their words, and what is inside the words
 * (quotes, expansions, the scripts of substitutions as bash reads them). Steps 6 to 8 add the other readers: the
 * scripts inside (a child shell), each command's reading of its arguments, and the languages.
 */
export const STEPS = 8;

/** The step of a node of bash's own reading, by its kind; a kind not listed is a part of a word (step 5). */
export const BASH_STEP: Readonly<Record<string, number>> = {
  line: 1, list: 2, andList: 2, orList: 2, pipeline: 2, command: 3, compound: 3, clause: 3, coprocess: 3, function: 3, part: 3,
  commandName: 4, aliasWord: 4, expandedName: 4, option: 4, argument: 4, assignmentArgument: 4, word: 4, name: 4,
  assignment: 4, redirect: 4, heredoc: 4, operator: 4, keyword: 4, comment: 4, shebang: 4, expression: 4, descriptor: 4, delimiter: 4,
};

/** The step a node appears at by itself: in bash's reading by its kind (5: a part of a word), else its layer's. */
export function ownStep(n: Pick<ReadingNode, 'layer' | 'kind'>): number {
  return n.layer === 'bash' ? BASH_STEP[n.kind] ?? 5 : LAYERS.indexOf(n.layer) + 5;
}

/** The layer a step shows up to (1–4). */
export function levelOf(step: number): number {
  return Math.max(1, step - 4);
}

/** The layer a step adds (steps 1 to 5 are bash's). */
export function layerOfStep(step: number): Layer {
  return LAYERS[levelOf(step) - 1];
}

/** Where the steps of a line put its nodes. */
export interface Measured {
  /** The step each node appears at: its own, or its parent's when that is later (a node is drawn under its parent). */
  appear: Map<ReadingNode, number>;
  /** How many nodes each step adds (index 0: step 1). */
  added: number[];
  /**
   * The nodes that show what their kind is in general (where no token says more): for each kind, the first node to
   * appear, by step and then in order. The text stays on that node from step to step, and is not on every argument.
   */
  aboutAt: Set<ReadingNode>;
}

/** The key of a node's general text in `about` ('' for a language's own tokens: its `keyword` is not bash's reserved word). */
export function aboutKey(n: Pick<ReadingNode, 'layer' | 'kind' | 'reader' | 'label'>): string {
  if (n.kind === 'language') return n.reader !== 'bash' ? 'language' : n.label === 'prompt' ? 'promptLanguage' : 'bashLanguage';
  return n.layer === 'language' ? '' : n.kind;
}

/** Reads the steps of a line: when each node appears, what each step adds, and where the general texts go. */
export function measureSteps(root: ReadingNode): Measured {
  const appear = new Map<ReadingNode, number>();
  const added = new Array<number>(STEPS).fill(0);
  const first = new Map<string, { node: ReadingNode; at: number }>();
  const walk = (n: ReadingNode, from: number): void => {
    const at = Math.max(from, ownStep(n));
    appear.set(n, at);
    added[at - 1]++;
    if (n.text === undefined) {
      const o = first.get(aboutKey(n));
      if (!o || at < o.at) first.set(aboutKey(n), { node: n, at });
    }
    n.children.forEach((c) => walk(c, at));
  };
  walk(root, 1);
  return { appear, added, aboutAt: new Set([...first.values()].map((o) => o.node)) };
}

type TreeTexts = (typeof ui)[Lang]['panel']['tree'];
const texts = (lang: Lang): TreeTexts => ui[lang].panel.tree;
const of = (table: object, key: string): string | undefined => (table as Record<string, string>)[key];
/** The shell that parses a node of the layer `child` (a substitution's subshell where it is not said). */
const processOf = (n: ReadingNode): ScriptProcess => n.process ?? 'subshell';

/** The name a node is shown with: its kind (a command name with what it runs), or the language. */
export function chipOf(n: ReadingNode, lang: Lang): string {
  const t = texts(lang);
  if (n.kind === 'line') return t.kinds.line;
  if (n.kind === 'language') return of(t.languages, n.label) ?? n.label;
  // (A word the command reads that is not an option is an operand: bash's arguments are called arguments.)
  // (A command another runs is a command name too, as bash's own are: its badge says what it is, and who runs it.)
  const named = n.name && ['command', 'builtin', 'function', 'alias'].includes(n.kind);
  if (n.layer === 'command' && n.valueFor) {
    // (A word that bash expands first: the command reads each word that comes out, not the word as written. Its
    // first word is the value of the option.)
    return (n.expands ? t.valueExpands : t.valueFor).replace('{flag}', n.valueFor);
  }
  const shell = n.layer === 'bash' || n.layer === 'child';
  let kind = (named && t.kinds.commandName) || (shell && of(t.kinds, n.kind)) || (n.layer === 'command' && of(t.commandKinds, n.kind))
    || of(t.tokenKinds, n.kind) || n.kind;
  const expands = n.layer === 'command' && n.expands ? t.expands[n.expands] : undefined;
  if (expands) kind = expands.replace('{kind}', kind);
  // (A command name's badge says what it runs.)
  return n.resolves && !n.name ? `${kind} · ${t.resolves[n.resolves]}` : kind;
}

/** Who reads a node, said to a screen reader: bash, which shell parses it again, the command, or the language and who reads it. */
export function readerOf(n: ReadingNode, lang: Lang): string {
  const r = texts(lang).readers;
  if (n.layer === 'child') return r.child[processOf(n)];
  // (bash reads two languages itself: the regex of `=~`, and a prompt string, the value of `PS1` or `PS4`.)
  if (n.layer === 'language' && n.reader === 'bash') return n.label === 'prompt' ? r.promptLanguage : r.bashLanguage;
  return r[n.layer].replace('{name}', n.reader ?? '');
}

/** Whether a node starts a band: where the reader changes (another layer, another command, another shell). */
export function startsBand(n: ReadingNode, parent: ReadingNode | undefined): boolean {
  return !parent || parent.layer !== n.layer || (n.layer === 'command' && parent.reader !== n.reader)
    || (n.layer === 'child' && parent.process !== n.process);
}

/** The name at the right of a band: where a new reader takes over ('' for a language's own tokens). */
export function bandOf(n: ReadingNode, lang: Lang): string {
  const t = texts(lang);
  // (A node of the layer `command` always has its reader: the command's name, src/reading.ts.)
  if (n.layer === 'command') return t.reads.replace('{name}', n.reader!);
  if (n.layer === 'language') return n.kind === 'language' ? chipOf(n, lang) : '';
  if (n.layer === 'child') return t.bands.child[processOf(n)];
  return t.bands.bash;
}

/** The role a node's code is coloured with, as the list colours its tokens (`.kind-*`): a node of the other layers has its token's kind. */
export const ROLES: Readonly<Record<string, string>> = {
  commandName: 'command', aliasWord: 'command', expandedName: 'variable', argument: 'argument', assignmentArgument: 'assignment',
  word: 'argument', name: 'variable', heredoc: 'redirect', quote: 'string', arithmetic: 'expansion', brace: 'expansion',
  list: 'operator', andList: 'operator', orList: 'operator', pipeline: 'operator', command: 'operator', compound: 'keyword', clause: 'keyword', coprocess: 'keyword',
  function: 'keyword', script: 'substitution', part: 'operator', expression: 'operator', descriptor: 'redirect', delimiter: 'redirect',
};

/** The role of a node's code (see `ROLES`). */
export function roleOf(n: Pick<ReadingNode, 'kind'>): string {
  return ROLES[n.kind] ?? n.kind;
}

/** A node of the reading tree as the panel draws it. */
export type DrawnNode = Omit<ReadingNode, 'children'> & {
  /** The step it appears at. */
  appears: number;
  /** The name it is shown with (`chipOf`). */
  chip: string;
  /** Who reads it, said to a screen reader (`readerOf`). */
  readBy: string;
  /** Where it starts a band: the name at the band's right ('' for none). Absent: no band starts here. */
  band?: string;
  /** What its kind is in general, on the first node of its kind and where no token says more (`aboutAt`). */
  about?: string;
  /** The role its code is coloured with (`roleOf`). */
  role: string;
  children: DrawnNode[];
};

/** A step of the line shown: what the step controls say and where the arrows go from it. */
export interface StepView {
  /** Whether it adds something to the line (the first step always does: the line). */
  adds: boolean;
  /** "Step 4 of 8: words", as the live region says it. */
  said: string;
  /** The same, with "nothing added on this line" where it adds nothing: the button's name. */
  full: string;
  /** The step the back and forward arrows go to: the next that adds something (itself at either end). */
  back: number;
  forward: number;
}

/** The short name and the name of each step, and the layer it adds: the same on every line. */
export interface StepName { short: string; name: string; layer: Layer }

/** The steps' names, in order. */
export function stepNames(lang: Lang): StepName[] {
  return texts(lang).steps.map(([short, name], i) => ({ short, name, layer: layerOfStep(i + 1) }));
}

/** The reading tree of a line as the panel draws it, and its steps. */
export interface ReadingView {
  root: DrawnNode;
  steps: StepView[];
}

/** The steps that add something, from what each adds (the first always). */
function usefulSteps(added: readonly number[]): number[] {
  return added.map((count, i) => (i === 0 || count > 0 ? i + 1 : 0)).filter((s) => s > 0);
}

/** The step `d` steps from `step`, among those that add something (`step` itself at either end). */
export function stepFrom(step: number, d: 1 | -1, added: readonly number[]): number {
  const useful = usefulSteps(added);
  if (d > 0) return useful.find((s) => s > step) ?? step;
  return [...useful].reverse().find((s) => s < step) ?? step;
}

/** The reading tree of a line, with what the panel draws for each node and each step. */
export function readingView(root: ReadingNode, lang: Lang): ReadingView {
  const t = texts(lang);
  const { appear, added, aboutAt } = measureSteps(root);
  const draw = (n: ReadingNode, parent: ReadingNode | undefined): DrawnNode => {
    const about = aboutAt.has(n) ? of(t.about, aboutKey(n)) : undefined;
    return {
      ...n,
      appears: appear.get(n)!,
      chip: chipOf(n, lang),
      readBy: readerOf(n, lang),
      ...(startsBand(n, parent) ? { band: bandOf(n, lang) } : {}),
      ...(about ? { about } : {}),
      role: roleOf(n),
      children: n.children.map((c) => draw(c, n)),
    };
  };
  const steps = t.steps.map(([, name], i): StepView => {
    const s = i + 1;
    const adds = s === 1 || added[i] > 0;
    const said = t.stepper.step.replace('{i}', String(s)).replace('{n}', String(STEPS)).replace('{name}', name);
    return { adds, said, full: adds ? said : `${said} (${t.stepper.empty})`, back: stepFrom(s, -1, added), forward: stepFrom(s, 1, added) };
  });
  return { root: draw(root, undefined), steps };
}
