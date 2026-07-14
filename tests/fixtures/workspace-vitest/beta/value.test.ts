import { expect, it } from "vitest";

it("captures the beta project", () => expect("beta").toMatchSnapshot());
