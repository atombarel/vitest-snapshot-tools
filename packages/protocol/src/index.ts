import { z } from "zod";

export const SCHEMA_VERSION = 1 as const;

export const RunStateSchema = z.enum([
  "created",
  "collecting",
  "running",
  "cancelling",
  "completed",
  "failed",
  "interrupted",
  "applying",
  "applied",
]);
export type RunState = z.infer<typeof RunStateSchema>;

export const SnapshotKindSchema = z.enum([
  "external",
  "file",
  "inline-unsupported",
]);
export type SnapshotKind = z.infer<typeof SnapshotKindSchema>;
export const ChangeTypeSchema = z.enum(["added", "modified", "deleted"]);
export type ChangeType = z.infer<typeof ChangeTypeSchema>;
export const DecisionSchema = z.enum(["pending", "accepted", "rejected"]);
export type Decision = z.infer<typeof DecisionSchema>;
export type DerivedDecision = Decision | "mixed";

export const RunSummarySchema = z.object({
  total: z.number().int().nonnegative().default(0),
  passed: z.number().int().nonnegative().default(0),
  failed: z.number().int().nonnegative().default(0),
  skipped: z.number().int().nonnegative().default(0),
  pending: z.number().int().nonnegative().default(0),
  snapshotChanges: z.number().int().nonnegative().default(0),
  durationMs: z.number().nonnegative().default(0),
});
export type RunSummary = z.infer<typeof RunSummarySchema>;

export const ReviewSessionSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  repositoryRoot: z.string().min(1),
  repositoryHash: z.string().length(64),
  parentSessionId: z.string().uuid().optional(),
  vitestVersion: z.string(),
  vitestArgs: z.array(z.string()),
  state: RunStateSchema,
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  summary: RunSummarySchema,
});
export type ReviewSession = z.infer<typeof ReviewSessionSchema>;

export const SnapshotFileSchema = z.object({
  id: z.string().startsWith("file_"),
  relativePath: z.string().min(1),
  kind: SnapshotKindSchema,
  baselineHash: z.string().length(64).nullable(),
  candidateHash: z.string().length(64).nullable(),
  changeType: ChangeTypeSchema,
  parseMode: z.enum(["entries", "opaque"]),
  testId: z.string().optional(),
  testFile: z.string().optional(),
});
export type SnapshotFile = z.infer<typeof SnapshotFileSchema>;

export const SnapshotEntrySchema = z.object({
  id: z.string().startsWith("entry_"),
  fileId: z.string().startsWith("file_"),
  key: z.string(),
  testName: z.string().optional(),
  ordinal: z.number().int().positive().optional(),
  changeType: ChangeTypeSchema,
  baselineBlob: z.string().optional(),
  candidateBlob: z.string().optional(),
});
export type SnapshotEntry = z.infer<typeof SnapshotEntrySchema>;

export const DiffHunkSchema = z.object({
  id: z.string().startsWith("hunk_"),
  entryId: z.string().startsWith("entry_"),
  oldStart: z.number().int().nonnegative(),
  oldLines: z.number().int().nonnegative(),
  newStart: z.number().int().nonnegative(),
  newLines: z.number().int().nonnegative(),
  contentHash: z.string().length(64),
  decision: DecisionSchema,
});
export type DiffHunk = z.infer<typeof DiffHunkSchema>;

export const FileOperationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create"),
    relativePath: z.string(),
    expectedHash: z.null(),
    contentBlob: z.string(),
  }),
  z.object({
    type: z.literal("update"),
    relativePath: z.string(),
    expectedHash: z.string().length(64),
    contentBlob: z.string(),
    mode: z.number().int().optional(),
  }),
  z.object({
    type: z.literal("delete"),
    relativePath: z.string(),
    expectedHash: z.string().length(64),
    backupBlob: z.string().optional(),
  }),
]);
export type FileOperation = z.infer<typeof FileOperationSchema>;

export const ApplyPlanSchema = z.object({
  id: z.string().startsWith("plan_"),
  sessionId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  operations: z.array(FileOperationSchema),
  acceptedHunks: z.array(z.string()),
  rejectedHunks: z.array(z.string()),
  pendingHunks: z.array(z.string()),
  patch: z.string(),
});
export type ApplyPlan = z.infer<typeof ApplyPlanSchema>;

export const RunEventTypeSchema = z.enum([
  "run.started",
  "module.queued",
  "module.collected",
  "module.started",
  "suite.started",
  "test.started",
  "console.output",
  "test.finished",
  "suite.finished",
  "module.finished",
  "snapshot.discovered",
  "snapshot.diff-ready",
  "run.finished",
  "run.interrupted",
  "run.failed",
]);
export const RunEventSchema = z.object({
  schemaVersion: z.literal(1),
  sequence: z.number().int().positive(),
  sessionId: z.string().uuid(),
  type: RunEventTypeSchema,
  timestamp: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
});
export type RunEvent = z.infer<typeof RunEventSchema>;

export const ErrorEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
export interface CliEnvelope<T> {
  schemaVersion: 1;
  ok: boolean;
  command: string;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
  total: number;
}
export type ReviewNodeKind = "file" | "test" | "entry" | "hunk";
export interface ReviewNode {
  id: string;
  kind: ReviewNodeKind;
  parentId?: string;
  label: string;
  decision: DerivedDecision;
  changeType?: ChangeType;
  status?: string;
  childCount: number;
}
export interface EntryContent {
  entryId: string;
  side: "baseline" | "candidate";
  content: string | null;
  hash: string | null;
}
export interface TestSource {
  entryId: string;
  relativePath: string;
  language: "typescript" | "tsx" | "javascript" | "jsx" | "text";
  content: string;
  contentHash: string;
  focus: {
    testLine?: number;
    matcherLine?: number;
    matcherColumn?: number;
    startLine: number;
    endLine: number;
  };
}
export interface EntryDiff {
  entryId: string;
  baseline: string;
  candidate: string;
  hunks: DiffHunk[];
  context: {
    snapshotFile: string;
    snapshotKind: SnapshotKind;
    snapshotKey: string;
    matcher:
      | "toMatchSnapshot"
      | "toMatchFileSnapshot"
      | "toMatchInlineSnapshot";
    snapshotName?: string;
    changeType: ChangeType;
    ordinal?: number;
    test?: {
      id?: string;
      name?: string;
      file?: string;
      status?: string;
      durationMs?: number;
      location?: { line: number; column: number };
      failureCount?: number;
    };
  };
}
export interface SessionSummary {
  id: string;
  state: RunState;
  revision: number;
  createdAt: string;
  summary: RunSummary;
  parentSessionId?: string;
}

export interface StartRunInput {
  repositoryRoot: string;
  vitestArgs?: string[];
  headless?: boolean;
  signal?: AbortSignal;
}
export interface RerunInput {
  sessionId: string;
  vitestArgs?: string[];
}
export interface ListSessionsInput {
  repositoryRoot?: string;
}
export interface ListNodesInput {
  sessionId: string;
  kind?: ReviewNodeKind;
  status?: string;
  cursor?: string;
  limit?: number;
}
export interface EntryContentInput {
  sessionId: string;
  entryId: string;
  side: "baseline" | "candidate";
}
export interface GetDiffInput {
  sessionId: string;
  entryId: string;
}
export interface GetTestSourceInput {
  sessionId: string;
  entryId: string;
}
export interface SetDecisionInput {
  sessionId: string;
  selector: string;
  decision: Decision;
  expectedRevision?: number;
}
export interface DecisionResult {
  sessionId: string;
  revision: number;
  affectedHunks: string[];
  decision: Decision;
}
export interface CreatePreviewInput {
  sessionId: string;
  expectedRevision?: number;
}
export interface ApplyInput {
  sessionId: string;
  expectedRevision?: number;
}
export interface ApplyResult {
  code: "APPLIED" | "REBASED" | "NO_DECISIONS";
  sessionId: string;
  revision: number;
  written: string[];
  remaining: number;
}
export interface VerifyInput {
  sessionId: string;
  vitestArgs?: string[];
}

export interface SnapshotApplication {
  startRun(input: StartRunInput): Promise<ReviewSession>;
  cancelRun(sessionId: string): Promise<void>;
  rerun(input: RerunInput): Promise<ReviewSession>;
  listSessions(input?: ListSessionsInput): Promise<SessionSummary[]>;
  getSession(sessionId: string): Promise<ReviewSession>;
  listNodes(input: ListNodesInput): Promise<Page<ReviewNode>>;
  getEntryContent(input: EntryContentInput): Promise<EntryContent>;
  getDiff(input: GetDiffInput): Promise<EntryDiff>;
  getTestSource(input: GetTestSourceInput): Promise<TestSource>;
  setDecision(input: SetDecisionInput): Promise<DecisionResult>;
  createPreview(input: CreatePreviewInput): Promise<ApplyPlan>;
  apply(input: ApplyInput): Promise<ApplyResult>;
  verify(input: VerifyInput): Promise<ReviewSession>;
  subscribe(
    sessionId: string,
    options?: { afterSequence?: number },
  ): AsyncIterable<RunEvent>;
}

export class VsnapError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "VsnapError";
  }
}
