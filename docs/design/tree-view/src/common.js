// Shared helpers: the layered tree (DATA), names of the readers, short labels per kind.
const LAYER_NAME = { bash: 'bash parses', child: 'child bash parses', cmd: 'the command reads', lang: 'embedded language' };
const KIND_LABEL = {
  script: ['script'], list: ['and-or list', 'list'], pipeline: ['pipeline', 'pipe'], simple: ['simple command', 'command', 'cmd'],
  word: ['word', 'w'], assignment: ['assignment', 'assign'], name: ['name', 'n'], cmdsub: ['$( ) text', '$( )'], quote: ['quotes', 'q'],
  param: ['$var', '$'], op: ['operator', 'op'], redirect: ['redirection', 'redir'], reading: ['reading'], option: ['option', 'opt'],
  argument: ['argument', 'arg'], test: ['condition', 'cond'], builtin: ['command name', 'name'], command: ['runs command', 'runs'],
  lang: ['language'], string: ['literal', 'lit'], pattern: ['wildcard', '*'],
};
function readerOf(n, ancestors) {
  // The name of who reads this node: the command name for cmd nodes.
  if (n.layer === 'bash') return 'bash (the shell running the line)';
  if (n.layer === 'child') return 'child bash (runs the text of $( ))';
  const r = [n, ...ancestors.slice().reverse()].find((a) => a.kind === 'reading' || a.kind === 'command');
  const name = r ? r.label.split(' ')[0] : 'the command';
  return n.layer === 'cmd' ? `${name} (the command reads its arguments)` : `${n.kind === 'lang' ? n.label : 'language'} — read by ${name}, not by bash`;
}
function labelsOf(n) {
  if (n.kind === 'reading') return [n.label, n.label.split(' ')[0] + ' reads', n.label.split(' ')[0]];
  if (n.kind === 'lang') return [n.label, n.label.replace(/ \(.*\)/, ''), 're'];
  if (n.kind === 'script' && n.layer === 'child') return ['child bash script', 'child bash', 'child'];
  if (n.kind === 'list') return [n.label.replace('list', 'and-or list'), n.label, '&&'];
  return KIND_LABEL[n.kind] || [n.kind];
}
function walk(n, f, anc = []) { f(n, anc); n.children.forEach((c) => walk(c, f, [...anc, n])); }
function esc(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function exampleButtons(el, onPick) {
  DATA.forEach((d, i) => {
    const b = document.createElement('button');
    b.textContent = d.line.length > 30 ? d.line.slice(0, 28) + '…' : d.line;
    b.title = d.line;
    b.setAttribute('aria-pressed', String(i === 0));
    b.onclick = () => { el.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); onPick(i); };
    el.appendChild(b);
  });
}
const params = new URLSearchParams(location.search);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches || params.has('still');
