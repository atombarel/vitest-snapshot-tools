import { render, screen, waitFor } from "@testing-library/react";
// @vitest-environment jsdom

import type { TestSource } from "@vsnap/protocol";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SourceCodeView } from "./SourceCodeView.js";

vi.mock("@shikijs/core", () => ({
  createHighlighterCore: vi.fn().mockResolvedValue({
    codeToHtml: vi
      .fn()
      .mockReturnValue(
        '<pre class="shiki"><code><span class="line" data-line-number="1" data-matcher-line>expect(value).toMatchSnapshot()</span></code></pre>',
      ),
  }),
}));
vi.mock("@shikijs/engine-javascript", () => ({
  createJavaScriptRegexEngine: vi.fn(),
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("read-only source view", () => {
  it("labels the source and focuses the matcher line", async () => {
    const source: TestSource = {
      entryId: "entry_example",
      relativePath: "src/value.test.ts",
      language: "typescript",
      content: "expect(value).toMatchSnapshot()",
      contentHash: "a".repeat(64),
      blocks: [
        {
          kind: "beforeEach",
          content: "beforeEach(() => setup())",
          startLine: 1,
          endLine: 1,
        },
        {
          kind: "test",
          content: "expect(value).toMatchSnapshot()",
          startLine: 2,
          endLine: 2,
        },
      ],
      focus: {
        testLine: 2,
        matcherLine: 2,
        matcherColumn: 14,
        startLine: 2,
        endLine: 2,
      },
    };
    const { container } = render(
      <SourceCodeView source={source} theme="dark" />,
    );
    expect(await screen.findByText("beforeEach")).toBeDefined();
    await waitFor(() =>
      expect(container.querySelector("[data-matcher-line]")).not.toBeNull(),
    );
  });
});
