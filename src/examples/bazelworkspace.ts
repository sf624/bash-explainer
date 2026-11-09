// The made-up C++ workspace the examples of `bazel query` and `bazel cquery` run over (src/examples/bazelquery.ts): the
// targets of test/fixtures/bazel-cc, as bazel 9.3.2 reads them (four packages, two libraries, two binaries, a test, a
// genrule with a tool, a filegroup, and one external library, @abseil-cpp). Each fact comes from the record of that
// workspace (test/fixtures/oracles/bazel.json, `examples`, written by scripts/record-bazel.ts), which
// test/bazel-examples-run.test.ts compares the evaluator with: the kinds of `//...:*`, the direct dependencies that
// `deps(…, 1)` and `--output=graph` show, and the configurations cquery prints.

/** A target of a workspace, as the query examples read it. */
export interface WorkspaceTarget {
  /** As bazel prints it (`//lib:greet`, `@abseil-cpp//absl/strings:strings`). */
  readonly label: string;
  /** As `--output=label_kind` prints it (`cc_library rule`, `source file`, `generated file`); undefined where it is not known. */
  readonly kind?: string;
  /**
   * A rule's attributes that hold labels, as bazel resolves them (`@abseil-cpp//absl/strings` is `…/strings:strings`), with
   * the defaults that are labels (`link_extra_lib` of `cc_binary`); undefined where they are not known (an external rule).
   */
  readonly attrs?: Readonly<Record<string, readonly string[]>>;
  /** A rule's `tags` (none when not written). */
  readonly tags?: readonly string[];
  /** A rule's `visibility` as written; when not written, the package's default (which this workspace does not set). */
  readonly visibility?: readonly string[];
  /** A generated file's rule, which it depends on. */
  readonly rule?: string;
  /** A rule's implicit dependencies (its toolchains…), all outside the main repository: `--noimplicit_deps` leaves them out. */
  readonly implicit?: true;
  /** A rule whose attributes may have more defaults that are labels than `attrs` lists (none recorded), all outside the main repository. */
  readonly open?: true;
}

/** A workspace: its targets, and the configurations cquery prints (each a hash of this machine's options: an example). */
export interface Workspace {
  readonly targets: readonly WorkspaceTarget[];
  /** Of the top-level targets; of a test rule (its options for tests); of a tool built for the execution platform (`tools`). */
  readonly configs: { readonly target: string; readonly test: string; readonly exec: string };
}

const source = (label: string): WorkspaceTarget => ({ label, kind: 'source file' });
const generated = (label: string, rule: string): WorkspaceTarget => ({ label, kind: 'generated file', rule });
/** What `cc_binary` and `cc_test` link besides their `deps` (`deps(//app:main, 1)`). */
const LINK_EXTRA_LIB = ['@rules_cc//:link_extra_lib'];

/** test/fixtures/bazel-cc. */
export const BAZEL_CC: Workspace = {
  targets: [
    source('//app:BUILD'),
    { label: '//app:data', kind: 'filegroup rule', attrs: { srcs: ['//app:data.txt'] }, open: true },
    source('//app:data.txt'),
    { label: '//app:main', kind: 'cc_binary rule', attrs: { srcs: ['//app:main.cc'], deps: ['//lib:greet'], link_extra_lib: LINK_EXTRA_LIB }, implicit: true },
    source('//app:main.cc'),
    generated('//app:main.dwp', '//app:main'),
    generated('//app:main.stripped', '//app:main'),
    { label: '//app:main_test', kind: 'cc_test rule', attrs: { srcs: ['//app:main_test.cc'], deps: ['//lib:greet'] }, implicit: true, open: true },
    source('//app:main_test.cc'),
    generated('//app:main_test.dwp', '//app:main_test'),
    generated('//app:main_test.stripped', '//app:main_test'),
    source('//lib:BUILD'),
    { label: '//lib:greet', kind: 'cc_library rule', attrs: { srcs: ['//lib:greet.cc'], hdrs: ['//lib:greet.h'], deps: ['//util:text', '@abseil-cpp//absl/strings:strings'] }, visibility: ['//visibility:public'], implicit: true },
    source('//lib:greet.cc'),
    source('//lib:greet.h'),
    source('//tools:BUILD'),
    { label: '//tools:fmt', kind: 'cc_binary rule', attrs: { srcs: ['//tools:fmt.cc'], deps: ['//util:text'], link_extra_lib: LINK_EXTRA_LIB }, implicit: true },
    source('//tools:fmt.cc'),
    generated('//tools:fmt.dwp', '//tools:fmt'),
    generated('//tools:fmt.stripped', '//tools:fmt'),
    { label: '//tools:version', kind: 'genrule rule', attrs: { outs: ['//tools:version.txt'], tools: ['//tools:fmt'] }, implicit: true, open: true },
    generated('//tools:version.txt', '//tools:version'),
    source('//util:BUILD'),
    { label: '//util:strutil', kind: 'cc_library rule', attrs: { srcs: ['//util:strutil.cc'], hdrs: ['//util:strutil.h'] }, implicit: true },
    source('//util:strutil.cc'),
    source('//util:strutil.h'),
    { label: '//util:text', kind: 'cc_library rule', attrs: { srcs: ['//util:text.cc'], hdrs: ['//util:text.h'], deps: ['//util:strutil'] }, visibility: ['//visibility:public'], implicit: true },
    source('//util:text.cc'),
    source('//util:text.h'),
    { label: '@abseil-cpp//absl/strings:strings', kind: 'cc_library rule' },
    { label: '@rules_cc//:link_extra_lib', kind: 'cc_library rule', attrs: { deps: ['@rules_cc//:link_extra_libs'] }, implicit: true },
    { label: '@rules_cc//:link_extra_libs' },
  ],
  configs: { target: 'a7a71fd', test: 'e722a21', exec: '04bf134' },
};
