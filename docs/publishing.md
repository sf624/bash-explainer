# Publishing

Releases are published by the [Release workflow](../.github/workflows/release.yml) when a tag `v<version>` is pushed. After approval in the `release` environment, it publishes the same `.vsix` to the VS Code Marketplace and Open VSX, publishes the command-line tool (`cli/`) to npm, creates a GitHub Release, and moves the major tag (`v0`) that the GitHub Action is used by. Then it updates the web page on GitHub Pages with the [Web page workflow](../.github/workflows/pages.yml).

All three registries are reached through GitHub's OpenID Connect, so there is no access token to store or renew: the Marketplace with Microsoft Entra ID, Open VSX and npm with trusted publishing ([Open VSX](https://github.com/eclipse-openvsx/openvsx/wiki/Trusted-Publishing), [npm](https://docs.npmjs.com/trusted-publishers)). For the Marketplace, there is no Azure DevOps personal access token. (Global Azure DevOps PATs are retired on December 1, 2026; see [Secure automated publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace).)

## Releasing a version

1. If the UI changed since the README images were recorded (`node scripts/images-hash.mjs --check` fails), run the [README images](../.github/workflows/readme-images.yml) workflow and merge its pull request; the Release workflow stops otherwise.
2. Bump `version` in `package.json` and `cli/package.json` (`npm version <version> --no-git-tag-version`, then the same in `cli/`), and add a `## <version>` section to `CHANGELOG.md`; merge to `main`.
3. Push the tag from an up-to-date `main`: `git switch main && git pull && git tag v<version> && git push origin v<version>`. The workflow stops if the tag does not match `package.json`.
4. In the workflow run, approve the `release` environment (**Review deployments**).

## One-time setup

### 1. A managed identity in Azure

An Azure subscription is needed (a free one will do; the identity itself costs nothing).

1. In the Azure portal, create a **User assigned managed identity** (any resource group and region).
2. Give it the **Reader** role on its resource group (*Access control (IAM) → Add role assignment*).
3. Under *Settings → Federated credentials → Add credential*, choose **GitHub Actions deploying Azure resources** and enter:
   - Organization: `sf624`, Repository: `bash-explainer`
   - Entity: **Environment**, Environment: `release`

   This lets only jobs of the `release` environment of this repository act as the identity.
4. Note the identity's **Client ID**, its **Tenant ID**, and the **Subscription ID**.

### 2. GitHub

In *Settings → Environments → release* (reviewers and the `v*` tag / `main` branch policy are already set):

- **Environment variables:** `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`.
- No secrets are needed.

### 3. The Marketplace publisher

1. Run the [Marketplace identity](../.github/workflows/marketplace-identity.yml) workflow by hand (*Actions → Marketplace identity → Run workflow*, then approve). It prints the identity's ID.
2. On <https://marketplace.visualstudio.com/manage>, open the `shun-fujioka` publisher, *Members → Add*, paste the ID and give it the **Contributor** role.

### 4. Open VSX

On <https://open-vsx.org>, in the settings of the `shun-fujioka/bash-explainer` extension, add a **trusted publisher**: owner `sf624`, repository `bash-explainer`, workflow `release.yml`, environment `release`. The Release workflow then publishes with `ovsx publish --trusted-publishing`, which exchanges the job's OIDC token for a publishing token that lasts minutes.

- The extension must already have a version on Open VSX (the first one is published with an access token).
- The registration cannot be edited: to change it, delete it and add a new one.
- `OVSX_PAT`, if set, would take precedence over trusted publishing: keep it out of the workflow.

### 5. npm (the command-line tool)

The Release workflow also publishes `cli/` as the npm package [`bash-explainer`](https://www.npmjs.com/package/bash-explainer), at the same version as the extension (a test keeps `cli/package.json` and `package.json` in step). npm's trusted publishing works only for a package that exists, so:

1. Publish the first version by hand, logged in to npm: `npm run build:cli && npm publish ./cli --access public`.
2. On npmjs.com, in the package's *Settings → Trusted publisher*, choose **GitHub Actions** and enter owner `sf624`, repository `bash-explainer`, workflow `release.yml`, environment `release`. Then, under *Publishing access*, disallow tokens.
3. In the repository's *Settings → Secrets and variables → Actions → Variables*, add `NPM_PUBLISH` = `true`. Until then the Release workflow skips npm.

The GitHub Action (`action.yml`) runs `bash-explainer` from npm at the version of the tag it is used at, so a version is usable as an action once it is on npm. The Release workflow also moves the major tag (`v0`, later `v1`) to each release, which is what the README tells people to use (`uses: sf624/bash-explainer@v0`).

Listing the action in the [GitHub Marketplace](https://docs.github.com/en/actions/sharing-automations/creating-actions/publishing-actions-in-github-marketplace) cannot be automated: neither the REST API for releases nor `gh release create` has an option for it. Do it once by hand:

1. Accept the GitHub Marketplace Developer Agreement (the release page asks for it; two-factor authentication is required).
2. Open the latest release (*Releases → Edit*), tick *Publish this Action to the GitHub Marketplace*, choose a primary category (e.g. *Code quality*), check that the metadata shows no warnings, and update the release. The name in `action.yml` (`Bash Explainer check`) must not be taken by another listed action.
3. After the next tagged release, check that the Marketplace page shows the new version. If it does not, releases created by the workflow are not listed on their own: tick the checkbox on each release by hand (*Edit release*).

### 6. README images

The README images are re-recorded by a workflow run by hand, which opens a pull request with them ([images/RECORDING.md](../images/RECORDING.md)). For that, in *Settings → Actions → General*, turn on **Allow GitHub Actions to create and approve pull requests**.

### 7. The web page (GitHub Pages)

1. In *Settings → Pages → Build and deployment*, set **Source** to **GitHub Actions**. This creates the `github-pages` environment.
2. In *Settings → Environments → github-pages → Deployment branches and tags*, add a **tag** rule `v*` (next to `main`), so the Release workflow can deploy. Check that `main` is allowed there too (the default): the previews of pull requests (below) deploy from `main`, because they run on `pull_request_target`.
3. For the first deployment, run the [Web page](../.github/workflows/pages.yml) workflow by hand (*Actions → Web page → Run workflow* on `main`). The page is at <https://sf624.github.io/bash-explainer/>.

After this, pushing a version tag is all a release needs.

#### The pages

One Pages deployment holds all the builds of the page ([pages.yml](../.github/workflows/pages.yml)):

- **The root** (<https://sf624.github.io/bash-explainer/>) is the **latest release**: the highest tag `vX.Y.Z` (found with `git tag --list 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname`; the moving major tag `v0` is not one). It is built in a separate worktree of that tag, with the tag's own `npm ci` and `scripts/build-web.ts`, so an old release builds as it did.
- **`/next/`** is the **development version**, built from `main` (`npm run build:web -- --channel=next`). Its page has a banner with the commit, `<meta name="robots" content="noindex">`, and a "Version" switch back to the root.
- **`/pr/<number>/`** is the **preview of an open pull request** of this repository, built from its head (`BASH_EXPLAINER_CHANNEL=pr BASH_EXPLAINER_PR=<number> npm run build:web`), so that it can be reviewed without checking it out. The page has a banner ("Preview of pull request #N (commit abc1234). Not released.") with links to the pull request and the commit, `noindex`, and a "Version" switch with the entries Release, Development and PR #N. Pull requests from forks, and pull requests to another branch than `main`, get no preview. A pull request that does not build is left out (a warning in the log); the others are deployed.

A deployment replaces the whole site, so each one rebuilds all of them. It runs: after a release (the Release workflow calls it; the new tag is the highest, so it becomes the root), on every push to `main` that changes `web/`, `src/`, `media/`, `package.json`, `package-lock.json`, `scripts/build-web.ts` or the workflow (so `/next/` follows `main`), when a pull request to `main` is opened, updated, reopened or closed (a closed one disappears from the next deployment), and by hand. To redeploy, run *Actions → Web page → Run workflow* on `main`. Pages from tags older than the "Version" switch have no link to `/next/` until the next release.

After a deployment, the `comment` job writes "Web preview: <url> (commit abc1234)" on each pull request that was deployed, in one comment marked `<!-- web-preview -->` that later runs update. When a pull request is closed, the comment says the preview was removed.

Security: the workflow is triggered by `pull_request_target`, so it runs from `main`, never from the pull request, and the `github-pages` environment (which allows `main`) accepts it. The code of a pull request (`npm ci`, its `build:web`) runs only in the `build` job, which has `contents: read` and `pull-requests: read` and no secrets; the checkout does not keep the token, the token is unset before any pull request code runs, the job saves no cache (no `cache: npm` in setup-node), so that code cannot poison what a later run on `main`, such as the Release workflow with its secrets, restores. The list of previews is made after that code ran, and the `comment` job checks every line against the API (open, from this repository, same head commit) before it writes anywhere. What pull request code can still do is write anywhere in `site/`, so a pull request can change any page of the site. The `deploy` job runs no pull request code, and the `comment` job (`pull-requests: write`) checks nothing out. Keep it so: anyone who can push a branch to this repository can publish a page under its Pages site.
