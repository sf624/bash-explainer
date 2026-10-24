// The hover (docs/design/hover.md): which part a position explains, and the Markdown of the part, the line card and
// the whole line, within what VS Code's hover keeps.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import type { LineExplanation, Token } from '../src/analyzer-types';
import { explainDocumentLine, heredocAt, ShellDocument } from '../src/document';
import { openDocument } from '../src/document-setup';
import type { Lang } from '../src/i18n';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { blankRange, chainAt, covers, isCommand, partAt, rangeOnLine, sameSpan, shown } from '../src/ui/hoverParts';
import { HoverInput, lineCard, md as mdText, partHover, plainPartHover, prose, structureCrumb, wholeLine } from '../src/ui/hoverView';
import type { ThemeKind } from '../src/ui/palette';
import { ExamplePlacement, toPlainMarkdown } from '../src/ui/render';

const parser = createUnbashParser();
const open = (src: string): ShellDocument => openDocument(src, 'shell', (t) => parser.parse(t));
const explain = (doc: ShellDocument, line: number, lang: Lang = 'en'): LineExplanation => explainDocumentLine(new Analyzer(lang), doc, line, lang, {}, {});

/** The part a hover at (line, character) explains: the labels of its chain. */
function chain(doc: ShellDocument, line: number, character: number): string[] {
  return partAt(explain(doc, line).items, { line, character }, heredocAt(doc, line)).map((t) => t.label);
}
const last = (labels: string[]) => labels[labels.length - 1];

function input(doc: ShellDocument, line: number, opts: { lang?: Lang; theme?: ThemeKind; placement?: ExamplePlacement; ex?: LineExplanation } = {}): HoverInput {
  return {
    ex: opts.ex ?? explain(doc, line, opts.lang), lang: opts.lang ?? 'en', theme: opts.theme ?? 'dark', lineText: doc.lines[line], placement: opts.placement ?? 'first',
    panelLink: 'command:panel', lineLink: 'command:line', keys: 'Ctrl+K Ctrl+E',
  };
}
function partMd(doc: ShellDocument, line: number, character: number, opts: Parameters<typeof input>[2] = {}): string {
  const x = input(doc, line, opts);
  const c = partAt(x.ex.items, { line, character }, heredocAt(doc, line));
  assert.ok(c.length, `a part at ${line}:${character}`);
  return partHover(x, c);
}

const SCRIPT = [
  '#!/bin/bash',
  "sudo find /var/log -name '*.gz' -print0 | xargs -0 rm -f",
  'for f in a b; do',
  '    grep -n TODO "$f" && echo "found $f"',
  'done',
  'docker run --rm \\',
  '  -v "$PWD":/src \\',
  '  alpine ls /src',
  'cat <<EOF > out.txt',
  'Hello $USER',
  'EOF',
  "cat <<-'A' <<B",
  '\ttab $x',
  '\tA',
  'second $y',
  'B',
  'echo after',
].join('\n');

describe('the part a hover explains', () => {
  const doc = open(SCRIPT);
  const col = (line: number, text: string) => doc.lines[line].indexOf(text);

  it('is the innermost part at the position: a word, an option, an operator', () => {
    assert.deepStrictEqual(chain(doc, 1, col(1, 'find')), ['sudo | xargs', 'sudo', 'find']);
    assert.strictEqual(last(chain(doc, 1, col(1, 'find') + 2)), 'find');
    assert.strictEqual(last(chain(doc, 1, col(1, '-print0') + 3)), '-print0');
    assert.deepStrictEqual(chain(doc, 1, col(1, '|')), ['sudo | xargs', '|']);
    assert.strictEqual(last(chain(doc, 3, col(3, '&&'))), '&&');
    assert.strictEqual(last(chain(doc, 3, col(3, '&&') + 1)), '&&');
  });

  it('is a part that ends exactly at the position, as the word at the cursor', () => {
    // Just after `/var/log` (on the blank), and at the end of the line.
    assert.strictEqual(last(chain(doc, 1, col(1, '/var/log') + '/var/log'.length)), '/var/log');
    assert.strictEqual(last(chain(doc, 1, doc.lines[1].length)), '-f');
    assert.strictEqual(last(chain(doc, 3, doc.lines[3].length)), '"found $f"');
    // A blank inside a command that no word ends at: the command.
    assert.strictEqual(last(chain(doc, 1, col(1, 'sudo') + 4)), 'sudo');
  });

  it('is no part in the indentation, past the end of the line, or on an empty line', () => {
    assert.deepStrictEqual(chain(doc, 3, 0), []);
    assert.deepStrictEqual(chain(doc, 3, 2), []);
    assert.deepStrictEqual(chain(doc, 1, doc.lines[1].length + 4), []);
    assert.deepStrictEqual(partAt([], { line: 0, character: 0 }), []);
  });

  it('is a part of a statement over several lines, or the statement on a trailing backslash', () => {
    assert.strictEqual(last(chain(doc, 6, col(6, '-v'))), '-v');
    assert.strictEqual(last(chain(doc, 7, col(7, 'alpine'))), 'alpine');
    assert.deepStrictEqual(chain(doc, 5, doc.lines[5].length - 1), ['docker']);
    assert.deepStrictEqual(chain(doc, 6, 0), ['docker']);
  });

  it('is the here-document operator on its body and its closing line, or a part of the body', () => {
    assert.strictEqual(last(chain(doc, 8, col(8, '<<EOF'))), '<<EOF');
    assert.strictEqual(last(chain(doc, 9, 0)), '<<EOF');
    assert.strictEqual(last(chain(doc, 9, col(9, '$USER') + 1)), '$USER');
    assert.strictEqual(last(chain(doc, 10, 0)), '<<EOF');
    // Two here-documents on one line: each line maps to its own; `<<-` ends at a line of tabs and the delimiter.
    assert.strictEqual(last(chain(doc, 12, 1)), "<<-'A'");
    assert.strictEqual(last(chain(doc, 12, col(12, '$x'))), "<<-'A'", 'a quoted delimiter: nothing in the body is expanded');
    assert.strictEqual(last(chain(doc, 13, 1)), "<<-'A'");
    assert.strictEqual(last(chain(doc, 14, 0)), '<<B');
    assert.strictEqual(last(chain(doc, 14, col(14, '$y'))), '$y');
    assert.strictEqual(last(chain(doc, 15, 0)), '<<B');
    // Not a here-document line: the line before, the line after, a here-string.
    assert.strictEqual(heredocAt(doc, 8), undefined);
    assert.strictEqual(heredocAt(doc, 16), undefined);
    assert.deepStrictEqual(heredocAt(doc, 14), { line: 11, index: 1 });
    assert.strictEqual(heredocAt(open('cat <<< "a\nb"'), 1), undefined);
    // A command continued over lines before its here-document: the continuation line is not the body.
    assert.strictEqual(heredocAt(open('cat <<E \\\n  -n\nx\nE'), 1), undefined);
    assert.deepStrictEqual(heredocAt(open('cat <<E \\\n  -n\nx\nE'), 2), { line: 0, index: 0 });
    // While typing: `cat <<` with no delimiter yet, and a body with no end.
    assert.doesNotThrow(() => heredocAt(open('cat <<\nx'), 1));
    assert.deepStrictEqual(heredocAt(open('cat <<E\nx\ny'), 2), { line: 0, index: 0 });
  });

  it('keeps to the tokens when the explanation has no such operator', () => {
    const ex = explain(doc, 9);
    assert.deepStrictEqual(partAt(ex.items, { line: 9, character: 0 }, { line: 9, index: 0 }).map((t) => t.label), [ex.items[0].label]);
  });

  it('gives the range of the part on the line, so that moving to the next part asks again', () => {
    const at = (line: number, character: number) => {
      const c = partAt(explain(doc, line).items, { line, character }, heredocAt(doc, line));
      return rangeOnLine(c[c.length - 1].span, line, doc.lines[line].length);
    };
    assert.deepStrictEqual(at(1, col(1, '-print0')), { start: { line: 1, character: col(1, '-print0') }, end: { line: 1, character: col(1, '-print0') + 7 } });
    // A statement over several lines: cut to the line.
    assert.deepStrictEqual(at(6, 0), { start: { line: 6, character: 0 }, end: { line: 6, character: doc.lines[6].length } });
    assert.deepStrictEqual(at(5, 0).start, { line: 5, character: 0 });
    assert.deepStrictEqual(at(7, doc.lines[7].length - 1).end, { line: 7, character: doc.lines[7].length });
    // The operator `<<EOF` from its body: the whole body line.
    assert.deepStrictEqual(at(9, 0), { start: { line: 9, character: 0 }, end: { line: 9, character: 11 } });
    assert.deepStrictEqual(rangeOnLine({ start: { line: 4, character: 0 }, end: { line: 4, character: 2 } }, 3, 9), { start: { line: 3, character: 0 }, end: { line: 3, character: 9 } });
  });

  it('gives a position on no part the run of blanks around it', () => {
    assert.deepStrictEqual(blankRange('    grep x', { line: 3, character: 1 }), { start: { line: 3, character: 0 }, end: { line: 3, character: 4 } });
    assert.deepStrictEqual(blankRange('a  ;  b', { line: 0, character: 3 }), { start: { line: 0, character: 3 }, end: { line: 0, character: 4 } });
    assert.deepStrictEqual(blankRange('ab', { line: 0, character: 9 }), { start: { line: 0, character: 2 }, end: { line: 0, character: 2 } });
  });

  it('reads the parts as a reader sees them', () => {
    const ex = explain(open('echo "$x"'), 0);
    const echo = ex.items[0];
    // The quoted word that is the whole argument is not a part of its own: its expansion is.
    assert.ok(shown(echo).some((t) => t.label === '$x' || t.label === '"$x"'));
    for (const t of shown(echo)) assert.ok(!sameSpan(t.span, echo.span));
    assert.ok(isCommand(echo));
    assert.ok(!isCommand({ ...echo, name: undefined, kind: 'command', origin: 'embedded' } as Token));
    assert.ok(covers(echo, { line: 0, character: 0 }) && !covers(echo, { line: 0, character: 9 }) && !covers(echo, { line: 1, character: 0 }));
    assert.deepStrictEqual(chainAt(ex.items, { line: 0, character: 99 }), []);
  });
});

// VS Code's hover sanitizer, as of VS Code 1.142 (src/vs/base/browser/markdownRenderer.ts and dom.ts: `allowedMarkdownHtmlTags`,
// the span style test); what it drops, the hover loses (a colour, a badge) without saying so.
const ALLOWED_TAGS = new Set(['a', 'abbr', 'b', 'bdo', 'blockquote', 'br', 'caption', 'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em',
  'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'label', 'li', 'mark', 'ol', 'p', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp',
  'small', 'source', 'span', 'strike', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'tt', 'u', 'ul', 'var', 'video', 'wbr', 'input']);
const ALLOWED_STYLE = /^(color:(#[0-9a-fA-F]+|var\(--vscode(-[a-zA-Z0-9]+)+\));)?(background-color:(#[0-9a-fA-F]+|var\(--vscode(-[a-zA-Z0-9]+)+\));)?(display:inline-block;)?(border-radius:[0-9]+px;)?$/;
const ALLOWED_ATTRIBUTES = new Set(['href', 'title', 'style']);

function checkHtml(text: string, what: string): void {
  // (Markdown code, fenced or in a span, is text: a `<` there is no tag.)
  const md = text.replace(/^(`{3,})text\n[\s\S]*?\n\1$/gm, '').replace(/(`+)[^`]*?\1/g, '');
  for (const m of md.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-z-]+="[^"]*")*)\s*\/?>/g)) {
    const [, tag, attrs] = m;
    assert.ok(ALLOWED_TAGS.has(tag.toLowerCase()), `${what}: <${tag}> is dropped by the hover`);
    for (const a of attrs.matchAll(/([a-z-]+)="([^"]*)"/g)) {
      assert.ok(ALLOWED_ATTRIBUTES.has(a[1]), `${what}: ${a[1]}= on <${tag}>`);
      if (a[1] === 'style') {
        assert.strictEqual(tag, 'span', `${what}: a style is kept only on <span>`);
        assert.match(a[2], ALLOWED_STYLE, what);
      }
    }
  }
  // Every tag is one the pattern above read (no attribute it could not parse).
  assert.strictEqual([...md.matchAll(/<[a-zA-Z]/g)].length, [...md.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-z-]+="[^"]*")*)\s*\/?>/g)].length, what);
}

describe('the hover Markdown', () => {
  it('keeps to the tags, attributes and span styles the hover sanitizer keeps', () => {
    const sample = open(fs.readFileSync(path.join(__dirname, 'fixtures/sample.sh'), 'utf8'));
    let checked = 0;
    for (const lang of ['en', 'ja'] as const) {
      for (const theme of ['dark', 'light', 'highContrast', 'highContrastLight'] as const) {
        for (let line = 0; line < sample.lines.length; line++) {
          const x = input(sample, line, { lang, theme, ex: explain(sample, line, lang) });
          checkHtml(wholeLine(x), `whole line ${line + 1} ${lang} ${theme}`);
          if (!x.ex.items.length) continue;
          checkHtml(lineCard(x), `card ${line + 1}`);
          // Every part of the line.
          for (let c = 0; c <= sample.lines[line].length; c += 3) {
            const parts = partAt(x.ex.items, { line, character: c }, heredocAt(sample, line));
            if (parts.length) {
              checkHtml(partHover(x, parts), `part ${line + 1}:${c} ${lang} ${theme}`);
              checked++;
            }
          }
        }
      }
    }
    assert.ok(checked > 1000, String(checked));
  });

  it('shows the part first: the parts around it, the link to the whole line, its badge and meaning', () => {
    const doc = open(SCRIPT);
    const md = partMd(doc, 1, doc.lines[1].indexOf('find'));
    const lines = md.split('\n');
    assert.match(lines[0], /^<small>.*sudo.*›.*<\/small> &nbsp; \[\$\(list-tree\) Whole line\]\(command:line "Explain the whole line \(Ctrl\+K Ctrl\+E\)"\)$/);
    assert.match(lines[2], /^<b><span style="color:var\(--vscode-charts-blue\);">find<\/span><\/b> <span title="a program: [^"]*"><span style="color:var\(--vscode-badge-foreground\);background-color:var\(--vscode-badge-background\);border-radius:4px;">&nbsp;program&nbsp;<\/span><\/span> <span[^>]*>run by <code>sudo<\/code><\/span>$/);
    assert.match(lines[4], /^runs `find`: Search a directory tree/);
    // Its parts, one level, indented by nothing; the deeper ones are counted for the panel.
    assert.ok(md.includes('<table>\n<tr><td><span style="color:var(--vscode-charts-green);">/var/log</span></td><td>starting directory</td></tr>'), md);
    assert.match(md, /\[\$\(comment-discussion\) \d+ more in the panel\]\(command:panel\)/);
    // The command it belongs to, then the notes of the line, after the part.
    const command = lines.findIndex((l) => l.includes('Command: '));
    const note = lines.findIndex((l) => (l.startsWith('> ') && l.includes(' Idiom')));
    assert.ok(command > 4 && note > command, md);
    // The examples of the part, at the end; the footer says where it is.
    assert.ok(lines.findIndex((l) => l.startsWith('#### Example')) > note);
    assert.match(lines[lines.length - 1], /^<small>Bash Explainer · Line 2<\/small> &nbsp;·&nbsp; \[\$\(comment-discussion\) \d+ more in the panel\]\(command:panel\) &nbsp;·&nbsp; \[\$\(gear\) Settings\]\(command:bashExplainer\.openSettings\)$/);
  });

  it('shows the part on its own at the top of a line, with no command around it', () => {
    const doc = open('ls -l');
    const md = partMd(doc, 0, 0);
    assert.match(md.split('\n')[0], /^\[\$\(list-tree\) Whole line\]/);
    assert.ok(!md.includes('Command: '));
    assert.match(md, /\[\$\(comment-discussion\) Open in panel\]/);
    const option = partMd(doc, 0, 3);
    assert.match(option, /Command: <\/span><span style="color:var\(--vscode-charts-blue\);">ls<\/span> <span title/);
    assert.ok(!option.includes('<table>'), 'an option with no parts of its own');
  });

  it('says what else a name is, and in Japanese', () => {
    const doc = open('cd() { builtin cd "$@"; }\ncd /tmp');
    const md = partMd(doc, 1, 0);
    assert.match(md, /&nbsp;function&nbsp;/);
    assert.match(md, /<br><small><span style="color:var\(--vscode-descriptionForeground\);">Same name, also: bash&#39;s builtin \(run with <code>builtin&nbsp;cd<\/code>/);
    const ja = partMd(doc, 1, 0, { lang: 'ja' });
    assert.match(ja, /&nbsp;関数&nbsp;/);
    assert.match(ja, /同じ名前で、ほかに/);
    assert.match(partMd(open('sudo ls | grep x'), 0, 5, { lang: 'ja' }), /\[\$\(list-tree\) 行全体\]\(command:line "行全体を説明 \(Ctrl\+K Ctrl\+E\)"\)/);
  });

  it('gives the sections of the manual, in Markdown and in a table', () => {
    const md = partMd(open('exit 300'), 0, 0);
    assert.match(md, /\(builtin\)|&nbsp;builtin&nbsp;/);
    assert.match(md, /<small>Bash manual \[4\.1\]\(https:\/\/www\.gnu\.org\/software\/bash\/manual\/html_node\/Bourne-Shell-Builtins\.html "Bourne Shell Builtins"\)/);
    assert.match(md, /^> <span style="color:var\(--vscode-descriptionForeground\);">\$\(info\)<\/span> An exit status is 0–255, .* <small>Bash manual \[3\.7\.5\]\(/m);
    const row = partMd(open('a | b'), 0, 0);
    assert.ok(row.includes('<small>Bash manual <a href="https://www.gnu.org/software/bash/manual/html_node/Pipelines.html" title="Pipelines">3.2.3</a></small>') || !row.includes('<table>'));
    const pipe = wholeLine(input(open('a | b'), 0));
    assert.ok(pipe.includes('<small>Bash manual <a href="https://www.gnu.org/software/bash/manual/html_node/Pipelines.html" title="Pipelines">3.2.3</a></small>'), pipe);
  });

  it('keeps a long label in a row from breaking after a dash', () => {
    const md = partMd(open("find . -name '*.gz' -mtime +30 -print0"), 0, 0);
    assert.ok(md.includes('-⁠name'), md);
    assert.ok(!/style="[^"]*⁠/.test(md));
  });

  it('gives a position on no part a card: the structure as a breadcrumb, and the link', () => {
    const doc = open(SCRIPT);
    const md = lineCard(input(doc, 3));
    const [first, , rule, foot] = md.split('\n');
    assert.match(first, /^<small>.*grep.*›.*<b>.*grep.*<\/b>.*·.*<b>.*echo.*<\/b><\/small> &nbsp; \[\$\(list-tree\) Whole line\]/);
    assert.strictEqual(rule, '---');
    assert.match(foot, /^<small>Bash Explainer · Line 4 · _for loop \(line 3\)_<\/small>/);
  });

  it('draws the structure of a line as one breadcrumb, each part with its meaning as a tooltip', () => {
    const items = explain(open('sudo find . | xargs rm'), 0).items;
    const crumb = structureCrumb(items, 'dark');
    assert.match(crumb, /^<span title="Pipeline: each command&#39;s stdout feeds/);
    assert.strictEqual((crumb.match(/<b>/g) ?? []).length, 2, crumb);
    // A part with no command in it: itself.
    assert.match(structureCrumb(explain(open('x=1'), 0).items, 'dark'), /^<span title="Assign[^"]*"><span style="color:[^"]*;">x=1<\/span><\/span>$/);
  });

  it('shows the whole line per command: the line, its structure, then a block per command with its arguments', () => {
    const doc = open(SCRIPT);
    const md = wholeLine(input(doc, 1));
    const lines = md.split('\n');
    assert.strictEqual(lines[0], '**Bash Explainer** · Line 2');
    assert.match(lines[2], /^<code><span style="color:var\(--vscode-charts-blue\);">sudo&nbsp;<\/span>/);
    assert.match(lines[4], /^<small>.*<\/small>$/);
    const heads = lines.filter((l) => l.startsWith('<b>'));
    assert.strictEqual(heads.length, 5, heads.join('\n'));
    assert.match(heads[2], /find.*program.*run by <code>sudo<\/code>.* — runs `find`: .*<br><small><span[^>]*>in: <\/span>/);
    // Two levels of arguments: `-name` under the expression, its value not.
    assert.ok(md.includes('<tr><td>&nbsp;&nbsp;&nbsp;&nbsp;<span style="color:var(--vscode-charts-orange);">-⁠name</span>'), md);
    assert.match(lines[lines.length - 1], /^\[\$\(comment-discussion\) \d+ more in the panel\]\(command:panel\) &nbsp;·&nbsp; \[\$\(gear\) Settings\]/);
    // The notes after the commands.
    assert.ok(lines.findIndex((l) => (l.startsWith('> ') && l.includes(' Idiom'))) > lines.lastIndexOf('<table>'));
    // One command: no breadcrumb, and the panel link as it is.
    const one = wholeLine(input(open('ls -l'), 0));
    assert.ok(!one.includes('<small><span title'));
    assert.match(one, /\[\$\(comment-discussion\) Open in panel\]/);
  });

  it('says where the whole line is, and when there is nothing to explain', () => {
    const doc = open('#!/bin/sh\n[[ -f x ]]\n\n');
    const x = { ...input(doc, 1), ex: new Analyzer('en').explainLine(doc.tree, 1, 'sh') };
    const md = wholeLine(x);
    assert.match(md, /^\*\*Bash Explainer\*\* · Line 2 · checked for POSIX sh/);
    // (The mark is the level's codicon, in the level's colour.)
    assert.match(md, /> <span style="color:var\(--vscode-editorWarning-foreground\);">\$\(warning\)<\/span> `\[\[ \]\]` is not POSIX sh/);
    assert.match(wholeLine(input(doc, 2)), /Nothing to explain/);
    assert.match(wholeLine({ ...input(doc, 2), lineText: '  x' }), /Nothing to explain/);
  });

  it('shows each note with its level: its codicon and word in its colour, warnings first', () => {
    // A plain fact, a caveat and a pitfall, in the order found.
    const doc = open('exit 300; read line; x = 1');
    const notes = (md: string) => md.split('\n').filter((l) => l.startsWith('> '));
    const whole = (theme: ThemeKind) => notes(wholeLine(input(doc, 0, { theme })));
    const w = 'var(--vscode-editorWarning-foreground)';
    const i = 'var(--vscode-editorInfo-foreground)';
    const [warning, info, note] = whole('dark');
    assert.ok(warning.startsWith(`> <span style="color:${w};">$(warning)</span> <span style="color:${w};"><strong>Pitfall:</strong></span> \`x =…\` runs`), warning);
    assert.ok(info.startsWith(`> <span style="color:${i};">$(info)</span> <span style="color:${i};"><strong>Caveat:</strong></span> without`), info);
    // (A plain fact: the info icon, muted, and no word.)
    assert.ok(note.startsWith('> <span style="color:var(--vscode-descriptionForeground);">$(info)</span> An exit status'), note);
    // Our own colours where the theme's are not readable as text (src/ui/palette.ts, LEVEL_COLOURS).
    assert.match(whole('light')[0], /^> <span style="color:#855f00;">\$\(warning\)<\/span>/);
    assert.match(whole('light')[1], /^> <span style="color:#005fb8;">\$\(info\)<\/span>/);
    assert.match(whole('highContrast')[0], /^> <span style="color:var\(--vscode-editorWarning-foreground\);">/);
    assert.match(whole('highContrast')[1], /^> <span style="color:#6badff;">/);
    assert.match(whole('highContrastLight')[0], /^> <span style="color:#704500;">/);
    // The part's hover shows them the same way, and the sanitizer keeps every colour.
    assert.deepStrictEqual(notes(partMd(doc, 0, 0)), whole('dark'));
    for (const theme of ['light', 'dark', 'highContrast', 'highContrastLight'] as const) {
      checkHtml(wholeLine(input(doc, 0, { theme })), `levels ${theme}`);
      checkHtml(partMd(doc, 0, 0, { theme }), `levels, part ${theme}`);
    }
    // In Japanese, the word of the language.
    const ja = notes(wholeLine(input(doc, 0, { lang: 'ja' })));
    assert.match(ja[0], /<strong>落とし穴:<\/strong>/);
    assert.match(ja[1], /<strong>注意:<\/strong>/);
  });

  it('places the examples of the whole line by the setting', () => {
    const src = 'echo "${f%.*}" | sed -n "/^a/p" f';
    const doc = open(src);
    const at = (md: string, re: RegExp) => md.split('\n').findIndex((l) => re.test(l));
    const first = wholeLine(input(doc, 0, { placement: 'first' }));
    const last = wholeLine(input(doc, 0, { placement: 'last' }));
    const bottom = wholeLine(input(doc, 0, { placement: 'bottom' }));
    // With `first`, the sed example comes before the rows of sed; with `last`, after them; with `bottom`, at the end.
    const sedRows = (md: string) => md.split('\n').findIndex((l, i) => i > at(md, /^<b><span[^>]*>sed</) && l === '<table>');
    assert.ok(at(first, /^#### Example for `sed/) < sedRows(first), first);
    assert.ok(at(last, /^#### Example for `sed/) > sedRows(last), last);
    assert.ok(at(bottom, /^#### Example for `sed/) > at(bottom, /^<b><span[^>]*>sed</));
    // No rule before an example inside a block, and a blank line before each section, so that a note does not take in the next line.
    assert.strictEqual(first.split('\n').filter((l) => l === '---').length, 3);
    const ctl = wholeLine(input(open('printf \'a\\0b\' | xargs -0 echo'), 0));
    assert.match(ctl, /\n> Control characters [^\n]*\n\n\*\*/);
  });

  it('colours labels by kind, with our own colours where the theme kind has them', () => {
    const src = 'echo "$x" -n 2>&1';
    const doc = open(src);
    const md = (theme: ThemeKind) => wholeLine(input(doc, 0, { theme }));
    assert.match(md('light'), /<span style="color:#0161f8;">echo<\/span>/);
    assert.match(md('light'), /<span style="color:#d0020f;">&#36;x<\/span>/);
    assert.match(md('highContrastLight'), /<span style="color:#0148bc;">echo<\/span>/);
    assert.match(md('highContrast'), /<span style="color:#6badff;">echo<\/span>/);
    assert.match(md('dark'), /<span style="color:var\(--vscode-charts-blue\);">echo<\/span>/);
    assert.match(md('dark'), /<span style="color:#ff5c65;">&#36;x<\/span>/);
    const bad = open('printf "%y" # c');
    const md2 = (theme: ThemeKind) => wholeLine(input(bad, 0, { theme }));
    assert.match(md2('light'), /<span style="color:#d0020f;">%y<\/span>/);
    assert.match(md2('highContrast'), /<span style="color:var\(--vscode-errorForeground\);">%y<\/span>/);
    assert.match(md2('light'), /<span style="color:var\(--vscode-descriptionForeground\);">&#35;&nbsp;c<\/span>/);
  });

  it('escapes HTML and Markdown in source text, and in prose of a table', () => {
    const doc = open('echo "<b>" *.sh __x__');
    for (const md of [wholeLine(input(doc, 0)), partMd(doc, 0, 0), lineCard(input(doc, 0))]) {
      assert.ok(!md.includes('<b>"') && !md.includes('<b>&'), md);
      assert.ok(!/\*\.sh/.test(md.replace(/`[^`\n]*`/g, '')), 'a glob must not become Markdown emphasis');
    }
    assert.strictEqual(prose('a `b c` <d> *e*'), 'a <code>b&nbsp;c</code> &#60;d&#62; &#42;e&#42;');
    // In a Markdown paragraph, a `<` outside the code would start a tag the hover drops.
    assert.strictEqual(mdText('usage: <dir> `a <b>`'), 'usage: &lt;dir&gt; `a <b>`');
  });

  it('shows a construct as code and placeholders in italics', () => {
    const doc = open('for f in a b; do echo "$f"; done');
    const md = wholeLine(input(doc, 0));
    assert.match(md, /<b><span style="color:[^"]*;">for<\/span> <span style="color:[^"]*;">f<\/span> <span style="color:[^"]*;">in<\/span> <i><span style="color:var\(--vscode-descriptionForeground\);">words<\/span><\/i>/);
    assert.ok(!md.includes('‹'));
    // A label cut short ends with an ellipsis.
    assert.match(partMd(open('echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), 0, 0), /aaaa…<\/span><\/td>/);
  });
});

describe('the Language Server hover', () => {
  const doc = open(SCRIPT);
  const plain = (line: number, character: number) => {
    const ex = explain(doc, line);
    return plainPartHover(ex, partAt(ex.items, { line, character }, heredocAt(doc, line)), 'en', toPlainMarkdown(ex, doc.lines[line], 'where'));
  };

  it('shows the part first, then the whole line below a rule, with no HTML', () => {
    const md = plain(1, doc.lines[1].indexOf('find'));
    const lines = md.split('\n');
    assert.strictEqual(lines[0], '`sudo` `|` `xargs` › `sudo` ›');
    assert.strictEqual(lines[2], '**`find`** · _program_, run by `sudo`');
    assert.match(lines[4], /^runs `find`: /);
    assert.ok(lines.includes('- `/var/log` — starting directory'));
    assert.match(md, /\nCommand: `sudo` — Run a command as another user \(root by default\) \(program\)\n/);
    const rule = lines.indexOf('---');
    assert.strictEqual(lines[rule + 2], '**where**');
    assert.ok(!/<[a-z]/.test(md.replace(/`[^`\n]*`/g, '')), md);
    // A part that is not a command name: no kind.
    assert.match(plain(1, doc.lines[1].indexOf('-print0')), /^\*\*`-print0`\*\*\n/m);
  });

  it('says what else the name is, and the sections of the manual', () => {
    const d = open('cd() { builtin cd "$@"; }\ncd /tmp\nexit 3');
    const ex = explain(d, 1);
    const md = plainPartHover(ex, partAt(ex.items, { line: 1, character: 0 }), 'en', 'W');
    assert.match(md, /^\*\*`cd`\*\* · _function_\n/);
    assert.match(md, /\n_Same name, also: /);
    const ex2 = explain(d, 2);
    assert.match(plainPartHover(ex2, partAt(ex2.items, { line: 2, character: 0 }), 'en', 'W'), /\(Bash manual \[4\.1\]\(/);
  });

  it('is the whole line alone on no part', () => {
    const ex = explain(doc, 3);
    assert.strictEqual(plainPartHover(ex, [], 'en', 'WHOLE'), 'WHOLE');
  });
});
