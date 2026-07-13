import { createHighlighterCore } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";
import javascript from "@shikijs/langs/javascript";
import jsx from "@shikijs/langs/jsx";
import tsx from "@shikijs/langs/tsx";
import typescript from "@shikijs/langs/typescript";
import githubLight from "@shikijs/themes/github-light";
import oneDarkPro from "@shikijs/themes/one-dark-pro";
import type { TestSource } from "@vsnap/protocol";
import { Braces, Crosshair, Eye } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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

export function SourceCodeView({ source, theme }: SourceCodeViewProps) {
  const [html, setHtml] = useState("");
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setHtml("");
    void sourceHighlighter
      .then((highlighter) =>
        highlighter.codeToHtml(source.content, {
          lang: source.language,
          theme: theme === "dark" ? "one-dark-pro" : "github-light",
          transformers: [
            {
              line(node, line) {
                node.properties["data-line-number"] = line;
                if (
                  line >= source.focus.startLine &&
                  line <= source.focus.endLine
                )
                  node.properties["data-test-line"] = "";
                if (line === source.focus.testLine)
                  node.properties["data-test-start"] = "";
                if (line === source.focus.matcherLine)
                  node.properties["data-matcher-line"] = "";
              },
            },
          ],
        }),
      )
      .then((value) => {
        if (active) setHtml(value);
      });
    return () => {
      active = false;
    };
  }, [source, theme]);

  useEffect(() => {
    if (!html) return;
    container.current
      ?.querySelector("[data-matcher-line]")
      ?.scrollIntoView({ block: "center" });
  }, [html]);

  return (
    <section className="source-view" aria-label="Read-only test source">
      <header className="source-view-header">
        <div>
          <span className="source-icon">
            <Braces size={14} />
          </span>
          <div>
            <strong>{source.relativePath}</strong>
            <span>
              {source.focus.matcherLine
                ? `Snapshot matcher at line ${source.focus.matcherLine}`
                : "Owning test source"}
            </span>
          </div>
        </div>
        <div className="source-badges">
          <span>
            <Crosshair size={12} /> Focused test
          </span>
          <span>
            <Eye size={12} /> Read only
          </span>
        </div>
      </header>
      <div
        className={`source-code ${html ? "ready" : "loading"}`}
        ref={container}
      >
        {html ? (
          // Shiki escapes source text and returns syntax-highlighted, inert markup.
          // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted Shiki renderer output
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <div className="source-loading">Coloring test source…</div>
        )}
      </div>
    </section>
  );
}
