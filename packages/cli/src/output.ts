import type { CliEnvelope } from "@vsnap/protocol";
import { VsnapError } from "@vsnap/protocol";

export function envelope<T>(command: string, data: T): CliEnvelope<T> {
  return { schemaVersion: 1, ok: true, command, data };
}
export function errorEnvelope(
  command: string,
  error: unknown,
): CliEnvelope<never> {
  const value =
    error instanceof VsnapError
      ? error
      : new VsnapError(
          "INTERNAL_ERROR",
          error instanceof Error ? error.message : String(error),
        );
  return {
    schemaVersion: 1,
    ok: false,
    command,
    error: {
      code: value.code,
      message: value.message,
      ...(value.details === undefined ? {} : { details: value.details }),
    },
  };
}
export function exitCode(error: unknown): number {
  if (!(error instanceof VsnapError)) return 2;
  if (
    [
      "STALE_REVISION",
      "STALE_BASELINE",
      "SESSION_BUSY",
      "OWNERSHIP_CONFLICT",
    ].includes(error.code)
  )
    return 3;
  if (
    error.code.startsWith("UNSUPPORTED") ||
    error.code === "CUSTOM_SNAPSHOT_ENVIRONMENT"
  )
    return 4;
  if (error.code === "INTERRUPTED") return 130;
  return 2;
}
