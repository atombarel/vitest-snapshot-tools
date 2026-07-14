import { describe, expect, it } from "vitest";
import { buildApiResponse } from "./api-response.js";

describe("account card", () => {
  it("renders reviewable state", () => {
    expect({
      id: 42,
      name: "Ada Lovelace",
      plan: "pro",
      status: "active",
    }).toMatchSnapshot("profile");

    expect(["read", "review", "apply"]).toMatchSnapshot("permissions");
  });

  it("captures a file snapshot", async () => {
    await expect(
      "# Snapshot review\n\nStatus: ready\nApprovals: explicit\n",
    ).toMatchFileSnapshot("./fixtures/status.md");
  });

  it("captures a paginated API response", async () => {
    await expect(
      `${JSON.stringify(buildApiResponse(), null, 2)}\n`,
    ).toMatchFileSnapshot("./fixtures/api-response.json");
  });
});
