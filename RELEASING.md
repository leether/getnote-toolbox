# Releasing

This repository is a **source bundle**. The npm package is published.

- Package name: `@leether/getnote-toolbox`
- Current npm version: `1.2.1`
- Access: public (`publishConfig.access: "public"`)
- `private`: `false`

For the next release, update the version and follow the steps below.
- Repository: <https://github.com/leether/getnote-toolbox>
- Bundle patch: `cordis.patch.yml`
- Current version: `1.2.0`

## 1. Verify the source

```bash
pnpm install --frozen-lockfile
pnpm run check
pnpm test
npm pack --dry-run
```

The tarball must contain only runtime files:

```text
index.js
cordis.patch.yml
locale/en.json
locale/zh.json
icon.svg
README.md
LICENSE
CHANGELOG.md
package.json
```

`@deepseek-ai/schemastery` is provided by the Harness runtime. It is a peer
dependency and must not be bundled.

## 2. Use it as a local bundle

Install the directory through the local bundle / link flow of the DSH version
you use, and confirm that `cordis.patch.yml` is loaded. This repository does not
ship a version-specific installer command.

After installation, verify:

- `Config.listConfigs` shows a schema for the installed row;
- the skill catalog contains `getnote-toolbox`;
- `getnote_auth_status` works with the local CLI;
- the Desktop Plugin Manager shows the localized title/description and icon.

## 3. Publish to npm (only when ready)

Before publishing, decide whether the package should remain private, and review
the package name and scope. If publishing publicly:

```bash
npm publish --access public
git tag v1.2.0
git push origin v1.2.0
```

If provenance is required, publish from a public GitHub Actions workflow with
`id-token: write`.

## 4. Safety checks before any release

- No real note IDs, titles, excerpts, account names, or smoke-test output;
- No API keys, tokens, cookies, `.env` files, or private registry URLs;
- No local absolute paths in docs;
- `LICENSE`, `README.md`, and `CHANGELOG.md` are present;
- CI is green for Node 20 and 22 on Linux and macOS;
- The package does not include development-only files.
