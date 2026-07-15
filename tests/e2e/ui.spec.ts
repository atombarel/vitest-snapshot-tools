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

test("shows the full innermost suite above both snapshot chunks", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.emulateMedia({ colorScheme: "dark" });
  const reviewUrl = new URL(`/runs/${sessionId}/review`, server.url);
  reviewUrl.hash = new URL(server.url).hash;
  await page.goto(reviewUrl.toString());
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByText("Change families", { exact: true }),
  ).toBeVisible();
  await page.locator(".tree-row").first().click();
  await expect(page.getByText("EXACT CHANGE FAMILY")).toBeVisible();
  await expect(page.locator(".family-summary")).toContainText("occurrences");
  const affectedTestSelector = page.getByRole("combobox", {
    name: "Affected test source",
  });
  await expect(affectedTestSelector).toBeVisible();
  await expect(affectedTestSelector.locator("option")).toHaveCount(3);
  await expect(affectedTestSelector.locator("option:checked")).toContainText(
    "returns a customer",
  );
  await expect(page.getByText("1/3", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next affected test" }).click();
  await expect(affectedTestSelector.locator("option:checked")).toContainText(
    "returns a subscription",
  );
  await expect(page.getByText("2/3", { exact: true })).toBeVisible();
  await expect(page.locator("[data-test-start]")).toContainText(
    'it("returns a subscription"',
  );
  await page.setViewportSize({ width: 900, height: 900 });
  const compactSelectorLayout = await page.evaluate(() => {
    const preview = document.querySelector<HTMLElement>(".source-preview");
    const selector = document.querySelector<HTMLElement>(
      ".source-occurrence-selector",
    );
    if (!preview || !selector)
      throw new Error("Affected test source selector is missing");
    return {
      previewRight: preview.getBoundingClientRect().right,
      selectorRight: selector.getBoundingClientRect().right,
    };
  });
  expect(compactSelectorLayout.selectorRight).toBeLessThanOrEqual(
    compactSelectorLayout.previewRight,
  );
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.getByText("Tests", { exact: true }).click();
  await page
    .getByRole("button", {
      name: /demo API request review > lists active customers/i,
    })
    .click();
  await expect(
    page.getByText("src/request-review.test.ts", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("1 context block · read only")).toBeVisible();
  await expect(page.locator(".source-block.imports")).toHaveCount(0);
  await expect(page.locator(".source-block.suite")).toContainText(
    'describe("demo API request review"',
  );
  await expect(page.locator(".source-block.suite")).toContainText(
    "completedRequestIds = []",
  );
  await expect(page.locator(".source-block.suite")).toContainText(
    "toHaveLength(1)",
  );
  await expect(page.locator(".source-block.beforeEach")).toHaveCount(0);
  await expect(page.locator(".source-block.afterEach")).toHaveCount(0);
  await expect(page.locator("[data-matcher-line]")).toHaveCount(2);
  const chunks = page.locator(".snapshot-chunk");
  await expect(chunks).toHaveCount(2);
  await expect(
    chunks.filter({ hasText: 'toMatchSnapshot("request log")' }),
  ).toHaveCount(1);
  await expect(
    chunks.filter({ hasText: 'toMatchSnapshot("HTTP response")' }),
  ).toBeVisible();
  await expect(page.locator(".source-code")).toContainText(
    'it("lists active customers"',
  );
  await expect(page.locator(".source-code")).toContainText(
    'it("creates an invoice"',
  );
  await expect(page.locator(".snapshot-context")).toHaveCount(0);

  const scrollLayout = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>(".review-shell");
    const workspace = document.querySelector<HTMLElement>(".workspace");
    const tree = document.querySelector<HTMLElement>(".tree-panel");
    const center = document.querySelector<HTMLElement>(".diff-panel");
    const scroll = document.querySelector<HTMLElement>(".diff-scroll");
    const content = document.querySelector<HTMLElement>(".review-content");
    const sourcePreview =
      document.querySelector<HTMLElement>(".source-preview");
    const source = document.querySelector<HTMLElement>(".source-code");
    const chunk = document.querySelector<HTMLElement>(".snapshot-chunk");
    if (
      !shell ||
      !workspace ||
      !tree ||
      !center ||
      !scroll ||
      !content ||
      !sourcePreview ||
      !source ||
      !chunk
    )
      throw new Error("Review layout is incomplete");

    const treeTop = tree.getBoundingClientRect().top;
    scroll.scrollTop = scroll.scrollHeight;

    return {
      centerOverflow: getComputedStyle(center).overflow,
      chunkWidth: chunk.getBoundingClientRect().width,
      contentWidth: content.getBoundingClientRect().width,
      documentHeight: document.documentElement.scrollHeight,
      pageScrollY: window.scrollY,
      scrollOverflowY: getComputedStyle(scroll).overflowY,
      scrollTop: scroll.scrollTop,
      shellOverflow: getComputedStyle(shell).overflow,
      sourceOverflowY: getComputedStyle(source).overflowY,
      sourceWidth: sourcePreview.getBoundingClientRect().width,
      treeBottom: tree.getBoundingClientRect().bottom,
      treeTopAfterCenterScroll: tree.getBoundingClientRect().top,
      treeTop,
      viewportHeight: window.innerHeight,
      workspaceOverflow: getComputedStyle(workspace).overflow,
    };
  });
  expect(scrollLayout).toMatchObject({
    centerOverflow: "hidden",
    pageScrollY: 0,
    scrollOverflowY: "auto",
    shellOverflow: "hidden",
    sourceOverflowY: "visible",
    treeTopAfterCenterScroll: scrollLayout.treeTop,
    workspaceOverflow: "hidden",
  });
  expect(scrollLayout.scrollTop).toBeGreaterThan(0);
  expect(scrollLayout.contentWidth).toBeGreaterThan(1_500);
  expect(scrollLayout.sourceWidth).toBe(scrollLayout.contentWidth);
  expect(scrollLayout.chunkWidth).toBe(scrollLayout.contentWidth);
  expect(scrollLayout.documentHeight).toBeLessThanOrEqual(
    scrollLayout.viewportHeight,
  );
  expect(scrollLayout.treeBottom).toBeLessThanOrEqual(
    scrollLayout.viewportHeight,
  );

  await page.setViewportSize({ width: 900, height: 900 });
  const compactLayout = await page.evaluate(() => {
    const scroll = document.querySelector<HTMLElement>(".diff-scroll");
    const content = document.querySelector<HTMLElement>(".review-content");
    const source = document.querySelector<HTMLElement>(".source-preview");
    const chunk = document.querySelector<HTMLElement>(".snapshot-chunk");
    if (!scroll || !content || !source || !chunk)
      throw new Error("Responsive review layout is incomplete");

    return {
      availableWidth: scroll.clientWidth,
      chunkWidth: chunk.getBoundingClientRect().width,
      contentWidth: content.getBoundingClientRect().width,
      sourceWidth: source.getBoundingClientRect().width,
    };
  });
  expect(compactLayout.contentWidth).toBeLessThan(scrollLayout.contentWidth);
  expect(compactLayout.contentWidth).toBeLessThanOrEqual(
    compactLayout.availableWidth,
  );
  expect(compactLayout.sourceWidth).toBe(compactLayout.contentWidth);
  expect(compactLayout.chunkWidth).toBe(compactLayout.contentWidth);

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
