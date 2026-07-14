# vitest-snapshot-tools

`vitest-snapshot-tools` is a transactional Vitest 4 snapshot review tool. It runs the target project’s own Vitest installation, redirects snapshot updates to the OS cache, streams progress to a local authenticated UI, and writes repository snapshots only after explicit approval and `apply`.

## Development

Requirements: macOS or Linux, Node.js `>=20.19`, and Corepack.

```sh
corepack enable
pnpm install
pnpm check
```

The monorepo contains browser-safe protocol schemas, snapshot parsing and diffing, cache persistence, the Vitest overlay runner, shared application service, Hono adapter, CLI, React UI, and the packaged `review-vitest-snapshots` agent skill.

## Usage

```sh
vsnap -- --project unit
vsnap run --json -- src/example.test.ts
vsnap list --kind entry --status pending --json
vsnap diff entry_… --format unified
vsnap accept entry_…
vsnap preview --format patch
vsnap apply
vsnap verify
```

## Try the example

The repository includes an intentionally out-of-date Vitest project with a
standard `.snap` change, a Markdown file snapshot, and a large paginated API
response. The JSON response creates a substantial multi-hunk diff with syntax
highlighting in the review UI. A larger request suite adds six API tests; each
test produces a request-log snapshot and an HTTP-response snapshot. Selecting
either snapshot shows its linked `beforeEach`/`afterEach` hooks, the exact
owning test block, and both candidate chunks in one review:

```sh
corepack enable
pnpm install
pnpm build
pnpm --filter @vitest-snapshot-tools/example-basic review
```

That opens the authenticated review UI and starts the example run. To exercise
the agent-friendly CLI instead:

```sh
pnpm --filter @vitest-snapshot-tools/example-basic review:headless
pnpm --filter @vitest-snapshot-tools/example-basic vsnap list --kind entry --json
```

The example snapshots are not modified during capture. They change only after
you accept a selector and run `vsnap apply` from the example directory. Restore
the example afterward with `git restore examples/basic-vitest`.

Sessions expire after seven days and the newest 20 are retained per canonical repository. Git is never invoked. Inline snapshot changes and browser-mode projects are reported as unsupported in v1.
