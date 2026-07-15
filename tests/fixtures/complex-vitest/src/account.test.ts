import { describe, expect, it } from "vitest";

const logsRequest = (title: string, run: () => void) => it(title, run);

describe.each([
  { kind: "authentication" },
  { kind: "authorisation" },
])("authentications for $kind", ({ kind }) => {
  describe("snapshot in one", () => {
    logsRequest("should have called partners", () => {
      expect({ kind, state: "candidate" }).toMatchSnapshot();
    });
  });
});
