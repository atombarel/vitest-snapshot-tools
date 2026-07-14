import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { createSnapshotServer } from "../packages/server/dist/index.js";

const repositoryRoot = resolve("examples/basic-vitest");
const outputDirectory = resolve("docs/images");
const server = await createSnapshotServer({
  repositoryRoot,
  webRoot: resolve("apps/web/dist"),
  token: "readme-screenshot-token",
});

let browser;
try {
  const sessionId = (await server.application.startRun({ repositoryRoot })).id;
  const reviewUrl = new URL(`/runs/${sessionId}/review`, server.url);
  reviewUrl.hash = new URL(server.url).hash;

  await mkdir(outputDirectory, { recursive: true });
  browser = await chromium.launch();
  const createPage = async () => {
    const page = await browser.newPage({
      colorScheme: "dark",
      deviceScaleFactor: 2,
      viewport: { width: 1600, height: 1000 },
    });
    await page.addInitScript(() => {
      localStorage.setItem("vsnap-theme", "dark");
    });
    return page;
  };

  let page = await createPage();
  await page.goto(reviewUrl.toString());
  await page
    .getByRole("button", {
      name: /account card > renders reviewable state > profile 1/i,
    })
    .click();
  await page.getByText("src/account.test.ts", { exact: true }).waitFor();
  await page.locator(".source-code.ready").waitFor();
  await page.locator(".snapshot-chunk").first().waitFor();
  await page.screenshot({
    path: resolve(outputDirectory, "review-workspace.png"),
  });

  await page.close();
  page = await createPage();
  await page.goto(reviewUrl.toString());
  await page
    .getByRole("button", {
      name: /demo API request review > lists active customers > request log 1/i,
    })
    .click();
  await page.getByText("2 linked hooks · read only").waitFor();
  await page.locator("[data-matcher-line]").nth(1).waitFor();
  await page.locator(".snapshot-chunk").nth(1).waitFor();
  await page.screenshot({
    path: resolve(outputDirectory, "test-context.png"),
  });
} finally {
  await browser?.close();
  await server.close();
}
