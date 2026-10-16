# Publishing

Releases are published by the [Release workflow](../.github/workflows/release.yml) when a tag `v<version>` is pushed. It publishes the same `.vsix` to the VS Code Marketplace and Open VSX and creates a GitHub Release, after approval in the `release` environment. Then it updates the web page on GitHub Pages with the [Web page workflow](../.github/workflows/pages.yml).

Both registries are reached through GitHub's OpenID Connect, so there is no access token to store or renew: the Marketplace with Microsoft Entra ID, and Open VSX with [trusted publishing](https://github.com/eclipse-openvsx/openvsx/wiki/Trusted-Publishing). For the Marketplace, there is no Azure DevOps personal access token. (Global Azure DevOps PATs are retired on December 1, 2026; see [Secure automated publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace).)

## Releasing a version

1. Bump `version` in `package.json` and add a `## <version>` section to `CHANGELOG.md`; merge to `main`.
2. Push the tag: `git tag v0.1.0 && git push origin v0.1.0`.
3. In the workflow run, approve the `release` environment (**Review deployments**).

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

### 5. The web page (GitHub Pages)

1. In *Settings → Pages → Build and deployment*, set **Source** to **GitHub Actions**. This creates the `github-pages` environment.
2. In *Settings → Environments → github-pages → Deployment branches and tags*, add a **tag** rule `v*` (next to `main`), so the Release workflow can deploy.
3. For the first deployment, run the [Web page](../.github/workflows/pages.yml) workflow by hand (*Actions → Web page → Run workflow* on `main`). The page is at <https://sf624.github.io/bash-explainer/>.

After this, pushing a version tag is all a release needs.
