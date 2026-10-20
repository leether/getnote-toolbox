# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [1.2.0] - 2026-10-20

### Added

- `getnote_remove_notes_from_kb`: remove one or more notes from a knowledge
  base without deleting the notes.
- Eval case `kb.remove` and fake-CLI coverage for the new tool.

## [1.1.0] - 2026-10-20

### Added

- `Config` schema with `binaryPath`, `apiUrl`, `timeoutMs`, and
  `maxOutputBytes`; `Config.listConfigs` reports `schema`.
- Bundled guidance skill `getnote-toolbox`, registered through the Harness
  `skills` service when available.
- Package-content tests, CI workflow, LICENSE, and release documentation.
- Eval fixtures are discovered from the current account instead of hard-coded
  note IDs.

### Fixed

- `getnote_update_note` now passes `-y` for CLI 1.8.0 and retries without it on
  CLI 1.1.1's unknown-flag error, preserving both versions.
- URL saves and nested `note` responses are reported with the exact note ID and
  actual tags.

## [1.0.0] - 2026-10-19

### Added

- Initial Desktop bundle with 14 `getnote_*` tools: auth, search, save, recent
  notes, note detail, update, delete, tags, knowledge base list/notes/create/add,
  task, and quota.
- Big-integer-safe JSON parsing, result normalization, client-side `limit`
  slicing, timeout/output limits, and delete confirmation.
- Locale resources and an original SVG icon for the Desktop Plugin Manager.
