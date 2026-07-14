# vitest-snapshot-tools

Safely capture, review, and apply Vitest 4 snapshot updates.

`vitest-snapshot-tools` runs the target project's own Vitest installation,
redirects snapshot candidates outside the repository, and writes only explicitly
accepted changes. Review in a local authenticated UI or use the versioned JSON
CLI for automation.

![The vitest-snapshot-tools review workspace](https://raw.githubusercontent.com/atombarel/vitest-snapshot-tools/main/docs/images/review-workspace.png)

## Quick start

```sh
npx vitest-snapshot-tools -- --project unit
```

Requires Node.js 22.14 or newer and a project-local Vitest version in the
`>=4 <5` range. `npx` downloads the package for a one-off run or uses the local
version when installed. To pin it for a project:

```sh
npm install --save-dev vitest-snapshot-tools
npx vitest-snapshot-tools -- --project unit
```

Everything after `--` is passed to Vitest.

## Headless workflow

```sh
npx vitest-snapshot-tools run --json -- src/example.test.ts
npx vitest-snapshot-tools list --kind entry --status pending --json
npx vitest-snapshot-tools diff entry_... --format unified
npx vitest-snapshot-tools accept entry_...
npx vitest-snapshot-tools preview --format patch
npx vitest-snapshot-tools apply
npx vitest-snapshot-tools verify
```

Vitest snapshot updates reach the repository only through `vsnap apply`. The
tool hash-checks the captured baseline, rejects unsafe paths, uses crash-aware
atomic writes, and never invokes Git.

For the source demo, full CLI reference, safety model, current limitations, and
contribution guide, read the
[project README](https://github.com/atombarel/vitest-snapshot-tools#readme).
