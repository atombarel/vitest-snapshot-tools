import { expect, it } from "vitest";

it("captures the alpha project", () => expect("alpha").toMatchSnapshot());
