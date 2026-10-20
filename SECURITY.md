# Security

## Supported versions

Security fixes are applied to the current `1.2.x` line.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability or for anything containing
credentials or private note data.

Use GitHub's private vulnerability reporting for this repository if it is
available. If it is not, open a minimal public issue that says only that you
have a security report and how to contact you; do not include exploit details,
tokens, note IDs, titles, or excerpts.

## Scope and trust boundary

- The plugin does not handle GetNote credentials; the local `getnote` CLI does.
- The plugin does not provide an arbitrary command or HTTP passthrough.
- The Host environment is inherited by the `getnote` child process; only use a
  CLI binary you trust.
- The `npx` fallback resolves `@getnote/cli@latest`. Set `binaryPath` to a
  trusted local binary if you need a fixed version.
- Tool output can contain private note content. Do not paste it into public
  issues, chats, or logs.

## What is not a vulnerability

- The plugin requires a logged-in GetNote CLI.
- Tool names conflict with the official `@getnote/dsh-plugin`; install only one.
- The plugin does not create note links because the CLI does not expose them.
