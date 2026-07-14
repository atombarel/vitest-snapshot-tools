import { createHighlighterCore } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";
import javascript from "@shikijs/langs/javascript";
import jsx from "@shikijs/langs/jsx";
import tsx from "@shikijs/langs/tsx";
import typescript from "@shikijs/langs/typescript";
import githubLight from "@shikijs/themes/github-light";
import oneDarkPro from "@shikijs/themes/one-dark-pro";
import type { TestSource } from "@vsnap/protocol";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ResolvedTheme } from "../theme.js";

const sourceHighlighter = createHighlighterCore({
  themes: [githubLight, oneDarkPro],
  langs: [javascript, jsx, typescript, tsx],
  engine: createJavaScriptRegexEngine(),
});

export interface SourceCodeViewProps {
  source: TestSource;
  theme: ResolvedTheme;
}

const blockLabels: Record<TestSource["blocks"][number]["kind"], string> = {
  imports: "imports",
  suite: "owning suite",
  beforeAll: "before all",
  beforeEach: "before each",
  test: "test",
  afterEach: "after each",
  afterAll: "after all",
};

export function SourceCodeView({ source, theme }: SourceCodeViewProps) {
  const [html, setHtml] = useState<string[]>([]);
  const container = useRef<HTMLDivElement>(null);
  const blocks = useMemo(
    () =>
      source.blocks.length
        ? source.blocks
        : [
            {
              kind: "test" as const,
              content: source.content,
              startLine: source.focus.startLine,
              endLine: source.focus.endLine,
            },
          ],
    [source],
  );

  useEffect(() => {
    let active = true;
    setHtml([]);
    void sourceHighlighter
      .then((highlighter) =>
        Promise.all(
          blocks.map((block) =>
            highlighter.codeToHtml(block.content, {
              lang: source.language,
              theme: theme === "dark" ? "one-dark-pro" : "github-light",
              transformers: [
                {
                  line(node, line) {
                    const originalLine = block.startLine + line - 1;
                    node.properties["data-line-number"] = originalLine;
                    if (block.kind === "test")
                      node.properties["data-test-line"] = "";
                    if (originalLine === source.focus.testLine)
                      node.properties["data-test-start"] = "";
                    if (
                      source.focus.matcherLines?.includes(originalLine) ||
                      originalLine === source.focus.matcherLine
                    )
                      node.properties["data-matcher-line"] = "";
                  },
                },
              ],
            }),
          ),
        ),
      )
      .then((values) => {
        if (active) setHtml(values);
      });
    return () => {
      active = false;
    };
  }, [blocks, source, theme]);

  useEffect(() => {
    if (html.length === 0) return;
    container.current
      ?.querySelector("[data-matcher-line]")
      ?.scrollIntoView({ block: "center" });
  }, [html]);

  return (
    <section className="source-view" aria-label="Read-only test source">
      <div
        className={`source-code ${html.length ? "ready" : "loading"}`}
        ref={container}
      >
        {html.length ? (
          blocks.map((block, index) => (
            <div
              className={`source-block ${block.kind}`}
              key={`${block.kind}-${block.startLine}`}
            >
              {block.kind === "test" ? null : (
                <div className="source-block-label">
                  <strong>{blockLabels[block.kind]}</strong>
                  <span>linked · line {block.startLine}</span>
                </div>
              )}
              <div
                // Shiki escapes source text and returns syntax-highlighted, inert markup.
                // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted Shiki renderer output
                dangerouslySetInnerHTML={{ __html: html[index] ?? "" }}
              />
            </div>
          ))
        ) : (
          <div className="source-loading">Coloring test source…</div>
        )}
      </div>
    </section>
  );
}
