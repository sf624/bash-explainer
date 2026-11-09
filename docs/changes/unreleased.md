# Unreleased changes, in detail

The short list is in [CHANGELOG.md](../../CHANGELOG.md#unreleased).

## Fixed

### Python strings and imports

The Python host now reads a `.py` file with one lexer, one table of Python's escapes and one table of its imports (#759).

- **Escapes in a list of arguments.** A word's value has every escape undone: `subprocess.run(["printf", "\a"])` passes a BEL character (before, the text `\a`), and `"a\012b"` a newline (before, a NUL and `12`). In bytes, `b"\u0041"` keeps its backslash, as Python does.
- **Escapes in a command string.** `os.system("printf a\012b")` and `"echo a\x0ab"` end a command at the newline, as `\n` does (`printf a;b`); before, `\012` stayed as written, and `\x0a` broke the line in two. `"\101"` is `A`; `\r`, `\0`, `\b` and the other one-letter escapes give their characters.
- **`\N{…}`.** Without a table of Unicode names, the character of `"\N{BULLET}"` is not known: in a command string it is one character, quoted (`echo "${py_N_BULLET}"`, whose text names it), and in a list of arguments the word is an expression whose value is not shown. Before, it was read as the text `\N{BULLET}`.
- **Newlines and the shell's quotes.** An escaped newline is read as sh reads it there: inside the shell's quotes it is a newline of the word (`subprocess.run("echo 'x\ny'", shell=True, executable="/bin/bash")` is `echo 'x'$'\n''y'`; with `/bin/sh`, which has no `$'…'`, a placeholder of the one character, `printf 'hello'"${py_newline}"''`, whose text says it is a newline), and after a backslash it is a line continuation (`"echo a \\\nb"` runs `echo a b`). Before, each was a `;`.
- **Parentheses and lists.** A string in parentheses is the string: `os.system(("echo hi; ls"))` is the shell's, and `subprocess.run(("echo a " "b"), shell=True)` no longer says the shell runs the first item of a list. A tuple (`("ls", "-l")`) is still a list. Literals joined in a list (`["a" "b"]`), an f-string with no field and a word in parentheses are words, no longer Python expressions.
- **Two calls on a line.** Of `os.system("cd x"); os.system("make all")`, the first is explained, and the second is left out; before, both read `cd xmake all`.
- **f-strings.** A self-documenting field shows its text: `f"echo {x=}"` is `echo x=${py_x}`, as Python writes `x=` before the value. A field's expression is read to its end: `{a != b}` names `a != b` (before, `a`).
- **Literals across a comment.** `os.system("echo a"  # why` with `"b")` on the next line joins the two literals, as Python does; before, the second was left out.
- **Imports and calls.** `import os.path` binds `os`, and an import after `;` counts (`import sys; import os`); `os . system(…)` is a call too. Text inside a string or a docstring is never a call, even at the start of a line.
- **`executable=`.** A bytes literal names the shell (`executable=b"/bin/bash"`); a variable no longer does by its name (`executable=bash` is read as `/bin/sh`).
