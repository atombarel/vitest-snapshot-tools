import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { SnapshotServer } from "../../packages/server/dist/index.js";
import { createSnapshotServer } from "../../packages/server/dist/index.js";

let server: SnapshotServer;
let sessionId: string;

test.beforeAll(async () => {
  // Hold the run in an active state long enough that the browser reliably
  // catches the live progress banner before the (fast) run completes.
  process.env.VSNAP_E2E_RUN_DELAY_MS = "10000";
  server = await createSnapshotServer({
    repositoryRoot: resolve("examples/family-scale-vitest"),
    webRoot: resolve("apps/web/dist"),
    token: "progress-playwright-token",
  });
  sessionId = (
    await server.application.startRun({
      repositoryRoot: resolve("examples/family-scale-vitest"),
      headless: false,
    })
  ).id;
});

test.afterAll(async () => {
  await server.close();
  process.env.VSNAP_E2E_RUN_DELAY_MS = "0";
});

test("explains live progress during a larger test run", async ({ page }) => {
  const reviewUrl = new URL(`/runs/${sessionId}/review`, server.url);
  reviewUrl.hash = new URL(server.url).hash;
  await page.goto(reviewUrl.toString());

  const progress = page.getByRole("region", { name: "Test run progress" });
  await expect(progress).toBeVisible();
  await expect(progress.getByRole("progressbar")).toBeVisible();
  await expect(progress).toContainText(
    /discovered tests|report discovered tests/,
  );
  await expect(progress).toContainText("snapshot update");
  await expect(progress).toContainText("tests completed");
  await expect(progress).toContainText("files");
});
