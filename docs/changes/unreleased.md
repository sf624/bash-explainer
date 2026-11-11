# Changes since the last release, in detail

The short list is in [CHANGELOG.md](../../CHANGELOG.md#unreleased).

## Changed

### The POSIX sh hint switches the shell, and says so

The web page's hint toward POSIX sh (a script with no shebang, read as bash, that has constructs POSIX sh lacks) has a button that sets the page's shell to POSIX sh, as the shell chip's popover does (#746).

- **The button.** It says "Switch to POSIX sh" (Japanese: 「POSIX sh に切り替え」). Before, it said "Check as POSIX sh" (「POSIX sh として確認」), and testers took it for a one-off check, not a change of the page's shell.
- **After it.** The chip in the editor's header shows "POSIX sh" and lights up in the accent colour for two seconds. A toast says "Shell set to POSIX sh." with Undo, which sets the shell back to what it was (Auto). The toast goes when the shell is chosen again in the chip, since its Undo would then take back that choice. Before, only the chip's words changed.
- **The strip.** With no problem in bash, the strip says "No problems in bash" (「bash では問題なし」) above the hint's line, "2 constructs not in POSIX sh". Before, it said "No problems" above that line, which read as a contradiction. Once the hint goes, the strip says "No problems" again.
