import { describe, expect, it } from "vitest";
import { createSnapshotServer } from "./index.js";

describe("snapshot server", () => {
  it("requires bearer auth and rejects cross-origin API calls", async () => {
    const server = await createSnapshotServer({ token: "test-token" });
    try {
      expect(
        (await fetch(`http://${server.hostname}:${server.port}/api/v1/project`))
          .status,
      ).toBe(401);
      expect(
        (
          await fetch(
            `http://${server.hostname}:${server.port}/api/v1/project`,
            {
              headers: {
                authorization: "Bearer test-token",
                origin: "https://evil.example",
              },
            },
          )
        ).status,
      ).toBe(403);
      const response = await fetch(
        `http://${server.hostname}:${server.port}/api/v1/project`,
        { headers: { authorization: "Bearer test-token" } },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ schemaVersion: 1 });
      const invalid = await fetch(
        `http://${server.hostname}:${server.port}/api/v1/sessions/missing/decisions`,
        {
          method: "PUT",
          headers: {
            authorization: "Bearer test-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ selector: "all", decision: "maybe" }),
        },
      );
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({
        error: { code: "VALIDATION_ERROR" },
      });
    } finally {
      await server.close();
    }
  });
});
