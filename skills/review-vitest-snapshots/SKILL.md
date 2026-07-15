---
name: review-vitest-snapshots
description: Compact repeated Vitest snapshot failures into exact change families, inspect one representative diff per family, and safely approve, reject, preview, apply, and verify changes with the headless vsnap CLI. Use for Vitest snapshot updates, large failing snapshot suites, token-efficient agent review, obsolete snapshots, file snapshots, approval workflows, or automated snapshot maintenance.
---

# Review Vitest Snapshots

Reviewing a failing snapshot suite by reading every diff is slow and burns tokens,
because the same intended change usually repeats across dozens of tests. The tool
solves this by grouping identical changes into **families**: you inspect one
representative diff, decide once, and apply that decision to the whole group.

The tool is the sole interface to candidate snapshots. Never edit real snapshot
files, session metadata, or cache blobs directly — decisions and applies go through
the CLI so revision hashes and safety checks stay intact.

## Invocation

Always run the CLI through `npx`:

```
npx vitest-snapshot-tools <command> [args]
```

`npx` uses the project-local install when present and downloads it otherwise. The
bare `vsnap` command only exists when the package is installed globally, so it is not
reliable — do not use it. Every command below is shown in its full `npx` form; run it
exactly as written.

## Families are the whole point

Work family-first: review each distinct change **once**, not once per failing test.

A **family** is the set of snapshot entries whose *changed lines are identical*. The
fingerprint hashes only the added (`+`) and removed (`-`) lines — context and line
numbers are ignored — so the same edit groups even at different positions in
different files. A `2021 → 2026` bump across 80 tests is one family with 80
occurrences, not 80 diffs to read. Grouping is exact (byte-for-byte), so accepting a
family cannot sweep in a different change.

Each family node carries what you need to decide without reading every diff:

- a representative `entryId` — the single diff you actually read,
- `childCount` — occurrences sharing this exact change,
- `testCount` / `fileCount` — how far it spreads,
- a human `label` (e.g. `"foo" → "bar"`) — often enough to recognize intent alone.

Read the representative once, check the counts match expectation, and accept the
whole family. **Singleton families (one occurrence) are where surprises hide** —
review those individually. Only drop to `entry_`/`hunk_` selectors when a family
isn't uniform in intent.

## Selector hierarchy

Every command that decides or inspects takes a typed, stable ID. They nest from
broadest to narrowest:

| Selector   | Scope                                                   |
| ---------- | ------------------------------------------------------- |
| `family_…` | all entries sharing one exact change fingerprint        |
| `file_…`   | all changes in one snapshot file                        |
| `test_…`   | all changes under one test                              |
| `entry_…`  | one snapshot entry                                      |
| `hunk_…`   | one contiguous change within an entry                   |

`accept` and `reject` take **any** of these levels (or `--all`); a family/file/test
selector expands to every underlying hunk. Use the broadest selector that exactly
matches your intent. IDs are reissued when the session revision changes (e.g. after
an incremental apply), so always re-list before deciding again.

## Commands

| Command                                                       | Purpose                                                        |
| ------------------------------------------------------------- | -------------------------------------------------------------- |
| `npx vitest-snapshot-tools run -- [vitest args]`              | Capture candidate snapshots headlessly, outside the repo tree. |
| `npx vitest-snapshot-tools sessions`                          | List sessions for this repository.                             |
| `npx vitest-snapshot-tools status [session]`                  | Session state, revision, and change count.                     |
| `npx vitest-snapshot-tools families [session]`                | Family-first list (shorthand for `list --kind family`).        |
| `npx vitest-snapshot-tools list [session] --kind K --status S`| List nodes at any level; `K` ∈ family/file/test/entry/hunk.    |
| `npx vitest-snapshot-tools diff <entryId> --format F`         | One entry's diff; `F` ∈ `summary`, `unified` (default), `json`.|
| `npx vitest-snapshot-tools accept <selector \| --all>`        | Approve a selector's hunks.                                    |
| `npx vitest-snapshot-tools reject <selector \| --all>`        | Reject a selector's hunks.                                     |
| `npx vitest-snapshot-tools preview [session] --format F`      | Dry-run the accepted-only result; `F` ∈ `summary`, `patch`.    |
| `npx vitest-snapshot-tools apply [session]`                   | Write accepted hunks to real snapshot files.                   |
| `npx vitest-snapshot-tools verify [session]`                  | Re-run tests against the applied result to confirm they pass.  |
| `npx vitest-snapshot-tools ui [--no-run] [--session ID]`      | Open the web review UI (attach to an existing session).        |
| `npx vitest-snapshot-tools clean [--older-than 7d] [--all]`   | Remove old sessions from the cache.                            |

Append `--json` to any read or mutation command for a single machine-readable
envelope on stdout — prefer this when driving the tool programmatically. Progress and
diagnostics never pollute stdout. Most commands default to the newest session for the
repo when `[session]` is omitted.

Pick the cheapest diff format for the job: `--format summary` (hunk count + byte
delta) for triage, `unified`/`json` only when you need the actual lines.

## Safe workflow

1. **Capture** candidates outside the repository:
   `npx vitest-snapshot-tools run --json -- [vitest arguments]`
   The result reports how many `exactFamilies` the changes compacted into.
2. **Survey** families instead of raw entries:
   `npx vitest-snapshot-tools families [session] --status pending --json`
3. **Read one diff per family**, using its representative `entryId`:
   `npx vitest-snapshot-tools diff entry_… --format summary` (then `unified`/`json`
   if you need detail). List individual entries only when the representative or its
   scope needs deeper investigation.
4. **Decide** with the broadest exact selector:
   `npx vitest-snapshot-tools accept family_…`,
   `npx vitest-snapshot-tools accept entry_…`, or
   `npx vitest-snapshot-tools reject hunk_…`
5. **Preview** the accepted-only result — never skip this:
   `npx vitest-snapshot-tools preview [session] --format patch`
   Pending and rejected hunks stay at their baseline in the preview.
6. **Apply** explicitly:
   `npx vitest-snapshot-tools apply [session] --json`
7. **Verify** with a linked clean run (optional but recommended):
   `npx vitest-snapshot-tools verify [session] --json`

Apply is incremental: pending hunks are left untouched and stay reviewable in the
cache. Re-list after every apply, because the new revision issues fresh hunk IDs.

### Worked example

```
$ npx vitest-snapshot-tools run --json -- src/    # 214 changes → 6 exact families
$ npx vitest-snapshot-tools families              # family_a1 · 80 occurrences · "2021" → "2026"
$ npx vitest-snapshot-tools diff entry_rep_a1 --format unified   # read the one representative
$ npx vitest-snapshot-tools accept family_a1      # one decision covers all 80
$ npx vitest-snapshot-tools preview --format patch  # confirm only intended files change
$ npx vitest-snapshot-tools apply                 # write accepted hunks
$ npx vitest-snapshot-tools verify                # re-run: tests pass
```

## Selectors and recovery

Commands automatically forward to an authenticated live UI owner when one is holding
the session (so CLI and browser stay consistent) and otherwise operate directly under
a session lock. Use `--all` only when the request clearly approves the entire run.

Branch on the process exit code first, then on the JSON `ok` / `error.code`:

| Exit | Meaning                                          |
| ---- | ------------------------------------------------ |
| `0`  | Success.                                         |
| `1`  | Tests completed with non-snapshot failures.      |
| `2`  | Usage or configuration error.                    |
| `3`  | Stale revision / hash / ownership conflict.      |
| `4`  | Unsupported Vitest behavior.                     |
| `130`| Cancelled.                                       |

On exit `3`, run `status` and `list` again, inspect the new revision and IDs, then
repeat from preview. Never bypass hash conflicts or stale ownership by editing cache
files — refresh session state and retry the mutation, do not retry blindly.

Read [references/cli-json.md](references/cli-json.md) when consuming or producing JSON
envelopes.
