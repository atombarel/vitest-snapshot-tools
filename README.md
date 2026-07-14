# vitest-snapshot-tools

[![CI](https://github.com/atombarel/vitest-snapshot-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/atombarel/vitest-snapshot-tools/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/vitest-snapshot-tools.svg)](https://www.npmjs.com/package/vitest-snapshot-tools)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Vitest 4](https://img.shields.io/badge/Vitest-4.x-6E9F18.svg)](https://vitest.dev/)

A transactional review workflow for Vitest 4 snapshots. When a change breaks
hundreds of snapshots, `vitest-snapshot-tools` groups the identical failures
into a handful of **exact change families**, lets you review each distinct
change once—in the browser or through an agent-friendly CLI—and then applies
that decision everywhere it occurs.

Nothing in your repository changes while you review. `vsnap` runs your project's
own Vitest, captures every snapshot candidate in the OS cache, and writes
approved changes back only when you run `vsnap apply` or choose **Preview &
apply accepted** in the UI.

![The vitest-snapshot-tools review workspace on a 100-test suite: a mocked external API-call change compacted into a 40-test exact family, with separate log and response families, the three snapshot matchers in the representative test, and the baseline-to-candidate outbound-call diff](docs/images/change-families.png)

## Highlights

- **Review once, apply everywhere.** Identical diffs collapse into exact change
  families, so this 180-change demo becomes 16 decisions and a thousand-failure
  run collapses to the handful of distinct changes it actually contains.
- **Nothing is written during capture.** A custom snapshot environment redirects
  Vitest's baseline and candidate output to a private cache. Repository files
  change only on an explicit `apply`.
- **Built for coding agents.** A headless, `--json` CLI and a bundled skill let
  an agent review one representative diff per family instead of re-reading every
  near-identical snapshot.
- **No Git required.** No Git command runs during capture, review, apply, or
  verify, so it behaves the same in a clean tree, a dirty tree, or no repo at all.
- **Safe by construction.** Hash-checked writes, path containment, symlink
  refusal, and a rollback journal protect the apply step.

## Quick start

Run the published package from the root of any Vitest project:

```sh
npx vitest-snapshot-tools
```

`npx` uses the project-local package when it is installed and downloads it for a
one-off run otherwise. Everything after `--` is passed straight to Vitest; with
no arguments, the default Vitest configuration is reviewed:

```sh
npx vitest-snapshot-tools -- src/account.test.ts --project unit
```

The CLI opens the local review UI (and prints the URL if a browser cannot be
opened for it). The server listens locally and requires a per-process bearer
token.

To pin the version for a team, add it as a dev dependency:

```sh
npm install --save-dev vitest-snapshot-tools
```

### Requirements

- Node.js 22.14 or newer (tested on Node.js 22, 24, and 26)
- A project-local Vitest in the `>=4 <5` range
- macOS or Linux (the platforms currently covered by CI)

## Review once, apply everywhere

Snapshot updates are unusually expensive—especially for coding agents. A
one-line API change can fail hundreds of tests, and sending every nearly
identical diff to a model wastes context, tool calls, and tokens.

`vitest-snapshot-tools` fingerprints the exact added and removed lines in every
hunk and groups identical fingerprints into **change families**. You inspect one
representative diff, see how many occurrences, tests, and files it affects, and
accept or reject the entire exact family with a single decision. Singletons and
genuine outliers stay separate, so compaction never hides a unique change or
relies on a model guessing that two diffs are equivalent.

For the bundled 100-test scale example, the review workload shrinks like this:

| Work to review | Entry-by-entry | Family-first |
| --- | ---: | ---: |
| Review items | 100 | 14 |
| Representative diffs needed | Up to 100 | Up to 14 |
| Decisions for full coverage | Up to 100 | 14 |

The exact token savings depend on diff size and how many changes repeat, but
repeated snapshot text no longer needs to be returned to the model for every
test. The ten unique changes in that example still account for ten of the 14
items—only genuinely identical work collapses.

## Built for coding agents

Install the bundled Codex-compatible skill:

```sh
npx vitest-snapshot-tools skill install
```

Then ask your agent to use `$review-vitest-snapshots`, or drive the same
token-efficient workflow directly:

```sh
# Capture outside the repository; JSON includes exactFamilies.
npx vitest-snapshot-tools run --json -- src/account.test.ts

# Start with compact families, not every individual snapshot entry.
npx vitest-snapshot-tools families --status pending --json
npx vitest-snapshot-tools diff entry_representative... --format json

# One exact decision expands safely to every occurrence in that family.
npx vitest-snapshot-tools accept family_...
npx vitest-snapshot-tools preview --format patch
npx vitest-snapshot-tools apply
npx vitest-snapshot-tools verify
```

The skill preserves the transactional safety model: it never edits snapshots or
cache files directly, never skips preview, and refreshes selectors after a
revision conflict. See
[`review-vitest-snapshots`](skills/review-vitest-snapshots/SKILL.md) for the
full agent workflow and JSON response contract.

## How it works

Running `vitest -u` writes every updated snapshot immediately. That is
convenient for small changes, but harder to trust when a run updates many
snapshots or when an automated agent is doing the review.
`vitest-snapshot-tools` separates snapshot generation from repository writes:

1. **Capture** — run Vitest with an overlay snapshot environment and store the
   baseline and candidate outside the repository.
2. **Review** — compact identical added and removed lines into exact change
   families, or inspect the imports, owning suite, linked hooks, focused test,
   snapshot matcher, and full diff.
3. **Decide** — accept or reject a family, file, test, entry, or individual diff
   hunk.
4. **Preview** — inspect the exact patch assembled from accepted hunks.
5. **Apply** — hash-check the baseline and atomically write only accepted
   changes.
6. **Verify** — run Vitest again and confirm no unexpected snapshot changes
   remain.

![A per-test review showing the focused test block, its linked afterEach hook, both snapshot matchers, and the generated request-log and HTTP-response diffs](docs/images/test-context.png)

Group changes by **family** to review each distinct change once, or by **test**
to walk a single test's source, linked hooks, and every snapshot it produces.

## Try the demos from source

The repository ships two intentionally out-of-date Vitest projects.

### Basic demo

`examples/basic-vitest` covers the full surface area: normal `.snap` files,
Markdown and JSON file snapshots, a deleted snapshot, multi-hunk diffs, and
tests that create multiple snapshots from one source block.

```sh
git clone https://github.com/atombarel/vitest-snapshot-tools.git
cd vitest-snapshot-tools
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @vitest-snapshot-tools/example-basic review
```

Select a change in the left panel, compare the test source and snapshot output,
then accept or reject that test's snapshots. Applying is optional; capture and
review do not modify the example snapshots. If you apply changes while
exploring, restore the fixtures with `git restore examples/basic-vitest`.

### Change families at scale

`examples/family-scale-vitest` generates a small deterministic HTTP application
with routing, a mocked outbound API, request-scoped structured logging, response
envelopes, and 100 integration-style tests. Each test independently snapshots
the recorded external API calls, emitted logs, and API response. The first 40
tests therefore expose three distinct 40-occurrence families, followed by
response families of 25, 15, and 10 occurrences and ten deliberate outliers
that must remain separate.

```sh
pnpm build
pnpm --filter @vitest-snapshot-tools/example-family-scale review
```

The generator resets its ignored source and snapshot fixtures before every run,
so it can be repeated without restoring repository files. For a headless
assertion of the expected family distribution:

```sh
pnpm --filter @vitest-snapshot-tools/example-family-scale verify
```

## Common workflows

### Review in the browser

```sh
# Run the default Vitest configuration and open the review UI
npx vitest-snapshot-tools

# Pass a file filter or any supported Vitest arguments
npx vitest-snapshot-tools -- src/account.test.ts --project unit

# Reopen the local UI without starting another run
npx vitest-snapshot-tools ui --no-run

# Reopen one known session
npx vitest-snapshot-tools ui --no-run --session <session-id>
```

### Review from the CLI

Every command supports `--json`, which returns a versioned envelope suitable for
scripts and agents.

```sh
# Capture candidates without opening the UI
npx vitest-snapshot-tools run --json -- src/account.test.ts

# Inspect the newest session for this repository
npx vitest-snapshot-tools families --status pending
npx vitest-snapshot-tools diff entry_... --format unified

# Decide at family, entry, hunk, test, file, or entire-run scope
npx vitest-snapshot-tools accept family_...
npx vitest-snapshot-tools accept entry_...
npx vitest-snapshot-tools reject hunk_...

# Inspect exactly what would be written, then apply and verify
npx vitest-snapshot-tools preview --format patch
npx vitest-snapshot-tools apply
npx vitest-snapshot-tools verify
```

Commands use the newest session for the current canonical repository unless you
pass `--session <session-id>`.

## CLI reference

| Command | Purpose |
| --- | --- |
| `vsnap [ui] -- [vitest args]` | Start a capture, open the local UI, and stream run events |
| `vsnap run -- [vitest args]` | Capture headlessly and print the session ID |
| `vsnap sessions` | List cached review sessions for the current repository |
| `vsnap status [session]` | Show run state, revision, and snapshot-change count |
| `vsnap families [session]` | List exact change families with occurrence, test, and file counts; filter with `--status` |
| `vsnap list [session]` | List family, file, test, entry, or hunk selectors; filter with `--kind` and `--status` |
| `vsnap diff <entry>` | Print an entry as a unified diff or summary |
| `vsnap accept <selector>` | Accept a family, file, test, entry, hunk, or `--all` |
| `vsnap reject <selector>` | Reject a family, file, test, entry, hunk, or `--all` |
| `vsnap preview [session]` | Print the decision summary or exact patch with `--format patch` |
| `vsnap apply [session]` | Write accepted changes while leaving pending work in the session |
| `vsnap verify [session]` | Run a child capture to check the applied result |
| `vsnap clean` | Remove sessions with `--older-than 2d` or remove all with `--all` |
| `vsnap skill install` | Install the bundled `review-vitest-snapshots` Codex skill |

## Safety model

- **No snapshot writes during capture.** A custom snapshot environment redirects
  Vitest's baseline and candidate data to a private cache directory.
- **Explicit decisions.** Pending and rejected hunks never enter an apply plan.
- **Stale-write protection.** Apply stops if a repository snapshot no longer
  matches the baseline hash captured by the session.
- **Contained paths.** Apply rejects paths outside the repository and refuses
  symlinked snapshot targets.
- **Crash-aware writes.** Files are prepared before writing; an apply journal and
  backups allow a failed multi-file write to roll back.
- **Local, authenticated UI.** The server uses a random bearer token and does not
  expose unauthenticated API routes.
- **No Git dependency.** No Git command is run during capture, review, apply, or
  verification.

Sessions are stored in the platform cache directory (`~/.cache` on Linux and
`~/Library/Caches` on macOS by default). Sessions older than seven days are
cleaned automatically, and the newest 20 sessions are retained per canonical
repository.

## Current limitations

The current version intentionally supports a narrow, predictable workflow:

- Vitest 4 in Node mode only
- External `.snap` files and `toMatchFileSnapshot` file snapshots
- No watch mode, Vitest UI/API mode, or browser projects
- No custom `snapshotEnvironment`
- Inline snapshot changes are detected and reported, but cannot be applied
- One active capture per process

## Contributing

Bug reports, small fixes, and focused pull requests are welcome. Please use
[GitHub Issues](https://github.com/atombarel/vitest-snapshot-tools/issues) for
reproducible bugs, and open an issue before starting a substantial behavior or
protocol change.

### Development setup

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm test:e2e
```

The monorepo separates the protocol, diff engine, session store, Vitest runner,
application service, local server, CLI, React UI, published package, examples,
and agent skill. Turbo coordinates builds and tests; Biome handles linting and
formatting.

To refresh the README images after a UI change, install Playwright's Chromium
once and run:

```sh
pnpm exec playwright install chromium
pnpm docs:screenshots
```

Before opening a pull request, run `pnpm check`, `pnpm test:e2e`, and
`pnpm skill:validate`. User-facing package changes should include a Changeset:

```sh
pnpm changeset
```

Package releases are published from version tags through npm trusted publishing.
See [RELEASING.md](RELEASING.md) for the one-time npm setup and release
procedure.

## License

[MIT](LICENSE) © vitest-snapshot-tools contributors
