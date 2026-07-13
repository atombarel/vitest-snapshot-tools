import { expect, it } from "vitest";

it("captures a value", () => {
  console.log("fixture output");
  expect({ answer: 42, state: "candidate" }).toMatchSnapshot();
});
