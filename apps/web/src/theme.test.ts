import { describe, expect, it } from "vitest";
import { nextThemeMode, parseThemeMode, resolveTheme } from "./theme.js";

describe("theme preferences", () => {
  it("uses the OS preference in system mode", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("cycles through explicit themes and back to system", () => {
    expect(nextThemeMode("system")).toBe("light");
    expect(nextThemeMode("light")).toBe("dark");
    expect(nextThemeMode("dark")).toBe("system");
    expect(parseThemeMode("unexpected")).toBe("system");
  });
});
