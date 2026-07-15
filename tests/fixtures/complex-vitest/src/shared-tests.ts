import { expect, it } from "vitest";

export function registerLogRequest(input: {
  title: string;
  kind: string;
}): void {
  it(input.title, () => {
    expect({ kind: input.kind, state: "candidate" }).toMatchSnapshot();
  });
}
