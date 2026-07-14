# Contributing

The highest-value contribution is an **adapter for another agent** (Codex, Cursor, OpenCode, Gemini CLI...). An adapter is one file.

## Adding an adapter

1. Create `src/adapters/<agent>.ts` implementing the `Adapter` interface from `src/adapters/types.ts`:
   - `detect()` — return true if the agent's data directory exists
   - `loadEvents()` — parse the agent's session transcripts into `SessionEvent[]`
2. Fail soft everywhere: skip unreadable files and unparseable lines. Transcript formats are undocumented and drift between agent versions.
3. Add fixture files under `tests/fixtures/<agent>/` — small, anonymized, hand-written transcripts. Never commit real transcripts.
4. Add tests in `tests/` covering: detection, event parsing, skill-invocation extraction, garbage-line handling.
5. `make check` must pass.

Use `src/adapters/claude-code.ts` as the reference implementation.

## Everything else

- Bug fixes and parser updates for transcript format drift are always welcome — include a fixture reproducing the new format.
- Keep the dependency count where it is. New runtime dependencies need a strong reason.
- The JSON report schema (`schema/report.schema.json`) is versioned: additive changes only within a version; breaking changes bump `schemaVersion`.

## Development

```bash
make install
make check     # typecheck + tests — must pass before PR
```
