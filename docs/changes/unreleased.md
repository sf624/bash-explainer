# Unreleased changes, in detail

The short list is in [CHANGELOG.md](../../CHANGELOG.md#unreleased).

## New

### bazel target patterns

- **Target patterns.** Each pattern of build, test, coverage, run, fetch and vendor says what it selects, with its parts below it: `//app:main` is "One target, `//app:main`", `//app` the target named like the package (`//app:app`), `//app:all` every rule of the package, `//app:*` and `//app:all-targets` every target (rules and files), `//app/...` every rule of the packages in `app` and below, `//...` every rule of the repository. A wildcard of these commands leaves out the targets tagged `manual`; a pattern that names one takes it. Patterns without `//` are relative to the current directory (`:main`, `legacy:all`, `...`); one with no `:` (`app/main`) names the target of the longest leading part that is a package (`//app:main`). `@repo//…` and `@@canonical//…` name a repository (`@repo` alone is `@repo//:repo`), and `-//app/legacy/...` after `--` takes its targets out of those of the patterns before it. What bazel refuses is marked: `../x:y`, `//app/...:main`, `//app:`, `//app/`. In `"//app:$t"`, the value of `$t` is said to be read as part of the pattern. Each form was checked with what `bazel query` and `bazel build` take of it in a small workspace.
- **Query expressions.** A word of `bazel query`, `cquery` or `aquery` that is a target pattern (`//app/...`, `@@//app:all`) says what it selects; the rest of the expression (`deps(//app:main)`) is still a plain argument.
