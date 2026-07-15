import {
  appendFile,
  open,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { sha256 } from "@vsnap/core";
import type {
  Decision,
  ReviewSession,
  RunEvent,
  SnapshotEntry,
  SnapshotFile,
} from "@vsnap/protocol";
import {
  ReviewSessionSchema,
  RunEventSchema,
  VsnapError,
} from "@vsnap/protocol";
import { atomicWrite, secureMkdir } from "./fs.js";
import {
  canonicalRepository,
  platformCacheRoot,
  repositoryDirectory,
} from "./paths.js";

export interface StoredReviewEntry extends SnapshotEntry {
  baselineBlob?: string;
  candidateBlob?: string;
}
export interface ReviewIndex {
  schemaVersion: 1;
  files: SnapshotFile[];
  entries: StoredReviewEntry[];
  hunks: Array<{
    id: string;
    entryId: string;
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    contentHash: string;
    changeHash?: string;
    summary?: string;
  }>;
}
export interface SessionStoreOptions {
  cacheRoot?: string;
  now?: () => Date;
  uuid?: () => string;
}
export interface SessionOwner {
  schemaVersion: 1;
  pid: number;
  hostname: string;
  port: number;
  token: string;
  heartbeat: string;
}

export class SessionStore {
  readonly cacheRoot: string;
  private readonly now: () => Date;
  private readonly uuid: () => string;
  constructor(options: SessionStoreOptions = {}) {
    this.cacheRoot = options.cacheRoot ?? platformCacheRoot();
    this.now = options.now ?? (() => new Date());
    this.uuid = options.uuid ?? (() => crypto.randomUUID());
  }

  async create(
    repositoryRoot: string,
    vitestArgs: string[] = [],
    parentSessionId?: string,
  ): Promise<ReviewSession> {
    const repository = await canonicalRepository(repositoryRoot);
    const id = this.uuid();
    const session: ReviewSession = {
      schemaVersion: 1,
      id,
      revision: 0,
      repositoryRoot: repository.root,
      repositoryHash: repository.hash,
      ...(parentSessionId ? { parentSessionId } : {}),
      vitestVersion: "4.x",
      vitestArgs,
      state: "created",
      createdAt: this.now().toISOString(),
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        pending: 0,
        snapshotChanges: 0,
        durationMs: 0,
      },
    };
    const directory = this.sessionDirectory(session);
    for (const child of ["baseline", "candidate", "blobs"])
      await secureMkdir(join(directory, child));
    await atomicWrite(
      join(directory, "session.json"),
      JSON.stringify(session, null, 2),
    );
    await atomicWrite(
      join(directory, "decisions.json"),
      JSON.stringify({ schemaVersion: 1, revision: 0, decisions: {} }, null, 2),
    );
    await atomicWrite(
      join(directory, "index.json"),
      JSON.stringify(
        { schemaVersion: 1, files: [], entries: [], hunks: [] },
        null,
        2,
      ),
    );
    await writeFile(join(directory, "events.ndjson"), "", { mode: 0o600 });
    await writeFile(join(directory, "audit.ndjson"), "", { mode: 0o600 });
    return session;
  }

  sessionDirectory(
    session: Pick<ReviewSession, "repositoryHash" | "id">,
  ): string {
    return join(
      repositoryDirectory(this.cacheRoot, session.repositoryHash),
      "sessions",
      session.id,
    );
  }

  async findDirectory(sessionId: string): Promise<string> {
    const repositories = join(this.cacheRoot, "repositories");
    for (const repository of await readdir(repositories, {
      withFileTypes: true,
    }).catch(() => [])) {
      if (!repository.isDirectory()) continue;
      const directory = join(
        repositories,
        repository.name,
        "sessions",
        sessionId,
      );
      if (
        await stat(directory)
          .then((value) => value.isDirectory())
          .catch(() => false)
      )
        return directory;
    }
    throw new VsnapError(
      "SESSION_NOT_FOUND",
      `Session not found: ${sessionId}`,
    );
  }

  async load(sessionId: string): Promise<ReviewSession> {
    const directory = await this.findDirectory(sessionId);
    try {
      return ReviewSessionSchema.parse(
        JSON.parse(await readFile(join(directory, "session.json"), "utf8")),
      );
    } catch (error) {
      throw new VsnapError(
        "CORRUPT_SESSION",
        `Session ${sessionId} is corrupt and was not removed`,
        error,
      );
    }
  }

  async save(session: ReviewSession): Promise<void> {
    ReviewSessionSchema.parse(session);
    await atomicWrite(
      join(this.sessionDirectory(session), "session.json"),
      JSON.stringify(session, null, 2),
    );
  }

  async writeOwner(session: ReviewSession, owner: SessionOwner): Promise<void> {
    await atomicWrite(
      join(this.sessionDirectory(session), "owner.json"),
      JSON.stringify(owner, null, 2),
    );
  }

  async readOwner(session: ReviewSession): Promise<SessionOwner | undefined> {
    const path = join(this.sessionDirectory(session), "owner.json");
    const value = await readFile(path, "utf8").catch(() => undefined);
    if (!value) return undefined;
    try {
      const owner = JSON.parse(value) as Partial<SessionOwner>;
      if (
        owner.schemaVersion !== 1 ||
        !Number.isInteger(owner.pid) ||
        typeof owner.hostname !== "string" ||
        !Number.isInteger(owner.port) ||
        typeof owner.token !== "string" ||
        typeof owner.heartbeat !== "string"
      )
        throw new Error("invalid owner metadata");
      return owner as SessionOwner;
    } catch (error) {
      throw new VsnapError(
        "CORRUPT_OWNER",
        `Ownership metadata for session ${session.id} is corrupt`,
        error,
      );
    }
  }

  async removeOwner(session: ReviewSession): Promise<void> {
    await rm(join(this.sessionDirectory(session), "owner.json"), {
      force: true,
    });
  }

  async withSessionLock<T>(
    session: ReviewSession,
    action: () => Promise<T>,
  ): Promise<T> {
    const lockPath = join(this.sessionDirectory(session), "session.lock");
    const acquire = async () => {
      try {
        return await open(lockPath, "wx", 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const owner: { pid?: number } = await readFile(lockPath, "utf8")
          .then((value) => JSON.parse(value) as { pid?: number })
          .catch(() => ({}) as { pid?: number });
        const lockStat = await stat(lockPath).catch(() => undefined);
        let active =
          lockStat !== undefined && Date.now() - lockStat.mtimeMs < 30_000;
        if (typeof owner.pid === "number")
          try {
            process.kill(owner.pid, 0);
            active = true;
          } catch {
            active = false;
          }
        if (active)
          throw new VsnapError(
            "SESSION_BUSY",
            `Session ${session.id} is owned by another process`,
            owner,
          );
        await rm(lockPath, { force: true });
        try {
          return await open(lockPath, "wx", 0o600);
        } catch {
          throw new VsnapError(
            "SESSION_BUSY",
            `Session ${session.id} was claimed by another process`,
          );
        }
      }
    };
    const handle = await acquire();
    try {
      await handle.writeFile(
        JSON.stringify({
          schemaVersion: 1,
          pid: process.pid,
          acquiredAt: this.now().toISOString(),
        }),
      );
      await handle.sync();
      return await action();
    } finally {
      await handle.close();
      await rm(lockPath, { force: true });
    }
  }

  async list(repositoryRoot: string): Promise<ReviewSession[]> {
    const repository = await canonicalRepository(repositoryRoot);
    const sessionsRoot = join(
      repositoryDirectory(this.cacheRoot, repository.hash),
      "sessions",
    );
    const sessions: ReviewSession[] = [];
    for (const entry of await readdir(sessionsRoot, {
      withFileTypes: true,
    }).catch(() => [])) {
      if (!entry.isDirectory()) continue;
      try {
        sessions.push(await this.load(entry.name));
      } catch {
        /* quarantined in place and omitted from normal listing */
      }
    }
    return sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async appendEvent(session: ReviewSession, event: RunEvent): Promise<void> {
    RunEventSchema.parse(event);
    const path = join(this.sessionDirectory(session), "events.ndjson");
    await appendFile(path, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  }

  async readEvents(
    session: ReviewSession,
    afterSequence = 0,
  ): Promise<RunEvent[]> {
    const content = await readFile(
      join(this.sessionDirectory(session), "events.ndjson"),
      "utf8",
    ).catch(() => "");
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => RunEventSchema.parse(JSON.parse(line)))
      .filter((event) => event.sequence > afterSequence);
  }

  async readEventChunk(
    session: ReviewSession,
    offset = 0,
  ): Promise<{ events: RunEvent[]; offset: number }> {
    const path = join(this.sessionDirectory(session), "events.ndjson");
    const handle = await open(path, "r");
    try {
      const size = (await handle.stat()).size;
      const start = offset <= size ? offset : 0;
      if (start === size) return { events: [], offset: start };
      const content = Buffer.allocUnsafe(size - start);
      const { bytesRead } = await handle.read(
        content,
        0,
        content.length,
        start,
      );
      const bytes = content.subarray(0, bytesRead);
      const lastNewline = bytes.lastIndexOf(0x0a);
      // An append can be visible while its final NDJSON record is incomplete.
      // Leave that record unread until the next poll instead of failing the
      // live stream with a transient JSON parse error.
      if (lastNewline < 0) return { events: [], offset: start };
      const complete = bytes.subarray(0, lastNewline).toString("utf8");
      return {
        events: complete
          .split("\n")
          .filter(Boolean)
          .map((line) => RunEventSchema.parse(JSON.parse(line))),
        offset: start + lastNewline + 1,
      };
    } finally {
      await handle.close();
    }
  }

  async appendAudit(
    session: ReviewSession,
    action: string,
    details: unknown,
  ): Promise<void> {
    await appendFile(
      join(this.sessionDirectory(session), "audit.ndjson"),
      `${JSON.stringify({ schemaVersion: 1, at: this.now().toISOString(), revision: session.revision, action, details })}\n`,
      { mode: 0o600 },
    );
  }

  async writeBlob(
    session: ReviewSession,
    content: string | Uint8Array,
  ): Promise<string> {
    const hash = sha256(content);
    const path = join(this.sessionDirectory(session), "blobs", hash);
    if (!(await stat(path).catch(() => null))) await atomicWrite(path, content);
    return hash;
  }
  async readBlob(
    session: ReviewSession,
    hash?: string,
  ): Promise<string | undefined> {
    return hash
      ? readFile(join(this.sessionDirectory(session), "blobs", hash), "utf8")
      : undefined;
  }

  async readIndex(session: ReviewSession): Promise<ReviewIndex> {
    const value = JSON.parse(
      await readFile(
        join(this.sessionDirectory(session), "index.json"),
        "utf8",
      ),
    ) as ReviewIndex;
    if (
      value.schemaVersion !== 1 ||
      !Array.isArray(value.files) ||
      !Array.isArray(value.entries) ||
      !Array.isArray(value.hunks)
    )
      throw new VsnapError("CORRUPT_SESSION", "Invalid review index");
    return value;
  }
  async writeIndex(session: ReviewSession, index: ReviewIndex): Promise<void> {
    await atomicWrite(
      join(this.sessionDirectory(session), "index.json"),
      JSON.stringify(index, null, 2),
    );
  }

  async readDecisions(
    session: ReviewSession,
  ): Promise<Record<string, Decision>> {
    const value = JSON.parse(
      await readFile(
        join(this.sessionDirectory(session), "decisions.json"),
        "utf8",
      ),
    ) as { decisions?: Record<string, Decision> };
    return value.decisions ?? {};
  }
  async writeDecisions(
    session: ReviewSession,
    decisions: Record<string, Decision>,
  ): Promise<void> {
    await atomicWrite(
      join(this.sessionDirectory(session), "decisions.json"),
      JSON.stringify(
        { schemaVersion: 1, revision: session.revision, decisions },
        null,
        2,
      ),
    );
  }

  async cleanup(
    repositoryRoot: string,
    options: { olderThanMs?: number; maxSessions?: number; all?: boolean } = {},
  ): Promise<number> {
    const sessions = await this.list(repositoryRoot);
    const cutoff =
      this.now().getTime() - (options.olderThanMs ?? 7 * 86_400_000);
    let removed = 0;
    for (const [index, session] of sessions.entries()) {
      const active = [
        "created",
        "collecting",
        "running",
        "cancelling",
        "applying",
      ].includes(session.state);
      if (active) continue;
      if (
        options.all ||
        new Date(session.completedAt ?? session.createdAt).getTime() < cutoff ||
        index >= (options.maxSessions ?? 20)
      ) {
        await rm(this.sessionDirectory(session), {
          recursive: true,
          force: true,
        });
        removed++;
      }
    }
    return removed;
  }
}
