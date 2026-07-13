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
      focus: {
        testLine: 1,
        matcherLine: 1,
        matcherColumn: 14,
        startLine: 1,
        endLine: 1,
      },
    };
    const { container } = render(
      <SourceCodeView source={source} theme="dark" />,
    );
    expect(screen.getByText("src/value.test.ts")).toBeDefined();
    expect(screen.getByText("Read only")).toBeDefined();
    await waitFor(() =>
      expect(container.querySelector("[data-matcher-line]")).not.toBeNull(),
    );
  });
});
