# vitest-snapshot-tools

Small JavaScript utilities for working with Vitest snapshots.

## Requirements

- Node.js 18 or newer

## Setup

```sh
npm install
```

## Test

```sh
npm test
```

## Usage

```js
import { normalizeSnapshot } from "vitest-snapshot-tools";

const stableSnapshot = normalizeSnapshot(snapshot);
```

`normalizeSnapshot` converts CRLF line endings to LF and guarantees one trailing newline.
