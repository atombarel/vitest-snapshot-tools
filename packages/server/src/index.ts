import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ServerType } from "@hono/node-server";
import { serve } from "@hono/node-server";
import { createSnapshotApplication } from "@vsnap/application";
import type { SnapshotApplication } from "@vsnap/protocol";
import { VsnapError } from "@vsnap/protocol";
import type { SessionStore } from "@vsnap/session";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

export interface SnapshotServerOptions {
  application?: SnapshotApplication;
  repositoryRoot?: string;
  webRoot?: string;
  token?: string;
  hostname?: string;
  port?: number;
  store?: SessionStore;
}
export interface SnapshotServer {
  app: Hono;
  application: SnapshotApplication;
  token: string;
  hostname: string;
  port: number;
  url: string;
  claimSession(sessionId: string): Promise<void>;
  close(): Promise<void>;
}
const decisionInput = z.object({
  selector: z.string(),
  decision: z.enum(["pending", "accepted", "rejected"]),
  expectedRevision: z.number().int().optional(),
});

export async function createSnapshotServer(
  options: SnapshotServerOptions = {},
): Promise<SnapshotServer> {
  const application = options.application ?? createSnapshotApplication();
  const token = options.token ?? randomBytes(32).toString("base64url");
  const hostname = options.hostname ?? "127.0.0.1";
  let actualPort = options.port ?? 0;
  const repositoryRoot = resolve(options.repositoryRoot ?? process.cwd());
  const app = new Hono();
  const ownedSessions = new Set<string>();
  const claimSession = async (sessionId: string): Promise<void> => {
    if (!options.store) return;
    const session = await options.store.load(sessionId);
    await options.store.writeOwner(session, {
      schemaVersion: 1,
      pid: process.pid,
      hostname,
      port: actualPort,
      token,
      heartbeat: new Date().toISOString(),
    });
    ownedSessions.add(sessionId);
  };
  app.onError((error, context) => {
    const value =
      error instanceof z.ZodError
        ? new VsnapError(
            "VALIDATION_ERROR",
            "Request validation failed",
            error.issues,
          )
        : error instanceof VsnapError
          ? error
          : new VsnapError("INTERNAL_ERROR", error.message);
    const status = [
      "STALE_REVISION",
      "STALE_BASELINE",
      "APPLY_FAILED",
      "SESSION_BUSY",
    ].includes(value.code)
      ? 409
      : value.code.endsWith("NOT_FOUND")
        ? 404
        : value.code.startsWith("UNSUPPORTED")
          ? 422
          : 400;
    return context.json(
      {
        schemaVersion: 1,
        ok: false,
        error: {
          code: value.code,
          message: value.message,
          ...(value.details === undefined ? {} : { details: value.details }),
        },
      },
      status,
    );
  });
  app.use("/api/*", async (context, next) => {
    if (context.req.header("authorization") !== `Bearer ${token}`)
      return context.json(
        {
          schemaVersion: 1,
          ok: false,
          error: {
            code: "UNAUTHORIZED",
            message: "A valid bearer token is required",
          },
        },
        401,
      );
    const expectedHost = `${hostname}:${actualPort}`;
    const host = context.req.header("host");
    if (actualPort && host !== expectedHost)
      return context.json(
        {
          schemaVersion: 1,
          ok: false,
          error: {
            code: "INVALID_HOST",
            message: "Host header does not match the local server",
          },
        },
        403,
      );
    const origin = context.req.header("origin");
    if (origin && origin !== `http://${expectedHost}`)
      return context.json(
        {
          schemaVersion: 1,
          ok: false,
          error: {
            code: "INVALID_ORIGIN",
            message: "Cross-origin requests are not allowed",
          },
        },
        403,
      );
    await next();
  });
  app.get("/api/v1/project", (context) =>
    context.json({ schemaVersion: 1, repositoryRoot }),
  );
  app.get("/api/v1/sessions", async (context) =>
    context.json({
      schemaVersion: 1,
      items: await application.listSessions({ repositoryRoot }),
    }),
  );
  app.get("/api/v1/sessions/:id", async (context) =>
    context.json(await application.getSession(context.req.param("id"))),
  );
  app.get("/api/v1/sessions/:id/nodes", async (context) => {
    const kind = context.req.query("kind") as
      | "file"
      | "test"
      | "entry"
      | "hunk"
      | undefined;
    const status = context.req.query("status");
    const cursor = context.req.query("cursor");
    return context.json(
      await application.listNodes({
        sessionId: context.req.param("id"),
        ...(kind === undefined ? {} : { kind }),
        ...(status === undefined ? {} : { status }),
        ...(cursor === undefined ? {} : { cursor }),
      }),
    );
  });
  app.get("/api/v1/sessions/:id/entries/:entryId", async (context) =>
    context.json(
      await application.getDiff({
        sessionId: context.req.param("id"),
        entryId: context.req.param("entryId"),
      }),
    ),
  );
  app.get("/api/v1/sessions/:id/entries/:entryId/content", async (context) => {
    const side = z
      .enum(["baseline", "candidate"])
      .parse(context.req.query("side"));
    return context.json(
      await application.getEntryContent({
        sessionId: context.req.param("id"),
        entryId: context.req.param("entryId"),
        side,
      }),
    );
  });
  app.get("/api/v1/sessions/:id/events", (context) =>
    streamSSE(context, async (stream) => {
      const after = Number(
        context.req.header("last-event-id") ??
          context.req.query("afterSequence") ??
          0,
      );
      for await (const event of application.subscribe(context.req.param("id"), {
        afterSequence: after,
      }))
        await stream.writeSSE({
          id: String(event.sequence),
          event: event.type,
          data: JSON.stringify(event),
        });
    }),
  );
  app.post("/api/v1/runs", async (context) => {
    const body = z
      .object({ vitestArgs: z.array(z.string()).default([]) })
      .parse(await context.req.json().catch(() => ({})));
    const session = await application.startRun({
      repositoryRoot,
      vitestArgs: body.vitestArgs,
      headless: false,
    });
    await claimSession(session.id);
    return context.json(session, 202);
  });
  app.post("/api/v1/sessions/:id/cancel", async (context) => {
    await application.cancelRun(context.req.param("id"));
    return context.json({ schemaVersion: 1, ok: true });
  });
  app.post("/api/v1/sessions/:id/rerun", async (context) => {
    const body = z
      .object({ vitestArgs: z.array(z.string()).optional() })
      .parse(await context.req.json().catch(() => ({})));
    return context.json(
      await application.rerun({
        sessionId: context.req.param("id"),
        ...(body.vitestArgs === undefined
          ? {}
          : { vitestArgs: body.vitestArgs }),
      }),
      202,
    );
  });
  app.put("/api/v1/sessions/:id/decisions", async (context) => {
    const body = decisionInput.parse(await context.req.json());
    return context.json(
      await application.setDecision({
        sessionId: context.req.param("id"),
        selector: body.selector,
        decision: body.decision,
        ...(body.expectedRevision === undefined
          ? {}
          : { expectedRevision: body.expectedRevision }),
      }),
    );
  });
  app.post("/api/v1/sessions/:id/preview", async (context) => {
    const body = z
      .object({ expectedRevision: z.number().int().optional() })
      .parse(await context.req.json().catch(() => ({})));
    return context.json(
      await application.createPreview({
        sessionId: context.req.param("id"),
        ...(body.expectedRevision === undefined
          ? {}
          : { expectedRevision: body.expectedRevision }),
      }),
    );
  });
  app.post("/api/v1/sessions/:id/apply", async (context) => {
    const body = z
      .object({ expectedRevision: z.number().int().optional() })
      .parse(await context.req.json().catch(() => ({})));
    return context.json(
      await application.apply({
        sessionId: context.req.param("id"),
        ...(body.expectedRevision === undefined
          ? {}
          : { expectedRevision: body.expectedRevision }),
      }),
    );
  });
  app.post("/api/v1/sessions/:id/verify", async (context) =>
    context.json(
      await application.verify({ sessionId: context.req.param("id") }),
      202,
    ),
  );
  if (options.webRoot)
    app.get("*", async (context) => {
      const requestPath =
        context.req.path === "/" ? "index.html" : context.req.path.slice(1);
      let path = resolve(options.webRoot as string, requestPath);
      const relativePath = relative(resolve(options.webRoot as string), path);
      if (
        relativePath === ".." ||
        relativePath.startsWith(`..${sep}`) ||
        isAbsolute(relativePath)
      )
        return context.notFound();
      if (!(await stat(path).catch(() => null)))
        path = join(options.webRoot as string, "index.html");
      const content = await readFile(path);
      const types: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
      };
      return new Response(content, {
        headers: {
          "content-type": types[extname(path)] ?? "application/octet-stream",
          "cache-control": path.endsWith("index.html")
            ? "no-store"
            : "public, max-age=31536000, immutable",
        },
      });
    });
  const server = await new Promise<ServerType>((resolveServer) => {
    const value = serve({ fetch: app.fetch, hostname, port: actualPort }, () =>
      resolveServer(value),
    );
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not determine local server port");
  actualPort = address.port;
  const heartbeat = options.store
    ? setInterval(() => {
        for (const sessionId of ownedSessions)
          void claimSession(sessionId).catch(() =>
            ownedSessions.delete(sessionId),
          );
      }, 2_000)
    : undefined;
  heartbeat?.unref();
  return {
    app,
    application,
    token,
    hostname,
    port: actualPort,
    url: `http://${hostname}:${actualPort}/#token=${encodeURIComponent(token)}`,
    claimSession,
    async close() {
      if (heartbeat) clearInterval(heartbeat);
      if (options.store)
        for (const sessionId of ownedSessions) {
          const session = await options.store.load(sessionId).catch(() => null);
          if (!session) continue;
          const owner = await options.store
            .readOwner(session)
            .catch(() => null);
          if (owner?.token === token) await options.store.removeOwner(session);
        }
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    },
  };
}
