import { describe } from "vitest";
import { registerLogRequest } from "./shared-tests";

describe.each([
  { kind: "authentication" },
  { kind: "authorisation" },
])("authentications for $kind", ({ kind }) => {
  describe("snapshot in one", () => {
    registerLogRequest({
      title: "should have called partners",
      kind,
    });
  });
});
