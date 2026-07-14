import { describe, expect, it } from "vitest";

describe("shared API contract", () => {
  it("returns a customer", () => {
    expect({
      id: "cus_001",
      apiVersion: "2026-07-14",
      result: { name: "Ada Lovelace" },
    }).toMatchSnapshot();
  });

  it("returns an invoice", () => {
    expect({
      id: "inv_804",
      apiVersion: "2026-07-14",
      result: { total: 12_900 },
    }).toMatchSnapshot();
  });

  it("returns a subscription", () => {
    expect({
      id: "sub_42",
      apiVersion: "2026-07-14",
      result: { plan: "enterprise" },
    }).toMatchSnapshot();
  });
});
