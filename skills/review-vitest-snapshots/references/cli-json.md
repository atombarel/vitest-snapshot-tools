# CLI JSON contract

Every read or mutation command accepts `--json` and writes exactly one JSON value to stdout. Progress and diagnostics do not pollute stdout.

Success:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "command": "list",
  "data": {}
}
```

Failure:

```json
{
  "schemaVersion": 1,
  "ok": false,
  "command": "apply",
  "error": {
    "code": "STALE_BASELINE",
    "message": "Snapshot changed since capture",
    "details": {}
  }
}
```

The `run` result includes `id`, `revision`, `state`, `parentSessionId` when linked, aggregate `summary`, and `exactFamilies`, the number of distinct exact change families. Node pages contain `items`, `total`, and optional `nextCursor`. `families --json` is the family-first shorthand for `list --kind family --json`. Each node has a typed stable `id`, hierarchy `kind`, `decision`, label, and child count. Exact family nodes also include a representative `entryId`, fingerprint, exact confidence, occurrence count in `childCount`, and affected test/file counts.

Diff data includes `baseline`, `candidate`, and hunks with range fields, a content hash, and decision. Preview data includes the exact repository `patch`, file `operations`, `expectedRevision`, and separate `acceptedHunks`, `rejectedHunks`, and `pendingHunks` arrays. Apply data includes a result code, new revision, written paths, and remaining hunk count.

Shell automation should branch first on process exit code, then on `ok` and `error.code`. Refresh session state on `STALE_REVISION`, `STALE_BASELINE`, or ownership conflicts; do not retry mutation blindly.
