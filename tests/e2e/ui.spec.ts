import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { SnapshotServer } from "../../packages/server/dist/index.js";
import { createSnapshotServer } from "../../packages/server/dist/index.js";

let server: SnapshotServer;

test.beforeAll(async () => {
  server = await createSnapshotServer({
    repositoryRoot: resolve("tests/fixtures/basic-vitest"),
    webRoot: resolve("apps/web/dist"),
    token: "playwright-token",
  });
});

test.afterAll(async () => server.close());

test("serves the authenticated review UI", async ({ page }) => {
  await page.goto(server.url);
  await expect(
    page.getByRole("heading", { name: /review every snapshot/i }),
  ).toBeVisible();
  await expect(
    page.getByText(/repository snapshots stay untouched/i),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/token=/);
});
