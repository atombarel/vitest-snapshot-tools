import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { createSnapshotServer } from "../packages/server/dist/index.js";

const outputDirectory = resolve("docs/images");
const webRoot = resolve("apps/web/dist");

// The scale example ships its out-of-date source and snapshots through a
// generator, so refresh them before capturing its review session.
const familyScaleRoot = resolve("examples/family-scale-vitest");
execFileSync("node", ["generate.mjs"], {
  cwd: familyScaleRoot,
  stdio: "ignore",
});

await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch();

const createPage = async (height) => {
  const page = await browser.newPage({
    colorScheme: "dark",
    deviceScaleFactor: 2,
    viewport: { width: 1600, height },
  });
  await page.addInitScript(() => {
    localStorage.setItem("vsnap-theme", "dark");
  });
  return page;
};

const withSession = async (repositoryRoot, height, capture) => {
  const server = await createSnapshotServer({
    repositoryRoot,
    webRoot,
    token: "readme-screenshot-token",
  });
  try {
    const sessionId = (await server.application.startRun({ repositoryRoot }))
      .id;
    const reviewUrl = new URL(`/runs/${sessionId}/review`, server.url);
    reviewUrl.hash = new URL(server.url).hash;
    const page = await createPage(height);
    try {
      await page.goto(reviewUrl.toString());
      await capture(page);
    } finally {
      await page.close();
    }
  } finally {
    await server.close();
  }
};

try {
  // Hero: one external-API-call family standing in for 40 identical snapshot
  // changes alongside separate log and response families. Use a taller viewport
  // so the summary, representative test source, and diff fit in one shot.
  await withSession(familyScaleRoot, 1360, async (page) => {
    await page.getByText("Change families", { exact: true }).waitFor();
    await page.locator(".tree-row", { hasText: '"x-api-version"' }).click();
    await page.locator(".family-summary").waitFor();
    await page.locator(".source-code.ready").waitFor();
    await page
      .locator(".snapshot-chunk", {
        hasText: 'toMatchSnapshot("external API calls")',
      })
      .waitFor();
    await page.locator(".diff-scroll").evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({
      path: resolve(outputDirectory, "change-families.png"),
    });
  });

  // Detail: a single test's source, linked hooks, and both snapshot diffs.
  await withSession(resolve("examples/basic-vitest"), 1000, async (page) => {
    await page.getByRole("button", { name: "Tests", exact: true }).click();
    await page
      .getByRole("button", {
        name: /demo API request review > lists active customers/i,
      })
      .click();
    await page.getByText("2 linked hooks · read only").waitFor();
    await page.locator("[data-matcher-line]").nth(1).waitFor();
    await page.locator(".snapshot-chunk").nth(1).waitFor();
    await page.screenshot({
      path: resolve(outputDirectory, "test-context.png"),
    });
  });
} finally {
  await browser.close();
}
