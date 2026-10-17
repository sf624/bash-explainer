# Recording the README images

README.md and README.ja.md use these four files from this directory, recorded by the script below:

| File | What it shows | Length |
| --- | --- | --- |
| `demo.gif` | The opening demo: hover → panel | about 17 s |
| `hover.gif` | Hover mode | about 15 s |
| `panel.gif` | Panel mode | about 17 s |
| `inline.png` | Inline mode (still image) | — |

`action-annotations.png`, used by cli/README.md, is a screenshot of a pull request on GitHub, taken by hand: the action's warnings on a script's lines under *Files changed*.

`images/` is left out of the .vsix by `.vscodeignore`. The Marketplace README loads the images from GitHub, through `repository` in `package.json` (github.com/sf624/bash-explainer), so **push before you publish**.

## Recording them automatically

```sh
npm ci
npm run images                 # all four
npm run images -- hover panel  # only some of them
npm run images -- --keep       # keep the frames and the temporary profile
```

[scripts/capture-readme-images.mjs](../scripts/capture-readme-images.mjs) overwrites the files in this directory. It:

1. builds the extension and packages it into a .vsix
2. installs the .vsix into an empty, temporary extensions directory, so your own VS Code settings and extensions are not used or changed
3. starts VS Code once per image with `--remote-debugging-port`, a fresh user-data directory and the settings for that scenario, and drives it with [Playwright](https://playwright.dev/) (`playwright-core`, no browser download)
4. takes screenshots while it moves the mouse and presses keys, and draws a mouse pointer on them, because screenshots do not include it
5. turns the frames into GIFs with ffmpeg

You need:

- VS Code installed. The script looks in the usual install location for your OS; otherwise set `VSCODE_PATH` to the Code executable (and `VSCODE_CLI` to the `code` command, if it is not in `bin/` next to it).
- `ffmpeg` on `PATH`, or set `FFMPEG`.

Leave the computer alone while it runs (about three minutes): VS Code windows open and close on their own.

If a step fails, the script keeps the temporary directory and saves `<scenario>-error.png` there.

### What it records

The settings are the same for every image: Dark Modern theme, 16px editor font, minimap, activity bar and sidebar hidden, and `"bashExplainer.language": "en"`. The window is 1280×720 (1000×600 for `hover.gif`), recorded at 1.5× scale and written 1000px wide at 10 fps.

| Image | Settings | Steps |
| --- | --- | --- |
| `demo.gif` | defaults (hover on) | Hover line 8 (`grep -n "ERROR" …`), scroll the hover to **Open in panel** and click it. In the panel, point at `2>/dev/null` so the editor highlights it. Then move the cursor to line 11 and line 12 with the arrow keys; the panel follows. |
| `hover.gif` | defaults (hover on) | Hover line 2 (`set -euo pipefail`), line 4 (`${1:-…}`) and line 7 (inside the loop; the header says "for loop"). |
| `panel.gif` | `hover.enabled: false`, `panel.autoOpen: true` | Move down from line 1 to line 11 with the arrow keys, point at the `-exec` row of the tree, then go on to line 12. |
| `inline.png` | `hover.enabled: false`, `inline.enabled: true` | Cursor on line 8, so its summary shows at the end of the line. Cropped to the editor lines. |

To change a scenario, edit `record()` in the script.

## Recording them by hand

- Tools: [ScreenToGif](https://www.screentogif.com/) on Windows, [Kap](https://getkap.co/) on macOS
- Open `images/demo.sh` and use the settings and steps in the table above
- Export at most 1000px wide, 10–15 fps, under 5 MB per file
- For Japanese images, set `"bashExplainer.language": "ja"`, save them under other names, and point README.ja.md at them
