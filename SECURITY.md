# Security policy

## Supported versions

Security fixes go into the next release. Only the latest release is supported, in each of these forms:

- the VS Code extension (Marketplace and Open VSX, also on vscode.dev and github.dev);
- the npm package `bash-explainer` (the command-line tool and the Language Server);
- the GitHub Action (`sf624/bash-explainer@v0`);
- the [web version](https://sf624.github.io/bash-explainer/).

The development page (`/next/`) and the previews of pull requests (`/pr/<number>/`) are not supported. Report a problem there only if it could reach a release.

## Reporting a vulnerability

Please do not open a public issue. [Report it privately on GitHub](https://github.com/sf624/bash-explainer/security/advisories/new).

Include:

- the form and the version you tested;
- the script, link or input that triggers it;
- what happens, and what an attacker gains.

## What to expect

One person maintains this project, so replies are best effort, with no fixed time. I will tell you whether I can reproduce the problem and what happens next.

When a fix is released, I publish a GitHub security advisory and credit you, unless you prefer not to be named. Please keep the problem private until then. If a fix is taking long, we can agree on a date.

## What counts as a vulnerability

Bash Explainer reads scripts that may come from anyone, and is built to explain them [offline, without running them](https://github.com/sf624/bash-explainer/blob/main/README.md#privacy); only getting it uses the network. A vulnerability is a way to break that, for example:

- explaining a script runs any of its code, or starts a process;
- the extension, the web version or the command-line tool opens a network connection, by itself or because of a script;
- a script, a file or a shared link injects script, markup, a link or a command into the web page or the VS Code panel or hover, or gets past a Content Security Policy;
- a script puts control sequences into a terminal, or workflow commands into the Action's log;
- a crafted repository makes the GitHub Action run a command;
- a link in an explanation leads somewhere other than the references it names;
- a published package or page contains something its tagged source and pinned dependencies do not;
- a flaw in a bundled dependency that one of the above can reach.

## What does not

Please open a [public issue](https://github.com/sf624/bash-explainer/issues) for these:

- An explanation that is wrong, or a warning that is missing. Bash Explainer teaches and checks scripts, but it is not a security scanner: a clean result does not mean a script is safe to run.
- A script that makes a tool slow, hang or crash, with no effect beyond that (a stuck editor, a CI job held until its timeout).
- A flaw in a dependency that no published form contains ([THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) lists those that are).

Report flaws in VS Code, browsers, npm or GitHub Actions to their maintainers, and a dependency's own flaw to its maintainers too.
