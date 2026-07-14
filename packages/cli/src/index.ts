import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSnapshotApplication } from "@vsnap/application";
import { VsnapError } from "@vsnap/protocol";
import { createSnapshotServer } from "@vsnap/server";
import type { SessionOwner } from "@vsnap/session";
import { SessionStore } from "@vsnap/session";
import { defineCommand } from "citty";
import open from "open";
import { envelope, errorEnvelope, exitCode } from "./output.js";

export interface RunCliOptions {
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  cwd?: string;
}
function splitArguments(argv: string[]): { tool: string[]; vitest: string[] } {
  const separator = argv.indexOf("--");
  return separator < 0
    ? { tool: argv, vitest: [] }
    : { tool: argv.slice(0, separator), vitest: argv.slice(separator + 1) };
}
function flag(args: string[], name: string): boolean {
  return args.includes(name);
}
function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}
function duration(value: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value);
  if (!match) throw new VsnapError("USAGE", `Invalid duration: ${value}`);
  const amount = Number(match[1]);
  const units: Record<string, number> = {
    ms: 1,
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return amount * (units[match[2] ?? ""] ?? 0);
}
function positional(args: string[], offset = 1): string | undefined {
  return args
    .slice(offset)
    .find(
      (value, index, all) =>
        !value.startsWith("-") &&
        all[index - 1] !== "--session" &&
        all[index - 1] !== "--format" &&
        all[index - 1] !== "--kind" &&
        all[index - 1] !== "--status",
    );
}

async function liveOwner(
  store: SessionStore,
  sessionId: string,
): Promise<SessionOwner | undefined> {
  const session = await store.load(sessionId);
  const owner = await store.readOwner(session).catch(() => undefined);
  if (!owner) return undefined;
  const fresh = Date.now() - Date.parse(owner.heartbeat) < 15_000;
  let running = true;
  try {
    process.kill(owner.pid, 0);
  } catch {
    running = false;
  }
  if (fresh && running) {
    try {
      const response = await fetch(
        `http://${owner.hostname}:${owner.port}/api/v1/project`,
        { headers: { authorization: `Bearer ${owner.token}` } },
      );
      if (response.ok) return owner;
    } catch {
      // The owner disappeared between its heartbeat and this request.
    }
  }
  await store.removeOwner(session);
  return undefined;
}

async function ownerRequest<T>(
  owner: SessionOwner,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(
    `http://${owner.hostname}:${owner.port}/api/v1${path}`,
    {
      ...init,
      headers: {
        authorization: `Bearer ${owner.token}`,
        "content-type": "application/json",
        ...init?.headers,
      },
    },
  );
  const body = (await response.json()) as {
    error?: { code?: string; message?: string; details?: unknown };
  };
  if (!response.ok)
    throw new VsnapError(
      body.error?.code ?? "OWNER_REQUEST_FAILED",
      body.error?.message ?? `Owner request failed with ${response.status}`,
      body.error?.details,
    );
  return body as T;
}

export const mainCommand = defineCommand({
  meta: {
    name: "vsnap",
    version: "0.1.0",
    description: "Safely review Vitest snapshot updates",
  },
});

export async function runCli(
  argv = process.argv.slice(2),
  io: RunCliOptions = {},
): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const cwd = resolve(io.cwd ?? process.cwd());
  const parts = splitArguments(argv);
  const command = parts.tool[0] ?? "ui";
  const json = flag(parts.tool, "--json");
  const store = new SessionStore();
  const app = createSnapshotApplication({ store });
  const write = (data: unknown, human: string) =>
    stdout.write(
      json ? `${JSON.stringify(envelope(command, data))}\n` : `${human}\n`,
    );
  try {
    if (command === "ui" || argv.length === 0) {
      const webRoot = resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../web",
      );
      const server = await createSnapshotServer({
        application: app,
        store,
        repositoryRoot: cwd,
        ...((await stat(webRoot).catch(() => null)) ? { webRoot } : {}),
      });
      let sessionId = option(parts.tool, "--session");
      if (!flag(parts.tool, "--no-run") && !sessionId)
        sessionId = (
          await app.startRun({
            repositoryRoot: cwd,
            vitestArgs: parts.vitest,
            headless: false,
          })
        ).id;
      if (sessionId) await server.claimSession(sessionId);
      const origin = `http://${server.hostname}:${server.port}`;
      const url = sessionId
        ? `${origin}/runs/${sessionId}/review#token=${encodeURIComponent(server.token)}`
        : server.url;
      try {
        const browser = await open(url);
        browser.once("error", () => {
          stderr.write(`Could not open a browser. Review at ${url}\n`);
        });
      } catch {
        stderr.write(`Could not open a browser. Review at ${url}\n`);
      }
      write({ url, sessionId }, `Snapshot review UI · ${url}`);
      return 0;
    }
    if (command === "run") {
      const controller = new AbortController();
      const interrupt = () => controller.abort("interrupted");
      process.once("SIGINT", interrupt);
      const session = await app
        .startRun({
          repositoryRoot: cwd,
          vitestArgs: parts.vitest,
          headless: true,
          signal: controller.signal,
        })
        .finally(() => process.removeListener("SIGINT", interrupt));
      write(
        session,
        `Run complete · ${session.summary.passed} passed · ${session.summary.failed} failed · ${session.summary.snapshotChanges} snapshot changes · ${(session.summary.durationMs / 1000).toFixed(1)}s\nSession ${session.id} · Review with: vsnap ui --session ${session.id}`,
      );
      return session.state === "interrupted"
        ? 130
        : session.summary.failed > 0
          ? 1
          : 0;
    }
    if (command === "sessions") {
      const sessions = await app.listSessions({ repositoryRoot: cwd });
      write(
        sessions,
        sessions
          .map(
            (item) =>
              `${item.id}  ${item.state}  ${item.summary.snapshotChanges} changes`,
          )
          .join("\n") || "No sessions",
      );
      return 0;
    }
    if (command === "clean") {
      const olderThan = option(parts.tool, "--older-than");
      const removed = await store.cleanup(cwd, {
        all: flag(parts.tool, "--all"),
        ...(olderThan ? { olderThanMs: duration(olderThan) } : {}),
      });
      write({ removed }, `Removed ${removed} sessions`);
      return 0;
    }
    if (command === "skill" && parts.tool[1] === "install") {
      const source = resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../skill/review-vitest-snapshots",
      );
      const explicit = option(parts.tool, "--path");
      const targetRoot = resolve(
        explicit ??
          join(
            process.env.CODEX_HOME ?? join(process.env.HOME ?? "~", ".codex"),
            "skills",
          ),
      );
      const target = explicit
        ? targetRoot
        : join(targetRoot, "review-vitest-snapshots");
      if (await stat(target).catch(() => null)) {
        if (!flag(parts.tool, "--force"))
          throw new VsnapError(
            "SKILL_EXISTS",
            `Skill already exists: ${target}`,
          );
        await rm(target, { recursive: true });
      }
      await mkdir(dirname(target), { recursive: true });
      await cp(source, target, { recursive: true });
      write({ path: target }, `Installed review-vitest-snapshots to ${target}`);
      return 0;
    }
    const commandAcceptsSession = [
      "status",
      "list",
      "preview",
      "apply",
      "verify",
    ].includes(command);
    const sessionId =
      option(parts.tool, "--session") ??
      (commandAcceptsSession ? positional(parts.tool) : undefined) ??
      (await app.listSessions({ repositoryRoot: cwd }))[0]?.id;
    if (!sessionId)
      throw new VsnapError(
        "SESSION_NOT_FOUND",
        "No session exists for this repository",
      );
    const owner = await liveOwner(store, sessionId);
    if (command === "status") {
      const session = owner
        ? await ownerRequest<Awaited<ReturnType<typeof app.getSession>>>(
            owner,
            `/sessions/${sessionId}`,
          )
        : await app.getSession(sessionId);
      write(
        session,
        `${session.id} · ${session.state} · revision ${session.revision} · ${session.summary.snapshotChanges} changes`,
      );
      return 0;
    }
    if (command === "list") {
      const requestedKind = option(parts.tool, "--kind") as
        | "family"
        | "file"
        | "test"
        | "entry"
        | "hunk"
        | undefined;
      const requestedStatus = option(parts.tool, "--status");
      const input = {
        sessionId,
        ...(requestedKind === undefined ? {} : { kind: requestedKind }),
        ...(requestedStatus === undefined ? {} : { status: requestedStatus }),
      };
      const result = owner
        ? await ownerRequest<Awaited<ReturnType<typeof app.listNodes>>>(
            owner,
            `/sessions/${sessionId}/nodes?${new URLSearchParams({
              ...(input.kind ? { kind: input.kind } : {}),
              ...(input.status ? { status: input.status } : {}),
            })}`,
          )
        : await app.listNodes(input);
      write(
        result,
        result.items
          .map((node) => `${node.id}  ${node.decision}  ${node.label}`)
          .join("\n"),
      );
      return 0;
    }
    if (command === "diff") {
      const selector = parts.tool[1];
      if (!selector)
        throw new VsnapError("USAGE", "diff requires an entry selector");
      const result = owner
        ? await ownerRequest<Awaited<ReturnType<typeof app.getDiff>>>(
            owner,
            `/sessions/${sessionId}/entries/${selector}`,
          )
        : await app.getDiff({ sessionId, entryId: selector });
      const format = option(parts.tool, "--format") ?? "unified";
      const human =
        format === "summary"
          ? `${result.hunks.length} hunks · -${result.baseline.length} +${result.candidate.length} bytes`
          : result.hunks
              .flatMap((hunk) => [
                `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
                ...((hunk as typeof hunk & { lines?: string[] }).lines ?? []),
              ])
              .join("\n");
      write(result, human);
      return 0;
    }
    if (command === "accept" || command === "reject") {
      const selector = flag(parts.tool, "--all") ? "all" : parts.tool[1];
      if (!selector)
        throw new VsnapError(
          "USAGE",
          `${command} requires a selector or --all`,
        );
      const decision = command === "accept" ? "accepted" : "rejected";
      const result = owner
        ? await ownerRequest<Awaited<ReturnType<typeof app.setDecision>>>(
            owner,
            `/sessions/${sessionId}/decisions`,
            {
              method: "PUT",
              body: JSON.stringify({ selector, decision }),
            },
          )
        : await app.setDecision({ sessionId, selector, decision });
      write(
        result,
        `${command === "accept" ? "Accepted" : "Rejected"} ${result.affectedHunks.length} hunks`,
      );
      return 0;
    }
    if (command === "preview") {
      const plan = owner
        ? await ownerRequest<Awaited<ReturnType<typeof app.createPreview>>>(
            owner,
            `/sessions/${sessionId}/preview`,
            { method: "POST", body: "{}" },
          )
        : await app.createPreview({ sessionId });
      const format = option(parts.tool, "--format") ?? "summary";
      write(
        plan,
        format === "patch"
          ? plan.patch
          : `${plan.acceptedHunks.length} accepted · ${plan.rejectedHunks.length} rejected · ${plan.pendingHunks.length} pending · ${plan.operations.length} file operations`,
      );
      return 0;
    }
    if (command === "apply") {
      const result = owner
        ? await ownerRequest<Awaited<ReturnType<typeof app.apply>>>(
            owner,
            `/sessions/${sessionId}/apply`,
            { method: "POST", body: "{}" },
          )
        : await app.apply({ sessionId });
      write(
        result,
        result.code === "NO_DECISIONS"
          ? `No decisions · ${result.remaining} pending`
          : `${result.code} · ${result.written.length} files · ${result.remaining} hunks remain`,
      );
      return 0;
    }
    if (command === "verify") {
      const result = owner
        ? await ownerRequest<Awaited<ReturnType<typeof app.verify>>>(
            owner,
            `/sessions/${sessionId}/verify`,
            { method: "POST", body: "{}" },
          )
        : await app.verify({ sessionId });
      write(
        result,
        `Verification ${result.id} · ${result.summary.snapshotChanges} changes`,
      );
      return result.summary.failed > 0 ? 1 : 0;
    }
    throw new VsnapError("USAGE", `Unknown command: ${command}`);
  } catch (error) {
    const serialized = errorEnvelope(command, error);
    (json ? stdout : stderr).write(
      `${json ? JSON.stringify(serialized) : serialized.error?.message}\n`,
    );
    return exitCode(error);
  }
}

export { exitCode } from "./output.js";
