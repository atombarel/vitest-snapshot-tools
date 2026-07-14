---
name: review-vitest-snapshots
description: Compact repeated Vitest snapshot failures into exact change families, inspect one representative diff per family, and safely approve, reject, preview, apply, and verify changes with the headless vsnap CLI. Use for Vitest snapshot updates, large failing snapshot suites, token-efficient agent review, obsolete snapshots, file snapshots, approval workflows, or automated snapshot maintenance.
---

# Review Vitest Snapshots

Use `vsnap` as the sole interface to candidate snapshots. Never edit real snapshot files, session metadata, or cache blobs directly.

## Minimize model context

Start with exact families. Do not enumerate or diff every entry when multiple
hunks belong to the same family. A family is an exact added/removed-line
fingerprint, not a semantic guess: inspect its representative `entryId` once,
check its occurrence, test, and file counts, then make one family decision when
the change is intended across that scope. Review singleton families separately.

This ordering reduces CLI payloads, repeated diff content, tool calls, and model
tokens without weakening the apply safeguards.

## Safe workflow

1. Capture candidates outside the repository:
   `vsnap run --json -- [vitest arguments]`
2. Inspect the returned session:
   `vsnap status [session] --json`
   `vsnap families [session] --status pending --json`
3. Read relevant diffs:
   use each family's representative `entryId` with
   `vsnap diff entry_… --format json`. List individual entries only when the
   representative or affected scope needs deeper investigation.
4. Decide with stable selectors:
   `vsnap accept family_…`, `vsnap accept entry_…`, or
   `vsnap reject hunk_…`
5. Preview the accepted-only result:
   `vsnap preview [session] --format json`
6. Apply explicitly:
   `vsnap apply [session] --json`
7. Optionally verify with a linked clean run:
   `vsnap verify [session] --json`

Do not skip preview. Pending hunks remain at their baseline in preview and remain reviewable in the cache after an incremental apply. Re-list after apply because revision changes issue new hunk IDs.

## Selectors and recovery

Use typed `family_`, `file_`, `test_`, `entry_`, and `hunk_` IDs returned by
`list`; use `--all` only when the request clearly approves the entire run.
Family selectors are exact added/removed-line matches and expand to their
underlying hunks.
Commands automatically forward to an authenticated active UI owner when
present and otherwise operate directly under a session lock.

Treat exit `1` as completed tests with non-snapshot failures, `2` as usage/configuration, `3` as stale revision/hash/ownership conflict, `4` as unsupported Vitest behavior, and `130` as cancellation. On exit `3`, run `status` and `list` again, inspect the new revision and IDs, then repeat preview. Never bypass hash conflicts or stale ownership by editing cache files.

Read [references/cli-json.md](references/cli-json.md) when consuming or producing JSON envelopes.
