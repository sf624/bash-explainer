# Privacy

[User guide](README.md) · English · [日本語](ja/privacy.md)

Bash Explainer works entirely offline by design:

- **No network access.** The extension contains no code that opens network connections, and the panel's Content Security Policy blocks external requests. The links to the Bash manual (gnu.org) are plain links: a page opens only when you click one.
- **No AI.** Scripts are parsed with [unbash](https://github.com/webpro-nl/unbash), a JavaScript parser bundled into the extension, and explained from built-in dictionaries, so the same line always gets the same explanation.
- **No telemetry.** The extension collects nothing.
- **No external processes.** Examples are computed by built-in code; your tools are never run.

A [CI check](../../test/offline.test.ts) fails the build if network or process APIs appear in the packaged extension ([latest runs](https://github.com/sf624/bash-explainer/actions/workflows/test.yml)). [Integration tests](../../integration/extension.itest.ts) also run the packaged extension in VS Code — on Linux with no network at all — and fail if it opens a connection or starts a process. You can also verify this yourself: the `.vsix` is a zip archive, and the extension works with networking disabled.

The [web version](https://sf624.github.io/bash-explainer/) works the same way. GitHub Pages serves the page, but your script is parsed and explained in the browser and sent nowhere; the page's Content Security Policy allows no requests to other sites, and a link to a script carries it after `#`, which browsers do not send. A file you open is read in the browser too, and a save writes to your own disk. The same CI check covers the page, and a test opens it in Chromium, blocking every request to other sites, and keeps using it offline.

In VS Code for the Web, the extension runs in your browser; VS Code loads its files (including the parser) from the Marketplace, but your scripts are explained there and sent nowhere.

The [command-line tool](../../cli/README.md), which is also the Language Server, works the same way: it contains no code that opens a network connection or starts a process, which the same CI check covers, and a test runs it with network and process modules blocked. Only getting it uses the network: `npx` and the GitHub Action download it from npm; installed, it runs offline.

This describes the extension, its web version and the command-line tool, not VS Code, other extensions, your browser, npm or GitHub Actions. It is provided as is, without warranty (see [LICENSE](../../LICENSE)); please evaluate it against your own requirements before using it with sensitive data.
