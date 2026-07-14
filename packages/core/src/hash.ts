import { createHash } from "node:crypto";

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableId(
  prefix: "family" | "file" | "test" | "entry" | "hunk" | "plan",
  ...parts: unknown[]
): string {
  return `${prefix}_${sha256(JSON.stringify(parts)).slice(0, 24)}`;
}
