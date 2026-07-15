import type { ReviewSession, RunEvent } from "@vsnap/protocol";
import type { SessionStore } from "@vsnap/session";

const DEFAULT_BATCH_SIZE = 256;
const DEFAULT_FLUSH_INTERVAL_MS = 100;

export class BufferedRunEventWriter {
  private readonly queued: RunEvent[] = [];
  private pendingWrites = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failure: unknown;

  constructor(
    private readonly store: SessionStore,
    private readonly session: ReviewSession,
    private readonly batchSize = DEFAULT_BATCH_SIZE,
    private readonly flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
  ) {}

  append(event: RunEvent): void {
    this.queued.push(event);
    if (this.queued.length >= this.batchSize) this.flush();
    else if (!this.timer)
      this.timer = setTimeout(() => this.flush(), this.flushIntervalMs);
  }

  async close(): Promise<void> {
    this.flush();
    await this.pendingWrites;
    if (this.failure) throw this.failure;
  }

  private flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.queued.length === 0) return;
    const batch = this.queued.splice(0);
    this.pendingWrites = this.pendingWrites.then(async () => {
      if (this.failure) return;
      try {
        await this.store.appendEvents(this.session, batch);
      } catch (error) {
        this.failure = error;
      }
    });
  }
}
