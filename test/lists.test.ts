// Lists of commands (3.2.4): pipelines joined by `;`, `&`, `&&` and `||`, where `&&` and `||` bind tighter. The
// tree keeps a body's statements and their `;` and `&` as its children; `commandLists` (src/syntax/tree.ts) reads them
// as the manual's lists, and Meaning (src/explain/lists.ts) and Reading (src/reading.ts) show them. bash's own parser
// groups them the same way: test/bash-ast.test.ts compares the grouping with bash-ast's tree, and here bash runs the
// lists, to show what `&` applies to.
import * as assert from 'assert';
import { Analyzer, type Token } from '../src/analyzer';
import { readingNodes, type ReadingNode } from '../src/reading';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { commandLists, descendants, inBackground, isListPart, listOperator, listOverLines, type SyntaxNode, withLists } from '../src/syntax/tree';
import { runBash } from './support/bash';
import { run } from './support/run';

const parser = createUnbashParser();

/** The tokens of a line as lines: `kind label — explanation`, indented by depth. */
function meaning(src: string, line = 0, lang: 'ja' | 'en' = 'en'): string[] {
  const out: string[] = [];
  const walk = (t: Token, d: number): void => {
    out.push(`${'  '.repeat(d)}${t.kind} ${t.label} — ${t.explanation}`);
    t.children.forEach((c) => walk(c, d + 1));
  };
  new Analyzer(lang).explainLine(parser.parse(src), line, 'bash').items.forEach((t) => walk(t, 0));
  return out;
}

/** The reading tree of a line as lines: `layer/kind label`, indented by depth (bash's layer only). */
function reading(src: string, line = 0): string[] {
  const out: string[] = [];
  const walk = (n: ReadingNode, d: number): void => {
    if (n.layer !== 'bash' && n.layer !== 'child') return;
    out.push(`${'  '.repeat(d)}${n.layer}/${n.kind} ${n.label}`);
    n.children.forEach((c) => walk(c, d + 1));
  };
  walk(new Analyzer('en').explainLine(parser.parse(src), line, 'bash', { reading: true }).reading!, 0);
  return out;
}

/** Each list of commands of a script, as `text: part | op | part…`. */
function lists(src: string): string[] {
  const root = parser.parse(src).root;
  const holders = [root, ...descendants(root, ['compound_statement', 'subshell', 'do_group', 'if_statement', 'elif_clause', 'else_clause', 'while_statement', 'case_item', 'command_substitution', 'process_substitution'])];
  return holders.flatMap((h) => commandLists(h)).map((l) => `${JSON.stringify(l.text)}: ${l.children.map((c) => c.text.split('\n')[0]).join(' | ')}`);
}

describe('lists of commands in the tree', () => {
  it('explains a reserved word that an unfinished construct leaves in an AND list as that word', () => {
    // (`while a do b; done`: bash needs a `;` before `do`, so our parser leaves `done` among the list's parts.)
    assert.notStrictEqual(runBash('while false do b; done && c').status, 0);
    assert.ok(meaning('while a do b; done && c').some((l) => /^ {2}\S+ done — End of the loop body$/.test(l)), meaning('while a do b; done && c').join('\n'));
  });

  it('makes a list of the parts joined by `;` and `&` on a line, and of one part with `&`, not of one part alone', () => {
    assert.deepStrictEqual(lists('a; b & c && d || e'), ['"a; b & c && d || e": a | ; | b | & | c && d || e']);
    assert.deepStrictEqual(lists('a && b &'), ['"a && b &": a && b | &']);
    assert.deepStrictEqual(lists('a;'), []);
    assert.deepStrictEqual(lists('a'), []);
    assert.deepStrictEqual(lists('{ a; }'), []);
    assert.deepStrictEqual(lists('{ a; b; } &'), ['"{ a; b; } &": { a; b; } | &', '"a; b;": a | ; | b | ;']);
  });

  it('ends a list of the script at a newline, as bash reads a script one line at a time, but not a list of a body', () => {
    assert.deepStrictEqual(lists('a; b\nc &\nd'), ['"a; b": a | ; | b', '"c &": c | &']);
    // (A newline in a body separates as `;` does; a comment between the lines is part of the list.)
    assert.deepStrictEqual(lists('{\n  a  # one\n  b &\n  c; d\n}'), ['"a  # one\\n  b &\\n  c; d": a | # one | b | & | c | ; | d']);
    // (A compound command over several lines is one part of the list of the line where it ends.)
    assert.deepStrictEqual(lists('if x; then\n  y\nfi; z\nw'), ['"if x; then\\n  y\\nfi; z": if x; then | ; | z']);
    // (A line continuation is no newline; a here-document's body comes after the line.)
    assert.deepStrictEqual(lists('a; \\\n  b\ncat <<E; c\nbody\nE\nd'), ['"a; \\\\\\n  b": a | ; | b', '"cat <<E; c\\nbody\\nE": cat <<E; c | ; | c']);
  });

  it('finds the lists in every body: `if`, `while`, `case`, groups, subshells and substitutions', () => {
    assert.deepStrictEqual(lists('if a; b & then c; fi'), ['"a; b &": a | ; | b | &']);
    assert.deepStrictEqual(lists('while a & do b; c; done'), ['"a &": a | &', '"b; c;": b | ; | c | ;']);
    assert.deepStrictEqual(lists('case x in y) a; b ;; esac'), ['"a; b": a | ; | b']);
    assert.deepStrictEqual(lists('x=$(a; b) <(c &)'), ['"a; b": a | ; | b', '"c &": c | &']);
    // (Not the `;` of the head of a `for`.)
    assert.deepStrictEqual(lists('for x in a; do b; done; for ((i = 0; i < 2; i++)); do c; done'), ['"for x in a; do b; done; for ((i = 0; i < 2; i++)); do c; done": for x in a; do b; done | ; | for ((i = 0; i < 2; i++)); do c; done']);
  });

  it('says what each `;` and `&` follows, and which statements run in the background', () => {
    const tree = parser.parse('a; b & c && d &\n{ e; }; f');
    const said = (n: SyntaxNode): string => { const o = listOperator(n); return o ? `${n.type} after ${o.part.text}${o.next ? `, before ${o.next.text}` : ''}` : `${n.type}: none`; };
    const anon = (n: SyntaxNode): SyntaxNode[] => [n, ...n.children.flatMap(anon)].filter((c) => c.type === ';' || c.type === '&');
    assert.deepStrictEqual(anon(tree.root).map(said), ['; after a, before b', '& after b, before c && d', '& after c && d', '; after e', '; after { e; }, before f']);
    const statements = tree.root.namedChildren.filter(isListPart);
    assert.deepStrictEqual(statements.map((s) => `${s.text} ${inBackground(s)}`), ['a false', 'b true', 'c && d true', '{ e; } false', 'f false']);
    assert.strictEqual(listOperator(parser.parse('for x in a; do b; done').root.namedChildren[0].children.find((c) => c.type === ';')!), undefined);
    assert.strictEqual(inBackground(tree.root), false);
  });

  it('keeps one node for each list, the children of the body around it, and a newline over the lines of a body', () => {
    const tree = parser.parse('{\n  a\n  b &\n}; c; d');
    const group = tree.root.namedChildren[0];
    assert.strictEqual(commandLists(group)[0], commandLists(group)[0]);
    assert.strictEqual(commandLists(group)[0].parent, group);
    assert.ok(commandLists(group)[0].children.every((c) => c.parent === group));
    assert.deepStrictEqual(withLists(group).map((c) => c.type), ['{', 'command_list', '}']);
    assert.deepStrictEqual(withLists(tree.root).map((c) => c.type), ['command_list']);
    assert.strictEqual(listOverLines(commandLists(group)[0]), true);
    assert.strictEqual(listOverLines(commandLists(tree.root)[0]), false);
  });
});

describe('lists of commands in Meaning', () => {
  it('shows a line\'s list over its parts, the AND and OR lists inside it, and what each `;` and `&` applies to', () => {
    assert.deepStrictEqual(meaning('a; b & c && d || e').map((l) => l.replace(/ \(not in the dictionary; see `man .`\)/, '')), [
      'operator a; b & c && d || e — List: runs its commands in order from the left; one followed by `&` runs in the background and the next starts at once, one followed by `;` is waited for',
      '  command a — Run the external command `a`',
      '  operator ; — Separator: wait for `a` to end, then run the next',
      '  command b — Run the external command `b`',
      '  operator & — Run `b` in the background: the shell runs it asynchronously in a subshell and goes on to the next without waiting (the status is 0)',
      '  operator c && d || e — AND and OR lists, read from the left as `(c && d) || e`: after `&&` the next command runs only if the status so far is 0, after `||` only if it is not',
      '    command c — Run the external command `c`',
      '    operator && — Run the right side only if the left succeeds (exit 0)',
      '    command d — Run the external command `d`',
      '    operator || — Run the right side only if the left fails (non-zero exit)',
      '    command e — Run the external command `e`',
    ]);
  });

  it('says that `&` after an AND list or a pipeline runs it whole in the background', () => {
    const ops = (src: string) => meaning(src).filter((l) => /^ *operator [&;] /.test(l)).map((l) => l.trim());
    assert.deepStrictEqual(ops('a && b &'), ['operator & — Run the whole AND list `a && b` in the background: the shell runs it asynchronously in a subshell and goes on without waiting (the status is 0)']);
    assert.deepStrictEqual(ops('a | b & c'), ['operator & — Run the whole pipeline `a | b` in the background: the shell runs it asynchronously in a subshell and goes on to the next without waiting (the status is 0)']);
    assert.deepStrictEqual(ops('a || b; c'), ['operator ; — Separator: wait for the OR list `a || b` to end, then run the next']);
    assert.deepStrictEqual(meaning('a && b &')[0], 'operator a && b & — List ended by `&`: the whole AND list `a && b` runs in the background');
    assert.deepStrictEqual(meaning('a &')[0], 'operator a & — List ended by `&`: `a` runs in the background');
  });

  it('says that the shell does not wait for a coprocess, which runs in the background as if ended by `&`', () => {
    assert.deepStrictEqual(meaning('coproc a; b').filter((l) => /— (List|Separator)/.test(l)).map((l) => l.trim().split(' — ')[1]), [
      'List: runs its commands one after another, each after the one before it ends; the status is that of the last (but not a `coproc`, which runs in the background)',
      'Separator: do not wait for `a`, which `coproc` runs in the background, then run the next',
    ]);
    // (While it is typed, with no command yet: `coproc` itself.)
    assert.deepStrictEqual(meaning('coproc; a').filter((l) => /operator ; /.test(l)).map((l) => l.trim().split(' — ')[1]), ['Separator: do not wait for `coproc`, which `coproc` runs in the background, then run the next']);
    assert.deepStrictEqual(meaning('coproc a;', 0, 'ja').map((l) => l.trim().split(' — ')[1]).filter((t) => t.startsWith('リスト')), ['リストの終わり: `coproc` がバックグラウンドで実行する `a` は待たない']);
  });

  it('names a part by its own line: not the body of its here-document, nor the lines of a compound command', () => {
    const ops = (src: string, line = 0) => meaning(src, line).filter((l) => /^ *operator [;&] /.test(l)).map((l) => l.trim().split(' — ')[1]);
    assert.deepStrictEqual(ops('cat <<E; echo a &\nbody\nE'), [
      'Separator: wait for `cat <<E` to end, then run the next',
      'Run `echo a` in the background: the shell runs it asynchronously in a subshell and goes on without waiting (the status is 0)',
    ]);
    assert.deepStrictEqual(ops('if x; then\n  y\nfi; z', 2), ['Separator: wait for `if ‹condition› then ‹commands› fi` to end, then run the next']);
    assert.deepStrictEqual(ops('{ a\n} & b', 1), ['Run `{ ‹commands› }` in the background: the shell runs it asynchronously in a subshell and goes on to the next without waiting (the status is 0)']);
    // (In a label, a newline between two parts is shown as the `;` it stands for.)
    assert.deepStrictEqual(meaning('x=$(\na\nb &\n)', 1).map((l) => l.split(' — ')[0].trim()).filter((l) => l.startsWith('operator a')), ['operator a; b &']);
    // (A comment between the lines is left out of the label.)
    assert.deepStrictEqual(meaning('x=$(\na  # c\nb &\n)', 1).map((l) => l.split(' — ')[0].trim()).filter((l) => l.startsWith('operator a')), ['operator a; b &']);
  });

  it('says where a `;` ends a list, and where a `;` or a newline is needed', () => {
    const ops = (src: string, line = 0) => meaning(src, line).filter((l) => /^ *operator ; /.test(l)).map((l) => l.trim().replace(/^operator ; — /, ''));
    const needed = (w: string, what: string) => `End the list before \`${w}\` and wait for \`${what}\` to end (without a \`;\` or a newline here, \`${w}\` would not be read as a reserved word)`;
    assert.deepStrictEqual(ops('a;'), ['End of the list: wait for `a` to end']);
    assert.deepStrictEqual(ops('if a; then b; elif c; then d; else e; fi'), [needed('then', 'a'), needed('elif', 'b'), needed('then', 'c'), needed('else', 'd'), needed('fi', 'e')]);
    assert.deepStrictEqual(ops('while a | b; do c && d; done'), [needed('do', 'the pipeline `a | b`').replace('`the pipeline `a | b``', 'the pipeline `a | b`'), needed('done', 'the AND list `c && d`').replace('`the AND list `c && d``', 'the AND list `c && d`')]);
    assert.deepStrictEqual(ops('{ a; b; } &'), ['Separator: wait for `a` to end, then run the next', needed('}', 'b')]);
    assert.deepStrictEqual(ops('case x in y) a; esac'), [needed('esac', 'a')]);
    // (After a compound command, a reserved word may follow at once.)
    assert.deepStrictEqual(ops('if [[ a ]]; then { b; }; fi'), [
      'End the list before `then` and wait for `[[ a ]]` to end (it may be left out after a compound command)',
      needed('}', 'b'),
      'End the list before `fi` and wait for `{ b; }` to end (it may be left out after a compound command)',
    ]);
    // (The `;` of the head of a `for` is the loop's.)
    assert.deepStrictEqual(ops('for x in a b; do c; done'), ['Ends the words of `for` before `do` (a `;` or a newline is needed there)', needed('done', 'c')]);
    assert.deepStrictEqual(ops('for ((i = 0; i < 2; i++)); do :; done'), [
      'Separates the three expressions of `(( ))`: start, test and step',
      'Separates the three expressions of `(( ))`: start, test and step',
      'Ends the `(( ))` before `do` (it may be left out after `))`)',
      needed('done', ':'),
    ]);
    assert.deepStrictEqual(ops('for x; do :; done').slice(0, 1), ['Ends the name of `for` before `do`']);
    // (With no `;` before `do`, `do` is one of the words, and the syntax error is a note of its own.)
    assert.deepStrictEqual(ops('for x in a b do echo; done'), ['Ends the words of `for`; the `do` before it is one of the words']);
    assert.deepStrictEqual(ops('for x in a; { echo; }').slice(0, 1), ['Ends the words of `for` before `{` (a `;` or a newline is needed there)']);
    // (A function's definition with redirections ends with a word: `}` after it needs the `;`.)
    assert.deepStrictEqual(ops('{ f() { :; } >/dev/null; }').slice(1), [needed('}', 'f() { :; } >/dev/null')]);
    // (A `;` after text the parser could not read: the operator's own text.)
    assert.deepStrictEqual(ops('def f($a): $a; f(1, 2)'), ['Command separator; run the next command regardless of the result']);
  });

  it('shows a list in a body on its line, and the parts of a list over several lines of a body on each of their lines', () => {
    assert.deepStrictEqual(meaning('if a; then b & fi').map((l) => l.split(' — ')[0]), [
      'keyword if ‹condition› then ‹commands› fi', '  keyword if', '  command a', '  operator ;', '  keyword then', '  operator b &', '    command b', '    operator &', '  keyword fi',
    ]);
    const src = '{\n  a\n  b &\n  c; d\n}';
    assert.deepStrictEqual([1, 2, 3].map((l) => meaning(src, l).map((x) => x.split(' — ')[0]).join(', ')), ['command a', 'command b, operator &', 'command c, operator ;, command d']);
    // (A list of the script over several lines, by a line continuation: whole on each line.)
    assert.deepStrictEqual(meaning('a && \\\n  b; c', 1).map((l) => l.split(' — ')[0]), ['operator a && b; c', '  operator a && b', '    command a', '    operator &&', '    command b', '  operator ;', '  command c']);
    // (One that starts with a compound command over several lines: on its first line, then each line its own part.)
    assert.deepStrictEqual(meaning('if x; then\n  y\nfi; z', 2).map((l) => l.split(' — ')[0]), ['keyword fi', 'operator ;', 'command z']);
  });

  it('shows the lists in `$( )`, with their `&`', () => {
    assert.deepStrictEqual(meaning('x=$(a; b &)').map((l) => l.split(' — ')[0]), [
      'assignment x=$(a; b &)', '  substitution $(a; b &)', '    operator a; b &', '      command a', '      operator ;', '      command b', '      operator &',
    ]);
  });

  it('names the lists in Japanese as the manual does', () => {
    const ja = meaning('a; b && c &', 0, 'ja').map((l) => l.replace(/^ */, '').split(' — ')[1]).filter((t) => !/外部コマンド/.test(t));
    assert.deepStrictEqual(ja, [
      'リスト: コマンドを左から順に実行する。`&` が続くものはバックグラウンドで実行してすぐ次へ進み、`;` が続くものは終了を待つ',
      '区切り: `a` の終了を待ってから、次を実行する',
      'AND リスト: 前のコマンドが成功（終了ステータス 0）したときだけ次を実行する。終了ステータスは最後に実行したもののもの',
      '左のコマンドが成功（終了ステータス 0）した場合のみ右を実行',
      'AND リスト `b && c` 全体をバックグラウンドで実行する: シェルはサブシェルで非同期に実行し、終了を待たずに先へ進む（終了ステータスは 0）',
    ]);
  });
});

describe('lists of commands in Reading', () => {
  it('reads a line as one list with its four operators, the AND and OR lists nested from the left', () => {
    assert.deepStrictEqual(reading('a; b & c && d || e'), [
      'bash/line ',
      '  bash/list a; b & c && d || e',
      '    bash/command a',
      '      bash/commandName a',
      '    bash/operator ;',
      '    bash/command b',
      '      bash/commandName b',
      '    bash/operator &',
      '    bash/orList c && d || e',
      '      bash/andList c && d',
      '        bash/command c',
      '          bash/commandName c',
      '        bash/operator &&',
      '        bash/command d',
      '          bash/commandName d',
      '      bash/operator ||',
      '      bash/command e',
      '        bash/commandName e',
    ]);
  });

  it('reads the list of a body inside its compound command, and every `;`', () => {
    assert.deepStrictEqual(reading('{ a; b; } &').map((l) => l.trim()), [
      'bash/line', 'bash/list { a; b; } &', 'bash/compound { ‹commands› }', 'bash/keyword {', 'bash/list a; b;', 'bash/command a', 'bash/commandName a',
      'bash/operator ;', 'bash/command b', 'bash/commandName b', 'bash/operator ;', 'bash/keyword }', 'bash/operator &',
    ]);
    assert.deepStrictEqual(reading('if a; then b & fi').map((l) => l.trim()).filter((l) => !l.includes('commandName')), [
      'bash/line', 'bash/compound if ‹condition› then ‹commands› fi', 'bash/keyword if', 'bash/command a', 'bash/operator ;', 'bash/keyword then',
      'bash/list b &', 'bash/command b', 'bash/operator &', 'bash/keyword fi',
    ]);
    // (A here-document's command and a comment after it: the line is read to the end of the here-document.)
    assert.deepStrictEqual(reading('cat <<E # c\nx\nE').map((l) => l.trim()).filter((l) => !l.includes('commandName')), [
      'bash/line', 'bash/command cat <<E', 'bash/redirect <<E', 'bash/operator <<', 'bash/delimiter E', 'bash/heredoc x', 'bash/comment # c',
    ]);
    // (A body over several lines, read on the line of `{`: one list, whose newlines separate as `;` does.)
    assert.deepStrictEqual(reading('{\n  a\n  b &\n}').map((l) => l.trim()).filter((l) => !l.includes('commandName')), [
      'bash/line', 'bash/compound { ‹commands› }', 'bash/keyword {', 'bash/list a …', 'bash/command a', 'bash/command b', 'bash/operator &', 'bash/keyword }',
    ]);
    assert.deepStrictEqual(reading('x=$(a; b &)').filter((l) => l.includes('child/')).map((l) => l.trim()), [
      'child/script a; b &', 'child/list a; b &', 'child/command a', 'child/commandName a', 'child/operator ;', 'child/command b', 'child/commandName b', 'child/operator &',
    ]);
    // (In a string a shell reads again, the same names: from the explanation of the string.)
    const kinds = (src: string) => readingNodes(new Analyzer('en').explainLine(parser.parse(src), 0, 'bash', { reading: true }).reading!).filter((n) => n.layer === 'child').map((n) => `${n.kind} ${n.label}`);
    assert.deepStrictEqual(kinds("bash -c 'a && b || c; d | e &'").filter((k) => !k.startsWith('commandName') && !k.startsWith('operator')), [
      'list a && b || c; d | e &', 'orList a && b || c', 'pipeline d | e',
    ]);
  });
});

describe('lists of commands as bash runs them', () => {
  // Each `cN` prints its number and the process it runs in: `$$` in the shell, another in a background job.
  const c = (n: number): string => `echo "${n}:$BASHPID"`;
  /** The scripts, with `cN` for the commands; `wait` lets the jobs end. */
  const scripts = [
    'c1; c2 & c3 && c4 || c5; wait',
    'c1 && c2 &\nwait',
    'c1 || c2; c3 && c4 & c5; wait',
    '{ c1; c2; } & c3; wait',
    'if c1; then c2 & fi; wait',
    '{\n  c1\n  c2 &\n  c3; c4 && c5 &\n}\nwait',
    'c1 & c2 & wait',
  ];

  it('runs in the background the part before `&` alone, and a whole AND list in one job: as the lists say', () => {
    for (const template of scripts) {
      const script = template.replace(/c(\d)/g, (_m, n: string) => c(Number(n)));
      const r = runBash(`echo "0:$$"; ${script}`);
      assert.strictEqual(r.status, 0, `${template}: ${r.stderr}`);
      const pid = new Map(r.stdout.trim().split('\n').map((l) => l.split(':') as [string, string]));
      // What the lists say: a command runs in the background when a part around it does (`inBackground`), in the job
      // of the outermost such part.
      const tree = parser.parse(script);
      const job = new Map<string, number | undefined>();
      for (const n of descendants(tree.root, ['command']).filter((x) => x.text.startsWith('echo'))) {
        let at: number | undefined;
        for (let p: SyntaxNode | null = n; p; p = p.parent) if (inBackground(p)) at = p.startIndex;
        job.set(/"(\d):/.exec(n.text)![1], at);
      }
      // What bash did: which commands ran in the shell, and which ran in one process together (those it ran at all).
      const ran = [...job.keys()].filter((k) => pid.has(k));
      assert.ok(ran.length >= 2, template);
      for (const k of ran) assert.strictEqual(pid.get(k) !== pid.get('0'), job.get(k) !== undefined, `${template}: c${k}`);
      for (const k of ran) {
        for (const m of ran) {
          if (job.get(k) !== undefined && job.get(m) !== undefined) assert.strictEqual(pid.get(k) === pid.get(m), job.get(k) === job.get(m), `${template}: c${k}, c${m}`);
        }
      }
    }
  });

  it('gives a background job the status 0, and needs a `;` or a newline where Meaning says so', () => {
    assert.strictEqual(runBash('false & echo "$?"; wait').stdout, '0\n');
    // After a simple command, without it the reserved word is one more word of the command: a syntax error at the
    // end, or (`else`) an argument; so is `do` after the words of `for`.
    for (const bad of ['if true then echo x; fi', 'if true; then echo x fi', '{ echo a }', 'for x in a do echo; done', 'while false do :; done', 'case x in x) echo a esac']) {
      assert.match(runBash(bad).stderr, /syntax error/, bad);
    }
    assert.strictEqual(runBash('if true; then echo b else echo c; fi').stdout, 'b else echo c\n');
    // After a compound command, after `))`, and after the name of a `for` with no words, it may be left out.
    assert.strictEqual(runBash('if [[ a ]] then { echo ok; } fi').stdout, 'ok\n');
    assert.strictEqual(runBash('{ { echo ok; } }; while false; do (:) done').stdout, 'ok\n');
    assert.strictEqual(runBash('for ((i = 0; i < 1; i++)) do echo ok; done').stdout, 'ok\n');
    assert.strictEqual(runBash('set -- p; for x do echo "$x"; done').stdout, 'p\n');
    // A coprocess is not waited for: the `;` after it goes on at once (else `read` would wait for ever).
    assert.strictEqual(runBash('coproc { read -r x; }; echo after; kill "$COPROC_PID"', { timeout: 5000 }).stdout, 'after\n');
  });

  it('needs the `;` before a reserved word exactly where Meaning says so: bash fails to parse the line without it', () => {
    const lines = [
      'if a; then b; fi', 'if [[ a ]]; then b; fi', 'if (( 1 )); then { b; }; fi', 'while a | b; do c && d; done', 'until ! [[ a ]]; do (b); done',
      '{ a; b; }', '{ { a; }; }', '{ f() { :; }; }', '{ f() { :; } >/dev/null; }', '{ a >f; }', 'case x in y) a; esac', 'case x in y) (a); esac',
      'if a; then b; elif c; then d; else e; fi', 'if time [[ a ]]; then :; fi', 'if a && [[ b ]]; then :; fi', '{ coproc a; }', '{ coproc a b; }', '{ coproc { a; }; }',
      'if coproc a; then :; fi',
    ];
    const verdicts: string[] = [];
    for (const src of lines) {
      const tree = parser.parse(src);
      const tokens = (ts: readonly Token[]): Token[] => ts.flatMap((t) => [t, ...tokens(t.children)]);
      for (const t of tokens(new Analyzer('en').explainLine(tree, 0, 'bash').items)) {
        if (t.label !== ';' || !/^End the list before/.test(t.explanation)) continue;
        const said = /would not be read as a reserved word/.test(t.explanation) ? 'needed' : 'optional';
        const at = t.span.start.character;
        // (`else` after a word is one more word, not a syntax error: the parse differs from the one with the `;`.)
        const without = `${src.slice(0, at)} ${src.slice(at + 1)}`;
        const parses = run('bash', ['--norc', '--noprofile', '-n', '-c', without], { timeout: 5000 }).status === 0;
        const same = /^\s*else/.test(src.slice(at + 1)) ? false : parses;
        verdicts.push(`${src} @${at}: ${said}${(said === 'needed') === same ? ' (bash disagrees)' : ''}`);
      }
    }
    assert.deepStrictEqual(verdicts.filter((v) => v.includes('disagrees')), []);
    assert.ok(verdicts.length >= 30, verdicts.join('\n'));
  });
});
