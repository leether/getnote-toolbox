# Contributing

## Setup

```bash
pnpm install
pnpm run check
pnpm test
npm pack --dry-run
```

Tests use a fake CLI (`test/fixtures/fake-getnote.mjs`) and never touch the
network or a real GetNote account.

## Structure

| Path | Purpose |
| --- | --- |
| `index.js` | Host plugin: Config, CLI runner, tools, skill provider |
| `cordis.patch.yml` | Bundle patch inserted into the profile |
| `locale/` + `icon.svg` | Desktop Plugin Manager display metadata |
| `test/` | Node test runner unit and package tests |
| `scripts/` | Syntax check and optional read-only smoke test |

## Rules

- Keep the runtime dependency surface small. `@deepseek-ai/schemastery` is
  provided by the Harness runtime and is the only package dependency.
- Never commit real note IDs, titles, excerpts, API keys, tokens, cookies, local
  absolute paths, or smoke-test output.
- Use synthetic IDs in tests.
- Add a test for every new tool or behavior change.
- Keep `getnote_*` tool names stable. They conflict with the official
  `@getnote/dsh-plugin`, so do not install both bundles in one profile.
- Treat delete as destructive: keep the `confirm: true` guard.
- Do not add arbitrary shell or HTTP passthroughs; wrap explicit CLI operations
  only, with argument arrays.
- Do not include personal environment details (account names, home directories,
  private registry URLs) in docs or issues.

## Commits

Use conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).

## Security

Do not open a public issue for a vulnerability or for anything containing
credentials or private note data. Follow [SECURITY.md](SECURITY.md).
