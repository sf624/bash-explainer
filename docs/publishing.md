# Publishing

Releases are published by the [Release workflow](../.github/workflows/release.yml) when a tag `v<version>` is pushed. It publishes the same `.vsix` to the VS Code Marketplace and Open VSX and creates a GitHub Release, after approval in the `release` environment.

The Marketplace is reached with Microsoft Entra ID through GitHub's OpenID Connect, so there is no Azure DevOps personal access token to renew. (Global Azure DevOps PATs are retired on December 1, 2026; see [Secure automated publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace).)

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
- **Environment secret:** `OVSX_PAT`, the Open VSX access token (Open VSX has no equivalent of the Entra ID login).

### 3. The Marketplace publisher

1. Run the [Marketplace identity](../.github/workflows/marketplace-identity.yml) workflow by hand (*Actions → Marketplace identity → Run workflow*, then approve). It prints the identity's ID.
2. On <https://marketplace.visualstudio.com/manage>, open the `shun-fujioka` publisher, *Members → Add*, paste the ID and give it the **Contributor** role.

After this, pushing a version tag is all a release needs.
