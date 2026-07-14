import {
  codeToHtml,
  createCssVariablesTheme,
  createHighlighterCore,
  getTokenStyleObject,
  stringifyTokenStyle,
} from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";

// @pierre/diffs imports Shiki's full bundle, whose language registry makes Vite
// emit every grammar as a publishable chunk. Snapshot diffs only opt into JSON;
// all other snapshots deliberately render as plain text.
export const bundledLanguages = {
  json: () => import("@shikijs/langs/json"),
};

export const createHighlighter = createHighlighterCore;
export const createOnigurumaEngine = createJavaScriptRegexEngine;

export {
  codeToHtml,
  createCssVariablesTheme,
  createJavaScriptRegexEngine,
  getTokenStyleObject,
  stringifyTokenStyle,
};
