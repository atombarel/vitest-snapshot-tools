# vitest-snapshot-tools

Compact repeated Vitest 4 snapshot failures into exact change families, review
each distinct change once, and safely apply only approved updates.

`vitest-snapshot-tools` runs the target project's own Vitest installation,
redirects snapshot candidates outside the repository, and writes only explicitly
accepted changes. Review in a local authenticated UI or use the versioned JSON
CLI for automation.

![The vitest-snapshot-tools review workspace: a mocked external API-call change compacted into a 40-test exact family alongside separate log and response families](https://raw.githubusercontent.com/atombarel/vitest-snapshot-tools/main/docs/images/change-families.png)

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

## Agent skill and token-efficient review

A repeated API or rendering change can appear in hundreds of snapshots. Instead
of sending every diff through an agent, the CLI groups snapshot entries with
the same complete set of added and removed lines. The agent reviews one
representative diff and can accept or reject all occurrences with one
`family_...` selector. Unique changes remain separate.

```sh
npx vitest-snapshot-tools skill install
```

Ask a Codex-compatible agent to use `$review-vitest-snapshots`. The bundled skill
starts with exact families to reduce JSON payloads, repeated diff inspection,
model context, and token usage while preserving preview and stale-write checks.

## Headless workflow

```sh
npx vitest-snapshot-tools run --json -- src/example.test.ts
npx vitest-snapshot-tools families --status pending --json
npx vitest-snapshot-tools diff entry_... --format unified
npx vitest-snapshot-tools accept family_...
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
