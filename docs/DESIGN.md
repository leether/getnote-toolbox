# Design Notes

## 1. Three layers

| Layer | Responsibility | Executes | Enforces |
| --- | --- | --- | --- |
| **CLI** | Calls the GetNote API, handles login, pagination, errors | yes | limited |
| **Tool** | Exposes a typed, validated contract to the model | yes | yes |
| **Skill** | Explains when and how to use the tools | no | no |

```text
CLI   = capability
Tool  = controlled interface to that capability
Skill = knowledge about when to use it
```

A Tool is worth adding only if it contributes at least one of:

- structured parameters and validation;
- a safety boundary (confirmation, no shell, output cap);
- normalization (ID precision, limits, error semantics);
- version compatibility;
- discoverability and routing.

## 2. Tool contract

Each tool defines:

- a namespaced name, e.g. `getnote_search`;
- when to use it, and when not to;
- a parameter schema with types and limits;
- a high-signal result, not a raw JSON dump;
- actionable errors.

### IDs

GetNote note IDs are 19-digit snowflakes. JavaScript numbers lose precision at
that size, so:

- tool parameters are strings;
- JSON integer literals above `Number.MAX_SAFE_INTEGER` are quoted before
  parsing;
- output prefers `note_id` from the CLI rather than a possibly rounded `id`.

### Results and limits

- Lists carry a client-side `limit`; some CLI versions ignore `--limit`.
- Long note bodies support `max_chars` and return a truncation hint.
- Errors distinguish login, version, argument, timeout, output-cap, and business
  failures.

## 3. Safety model

- Arguments are passed to `spawn` as an array; no shell interpolation.
- There is no generic `run_command` or arbitrary HTTP passthrough.
- API keys are never read, cached, or echoed. Authentication belongs to the
  local `getnote` CLI.
- `getnote_delete_note` requires `confirm: true`.
- Every command has a timeout and an output-size cap.
- The Host environment is passed to the child process, so the local CLI is part
  of the trusted boundary.
- The `npx` fallback downloads `@getnote/cli@latest`; users who care about
  supply-chain reproducibility should set `binaryPath`.

## 4. Testing

- Unit and package tests use a fake CLI and make no network calls.
- The optional smoke script uses a real, logged-in CLI and is read-only.
- Smoke output may contain note snippets; it must not be pasted into issues.
- Tests use synthetic IDs, never real note data.

## 5. Version compatibility

- Validated with `getnote` 1.1.1 and 1.8.0; 1.5.3+ is recommended.
- `note update` and `kb remove` pass `-y` for newer CLIs and retry without it
  when the CLI reports an unknown flag.
- The plugin does not silently assume that `limit` or ID types are stable across
  CLI versions.

## 6. Review checklist before publishing

- [ ] No keys, tokens, cookies, `.env`, or private registry URLs
- [ ] No real note IDs, titles, excerpts, or account names
- [ ] No local absolute paths or personal environment details
- [ ] Fake CLI tests pass without network access
- [ ] `npm pack --dry-run` contains runtime files only
- [ ] README states the npm status and the official-plugin conflict
- [ ] Delete confirmation and output/time limits are intact
