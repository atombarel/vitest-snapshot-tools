# Releasing vitest-snapshot-tools

Releases are published from `vMAJOR.MINOR.PATCH` tags by
`.github/workflows/publish.yml`. The workflow uses npm trusted publishing (OIDC),
so normal releases do not use an npm token.

## One-time setup

### 1. Bootstrap the npm package

npm requires a package to exist before a trusted publisher can be attached. For
the first release, sign in with an npm account that has two-factor authentication
enabled and publish from a clean `main` checkout:

```sh
npm login
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm test:e2e
cd packages/vitest-snapshot-tools
npm publish --access public
```

The first manual publish creates `vitest-snapshot-tools@0.1.0`. Trusted
publishing handles later versions.

### 2. Create the GitHub environment

In the GitHub repository, create an environment named `npm`. Add required
reviewers if releases should require manual approval. The workflow does not need
an npm secret.

### 3. Add the npm trusted publisher

Open the `vitest-snapshot-tools` package settings on npmjs.com and add a GitHub
Actions trusted publisher with these exact values:

- Organization or user: `atombarel`
- Repository: `vitest-snapshot-tools`
- Workflow filename: `publish.yml`
- Environment: `npm`
- Allowed action: `npm publish`

The equivalent npm 11 command is:

```sh
npm trust github vitest-snapshot-tools \
  --file publish.yml \
  --repo atombarel/vitest-snapshot-tools \
  --env npm \
  --allow-publish
```

After a successful OIDC release, revoke any npm automation tokens and set the
package's publishing access to disallow tokens. Trusted publishing continues to
work when token publishing is disabled.

## Publish a version

Add a Changeset with the user-facing change:

```sh
pnpm changeset
```

On `main`, apply the pending Changesets and commit the version update:

```sh
pnpm changeset version
pnpm install --lockfile-only
git add .
git commit -m "Release v0.2.0"
```

Check the version in `packages/vitest-snapshot-tools/package.json`, then create
and push the matching tag:

```sh
pnpm release:validate -- v0.2.0
git tag -a v0.2.0 -m "v0.2.0"
git push origin main
git push origin v0.2.0
```

The publish workflow rejects tags that do not exactly match the package version
or do not point to a commit contained in `main`. Stable releases are published
under npm's default `latest` distribution tag.

## References

- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm provenance](https://docs.npmjs.com/generating-provenance-statements/)
- [npm publish](https://docs.npmjs.com/cli/publish/)
