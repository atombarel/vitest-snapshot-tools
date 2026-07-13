import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { SnapshotServer } from "../../packages/server/dist/index.js";
import { createSnapshotServer } from "../../packages/server/dist/index.js";

let server: SnapshotServer;
let sessionId: string;

test.beforeAll(async () => {
  server = await createSnapshotServer({
    repositoryRoot: resolve("examples/basic-vitest"),
    webRoot: resolve("apps/web/dist"),
    token: "playwright-token",
  });
  sessionId = (
    await server.application.startRun({
      repositoryRoot: resolve("examples/basic-vitest"),
    })
  ).id;
});

test("opens the exact owning test in a system-themed read-only code view", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const reviewUrl = new URL(`/runs/${sessionId}/review`, server.url);
  reviewUrl.hash = new URL(server.url).hash;
  await page.goto(reviewUrl.toString());
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("button", {
      name: /account card > renders reviewable state > profile 1/i,
    })
    .click();
  await expect(page.getByText('toMatchSnapshot("profile")')).toBeVisible();
  await page.getByRole("button", { name: "Test source" }).click();
  await expect(page.getByText("src/account.test.ts")).toBeVisible();
  await expect(page.getByText("Read only")).toBeVisible();
  await expect(page.locator("[data-matcher-line]")).toContainText(
    "toMatchSnapshot",
  );
  await page.getByRole("button", { name: /theme: system/i }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
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
