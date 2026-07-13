# vitest-snapshot-tools

Capture Vitest 4 snapshot updates outside your repository, review them by file, test, entry, or text hunk, and apply only explicit approvals.

```sh
pnpm add -D vitest-snapshot-tools
pnpm vsnap -- --project unit
```

`vsnap` opens the authenticated local UI and starts Vitest. For automation, use `vsnap run --json -- [vitest arguments]`, then `list`, `diff`, `accept`/`reject`, `preview`, and `apply`.

Requires Node.js 20.19 or newer and a project-local Vitest version in the `>=4 <5` range. The tool never invokes Git. Snapshot updates reach the repository only through `vsnap apply`.
