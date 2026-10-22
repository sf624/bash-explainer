# Recording the README images

README.md and README.ja.md use these four files from this directory, recorded by the script below:

| File | What it shows | Length |
| --- | --- | --- |
| `demo.gif` | The opening demo: panel (the explanation tree, then scroll to the example and edit its input) → hover | about 17 s |
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

The editor font is Cascadia Code (falling back to Consolas), so recordings on Windows and on Linux look alike.

### In GitHub Actions

The [README images workflow](../.github/workflows/readme-images.yml) runs the same script on Ubuntu, in the latest VS Code on a virtual display (xvfb), with Cascadia Code and an emoji font installed:

- **By hand** (*Actions → README images → Run workflow*): it opens a pull request with the new images and starts the tests on it. Look at the images under *Files changed* before merging. The repository must let Actions create pull requests (*Settings → Actions → General → Allow GitHub Actions to create and approve pull requests*).
- **On a pull request that changes the script or the workflow**: it only uploads the images as an artifact (*readme-images*) to look at.

### Keeping them up to date

A full recording also writes `images/.source-hash`: a hash of the files that decide how the images look (`src/ui/`, `media/`, `images/demo.sh` and the recording script; not the explanations' wording). The Release workflow runs `node scripts/images-hash.mjs --check` before publishing and stops when the hash differs, so the Marketplace never shows images of an older UI. Re-record them by hand (above), merge the pull request, then push the tag again.

### In WSL

Install no VS Code in WSL: use the Linux build the integration tests download, and the WSLg display.

```sh
npm run test:integration -- --download-only   # prints the path of the Linux VS Code
VSCODE_PATH=<that path> npm run images
```

The Linux `code` command asks, in WSL, whether to use the Windows VS Code instead; the script answers for it (`DONT_PROMPT_WSL_INSTALL=1`). VS Code and ffmpeg need their libraries installed (`sudo apt-get install ffmpeg libnss3 libasound2t64`). Without root, `apt-get download libnss3 libnspr4 libasound2t64 fonts-cascadia-code fonts-noto-color-emoji`, unpack each with `dpkg-deb -x` into one directory, and set `LD_LIBRARY_PATH` to its `usr/lib/x86_64-linux-gnu` and `FONTCONFIG_FILE` to a `fonts.conf` that includes `/etc/fonts/fonts.conf` and adds its `usr/share/fonts`. A static ffmpeg build works through `FFMPEG`.

### What it records

The settings are the same for every image: Dark Modern theme, 16px editor font, minimap, activity bar and sidebar hidden, and `"bashExplainer.language": "en"`. The window is 1280×720 (1280×840 for `demo.gif`, so that the tree and the example of line 13 fit in the panel; 1000×600 for `hover.gif`), recorded at 1.5× scale and written 1000px wide at 10 fps.

| Image | Settings | Steps |
| --- | --- | --- |
| `demo.gif` | defaults (hover on) | With the cursor on line 13 (`grep -rn "ERROR" "$LOG_DIR" 2>/dev/null >> errors.txt`), open the panel from the editor title bar. The panel first shows the explanation tree; scroll down to the example under the pattern `"ERROR"`, click into its input and turn `RROR` into `ERROR`: the matching lines change. Then hover line 2 (`set -euo pipefail`). |
| `hover.gif` | defaults (hover on) | Hover line 2 (`set -euo pipefail`), line 4 (`${1:-…}`) and line 7 (inside the loop; the header says "for loop"). |
| `panel.gif` | `hover.enabled: false`, `panel.autoOpen: true` | Move down from line 1 to line 11 with the arrow keys, point at the `-exec` row of the tree, then go on to line 12. |
| `inline.png` | `hover.enabled: false`, `inline.enabled: true` | Cursor on line 8, so its summary shows at the end of the line. Cropped to the editor lines. |

To change a scenario, edit `record()` in the script.

## Recording them by hand

- Tools: [ScreenToGif](https://www.screentogif.com/) on Windows, [Kap](https://getkap.co/) on macOS
- Open `images/demo.sh` and use the settings and steps in the table above
- Export at most 1000px wide, 10–15 fps, under 5 MB per file
- For Japanese images, set `"bashExplainer.language": "ja"`, save them under other names, and point README.ja.md at them
