# vitest-snapshot-tools

Safely capture, review, and apply Vitest 4 snapshot updates.

`vitest-snapshot-tools` runs the target project's own Vitest installation,
redirects snapshot candidates outside the repository, and writes only explicitly
accepted changes. Review in a local authenticated UI or use the versioned JSON
CLI for automation.

![The vitest-snapshot-tools review workspace](https://raw.githubusercontent.com/atombarel/vitest-snapshot-tools/main/docs/images/review-workspace.png)

## Install

```sh
pnpm add -D vitest-snapshot-tools
pnpm exec vsnap -- --project unit
```

Requires Node.js 20.19 or newer and a project-local Vitest version in the
`>=4 <5` range. Everything after `--` is passed to Vitest.

## Headless workflow

```sh
pnpm exec vsnap run --json -- src/example.test.ts
pnpm exec vsnap list --kind entry --status pending --json
pnpm exec vsnap diff entry_... --format unified
pnpm exec vsnap accept entry_...
pnpm exec vsnap preview --format patch
pnpm exec vsnap apply
pnpm exec vsnap verify
```

Vitest snapshot updates reach the repository only through `vsnap apply`. The
tool hash-checks the captured baseline, rejects unsafe paths, uses crash-aware
atomic writes, and never invokes Git.

For the source demo, full CLI reference, safety model, current limitations, and
contribution guide, read the
[project README](https://github.com/atombarel/vitest-snapshot-tools#readme).
