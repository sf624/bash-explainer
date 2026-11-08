# Unreleased changes, in detail

The short list is in [CHANGELOG.md](../../CHANGELOG.md#unreleased).

## New

### bazel target patterns

- **Target patterns.** Each pattern of build, test, coverage, run, fetch and vendor says what it selects, with its parts below it: `//app:main` is "One target, `//app:main`", `//app` the target named like the package (`//app:app`), `//app:all` every rule of the package, `//app:*` and `//app:all-targets` every target (rules and files), `//app/...` every rule of the packages in `app` and below, `//...` every rule of the repository. A wildcard of these commands leaves out the targets tagged `manual`; a pattern that names one takes it. Patterns without `//` are relative to the current directory (`:main`, `legacy:all`, `...`); one with no `:` (`app/main`) names the target of the longest leading part that is a package (`//app:main`). `@repo//…` and `@@canonical//…` name a repository (`@repo` alone is `@repo//:repo`), and `-//app/legacy/...` after `--` takes its targets out of those of the patterns before it. What bazel refuses is marked: `../x:y`, `//app/...:main`, `//app:`, `//app/`. In `"//$pkg/..."` and `"//app:$t"`, the value is said to be read as part of the package's path, or as the target's name (where `all` and `*` are wildcards, a `/` is part of the name, and a `:` is refused). `//:all` names the top package of the repository. Each form was checked with what `bazel query` and `bazel build` take of it in a small workspace.
- **Query expressions.** A word of `bazel query`, `cquery` or `aquery` that is a target pattern (`//app/...`, `@@//app:all`) says what it selects: an aquery's wildcards leave out the `manual` targets as a build's do, a query's and a cquery's take them. The rest of the expression (`deps(//app:main)`) is still a plain argument.

### buildifier

Checked with buildifier 10.2.0 (bazel-contrib/buildtools; `buildifier -help`, and runs on small BUILD files: test/buildifier.test.ts).

- **The line.** `buildifier -mode=check -lint=warn -r .` reads each option with its value (`check`, `diff`, `fix`, `print_if_changed`; `off`, `warn`, `fix`; the file types of `-type`; `text`, `json`, `sarif`), and `.` as the directory it looks through.
- **How buildifier reads its words.** Go's `flag` package: `-mode=check`, `-mode check` and `--mode=check` are the same, and the first file ends the options, so in `buildifier BUILD -mode=check` the second word is a file name (buildifier fails opening it).
- **`-format`.** With any `-format` (even `text`), `-mode=check` prints the report on stdout and exits 0; without it, the list of files goes to stderr and the status is 4. `-format` with another mode is a usage error (status 2).
- **Not yet said.** The exit status (0 success, 1 a syntax error in an input, 2 a usage error, 3 a file error, 4 when check or `-lint=warn` finds something) is in the option texts only where it depends on an option.
